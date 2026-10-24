// Excel / CSV 读取：基于 exceljs（MIT）。读出第一个可见工作表为二维数组。
import ExcelJS from 'exceljs';

export type Cell = string | number | boolean | Date | null;

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
  }
  return String(v);
}

/** 文本解码：优先 UTF-8（去掉 BOM），不是合法 UTF-8 时按 GBK 解（Excel 中文版导出的 CSV 常见） */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('gbk').decode(bytes);
  }
}

/** 解析 CSV：支持引号、引号内换行与逗号、两个引号转义，自动识别逗号 / 制表符分隔 */
export function parseCsv(text: string): string[][] {
  const nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  const sep = first.split('\t').length > first.split(',').length ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export async function readGrid(bytes: Uint8Array, fileName: string): Promise<Cell[][]> {
  if (/\.(csv|txt)$/i.test(fileName)) return parseCsv(decodeText(bytes));
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw new Error('无法读取这个 Excel 文件。旧版 .xls 请先用 Excel 或 WPS 另存为 .xlsx');
  }
  const ws = wb.worksheets.find((w) => w.state === 'visible');
  if (!ws) throw new Error('Excel 里没有可见的工作表');
  const grid: Cell[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    grid[n - 1] = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
  });
  for (let i = 0; i < grid.length; i++) grid[i] ??= [];
  return grid;
}
