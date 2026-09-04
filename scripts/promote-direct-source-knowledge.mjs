import puppeteer from 'puppeteer-core';

const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.example.com';
const sku = String(process.argv[process.argv.indexOf('--sku') + 1] || '').trim();
if (!/^\d{6,}$/.test(sku)) throw new Error('请用 --sku 指定抖店商品对应的 1688 源商品编号。');

const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json());
const browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
try {
  const dashboard = (await browser.pages()).find((page) => page.url().startsWith(dashboardUrl));
  if (!dashboard) throw new Error('没有找到已登录的私有后台页面。');
  const api = async (path, options = {}) => dashboard.evaluate(async ({ path, options }) => {
    const response = await fetch(path, options); const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || '私有后台请求失败'); return body;
  }, { path, options });
  const [catalog, sourceData] = await Promise.all([api('/api/products'), api('/api/sources')]);
  const product = (catalog.products || []).find((item) => String(item.sku) === sku);
  const source = (sourceData.sources || []).find((item) => String(item.externalSku) === sku || String(item.sourceProductId) === sku);
  if (!product || !source) throw new Error('没有找到对应的抖店商品或已采集的 1688 货源。');
  if (!source.linkedProductId) await api(`/api/sources/${encodeURIComponent(source.id)}/link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: product.id }) });
  await api(`/api/sources/${encodeURIComponent(source.id)}/confirm`, { method: 'POST' });
  console.log(JSON.stringify({ promoted: true, sku, product: product.name, sourceId: source.sourceProductId, mode: '已关联并确认 1688 货源资料；客服知识库将优先使用货源字段，不含货源价。' }, null, 2));
} finally { await browser.disconnect(); }
