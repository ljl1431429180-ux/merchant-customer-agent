(() => {
  const labels = ['材质', '帮面材质', '鞋面材质', '鞋面内里材质', '鞋底材质', '鞋跟高度', '鞋头款式', '鞋跟款式', '风格', '功能', '闭合方式', '适用季节', '商品类型'];
  function valueFor(raw, label) {
    const lines = raw.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const index = lines.findIndex((line) => line.replace(/^\*\s*/, '') === label);
    if (index < 0) return '';
    return lines.slice(index + 1, index + 4).find((line) => line && !/^请选择|^\*|^(颜色分类|鞋码大小|商品规格|图文信息)/.test(line) && !labels.includes(line.replace(/^\*\s*/, ''))) || '';
  }
  function collect() {
    const raw = document.body?.innerText || '';
    const url = new URL(location.href); const productId = url.searchParams.get('product_id') || '';
    const title = [...document.querySelectorAll('input')].map((input) => input.value || '').find((value) => value.length > 6 && value.length < 160 && /[\u4e00-\u9fff]/.test(value)) || '';
    const sku = [...document.querySelectorAll('input')].map((input) => input.value || '').find((value) => /^[A-Za-z]#?\d{5,}$/.test(value))?.replace(/^[A-Za-z]#/, '') || '';
    const attributes = Object.fromEntries(labels.map((label) => [label, valueFor(raw, label)]).filter(([, value]) => value));
    const colorBlock = /颜色分类([\s\S]{0,1200}?)(?:鞋码大小|添加规格类型)/.exec(raw)?.[1] || '';
    const colors = [...new Set(colorBlock.split(/\n+/).map((line) => line.trim()).filter((line) => /[\u4e00-\u9fff]/.test(line) && !/添加|上传|自定义|请选择|颜色分类/.test(line)))].slice(0, 40).join('、');
    const sizeBlock = /鞋码大小([\s\S]{0,600}?)(?:添加规格类型|图文信息)/.exec(raw)?.[1] || '';
    const sizes = [...new Set(sizeBlock.match(/\b(?:2\d|3\d|4\d|5\d)\b/g) || [])].join('、');
    const category = /([\u4e00-\u9fff]+\s*>\s*[\u4e00-\u9fff]+(?:\s*>\s*[\u4e00-\u9fff]+)?)/.exec(raw)?.[1] || '';
    const material = attributes['鞋面材质'] || attributes['帮面材质'] || attributes['材质'] || attributes['鞋面内里材质'] || '';
    // 商品详情知识库的唯一键必须与商品目录一致，即 URL 中的抖店 product_id。
    // 货号可能为空、重复或随商品配置变化，不能再作为详情去重依据。
    if (!productId || !title || !raw.includes('类目属性')) return { ok: false, error: `商品 ${productId || ''} 的详情页尚未加载完成。` };
    return { ok: true, detail: { sku: productId, productId, productCode: sku, productName: title, category, material, specifications: `颜色：${colors}；尺码：${sizes}`, attributes, colors, sizes, conflicts: [] } };
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'merchant-agent-collect-douyin-detail') return;
    sendResponse(collect());
  });
  chrome.runtime.sendMessage({ type: 'merchant-agent-douyin-detail-ready' }).catch(() => undefined);
})();
