import puppeteer from 'puppeteer-core';

const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.example.com';
const watch = process.argv.includes('--watch');
const interval = Math.max(2_000, Number(process.argv[process.argv.indexOf('--interval') + 1] || 4_000));
const blocked = /请登录|登录后|验证码|安全验证|异常访问|滑动验证|完成验证/i;

async function connect() {
  const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json()).catch(() => null);
  if (!version?.webSocketDebuggerUrl) throw new Error('本地抖店连接器未启动。');
  return puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
}

async function api(page, path, options = {}) {
  const result = await page.evaluate(async ({ path, options }) => {
    const response = await fetch(path, options);
    return { ok: response.ok, body: await response.json().catch(() => ({})) };
  }, { path, options });
  if (!result.ok) throw new Error(result.body?.error || '私有后台请求失败。');
  return result.body;
}

async function fillOnly(page, text) {
  const selectors = ['[contenteditable="true"]', 'textarea', '[role="textbox"]'];
  for (const selector of selectors) {
    const composer = await page.$(selector);
    if (!composer || !await composer.boundingBox()) continue;
    const existing = await composer.evaluate((node) => node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement ? node.value.trim() : (node.textContent || '').trim());
    if (existing) throw new Error('飞鸽输入框已有内容，为避免覆盖或混入消息，本次未填入。');
    await composer.click();
    await page.keyboard.type(text, { delay: 6 });
    return true;
  }
  return false;
}

async function once() {
  const browser = await connect();
  try {
    const pages = await browser.pages();
    const dashboard = pages.find((page) => page.url().startsWith(dashboardUrl));
    const feige = pages.find((page) => /im\.jinritemai\.com\/pc_seller_v2/.test(page.url()));
    if (!dashboard || !feige) return { status: '等待私有后台和飞鸽会话同时打开' };
    if (blocked.test(await feige.evaluate(() => document.body?.innerText || ''))) return { status: '等待你完成抖店登录或验证' };
    const { action } = await api(dashboard, '/api/connector-actions');
    if (!action) return { status: '没有待填入草稿' };
    try {
      if (!await fillOnly(feige, action.draftText)) throw new Error('没有找到飞鸽输入框。');
      await api(dashboard, '/api/connector-actions', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: action.id, status: 'filled' }) });
      return { status: '已填入飞鸽输入框，未发送', actionId: action.id };
    } catch (error) {
      await api(dashboard, '/api/connector-actions', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: action.id, status: 'failed', errorText: error instanceof Error ? error.message : '填入失败' }) });
      return { status: '未填入', reason: error instanceof Error ? error.message : '填入失败' };
    }
  } finally { await browser.disconnect(); }
}

do { console.log(JSON.stringify(await once(), null, 2)); if (watch) await new Promise((resolve) => setTimeout(resolve, interval)); } while (watch);
