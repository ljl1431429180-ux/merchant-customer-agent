'use client';

import { useEffect, useState } from 'react';

type Workspace = { displayName: string; email: string };

export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/workspace', { cache: 'no-store' });
        const data = await response.json();
        if (response.ok) setWorkspace(data.merchant || null);
      } catch { /* The private Site already enforces sign-in; keep the menu usable if lookup is delayed. */ }
    })();
  }, []);

  return <div className="account-menu"><button className="profile" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>{workspace?.displayName || '当前账号'} <span>⌄</span></button>{open && <div className="account-popover"><strong>{workspace?.displayName || '商家工作空间'}</strong><small>{workspace?.email || '正在确认账号…'}</small><p>切换或退出后会回到登录页。每个登录账号只能查看和管理自己的店铺资料。</p><a href="/signout-with-chatgpt?return_to=/" target="_top">切换账号</a><a className="account-signout" href="/signout-with-chatgpt?return_to=/" target="_top">退出账号</a></div>}</div>;
}
