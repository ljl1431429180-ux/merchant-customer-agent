'use client';

import { useEffect, useMemo, useState } from 'react';

type Product = { id: string; name: string; sku: string; color: string; size: string };
type Source = { id: string; sourceTitle: string; sourceProductId: string; material: string; status: 'pending' | 'enriched' | 'needs_authorization' | 'failed'; knowledgeStatus: 'pending' | 'confirmed'; linkedProductId: string | null; linkedProductName: string; linkedProductSku: string; recommendedProductId: string | null; recommendedProductName: string; matchConfidence: number | null };

export function SourceMappingPanel() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [productResponse, sourceResponse] = await Promise.all([fetch('/api/products', { cache: 'no-store' }), fetch('/api/sources', { cache: 'no-store' })]);
      const productData = await productResponse.json() as { products?: Product[]; error?: string };
      const sourceData = await sourceResponse.json() as { sources?: Source[]; error?: string };
      if (!productResponse.ok || !sourceResponse.ok) throw new Error(productData.error || sourceData.error || '读取对应资料失败。');
      const enriched = (sourceData.sources ?? []).filter((source) => source.status === 'enriched');
      setProducts(productData.products ?? []); setSources(enriched); setSelectedIds((current) => current.filter((id) => enriched.some((source) => source.id === id)));
    } catch (error) { setNotice(error instanceof Error ? error.message : '读取对应资料失败，请刷新后重试。'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function requestLink(source: Source, productId: string) {
    const response = await fetch(`/api/sources/${source.id}/link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId }) });
    const data = await response.json() as { product?: Product; error?: string };
    if (!response.ok) throw new Error(data.error || '关联失败。');
    return data.product;
  }
  async function link(source: Source) {
    const productId = selections[source.id] ?? source.recommendedProductId ?? '';
    if (!productId) { setNotice('请先为这条货源选择对应的抖店商品。'); return; }
    setBusyId(source.id); setNotice('');
    try { const product = await requestLink(source, productId); await load(); setNotice(`已关联到“${product?.name ?? '对应商品'}”。`); }
    catch (error) { setNotice(error instanceof Error ? error.message : '关联失败，请稍后重试。'); }
    finally { setBusyId(''); }
  }
  async function unlink(source: Source) {
    if (!window.confirm(`确定解除“${source.linkedProductName}”与这条 1688 货源的关联吗？`)) return;
    setBusyId(source.id); setNotice('');
    try { const response = await fetch(`/api/sources/${source.id}/link`, { method: 'DELETE' }); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error || '解除关联失败。'); await load(); setNotice('关联已解除。'); }
    catch (error) { setNotice(error instanceof Error ? error.message : '解除关联失败，请稍后重试。'); }
    finally { setBusyId(''); }
  }

  const selected = useMemo(() => sources.filter((source) => selectedIds.includes(source.id)), [sources, selectedIds]);
  const linkedCount = sources.filter((source) => source.linkedProductId).length;
  const allSelected = Boolean(sources.length) && selectedIds.length === sources.length;
  function toggle(sourceId: string) { setSelectedIds((current) => current.includes(sourceId) ? current.filter((id) => id !== sourceId) : [...current, sourceId]); }

  async function batchLink() {
    const candidates = selected.filter((source) => !source.linkedProductId);
    const ready = candidates.map((source) => ({ source, productId: selections[source.id] ?? source.recommendedProductId ?? '' })).filter((item) => item.productId);
    if (!ready.length) { setNotice('请勾选尚未关联、且已选定对应商品的资料。'); return; }
    if (!window.confirm(`确认批量关联 ${ready.length} 条货源资料吗？未选定商品的记录会跳过。`)) return;
    setBusyId('batch-link'); setNotice(''); let success = 0; let failed = 0;
    for (const item of ready) { try { await requestLink(item.source, item.productId); success += 1; } catch { failed += 1; } }
    await load(); setSelectedIds([]); setBusyId(''); setNotice(`批量关联完成：成功 ${success} 条${failed ? `，失败 ${failed} 条` : ''}。`);
  }
  async function batchConfirmLinkedKnowledge() {
    const candidates = selected.filter((source) => source.linkedProductId && source.knowledgeStatus !== 'confirmed');
    if (!candidates.length) { setNotice('请勾选已关联、且仍待确认的货源资料。'); return; }
    if (!window.confirm(`确认将 ${candidates.length} 条已关联资料批量纳入客服知识库吗？`)) return;
    setBusyId('batch-confirm'); setNotice(''); let success = 0; let failed = 0;
    for (const source of candidates) { try { const response = await fetch(`/api/sources/${source.id}/confirm`, { method: 'POST' }); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error); success += 1; } catch { failed += 1; } }
    await load(); setSelectedIds([]); setBusyId(''); setNotice(`批量确认完成：${success} 条已进入知识库${failed ? `，${failed} 条未成功` : ''}。`);
  }
  async function autoLink() {
    if (!window.confirm('自动关联所有匹配度达到 75% 的已采集货源吗？低匹配记录将保留待复核，且不会自动进入客服知识库。')) return;
    setBusyId('auto-link'); setNotice('');
    try {
      const response = await fetch('/api/sources/auto-link', { method: 'POST' });
      const data = await response.json() as { linked?: number; eligible?: number; failed?: number; error?: string };
      if (!response.ok) throw new Error(data.error || '自动关联失败。');
      await load(); setNotice(`自动匹配完成：${data.eligible || 0} 条高匹配候选，已关联 ${data.linked || 0} 条${data.failed ? `，失败 ${data.failed} 条` : ''}。`);
    } catch (error) { setNotice(error instanceof Error ? error.message : '自动关联失败，请稍后重试。'); }
    finally { setBusyId(''); }
  }

  return <section className="panel mapping-panel">
    <div className="panel-heading"><div><p className="eyebrow">第一阶段 · 商品对应</p><h2>抖店商品 ↔ 1688 货源</h2></div><span className="count-pill">{linkedCount}/{sources.length}</span></div>
    <p className="mapping-note">系统会根据标题、SKU、颜色、尺码和材质自动评分。点击“自动关联高匹配”即可处理 75% 以上的候选；低匹配资料保留给你复核，批量确认只处理已关联且已采集完成的资料。</p>
    {notice && <p className="mapping-notice" role="status">{notice}</p>}
    {loading ? <p className="loading">正在读取可关联商品…</p> : !products.length ? <p className="empty-state">请先导入抖店商品资料，再进行货源对应。</p> : !sources.length ? <p className="empty-state">暂时没有已采集的货源资料可供对应。</p> : <><div className="mapping-batch-bar"><label><input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : sources.map((source) => source.id))} /> 全选</label><span>已选 {selected.length} 条</span><button className="auto-match-button" type="button" disabled={Boolean(busyId)} onClick={() => void autoLink()}>{busyId === 'auto-link' ? '正在自动匹配…' : '自动关联高匹配'}</button><button className="text-button" type="button" disabled={Boolean(busyId) || !selected.length} onClick={() => void batchLink()}>{busyId === 'batch-link' ? '正在关联…' : '批量关联'}</button><button className="save-button" type="button" disabled={Boolean(busyId) || !selected.length} onClick={() => void batchConfirmLinkedKnowledge()}>{busyId === 'batch-confirm' ? '正在确认…' : '批量确认关联资料'}</button></div><div className="mapping-list">{sources.map((source) => <div className="mapping-row" key={source.id}><label className="mapping-check"><input type="checkbox" checked={selectedIds.includes(source.id)} onChange={() => toggle(source.id)} aria-label={`选择 ${source.sourceTitle}`} /></label><div className="mapping-source"><strong>{source.sourceTitle}</strong><p>1688 货源 ID：{source.sourceProductId}{source.material ? ` · 材质：${source.material}` : ''}</p></div><div className="mapping-actions">{source.linkedProductId ? <><span className="linked-badge">已关联：{source.linkedProductName} · {source.linkedProductSku}</span><button className="text-button" type="button" disabled={Boolean(busyId)} onClick={() => void unlink(source)}>{busyId === source.id ? '正在解除…' : '解除关联'}</button></> : <><select aria-label={`为 ${source.sourceTitle} 选择抖店商品`} value={selections[source.id] ?? source.recommendedProductId ?? ''} onChange={(event) => setSelections((current) => ({ ...current, [source.id]: event.target.value }))} disabled={Boolean(busyId)}><option value="">选择抖店商品</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku} · {product.color} {product.size}码</option>)}</select>{source.recommendedProductId && <small>推荐：{source.recommendedProductName}（匹配度 {source.matchConfidence}%）</small>}<button className="save-button" type="button" disabled={Boolean(busyId)} onClick={() => void link(source)}>{busyId === source.id ? '正在关联…' : '确认关联'}</button></>}</div></div>)}</div></>}
  </section>;
}
