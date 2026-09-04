'use client';

import { useEffect, useState } from 'react';

type Shop = { id: string; name: string; platform: 'douyin' | 'taobao' | 'jd' | 'pdd' | 'other'; connector: string; status: 'ready' | 'waiting' | 'paused'; lastSyncAt: number | null };
type Connector = { platform: Shop['platform']; name: string; availability: 'ready' | 'planned'; capability: string; productFlow: string; messageFlow: string; connectionRequirement: string };
type Merchant = { id: string; displayName: string; email: string };

const statusLabel = { ready: '已就绪', waiting: '待连接', paused: '已暂停' };

export function StoreConnectionsPanel({ onShopCreated }: { onShopCreated: (shop: Shop) => void }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [showBind, setShowBind] = useState(false);
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<Shop['platform']>('douyin');
  const [binding, setBinding] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/stores', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setShops(data.shops || []); setConnectors(data.connectors || []); setMerchant(data.merchant || null);
      } finally { setLoading(false); }
    })();
  }, []);

  async function bindShop() {
    if (!name.trim() || binding) return;
    setBinding(true); setNotice('');
    try {
      const response = await fetch('/api/stores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim(), platform, connector: platform === 'douyin' ? 'local_browser' : 'manual_import' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '绑定失败。');
      setShops((current) => [...current, data.shop]); onShopCreated(data.shop); setName(''); setShowBind(false); setNotice('店铺已绑定。接下来可同步该店铺的商品资料。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '绑定失败。'); }
    finally { setBinding(false); }
  }

  return <article id="stores" className="panel store-panel">
    <div className="panel-heading"><div><p className="eyebrow">店铺与平台</p><h2>独立店铺、独立资料库</h2></div><div><button className="text-button strong-button" type="button" onClick={() => setShowBind((current) => !current)}>{showBind ? '收起' : '绑定店铺 +'}</button><span className="count-pill">{loading ? '—' : shops.length}</span></div></div>
    <p className="workspace-owner">工作空间：<strong>{merchant?.displayName || '正在确认身份'}</strong>{merchant?.email ? ` · ${merchant.email}` : ''}</p>
    <p className="store-panel-note">每个店铺将独立保存商品、详情知识库和客服会话；平台接入只读取该店铺自己确认的资料，不使用货源或成本信息。</p>
    {notice && <p className="mapping-notice" role="status">{notice}</p>}
    {showBind && <div className="product-editor"><div className="form-grid"><label>店铺名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：我的女鞋店" /></label><label>平台<select value={platform} onChange={(event) => setPlatform(event.target.value as Shop['platform'])}><option value="douyin">抖店</option><option value="taobao">淘宝/天猫</option><option value="jd">京东</option><option value="pdd">拼多多</option><option value="other">其他平台</option></select></label></div><button className="save-button" disabled={!name.trim() || binding} type="button" onClick={() => void bindShop()}>{binding ? '正在绑定…' : '确认绑定店铺'}</button></div>}
    {loading ? <p className="loading">正在读取店铺连接…</p> : <>
      {shops.map((shop) => <div className="connected-store" key={shop.id}><div><strong>{shop.name}</strong><p>{connectors.find((item) => item.platform === shop.platform)?.name || shop.platform} · 本地浏览器连接器</p></div><em className={shop.status}>{statusLabel[shop.status]}</em></div>)}
      <div className="connector-grid">{connectors.map((connector) => <div className={`connector-card ${connector.availability === 'ready' ? 'ready' : ''}`} key={connector.platform}><strong>{connector.name}</strong><span>{connector.availability === 'ready' ? '当前可用' : '接入规范已就绪'}</span><small>{connector.capability}</small><p><b>商品：</b>{connector.productFlow}</p><p><b>客服：</b>{connector.messageFlow}</p><p><b>启用条件：</b>{connector.connectionRequirement}</p></div>)}</div>
    </>}
  </article>;
}
