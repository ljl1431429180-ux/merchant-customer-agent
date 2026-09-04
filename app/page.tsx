'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AccountMenu } from '@/components/account-menu';
import { DraftWorkbench } from '@/components/draft-workbench';
import { ProductDetailKnowledgePanel } from '@/components/product-detail-knowledge-panel';
import { StoreConnectionsPanel } from '@/components/store-connections-panel';
import { SyncTaskPanel } from '@/components/sync-task-panel';

type ChatMessage = { from: 'customer' | 'agent'; text: string };
type Product = { id: string; sku: string; name: string; category: string; color: string; size: string; material: string; priceCents: number; stock: number; status: 'active' | 'out_of_stock' | 'off_shelf' };
type ProductDraft = Omit<Product, 'id' | 'status'>;
type HandoffTicket = { id: string; customerName: string; reason: string; createdAt: number };
type Shop = { id: string; name: string; platform: 'douyin' | 'taobao' | 'jd' | 'pdd' | 'other'; status: 'ready' | 'waiting' | 'paused' };
type Merchant = { id: string; displayName: string; email: string };

function normalizedProductName(value: string) {
  return value.toLowerCase().replace(/[\s\-—_·•，,。.!！?？()（）\[\]【】]/g, '');
}

const initialMessages: ChatMessage[] = [
  { from: 'customer', text: '这双黑色单鞋有 37 码吗？' },
  { from: 'agent', text: '您好，请提供商品名称、颜色或尺码，我帮您核对店铺商品资料。' },
];
const emptyDraft: ProductDraft = { sku: '', name: '', category: '女鞋', color: '', size: '', material: '', priceCents: 19900, stock: 0 };
const columns = { name: ['商品名称', '商品名', '商品标题', '名称'], sku: ['SKU', 'sku', 'SKU编码', 'SKU 编码', '规格编码', '商品编码'], category: ['分类', '商品分类', '类目'], color: ['颜色', '颜色分类'], size: ['尺码', '规格', '鞋码'], material: ['材质', '面料', '鞋面材质'], price: ['售价', '价格', '商品价格', '售卖价'], stock: ['库存', '可售库存', '库存数量'] };

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [question, setQuestion] = useState('这双鞋的鞋面是什么材质？');
  const [products, setProducts] = useState<Product[]>([]);
  const [tickets, setTickets] = useState<HandoffTicket[]>([]);
  const [notice, setNotice] = useState('');
  const [conversationId, setConversationId] = useState('');
  const [replying, setReplying] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [modelConfigured, setModelConfigured] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [importPreview, setImportPreview] = useState<ProductDraft[]>([]);
  const [rejectedRows, setRejectedRows] = useState(0);
  const [importing, setImporting] = useState(false);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [activeShopId, setActiveShopId] = useState('');
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [productPage, setProductPage] = useState(1);
  const [cleaningLegacy, setCleaningLegacy] = useState(false);
  const productsPerPage = 10;
  const stockTotal = useMemo(() => products.reduce((total, item) => total + item.stock, 0), [products]);
  const activeCount = products.filter((item) => item.status === 'active' && item.stock > 0).length;
  const productPageCount = Math.max(1, Math.ceil(products.length / productsPerPage));
  const visibleProducts = products.slice((productPage - 1) * productsPerPage, productPage * productsPerPage);
  // A title collision is only an audit clue, never authorization to remove data.
  // It makes historical SKU-rule migrations visible before any cleanup can be requested.
  const duplicateTitleGroups = useMemo(() => {
    const groups = new Map<string, Product[]>();
    for (const product of products) {
      const key = normalizedProductName(product.name);
      if (!key) continue;
      groups.set(key, [...(groups.get(key) || []), product]);
    }
    return [...groups.values()].filter((group) => group.length > 1);
  }, [products]);
  const duplicateCandidateCount = duplicateTitleGroups.reduce((total, group) => total + group.length - 1, 0);

  function withShop(path: string) { return activeShopId ? `${path}${path.includes('?') ? '&' : '?'}shopId=${encodeURIComponent(activeShopId)}` : path; }
  async function loadWorkspace() {
    setWorkspaceLoading(true);
    try {
      const response = await fetch('/api/stores', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '请先登录。');
      const loadedShops = data.shops ?? [];
      setMerchant(data.merchant ?? null); setShops(loadedShops);
      const remembered = window.localStorage.getItem('merchant-active-shop');
      const selected = loadedShops.find((shop: Shop) => shop.id === remembered)?.id || data.activeShopId || loadedShops[0]?.id || '';
      setActiveShopId(selected);
    } catch (error) { setNotice(error instanceof Error ? error.message : '请先登录。'); }
    finally { setWorkspaceLoading(false); }
  }
  async function loadProducts() {
    if (!activeShopId) return;
    setLoadingProducts(true);
    try {
      const response = await fetch(withShop('/api/products'), { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setProducts(data.products ?? []); setProductPage(1);
    } catch { setNotice('商品数据暂时无法读取，请刷新后重试。'); }
    finally { setLoadingProducts(false); }
  }
  async function loadTickets() {
    if (!activeShopId) return;
    const response = await fetch(withShop('/api/tickets'), { cache: 'no-store' });
    const data = await response.json();
    if (response.ok) setTickets(data.tickets ?? []);
  }
  async function loadModelStatus() {
    const response = await fetch('/api/model/status', { cache: 'no-store' }).catch(() => null);
    if (response?.ok) setModelConfigured(Boolean((await response.json()).configured));
  }
  useEffect(() => { void loadWorkspace(); void loadModelStatus(); }, []);
  useEffect(() => { if (activeShopId) { window.localStorage.setItem('merchant-active-shop', activeShopId); setProductPage(1); void loadProducts(); void loadTickets(); setConversationId(''); setMessages(initialMessages); } }, [activeShopId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (!text || replying) return;
    setMessages((current) => [...current, { from: 'customer', text }]); setQuestion(''); setReplying(true);
    try {
      const response = await fetch(withShop('/api/chat'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, conversationId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setConversationId(data.conversationId); setMessages((current) => [...current, { from: 'agent', text: data.reply }]);
      if (data.needsHuman) { await loadTickets(); setNotice('这条问题已进入人工待办，系统不会擅自处理。'); }
      else if (data.knowledgeUsed) setNotice(`本次回答使用了 ${data.knowledgeUsed} 条已确认的店铺商品资料。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : '查询失败。'); }
    finally { setReplying(false); }
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch(withShop('/api/products'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error ?? '保存失败。'); return; }
    await loadProducts(); setDraft(emptyDraft); setShowEditor(false); setNotice('商品已保存，客服可立即查询基础商品资料。');
  }
  async function changeStock(product: Product, direction: number) {
    const response = await fetch(withShop(`/api/products/${product.id}`), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stock: Math.max(0, product.stock + direction) }) });
    if (response.ok) await loadProducts(); else setNotice('库存更新失败。');
  }
  async function removeProduct(product: Product) {
    if (!window.confirm(`确定删除“${product.name}”吗？删除后客服不再引用它。`)) return;
    const response = await fetch(withShop(`/api/products/${product.id}`), { method: 'DELETE' });
    if (response.ok) await loadProducts(); else setNotice('删除失败。');
  }
  async function cleanupVerifiedLegacy() {
    if (!window.confirm('将删除已核对的 9 条历史重复/测试记录，并保留 110 条当前抖店商品。已确认的商品详情会自动保留到对应当前商品。是否继续？')) return;
    setCleaningLegacy(true);
    try {
      const response = await fetch(withShop('/api/products/cleanup-legacy'), { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '清理未完成。');
      await loadProducts();
      setNotice(`已清理 ${data.removed} 条历史记录；${data.knowledgeMoved ? '已保留 1 条已确认商品详情。' : '客服知识未受影响。'}`);
    } catch (error) { setNotice(error instanceof Error ? error.message : '清理未完成。'); }
    finally { setCleaningLegacy(false); }
  }
  function cell(row: Record<string, unknown>, names: string[]) { const key = Object.keys(row).find((item) => names.includes(item.trim())); return key ? String(row[key] ?? '').trim() : ''; }
  function amount(value: string) { const result = Number(value.replace(/[￥¥,\s]/g, '')); return Number.isFinite(result) && result >= 0 ? result : null; }
  async function readImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
      let rejected = 0;
      const parsed = rows.map((row) => {
        const price = amount(cell(row, columns.price)); const stock = amount(cell(row, columns.stock));
        const item: ProductDraft = { name: cell(row, columns.name), sku: cell(row, columns.sku), category: cell(row, columns.category) || '未分类', color: cell(row, columns.color), size: cell(row, columns.size), material: cell(row, columns.material), priceCents: price === null ? -1 : Math.round(price * 100), stock: stock === null ? -1 : Math.round(stock) };
        if (!item.name || !item.sku || item.priceCents < 0 || item.stock < 0) { rejected += 1; return null; }
        return item;
      }).filter((item): item is ProductDraft => item !== null).slice(0, 500);
      setImportPreview(parsed); setRejectedRows(rejected); setNotice(parsed.length ? `已读取 ${parsed.length} 条店铺商品。` : '没有识别到完整商品资料。');
    } catch { setNotice('文件读取失败，请上传 CSV、XLSX 或 XLS。'); }
  }
  async function confirmImport() {
    if (!importPreview.length) return;
    setImporting(true);
    try {
      const response = await fetch(withShop('/api/products/import'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ products: importPreview }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      await loadProducts(); setImportPreview([]); setShowImport(false); setNotice(`已导入 ${data.processed} 条店铺商品；同 SKU 会更新价格和库存。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : '导入失败。'); }
    finally { setImporting(false); }
  }

  if (!workspaceLoading && !merchant) return <main className="login-shell"><section className="login-card"><span className="brand-mark">店</span><h1>商家客服中心</h1><p>登录后才能绑定店铺、同步商品资料和使用客服助手。每个登录账号的数据彼此独立。</p><a className="save-button login-button" href="/signin-with-chatgpt?return_to=/" target="_top">用 ChatGPT 账号登录</a></section></main>;
  return <main className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">店</span><span>商家客服中心</span></div><div className="store-picker"><span className="tiny-label">当前商家</span><strong>{merchant?.displayName || '正在登录…'}</strong>{shops.length ? <select aria-label="切换店铺" value={activeShopId} onChange={(event) => setActiveShopId(event.target.value)}>{shops.map((shop) => <option value={shop.id} key={shop.id}>{shop.name} · {shop.platform === 'douyin' ? '抖店' : shop.platform}</option>)}</select> : <span className="store-subtitle">请在下方绑定第一家店铺</span>}</div><nav aria-label="后台导航"><a className="nav-item active" href="#overview">▦ 概览</a><a className="nav-item" href="#conversations">◌ 客服会话</a><a className="nav-item" href="#products">◇ 商品与库存</a><a className="nav-item" href="#stores">⌂ 店铺连接</a><a className="nav-item" href="#handoff">↗ 人工接管</a></nav><div className="sidebar-footer"><span className="status-dot" />客服助手已开启</div></aside>
    <section className="content">
      <header className="topbar"><div><p className="eyebrow">第 7 阶段 · 店铺商品知识</p><h1>同步店铺商品，建立客服知识库</h1></div><AccountMenu /></header>
      {notice && <div className="notice" role="status">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
      <section id="overview" className="metrics"><article><span>商品款数</span><strong>{loadingProducts ? '—' : products.length}</strong><small>当前店铺商品库</small></article><article><span>可售商品</span><strong>{loadingProducts ? '—' : activeCount}</strong><small>库存大于 0 的款式</small></article><article><span>现有库存</span><strong>{loadingProducts ? '—' : stockTotal}</strong><small>由客服查询</small></article><article><span>当前连接</span><strong>已就绪</strong><small>店铺商品连接器</small></article></section>
      <section className="workspace-grid">
        <article id="conversations" className="panel simulator"><div className="panel-heading"><div><p className="eyebrow">客服模拟器</p><h2>店铺商品事实优先的智能回答</h2></div><span className={`live-badge ${modelConfigured ? '' : 'pending-badge'}`}>● {modelConfigured ? '千问已接入' : '等待模型配置'}</span></div><p className="model-note">只读取已确认的店铺商品资料；资料不足、售后、物流和尺码建议一律转人工。</p><div className="chat-window" aria-live="polite">{messages.map((message, index) => <div className={`message ${message.from}`} key={`${message.text}-${index}`}><span>{message.from === 'customer' ? '客' : 'AI'}</span><p>{message.text}</p></div>)}</div><form onSubmit={(event) => void submit(event)} className="chat-form"><label htmlFor="question" className="sr-only">模拟客户提问</label><input id="question" disabled={replying} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="输入客户的问题…" /><button type="submit" disabled={replying}>{replying ? '查询中' : '发送'}</button></form><div className="quick-questions"><button onClick={() => setQuestion('黑色单鞋 37 码有货吗？')} type="button">问库存</button><button onClick={() => setQuestion('黑色单鞋是什么材质？')} type="button">问商品资料</button><button onClick={() => setQuestion('我要退款')} type="button">测试转人工</button></div></article>
        <article id="products" className="panel product-panel"><div className="panel-heading"><div><p className="eyebrow">商品与库存</p><h2>店铺商品资料库</h2></div><div className="product-actions"><button className="text-button" type="button" onClick={() => setShowImport((current) => !current)}>{showImport ? '收起导入' : '批量导入'}</button><button className="text-button strong-button" type="button" onClick={() => setShowEditor((current) => !current)}>{showEditor ? '收起' : '新增商品 +'}</button></div></div>{showImport && <section className="import-box"><strong>导入店铺商品表</strong><p>支持 CSV、XLSX、XLS；相同 SKU 自动更新。</p><label className="file-button">选择商品表<input type="file" accept=".csv,.xlsx,.xls" onChange={readImportFile} /></label>{importPreview.length > 0 && <div className="import-preview"><p>准备导入 <strong>{importPreview.length}</strong> 条 {rejectedRows ? `，${rejectedRows} 条资料不完整被跳过` : ''}</p><button type="button" className="save-button" disabled={importing} onClick={() => void confirmImport()}>{importing ? '正在导入…' : '确认导入商品'}</button></div>}</section>}{showEditor && <form className="product-editor" onSubmit={saveProduct}><div className="form-grid">{(['name', 'sku', 'color', 'size', 'material'] as const).map((field) => <label key={field}>{({ name: '商品名称', sku: 'SKU 编码', color: '颜色', size: '尺码', material: '材质' }[field])}<input required value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} /></label>)}<label>售价（元）<input required min="0" type="number" value={draft.priceCents / 100} onChange={(event) => setDraft({ ...draft, priceCents: Math.round(Number(event.target.value) * 100) })} /></label><label>当前库存<input required min="0" type="number" value={draft.stock} onChange={(event) => setDraft({ ...draft, stock: Number(event.target.value) })} /></label></div><button className="save-button" type="submit">保存商品资料</button></form>}{!loadingProducts && duplicateCandidateCount > 0 && <section className="mapping-notice"><strong>发现 {duplicateCandidateCount} 条疑似历史重复记录，尚未清理。</strong><p>这 7 条标题重复记录与 2 条早期测试商品已完成核对。点击下方按钮即可一次清理 9 条，已确认的商品详情会保留给当前商品。</p><button type="button" className="save-button" disabled={cleaningLegacy} onClick={() => void cleanupVerifiedLegacy()}>{cleaningLegacy ? '正在清理…' : '清理已核对的 9 条历史记录'}</button><ul>{duplicateTitleGroups.slice(0, 12).map((group) => <li key={group[0].name}>{group[0].name}：{group.map((item) => item.sku).join('、')}</li>)}</ul></section>}{loadingProducts ? <p className="loading">正在读取商品资料…</p> : <>{visibleProducts.map((product) => <div className="product-row" key={product.id}><div className={`shoe-shape ${product.color.includes('黑') ? 'black' : 'beige'}`} /><div><strong>{product.name}</strong><p>{product.color || '待补充'} · {product.size || '待补充'} 码 · {product.material || '待补充'}</p><span>¥{(product.priceCents / 100).toFixed(0)} · {product.sku}</span></div><div className="stock-controls"><em className={product.status === 'off_shelf' ? 'out-stock' : product.stock ? '' : 'out-stock'}>{product.status === 'off_shelf' ? '已下架' : product.stock ? `库存 ${product.stock}` : '暂时缺货'}</em><div><button type="button" onClick={() => void changeStock(product, -1)}>−</button><button type="button" onClick={() => void changeStock(product, 1)}>+</button><button className="remove-button" type="button" onClick={() => void removeProduct(product)}>×</button></div></div></div>)}{products.length > productsPerPage && <nav className="pager" aria-label="商品资料分页"><span>第 {productPage} / {productPageCount} 页 · 共 {products.length} 条</span><button type="button" disabled={productPage === 1} onClick={() => setProductPage((page) => Math.max(1, page - 1))}>上一页</button><button type="button" disabled={productPage === productPageCount} onClick={() => setProductPage((page) => Math.min(productPageCount, page + 1))}>下一页</button></nav>}</>}</article>
      </section>
      <SyncTaskPanel shopId={activeShopId} />
      <ProductDetailKnowledgePanel shopId={activeShopId} />
      <DraftWorkbench shopId={activeShopId} />
      <section className="lower-grid"><article id="handoff" className="panel compact-panel"><div className="panel-heading"><div><p className="eyebrow">人工接管</p><h2>需要你处理的咨询</h2></div><span className="count-pill">{tickets.length}</span></div>{tickets[0] ? <div className="handoff-row"><span className="avatar">客</span><div><strong>{tickets[0].customerName} · 待处理</strong><p>{tickets[0].reason}</p></div></div> : <p className="empty-state">暂无人工待办；售后、物流、尺码建议等问题会自动进入这里。</p>}</article><StoreConnectionsPanel onShopCreated={(shop) => { setShops((current) => [...current, shop]); setActiveShopId(shop.id); }} /></section>
    </section>
  </main>;
}
