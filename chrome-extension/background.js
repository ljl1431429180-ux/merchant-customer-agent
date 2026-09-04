const DEFAULTS = {
  enabled: true,
  lastEvent: null,
  history: [],
  draft: null,
  draftState: 'idle',
  // 商家必须在扩展弹窗中主动开启；安装、更新和异常恢复后均保持关闭。
  autoReply: { enabled: false, minDelayMs: 5000, allowedIntent: 'product_facts_only', maxPerHour: 10 },
  autoPreflight: null,
};
// Replace this placeholder with the dashboard URL you deploy yourself.
const DASHBOARD_ORIGIN = 'https://your-dashboard.example.com';
const REPLY_ENDPOINT = `${DASHBOARD_ORIGIN}/api/local-connector/reply`;
const SAFE_FALLBACK_REPLY = '您好，已收到您的咨询。我正在为您核实商品信息，请稍候。';
const GREETING_REPLY = '您好，欢迎光临本店～请问想了解哪款商品、颜色、尺码或材质呢？';
const PRODUCT_CONTEXT_CLARIFICATION = '亲，为了准确核实颜色、尺码和材质，请发一下商品链接、商品卡片、商品名称或货号，我马上帮您查询～';
// 5 秒是商家设置的最短等待，不是丢弃精确资料的截止时间。资料查询允许
// 继续完成一小段时间，避免已确认的材质、颜色或尺码被过早替换为通用话术。
const FACT_LOOKUP_MAX_WAIT_MS = 8000;
const normalizedQuestion = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const isGreetingQuestion = (value) => /^(?:你好|您好|哈喽|hello|hi|在吗|有人吗|有人在吗)[！!。?？~\s]*$/i.test(String(value || '').trim());

function ensureDashboardBridge(tabId) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript({ target: { tabId }, files: ['dashboard-bridge.js'] }, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

function requestDraftFromDashboard(payload) {
  return new Promise((resolve) => chrome.tabs.query({ url: `${DASHBOARD_ORIGIN}/*` }, async (tabs) => {
    const candidates = tabs.filter((item) => item.id).sort((a, b) => Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
    if (!candidates.length) return resolve({ ok: false, error: '请先在 Chrome 打开并登录商家客服中心，再生成草稿。' });
    // 页面刚刷新或存在旧后台标签时，content script 可能稍后才就绪。对所有
    // 已打开后台标签做短暂重试，避免把一次临时连接失败误判为无法生成草稿。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const tab of candidates) {
        let response = await new Promise((done) => chrome.tabs.sendMessage(tab.id, { type: 'merchant-agent-dashboard-draft', payload }, (reply) => {
          done(chrome.runtime.lastError ? null : reply);
        }));
        // Chrome 更新扩展时，已打开的后台页可能仍保留旧的内容脚本。
        // 此处只把本扩展自己的桥接脚本补入该后台标签，不刷新页面、不读取
        // Cookie，也不向飞鸽发送消息。
        if (!response && await ensureDashboardBridge(tab.id)) {
          await wait(80);
          response = await new Promise((done) => chrome.tabs.sendMessage(tab.id, { type: 'merchant-agent-dashboard-draft', payload }, (reply) => {
            done(chrome.runtime.lastError ? null : reply);
          }));
        }
        if (response) return resolve(response);
      }
      if (attempt < 2) await wait(1000);
    }
    resolve({ ok: false, error: '私有后台连接尚未就绪，请刷新商家客服中心后重试。' });
  }));
}

function fillDraftIntoFeige(text) {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: 'https://im.jinritemai.com/pc_seller_v2/*' }, (tabs) => {
      const tab = tabs.find((item) => item.id);
      if (!tab?.id) {
        resolve({ ok: false, error: '请先在 Chrome 打开飞鸽客服会话，再填入草稿。' });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'feige-agent-fill-draft', text }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: '飞鸽页面尚未就绪，请刷新飞鸽后重试。' });
          return;
        }
        resolve(response || { ok: false, error: '飞鸽没有返回填入结果。' });
      });
    });
  });
}

function collectCurrentDouyinPage() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: 'https://fxg.jinritemai.com/ffa/g/list*' }, (tabs) => {
      const tab = tabs.find((item) => item.id);
      if (!tab?.id) return resolve({ ok: false, error: '请先打开抖店的商品管理列表页。' });
      chrome.tabs.sendMessage(tab.id, { type: 'merchant-agent-collect-douyin-products' }, (response) => {
        if (chrome.runtime.lastError) return resolve({ ok: false, error: '抖店商品列表尚未就绪，请刷新列表页后重试。' });
        resolve(response || { ok: false, error: '未读取到商品列表。' });
      });
    });
  });
}

function dashboardTab() {
  return new Promise((resolve) => chrome.tabs.query({ url: `${DASHBOARD_ORIGIN}/*` }, (tabs) => resolve(tabs.find((tab) => tab.id) || null)));
}

async function sendDashboard(type, payload) {
  const tab = await dashboardTab();
  if (!tab?.id) return { ok: false, error: '请保持商家客服中心页面打开。' };
  return new Promise((resolve) => chrome.tabs.sendMessage(tab.id, { type, ...payload }, (response) => {
    if (chrome.runtime.lastError) resolve({ ok: false, error: '商家后台页面未就绪，请刷新后重试。' });
    else resolve(response || { ok: false, error: '商家后台没有返回结果。' });
  }));
}

async function publishFullSyncProgress(progress) {
  await sendDashboard('merchant-agent-dashboard-full-progress', { progress });
  await chrome.storage.local.set({ fullSyncProgress: progress });
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// 内容脚本异常、页面重载或平台弹窗都可能让 sendMessage 永远不回调。
// 必须给每次读取设定截止时间，不能让一条商品卡住整个补齐队列。
function sendDetailCollection(tabId, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: '商品详情读取超时。' }), timeoutMs);
    try {
      chrome.tabs.sendMessage(tabId, { type: 'merchant-agent-collect-douyin-detail' }, (response) => {
        const lastError = chrome.runtime.lastError;
        finish(response || { ok: false, error: lastError?.message || '商品详情页没有返回读取结果。' });
      });
    } catch (error) {
      finish({ ok: false, error: error?.message || '无法向商品详情页发起读取。' });
    }
  });
}

// 抖店编辑页会先加载页面骨架，再异步填充类目属性。允许短暂重试，
// 但单品持续失败时必须记录为待补齐并继续下一条。
async function collectDetailWhenReady(tabId, attempts = 3) {
  let last = { ok: false, error: '商品详情页尚未加载完成。' };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await sendDetailCollection(tabId);
    if (last?.ok) return last;
    if (attempt < attempts - 1) await wait(2500);
  }
  return last;
}

async function runNextDetail() {
  const job = (await chrome.storage.local.get('fullSyncJob')).fullSyncJob;
  const candidates = Array.isArray(job?.detailCandidates) ? job.detailCandidates : [];
  const index = Number(job?.detailIndex || 0);
  if (!job?.tabId || index >= candidates.length) {
    const failedDetails = Array.isArray(job?.failedDetails) ? job.failedDetails : [];
    if (job?.listUrl) await chrome.tabs.update(job.tabId, { url: job.listUrl });
    if (job) await chrome.storage.local.set({ fullSyncJob: { ...job, status: failedDetails.length ? 'failed' : 'completed', completedAt: Date.now() } });
    await publishFullSyncProgress({
      stage: failedDetails.length ? 'failed' : 'completed',
      processed: candidates.length,
      total: candidates.length,
      catalogTotal: Number(job?.catalogTotal || job?.listingProcessed || candidates.length),
      detailProcessed: Number(job?.detailProcessed || 0),
      error: failedDetails.length ? `仍有 ${failedDetails.length} 条商品详情未读到，已保留为待补齐，不会误报完成。` : undefined,
    });
    return;
  }
  const item = candidates[index];
  const fallback = item?.productId ? `https://fxg.jinritemai.com/ffa/g/create?product_id=${encodeURIComponent(item.productId)}&entrance=edit` : '';
  const url = item?.detailUrl || fallback;
  if (!url) {
    await chrome.storage.local.set({ fullSyncJob: { ...job, detailIndex: index + 1 } });
    return runNextDetail();
  }
  await chrome.tabs.update(job.tabId, { url });
}

async function state() {
  const current = { ...DEFAULTS, ...(await chrome.storage.local.get({ ...DEFAULTS, conversationProductContexts: {} })) };
  const autoReply = { ...DEFAULTS.autoReply, ...(current.autoReply || {}) };
  return {
    ...current,
    autoReply,
  };
}

async function record(event) {
  const current = await state();
  const item = { ...event, at: new Date().toISOString() };
  const history = [item, ...(current.history || [])].slice(0, 30);
  await chrome.storage.local.set({ lastEvent: item, history });
  const handled = item.status === 'feige_handled' || item.status === 'human_handled';
  await chrome.action.setBadgeText({ text: handled ? '已接' : item.status === 'agent_candidate' ? '待办' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: handled ? '#16a34a' : '#7c3aed' });
}

async function resolveConversationProduct(event) {
  if (event?.status !== 'agent_candidate') return event;
  const current = await state();
  const contexts = { ...(current.conversationProductContexts || {}) };
  const key = String(event.conversationKey || '');
  const now = Date.now();
  const source = String(event.productSource || 'missing');
  const explicit = Boolean(event.product) && source !== 'missing';
  if (key && explicit) {
    contexts[key] = { product: String(event.product), source, updatedAt: now };
    await chrome.storage.local.set({ conversationProductContexts: contexts });
    return event;
  }
  const saved = key ? contexts[key] : null;
  const fresh = saved && now - Number(saved.updatedAt || 0) <= 20 * 60 * 1000;
  // 只有“这双鞋 / 这款”等明确追问才能沿用同一会话的已锁定商品；没有
  // 指代词的新问题不自动猜测，避免把旧商品资料答给另一件商品。
  if (!explicit && fresh && event.allowsStoredContext) {
    return { ...event, product: saved.product, productSource: 'conversation_context', contextNote: '沿用本会话已锁定商品' };
  }
  return { ...event, contextNote: event.productFactQuestion ? '未锁定咨询商品，需要客户补充商品线索' : '' };
}

function autoPreflight(event, draft, policy) {
  const question = String(event?.question || '');
  const unsafe = /(有货|库存|价格|多少钱|优惠|券|活动|发货|到货|退货|换货|物流|运费|售后|人工|投诉|举报|质量)/.test(question);
  const intents = [
    /(材质|鞋面|面料|真皮|皮料)/.test(question) ? 'material' : '',
    /(颜色|色号|什么色|黑色|白色|银色|米色)/.test(question) ? 'color' : '',
    /(尺码|鞋码|多大码|几码|\d{2}\s*码)/.test(question) ? 'size' : '',
  ].filter(Boolean);
  const productFactOnly = intents.length === 1 && !unsafe;
  const reasons = [];
  if (!event || event.status !== 'agent_candidate') reasons.push('飞鸽未处理的候选会话才可进入预检。');
  if (!draft?.text) reasons.push('尚未生成草稿。');
  // 资料不充分时绝不能自动发送具体商品事实；但也不能让客户无人回应。
  // 此时只发送固定的“正在核实”提示，后续交由人工继续处理。
  if (!draft?.fallback) {
    if (draft?.needsHuman) reasons.push('草稿已标记为需要人工处理。');
    if (draft?.productMatch !== 'matched' || !draft?.knowledgeUsed) reasons.push('未匹配到足够的已确认商品资料。');
    if (!draft?.autoSendAllowed) reasons.push('这条草稿不是仅基于已确认商品事实生成，不能自动发送。');
    if (!productFactOnly) reasons.push('仅允许单一的材质、颜色或尺码咨询；涉及价格、库存、优惠、物流、售后或多问题时转人工。');
  }
  if (!policy?.enabled || !policy?.maxPerHour) reasons.push('自动回复总开关保持关闭。');
  return {
    eligible: reasons.length === 0,
    reasons,
    policy: { minDelayMs: policy?.minDelayMs || 5000, allowedIntent: policy?.allowedIntent || 'product_facts_only' },
    checkedAt: new Date().toISOString(),
  };
}

function draftFromResult(result, event) {
  if (!result?.reply) return null;
  const autoSendAllowed = result.autoSendAllowed === true;
  const fallback = !autoSendAllowed;
  return {
    text: fallback ? fallbackText(event) : result.reply,
    needsHuman: fallback ? false : Boolean(result.needsHuman),
    productMatch: result.productMatch || 'unknown',
    knowledgeUsed: Number(result.knowledgeUsed || 0),
    autoSendAllowed: autoSendAllowed || fallback,
    fallback,
    createdAt: new Date().toISOString(),
  };
}

function fallbackText(event) {
  if (isGreetingQuestion(event?.question)) return GREETING_REPLY;
  if (event?.productFactQuestion && !event?.product) return PRODUCT_CONTEXT_CLARIFICATION;
  return SAFE_FALLBACK_REPLY;
}

function fallbackDraft(event) {
  return {
    text: fallbackText(event),
    needsHuman: false,
    productMatch: 'unknown',
    knowledgeUsed: 0,
    autoSendAllowed: true,
    fallback: true,
    createdAt: new Date().toISOString(),
  };
}

async function autoReply(event, sourceTabId) {
  const current = await state();
  if (!current.enabled || !current.autoReply?.enabled || !sourceTabId) return;
  const sent = Array.isArray(current.autoReplyHistory) ? current.autoReplyHistory : [];
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recent = sent.filter((item) => Number(item.at || 0) > hourAgo);
  if (recent.length >= Number(current.autoReply.maxPerHour || 0)) {
    await chrome.storage.local.set({ autoPreflight: { eligible: false, reasons: ['已达到每小时自动回复上限。'], checkedAt: new Date().toISOString() } });
    return;
  }
  const minimumWait = Number(current.autoReply.minDelayMs || 5000);
  const startedAt = Date.now();
  const draftRequest = requestDraftFromDashboard({ text: event.question, productHint: event.product || '' });
  // 先满足商家设定的最短等待，再给已确认资料一次短暂的完成机会。此前把
  // 5 秒同时当成“最短等待”和“查询超时”，会导致较慢但正确的资料被丢弃。
  const lookupDeadline = Math.max(minimumWait, FACT_LOOKUP_MAX_WAIT_MS);
  const connection = await Promise.race([
    draftRequest,
    wait(lookupDeadline).then(() => ({ ok: false, error: '已确认商品资料查询超时。' })),
  ]);
  const result = connection?.ok ? connection.result : null;
  const draft = draftFromResult(result, event) || fallbackDraft(event);
  const preflight = autoPreflight(event, draft, current.autoReply);
  await chrome.storage.local.set({
    draftState: 'ready',
    draft,
    autoPreflight: preflight,
    draftError: connection?.ok ? null : (connection?.error || '私有后台未返回商品资料。'),
  });
  if (!preflight.eligible) return;
  const remainingWait = Math.max(0, minimumWait - (Date.now() - startedAt));
  if (remainingWait) await wait(remainingWait);
  const latest = await state();
  // 飞鸽偶尔会在重绘消息列表时替换临时消息 ID。问题文字没有改变时，
  // 仍视为同一条待处理咨询；只有客户新发了不同问题才不发送旧答案。
  const sameQuestion = normalizedQuestion(latest.lastEvent?.question) === normalizedQuestion(event.question);
  if (!latest.autoReply?.enabled || (latest.lastEvent?.id !== event.id && !sameQuestion)) return;
  const sentReply = await new Promise((resolve) => {
    // 只发送到检测到客户问题的原始会话页，绝不从多个飞鸽标签中猜选一个。
    chrome.tabs.sendMessage(sourceTabId, {
      type: 'feige-agent-send-safe-reply',
      eventId: event.id,
      question: event.question,
      text: draft.text,
    }, (response) => {
      resolve(response || { ok: false, error: chrome.runtime.lastError?.message || '飞鸽未确认发送。' });
    });
  });
  if (!sentReply?.ok) {
    await chrome.storage.local.set({ autoPreflight: { eligible: false, reasons: [sentReply?.error || '发送前校验未通过。'], checkedAt: new Date().toISOString() } });
    return;
  }
  await chrome.storage.local.set({
    autoReplyHistory: [{ at: Date.now(), eventId: event.id }, ...recent].slice(0, 30),
    lastEvent: { ...event, status: 'agent_replied', note: draft.fallback ? '商品资料待核实，已先发送“正在核实”提示并留给人工跟进。' : '已按已确认店铺资料自动回复；未包含价格、库存、优惠、物流或售后承诺。' },
  });
  await chrome.action.setBadgeText({ text: '已回' });
  await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.local.get(DEFAULTS);
  const disableAutoReplyAfterUpdate = details.reason === 'update';
  await chrome.storage.local.set({
    ...DEFAULTS,
    ...current,
    // 扩展更新后需要商家重新确认开启，避免升级瞬间误发；不再保存第二个模式状态。
    autoReply: disableAutoReplyAfterUpdate ? { ...DEFAULTS.autoReply } : { ...DEFAULTS.autoReply, ...(current.autoReply || {}) },
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'feige-agent-event') {
    resolveConversationProduct(message.event).then(async (event) => {
      await record(event);
      if (event?.status === 'agent_candidate') await autoReply(event, sender.tab?.id);
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.type === 'feige-agent-state') {
    state().then(sendResponse);
    return true;
  }
  // 草稿只会由商家在扩展弹窗中点击触发：监听本身绝不上传会话内容。
  if (message?.type === 'feige-agent-create-draft') {
    (async () => {
      const current = await state();
      const event = current.lastEvent;
      if (!event || event.status !== 'agent_candidate') {
        return { ok: false, error: '当前会话不符合生成草稿条件。' };
      }
      await chrome.storage.local.set({ draftState: 'loading', draft: null });
      const connection = await requestDraftFromDashboard({ text: event.question, productHint: event.product || '' });
      const result = connection?.result;
      if (!connection?.ok || !result?.reply) {
        const error = connection?.error || '私有后台暂时无法生成草稿。';
        await chrome.storage.local.set({ draftState: 'error', draft: null, draftError: error });
        return { ok: false, error };
      }
      const draft = draftFromResult(result, event);
      const preflight = autoPreflight(event, draft, current.autoReply);
      await chrome.storage.local.set({ draftState: 'ready', draft, draftError: null, autoPreflight: preflight });
      return { ok: true, draft };
    })().then(sendResponse);
    return true;
  }
  if (message?.type === 'feige-agent-fill-draft') {
    (async () => {
      const current = await state();
      if (!current.enabled || current.lastEvent?.status !== 'agent_candidate' || !current.draft?.text) {
        return { ok: false, error: '当前会话不符合填入草稿条件。' };
      }
      return await fillDraftIntoFeige(current.draft.text);
    })().then(sendResponse);
    return true;
  }
  if (message?.type === 'merchant-agent-collect-douyin-products') {
    collectCurrentDouyinPage().then(sendResponse);
    return true;
  }
  if (message?.type === 'merchant-agent-start-douyin-full-sync') {
    (async () => {
      const shopId = String(message.shopId || '');
      const detailsOnly = Boolean(message.detailsOnly);
      if (!shopId) return { ok: false, error: '未识别当前店铺。' };
      const tabs = await new Promise((resolve) => chrome.tabs.query({ url: 'https://fxg.jinritemai.com/ffa/g/list*' }, resolve));
      const tab = tabs.find((item) => item.id);
      if (!tab?.id) return { ok: false, error: '请先打开抖店商品管理列表页。' };
      const known = await sendDashboard('merchant-agent-dashboard-known-sync', { shopId });
      if (!known.ok) return { ok: false, error: known.error || '商家后台未就绪，请刷新后重试。' };
      const knownProducts = [...new Set((known.knownProductSkus || []).map((sku) => String(sku || '')).filter(Boolean))];
      const knownDetails = new Set((known.knownDetailSkus || []).map((sku) => String(sku || '')).filter(Boolean));
      if (detailsOnly) {
        // 商品目录已经在后台时，直接按商品 ID 打开未确认详情，完全不再扫描
        // 商品管理的分页。这样不会依赖“下一页”，也绝不写入商品列表。
        const detailCandidates = knownProducts.filter((sku) => !knownDetails.has(sku)).map((productId) => ({
          sku: productId,
          productId,
          detailUrl: `https://fxg.jinritemai.com/ffa/g/create?product_id=${encodeURIComponent(productId)}&entrance=edit`,
        }));
        await chrome.storage.local.set({ fullSyncJob: { shopId, tabId: tab.id, listUrl: tab.url || 'https://fxg.jinritemai.com/ffa/g/list', startedAt: Date.now(), status: 'details', detailsOnly: true, catalogTotal: knownProducts.length, detailTotal: detailCandidates.length, detailCandidates, detailIndex: 0, detailProcessed: 0 } });
        await publishFullSyncProgress({ stage: 'details', processed: 0, total: detailCandidates.length, detailProcessed: 0 });
        await runNextDetail();
        return { ok: true };
      }
      await chrome.storage.local.set({ fullSyncJob: { shopId, tabId: tab.id, startedAt: Date.now(), status: 'listing', detailsOnly, knownProductSkus: known.knownProductSkus || [], knownDetailSkus: known.knownDetailSkus || [] } });
      chrome.tabs.sendMessage(tab.id, { type: 'merchant-agent-run-douyin-full-list-sync', shopId, detailsOnly, knownProductSkus: known.knownProductSkus || [], knownDetailSkus: known.knownDetailSkus || [] }, async (response) => {
        if (chrome.runtime.lastError || !response?.ok) {
          const error = response?.error || '抖店商品列表扩展未就绪，请刷新商品管理页后重试。';
          const current = (await chrome.storage.local.get('fullSyncJob')).fullSyncJob;
          if (current) await chrome.storage.local.set({ fullSyncJob: { ...current, status: 'failed', stoppedAt: Date.now(), error } });
          await publishFullSyncProgress({ stage: 'failed', processed: 0, total: 0, error });
        }
      });
      return { ok: true };
    })().then(sendResponse);
    return true;
  }
  if (message?.type === 'merchant-agent-douyin-full-list-failed') {
    (async () => {
      const job = (await chrome.storage.local.get('fullSyncJob')).fullSyncJob;
      const error = String(message.error || '全店商品目录读取失败。');
      if (job) await chrome.storage.local.set({ fullSyncJob: { ...job, status: 'failed', stoppedAt: Date.now(), error } });
      await publishFullSyncProgress({ stage: 'failed', processed: Number(job?.scanned || 0), total: Number(job?.expected || 0), error });
      return { ok: true };
    })().then(sendResponse);
    return true;
  }
  if (message?.type === 'merchant-agent-douyin-list-batch') {
    (async () => {
      const job = (await chrome.storage.local.get('fullSyncJob')).fullSyncJob;
      if (!job?.shopId) return { ok: false, error: '同步任务已失效。' };
      const saved = await sendDashboard('merchant-agent-dashboard-sync-batch', { shopId: job.shopId, products: message.products, sourceTotal: message.sourceTotal });
      await publishFullSyncProgress({ stage: saved.ok ? 'listing' : 'failed', processed: Number(message.processed || 0), total: Number(message.sourceTotal || 0), page: Number(message.page || 0), totalPages: Number(message.totalPages || 0), error: saved.error });
      return saved;
    })().then(sendResponse);
    return true;
  }
  if (message?.type === 'merchant-agent-douyin-list-progress') {
    // 目录核对阶段即使没有新增商品，也要反馈扫描进度；不写入商品资料。
    (async () => {
      const job = (await chrome.storage.local.get('fullSyncJob')).fullSyncJob;
      if (job) await chrome.storage.local.set({ fullSyncJob: { ...job, status: 'listing', scanned: Number(message.processed || 0), expected: Number(message.sourceTotal || 0), page: Number(message.page || 0), totalPages: Number(message.totalPages || 0) } });
      await publishFullSyncProgress({
        stage: 'listing',
        processed: Number(message.processed || 0),
        total: Number(message.sourceTotal || 0),
        page: Number(message.page || 0),
        totalPages: Number(message.totalPages || 0),
      });
      return { ok: true };
    })().then(sendResponse);
    return true;
  }
  if (message?.type === 'merchant-agent-douyin-full-list-complete') {
    (async () => {
      const job = (await chrome.storage.local.get('fullSyncJob')).fullSyncJob;
      if (!job?.shopId) return { ok: false };
      // Detail extraction intentionally stays in the same user tab and is queued
      // in small batches by the page script. It never submits an edit form.
      await chrome.storage.local.set({ fullSyncJob: { ...job, status: 'details', scanned: Number(message.processed || 0), expected: Number(message.sourceTotal || message.processed || 0), detailCandidates: message.products || [], listingProcessed: message.processed || 0 } });
      await publishFullSyncProgress({ stage: 'details', processed: 0, total: Number(message.processed || 0) });
      await runNextDetail();
      return { ok: true };
    })().then(sendResponse);
    return true;
  }
  if (message?.type === 'merchant-agent-douyin-detail-ready') {
    (async () => {
      const job = (await chrome.storage.local.get('fullSyncJob')).fullSyncJob;
      if (!job?.tabId || Number(job.tabId) !== Number(sender.tab?.id)) return { ok: false };
      await wait(2500);
      const detail = await collectDetailWhenReady(job.tabId);
      if (detail?.ok) await sendDashboard('merchant-agent-dashboard-detail-batch', { shopId: job.shopId, details: [detail.detail] });
      const currentItem = Array.isArray(job.detailCandidates) ? job.detailCandidates[Number(job.detailIndex || 0)] : null;
      const failedDetails = detail?.ok ? (job.failedDetails || []) : [...(job.failedDetails || []), { sku: String(currentItem?.sku || ''), error: String(detail?.error || '详情未加载完成。') }];
      const next = { ...job, detailIndex: Number(job.detailIndex || 0) + 1, detailProcessed: Number(job.detailProcessed || 0) + (detail?.ok ? 1 : 0), failedDetails };
      await chrome.storage.local.set({ fullSyncJob: next });
      await publishFullSyncProgress({ stage: 'details', processed: Number(next.detailIndex), total: Number(next.detailTotal || next.listingProcessed || 0), catalogTotal: Number(next.catalogTotal || next.listingProcessed || 0), detailProcessed: Number(next.detailProcessed || 0) });
      await runNextDetail();
      return { ok: true };
    })().then(sendResponse);
    return true;
  }
});
