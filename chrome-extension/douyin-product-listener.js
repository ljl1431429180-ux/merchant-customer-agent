(() => {
  const number = (value) => Number(String(value || '').replace(/[^\d.]/g, ''));
  function detectSourceTotal(minimum = 0) {
    const totals = [...document.body.innerText.matchAll(/共\s*(\d+)\s*(?:件商品|条商品|条)/g)].map((match) => Number(match[1] || 0));
    return Math.max(minimum, ...totals, 0);
  }
  function collectRows(rows) {
    return rows.map((row) => {
      const text = (row.innerText || '').replace(/\s+/g, ' ').trim();
      const productCode = text.match(/货号：A#?([^\s]+)/)?.[1] || '';
      const detailLink = [...row.querySelectorAll('a')].find((link) => (link.href || '').includes('product_id='));
      const detailUrl = detailLink?.href || '';
      // 抖店有些列表行会延迟渲染“ID：”文字，但详情链接一直带着
      // product_id。优先同时兼容两种来源，不能因为展示文本变化而漏商品。
      const productId = text.match(/(?:商品\s*)?ID\s*[：:](\d{8,})/)?.[1]
        || detailUrl.match(/[?&]product_id=(\d{8,})/)?.[1]
        || '';
      const name = text.match(/^\.?\s*(.*?)\s*(?:商品\s*)?ID\s*[：:]/)?.[1]?.trim()
        || (detailLink?.textContent || '').replace(/\s+/g, ' ').trim()
        || `商品 ${productId}`;
      const price = text.match(/￥\s*([\d.]+)/)?.[1];
      const stockText = text.match(/￥\s*[\d.]+(?:\s*~\s*￥?\s*[\d.]+)?\s+(\d+)\s+/)?.[1];
      // 抖店不同商品行的库存、价格区间格式并不完全一致；以商品 ID
      // 作为唯一识别条件，缺失字段留待详情审核补齐，绝不能直接漏掉整条商品。
      if (!productId) return null;
      const stock = stockText === undefined ? 0 : number(stockText);
      // “货号”并不是抖店商品的唯一值：同一货号可以对应多个上架商品。
      // 后台的 sku 字段在同步通道中存放抖店商品 ID，避免把不同商品合并；
      // 原货号仍随详情页属性一起保留，供审核查看。
      return { sku: productId, productCode, name, productId, detailUrl, priceCents: Math.round(number(price) * 100), stock, listingStatus: stock > 0 ? 'active' : 'out_of_stock' };
    }).filter(Boolean);
  }
  function collect() {
    const products = collectRows([...document.querySelectorAll('table tbody tr')]);
    const sourceTotal = detectSourceTotal(products.length);
    return { ok: Boolean(products.length), products, sourceTotal, error: products.length ? '' : '当前页未识别到完整商品行，请确认已打开抖店商品列表。' };
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'merchant-agent-collect-douyin-products') return;
    sendResponse(collect());
  });
  async function pause(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function virtualProductScroller() {
    const row = document.querySelector('table tbody tr');
    for (let node = row?.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY || '') && node.scrollHeight > node.clientHeight + 24) return node;
    }
    return null;
  }
  async function collectWholeCurrentPage() {
    const bySku = new Map();
    const capture = () => {
      for (const product of collectRows([...document.querySelectorAll('table tbody tr')])) bySku.set(product.sku, product);
    };
    capture();
    const scroller = virtualProductScroller();
    if (!scroller) {
      const products = [...bySku.values()];
      return { ok: Boolean(products.length), products, sourceTotal: detectSourceTotal(products.length), error: products.length ? '' : '当前页未识别到完整商品行。' };
    }
    // 抖店列表采用虚拟滚动：DOM 中同时只保留屏幕可见行。逐段滚动并汇总
    // 每次渲染的行，才能拿到一个分页内完整的 20 条左右商品。
    const originalTop = scroller.scrollTop;
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    await pause(300);
    for (let rounds = 0; rounds < 80; rounds += 1) {
      capture();
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (scroller.scrollTop >= maximum - 2) break;
      const nextTop = Math.min(maximum, scroller.scrollTop + Math.max(120, Math.floor(scroller.clientHeight * 0.7)));
      if (nextTop <= scroller.scrollTop) break;
      scroller.scrollTop = nextTop;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      await pause(260);
    }
    capture();
    scroller.scrollTop = originalTop;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    const products = [...bySku.values()];
    return { ok: Boolean(products.length), products, sourceTotal: detectSourceTotal(products.length), error: products.length ? '' : '当前页未识别到完整商品行。' };
  }
  function isDisabled(item) {
    const control = item?.closest?.('button, a, li, [role="button"]') || item;
    const text = `${control?.className || ''} ${control?.getAttribute?.('aria-disabled') || ''}`;
    return Boolean(control?.disabled) || control?.getAttribute?.('aria-disabled') === 'true' || /disabled|is-disabled/i.test(text);
  }
  function pageControl(item) {
    return item?.closest?.('button, a, li, [role="button"]') || item || null;
  }
  function paginationState() {
    const roots = [...document.querySelectorAll('[class*="pagination" i], [class*="pager" i]')];
    const root = roots.find((item) => /下一页|上一页|共\s*\d+|\d+\s*\/\s*\d+/.test(item.innerText || '')) || document.body;
    const text = (root.innerText || '').replace(/\s+/g, ' ').trim();
    const current = text.match(/(?:第\s*)?(\d+)\s*(?:\/|页\s*\/)/)?.[1]
      || [...root.querySelectorAll('[class*="active" i], [aria-current="page"]')].map((item) => (item.textContent || '').trim()).find((item) => /^\d+$/.test(item))
      || '1';
    const totalPages = text.match(/共\s*(\d+)\s*页/)?.[1]
      || text.match(/\/\s*(\d+)\s*页?/)?.[1]
      || '';
    return { root, current: Number(current), totalPages: Number(totalPages || 0) };
  }
  function nextPage() {
    const { root } = paginationState();
    const candidates = [...root.querySelectorAll('button, a, li, [role="button"], span, i')];
    const label = (item) => `${item.textContent || ''} ${item.getAttribute?.('aria-label') || ''} ${item.getAttribute?.('title') || ''}`.replace(/\s+/g, ' ').trim();
    const found = candidates.find((item) => /^(下一页|下页|next|›|>)$/i.test(label(item)) || /下一页|next page/i.test(label(item)));
    const control = pageControl(found);
    return control && !isDisabled(control) ? control : null;
  }
  function previousPage() {
    const { root } = paginationState();
    const candidates = [...root.querySelectorAll('button, a, li, [role="button"], span, i')];
    const label = (item) => `${item.textContent || ''} ${item.getAttribute?.('aria-label') || ''} ${item.getAttribute?.('title') || ''}`.replace(/\s+/g, ' ').trim();
    const found = candidates.find((item) => /^(上一页|上页|previous|‹|<)$/i.test(label(item)) || /上一页|previous page/i.test(label(item)));
    const control = pageControl(found);
    return control && !isDisabled(control) ? control : null;
  }
  function pageNumber(pageNumber) {
    // 抖店列表的页码有稳定的 class。优先使用它，避免通用分页容器
    // 在页面较复杂时命中到其它隐藏分页组件。
    const direct = document.querySelector(`.ecom-g-pagination-item-${pageNumber}`);
    const directControl = pageControl(direct);
    if (directControl && !isDisabled(directControl)) return directControl;
    const { root } = paginationState();
    const target = String(pageNumber);
    const candidates = [...root.querySelectorAll('button, a, li, [role="button"], span')];
    const found = candidates.find((item) => (item.textContent || '').trim() === target);
    const control = pageControl(found);
    return control && !isDisabled(control) ? control : null;
  }
  async function waitForRowsToChange(before) {
    for (let wait = 0; wait < 20; wait += 1) {
      await pause(500);
      const after = [...document.querySelectorAll('table tbody tr')].map((row) => row.innerText || '').join('|');
      if (after && after !== before) return true;
    }
    return false;
  }
  async function returnToFirstPage() {
    const page = paginationState();
    if (page.current <= 1) return;
    const first = pageNumber(1);
    if (first) {
      first.click();
      for (let wait = 0; wait < 12; wait += 1) {
        await pause(500);
        if (paginationState().current === 1) return;
      }
    }
    // 某些抖店分页在末页不会展示页码 1；此时逐页点击“上一页”回退。
    for (let rounds = 0; rounds < 20; rounds += 1) {
      const current = paginationState().current;
      if (current <= 1) return;
      const previous = previousPage();
      if (!previous) break;
      const before = [...document.querySelectorAll('table tbody tr')].map((row) => row.innerText || '').join('|');
      previous.click();
      await waitForRowsToChange(before);
      if (paginationState().current === 1) return;
    }
    throw new Error('未能切换回商品列表第 1 页，已停止读取；请刷新商品管理页后重试。');
  }
  async function syncAllPages(knownProductSkus = [], knownDetailSkus = [], detailsOnly = false) {
    const seen = new Set(); const missingProducts = []; const missingDetails = []; const knownProducts = new Set(knownProductSkus); const knownDetails = new Set(knownDetailSkus); let sourceTotal = 0; let rounds = 0;
    // A previous interrupted run can leave the merchant page on its last page.
    // Full-store sync must always restart from page 1, otherwise it would only
    // see that final page and falsely report an incomplete store catalog.
    await returnToFirstPage();
    while (rounds++ < 60) {
      const current = await collectWholeCurrentPage();
      if (!current.ok) throw new Error(current.error);
      sourceTotal = Math.max(sourceTotal, current.sourceTotal);
      const newProducts = [];
      for (const product of current.products) {
        if (seen.has(product.sku)) continue;
        seen.add(product.sku);
        if (!knownProducts.has(product.sku)) { missingProducts.push(product); newProducts.push(product); }
        if (!knownDetails.has(product.sku)) missingDetails.push(product);
      }
      const page = paginationState();
      // “补全未确认详情”模式绝不写入商品列表；仅扫描链接并读取缺失详情。
      if (!detailsOnly && newProducts.length) await chrome.runtime.sendMessage({ type: 'merchant-agent-douyin-list-batch', products: newProducts, sourceTotal, processed: seen.size, page: page.current, totalPages: page.totalPages });
      // 已有商品不会再写入后台，但仍必须上报每一页的扫描进度。
      // 否则“仅补全详情”时会长时间停在 0，让商家无法判断任务是否仍在运行。
      await chrome.runtime.sendMessage({ type: 'merchant-agent-douyin-list-progress', processed: seen.size, sourceTotal, page: page.current, totalPages: page.totalPages });
      // 只有唯一商品数与商品管理页总数严格一致，才允许宣布目录读取完成。
      if (seen.size === sourceTotal) break;
      if (seen.size > sourceTotal) throw new Error(`商品总数检测异常：已识别 ${seen.size} 条，但商品管理页显示 ${sourceTotal} 条；已停止，未读取详情。`);
      const next = nextPage();
      if (!next) {
        throw new Error(`商品列表停在第 ${page.current || 1} 页，未找到可用的“下一页”按钮；请不要把当前页 ${seen.size} 条当作全店数据。`);
      }
      const before = [...document.querySelectorAll('table tbody tr')].map((row) => row.innerText || '').join('|');
      next.click();
      if (!(await waitForRowsToChange(before))) throw new Error(`商品列表切换到第 ${page.current + 1} 页超时，请刷新商品管理页后重试。`);
    }
    if (seen.size !== sourceTotal) throw new Error(`商品目录未读取完整：已识别 ${seen.size} / ${sourceTotal} 条；已自动停止，未读取详情。`);
    await chrome.runtime.sendMessage({ type: 'merchant-agent-douyin-full-list-complete', products: missingDetails, processed: seen.size, sourceTotal, newProducts: missingProducts.length });
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'merchant-agent-run-douyin-full-list-sync') return;
    // Acknowledge immediately so the service worker does not wait for a long
    // pagination run. Failures are reported through a dedicated progress event.
    sendResponse({ ok: true, started: true });
    syncAllPages(message.knownProductSkus || [], message.knownDetailSkus || [], Boolean(message.detailsOnly)).catch((error) => chrome.runtime.sendMessage({ type: 'merchant-agent-douyin-full-list-failed', error: error?.message || '全店列表读取失败。' }));
    return true;
  });
})();
