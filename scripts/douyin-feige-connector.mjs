import puppeteer from 'puppeteer-core';

const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.example.com';
const action = process.argv.includes('--fill') ? 'fill' : process.argv.includes('--inspect') ? 'inspect' : process.argv.includes('--preview') ? 'preview' : 'status';
const messageIndex = process.argv.indexOf('--message');
const suppliedMessage = messageIndex >= 0 ? String(process.argv[messageIndex + 1] || '').trim() : '';
const productIndex = process.argv.indexOf('--product');
const suppliedProduct = productIndex >= 0 ? String(process.argv[productIndex + 1] || '').trim() : '';
const blocked = /请登录|登录后|验证码|安全验证|异常访问|滑动验证|完成验证/i;

async function connect() {
  try {
    const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json());
    return puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
  } catch {
    throw new Error('未连接到本地抖店浏览器。请先运行 open-douyin-feige-connector.ps1，并在打开的窗口登录。');
  }
}

function visibleText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function callDashboard(page, path, options = {}) {
  const result = await page.evaluate(async ({ path, options }) => {
    const response = await fetch(path, options);
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  }, { path, options });
  if (!result.ok) throw new Error(result.body?.error || `私有后台未就绪（${result.status}）。请确认同一浏览器已登录后台。`);
  return result.body;
}

async function listMessageCandidates(page) {
  const extracted = await page.evaluate(() => {
    const selectors = [
      '[data-message-id]', '[data-testid*="message" i]', '[class*="message" i]',
      '[class*="chat-item" i]', '[class*="im-message" i]'
    ];
    const nodes = [...new Set(selectors.flatMap((selector) => [...document.querySelectorAll(selector)]))];
    return nodes.map((node) => ({
      text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
      className: String(node.className || ''), role: node.getAttribute('role') || '',
      label: node.getAttribute('aria-label') || '', dataKeys: Object.keys(node.dataset || {}).join(','),
    }))
      .filter((item) => item.text.length >= 2 && item.text.length <= 500)
      .slice(-12);
  });
  return extracted;
}

function looksLikeSystemOrAgentHint(text) {
  return /(现在是人工客服为您服务|查阅一下您和智能客服|请您稍等片刻|系统消息|会话已结束|评价本次服务)/.test(text);
}

async function readLatestCustomerMessage(page) {
  const candidates = await listMessageCandidates(page);
  return candidates.slice().reverse().find((item) => item.className.includes('messageNotMe') && !looksLikeSystemOrAgentHint(item.text))?.text || '';
}

async function readConsultingProduct(page) {
  const extracted = await page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const labels = ['咨询商品', '商品信息', '商品详情', '正在咨询'];
    for (const label of labels) {
      const index = text.indexOf(label);
      if (index < 0) continue;
      const value = text.slice(index + label.length).replace(/^[：:\-\s]+/, '').slice(0, 300);
      const match = value.match(/([^|｜]{4,180}?)(?:\s+(?:价格|优惠|库存|规格|颜色|尺码|商品ID|查看详情)|$)/);
      if (match?.[1]) return match[1].trim();
    }
    const titleNode = document.querySelector('[data-testid*="product" i] [title], [class*="product" i] [title]');
    return String(titleNode?.getAttribute('title') || '').trim();
  });
  return extracted;
}

async function fillDraft(page, reply) {
  const selectors = ['[contenteditable="true"]', 'textarea', '[role="textbox"]'];
  for (const selector of selectors) {
    const composer = await page.$(selector);
    if (!composer) continue;
    const box = await composer.boundingBox();
    if (!box) continue;
    await composer.click();
    await page.keyboard.type(reply, { delay: 8 });
    return true;
  }
  return false;
}

const browser = await connect();
const pages = await browser.pages();
const dashboard = pages.find((page) => page.url().startsWith(dashboardUrl));
const pageTitles = await Promise.all(pages.map(async (page) => ({ page, title: await page.title().catch(() => '') })));
const feige = pageTitles.find(({ page, title }) => (
  /jinritemai\.com/i.test(page.url()) && (/飞鸽|客服|消息|会话/.test(title) || /\/(?:im|feige|message|conversation)(?:\/|\?|$)/i.test(page.url()))
))?.page;
const requiresFeigePage = action === 'inspect' || action === 'fill' || (action === 'preview' && !suppliedMessage);

if (!dashboard) throw new Error('没有找到私有后台页面。请在连接器浏览器中打开并登录后台。');
if (requiresFeigePage && !feige) throw new Error('没有找到飞鸽客服会话页面。请在同一浏览器进入抖店的飞鸽客服并打开一个会话；商品管理页不会被当作客户会话。');

const dashboardText = visibleText(await dashboard.evaluate(() => document.body?.innerText || ''));
if (blocked.test(dashboardText)) throw new Error('私有后台尚未登录，请先在同一浏览器完成登录。');
if (feige) {
  const feigeText = visibleText(await feige.evaluate(() => document.body?.innerText || ''));
  if (blocked.test(feigeText)) throw new Error('抖店／飞鸽尚未登录或需要验证，请由你本人完成后再继续。');
}

if (action === 'status') {
  const catalog = await callDashboard(dashboard, '/api/local-connector/catalog');
  console.log(JSON.stringify({ connected: true, products: catalog.products.length, confirmedKnowledge: catalog.knowledge.length, mode: '仅预览或填入草稿，不自动发送' }, null, 2));
  process.exit(0);
}

if (action === 'inspect') {
  if (!feige) throw new Error('没有找到飞鸽客服会话页面。');
  const candidates = await listMessageCandidates(feige);
  console.log(JSON.stringify(candidates.map(({ text, className, role, label, dataKeys }) => ({
    preview: text.slice(0, 60), length: text.length, className, role, label, dataKeys,
  })), null, 2));
  process.exit(0);
}

const message = suppliedMessage || await readLatestCustomerMessage(feige);
if (!message) throw new Error('没有识别到当前客户消息。请使用 --message "客户原话" 手动指定，避免误读会话。');
const productHint = suppliedProduct || await readConsultingProduct(feige);
const answer = await callDashboard(dashboard, '/api/local-connector/reply', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: message, productHint }),
});
console.log(JSON.stringify({ customerMessage: message, consultingProduct: productHint || '未识别（可通过 --product 手动指定）', suggestedReply: answer.reply, needsHuman: answer.needsHuman, knowledgeUsed: answer.knowledgeUsed, productMatch: answer.productMatch, autoSendAllowed: answer.autoSendAllowed === true, mode: '仅生成草稿，不自动发送' }, null, 2));

if (action === 'fill') {
  if (!suppliedMessage) throw new Error('为避免把错误会话填入输入框，--fill 必须同时提供 --message "客户原话"。');
  if (answer.needsHuman) throw new Error('该问题需要人工处理，连接器不会填入回复草稿。');
  if (!feige || !await fillDraft(feige, answer.reply)) throw new Error('没有找到飞鸽输入框。请保持当前会话打开，或先使用 --preview 查看建议。');
  console.log('建议回复已填入飞鸽输入框，尚未发送。请你核对后自行点击发送。');
}
