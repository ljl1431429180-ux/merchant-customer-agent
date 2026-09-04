'use client';

import { useEffect, useState } from 'react';

// Keep this panel versioned with the full-store collector release.

type Run = { id: string; platform: string; scope: string; sourceTotal: number; processed: number; status: 'completed' | 'failed'; detail: string; createdAt: number };
type Progress = { stage: 'listing' | 'details' | 'completed' | 'failed'; processed: number; total: number; catalogTotal?: number; detailProcessed?: number; page?: number; totalPages?: number; error?: string };

export function SyncTaskPanel({ shopId }: { shopId: string }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [detailsOnly, setDetailsOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  async function load() {
    if (!shopId) return setRuns([]);
    const response = await fetch(`/api/sync-runs?shopId=${encodeURIComponent(shopId)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setRuns(data.runs || []);
  }
  useEffect(() => { void load(); }, [shopId]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'merchant-agent-sync-result') return;
      setBusy(false);
      setNotice(event.data.ok ? `本页已同步 ${event.data.processed} 条商品资料。` : (event.data.error || '同步失败。'));
      if (event.data.ok) void load();
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [shopId]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'merchant-agent-full-sync-progress') return;
      const next = event.data.progress as Progress;
      setProgress(next); setBusy(!['completed', 'failed'].includes(next.stage));
      if (next.stage === 'completed') {
        setNotice(detailsOnly ? `已核对 ${next.catalogTotal || next.processed} 条商品，已重新读取 ${next.detailProcessed || 0} 条缺字段或待确认详情。` : `全店目录已同步 ${next.processed} 条，详情待审核资料 ${next.detailProcessed || 0} 条。`);
        setDetailsOnly(false); void load();
        window.dispatchEvent(new Event('merchant-agent-product-details-updated'));
      }
      if (next.stage === 'failed') setNotice(next.error || '全店同步暂停，可稍后重新开始。');
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [shopId, detailsOnly]);
  function sync() {
    if (!shopId || busy) return;
    setBusy(true); setNotice('正在读取抖店当前商品页…');
    window.postMessage({ type: 'merchant-agent-request-douyin-sync', shopId }, window.location.origin);
  }
  function collectMissingDetails() {
    if (!shopId || busy) return;
    setDetailsOnly(true); setBusy(true); setProgress({ stage: 'details', processed: 0, total: 0 });
    setNotice('正在使用已同步商品资料，直接读取待确认或缺少颜色、尺码、材质的详情；不扫描商品管理分页，不新增或覆盖商品列表…');
    window.postMessage({ type: 'merchant-agent-request-douyin-full-sync', shopId, detailsOnly: true }, window.location.origin);
  }
  const latest = runs[0];
  return <section className="panel sync-panel">
    <div className="panel-heading"><div><p className="eyebrow">商品同步任务</p><h2>从抖店读取商品与详情</h2></div><div className="sync-actions"><button className="quiet-button" type="button" disabled={busy || !shopId} onClick={sync}>同步当前页</button><button className="save-button" type="button" disabled={busy || !shopId} onClick={collectMissingDetails}>{busy ? '正在读取…' : '补齐待核实字段'}</button></div></div>
    <p className="source-note">“补齐待核实字段”直接使用已同步商品的商品 ID，逐个读取待确认或缺少颜色、尺码、材质的详情；不扫描商品管理分页，不新增、覆盖或重复同步商品列表。全程只读、不修改抖店。</p>
    {notice && <p className="mapping-notice" role="status">{notice}</p>}
    {progress && progress.stage !== 'completed' && <div className="sync-summary"><strong>{progress.stage === 'listing' ? '正在同步商品目录' : progress.stage === 'details' ? '正在读取商品详情' : '详情读取未完成'}</strong><span>{progress.processed} / {progress.total || '…'} 条{progress.stage === 'listing' && progress.page ? ` · 第 ${progress.page}${progress.totalPages ? ` / ${progress.totalPages}` : ''} 页` : ''}</span><small>{progress.stage === 'failed' ? (progress.error || '请稍后只补齐未完成商品。') : '可保持当前抖店页面打开；中断后可从未完成商品继续。'}</small></div>}
    {latest ? <div className="sync-summary"><strong>最近同步：{new Date(latest.createdAt).toLocaleString('zh-CN', { hour12: false })}</strong><span>本页 {latest.processed} 条 · 店铺共 {latest.sourceTotal} 件</span><small>{latest.detail}</small></div> : <p className="empty-state">暂无同步记录。请保持抖店商品列表页打开后开始首次同步。</p>}
  </section>;
}
