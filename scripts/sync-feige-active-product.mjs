import puppeteer from 'puppeteer-core';

const dashboardUrl = process.env.DASHBOARD_URL || 'https://your-dashboard.example.com';
const categoryId = process.argv[process.argv.indexOf('--category') + 1] || '1000007624';
const blocked = /请登录|登录后|验证码|安全验证|异常访问|滑动验证|完成验证/i;
const attributesToRead = ['鞋面材质', '帮面材质', '材质', '鞋面内里材质', '鞋底材质', '鞋头款式', '闭合方式', '风格'];

const tidy = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const compact = (value) => tidy(value).replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '').toLowerCase();
const money = (value) => Math.round(Number(/(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)/.exec(value)?.[1] || 0) * 100);
const stock = (value) => Number(/库存[^\d]{0,8}(\d{1,8})/.exec(value)?.[1] || 0);

async function connect() {
  const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json()).catch(() => null);
  if (!version?.webSocketDebuggerUrl) throw new Error('本地抖店连接器未启动。请运行 D 盘项目里的 open-douyin-feige-connector.ps1 并登录一次抖店。');
  return puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
}

async function api(page, path, options = {}) {
  const result = await page.evaluate(async ({ path, options }) => {
    const response = await fetch(path, options);
    return { ok: response.ok, body: await response.json().catch(() => ({})) };
  }, { path, options });
  if (!result.ok) throw new Error(result.body?.error || '私有后台未就绪。');
  return result.body;
}

async function activeProductTitle(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const visit = /用户正在查看商品[^。]{0,80}\s+(.{4,180}?)\s+[¥￥]/.exec(text)?.[1];
    if (visit) return visit.trim();
    const tab = /咨询宝贝\s+(.{4,180}?)\s+[¥￥]/.exec(text)?.[1];
    return tab?.trim() || '';
  });
}

async function findProductRow(page, title) {
  const target = compact(title);
  const rows = await page.evaluate(() => [...document.querySelectorAll('tbody tr, [role="row"], [class*="table-row" i], [class*="tableRow" i]')]
    .map((node) => ({ text: (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(), links: [...node.querySelectorAll('a')].map((link) => ({ text: link.textContent || '', href: link.href || '' })) }))
    .filter((item) => item.text.includes('ID：')));
  return rows.map((row) => {
    const titlePart = row.text.split(/\s+ID：/)[0].trim();
    const candidate = compact(titlePart);
    const pairs = new Set(Array.from({ length: Math.max(target.length - 1, 0) }, (_, index) => target.slice(index, index + 2)));
    const overlap = [...pairs].filter((pair) => candidate.includes(pair)).length;
    return { ...row, title: titlePart, score: target === candidate ? 1 : pairs.size ? overlap / pairs.size : 0 };
  }).filter((row) => row.score >= 0.72).sort((a, b) => b.score - a.score)[0] || null;
}

async function searchProduct(page, title) {
  const inputs = await page.evaluate(() => [...document.querySelectorAll('input')].map((input) => ({
    placeholder: input.getAttribute('placeholder') || '', value: input.value || '', type: input.type || ''
  })));
  const field = inputs.find((input) => /商品|标题|名称|关键词/.test(input.placeholder));
  if (!field?.placeholder) return false;
  const selector = `input[placeholder=${JSON.stringify(field.placeholder)}]`;
  const input = await page.$(selector);
  if (!input) return false;
  await input.click({ clickCount: 3 });
  await page.keyboard.type(title, { delay: 4 });
  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((node) => /查询|搜索/.test((node.innerText || node.textContent || '').trim()));
    if (!button) return false;
    (button instanceof HTMLElement ? button : null)?.click();
    return true;
  });
  if (clicked) await new Promise((resolve) => setTimeout(resolve, 1800));
  return clicked;
}

function addStockFromText(text, perSizeStock, seenSkuIds) {
  // 抖店的价格列可能因虚拟表格渲染而为空：此时“￥”后第一个数字就是库存；
  // 正常渲染时则是“价格 + 库存”。两种情况都只累计最后一个数字。
  for (const match of String(text || '').matchAll(/(?:^|\s)(\d{2})\s+￥(?:\s+\d+(?:\.\d+)?)?\s+(\d{1,8})\s+增\s+减\s+\d{1,8}\s+清空\s+-\s+(\d{12,})/g)) {
    const size = match[1];
    const quantity = Number(match[2]);
    const skuId = match[3];
    if (seenSkuIds.has(skuId)) continue;
    seenSkuIds.add(skuId);
    perSizeStock[size] = (perSizeStock[size] || 0) + quantity;
  }
}

function extractDetail(raw, title, sku, stockRows = [], stockValues = []) {
  const read = (label) => new RegExp(`${label}\\s+([^\\n]{1,100})`).exec(raw)?.[1]?.trim() || '';
  const attrs = Object.fromEntries(attributesToRead.map((label) => [label, read(label)]).filter(([, value]) => value));
  const material = attrs['鞋面材质'] || attrs['帮面材质'] || attrs['材质'] || attrs['鞋面内里材质'] || '待补充';
  const colorBlock = /颜色分类([\s\S]{0,700}?)(?:鞋码大小|添加规格类型)/.exec(raw)?.[1] || '';
  const colors = [...new Set(colorBlock.split(/\n+/).map(tidy).filter((value) => value && /[\u4e00-\u9fff]/.test(value) && !/添加|上传|请选择|下移|上移|自定义|排序/.test(value)))].join('、') || '待补充';
  const sizeBlock = /鞋码大小([\s\S]{0,400}?)添加规格类型/.exec(raw)?.[1] || '';
  const sizes = [...new Set(sizeBlock.match(/\b(?:2\d|3\d|4\d|5\d)\b/g) || [])].join('、') || '待补充';
  const perSizeStock = {};
  const seenSkuIds = new Set();
  const stockSection = raw.slice(Math.max(0, raw.lastIndexOf('价格与库存')));
  // 虚拟库存表有滚动快照时，以带 SKUID 的行去重；否则退回整页文本。
  for (const row of (stockRows.length ? stockRows : [stockSection])) {
    addStockFromText(row, perSizeStock, seenSkuIds);
  }
  const sizeList = sizes.match(/\b(?:2\d|3\d|4\d|5\d)\b/g) || [];
  for (const [index, quantity] of stockValues.entries()) {
    const size = sizeList[index % sizeList.length];
    if (size && Number.isFinite(quantity)) perSizeStock[size] = (perSizeStock[size] || 0) + quantity;
  }
  if (Object.keys(perSizeStock).length) attrs['分码库存'] = JSON.stringify(perSizeStock);
  return { sku, productName: title, category: '', material, specifications: `颜色：${colors}；尺码：${sizes}`, attributes: attrs, colors, sizes, perSizeStock, conflicts: [] };
}

const browser = await connect();
try {
  const pages = await browser.pages();
  const dashboard = pages.find((page) => page.url().startsWith(dashboardUrl));
  const feige = pages.find((page) => /im\.jinritemai\.com\/pc_seller_v2/.test(page.url()));
  if (!dashboard || !feige) throw new Error('请在本地连接器浏览器中同时打开并登录私有后台和飞鸽会话。');
  if (blocked.test(tidy(await feige.evaluate(() => document.body?.innerText || '')))) throw new Error('抖店需要登录或验证，请由你本人完成后再运行。');
  const title = await activeProductTitle(feige);
  if (!title) throw new Error('未识别到当前飞鸽咨询商品，请先打开一个带商品卡片的会话。');

  const list = await browser.newPage();
  await list.goto('https://fxg.jinritemai.com/ffa/g/list', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await new Promise((resolve) => setTimeout(resolve, 2500));
  let row = await findProductRow(list, title);
  if (!row && await searchProduct(list, title)) row = await findProductRow(list, title);
  if (!row) throw new Error(`商品管理当前页未找到“${title}”。连接器会保留该会话，下一次商品同步会自动重试。`);
  const productId = /ID：(\d{8,})/.exec(row.text)?.[1] || '';
  const sku = /货号：[A-Za-z]#([^\s]+)/.exec(row.text)?.[1] || productId;
  const editUrl = row.links.find((link) => /编辑|修改/.test(link.text) && /product_id=\d+/.test(link.href))?.href || `https://fxg.jinritemai.com/ffa/g/create?product_id=${productId}&cid=${categoryId}&entrance=edit`;
  const existingDetail = (await browser.pages()).find((page) => page.url().includes(`product_id=${productId}`));
  const detail = existingDetail || await browser.newPage();
  if (!existingDetail) {
    await detail.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await new Promise((resolve) => setTimeout(resolve, 3500));
  }
  const detailData = await detail.evaluate(async () => {
    const holder = document.querySelector('.ecom-g-table-tbody-virtual-holder');
    const stockRows = [];
    if (holder instanceof HTMLElement) {
      const positions = [...new Set([0, Math.max(0, holder.scrollHeight - holder.clientHeight)])];
      for (const position of positions) {
        holder.scrollTop = position;
        holder.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 220));
        stockRows.push(holder.innerText || holder.textContent || '');
      }
      holder.scrollTop = 0;
      holder.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    return {
      raw: document.body?.innerText || '',
      stockRows,
      stockValues: [],
    };
  });
  const raw = detailData.raw;
  if (!raw.includes('商品规格')) throw new Error('商品详情未完成加载，连接器会在下次同步重试。');
  const facts = extractDetail(raw, title, sku, detailData.stockRows, detailData.stockValues);
  await api(dashboard, '/api/products/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ products: [{ sku, name: title, category: '待同步类目', color: facts.colors, size: facts.sizes, material: facts.material, priceCents: money(row.text), stock: stock(row.text) }] }) });
  await api(dashboard, '/api/product-details', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ details: [facts] }) });
  console.log(JSON.stringify({ synced: true, productId, sku, title, material: facts.material, colors: facts.colors, sizes: facts.sizes, perSizeStock: facts.perSizeStock, mode: '从飞鸽当前商品自动读取抖店详情并写入待审核区；不发送客服消息，也不会自动确认或覆盖客服知识。' }, null, 2));
  if (!existingDetail) await detail.close();
  await list.close();
} finally {
  await browser.disconnect();
}
