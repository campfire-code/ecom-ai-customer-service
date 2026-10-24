// 生成 samples/ 里的 Excel 示例（只在设置了 MAKE_SAMPLES=1 时运行）
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';

it.runIf(process.env.MAKE_SAMPLES === '1')('生成示例文件', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('资料');
  ws.addRows([
    ['店铺', '分类', '标题', '内容', '关键词'],
    ['示例店铺 · 家居', '商品资料', '陶瓷马克杯 B 款', '示例商品，容量 350ml，日常价 39 元，可微波炉加热，不建议放入洗碗机。', '水杯、杯子、咖啡杯'],
    ['示例店铺 · 家居', '物流发货', '发货时间', '下单后 48 小时内发货，节假日顺延。', '多久发货、什么时候发'],
    ['', '售后政策', '破损处理', '收到破损请在 48 小时内拍照联系客服，核实后补发或退款。', '碎了、破损、坏了'],
  ]);
  ws.columns.forEach((c, i) => (c.width = [16, 12, 20, 60, 24][i]));
  writeFileSync('samples/示例资料.xlsx', new Uint8Array(await wb.xlsx.writeBuffer()));
});
