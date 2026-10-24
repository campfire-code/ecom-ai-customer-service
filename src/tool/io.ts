// 导入流程：只依赖传入的读文件函数，便于用内存文件系统测试。
import { fromRows, mergeImport, parseText, type Kb, type Parsed } from './kb';
import { decodeText, readGrid } from './xlsx';

export const IMPORT_EXT = ['md', 'markdown', 'txt', 'xlsx', 'csv'];
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function parseFile(name: string, bytes: Uint8Array, shop: string): Promise<Parsed> | Parsed {
  const cat = name.replace(/\.[^.]+$/, '') || '导入';
  if (/\.(md|markdown|txt)$/i.test(name)) return parseText(decodeText(bytes), cat, shop);
  return readGrid(bytes, name).then((g) => fromRows(g, cat, shop));
}

/** 读一个文件并合并进知识库，返回新库与给用户看的一句话。shop 是没有「店铺」列时归入的店铺（空 = 通用） */
export async function importFile(read: (path: string) => Promise<Uint8Array>, kb: Kb, path: string, shop: string): Promise<{ kb: Kb; message: string }> {
  const name = baseName(path);
  const parsed = await parseFile(name, await read(path), shop);
  if (!parsed.items.length) throw new Error(`「${name}」里没有找到资料。Markdown 请用「## 标题」分条，Excel 请有「标题」「内容」两列`);
  const r = mergeImport(kb, parsed);
  const extra = [r.dup ? `${r.dup} 条重复已跳过` : '', parsed.skipped ? `${parsed.skipped} 行没有内容已跳过` : ''].filter(Boolean).join('，');
  return { kb: r.kb, message: `从「${name}」导入 ${r.added} 条资料${extra ? '（' + extra + '）' : ''}` };
}
