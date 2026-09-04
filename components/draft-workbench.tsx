'use client';

import { useEffect, useState } from 'react';

type Draft = { id: string; customerName: string; status: 'open' | 'needs_human'; customerText: string; draftText: string; updatedAt: number };

export function DraftWorkbench({ shopId }: { shopId: string }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [notice, setNotice] = useState('');
  const [workingId, setWorkingId] = useState('');
  async function load() {
    if (!shopId) { setDrafts([]); return; }
    const response = await fetch(`/api/conversations?shopId=${encodeURIComponent(shopId)}`, { cache: 'no-store' });
    const data = await response.json();
    if (response.ok) setDrafts(data.conversations);
  }
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 10000); return () => window.clearInterval(timer); }, [shopId]);
  async function copy(item: Draft) {
    try { await navigator.clipboard.writeText(item.draftText); setNotice('草稿已复制，可在飞鸽中粘贴。'); }
    catch { setNotice('复制失败，请手动选择草稿文字。'); }
  }
  async function fill(item: Draft) {
    if (workingId) return;
    setWorkingId(item.id); setNotice('');
    try {
      const response = await fetch(`/api/connector-actions?shopId=${encodeURIComponent(shopId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: item.id, draftText: item.draftText }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '暂时无法填入。');
      setNotice('已交给本地连接器填入当前飞鸽会话，请核对后由你本人点击发送。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '暂时无法填入。'); }
    finally { setWorkingId(''); }
  }
  return <article id="drafts" className="panel draft-workbench">
    <div className="panel-heading"><div><p className="eyebrow">飞鸽草稿工作台</p><h2>人工确认后再发送</h2></div><span className="count-pill">{drafts.length}</span></div>
    <p className="model-note">这里只保存建议回复。“填入飞鸽”只会写入当前输入框，系统永远不会点击发送。</p>
    {notice && <p className="draft-notice" role="status">{notice}</p>}
    <div className="draft-list">{drafts.length ? drafts.slice(0, 8).map((item) => <div className="draft-row" key={item.id}>
      <div><strong>{item.customerName} · {item.status === 'needs_human' ? '需人工处理' : '待确认草稿'}</strong><p className="customer-question">客户：{item.customerText}</p><p className="assistant-draft">建议：{item.draftText}</p></div>
      <div className="draft-actions"><button type="button" onClick={() => void copy(item)}>复制</button>{item.status === 'open' && <button className="save-button" disabled={workingId === item.id} type="button" onClick={() => void fill(item)}>{workingId === item.id ? '准备中…' : '填入飞鸽'}</button>}</div>
    </div>) : <p className="empty-state">等待飞鸽新咨询。识别到客户问题后，草稿会自动出现在这里。</p>}</div>
  </article>;
}
