import puppeteer from 'puppeteer-core';

const targetSku = process.argv[2] || '956417020571';
const inspectOnly = process.argv.includes('--inspect-open');
const inspectEdit = process.argv.includes('--inspect-edit');
const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json());
const browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
const pages = await browser.pages();
const titledPages = await Promise.all(pages.map(async (page) => ({ page, title: await page.title().catch(() => '') })));
const productPage = titledPages.find(({ title }) => title === '商品管理')?.page;
if (!productPage) throw new Error('未找到商品管理页。');

const before = new Set((await browser.pages()).map((page) => page.target()._targetId));
const clicked = inspectOnly ? { ok: true, reason: '仅检查已打开的预览内容' } : await productPage.evaluate(({ sku, inspectEdit }) => {
  const rows = [...document.querySelectorAll('tbody tr, [role="row"], [class*="table-row" i], [class*="tableRow" i]')];
  const row = rows.find((node) => (node.innerText || '').includes(`货号：A#${sku}`));
  if (!row) return { ok: false, reason: '未找到目标商品行' };
  const label = inspectEdit ? '编辑' : '预览';
  const control = [...row.querySelectorAll('button, a, span, div')].find((node) => (node.textContent || '').trim() === label);
  if (!control) return { ok: false, reason: `未找到${label}入口` };
  const clickable = control instanceof HTMLElement ? control : control.parentElement;
  if (!clickable) return { ok: false, reason: '入口不可点击' };
  if (inspectEdit) {
    const rect = clickable.getBoundingClientRect();
    return { ok: rect.width > 0 && rect.height > 0, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }
  clickable.click();
  return { ok: true };
}, { sku: targetSku, inspectEdit });

if (inspectEdit && clicked.ok && typeof clicked.x === 'number' && typeof clicked.y === 'number') await productPage.mouse.click(clicked.x, clicked.y);
if (!inspectOnly) await new Promise((resolve) => setTimeout(resolve, inspectEdit ? 3500 : 2500));
const visiblePanels = await productPage.evaluate(() => {
  const selectors = ['[role="dialog"]', '[class*="modal" i]', '[class*="drawer" i]', '[class*="preview" i]'];
  const nodes = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
  return nodes.map((node) => ({
    tag: node.tagName,
    className: typeof node.className === 'string' ? node.className.slice(0, 180) : '',
    text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1800),
  })).filter((node) => node.text.length > 20).slice(-8);
});
const previewMarkup = await productPage.evaluate((sku) => {
  const rows = [...document.querySelectorAll('tbody tr, [role="row"], [class*="table-row" i], [class*="tableRow" i]')];
  const row = rows.find((node) => (node.innerText || '').includes(`货号：A#${sku}`));
  const preview = row && [...row.querySelectorAll('button, a, span, div')].find((node) => (node.textContent || '').trim() === '预览');
  if (!preview) return null;
  const parents = [];
  let current = preview;
  for (let index = 0; current && index < 4; index += 1, current = current.parentElement) {
    parents.push({ tag: current.tagName, className: String(current.className || '').slice(0, 180), html: current.outerHTML.slice(0, 900) });
  }
  return parents;
}, targetSku);
const resourceUrls = await productPage.evaluate(() => performance.getEntriesByType('resource')
  .map((entry) => entry.name)
  .filter((url) => /api|product|goods|spu|sku/i.test(url))
  .slice(-120));
const newPages = await Promise.all((await browser.pages())
  .filter((page) => !before.has(page.target()._targetId))
  .map(async (page) => ({ title: await page.title().catch(() => ''), url: page.url() })));
console.log(JSON.stringify({ clicked, currentPage: { title: await productPage.title().catch(() => ''), url: productPage.url() }, previewMarkup, visiblePanels, resourceUrls, newPages }, null, 2));
await browser.disconnect();
