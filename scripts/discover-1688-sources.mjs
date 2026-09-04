import puppeteer from 'puppeteer-core';

const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.example.com';
const limitIndex = process.argv.indexOf('--limit');
const limit = Math.max(1, Math.min(30, Number(process.argv[limitIndex + 1] || 10)));
const blocked = /验证码|请先登录|登录后|访问受限|安全验证|异常访问|滑动验证|完成验证|拖动下方滑块|通过验证/i;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function connect(port, label) {
  try {
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
    return puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
  } catch { throw new Error(`未连接到${label}浏览器。请先打开对应连接器并由你本人完成登录。`); }
}

async function dashboardRequest(page, path, options = {}) {
  const result = await page.evaluate(async ({ path, options }) => {
    const response = await fetch(path, options);
    return { ok: response.ok, body: await response.json().catch(() => ({})) };
  }, { path, options });
  if (!result.ok) throw new Error(result.body?.error || '私有后台未就绪，请在抖店连接器窗口打开并登录后台。');
  return result.body;
}

const douyin = await connect(9223, '抖店连接器');
const browser1688 = await connect(9222, '1688采集');
const dashboard = (await douyin.pages()).find((page) => page.url().startsWith(dashboardUrl));
if (!dashboard) throw new Error('抖店连接器中没有打开已登录的私有后台。');
const [catalog, sourceData] = await Promise.all([
  dashboardRequest(dashboard, '/api/products'), dashboardRequest(dashboard, '/api/sources'),
]);
const linkedOrQueuedSkus = new Set((sourceData.sources || []).map((source) => String(source.externalSku || '')));
const products = (catalog.products || []).filter((product) => product?.name && product?.sku && !linkedOrQueuedSkus.has(String(product.sku))).slice(0, limit);
if (!products.length) { console.log(JSON.stringify({ searched: 0, queued: 0, note: '没有需要自动寻找货源的商品。' }, null, 2)); process.exit(0); }

const page = await browser1688.newPage();
page.setDefaultNavigationTimeout(25_000);
const candidates = [];
const skipped = [];

function searchTerms(name) {
  const clean = String(name).replace(/[【】\[\]（）()]/g, ' ').replace(/\s+/g, ' ').trim();
  const compact = clean.split(/\s|女鞋|女款|新款|现货|包邮|直播|爆款|复古|时尚/).filter((part) => part.length >= 2).join(' ').slice(0, 42);
  const categories = [...clean.matchAll(/德比鞋|马丁靴|短靴|雪地靴|凉鞋|拖鞋|单鞋|女鞋|皮鞋|靴子|运动鞋|高跟鞋|板鞋|棉鞋|女靴/g)].map((match) => match[0]);
  const attributes = [...clean.matchAll(/厚底|圆头|尖头|黑色|白色|棕色|真皮|防水|加绒|增高|透气|软底/g)].map((match) => match[0]);
  const categoryQuery = [...new Set([...attributes.slice(0, 3), ...categories.slice(0, 2)])].join(' ');
  return [...new Set([clean.slice(0, 60), compact, categoryQuery])].filter((term) => term && term.length >= 2);
}

async function findCandidate(name) {
  for (const term of searchTerms(name)) {
    try {
      await page.goto(`https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(term)}`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.waitForFunction(() => document.querySelector('a[href*="detail.1688.com/offer/"], a[href*="offerId="], body')?.textContent?.trim(), { timeout: 12_000 }).catch(() => null);
      await delay(800);
      const result = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const links = [...document.querySelectorAll('a[href]')];
        const link = links.find((item) => /detail\.1688\.com\/offer\/\d+|offerId=\d+/i.test(item.href) && (item.textContent || '').trim().length >= 4);
        if (!link) return { blocked: /验证码|请先登录|登录后|访问受限|安全验证|异常访问|滑动验证|完成验证/i.test(text), candidate: null };
        const offerId = /offer\/(\d+)|offerId=(\d+)/i.exec(link.href)?.slice(1).find(Boolean);
        return { blocked: false, candidate: offerId ? { sourceUrl: `https://detail.1688.com/offer/${offerId}.html`, sourceTitle: (link.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) } : null };
      });
      if (result.blocked) return { blocked: true, candidate: null };
      if (result.candidate) return result;
    } catch {
      // 1688 may keep loading advertising modules after search results are usable; retry a shorter term.
    }
  }
  return { blocked: false, candidate: null };
}

for (const product of products) {
  const result = await findCandidate(product.name);
  if (result.blocked) { console.log(`已停止：1688 对“${product.name}”要求登录或验证。`); break; }
  if (result.candidate) candidates.push({ ...result.candidate, shopSaleCents: Number(product.priceCents), externalSku: String(product.sku) });
  else skipped.push(String(product.sku));
  await delay(900);
}
await page.close();
if (candidates.length) await dashboardRequest(dashboard, '/api/sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sources: candidates }) });
console.log(JSON.stringify({ searched: products.length, queued: candidates.length, skipped: skipped.length, note: '候选货源已进入待采集队列；自动关联和知识库确认仍遵循匹配度与人工审核规则。' }, null, 2));
