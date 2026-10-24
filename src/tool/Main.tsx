// 主界面：三个页签——回复（粘贴顾客的话，出候选回复）、知识库、敏感词。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, BookOpen, Check, Copy, FileUp, FolderPlus, Info, MessageSquareText, Pencil, Plus, ShieldAlert, Sparkles, Trash2, X } from 'lucide-react';
import type { RunContext } from '../kit/types';
import { onFileDrop, pickFiles } from '../kit/platform';
import { DEFAULT_WORDS, TONES, draftReplies, parseWordList, type Candidate, type Draft, type Tone } from './core';
import { CATS, SHARED, addShop, itemsOfShop, newId, removeItem, removeSamples, removeShop, renameShop, upsertItem, type Item, type Kb } from './kb';
import { IMPORT_EXT, importFile } from './io';
import { sampleKb, DEMO_SHOP } from './samples';
import { loadKb, loadPrefs, loadWords, saveKb, savePrefs, saveWords } from './store';
import './tool.css';

type Ctx = Pick<RunContext, 'readFile' | 'llm'> | undefined;
type Tab = 'reply' | 'kb' | 'words';
type Dialog =
  | { kind: 'item'; draft: Item; isNew: boolean }
  | { kind: 'shop'; from: string | null; value: string }
  | { kind: 'confirm'; text: string; ok: string; run: () => void }
  | null;
type Toast = { kind: 'ok' | 'err'; text: string } | null;

const IS_PREVIEW = typeof location !== 'undefined' && location.pathname.endsWith('preview.html');
const PLACEHOLDER = '把顾客发来的话粘贴到这里，可以只有一句，也可以是一整段聊天记录。\n带「顾客：」「客服：」前缀的聊天记录会自动只取顾客说的话来查资料。';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function Assistant({ ctx }: { ctx: Ctx }) {
  const [tab, setTab] = useState<Tab>('reply');
  const [kb, setKb] = useState<Kb>(sampleKb);
  const [words, setWords] = useState<string[]>(DEFAULT_WORDS);
  const [shop, setShop] = useState(DEMO_SHOP);
  const [tone, setTone] = useState<Tone>('warm');
  const [count, setCount] = useState(3);
  const [chat, setChat] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const kbRef = useRef(kb);
  kbRef.current = kb;
  const flash = (kind: 'ok' | 'err', text: string) => setToast({ kind, text });

  useEffect(() => {
    if (!toast || toast.kind === 'err') return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  // 读取本机保存的知识库、词表和上次的选择；预览页直接用示例并自动跑一遍
  useEffect(() => {
    (async () => {
      const [{ kb: k, saved }, w, p] = await Promise.all([loadKb(), loadWords(), loadPrefs()]);
      setKb(k);
      setWords(w);
      if (!saved) saveKb(k);
      const shopName = p?.shop !== undefined && (p.shop === SHARED || k.shops.includes(p.shop)) ? p.shop : k.shops[0] ?? SHARED;
      setShop(shopName);
      if (p?.tone && TONES.some((t) => t.id === p.tone)) setTone(p.tone);
      if (p?.count && p.count >= 1 && p.count <= 3) setCount(p.count);
      if (IS_PREVIEW) {
        const demo = await import('./preview');
        setChat(demo.demoChat);
        setShop(DEMO_SHOP);
        setDraft(await draftReplies(k, { chat: demo.demoChat, shop: DEMO_SHOP, tone: 'warm', count: 3 }, w, demo.fakeLlm));
      }
    })().catch(() => {});
  }, []);

  useEffect(() => {
    if (!IS_PREVIEW) savePrefs({ shop, tone, count });
  }, [shop, tone, count]);

  const commit = (next: Kb) => {
    setKb(next);
    saveKb(next).then((ok) => !ok && ctx && flash('err', '保存失败：无法写入本机存储'));
  };

  const generate = async () => {
    if (!ctx) return flash('err', '开发预览里不能调用大模型');
    if (!chat.trim()) return flash('err', '请先粘贴顾客的问题');
    setBusy(true);
    setToast(null);
    try {
      setDraft(await draftReplies(kb, { chat, shop, tone, count }, words, ctx.llm));
    } catch (e) {
      setDraft(null);
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importPaths = async (paths: string[]) => {
    if (!ctx) return flash('err', '开发预览里不能导入文件');
    let next = kbRef.current;
    const msgs: string[] = [];
    let ok = false;
    for (const p of paths) {
      try {
        const r = await importFile(ctx.readFile, next, p, shop);
        next = r.kb;
        msgs.push(r.message);
        ok = true;
      } catch (e) {
        msgs.push(e instanceof Error ? e.message : String(e));
      }
    }
    commit(next);
    flash(ok ? 'ok' : 'err', msgs.join('；'));
  };
  const importRef = useRef(importPaths);
  importRef.current = importPaths;
  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    try {
      onFileDrop((paths) => {
        const ok = paths.filter((p) => new RegExp(`\\.(${IMPORT_EXT.join('|')})$`, 'i').test(p));
        if (ok.length) { setTab('kb'); importRef.current(ok); } else flash('err', `只支持导入 ${IMPORT_EXT.join(' / ')} 文件`);
      }).then((u) => (dead ? u() : (off = u))).catch(() => {});
    } catch { /* 预览环境 */ }
    return () => { dead = true; off?.(); };
  }, []);

  const shopOptions = [...kb.shops, SHARED];
  const hasSamples = kb.items.some((i) => i.sample);
  const scopeCount = itemsOfShop(kb, shop).length;

  return (
    <div className="cs">
      <div className="cs-tabs k-panel" role="tablist">
        {([['reply', '回复', MessageSquareText], ['kb', '知识库', BookOpen], ['words', '敏感词', ShieldAlert]] as const).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon size={15} />{label}{id === 'kb' && <i>{scopeCount}</i>}</button>
        ))}
        <span className="cs-tabs-fill" />
        <label className="cs-shop">
          <span className="k-help">店铺</span>
          <select className="k-input" value={shop} onChange={(e) => setShop(e.target.value)} aria-label="当前店铺">
            {shopOptions.map((s) => <option key={s || '__shared'} value={s}>{s || '（只用通用资料）'}</option>)}
          </select>
        </label>
      </div>

      {toast && (
        <div className={`k-notice ${toast.kind}`} role={toast.kind === 'err' ? 'alert' : 'status'}>
          <span>{toast.text}</span>
          <button className="k-icon-btn" aria-label="关闭提示" onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}

      {tab === 'reply' && (
        <ReplyTab {...{ chat, setChat, tone, setTone, count, setCount, busy, generate, draft, flash }} />
      )}

      {tab === 'kb' && (
        <KbTab
          kb={kb} shop={shop} hasSamples={hasSamples}
          onNew={() => setDialog({ kind: 'item', isNew: true, draft: { id: newId(), shop, cat: CATS[0], title: '', text: '' } })}
          onEdit={(i) => setDialog({ kind: 'item', isNew: false, draft: { ...i } })}
          onDelete={(i) => setDialog({ kind: 'confirm', text: `删除资料「${i.title}」？`, ok: '删除', run: () => commit(removeItem(kbRef.current, i.id)) })}
          onImport={async () => { const p = await pickFiles(IMPORT_EXT, '资料文件').catch(() => []); if (p.length) importPaths(p); }}
          onShop={(from) => setDialog({ kind: 'shop', from, value: from ?? '' })}
          onDeleteShop={() => setDialog({ kind: 'confirm', text: `删除店铺「${shop}」和它名下的 ${kb.items.filter((i) => i.shop === shop).length} 条资料？通用资料不受影响。`, ok: '删除店铺', run: () => { commit(removeShop(kbRef.current, shop)); setShop(SHARED); } })}
          onClearSamples={() => setDialog({ kind: 'confirm', text: '删除全部示例资料？你自己新增或导入的资料不受影响。', ok: '删除示例', run: () => { const next = removeSamples(kbRef.current); commit(next); if (!next.shops.includes(shop)) setShop(next.shops[0] ?? SHARED); } })}
        />
      )}

      {tab === 'words' && <WordsTab words={words} onSave={(w) => { setWords(w); saveWords(w); flash('ok', `已保存 ${w.length} 个敏感词`); }} />}

      {dialog && (
        <div className="cs-mask" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)} onKeyDown={(e) => e.key === 'Escape' && setDialog(null)}>
          <div className="cs-dialog k-panel" role="dialog" aria-modal="true">
            {dialog.kind === 'item' && (
              <ItemForm d={dialog.draft} isNew={dialog.isNew} shops={shopOptions} cats={[...new Set([...CATS, ...kb.items.map((i) => i.cat)])]} onCancel={() => setDialog(null)}
                onSave={(it) => {
                  const old = kbRef.current.items.find((x) => x.id === it.id);
                  commit(upsertItem(kbRef.current, { ...it, title: it.title.trim() || it.text.trim().slice(0, 20), cat: it.cat.trim() || '常见问答', text: it.text.trim(), keywords: it.keywords?.trim() || undefined, sample: old?.sample && old.text === it.text.trim() ? true : undefined }));
                  setDialog(null);
                  flash('ok', dialog.isNew ? '已新增资料' : '已保存');
                }} />
            )}
            {dialog.kind === 'shop' && (
              <form className="cs-form" onSubmit={(e) => {
                e.preventDefault();
                const v = dialog.value.trim();
                if (!v) return;
                if (dialog.from !== null) { commit(renameShop(kbRef.current, dialog.from, v)); if (shop === dialog.from) setShop(v); }
                else { commit(addShop(kbRef.current, v)); setShop(v); }
                setDialog(null);
              }}>
                <h3>{dialog.from !== null ? '重命名店铺' : '新建店铺'}</h3>
                <div className="k-field">
                  <label className="k-label" htmlFor="cs-shop-name">店铺名称</label>
                  <input id="cs-shop-name" className="k-input" autoFocus value={dialog.value} onChange={(e) => setDialog({ ...dialog, value: e.target.value })} placeholder="如：旗舰店 / 抖音小店" />
                  <span className="k-help">不同店铺的商品和政策分开存放；两个店铺都适用的资料放在「通用」。</span>
                </div>
                <div className="cs-form-ft"><button type="button" className="k-btn" onClick={() => setDialog(null)}>取消</button><button className="k-btn primary" type="submit">确定</button></div>
              </form>
            )}
            {dialog.kind === 'confirm' && (
              <div className="cs-form">
                <h3>{dialog.text}</h3>
                <div className="cs-form-ft"><button className="k-btn" onClick={() => setDialog(null)}>取消</button><button className="k-btn primary cs-danger" autoFocus onClick={() => { dialog.run(); setDialog(null); }}>{dialog.ok}</button></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- 回复页 ----------

interface ReplyProps {
  chat: string; setChat: (v: string) => void;
  tone: Tone; setTone: (v: Tone) => void;
  count: number; setCount: (v: number) => void;
  busy: boolean; generate: () => void; draft: Draft | null;
  flash: (k: 'ok' | 'err', t: string) => void;
}

function ReplyTab({ chat, setChat, tone, setTone, count, setCount, busy, generate, draft, flash }: ReplyProps) {
  return (
    <div className="cs-reply">
      <section className="cs-input k-panel">
        <label className="k-label" htmlFor="cs-chat">顾客的问题</label>
        <textarea id="cs-chat" className="k-input k-textarea cs-chat" value={chat} placeholder={PLACEHOLDER} onChange={(e) => setChat(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) { e.preventDefault(); generate(); } }} />
        <div className="cs-opts">
          <div className="k-field">
            <span className="k-label">语气</span>
            <div className="k-seg" role="radiogroup" aria-label="语气">
              {TONES.map((t) => <button key={t.id} role="radio" aria-checked={tone === t.id} className={tone === t.id ? 'on' : ''} onClick={() => setTone(t.id)}>{t.label}</button>)}
            </div>
          </div>
          <div className="k-field">
            <span className="k-label">候选条数</span>
            <div className="k-seg" role="radiogroup" aria-label="候选条数">
              {[1, 2, 3].map((n) => <button key={n} role="radio" aria-checked={count === n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>{n} 条</button>)}
            </div>
          </div>
          <button className="k-btn primary cs-go" disabled={busy || !chat.trim()} onClick={generate}>
            {busy ? <span className="k-spin" aria-hidden /> : <Sparkles size={15} />}{busy ? '生成中…' : '生成回复'}
          </button>
        </div>
        <span className="k-help">⌘/Ctrl + 回车 生成。回复只是草稿，请人工核对后再粘贴发送；本工具不会操作任何平台客户端。</span>
      </section>

      <section className="cs-out" aria-live="polite">
        {!draft && !busy && (
          <div className="cs-empty k-panel">
            <b>候选回复会显示在这里</b>
            <span className="k-muted">先在「知识库」里放好商品资料和售后政策，再把顾客的话粘贴进来。资料里查不到的内容，工具会提示「资料里没有」，不会让模型自己编。</span>
          </div>
        )}
        {draft && <Result draft={draft} flash={flash} />}
      </section>
    </div>
  );
}

function Highlighted({ c }: { c: Candidate }) {
  return <>{c.segs.map((s, i) => (s.hit ? <mark key={i} className="cs-hit" title="可能违规的绝对化用语（示例词表，以平台规则为准）">{s.text}</mark> : <span key={i}>{s.text}</span>))}</>;
}

function CopyBtn({ text, flash, primary }: { text: string; flash: (k: 'ok' | 'err', t: string) => void; primary?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button className={`k-btn${primary ? ' primary' : ''}`} onClick={async () => {
      if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1500); flash('ok', '已复制，去平台客服窗口粘贴发送即可'); }
      else flash('err', '复制失败：系统不允许访问剪贴板');
    }}>{done ? <Check size={14} /> : <Copy size={14} />}{done ? '已复制' : '复制'}</button>
  );
}

function Result({ draft, flash }: { draft: Draft; flash: (k: 'ok' | 'err', t: string) => void }) {
  return (
    <div className="cs-result">
      {draft.status === 'none' && (
        <div className="cs-none k-panel">
          <header><AlertTriangle size={18} /><b>资料里没有</b></header>
          <p>{draft.hits.length ? `查到了 ${draft.hits.length} 条相关资料，但不足以回答这个问题${draft.missing ? `（缺少：${draft.missing}）` : ''}。` : '知识库里没有找到和这句话相关的资料。'}
            请不要凭印象回答价格、库存、物流时效，可以先转人工或核实后再回复；也可以把这类问题补进「知识库」。</p>
          <h4>转人工话术（可直接用）</h4>
          {draft.transfers.map((t) => (
            <div key={t} className="cs-card plain"><p className="cs-text">{t}</p><div className="cs-card-ft"><span className="cs-grow" /><CopyBtn text={t} flash={flash} /></div></div>
          ))}
        </div>
      )}

      {draft.status === 'ok' && draft.candidates.map((c, i) => (
        <article key={i} className="cs-card k-panel">
          <header className="cs-card-hd"><b>候选 {i + 1}</b>
            <span className="cs-refs">{c.refs.length ? c.refs.map((h) => <span key={h.item.id} className="cs-ref" title={h.item.text}><BookOpen size={11} />{h.item.title}</span>) : <span className="cs-ref none">模型没有标明引用</span>}</span>
          </header>
          <p className="cs-text"><Highlighted c={c} /></p>
          {c.words.length > 0 && <div className="cs-warn"><ShieldAlert size={14} /><span>含可能违规的用语：<b>{c.words.join('、')}</b>。词表是示例，以平台规则为准，建议改掉再发。</span></div>}
          {c.numbers.length > 0 && <div className="cs-warn"><AlertTriangle size={14} /><span>数字 <b>{c.numbers.join('、')}</b> 在引用的资料和顾客原话里找不到，请核对价格、天数等是否正确。</span></div>}
          <footer className="cs-card-ft"><span className="cs-grow k-help">{c.text.length} 字</span><CopyBtn text={c.text} flash={flash} primary /></footer>
        </article>
      ))}

      {draft.hits.length > 0 && (
        <details className="cs-hits k-panel">
          <summary><Info size={14} />{draft.status === 'ok' ? '本次参考的资料' : '查到的相关资料'}（{draft.hits.length} 条）</summary>
          {draft.hits.map((h, i) => (
            <div key={h.item.id} className="cs-hit-row">
              <b>[{i + 1}] {h.item.title}</b><span className="cs-tag">{h.item.cat}{h.item.shop ? '' : ' · 通用'}</span>
              <p>{h.item.text}</p>
              <small className="k-muted">匹配词：{h.matched.join('、')}</small>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

// ---------- 知识库页 ----------

interface KbProps {
  kb: Kb; shop: string; hasSamples: boolean;
  onNew: () => void; onEdit: (i: Item) => void; onDelete: (i: Item) => void; onImport: () => void;
  onShop: (from: string | null) => void; onDeleteShop: () => void; onClearSamples: () => void;
}

function KbTab({ kb, shop, hasSamples, onNew, onEdit, onDelete, onImport, onShop, onDeleteShop, onClearSamples }: KbProps) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const scope = useMemo(() => itemsOfShop(kb, shop), [kb, shop]);
  const cats = useMemo(() => [...new Set(scope.map((i) => i.cat))], [scope]);
  const list = scope.filter((i) => (!cat || i.cat === cat) && (!q.trim() || `${i.title} ${i.text} ${i.keywords ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <div className="cs-kb">
      <div className="cs-kb-bar k-panel">
        <input className="k-input cs-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="在当前店铺的资料里搜索" aria-label="搜索资料" />
        <button className="k-btn primary" onClick={onNew}><Plus size={15} />新增</button>
        <button className="k-btn" onClick={onImport}><FileUp size={15} />导入</button>
        <button className="k-btn" onClick={() => onShop(null)}><FolderPlus size={15} />新建店铺</button>
        {shop && <button className="k-btn" onClick={() => onShop(shop)}><Pencil size={14} />改名</button>}
        {shop && <button className="k-btn" onClick={onDeleteShop}><Trash2 size={14} />删店铺</button>}
      </div>
      {hasSamples && (
        <div className="cs-tip"><span>现在是<b>内置示例资料</b>（虚构内容），可以直接改成你自己的，也可以导入 Markdown / Excel / 纯文本。</span><button className="k-link" onClick={onClearSamples}>删除全部示例</button></div>
      )}
      <div className="cs-chips">
        <button className={`k-chip${cat === '' ? ' on' : ''}`} onClick={() => setCat('')}>全部 {scope.length}</button>
        {cats.map((c) => <button key={c} className={`k-chip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>{c} {scope.filter((i) => i.cat === c).length}</button>)}
      </div>
      {!list.length ? (
        <div className="cs-empty k-panel"><b>{scope.length ? '没有找到匹配的资料' : '这个店铺还没有资料'}</b><span className="k-muted">点「新增」写第一条，或「导入」已有的文件，也可以把文件直接拖进窗口。</span></div>
      ) : (
        <div className="cs-items">
          {list.map((i) => (
            <article key={i.id} className="cs-item k-panel">
              <header><b className="k-ellipsis" title={i.title}>{i.title}</b><span className="cs-tag">{i.cat}</span>{!i.shop && <span className="cs-tag shared">通用</span>}{i.sample && <span className="cs-tag">示例</span>}</header>
              <p>{i.text}</p>
              {i.keywords && <small className="k-muted">关键词：{i.keywords}</small>}
              <footer>
                <button className="k-icon-btn" aria-label={`编辑 ${i.title}`} title="编辑" onClick={() => onEdit(i)}><Pencil size={14} /></button>
                <button className="k-icon-btn" aria-label={`删除 ${i.title}`} title="删除" onClick={() => onDelete(i)}><Trash2 size={14} /></button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemForm({ d, isNew, shops, cats, onCancel, onSave }: { d: Item; isNew: boolean; shops: string[]; cats: string[]; onCancel: () => void; onSave: (i: Item) => void }) {
  const [s, setS] = useState(d);
  const ok = s.text.trim().length > 0;
  return (
    <form className="cs-form" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(s); }} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ok) { e.preventDefault(); onSave(s); } }}>
      <h3>{isNew ? '新增资料' : '编辑资料'}</h3>
      <div className="cs-form-row">
        <Field label="属于哪个店铺" id="cs-i-shop"><select id="cs-i-shop" className="k-input" value={s.shop} onChange={(e) => setS({ ...s, shop: e.target.value })}>{shops.map((x) => <option key={x || '__s'} value={x}>{x || '通用（所有店铺）'}</option>)}</select></Field>
        <Field label="分类" id="cs-i-cat"><input id="cs-i-cat" className="k-input" list="cs-cats" value={s.cat} onChange={(e) => setS({ ...s, cat: e.target.value })} /><datalist id="cs-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field>
      </div>
      <Field label="标题（商品名或问题）" id="cs-i-title"><input id="cs-i-title" className="k-input" value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} placeholder="如：保温杯 A 款 / 能不能开发票" /></Field>
      <Field label="内容" id="cs-i-text" help="写清事实：价格、规格、时效、规则。工具只会依据这里写的内容回复。">
        <textarea id="cs-i-text" className="k-input k-textarea" rows={6} autoFocus value={s.text} onChange={(e) => setS({ ...s, text: e.target.value })} />
      </Field>
      <Field label="关键词（可选，用顿号隔开）" id="cs-i-kw" help="顾客可能用的别称，如「水杯、杯子」。顾客的话里出现这些词时会优先查到这条。">
        <input id="cs-i-kw" className="k-input" value={s.keywords ?? ''} onChange={(e) => setS({ ...s, keywords: e.target.value })} />
      </Field>
      <div className="cs-form-ft"><span className="k-help">⌘/Ctrl + 回车 保存</span><button type="button" className="k-btn" onClick={onCancel}>取消</button><button className="k-btn primary" type="submit" disabled={!ok}><Check size={15} />保存</button></div>
    </form>
  );
}

function Field({ label, id, help, children }: { label: string; id: string; help?: string; children: ReactNode }) {
  return <div className="k-field"><label className="k-label" htmlFor={id}>{label}</label>{children}{help && <span className="k-help">{help}</span>}</div>;
}

// ---------- 敏感词页 ----------

function WordsTab({ words, onSave }: { words: string[]; onSave: (w: string[]) => void }) {
  const [text, setText] = useState(words.join('\n'));
  useEffect(() => setText(words.join('\n')), [words]);
  const parsed = parseWordList(text);
  const changed = parsed.join('\n') !== words.join('\n');
  return (
    <div className="cs-words k-panel">
      <h3>敏感词表</h3>
      <p className="k-muted">候选回复里出现下面这些词时会标黄提醒。这是<b>示例词表，以平台规则为准</b>，请按你所在平台的最新规则增删。一行一个词，以 # 开头的行会被忽略。</p>
      <textarea className="k-input k-textarea cs-words-ta" aria-label="敏感词表" rows={12} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="cs-form-ft">
        <span className="k-help">共 {parsed.length} 个词</span>
        <button className="k-btn" onClick={() => setText(DEFAULT_WORDS.join('\n'))}>恢复示例词表</button>
        <button className="k-btn primary" disabled={!changed} onClick={() => onSave(parsed)}><Check size={15} />保存</button>
      </div>
    </div>
  );
}
