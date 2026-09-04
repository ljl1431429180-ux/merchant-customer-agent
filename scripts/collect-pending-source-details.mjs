import puppeteer from 'puppeteer-core';

const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.example.com';
const blocked = /验证码|请先登录|登录后|访问受限|安全验证|异常访问|滑动验证|完成验证|拖动下方滑块|通过验证/i;

async function connect(port, label) {
  try {
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
    return puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
  } catch { throw new Error(`未连接到${label}浏览器。请打开连接器并由你本人完成登录。`); }
}

async function request(page, path, options = {}) {
  const result = await page.evaluate(async ({ path, options }) => {
    const response = await fetch(path, options);
    return { ok: response.ok, body: await response.json().catch(() => ({})) };
  }, { path, options });
  if (!result.ok) throw new Error(result.body?.error || '私有后台请求失败。');
  return result.body;
}

function extract(text, labels) {
  for (const label of labels) {
    const match = new RegExp(`${label}[：:\\s]{0,4}([^\\n]{2,100})`, 'i').exec(text);
    if (match?.[1]) return match[1].replace(/(颜色|尺码|规格|库存|发货).*/i, '').trim();
  }
  return '';
}

const dashboardBrowser = await connect(9223, '抖店连接器');
const collectorBrowser = await connect(9222, '1688采集');
const dashboard = (await dashboardBrowser.pages()).find((page) => page.url().startsWith(dashboardUrl));
if (!dashboard) throw new Error('没有找到已登录的私有后台页面。');

const sourceData = await request(dashboard, '/api/sources');
const source = (sourceData.sources || []).find((item) => item?.sourceUrl && item?.externalSku && !item?.material && !item?.title);
if (!source) throw new Error('没有找到待采集的候选货源。');

const page = await collectorBrowser.newPage();
let payload;
try {
  await page.goto(source.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const facts = await page.evaluate(() => {
    const meta = (name) => document.querySelector(`meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`)?.getAttribute('content') ?? '';
    return { title: meta('og:title') || document.title, description: meta('og:description') || meta('description'), image: meta('og:image'), text: document.body?.innerText || '' };
  });
  if (blocked.test(facts.text)) throw new Error('1688 页面要求登录或验证，已停止采集。');
  const price = /(?:¥|￥)\s*(\d{1,6}(?:\.\d{1,2})?)/.exec(facts.text)?.[1];
  payload = {
    sourceUrl: source.sourceUrl, sourceTitle: source.sourceTitle, externalSku: String(source.externalSku), shopSaleCents: Number(source.shopSaleCents || 0),
    collectionStatus: 'enriched', title: facts.title.slice(0, 300), material: extract(facts.text, ['鞋面材质', '材质', '面料']),
    specifications: extract(facts.text, ['尺码', '规格']), sellingPoints: facts.description.slice(0, 500), imageUrl: facts.image,
    sourcePriceCents: price ? Math.round(Number(price) * 100) : null,
  };
} finally { await page.close(); }

await request(dashboard, '/api/sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sources: [payload] }) });
console.log(JSON.stringify({ externalSku: payload.externalSku, collectionStatus: payload.collectionStatus, hasMaterial: Boolean(payload.material), hasSpecifications: Boolean(payload.specifications), hasImage: Boolean(payload.imageUrl), hasSourcePrice: payload.sourcePriceCents !== null, knowledgeStatus: 'pending_review' }, null, 2));
