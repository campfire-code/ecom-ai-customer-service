// 知识库：数据结构、导入解析（Markdown / 纯文本 / Excel 表格）、合并去重。纯函数，不依赖界面和本机能力。

export interface Item {
  id: string;
  /** 店铺名；空字符串 = 通用（所有店铺都能引用） */
  shop: string;
  /** 分类，如 商品资料 / 售后政策 / 常见问答 */
  cat: string;
  title: string;
  text: string;
  /** 额外关键词，用顿号或逗号隔开，帮助检索（如顾客常说的别称） */
  keywords?: string;
  sample?: boolean;
}

export interface Kb {
  version: 1;
  shops: string[];
  items: Item[];
}

export const CATS = ['商品资料', '售后政策', '常见问答', '物流发货', '活动优惠'];
export const SHARED = '';

let seq = 0;
export const newId = () => `k${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const emptyKb = (): Kb => ({ version: 1, shops: [], items: [] });

export function validKb(v: unknown): Kb | null {
  const o = v as Partial<Kb> | null;
  if (!o || !Array.isArray(o.items) || !Array.isArray(o.shops)) return null;
  const items = o.items.filter((i): i is Item => !!i && typeof i.id === 'string' && typeof i.text === 'string' && typeof i.title === 'string' && typeof i.shop === 'string' && typeof i.cat === 'string');
  return { version: 1, shops: o.shops.filter((s): s is string => typeof s === 'string' && !!s), items };
}

const clean = (s: unknown) => String(s ?? '').replace(/\r/g, '').trim();

/** 某个店铺能引用的条目：本店 + 通用 */
export const itemsOfShop = (kb: Kb, shop: string) => kb.items.filter((i) => i.shop === shop || i.shop === SHARED);

export function upsertItem(kb: Kb, it: Item): Kb {
  const items = kb.items.some((x) => x.id === it.id) ? kb.items.map((x) => (x.id === it.id ? it : x)) : [...kb.items, it];
  const shops = it.shop && !kb.shops.includes(it.shop) ? [...kb.shops, it.shop] : kb.shops;
  return { ...kb, items, shops };
}
export const removeItem = (kb: Kb, id: string): Kb => ({ ...kb, items: kb.items.filter((i) => i.id !== id) });
export const removeSamples = (kb: Kb): Kb => ({ ...kb, items: kb.items.filter((i) => !i.sample) });

export function addShop(kb: Kb, name: string): Kb {
  const n = name.trim();
  return n && !kb.shops.includes(n) ? { ...kb, shops: [...kb.shops, n] } : kb;
}
export function renameShop(kb: Kb, from: string, to: string): Kb {
  const n = to.trim();
  if (!n || n === from || kb.shops.includes(n)) return kb;
  return { ...kb, shops: kb.shops.map((s) => (s === from ? n : s)), items: kb.items.map((i) => (i.shop === from ? { ...i, shop: n } : i)) };
}
/** 删除店铺同时删除只属于该店铺的条目 */
export const removeShop = (kb: Kb, name: string): Kb => ({ ...kb, shops: kb.shops.filter((s) => s !== name), items: kb.items.filter((i) => i.shop !== name) });

// ---------- 导入 ----------

export interface Parsed {
  items: Omit<Item, 'id'>[];
  skipped: number;
}

const QA_Q = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:问|Q|q|提问)(?:\*\*)?\s*[:：]\s*(.*)$/;
const QA_A = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:答|A|a|回答)(?:\*\*)?\s*[:：]\s*(.*)$/;

/** 把一段正文拆成「标题 + 内容」：Q/A 格式取问题当标题；否则第一行较短时当标题 */
function splitBlock(block: string): { title: string; text: string } | null {
  const lines = block.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l, i, a) => l.trim() || (i > 0 && i < a.length - 1));
  if (!lines.length) return null;
  const q = lines[0].match(QA_Q);
  if (q) {
    const rest = lines.slice(1);
    const a = rest[0]?.match(QA_A);
    const body = a ? [a[1], ...rest.slice(1)] : rest;
    const text = clean(body.join('\n'));
    return text ? { title: clean(q[1]), text } : null;
  }
  const first = lines[0].trim();
  if (lines.length === 1) return { title: first.slice(0, 20), text: first };
  if (first.length <= 30) return { title: first.replace(/[:：]$/, ''), text: clean(lines.slice(1).join('\n')) };
  return { title: first.slice(0, 20), text: clean(lines.join('\n')) };
}

/** 解析 Markdown 或纯文本。有「## 标题」时：「# 标题」是分类、「## 标题」是条目；
 *  没有时：「# 标题」是条目；纯文本按空行分段，支持「问：… 答：…」。 */
export function parseText(raw: string, defaultCat: string, shop = SHARED): Parsed {
  const text = raw.replace(/\r/g, '').replace(/^﻿/, '');
  const lines = text.split('\n');
  const heads = lines.filter((l) => /^#{1,6}\s+\S/.test(l));
  const out: Omit<Item, 'id'>[] = [];
  let skipped = 0;
  const push = (cat: string, title: string, body: string) => {
    const t = clean(body);
    if (!t) { skipped++; return; }
    out.push({ shop, cat: cat || defaultCat, title: clean(title) || t.slice(0, 20), text: t });
  };
  if (heads.length) {
    const hasH2 = heads.some((l) => /^#{2}\s/.test(l));
    const entryRe = hasH2 ? /^#{2,6}\s+(.*)$/ : /^#{1,6}\s+(.*)$/;
    let cat = defaultCat;
    let title = '';
    let body: string[] = [];
    let open = false;
    const flush = () => { if (open) push(cat, title, body.join('\n')); open = false; body = []; };
    for (const l of lines) {
      const m = l.match(entryRe);
      const c = hasH2 ? l.match(/^#\s+(.*)$/) : null;
      if (c) { flush(); cat = clean(c[1]) || defaultCat; }
      else if (m) { flush(); title = m[1].replace(/[#\s]+$/, ''); open = true; }
      else if (open) body.push(l);
    }
    flush();
    return { items: out, skipped };
  }
  for (const block of text.split(/\n\s*\n/)) {
    if (!block.trim()) continue;
    // 一段里有多组 问：/答：时，按「问」再拆
    const parts = block.split(/\n(?=\s*(?:[-*]\s*)?(?:\*\*)?(?:问|Q|q|提问)(?:\*\*)?\s*[:：])/);
    for (const p of parts) {
      const s = splitBlock(p);
      if (s) push(defaultCat, s.title, s.text); else skipped++;
    }
  }
  return { items: out, skipped };
}

const HEAD_KEYS: Record<'shop' | 'cat' | 'title' | 'text' | 'keywords', RegExp> = {
  shop: /^(店铺|店名|店铺名称?)$/,
  cat: /^(分类|类别|类型|类目)$/,
  title: /^(标题|问题|名称|主题|商品名称?|条目)$/,
  text: /^(内容|回答|答案|资料|说明|详情|回复|正文)$/,
  keywords: /^(关键词|关键字|别称|标签)$/,
};

/** Excel / CSV 二维表：按表头名识别 店铺 / 分类 / 标题 / 内容 / 关键词；认不出表头时按「分类、标题、内容」三列处理 */
export function fromRows(grid: unknown[][], defaultCat = '导入', shop = SHARED): Parsed {
  const rows = grid.map((r) => (r ?? []).map((c) => clean(c instanceof Date ? c.toISOString().slice(0, 10) : c)));
  const first = rows.findIndex((r) => r.some(Boolean));
  if (first < 0) return { items: [], skipped: 0 };
  const idx: Partial<Record<keyof typeof HEAD_KEYS, number>> = {};
  rows[first].forEach((h, i) => {
    for (const k of Object.keys(HEAD_KEYS) as (keyof typeof HEAD_KEYS)[]) if (idx[k] === undefined && HEAD_KEYS[k].test(h.replace(/\s/g, ''))) idx[k] = i;
  });
  const hasHead = idx.text !== undefined;
  if (!hasHead) Object.assign(idx, { cat: 0, title: 1, text: 2 });
  const out: Omit<Item, 'id'>[] = [];
  let skipped = 0;
  for (const r of rows.slice(hasHead ? first + 1 : first)) {
    if (!r.some(Boolean)) continue;
    const text = r[idx.text!] ?? '';
    if (!text) { skipped++; continue; }
    const kw = idx.keywords !== undefined ? r[idx.keywords] : '';
    out.push({
      shop: idx.shop !== undefined && r[idx.shop] ? r[idx.shop] : shop,
      cat: (idx.cat !== undefined && r[idx.cat]) || defaultCat,
      title: (idx.title !== undefined && r[idx.title]) || text.slice(0, 20),
      text,
      ...(kw ? { keywords: kw } : {}),
    });
  }
  return { items: out, skipped };
}

const dupKey = (i: Pick<Item, 'shop' | 'title' | 'text'>) => `${i.shop}|${i.title}|${i.text}`;

export function mergeImport(kb: Kb, p: Parsed): { kb: Kb; added: number; dup: number } {
  const seen = new Set(kb.items.map(dupKey));
  const items = [...kb.items];
  const shops = [...kb.shops];
  let added = 0;
  let dup = 0;
  for (const i of p.items) {
    const k = dupKey(i);
    if (seen.has(k)) { dup++; continue; }
    seen.add(k);
    items.push({ ...i, id: newId() });
    if (i.shop && !shops.includes(i.shop)) shops.push(i.shop);
    added++;
  }
  return { kb: added ? { ...kb, items, shops } : kb, added, dup };
}
