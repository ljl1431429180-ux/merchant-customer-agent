import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.example.com';
const sendEnabled = process.argv.includes('--send');
const processCurrent = process.argv.includes('--process-current');
const watch = process.argv.includes('--watch');
// 实时客服场景需要尽快响应；仍通过消息 ID 与最后发送方校验避免重复或抢答。
const interval = Math.max(1_000, Number(process.argv[process.argv.indexOf('--interval') + 1] || 1_500));
const stateFile = resolve('data', 'feige-unread-auto-service-state.json');
const blocked = /请登录|登录后|验证码|安全验证|异常访问|滑动验证|完成验证/i;
const ignored = /(系统消息|智能客服|现在是人工客服|查阅一下|用户超时|客服.*接入|已读|发送|当前会话|咨询宝贝|邀请下单|计算价格|规格属性|尺码表|近6个月|机器人接待中|撤回)/;
const question = /(？|\?|材质|尺码|有货|库存|价格|多少钱|发货|退货|换货|质量|优惠)/;

async function connect() {
  const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json()).catch(() => null);
  if (!version?.webSocketDebuggerUrl) throw new Error('本地抖店连接器未启动。');
  return puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
}
async function loadState() { try { return JSON.parse(await readFile(stateFile, 'utf8')); } catch { return { handled: {} }; } }
async function saveState(state) { await mkdir(resolve(stateFile, '..'), { recursive: true }); await writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8'); }
async function api(page, path, options = {}) {
  const result = await page.evaluate(async ({ path, options }) => { const response = await fetch(path, options); return { ok: response.ok, body: await response.json().catch(() => ({})) }; }, { path, options });
  if (!result.ok) throw new Error(result.body?.error || '私有后台请求失败。');
  return result.body;
}
async function conversationCards(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-qa-id="qa-conversation-chat-item"]')].map((node, index) => {
    const title = node.querySelector('[title]')?.getAttribute('title') || '';
    const preview = (node.innerText || '').replace(/\s+/g, ' ').trim();
    const listIdentity = node.getAttribute('data-btm-id') || node.getAttribute('data-kora') || '';
    return { index, title, preview, key: `${listIdentity}|${index}|${title}` };
  }).filter((item) => item.title));
}
async function composerEmpty(page) {
  return page.evaluate(() => {
    const node = document.querySelector('[contenteditable="true"], textarea, [role="textbox"]');
    if (!node) return true;
    return node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement ? !node.value.trim() : !(node.textContent || '').trim();
  });
}
async function openCard(page, index) {
  return page.evaluate((target) => {
    const node = document.querySelectorAll('[data-qa-id="qa-conversation-chat-item"]')[target];
    if (!(node instanceof HTMLElement)) return false;
    node.click(); return true;
  }, index);
}
async function activeQuestion(page) {
  return page.evaluate(() => {
    const lines = (document.body?.innerText || '').split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const all = lines.join(' ');
    const product = /用户正在查看商品[^。]{0,80}\s+(.{4,180}?)\s+[¥￥]/.exec(all)?.[1] || /咨询宝贝\s+(.{4,180}?)\s+[¥￥]/.exec(all)?.[1] || '';
    const events = [...document.querySelectorAll('[data-qa-id="qa-message-warpper"]')].map((wrapper) => {
      const customer = wrapper.querySelector('.messageNotMe');
      const shop = wrapper.querySelector('.messageIsMe');
      const container = wrapper.querySelector('[data-id]');
      // 飞鸽的正常客户消息也带有 leaveMessageWrapper，不能以它判断撤回。
      // 只有消息本身明确显示“撤回”才跳过。
      const raw = (wrapper.innerText || '').replace(/\s+/g, ' ').trim();
      return { id: container?.getAttribute('data-id') || '', raw, text: (customer?.innerText || '').replace(/\s+/g, ' ').trim(), customer: Boolean(customer), shop: Boolean(shop), recalled: /撤回/.test(raw) };
    }).filter((item) => item.id);
    const sessionStart = events.map((item) => item.raw || '').findLastIndex((raw) => /机器人接待中/.test(raw));
    const sessionEvents = events.slice(sessionStart >= 0 ? sessionStart : 0);
    const handoffIntent = /(转人工|人工客服|真人客服|找人工|人工接待|不要机器人|投诉|举报)/;
    const handoffSystem = /(客服.*接入|现在是人工客服为您服务)/;
    // 客户提出转人工，或飞鸽提示人工已接入后，本轮会话永久停用自动回复；
    // 下一次“机器人接待中”出现时会自然形成新会话并解除锁定。
    const manualLocked = sessionEvents.some((item) => (item.customer && handoffIntent.test(item.text)) || handoffSystem.test(item.raw || ''));
    const lastDirect = events.filter((item) => item.customer || item.shop).at(-1) || null;
    const ignoredText = /(系统消息|智能客服|现在是人工客服|查阅一下|用户超时|客服.*接入|已读|发送|当前会话|咨询宝贝|邀请下单|计算价格|规格属性|尺码表|近6个月|机器人接待中|撤回)/;
    const questionText = /(？|\?|材质|尺码|有货|库存|价格|多少钱|发货|退货|换货|质量|优惠)/;
    const latest = events.filter((item) => item.customer && item.text && !item.recalled && !ignoredText.test(item.text) && questionText.test(item.text)).at(-1) || null;
    // 只有“最后一条直接消息”就是客户问题时才接待；人工刚回复过就不会重答旧问题。
    // A new “机器人接待中” marker makes a new session key. Any local safety
    // lock applies only to this session and therefore cannot block a later
    // legitimate bot session for the same customer.
    const sessionKey = sessionEvents[0]?.id || events[0]?.id || '';
    return { product, sessionKey, lastDirectId: lastDirect?.id || '', manualLocked, latest: lastDirect?.id === latest?.id ? latest : null };
  });
}
async function fillAndSend(page, text) {
  const selectors = ['[contenteditable="true"]', 'textarea', '[role="textbox"]'];
  for (const selector of selectors) {
    const composer = await page.$(selector);
    if (!composer || !await composer.boundingBox()) continue;
    const existing = await composer.evaluate((node) => node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement ? node.value.trim() : (node.textContent || '').trim());
    if (existing) throw new Error('飞鸽输入框已有内容，未自动回复。');
    await composer.click(); await page.keyboard.type(text, { delay: 0 });
    const clicked = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button, [role="button"]')].find((node) => {
        const label = (node.innerText || node.textContent || '').replace(/\s+/g, '');
        return label === '发送' && node instanceof HTMLElement && node.offsetParent !== null && !(node instanceof HTMLButtonElement && node.disabled);
      });
      if (!(button instanceof HTMLElement)) return false;
      button.click(); return true;
    });
    if (!clicked) throw new Error('未找到可用发送按钮，草稿已填入但未发送。');
    return true;
  }
  throw new Error('未找到飞鸽输入框。');
}
async function once() {
  const browser = await connect();
  try {
    const pages = await browser.pages();
    const dashboard = pages.find((page) => page.url().startsWith(dashboardUrl));
    const feige = pages.find((page) => /im\.jinritemai\.com\/pc_seller_v2/.test(page.url()));
    if (!dashboard || !feige) return { status: '等待私有后台和飞鸽工作台同时打开' };
    if (blocked.test(await feige.evaluate(() => document.body?.innerText || ''))) return { status: '等待你完成抖店登录或验证' };
    const state = await loadState();
    const cards = await conversationCards(feige);
    const currentSnapshots = Object.fromEntries(cards.map((card) => [card.key, card.preview]));
    // 第一次启动仅建立基线：绝不处理启动前的历史会话，避免对已读内容补发。
    if (!state.cardSnapshots) {
      await saveState({ ...state, cardSnapshots: currentSnapshots });
      return { status: '已建立会话基线，后续仅监听新变化', mode: sendEnabled ? '自动回复已启用' : '只预览' };
    }
    const active = await activeQuestion(feige);
    const locallyLocked = Boolean(active.sessionKey && state.sessionLocks?.[active.sessionKey]);
    if (active.manualLocked || locallyLocked) {
      await saveState({ ...state, cardSnapshots: currentSnapshots });
      return { status: '当前会话已由人工接管，自动回复已停用', mode: '人工优先' };
    }
    const priorActiveMessageId = state.activeMessageId || '';
    const activeChanged = Boolean(active.lastDirectId && priorActiveMessageId && active.lastDirectId !== priorActiveMessageId);
    state.activeMessageId = active.lastDirectId;
    // 飞鸽当前界面未提供稳定的未读 DOM 标记。只接受启动后“预览变为咨询”的会话；
    // 打开后还会二次确认最后一条真实消息属于客户，人工回复不会通过该确认。
    const changed = cards.filter((card) => state.cardSnapshots[card.key] !== undefined
      && state.cardSnapshots[card.key] !== card.preview
      && question.test(card.preview));
    state.cardSnapshots = currentSnapshots;
    let product = '';
    let latest = null;
    if (processCurrent && active.latest && !active.manualLocked && !locallyLocked) {
      ({ product, latest } = active);
    } else if (activeChanged && active.latest && !active.manualLocked && !locallyLocked) {
      ({ product, latest } = active);
    } else if (!changed.length) {
      await saveState({ ...state, cardSnapshots: currentSnapshots });
      return { status: '未发现新的客户咨询', mode: sendEnabled ? '自动回复已启用' : '只预览' };
    }
    if (!latest) {
      if (!await composerEmpty(feige)) return { status: '当前输入框有未发送内容，暂停自动切换会话' };
      const card = changed[0];
      if (!await openCard(feige, card.index)) return { status: '未能打开新的客户会话' };
      await new Promise((resolve) => setTimeout(resolve, 180));
      const selected = await activeQuestion(feige);
      if (selected.manualLocked || (selected.sessionKey && state.sessionLocks?.[selected.sessionKey])) {
        await saveState({ ...state, cardSnapshots: currentSnapshots });
        return { status: '客户已转人工或人工已接入，自动回复已暂停' };
      }
      ({ product, latest } = selected);
    }
    if ((active.manualLocked || locallyLocked) && !changed.length) {
      await saveState({ ...state, cardSnapshots: currentSnapshots });
      return { status: '当前会话已转人工，自动回复已暂停' };
    }
    if (!latest) return { status: '未读会话未识别到可安全处理的问题，已跳过' };
    if (state.handled?.[latest.id]) return { status: '该未读消息已处理过', mode: sendEnabled ? '自动回复已启用' : '只预览' };
    const answer = await api(dashboard, '/api/local-connector/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: latest.text, productHint: product }) });
    // The server grants this flag only for an exact active-product match and a
    // deterministic reply backed by confirmed store knowledge. Never infer it
    // locally from a non-empty answer.
    const safe = answer.autoSendAllowed === true;
    if (!sendEnabled || !safe) {
      state.handled = { ...(state.handled || {}), [latest.id]: { status: safe ? 'draft_only' : 'needs_human', at: new Date().toISOString() } };
      if (!safe && active.sessionKey) state.sessionLocks = { ...(state.sessionLocks || {}), [active.sessionKey]: { reason: answer.needsHuman ? '需要人工核实' : '不满足自动回复条件', at: new Date().toISOString() } };
      await saveState({ ...state, handled: Object.fromEntries(Object.entries(state.handled).slice(-500)), sessionLocks: Object.fromEntries(Object.entries(state.sessionLocks || {}).slice(-200)) });
      return { status: safe ? '已生成草稿，等待自动回复开关' : '已生成草稿并转人工，不自动发送' };
    }
    // Closing the race window: re-read the visible session immediately before
    // sending. A human reply, a transfer marker, or a newer message cancels
    // this send rather than risking an unwanted reply.
    const beforeSend = await activeQuestion(feige);
    if (beforeSend.manualLocked || beforeSend.sessionKey !== active.sessionKey || beforeSend.latest?.id !== latest.id || !await composerEmpty(feige)) {
      if (beforeSend.sessionKey) state.sessionLocks = { ...(state.sessionLocks || {}), [beforeSend.sessionKey]: { reason: '发送前检测到人工或会话变化', at: new Date().toISOString() } };
      await saveState({ ...state, handled: { ...(state.handled || {}), [latest.id]: { status: 'cancelled_for_human', at: new Date().toISOString() } }, sessionLocks: Object.fromEntries(Object.entries(state.sessionLocks || {}).slice(-200)) });
      return { status: '发送前检测到人工或会话变化，已取消自动回复', mode: '人工优先' };
    }
    await fillAndSend(feige, answer.reply);
    state.handled = { ...(state.handled || {}), [latest.id]: { status: 'sent', at: new Date().toISOString() } };
    await saveState({ ...state, handled: Object.fromEntries(Object.entries(state.handled).slice(-500)) });
    return { status: '已对明确未读的新咨询自动回复', mode: '已发送' };
  } finally { await browser.disconnect(); }
}

do {
  try {
    console.log(JSON.stringify(await once(), null, 2));
  } catch (error) {
    // 页面短暂重载、网络波动或登录跳转时保持进程存活，等待下一轮恢复。
    console.error(JSON.stringify({ status: '自动接待暂时不可用，等待自动恢复', error: error instanceof Error ? error.message : String(error) }));
  }
  if (watch) await new Promise((resolve) => setTimeout(resolve, interval));
} while (watch);
