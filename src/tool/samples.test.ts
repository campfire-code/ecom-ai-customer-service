// 用 samples/ 里的真实文件走一遍「导入 → 检索」，README 的验收用例以此为准
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { draftReplies, parseChat, searchKb, transferScripts, type Llm } from './core';
import { importFile } from './io';
import { emptyKb, itemsOfShop } from './kb';

const read = async (p: string) => new Uint8Array(readFileSync(p));
const SHOP = '示例店铺 · 家居';

async function load(files: string[]) {
  let kb = emptyKb();
  const msgs: string[] = [];
  for (const f of files) {
    const r = await importFile(read, kb, `samples/${f}`, SHOP);
    kb = r.kb;
    msgs.push(r.message);
  }
  return { kb, msgs };
}

describe('samples 验收用例', () => {
  it('四种格式都能导入', async () => {
    const { msgs } = await load(['示例资料.md', '示例问答.txt', '示例资料.csv', '示例资料.xlsx']);
    expect(msgs).toEqual([
      '从「示例资料.md」导入 4 条资料',
      '从「示例问答.txt」导入 2 条资料',
      '从「示例资料.csv」导入 3 条资料',
      '从「示例资料.xlsx」导入 1 条资料（2 条重复已跳过）',
    ]);
  });
  it('聊天记录里问马克杯价格：查到 B 款；问刻字：资料里没有', async () => {
    const { kb } = await load(['示例资料.md', '示例问答.txt']);
    const chat = parseChat(readFileSync('samples/示例聊天记录.txt', 'utf8'));
    expect(chat.customer).toEqual(['你好，在吗', '那个陶瓷马克杯 B 款多少钱呀？', '可以放微波炉吗']);
    expect(searchKb(itemsOfShop(kb, SHOP), chat.query)[0].item.title).toBe('陶瓷马克杯 B 款');
    const llm: Llm = async () => { throw new Error('不应调用大模型'); };
    const d = await draftReplies(kb, { chat: readFileSync('samples/示例聊天-资料里没有.txt', 'utf8'), shop: SHOP, tone: 'warm', count: 3 }, [], llm);
    expect(d.status).toBe('none');
    expect(d.transfers).toEqual(transferScripts('warm'));
  });
});
