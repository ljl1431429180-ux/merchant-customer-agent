import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import XLSX from 'xlsx';
import puppeteer from 'puppeteer-core';

const limit = Math.max(1, Number(process.argv[process.argv.indexOf('--limit') + 1] || 500));
const categoryId = '1000007624';
const safeLabels = ['品牌', '鞋面内里材质', '鞋底材质', '鞋面材质', '鞋跟高度', '开口深度', '适用季节', '风格', '流行元素', '功能', '闭合方式', '产地', '商品类型'];
const ignored = /^(\*|请选择|请选择，最多选5项|图文信息|品名|新建标品|包装体积|包装清单|商品条码|货号|生产企业|生产许可证|品牌)$/;

function valueAfter(lines, label) {
  const index = lines.findIndex((line) => line.replace(/^\*\s*/, '') === label);
  if (index < 0) return '';
  const value = lines.slice(index + 1, index + 3).find((line) => line && !ignored.test(line) && !safeLabels.includes(line.replace(/^\*\s*/, '')));
  return value?.slice(0, 120) || '';
}

const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json());
const browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
const listPage = (await browser.pages()).find((page) => /fxg\.jinritemai\.com\/ffa\/g\/list/.test(page.url()));
if (!listPage) throw new Error('未找到商品管理页。');
const products = await listPage.evaluate(() => [...document.querySelectorAll('tbody tr, [role="row"], [class*="table-row" i], [class*="tableRow" i]')]
  .map((node) => (node.innerText || '').replace(/\s+/g, ' ').trim())
  .map((text) => ({
    name: text.split(/\s+ID：/)[0].trim(),
    productId: /ID：(\d{8,})/.exec(text)?.[1] || '',
    sku: /货号：[A-Za-z]#([^\s]+)/.exec(text)?.[1] || '',
  })).filter((item) => item.name && item.productId && item.sku));
const page = await browser.newPage();
// 本脚本只读取页面文字，不填写、不保存、不发布。抖店详情页会在切换商品时
// 弹出“离开此网站”提示；明确选择“离开”，放弃任何页面临时状态后继续采集。
page.on('dialog', async (dialog) => {
  if (dialog.type() === 'beforeunload') await dialog.accept();
  else await dialog.dismiss();
});
const results = [];
for (const product of products.slice(0, limit)) {
  await page.goto(`https://fxg.jinritemai.com/ffa/g/create?product_id=${product.productId}&cid=${categoryId}&entrance=edit`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await new Promise((resolve) => setTimeout(resolve, 6000));
  const raw = await page.evaluate(() => document.body?.innerText || '');
  if (!raw.includes('类目属性') || !raw.includes('商品规格')) {
    results.push({ 商品名称: product.name, SKU: product.sku, 商品ID: product.productId, 材质: '', 规格: '', 类目属性: '{}', 采集状态: '采集失败：详情页未完成加载' });
    continue;
  }
  const lines = raw.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const attributes = Object.fromEntries(safeLabels.map((label) => [label, valueAfter(lines, label)]).filter(([, value]) => value));
  const material = attributes['鞋面材质'] || attributes['鞋面内里材质'] || '';
  const sizeBlock = /鞋码大小([\s\S]{0,400}?)添加规格类型/.exec(raw)?.[1] || '';
  const sizes = [...new Set(sizeBlock.match(/\b(?:2\d|3\d|4\d|5\d)\b/g) || [])];
  // 仅采集商家店铺里可见的详情资料；不会读取、关联或写入任何货源信息。
  results.push({ 商品名称: product.name, SKU: product.sku, 商品ID: product.productId, 商品类目: '待审核', 材质: material, 规格: sizes.join('、'), 类目属性: JSON.stringify(attributes), 采集状态: '已采集待确认' });
}
await page.close({ runBeforeUnload: false });
const output = resolve('data', `抖店详情批量采集-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`);
await mkdir(resolve(output, '..'), { recursive: true });
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(results), '详情采集');
XLSX.writeFile(workbook, output);
console.log(JSON.stringify({ collected: results.length, results, output }, null, 2));
await browser.disconnect();
