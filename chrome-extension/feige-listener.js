(() => {
  const question = /(？|\?|材质|鞋面|面料|真皮|颜色|色号|白色|黑色|银色|尺码|鞋码|有货|库存|价格|多少钱|发货|退货|换货|质量|优惠)/;
  const greeting = /^(?:你好|您好|哈喽|hello|hi|在吗|有人吗|有人在吗)[！!。?？~\s]*$/i;
  const handoff = /(转人工|人工客服|真人客服|找人工|人工接待|不要机器人|投诉|举报)/;
  const ignored = /(系统消息|机器人接待中|查阅一下|已读|撤回|当前会话|邀请下单)/;
  const handled = new Set();
  let timer = null;

  const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const candidateQuestion = (value) => greeting.test(compact(value)) || question.test(value) || handoff.test(value);
  const productFactQuestion = (value) => /(材质|鞋面|面料|真皮|皮料|颜色|色号|什么色|白色|黑色|银色|米色|尺码|鞋码|多大码|几码|\d{2}\s*码)/.test(value);
  const followUpReference = (value) => /(这(?:双|款|个)|这个|这鞋|该商品|它|有白色吗|有黑色吗|有银色吗)/.test(value);

  function consultingProduct() {
    const text = compact(document.body?.innerText);
    const titled = /(?:用户正在查看商品|咨询宝贝|咨询商品|商品信息|商品详情|正在咨询)\s+(.{4,180}?)\s+[¥￥]/.exec(text)?.[1];
    if (titled) return titled;

    // 飞鸽会不定期调整商品卡片的文字结构；但卡片链接通常仍保留抖店
    // 商品 ID。只有页面上恰好识别到一个候选 ID 时才使用它，避免把推荐
    // 商品或其它会话的资料误带入当前回复。
    const ids = new Set();
    for (const element of document.querySelectorAll('a[href], [data-product-id], [data-productid], [data-goods-id], [data-goodsid]')) {
      const values = [
        element.getAttribute?.('href') || '',
        element.getAttribute?.('data-product-id') || '',
        element.getAttribute?.('data-productid') || '',
        element.getAttribute?.('data-goods-id') || '',
        element.getAttribute?.('data-goodsid') || '',
      ];
      for (const value of values) {
        const match = /(?:product(?:_|)id|goods(?:_|)id|item(?:_|)id)[=/:]([0-9]{8,})/i.exec(value) || /^([0-9]{12,})$/.exec(value.trim());
        if (match?.[1]) ids.add(match[1]);
      }
    }
    return ids.size === 1 ? [...ids][0] : '';
  }

  function productIdInLink(value) {
    const source = String(value || '');
    const labeled = /(?:product(?:_|-)?id|goods(?:_|-)?id|item(?:_|-)?id|sku)[=:/：\s]+([0-9]{8,})/i.exec(source)?.[1];
    if (labeled) return labeled;
    try {
      const url = new URL(source, location.origin);
      const isDouyinProductLink = /(?:jinritemai|douyin|douyinec)/i.test(url.hostname)
        && /(?:product|goods|item|detail)/i.test(`${url.pathname}${url.search}`);
      if (isDouyinProductLink) return url.searchParams.get('product_id') || url.searchParams.get('goods_id') || url.searchParams.get('item_id') || url.searchParams.get('id') || '';
    } catch {}
    return '';
  }

  // 客户发送本店商品链接时，飞鸽通常把商品 ID 放在商品卡片的链接或
  // data-* 属性中。只接受消息卡片内唯一的 ID，避免把页面其他推荐商品误用。
  function linkedProductId(wrapper) {
    const ids = new Set();
    const elements = [wrapper, ...wrapper.querySelectorAll('*')];
    for (const element of elements) {
      const values = [element.getAttribute?.('href') || '', element.innerText || ''];
      for (const attribute of element.getAttributeNames?.() || []) {
        if (/(?:product|goods|item|sku)/i.test(attribute)) values.push(element.getAttribute(attribute) || '');
      }
      for (const value of values) {
        const productId = productIdInLink(value);
        if (productId) ids.add(productId);
      }
    }
    return ids.size === 1 ? [...ids][0] : '';
  }

  // 飞鸽的“浏览足迹 / 商品卡片”会作为一条独立消息渲染：它既不是客户
  // 气泡，也不是店铺气泡，且很多版本不会暴露商品 ID。卡片的第一行是
  // 商品标题；只有同时出现价格、保障或规格等商品卡片特征时才采纳它，
  // 避免把普通系统消息误当成当前咨询商品。
  function productTitleInCard(wrapper) {
    const raw = String(wrapper?.innerText || '');
    const compactRaw = compact(raw);
    if (!/(券后价|已售\s*\d+|保障|计算价格|邀请下单|规格\s*\/\s*属性\s*\/\s*尺码)/.test(compactRaw)) return '';
    const lines = raw.split(/\r?\n/).map(compact).filter(Boolean);
    const title = lines.find((line) => (
      line.length >= 6
      && !/^(?:￥|¥|券后价|已售|保障|优惠|物流|计算价格|邀请下单|规格\s*\/\s*属性\s*\/\s*尺码)/.test(line)
      && !/^\d+(?:\.\d+)?$/.test(line)
    ));
    return title || '';
  }

  // 商品卡片本身在飞鸽中通常没有 .messageNotMe / .messageIsMe 标记，不能只凭
  // “不是气泡”判断归属。只采纳实际显示在聊天区域左半侧的卡片；右半侧的
  // 店铺活动卡、推荐卡即使标题相同，也绝不能覆盖客户正在咨询的商品。
  function isCustomerProductCard(wrapper, title) {
    if (!wrapper || !title || !window.innerWidth) return false;
    const candidates = [wrapper, ...wrapper.querySelectorAll('*')]
      .map((element) => {
        const text = compact(element.innerText);
        const rect = element.getBoundingClientRect();
        return { text, rect, area: rect.width * rect.height };
      })
      .filter(({ text, rect }) => (
        text.includes(title)
        && /(券后价|已售\s*\d+|保障|计算价格|邀请下单|规格\s*\/\s*属性\s*\/\s*尺码)/.test(text)
        && rect.width >= 160
        && rect.height >= 60
        && rect.width <= window.innerWidth * 0.8
        && rect.height <= window.innerHeight * 0.8
      ))
      .sort((left, right) => left.area - right.area);
    const card = candidates[0];
    if (!card) return false;
    return card.rect.left + card.rect.width / 2 < window.innerWidth / 2;
  }

  function productForQuestion(list, questionIndex) {
    const current = list[questionIndex];
    const directId = /(?:^|\D)(\d{8,})(?:\D|$)/.exec(current?.text || '')?.[1] || '';
    if (directId) return { product: directId, source: 'customer_sku' };

    // 只接受紧邻的客户商品链接或商品卡片。此前的页面级“浏览足迹”兜底
    // 会把页面上任意商品误认为客户所问商品，故不再使用。
    const previousQuestionIndex = list.slice(0, questionIndex).map((item, index) => ({ item, index })).reverse()
      .find(({ item }) => item.customer && item.text && candidateQuestion(item.text))?.index;
    // 新的一条客户问题意味着上一轮上下文已经结束。商品卡片或链接必须
    // 出现在上一条客户问题之后，才可与当前问题绑定。
    const start = Math.max(previousQuestionIndex === undefined ? 0 : previousQuestionIndex + 1, questionIndex - 8);
    const nearby = list.slice(start, questionIndex).reverse()
      .find((item) => item.productHint && (item.kind === 'customer_product_card' || item.customer));
    if (nearby) return {
      product: nearby.productHint,
      source: nearby.kind === 'customer_product_card' ? 'customer_card' : 'customer_link',
    };
    return { product: '', source: 'missing' };
  }

  function events() {
    return [...document.querySelectorAll('[data-qa-id="qa-message-warpper"]')]
      .map((wrapper, index) => {
        const customer = wrapper.querySelector('.messageNotMe');
        const shop = wrapper.querySelector('.messageIsMe');
        const rawProductTitle = !customer && !shop ? productTitleInCard(wrapper) : '';
        const customerProductTitle = rawProductTitle && isCustomerProductCard(wrapper, rawProductTitle) ? rawProductTitle : '';
        const id = wrapper.querySelector('[data-id]')?.getAttribute('data-id') || `visible-${index}-${compact(wrapper.innerText).slice(0, 60)}`;
        return {
          id,
          customer: Boolean(customer),
          shop: Boolean(shop),
          kind: customerProductTitle ? 'customer_product_card' : rawProductTitle ? 'shop_product_card' : 'message',
          text: compact(customer?.innerText),
          raw: compact(wrapper.innerText),
          // 客户链接优先用不可变商品 ID；飞鸽原生商品卡片没有 ID 时则传入
          // 已在卡片内展示的完整标题，后台会执行唯一匹配后才使用已确认资料。
          productHint: customer ? linkedProductId(wrapper) : customerProductTitle,
        };
      })
      .filter((item) => item.id);
  }

  function notify(event) {
    chrome.runtime.sendMessage({ type: 'feige-agent-event', event }).catch(() => {});
  }

  function activeConversationKey() {
    const editor = chatEditor();
    const placeholder = String(editor?.getAttribute?.('placeholder') || '');
    const recipient = /发送给\s*(.+?)(?:[，,。.]|$)/.exec(placeholder)?.[1];
    // 会话上下文仅存本机扩展存储，按当前接待对象隔离；拿不到名称时不复用，
    // 宁可询问商品，也不能把另一位客户的商品带进来。
    return recipient ? `feige-recipient:${compact(recipient).slice(0, 80)}` : '';
  }

  function latestCustomerEvent() {
    const list = events();
    const index = list.map((item, itemIndex) => ({ item, itemIndex })).reverse().find(({ item }) => (
      item.customer && item.text && !ignored.test(item.text) && candidateQuestion(item.text)
    ))?.itemIndex;
    if (index === undefined) return null;
    return { event: list[index], after: list.slice(index + 1) };
  }

  function chatEditor() {
    return [...document.querySelectorAll('textarea, [contenteditable="true"]')].find((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 160 && rect.height > 20;
    });
  }

  function editorText(editor) {
    return compact(editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent);
  }

  function setEditorText(editor, text) {
    if (editor instanceof HTMLTextAreaElement) {
      // 通过原生 setter 写入，确保飞鸽的 React 状态能收到变化，而非只改
      // 页面上的显示文字。
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(editor, text);
      else editor.value = text;
    } else {
      editor.textContent = text;
    }
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function activeSendButton() {
    // 飞鸽会在 input 事件后的下一帧才启用“发送”按钮；立即查询会造成
    // 只填入、不发送的假自动回复。
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const button = sendButton();
      if (button) return button;
      await delay(120);
    }
    return null;
  }

  async function waitForOutgoingMessage(text) {
    const expected = compact(text);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (events().some((item) => item.shop && compact(item.raw).includes(expected))) return true;
      await delay(150);
    }
    return false;
  }

  // 飞鸽可配置店铺接入和首次欢迎语。它们不是人工答复，也不包含商品
  // 事实，不能因此抢占 Agent 的低风险问答；明确人工接管仍由 handoff 拦截。
  function isPlatformWelcome(item) {
    const text = compact(`${item?.text || ''} ${item?.raw || ''}`);
    return /客服\s*【?[^】\]]{1,40}[】\]]?\s*接入|欢迎光临(?:本店|小店)|请问有什么可以帮助您|欢迎咨询/.test(text);
  }

  function hasMeaningfulShopReply(after) {
    return after.some((item) => item.shop && !isPlatformWelcome(item));
  }

  function sendButton() {
    return [...document.querySelectorAll('button, [role="button"]')].find((element) => {
      const text = compact(element.innerText || element.getAttribute('aria-label'));
      // 飞鸽的可见按钮文案实际是“发 送”，而非连续的“发送”。
      // 比较时忽略所有空白字符，兼容不同页面版本的排版。
      const command = text.replace(/\s+/g, '');
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return /^(发送|send)$/i.test(command) && !element.disabled && style.visibility !== 'hidden' && rect.width > 20 && rect.height > 20;
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'feige-agent-send-safe-reply') {
      (async () => {
        const latest = latestCustomerEvent();
        // 飞鸽会重新渲染消息节点，临时 DOM ID 可能改变。只要最后一条客户
        // 问题的文字仍是 Agent 等待中的问题，就继续发送；真的出现新问题时才取消。
        const sameQuestion = compact(latest?.event?.text) === compact(message.question);
        if (!latest || (latest.event.id !== message.eventId && !sameQuestion)) return sendResponse({ ok: false, error: '客户又发送了新问题，已按最新问题重新判断。' });
        const human = handoff.test(latest.event.text) || latest.after.some((item) => /现在是人工客服(?:为您服务)?/.test(item.raw));
        const alreadyReplied = hasMeaningfulShopReply(latest.after);
        if (human || alreadyReplied) return sendResponse({ ok: false, error: '飞鸽或人工已处理，取消自动发送。' });
        const editor = chatEditor();
        const text = String(message.text || '').trim();
        if (!editor || !text || text.length > 500) return sendResponse({ ok: false, error: '未找到可安全发送的飞鸽输入框。' });
        editor.focus();
        setEditorText(editor, text);
        const button = await activeSendButton();
        if (!button) {
          return sendResponse({ ok: false, error: '飞鸽未启用发送按钮；草稿已保留在输入框，供人工检查。' });
        }
        button.click();
        if (!await waitForOutgoingMessage(text)) {
          return sendResponse({ ok: false, error: '未能确认飞鸽已发出消息；草稿已保留在输入框，供人工检查。' });
        }
        sendResponse({ ok: true });
      })().catch((error) => sendResponse({ ok: false, error: error?.message || '飞鸽自动发送失败。' }));
      return true;
    }
    if (message?.type !== 'feige-agent-fill-draft') return;
    const latest = latestCustomerEvent();
    if (!latest) return sendResponse({ ok: false, error: '未找到可填入草稿的客户问题。' });
    const human = handoff.test(latest.event.text) || latest.after.some((item) => /现在是人工客服(?:为您服务)?/.test(item.raw));
    const alreadyReplied = hasMeaningfulShopReply(latest.after);
    if (human) return sendResponse({ ok: false, error: '当前已转人工，Agent 不会填入草稿。' });
    if (alreadyReplied) return sendResponse({ ok: false, error: '飞鸽已回复，Agent 不会填入草稿。' });
    const editor = chatEditor();
    if (!editor) return sendResponse({ ok: false, error: '未找到飞鸽输入框，请重新打开会话后重试。' });
    const text = String(message.text || '').trim();
    if (!text || text.length > 800) return sendResponse({ ok: false, error: '草稿内容无效。' });
    editor.focus();
    setEditorText(editor, text);
    // 绝不触发飞鸽的发送按钮，也不会模拟 Enter 键。
    sendResponse({ ok: true, note: '草稿已填入飞鸽输入框，等待商家自行检查并发送。' });
    return true;
  });

  async function evaluate() {
    const config = await new Promise((resolve) => chrome.runtime.sendMessage({ type: 'feige-agent-state' }, resolve));
    if (!config?.enabled) return;
    const list = events();
    // 飞鸽可能在客户提问后立刻插入默认问候或智能客服回复，
    // 因此必须从末尾寻找最后一条“客户问题”，不能只看最后一条消息。
    const questionIndex = list.map((item, index) => ({ item, index })).reverse().find(({ item }) => (
      item.customer && item.text && !ignored.test(item.text) && candidateQuestion(item.text)
    ))?.index;
    if (questionIndex === undefined) return;
    const last = list[questionIndex];
    if (handled.has(last.id)) return;
    handled.add(last.id);
    setTimeout(() => {
      const latest = events();
      const currentIndex = latest.findIndex((item) => item.id === last.id);
      if (currentIndex < 0) return;
      const after = latest.slice(currentIndex + 1);
      // “客服{店铺名}接入”是飞鸽的普通会话开始提示，并不代表真人已接手；
      // 只有客户明确转人工，或页面明确提示现在由人工客服服务，才停用 Agent。
      const humanRequested = handoff.test(last.text) || after.some((item) => /现在是人工客服(?:为您服务)?/.test(item.raw));
      const shopReplied = hasMeaningfulShopReply(after);
      const context = productForQuestion(latest, currentIndex);
      if (humanRequested) {
        notify({ status: 'human_handled', question: last.text, product: context.product, note: '客户请求或系统显示已转人工；Agent 保持静默。' });
      } else if (shopReplied) {
        notify({ status: 'feige_handled', question: last.text, product: context.product, note: '飞鸽已回复；Agent 保持静默。' });
      } else {
        notify({
          status: 'agent_candidate',
          question: last.text,
          product: context.product,
          productSource: context.source,
          conversationKey: activeConversationKey(),
          productFactQuestion: productFactQuestion(last.text),
          allowsStoredContext: followUpReference(last.text),
          note: config.autoReply?.enabled
            ? '飞鸽未回复；正在进行受控自动回复校验。'
            : '飞鸽未回复；影子模式仅记录，未生成或发送消息。',
        });
      }
    }, 700);
  }

  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(evaluate, 450);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setTimeout(evaluate, 1200);
})();
