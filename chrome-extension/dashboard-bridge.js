// This script runs only on the merchant's already logged-in private dashboard.
// It is the sole component allowed to call the authenticated reply endpoint.
if (!globalThis.__merchantAgentDashboardBridgeInstalled__) {
  globalThis.__merchantAgentDashboardBridgeInstalled__ = true;
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'merchant-agent-dashboard-full-progress') {
    window.postMessage({ type: 'merchant-agent-full-sync-progress', progress: message.progress }, window.location.origin);
    sendResponse({ ok: true });
    return;
  }
  if (message?.type !== 'merchant-agent-dashboard-draft') return;
  (async () => {
    const payload = message.payload || {};
    const response = await fetch('/api/local-connector/reply', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: String(payload.text || ''), productHint: String(payload.productHint || '') }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.reply) {
      return { ok: false, error: result?.error || '私有后台暂时无法生成草稿。' };
    }
    return { ok: true, result };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || '私有后台连接失败。' }));
  return true;
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'merchant-agent-request-douyin-sync') return;
  (async () => {
    const collected = await chrome.runtime.sendMessage({ type: 'merchant-agent-collect-douyin-products' });
    if (!collected?.ok) return { ok: false, error: collected?.error || '未读取到抖店商品列表。' };
    const shopId = String(event.data.shopId || '');
    const response = await fetch(`/api/sync-runs?shopId=${encodeURIComponent(shopId)}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ products: collected.products, sourceTotal: collected.sourceTotal }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, error: result?.error || '私有后台未保存同步结果。' };
    return { ok: true, processed: result?.run?.processed || collected.products.length };
  })().then((result) => window.postMessage({ type: 'merchant-agent-sync-result', ...result }, window.location.origin))
    .catch((error) => window.postMessage({ type: 'merchant-agent-sync-result', ok: false, error: error?.message || '同步连接失败。' }, window.location.origin));
});

// The dashboard is the only place that uses the merchant's authenticated session
// to save extracted store data. The extension never receives dashboard cookies.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'merchant-agent-dashboard-known-sync') {
    (async () => {
      const shopId = encodeURIComponent(String(message.shopId || ''));
      const [productsResponse, detailsResponse] = await Promise.all([
        fetch(`/api/products?shopId=${shopId}`, { credentials: 'same-origin' }),
        fetch(`/api/product-details?shopId=${shopId}`, { credentials: 'same-origin' }),
      ]);
      const products = await productsResponse.json().catch(() => ({}));
      const details = await detailsResponse.json().catch(() => ({}));
      if (!productsResponse.ok || !detailsResponse.ok) return { ok: false, error: '无法读取已有同步记录。' };
      const isPendingFact = (value) => !String(value || '').trim() || /^(待补充|待核实|未同步|未知)$/.test(String(value || '').trim());
      const hasCustomerSafeColor = (value) => /(黑|白|灰|蓝|红|粉|紫|绿|黄|橙|棕|咖|杏|米|银|金)(?:色)?/.test(String(value || ''));
      const hasCustomerSafeSize = (value) => /\b(?:2\d|3\d|4\d|5\d)\b/.test(String(value || ''));
      const detailsBySku = new Map((details.details || []).map((item) => [String(item.sku || ''), item]));
      const needsDetailBackfill = (sku) => {
        const detail = detailsBySku.get(String(sku || ''));
        if (!detail || detail.status !== 'confirmed' || (detail.conflicts || []).length) return true;
        return isPendingFact(detail.material) || !hasCustomerSafeColor(detail.colors) || !hasCustomerSafeSize(detail.sizes);
      };
      return {
        ok: true,
        knownProductSkus: (products.products || []).map((item) => String(item.sku || '')).filter(Boolean),
        // A detail record alone is not enough: incomplete confirmed records must be read again.
        knownDetailSkus: (products.products || []).map((item) => String(item.sku || '')).filter((sku) => !needsDetailBackfill(sku)),
      };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || '读取已有同步记录失败。' }));
    return true;
  }
  if (message?.type === 'merchant-agent-dashboard-sync-batch') {
    (async () => {
      const response = await fetch(`/api/sync-runs?shopId=${encodeURIComponent(String(message.shopId || ''))}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ products: message.products, sourceTotal: message.sourceTotal }),
      });
      const result = await response.json().catch(() => null);
      return response.ok ? { ok: true, processed: result?.run?.processed || message.products?.length || 0 } : { ok: false, error: result?.error || '商品目录保存失败。' };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || '私有后台连接失败。' }));
    return true;
  }
  if (message?.type === 'merchant-agent-dashboard-detail-batch') {
    (async () => {
      const response = await fetch(`/api/product-details?shopId=${encodeURIComponent(String(message.shopId || ''))}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ details: message.details }),
      });
      const result = await response.json().catch(() => null);
      return response.ok ? { ok: true, processed: result?.processed || message.details?.length || 0 } : { ok: false, error: result?.error || '商品详情保存失败。' };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || '私有后台连接失败。' }));
    return true;
  }
});

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'merchant-agent-request-douyin-full-sync') return;
  chrome.runtime.sendMessage({ type: 'merchant-agent-start-douyin-full-sync', shopId: String(event.data.shopId || ''), detailsOnly: Boolean(event.data.detailsOnly) })
    .then((result) => {
      if (!result?.ok) window.postMessage({ type: 'merchant-agent-full-sync-progress', progress: { stage: 'failed', processed: 0, total: 0, error: result?.error || '无法启动全店同步。' } }, window.location.origin);
    })
    .catch((error) => window.postMessage({ type: 'merchant-agent-full-sync-progress', progress: { stage: 'failed', processed: 0, total: 0, error: error?.message || '同步连接失败。' } }, window.location.origin));
});

}
