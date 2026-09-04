import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import XLSX from 'xlsx';
import puppeteer from 'puppeteer-core';

const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.example.com';
const shouldImport = process.argv.includes('--import');
const shouldSync = process.argv.includes('--sync');
const shouldInspect = process.argv.includes('--inspect');
const categoryIndex = process.argv.indexOf('--category');
const category = categoryIndex >= 0 ? String(process.argv[categoryIndex + 1] || '女鞋').trim() || '女鞋' : '女鞋';

function money(text) {
  const match = /(?:¥|￥)\s*(\d{1,7}(?:\.\d{1,2})?)/.exec(text);
  return match ? Math.round(Number(match[1]) * 100) : 0;
}

function stock(text) {
  const afterPrice = /(?:¥|￥)\s*\d{1,7}(?:\.\d{1,2})?(?:\s*~\s*(?:¥|￥)?\s*\d{1,7}(?:\.\d{1,2})?)?\s+(\d{1,8})\s+\d+\s+暂无评价/.exec(text);
  if (afterPrice) return Number(afterPrice[1]);
  const named = /库存[^\d]{0,8}(\d{1,8})/.exec(text);
  return named ? Number(named[1]) : 0;
}

function stableId(text, index) {
  const itemCode = /货号：([^\s]+)/.exec(text)?.[1]?.replace(/^[A-Za-z]#/, '');
  return itemCode || /ID：(\d{8,})/.exec(text)?.[1] || `douyin-visible-${index + 1}`;
}

function listingStatus(text) {
  // A listing can have stock but still be off shelf. Keep that distinction so
  // customer service never treats an unavailable item as sellable.
  if (/(已下架|下架中|已停用|已删除)/.test(text)) return 'off_shelf';
  if (/(售罄|缺货|库存不足)/.test(text)) return 'out_of_stock';
  return 'active';
}

function titleFromRow(text, links) {
  const beforeId = text.split(/\s+ID：/)[0]?.trim();
  if (beforeId && beforeId.length >= 4 && beforeId.length <= 160) return beforeId;
  const linked = links.map((item) => item.text.trim()).find((item) => item.length >= 4 && item.length <= 160 && !/编辑|下架|删除|复制|更多|查看/.test(item));
  if (linked) return linked;
  return text.split(/\s{2,}|\n/).map((item) => item.trim()).find((item) => item.length >= 4 && item.length <= 160 && !/¥|￥|库存|编辑|下架|删除/.test(item)) || '';
}

async function connect() {
  try {
    const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json());
    return puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
  } catch {
    throw new Error('未连接到本地抖店浏览器。请先运行 open-douyin-feige-connector.ps1 并登录。');
  }
}

async function callDashboard(page, path, options = {}) {
  const result = await page.evaluate(async ({ path, options }) => {
    const response = await fetch(path, options);
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
  }, { path, options });
  if (!result.ok) throw new Error(result.body?.error || `私有后台未就绪（${result.status}）。`);
  return result.body;
}

const browser = await connect();
const pages = await browser.pages();
const dashboard = pages.find((page) => page.url().startsWith(dashboardUrl));
const pageTitles = await Promise.all(pages.map(async (page) => ({ page, title: await page.title().catch(() => '') })));
const productPage = pageTitles.find(({ page, title }) => /jinritemai\.com/i.test(page.url()) && /商品管理|商品列表/.test(title))?.page;
if (!dashboard) throw new Error('没有找到已登录的私有后台页面。请在连接器浏览器中打开后台。');
if (!productPage) throw new Error('没有找到“商品管理”页面。请在同一浏览器进入抖店的 商品 → 商品管理，并保持页面打开。');

const rows = await productPage.evaluate(() => {
  const selectors = ['tbody tr', '[role="row"]', '[class*="table-row" i]', '[class*="tableRow" i]'];
  const nodes = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
  return nodes.map((node) => ({
    text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
    links: [...node.querySelectorAll('a')].map((link) => ({ text: link.textContent || '', href: link.href || '' })),
  })).filter((row) => row.text.length >= 8 && row.text.length <= 1600);
});

if (shouldInspect) {
  console.log(JSON.stringify(rows.slice(0, 8), null, 2));
  process.exit(0);
}

const deduped = new Map();
for (const [index, row] of rows.entries()) {
  const name = titleFromRow(row.text, row.links);
  if (!name) continue;
  const sku = stableId(row.text, index);
  const product = { name, sku, category, color: '待补充', size: '待补充', material: '待补充', priceCents: money(row.text), stock: stock(row.text), listingStatus: listingStatus(row.text) };
  deduped.set(sku, product);
}
const products = [...deduped.values()].slice(0, 500);
if (!products.length) throw new Error('商品管理页没有识别到可导入的商品行。请确认页面已加载商品列表后重试。');

let sync = null;
if (shouldSync) {
  const catalog = await callDashboard(dashboard, '/api/products');
  const previous = new Map((catalog.products || []).map((item) => [item.sku, item]));
  const added = products.filter((item) => !previous.has(item.sku));
  const changed = products.filter((item) => {
    const old = previous.get(item.sku);
    return old && (old.name !== item.name || old.priceCents !== item.priceCents || old.stock !== item.stock || old.status !== item.listingStatus);
  });
  sync = { checkedAt: new Date().toISOString(), scanned: products.length, added: added.length, changed: changed.length, unchanged: products.length - added.length - changed.length };
}

const output = resolve('data', `抖店商品采集-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`);
await mkdir(resolve(output, '..'), { recursive: true });
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(products.map((item) => ({
  商品名称: item.name, SKU: item.sku, 分类: item.category, 颜色: item.color, 尺码: item.size,
  材质: item.material, 售价: item.priceCents / 100, 库存: item.stock, 上下架状态: item.listingStatus,
}))), '抖店商品');
XLSX.writeFile(workbook, output);

if (shouldImport) {
  const result = await callDashboard(dashboard, '/api/products/import', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ products }),
  });
  if (sync) await writeFile(resolve('data', '抖店商品同步状态.json'), JSON.stringify({ ...sync, products: products.map(({ sku, name, priceCents, stock, listingStatus }) => ({ sku, name, priceCents, stock, listingStatus })) }, null, 2), 'utf8');
  console.log(JSON.stringify({ collected: products.length, imported: result.processed, output, sync, note: '同步只更新名称、售价、库存和上下架状态；已确认的颜色、尺码、材质不会被待补充字段覆盖。新品与详情变化均需审核后才会进入客服知识库。' }, null, 2));
} else {
  console.log(JSON.stringify({ collected: products.length, output, next: '核对结果后，加 --import 可导入私有商品库。' }, null, 2));
}

// 只读同步结束后释放浏览器连接；不关闭用户正在使用的浏览器标签。
await browser.disconnect();
