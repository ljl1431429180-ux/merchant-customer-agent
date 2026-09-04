import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.example.com';
const watch = process.argv.includes('--watch');
const interval = Math.max(10_000, Number(process.argv[process.argv.indexOf('--interval') + 1] || 20_000));
const stateFile = resolve('data', 'feige-draft-monitor-state.json');
const ignored = /(系统消息|智能客服|现在是人工客服|查阅一下|用户超时|客服.*接入|已读|发送|当前会话|咨询宝贝|邀请下单|计算价格|规格属性|尺码表|近6个月|机器人接待中)/;

async function connect() {
  const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json()).catch(() => null);
  if (!version?.webSocketDebuggerUrl) throw new Error('本地抖店连接器未启动，请先启动并登录一次。');
  return puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
}
async function loadState() { try { return JSON.parse(await readFile(stateFile, 'utf8')); } catch { return { handled: [] }; } }
async function api(page, path, options = {}) {
  const result = await page.evaluate(async ({ path, options }) => { const response = await fetch(path, options); return { ok: response.ok, body: await response.json().catch(() => ({})) }; }, { path, options });
  if (!result.ok) throw new Error(result.body?.error || '私有后台请求失败。');
  return result.body;
}
async function readActiveConversation(page) {
  return page.evaluate(() => {
    const lines = (document.body?.innerText || '').split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const all = lines.join(' ');
    const product = /用户正在查看商品[^。]{0,80}\s+(.{4,180}?)\s+[¥￥]/.exec(all)?.[1] || /咨询宝贝\s+(.{4,180}?)\s+[¥￥]/.exec(all)?.[1] || '';
    const messages = [...document.querySelectorAll('[data-qa-id="qa-message-warpper"]')].map((wrapper) => {
      const customer = wrapper.querySelector('.messageNotMe');
      const container = wrapper.querySelector('[data-id]');
      return { id: container?.getAttribute('data-id') || '', text: (customer?.innerText || '').replace(/\s+/g, ' ').trim() };
    }).filter((item) => item.text);
    return { lines, product, messages };
  });
}
function latestCustomerQuestion(messages, lines) {
  const eligible = messages.filter((item) => item.text.length >= 2 && item.text.length <= 300 && !ignored.test(item.text))
    .filter((item) => /(？|\?|材质|尺码|有货|库存|价格|多少钱|发货|退货|换货|质量|优惠)/.test(item.text));
  if (eligible.length) return eligible.at(-1);
  const text = lines.filter((line) => line.length >= 2 && line.length <= 300 && !ignored.test(line))
    .filter((line) => /(？|\?|材质|尺码|有货|库存|价格|多少钱|发货|退货|换货|质量|优惠)/.test(line)).at(-1) || '';
  return text ? { id: '', text } : null;
}
async function once() {
  const browser = await connect();
  try {
    const pages = await browser.pages();
    const dashboard = pages.find((page) => page.url().startsWith(dashboardUrl));
    const feige = pages.find((page) => /im\.jinritemai\.com\/pc_seller_v2/.test(page.url()));
    if (!dashboard || !feige) throw new Error('请在连接器浏览器中同时打开私有后台和飞鸽会话。');
    const { lines, product, messages } = await readActiveConversation(feige);
    const latest = latestCustomerQuestion(messages, lines);
    if (!latest) return { mode: '仅生成草稿，不发送', status: '没有识别到新的客户问题' };
    const message = latest.text;
    // 飞鸽为每条消息提供不同 data-id；同一句再次发送也会被视作新咨询。
    const key = latest.id ? `message:${latest.id}` : `${product}|${message}`;
    const state = await loadState();
    if ((state.handled || []).includes(key)) return { mode: '仅生成草稿，不发送', status: '该消息已生成过草稿', customerMessage: message, consultingProduct: product };
    // 升级前按“商品+文本”去重。首次看到旧消息时迁移为飞鸽消息 ID，
    // 既不重复生成历史草稿，也不会拦住今后内容相同的新消息。
    const legacyKey = `${product}|${message}`;
    if (latest.id && (state.handled || []).includes(legacyKey)) {
      const handled = [...(state.handled || []).filter((item) => item !== legacyKey), key].slice(-200);
      await mkdir(resolve(stateFile, '..'), { recursive: true });
      await writeFile(stateFile, JSON.stringify({ handled, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
      return { mode: '仅生成草稿，不发送', status: '已迁移历史草稿记录', customerMessage: message, consultingProduct: product };
    }
    const answer = await api(dashboard, '/api/local-connector/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: message, productHint: product }) });
    await mkdir(resolve(stateFile, '..'), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ handled: [...(state.handled || []), key].slice(-200), updatedAt: new Date().toISOString() }, null, 2), 'utf8');
    return { mode: '仅生成草稿，不发送', status: '已生成草稿', customerMessage: message, consultingProduct: product, suggestedReply: answer.reply, needsHuman: answer.needsHuman, knowledgeUsed: answer.knowledgeUsed };
  } finally { await browser.disconnect(); }
}
do { console.log(JSON.stringify(await once(), null, 2)); if (watch) await new Promise((resolve) => setTimeout(resolve, interval)); } while (watch);
