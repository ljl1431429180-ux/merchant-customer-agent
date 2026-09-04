import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import XLSX from 'xlsx';
import puppeteer from 'puppeteer-core';

const blocked = /验证码|请先登录|登录后|访问受限|安全验证|异常访问|滑动验证|完成验证|拖动下方滑块|通过验证/i;
const fileArguments = process.argv.slice(2).filter((argument) => argument !== '--');
const inlineSourcesIndex = fileArguments.indexOf('--sources-json');
const inlineSources = inlineSourcesIndex >= 0 ? JSON.parse(fileArguments[inlineSourcesIndex + 1] || '[]') : null;
const positionalArguments = inlineSourcesIndex >= 0 ? fileArguments.filter((_, index) => index !== inlineSourcesIndex && index !== inlineSourcesIndex + 1) : fileArguments;
const inputFile = positionalArguments[0];
const outputFile = positionalArguments[1] || resolve('data', `1688-采集结果-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`);

if (!inputFile && !inlineSources) {
  console.error('用法：pnpm collect:1688 -- "D:\\你的表格.xlsx" ["D:\\输出结果.xlsx"]，或使用 --sources-json。');
  process.exit(1);
}

function cell(row, names) {
  const key = Object.keys(row).find((item) => names.includes(item.trim()));
  return key ? String(row[key] ?? '').trim() : '';
}

function money(value) {
  const number = Number(String(value).replace(/[￥¥,\s]/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : '';
}

function offerId(url) {
  return /detail\.1688\.com\/offer\/(\d+)/i.exec(url)?.[1] ?? '';
}

function extractLabel(text, labels) {
  for (const label of labels) {
    const result = new RegExp(`${label}[：:\\s]{0,4}([^\\n]{2,100})`, 'i').exec(text);
    if (result?.[1]) return result[1].replace(/(颜色|尺码|规格|库存|发货).*/i, '').trim();
  }
  return '';
}

const genericLabels = ['品牌', '型号', '货号', '适用人群', '适用性别', '风格', '图案', '季节', '产地', '功能', '厚度', '闭合方式', '跟高', '鞋头', '鞋底材质', '内里材质', '填充物', '成分', '容量', '尺寸', '重量', '功率', '电压', '保质期', '配料', '规格型号'];
function genericAttributes(text) {
  return Object.fromEntries(genericLabels.map((label) => [label, extractLabel(text, [label])]).filter(([, value]) => value));
}

function sourcePrice(text) {
  const value = /(?:¥|￥)\s*(\d{1,6}(?:\.\d{1,2})?)/.exec(text)?.[1];
  return value ? Number(value) : '';
}

async function collect(page, record) {
  try {
    await page.goto(record['链接地址'], { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    const visible = await page.evaluate(() => document.body?.innerText ?? '');
    if (blocked.test(visible)) return { ...record, '采集状态': '需要授权数据源', '采集说明': '页面要求登录或验证，已停止采集。' };
    const facts = await page.evaluate(() => {
      const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`)?.getAttribute('content') ?? '';
      return { title: meta('og:title') || document.title, description: meta('og:description') || meta('description'), image: meta('og:image'), text: document.body?.innerText ?? '' };
    });
    const material = extractLabel(facts.text, ['鞋面材质', '材质', '面料']);
    const specs = extractLabel(facts.text, ['尺码', '规格']);
    const attributes = genericAttributes(facts.text);
    const price = sourcePrice(facts.text);
    if (!facts.title && !facts.description && !facts.image && !price) return { ...record, '采集状态': '采集失败', '采集说明': '公开页面未提供可识别详情。' };
    return { ...record, '采集状态': '已采集待确认', '实际标题': facts.title.slice(0, 300), '材质': material, '规格': specs, '类目属性': JSON.stringify(attributes), '卖点': facts.description.slice(0, 500), '主图链接': facts.image, '货源价': price, '采集说明': '仅提取当前公开可见信息，需审核后使用。' };
  } catch (error) {
    return { ...record, '采集状态': '采集失败', '采集说明': error instanceof Error ? `页面未响应：${error.message.slice(0, 100)}` : '页面未响应。' };
  }
}

const rows = inlineSources || XLSX.utils.sheet_to_json((() => {
  const workbook = XLSX.readFile(inputFile);
  return workbook.Sheets[workbook.SheetNames[0]];
})(), { defval: '' });
const records = rows.map((row) => ({
  '链接地址': String(row.sourceUrl || cell(row, ['链接地址', '1688链接', '1688商品链接', '货源链接'])).trim(),
  '商品标题': String(row.sourceTitle || cell(row, ['商品标题', '商品名称', '标题'])).trim(),
  '售卖价': row.shopSaleCents !== undefined ? Number(row.shopSaleCents) / 100 : money(cell(row, ['售卖价', '销售价', '抖店售价', '售价'])),
  '货号': String(row.externalSku || cell(row, ['货号', 'SKU', 'sku', '商品编码'])).trim(),
})).filter((row) => offerId(row['链接地址']) && row['商品标题'] && row['货号']);

let browser;
try {
  const version = await fetch('http://127.0.0.1:9222/json/version').then((response) => response.json());
  browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
} catch {
  console.error('未连接到本机采集浏览器。请先运行 scripts\\open-1688-collector.ps1，并在打开的窗口登录 1688。');
  process.exit(1);
}

const page = await browser.newPage();
const results = [];
for (let index = 0; index < records.length; index += 1) {
  console.log(`正在采集 ${index + 1}/${records.length}`);
  results.push(await collect(page, records[index]));
}
await page.close();
await mkdir(resolve(outputFile, '..'), { recursive: true });
const resultBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(resultBook, XLSX.utils.json_to_sheet(results), '采集结果');
XLSX.writeFile(resultBook, outputFile);
console.log(`完成：${results.length} 条，结果已保存到 ${outputFile}`);
