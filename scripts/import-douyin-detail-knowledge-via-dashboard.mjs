import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import XLSX from 'xlsx';
import puppeteer from 'puppeteer-core';

const directory = resolve('data');
const requestedFile = process.argv[process.argv.indexOf('--file') + 1];
const file = requestedFile || (await readdir(directory)).filter((name) => name.startsWith('抖店详情批量采集-')).sort().at(-1);
if (!file) throw new Error('未找到抖店详情批量采集表。请先完成店铺商品详情采集。');

function text(value) { return String(value ?? '').trim(); }
function parseAttributes(value) {
  try {
    const item = JSON.parse(text(value));
    return item && typeof item === 'object' && !Array.isArray(item) ? item : {};
  } catch { return {}; }
}
function parseSpecification(value, label) {
  const matched = text(value).match(new RegExp(`${label}：([^；]+)`));
  return matched ? matched[1].trim() : '';
}
function formatSpecifications(value) {
  const raw = text(value);
  if (!raw) return '';
  return raw.includes('尺码：') || raw.includes('颜色：') ? raw : `尺码：${raw}`;
}

const workbook = XLSX.readFile(resolve(directory, file));
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
const details = rows.map((row) => {
  const specifications = formatSpecifications(row['规格']);
  const storeSizes = parseSpecification(specifications, '尺码');
  return {
    sku: text(row.SKU), productName: text(row['商品名称']), category: text(row['商品类目'] || row['类目']), material: text(row['材质']),
    specifications, attributes: parseAttributes(row['类目属性']), colors: parseSpecification(specifications, '颜色'), sizes: storeSizes,
    // 客服知识只来自店铺自己的商品详情页；不比对或引入任何货源资料。
    conflicts: [],
  };
}).filter((detail) => /^\d{6,}$/.test(detail.sku) && detail.productName);

if (!details.length) throw new Error('待确认表中没有可导入的商品资料。');
const version = await (await fetch('http://127.0.0.1:9223/json/version')).json();
const browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
const page = (await browser.pages()).find((item) => /chatgpt\.site/.test(item.url()));
if (!page) { await browser.disconnect(); throw new Error('未找到已登录的私有后台页面。'); }
const result = await page.evaluate(async (payload) => {
  const response = await fetch('/api/product-details', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ details: payload }) });
  return { ok: response.ok, body: await response.json() };
}, details);
await browser.disconnect();
if (!result.ok) throw new Error(result.body?.error || '导入商品详情失败。');
console.log(JSON.stringify({ imported: details.length, sourceFile: file, source: 'store-product-detail-only', status: 'pending-review' }));
