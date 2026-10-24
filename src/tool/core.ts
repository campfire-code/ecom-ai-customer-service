// 纯函数：检索知识库、解析聊天记录、组装提示词、容错解析模型回复、敏感词标注、数字核对。
// 不依赖界面和本机能力；大模型通过参数传入，测试时用假函数。
import { itemsOfShop, type Item, type Kb } from './kb';

// ---------- 语气 ----------

export type Tone = 'warm' | 'pro' | 'short';
export const TONES: { id: Tone; label: string; prompt: string }[] = [
  { id: 'warm', label: '亲切', prompt: '亲切自然，像和熟人聊天，可以适度用「亲」「哦」「～」，最多用一个表情' },
  { id: 'pro', label: '专业', prompt: '专业礼貌，用「您」，条理清楚，不用语气词和表情' },
  { id: 'short', label: '简短', prompt: '极简，一两句话说完，每条不超过 40 个字，先给结论' },
];

// ---------- 检索 ----------

const STOP_CHARS = new Set([...'的了吗么呢吧啊呀哦嗯我你您他她它是这那个请问想要能不可以怎什哪哈嘛和跟与或就都也还把被给让']);
const STOP_BIGRAMS = new Set(['有没', '没有', '还有', '时候', '多少', '可以', '怎么', '什么', '一下', '这个', '那个', '一个']);
/** 顾客的说法 → 资料里常见的说法（只扩展查询，不改资料） */
const SYNONYMS: Record<string, string[]> = {
  少钱: ['价格'], 便宜: ['价格', '优惠'], 贵了: ['价格'], 降价: ['价格', '优惠'],
  快递: ['物流', '发货'], 邮费: ['运费'], 包邮: ['运费'], 发货: ['物流'],
  退货: ['退换'], 换货: ['退换'], 退款: ['退换'], 有货: ['库存'], 没货: ['库存'], 缺货: ['库存'], 现货: ['库存'],
  尺码: ['尺寸'], 大小: ['尺寸'], 保修: ['质保'],
};

/** 单字说法（「能退吗」「贵了」）切不出双字词，单独映射到资料里常见的词 */
const SINGLE: Record<string, string[]> = { 退: ['退换', '退货'], 换: ['退换'], 钱: ['价格'], 贵: ['价格'], 价: ['价格'], 碎: ['破损'], 坏: ['破损'] };

/** 把一句话切成检索词：英文数字词 + 中文双字组（遇到「的、了、吗」等虚词断开） */
export function tokens(text: string): string[] {
  const out = new Set<string>();
  const s = text.toLowerCase();
  for (const m of s.matchAll(/[a-z0-9][a-z0-9.-]*/g)) if (m[0].length >= 2) out.add(m[0]);
  for (const run of s.matchAll(/[一-鿿]+/g)) {
    for (const piece of run[0].split('').reduce<string[]>((acc, ch) => {
      if (STOP_CHARS.has(ch)) acc.push('');
      else acc[acc.length - 1] += ch;
      return acc;
    }, [''])) {
      if (piece.length === 1) for (const x of SINGLE[piece] ?? []) out.add(x);
      for (let i = 0; i + 2 <= piece.length; i++) {
        const bg = piece.slice(i, i + 2);
        if (!STOP_BIGRAMS.has(bg)) out.add(bg);
      }
    }
  }
  for (const t of [...out]) for (const x of SYNONYMS[t] ?? []) out.add(x);
  return [...out];
}

export interface Hit {
  item: Item;
  score: number;
  /** 命中的检索词，用于告诉用户为什么选了这条 */
  matched: string[];
}

export const MIN_SCORE = 3;

export function searchKb(items: Item[], query: string, limit = 4): Hit[] {
  const qt = tokens(query);
  if (!qt.length) return [];
  const hits: Hit[] = [];
  for (const item of items) {
    const head = `${item.title} ${item.keywords ?? ''} ${item.cat}`.toLowerCase();
    const body = item.text.toLowerCase();
    let score = 0;
    const matched: string[] = [];
    for (const t of qt) {
      if (head.includes(t)) { score += 3; matched.push(t); }
      else if (body.includes(t)) { score += 1; matched.push(t); }
    }
    // 整个关键词出现在顾客的话里，说明很可能就是这条
    for (const k of (item.keywords ?? '').split(/[、,，;；\s]+/).filter((k) => k.length >= 2)) {
      if (query.toLowerCase().includes(k.toLowerCase())) { score += 4; matched.push(k); }
    }
    if (score >= MIN_SCORE) hits.push({ item, score, matched: [...new Set(matched)] });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------- 聊天记录 ----------

export interface Chat {
  /** 顾客说的每一句 */
  customer: string[];
  /** 是否识别到了「顾客：」「客服：」这样的发言人前缀 */
  structured: boolean;
  /** 用来检索的文字：识别到发言人时取顾客最后几句，否则取全部 */
  query: string;
}

const TIME = String.raw`(?:\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?\s*)?(?:\d{1,2}:\d{2}(?::\d{2})?\s*)?`;
const CUSTOMER = new RegExp(String.raw`^\s*\[?${TIME}\]?\s*(?:顾客|客户|买家|用户|消费者)\s*[:：]\s*(.*)$`);
const STAFF = new RegExp(String.raw`^\s*\[?${TIME}\]?\s*(?:客服|卖家|商家|店家|我)\s*[:：]\s*(.*)$`);

export function parseChat(raw: string): Chat {
  const lines = raw.replace(/\r/g, '').split('\n');
  const customer: string[] = [];
  let structured = false;
  let who: 'c' | 's' | null = null;
  for (const l of lines) {
    const c = l.match(CUSTOMER);
    const s = l.match(STAFF);
    if (c) { structured = true; who = 'c'; if (c[1].trim()) customer.push(c[1].trim()); }
    else if (s) { structured = true; who = 's'; }
    else if (who === 'c' && l.trim()) customer.push(l.trim());
  }
  if (!structured) {
    const all = raw.trim();
    return { customer: all ? [all] : [], structured: false, query: all };
  }
  return { customer, structured, query: customer.slice(-3).join('\n') };
}

// ---------- 提示词 ----------

export interface DraftOptions {
  chat: string;
  shop: string;
  tone: Tone;
  count: number;
}

type Msg = { role: 'system' | 'user'; content: string };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

export function buildMessages(o: DraftOptions, hits: Hit[]): Msg[] {
  const tone = TONES.find((t) => t.id === o.tone) ?? TONES[0];
  const refs = hits.map((h, i) => `[${i + 1}] ${h.item.title}（${h.item.cat}）\n${clip(h.item.text, 600)}`).join('\n\n');
  const system = [
    '你是电商店铺的客服助手，替人工客服起草回复，人工检查后才会发给顾客。',
    '严格遵守：',
    '1. 只能依据【资料】回答。资料没写的价格、库存、物流时效、赠品、保修期、优惠等，一律不要说，不要猜，不要编。',
    '2. 资料不足以回答顾客的问题时，grounded 填 false，replies 填空数组，missing 里写缺少什么信息。',
    '3. 不用「最低价」「全网最」「保证」「绝对」等绝对化用语，不承诺资料里没有的结果。',
    `4. 语气：${tone.prompt}。`,
    `5. 给出 ${o.count} 条候选回复，每条侧重点略有不同，每条都要能直接发给顾客，不要出现「根据资料」之类的字样。`,
    '6. 每条回复用 refs 标出引用了【资料】里的哪几条编号。',
    '只输出 JSON，格式：{"grounded":true,"missing":"","replies":[{"text":"回复内容","refs":[1]}]}',
  ].join('\n');
  const user = `【店铺】${o.shop || '（未选店铺）'}\n\n【资料】\n${refs}\n\n【顾客的聊天内容】\n${clip(o.chat.trim(), 1500)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// ---------- 容错解析模型回复 ----------

export interface ModelReply {
  grounded: boolean;
  missing: string;
  replies: { text: string; refs: number[] }[];
}

function extractJson(text: string): unknown {
  const t = text.trim();
  const tries = [t, t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')];
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1]);
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const s of tries) {
    try { return JSON.parse(s); } catch { /* 试下一种 */ }
  }
  throw new Error('不是 JSON');
}

const pick = (o: unknown, keys: string[]): unknown => {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of keys) if (k in (o as Record<string, unknown>)) return (o as Record<string, unknown>)[k];
  return undefined;
};
const asRefs = (v: unknown): number[] =>
  (Array.isArray(v) ? v : typeof v === 'string' || typeof v === 'number' ? [v] : [])
    .flatMap((x) => String(x).match(/\d+/g) ?? [])
    .map(Number)
    .filter((n) => n >= 1);
const asBool = (v: unknown, dflt: boolean) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return !/^(false|否|no|0|没有|无)$/i.test(v.trim());
  return dflt;
};

/** 解析模型回复：兼容代码块、前后多余文字、中文键名、纯文本分行；解析不出任何回复且不是「资料不足」时抛错 */
export function parseModelReply(text: string, count = 3): ModelReply {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch {
    // 模型没按 JSON 回：每个非空行当一条候选（去掉「1.」「候选1：」之类的编号）
    const lines = text.split('\n').map((l) => l.replace(/^\s*(?:候选\s*)?[\d一二三]+\s*[.、:：)）]\s*/, '').replace(/^[-*]\s*/, '').trim()).filter(Boolean);
    if (!lines.length) throw new Error('大模型返回的内容无法识别，请重试');
    return { grounded: true, missing: '', replies: lines.slice(0, count).map((t) => ({ text: t, refs: [] })) };
  }
  const root = Array.isArray(data) ? { replies: data } : data;
  const grounded = asBool(pick(root, ['grounded', '有依据', '依据']), true);
  const missing = String(pick(root, ['missing', '缺少', '缺失']) ?? '').trim();
  const list = pick(root, ['replies', 'reply', 'candidates', 'answers', '回复', '候选', '候选回复']);
  const arr = Array.isArray(list) ? list : typeof list === 'string' ? [list] : [];
  const replies = arr
    .map((x) => (typeof x === 'string' ? { text: x, refs: [] as number[] } : { text: String(pick(x, ['text', 'content', 'reply', '回复', '内容']) ?? ''), refs: asRefs(pick(x, ['refs', 'ref', 'references', '引用', '依据'])) }))
    .map((r) => ({ ...r, text: r.text.trim() }))
    .filter((r) => r.text);
  if (!replies.length && grounded) throw new Error('大模型没有返回回复，请重试');
  return { grounded: grounded && replies.length > 0, missing, replies: replies.slice(0, count) };
}

// ---------- 敏感词 ----------

/** 示例词表，仅供参考，以各平台最新规则为准；用户可在「敏感词」页自行增删 */
export const DEFAULT_WORDS = ['最低价', '全网最', '全网最低', '最便宜', '保证', '绝对', '百分之百', '100%', '第一', '最好', '最佳', '史上最', '永久', '万无一失', '包治', '根治', '无副作用'];

export function parseWordList(text: string): string[] {
  return [...new Set(text.split(/\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))];
}

export interface Seg {
  text: string;
  hit: boolean;
}

/** 把文字按敏感词切成片段，命中的标 hit；重叠的词合并成一段 */
export function markWords(text: string, words: string[]): Seg[] {
  const low = text.toLowerCase();
  const spans: [number, number][] = [];
  for (const w of words.filter(Boolean)) {
    const lw = w.toLowerCase();
    for (let i = low.indexOf(lw); i >= 0; i = low.indexOf(lw, i + 1)) spans.push([i, i + lw.length]);
  }
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const segs: Seg[] = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) segs.push({ text: text.slice(pos, a), hit: false });
    segs.push({ text: text.slice(a, b), hit: true });
    pos = b;
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), hit: false });
  return segs.length ? segs : [{ text, hit: false }];
}

export const hitWords = (segs: Seg[]) => [...new Set(segs.filter((s) => s.hit).map((s) => s.text))];

// ---------- 数字核对 ----------

/** 回复里出现、但引用的资料和顾客原话里都没有的数字（价格、天数等），提醒人工核对，防止模型编造 */
export function unsupportedNumbers(reply: string, sources: string[]): string[] {
  const src = sources.join('\n');
  const nums = reply.match(/\d+(?:\.\d+)?/g) ?? [];
  return [...new Set(nums.filter((n) => !src.includes(n)))];
}

// ---------- 总流程 ----------

export type Llm = (messages: Msg[], opts?: { json?: boolean; temperature?: number }) => Promise<string>;

export interface Candidate {
  text: string;
  refs: Hit[];
  segs: Seg[];
  words: string[];
  numbers: string[];
}

export interface Draft {
  /** ok：有依据；none：资料里没有 */
  status: 'ok' | 'none';
  query: string;
  hits: Hit[];
  candidates: Candidate[];
  /** 资料里没有时给出的转人工话术 */
  transfers: string[];
  missing: string;
}

const TRANSFER: Record<Tone, string[]> = {
  warm: [
    '亲，这个问题我这边暂时没有查到准确的信息，怕给您说错，我帮您转给负责的同事确认，请稍等一下哦～',
    '亲，这个我需要和同事核实一下再回复您，不想随便说个数耽误您，稍等我一会儿～',
  ],
  pro: [
    '您好，这个问题我这边暂时没有查到准确的资料，为避免给您错误的信息，已为您转接专人核实，请稍候。',
    '您好，该问题需要进一步核实后才能答复您，我马上联系负责的同事，稍后回复您。',
  ],
  short: ['这个我需要核实，帮您转专人处理，请稍等。', '暂时没查到准确信息，转同事确认后回复您。'],
};
export const transferScripts = (tone: Tone) => TRANSFER[tone];

export function checkCandidates(m: ModelReply, hits: Hit[], chat: string, words: string[]): Candidate[] {
  return m.replies.map((r) => {
    const refs = r.refs.map((n) => hits[n - 1]).filter((h): h is Hit => !!h);
    const segs = markWords(r.text, words);
    const src = [chat, ...(refs.length ? refs : hits).flatMap((h) => [h.item.title, h.item.text])];
    return { text: r.text, refs: [...new Set(refs)], segs, words: hitWords(segs), numbers: unsupportedNumbers(r.text, src) };
  });
}

/** 检索 → （有依据才）调用大模型 → 解析 → 标注。资料里没有时不调用大模型，直接给转人工话术。 */
export async function draftReplies(kb: Kb, o: DraftOptions, words: string[], llm: Llm): Promise<Draft> {
  const chat = parseChat(o.chat);
  const none = (hits: Hit[], missing: string): Draft => ({ status: 'none', query: chat.query, hits, candidates: [], transfers: transferScripts(o.tone), missing });
  if (!chat.query.trim()) throw new Error('请先粘贴顾客的问题');
  const hits = searchKb(itemsOfShop(kb, o.shop), chat.query);
  if (!hits.length) return none([], '');
  const reply = parseModelReply(await llm(buildMessages(o, hits), { json: true, temperature: 0.5 }), o.count);
  if (!reply.grounded) return none(hits, reply.missing);
  return { status: 'ok', query: chat.query, hits, candidates: checkCandidates(reply, hits, o.chat, words), transfers: [], missing: '' };
}
