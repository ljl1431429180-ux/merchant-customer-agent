import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import XLSX from 'xlsx';

const dataDir = resolve('data');
const files = (await readdir(dataDir)).filter((name) => /^抖店详情采集-.*\.xlsx$/.test(name)).sort();
const latest = new Map();
for (const file of files) {
  const book = XLSX.readFile(resolve(dataDir, file));
  const row = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: '' })[0];
  if (row?.SKU && /^\d{6,}$/.test(String(row.SKU))) latest.set(String(row.SKU), row);
}
const allowed = new Set(['材质', '帮面材质', '鞋面材质', '鞋面内里材质', '鞋底材质', '鞋头款式', '鞋跟高度', '鞋跟款式', '厚度', '适用季节', '风格', '流行元素', '功能', '闭合方式', '产地', '商品类型', '适用人群']);
const rows = [...latest.values()].map((row) => {
  let raw = {}; try { raw = JSON.parse(String(row['类目属性'] || '{}')); } catch {}
  const attributes = Object.fromEntries(Object.entries(raw).filter(([key, value]) => allowed.has(key) && typeof value === 'string' && value && !/请选择|商品系列|品名|包装体积|生产企业/.test(value)));
  return { 商品名称: row['抖店商品标题'], SKU: row.SKU, 商品类目: row['商品类目'], 材质: row.材质, 规格: row.规格, 类目属性: JSON.stringify(attributes), 采集状态: '已整理待确认' };
});
const output = resolve(dataDir, `抖店详情知识待确认-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`);
const out = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(rows), '待确认知识'); XLSX.writeFile(out, output);
console.log(JSON.stringify({ products: rows.length, rows, output }, null, 2));
