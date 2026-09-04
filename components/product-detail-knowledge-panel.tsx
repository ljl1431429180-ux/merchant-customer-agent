'use client';

import { useEffect, useState } from 'react';

type Detail = {
  sku: string; productName: string; category: string; material: string; specifications: string;
  attributes: Record<string, string>; colors: string; sizes: string; conflicts: string[]; status: 'pending' | 'confirmed';
};

export function ProductDetailKnowledgePanel({ shopId }: { shopId: string }) {
  const [details, setDetails] = useState<Detail[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySku, setBusySku] = useState('');
  const [batchConfirming, setBatchConfirming] = useState(false);
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 8;

  async function load() {
    setLoading(true);
    try {
      if (!shopId) { setDetails([]); return; }
      const response = await fetch(`/api/product-details?shopId=${encodeURIComponent(shopId)}`, { cache: 'no-store' });
      const data = await response.json() as { details?: Detail[]; error?: string };
      if (!response.ok) throw new Error(data.error || '读取商品详情失败。');
      setDetails(data.details ?? []); setPage(1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '读取商品详情失败。');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [shopId]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('merchant-agent-product-details-updated', refresh);
    return () => window.removeEventListener('merchant-agent-product-details-updated', refresh);
  }, [shopId]);

  async function confirmDetail(detail: Detail) {
    if (detail.conflicts.length) {
      setNotice('这条资料存在冲突提示，请先核实后再确认，客服目前不会使用它。');
      return;
    }
    setBusySku(detail.sku); setNotice('');
    try {
      const response = await fetch(`/api/product-details/${encodeURIComponent(detail.sku)}/confirm?shopId=${encodeURIComponent(shopId)}`, { method: 'POST' });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '确认失败。');
      await load();
      setNotice('已确认。客服会使用这条店铺详情资料回答客户。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '确认失败。');
    } finally { setBusySku(''); }
  }

  const pending = details.filter((detail) => detail.status === 'pending');
  const readyForBatchConfirmation = pending.filter((detail) => !detail.conflicts.length);
  async function confirmAllReadyDetails() {
    if (!readyForBatchConfirmation.length) {
      setNotice('没有可批量确认的商品详情；存在冲突的资料仍需单独核实。');
      return;
    }
    if (!window.confirm(`确认将 ${readyForBatchConfirmation.length} 条无冲突的店铺商品详情加入客服知识库吗？确认后客服可引用这些资料回答客户。`)) return;
    setBatchConfirming(true); setNotice('');
    try {
      const response = await fetch(`/api/product-details/confirm-batch?shopId=${encodeURIComponent(shopId)}`, { method: 'POST' });
      const data = await response.json() as { confirmed?: number; error?: string };
      if (!response.ok) throw new Error(data.error || '批量确认失败。');
      await load();
      setNotice(`已批量确认 ${data.confirmed ?? 0} 条店铺商品详情，并已纳入客服知识库。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '批量确认失败。');
    } finally { setBatchConfirming(false); }
  }
  const pageCount = Math.max(1, Math.ceil(details.length / perPage));
  const visibleDetails = details.slice((page - 1) * perPage, page * perPage);
  return <section className="panel source-panel">
    <div className="panel-heading"><div><p className="eyebrow">第一阶段 · 店铺详情审核</p><h2>商品资料待确认区</h2></div><div className="detail-panel-actions"><span className="count-pill">{pending.length}</span>{readyForBatchConfirmation.length > 0 && <button className="save-button" type="button" disabled={Boolean(busySku) || batchConfirming} onClick={() => void confirmAllReadyDetails()}>{batchConfirming ? '正在批量确认…' : `批量确认 ${readyForBatchConfirmation.length} 条`}</button>}</div></div>
    <p className="source-note">这里仅接收本店商品详情页采集的颜色、尺码、材质和类目属性。确认后才会进入客服知识库；未确认内容不会被客服引用。</p>
    {notice && <p className="mapping-notice" role="status">{notice}</p>}
    {loading ? <p className="loading">正在读取待确认商品资料…</p> : !details.length ? <p className="empty-state">还没有待审核的店铺详情资料。完成店铺详情采集后会自动出现在这里。</p> : <><div className="source-list">{visibleDetails.map((detail) => <div className="source-row" key={detail.sku}>
      <div><strong>{detail.productName}</strong><p>SKU：{detail.sku}{detail.category ? ` · ${detail.category}` : ''}</p>
        <small className="source-facts">{[detail.material && `材质：${detail.material}`, detail.colors && `颜色：${detail.colors}`, detail.sizes && `尺码：${detail.sizes}`, ...Object.entries(detail.attributes).slice(0, 4).map(([key, value]) => `${key}：${value}`)].filter(Boolean).join(' · ') || '等待补充详情字段'}</small>
        {detail.conflicts.length > 0 && <small className="source-facts">需核实：{detail.conflicts.join('；')}</small>}
      </div>
      <div><em>{detail.status === 'confirmed' ? '已确认，可供客服使用' : detail.conflicts.length ? '存在冲突，暂不可用' : '待确认，不供客服使用'}</em>
        {detail.status === 'pending' && <button className="save-button" type="button" disabled={Boolean(busySku) || batchConfirming || Boolean(detail.conflicts.length)} onClick={() => void confirmDetail(detail)}>{busySku === detail.sku ? '正在确认…' : detail.conflicts.length ? '需先核实冲突' : '确认详情并入知识库'}</button>}
      </div>
    </div>)}</div>{details.length > perPage && <nav className="pager" aria-label="商品详情分页"><span>第 {page} / {pageCount} 页 · 共 {details.length} 条</span><button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button><button type="button" disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>下一页</button></nav>}</>}
  </section>;
}
