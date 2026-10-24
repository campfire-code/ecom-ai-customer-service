import { describe, expect, it } from 'vitest';
import { IMPORT_EXT, importFile } from './io';
import { addShop, emptyKb, fromRows, itemsOfShop, mergeImport, parseText, removeShop, renameShop, upsertItem, validKb } from './kb';
import { sampleKb } from './samples';
import { searchKb } from './core';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('导入 Markdown', () => {
  const md = `# 售后政策\n\n## 退换货\n签收后 7 天内可申请。\n运费规则见下。\n\n## 发票\n可开电子发票。\n\n# 商品资料\n## 杯子\n容量 500ml\n`;
  it('# 是分类，## 是条目', () => {
    const p = parseText(md, '默认');
    expect(p.items.map((i) => [i.cat, i.title, i.text])).toEqual([
      ['售后政策', '退换货', '签收后 7 天内可申请。\n运费规则见下。'],
      ['售后政策', '发票', '可开电子发票。'],
      ['商品资料', '杯子', '容量 500ml'],
    ]);
  });
  it('只有一级标题时，每个标题是一条', () => {
    const p = parseText('# 发货\n48 小时内\n# 发票\n可开', '资料');
    expect(p.items.map((i) => [i.cat, i.title])).toEqual([['资料', '发货'], ['资料', '发票']]);
  });
  it('没有正文的标题计入跳过', () => {
    expect(parseText('## 空\n\n## 有\n内容', 'x')).toMatchObject({ skipped: 1, items: [{ title: '有' }] });
  });
});

describe('导入纯文本', () => {
  it('问：/答： 格式', () => {
    const p = parseText('问：能开发票吗\n答：可以\n补充一行\n\n问：发什么快递？\n答：默认合作快递', '问答');
    expect(p.items.map((i) => [i.title, i.text])).toEqual([['能开发票吗', '可以\n补充一行'], ['发什么快递？', '默认合作快递']]);
  });
  it('一段里连续多个 Q/A 也拆开', () => {
    const p = parseText('Q: 甲\nA: 乙\nQ: 丙\nA: 丁', 'x');
    expect(p.items.map((i) => i.title)).toEqual(['甲', '丙']);
  });
  it('普通段落：短首行当标题，否则取前 20 字', () => {
    const p = parseText('发货时间：\n48 小时内发货\n\n单行资料一条', 'x');
    expect(p.items[0]).toMatchObject({ title: '发货时间', text: '48 小时内发货' });
    expect(p.items[1]).toMatchObject({ title: '单行资料一条', text: '单行资料一条' });
  });
});

describe('导入表格', () => {
  it('按表头识别列（顺序任意），含店铺与关键词', () => {
    const p = fromRows([['内容', '店铺', '问题', '关键词', '分类'], ['48 小时发货', '甲店', '多久发货', '发货、快递', '物流'], ['', '', '', '', ''], ['', '甲店', '没内容', '', '']]);
    expect(p.items).toEqual([{ shop: '甲店', cat: '物流', title: '多久发货', text: '48 小时发货', keywords: '发货、快递' }]);
    expect(p.skipped).toBe(1);
  });
  it('认不出表头时按 分类、标题、内容 三列', () => {
    const p = fromRows([['售后', '退货', '7 天内可退']], '导入', '乙店');
    expect(p.items).toEqual([{ shop: '乙店', cat: '售后', title: '退货', text: '7 天内可退' }]);
  });
  it('没有分类列时用默认分类，标题缺失取内容前 20 字', () => {
    const p = fromRows([['标题', '内容'], ['', '这是一条没有标题的资料']], '文件名');
    expect(p.items[0]).toMatchObject({ cat: '文件名', title: '这是一条没有标题的资料' });
  });
});

describe('合并与店铺管理', () => {
  it('重复条目跳过，新店铺自动加入', () => {
    const p = parseText('## 甲\n内容', '分类', '新店');
    const a = mergeImport(emptyKb(), p);
    expect(a).toMatchObject({ added: 1, dup: 0 });
    expect(a.kb.shops).toEqual(['新店']);
    expect(mergeImport(a.kb, p)).toMatchObject({ added: 0, dup: 1 });
  });
  it('改名带着条目走；删除店铺同时删除该店条目，通用条目保留', () => {
    let kb = sampleKb();
    const n = kb.items.length;
    kb = renameShop(kb, '示例店铺 · 零食', '零食店');
    expect(itemsOfShop(kb, '零食店').some((i) => i.id === 'sample-b1')).toBe(true);
    kb = removeShop(kb, '零食店');
    expect(kb.items.length).toBe(n - 2);
    expect(kb.items.some((i) => i.shop === '')).toBe(true);
    expect(addShop(kb, ' 新 ').shops).toContain('新');
  });
  it('新增条目带新店铺名时店铺列表同步；校验拒绝坏数据', () => {
    const kb = upsertItem(emptyKb(), { id: 'x', shop: '丙店', cat: '常见问答', title: 't', text: 'c' });
    expect(kb.shops).toEqual(['丙店']);
    expect(validKb({ items: 'x', shops: [] })).toBeNull();
    expect(validKb(JSON.parse(JSON.stringify(sampleKb())))?.items).toHaveLength(sampleKb().items.length);
  });
});

describe('导入流程（内存文件）', () => {
  const read = async (p: string) => bytes(p.endsWith('.md') ? '## 赠品\n买两件送杯刷一个\n' : '内容\n没有表头也没有二维结构');
  it('导入 md 后能被检索到', async () => {
    const r = await importFile(read, emptyKb(), '/a/活动.md', '甲店');
    expect(r.message).toBe('从「活动.md」导入 1 条资料');
    expect(searchKb(r.kb.items, '有赠品吗')[0].item.title).toBe('赠品');
    expect((await importFile(read, r.kb, '/a/活动.md', '甲店')).message).toBe('从「活动.md」导入 0 条资料（1 条重复已跳过）');
  });
  it('没有内容时报错，扩展名清单包含常见格式', async () => {
    await expect(importFile(async () => bytes('  \n'), emptyKb(), 'C:\\x\\空.txt', '')).rejects.toThrow('没有找到资料');
    expect(IMPORT_EXT).toEqual(expect.arrayContaining(['md', 'txt', 'xlsx', 'csv']));
  });
});
