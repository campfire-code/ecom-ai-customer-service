import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORDS, buildMessages, draftReplies, hitWords, markWords, parseChat, parseModelReply, parseWordList, searchKb, tokens, transferScripts, unsupportedNumbers, type Hit, type Llm,
} from './core';
import { SHARED, itemsOfShop, type Item } from './kb';
import { DEMO_SHOP, sampleKb } from './samples';

const kb = sampleKb();
const shopItems = itemsOfShop(kb, DEMO_SHOP);
const top = (q: string) => searchKb(shopItems, q).map((h) => h.item.id.replace('sample-', ''));

describe('检索', () => {
  it('分词：虚词断开，同义词扩展', () => {
    const t = tokens('这个保温杯多少钱啊');
    expect(t).toContain('保温');
    expect(t).toContain('价格');
    expect(t.some((x) => x.includes('啊'))).toBe(false);
    expect(tokens('SKU12 的尺码')).toEqual(expect.arrayContaining(['sku12', '尺码', '尺寸']));
  });
  it('问价格能找到商品资料', () => {
    expect(top('你好，保温杯多少钱')[0]).toBe('a1');
  });
  it('问退货能找到通用的售后政策，也会带上本店资料', () => {
    expect(top('买了不喜欢可以退货吗')[0]).toBe('g1');
  });
  it('单字说法：「买回去不喜欢能退吗」也能查到退换货规则', () => {
    expect(top('买回去不喜欢能退吗')).toContain('g1');
  });
  it('关键词字段：顾客说「碎了」命中破损条目', () => {
    expect(top('收到的时候杯子碎了')).toContain('g2');
  });
  it('只引用本店和通用资料，不串到别的店铺', () => {
    expect(top('坚果过敏吗')).not.toContain('b1');
    const other = itemsOfShop(kb, '示例店铺 · 零食');
    expect(searchKb(other, '坚果过敏吗')[0].item.id).toBe('sample-b1');
    expect(itemsOfShop(kb, DEMO_SHOP).every((i) => i.shop === DEMO_SHOP || i.shop === SHARED)).toBe(true);
  });
  it('资料里没有的问题检索不到', () => {
    expect(top('这个能送给外国朋友吗，有没有英文说明书')).toEqual([]);
    expect(top('')).toEqual([]);
  });
  it('命中词会返回，便于告诉用户为什么选这条', () => {
    expect(searchKb(shopItems, '保温杯多少钱')[0].matched).toContain('保温');
  });
});

describe('聊天记录', () => {
  it('识别顾客 / 客服前缀，只取顾客最后几句检索', () => {
    const c = parseChat('顾客：在吗\n客服：在的亲\n顾客：保温杯多少钱\n多久发货\n客服：稍等');
    expect(c.structured).toBe(true);
    expect(c.customer).toEqual(['在吗', '保温杯多少钱', '多久发货']);
    expect(c.query).toBe('在吗\n保温杯多少钱\n多久发货');
  });
  it('带时间的行也能识别', () => {
    const c = parseChat('2026-10-23 10:21:33 顾客：能开发票吗\n10:22 客服：可以');
    expect(c.customer).toEqual(['能开发票吗']);
  });
  it('没有前缀时整段当顾客的话', () => {
    const c = parseChat('  这个怎么退货  ');
    expect(c).toEqual({ customer: ['这个怎么退货'], structured: false, query: '这个怎么退货' });
  });
});

const hits: Hit[] = searchKb(shopItems, '保温杯多少钱');

describe('提示词', () => {
  it('包含规则、语气、资料编号和顾客原话', () => {
    const m = buildMessages({ chat: '顾客：保温杯多少钱', shop: DEMO_SHOP, tone: 'short', count: 2 }, hits);
    expect(m[0].content).toContain('不要猜，不要编');
    expect(m[0].content).toContain('极简');
    expect(m[0].content).toContain('给出 2 条');
    expect(m[1].content).toContain('[1] 保温杯 A 款');
    expect(m[1].content).toContain('顾客：保温杯多少钱');
  });
});

describe('解析模型回复', () => {
  it('标准 JSON', () => {
    const r = parseModelReply('{"grounded":true,"missing":"","replies":[{"text":"59 元哦","refs":[1]},{"text":"日常价 59 元","refs":["1"]}]}');
    expect(r.replies).toEqual([{ text: '59 元哦', refs: [1] }, { text: '日常价 59 元', refs: [1] }]);
  });
  it('代码块 + 前后废话', () => {
    const r = parseModelReply('好的，结果如下：\n```json\n{"replies":[{"text":"A","refs":[2]}]}\n```\n希望有帮助');
    expect(r.replies[0]).toEqual({ text: 'A', refs: [2] });
  });
  it('中文键名、引用写成 [1][2]、字符串列表', () => {
    const r = parseModelReply('{"有依据":"是","回复":[{"内容":"X","引用":"[1][2]"},"Y"]}');
    expect(r.replies).toEqual([{ text: 'X', refs: [1, 2] }, { text: 'Y', refs: [] }]);
  });
  it('超过条数截断', () => {
    expect(parseModelReply('{"replies":["a","b","c","d"]}', 2).replies).toHaveLength(2);
  });
  it('资料不足：grounded=false，不要求有回复', () => {
    const r = parseModelReply('{"grounded":false,"missing":"没有赠品信息","replies":[]}');
    expect(r).toEqual({ grounded: false, missing: '没有赠品信息', replies: [] });
    expect(parseModelReply('{"grounded":"否","replies":[]}').grounded).toBe(false);
  });
  it('不是 JSON：按行当候选，去掉编号', () => {
    const r = parseModelReply('1. 亲，59 元\n2、日常价 59 元哦');
    expect(r.replies.map((x) => x.text)).toEqual(['亲，59 元', '日常价 59 元哦']);
  });
  it('JSON 里没有回复且声称有依据：报错', () => {
    expect(() => parseModelReply('{"grounded":true,"replies":[]}')).toThrow('没有返回回复');
    expect(() => parseModelReply('   ')).toThrow();
  });
});

describe('敏感词标注', () => {
  it('标出命中并合并重叠词', () => {
    const segs = markWords('这是全网最低价，保证正品', DEFAULT_WORDS);
    expect(segs.filter((s) => s.hit).map((s) => s.text)).toEqual(['全网最低价', '保证']);
    expect(segs.map((s) => s.text).join('')).toBe('这是全网最低价，保证正品');
  });
  it('没有命中时返回整段；大小写不敏感', () => {
    expect(markWords('您好', DEFAULT_WORDS)).toEqual([{ text: '您好', hit: false }]);
    expect(hitWords(markWords('100%好评 ABC', ['abc', '100%']))).toEqual(['100%', 'ABC']);
  });
  it('词表解析：去空行、注释、重复', () => {
    expect(parseWordList('# 示例\n最低价\n\n 保证 \n最低价')).toEqual(['最低价', '保证']);
  });
  it('示例转人工话术自身不含敏感词', () => {
    for (const t of ['warm', 'pro', 'short'] as const) for (const s of transferScripts(t)) expect(hitWords(markWords(s, DEFAULT_WORDS))).toEqual([]);
  });
});

describe('数字核对', () => {
  it('资料和顾客原话里没有的数字被找出来', () => {
    expect(unsupportedNumbers('59 元，3 天内到货', ['日常价 59 元'])).toEqual(['3']);
    expect(unsupportedNumbers('日常价 59 元', ['日常价 59 元'])).toEqual([]);
  });
});

describe('总流程（假大模型）', () => {
  const words = DEFAULT_WORDS;
  const opts = { chat: '顾客：保温杯多少钱？能开发票吗', shop: DEMO_SHOP, tone: 'warm' as const, count: 3 };

  it('有依据：生成候选，标出引用、敏感词、可疑数字', async () => {
    const calls: unknown[] = [];
    const llm: Llm = async (m, o) => {
      calls.push([m, o]);
      return '{"grounded":true,"replies":[{"text":"亲，日常价 59 元，全网最低价哦～可以开发票","refs":[1,2]},{"text":"59 元，48 小时内一定到货","refs":[1]}]}';
    };
    const d = await draftReplies(kb, opts, words, llm);
    expect(d.status).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(d.candidates).toHaveLength(2);
    expect(d.candidates[0].refs.map((h) => h.item.title)).toContain('保温杯 A 款');
    expect(d.candidates[0].words).toEqual(['全网最低价']);
    expect(d.candidates[0].numbers).toEqual([]);
    expect(d.candidates[1].numbers).toEqual(['48']); // 只引用了商品条目，发货时间不在其中
    expect(d.candidates[1].words).toEqual([]);
  });
  it('回复里的数字资料里没有：提示核对', async () => {
    const llm: Llm = async () => '{"replies":[{"text":"现在只要 39 元","refs":[1]}]}';
    const d = await draftReplies(kb, opts, words, llm);
    expect(d.candidates[0].numbers).toEqual(['39']);
  });
  it('检索不到资料：不调用大模型，提示资料里没有并给转人工话术', async () => {
    let called = false;
    const llm: Llm = async () => ((called = true), '{}');
    const d = await draftReplies(kb, { ...opts, chat: '顾客：能不能送英文说明书' }, words, llm);
    expect(called).toBe(false);
    expect(d.status).toBe('none');
    expect(d.candidates).toEqual([]);
    expect(d.transfers).toEqual(transferScripts('warm'));
  });
  it('模型说资料不足：丢掉模型可能编的回复，改给转人工话术', async () => {
    const llm: Llm = async () => '{"grounded":false,"missing":"没有赠品信息","replies":[{"text":"送一个杯刷","refs":[1]}]}';
    const d = await draftReplies(kb, { ...opts, chat: '顾客：保温杯有赠品吗', tone: 'pro' }, words, llm);
    expect(d.status).toBe('none');
    expect(d.missing).toBe('没有赠品信息');
    expect(d.candidates).toEqual([]);
    expect(d.transfers).toEqual(transferScripts('pro'));
  });
  it('空输入报错；大模型报错原样抛出', async () => {
    await expect(draftReplies(kb, { ...opts, chat: '  ' }, words, async () => '')).rejects.toThrow('请先粘贴');
    await expect(draftReplies(kb, opts, words, async () => { throw new Error('大模型调用失败（401）'); })).rejects.toThrow('401');
  });
});

describe('条目类型', () => {
  it('示例库的条目 id 不重复', () => {
    const ids = kb.items.map((i: Item) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
