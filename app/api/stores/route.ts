import { env } from 'cloudflare:workers';
import { createShopConnection, getMerchantWorkspace, listConnectorCatalog, listShopConnections, type ShopConnection } from '@/lib/catalog-db';

export const runtime = 'edge';

/** Connection metadata only. Product, source, knowledge, and conversation records remain scoped by shop_id. */
export async function GET(request: Request) {
  const merchant = await getMerchantWorkspace(env.DB, request.headers);
  if (!merchant) return Response.json({ error: '当前账号尚未获准访问任何商家工作空间。' }, { status: 403 });
  const shops = await listShopConnections(env.DB, merchant.id);
  return Response.json({ merchant, shops, connectors: listConnectorCatalog(), activeShopId: shops[0]?.id ?? null });
}

export async function POST(request: Request) {
  const merchant = await getMerchantWorkspace(env.DB, request.headers);
  if (!merchant) return Response.json({ error: '请先登录后再绑定店铺。' }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const value = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const name = String(value.name || '').trim();
  const platform = String(value.platform || 'other');
  const connector = String(value.connector || 'manual_import');
  const platforms: ShopConnection['platform'][] = ['douyin', 'taobao', 'jd', 'pdd', 'other'];
  const connectors: ShopConnection['connector'][] = ['local_browser', 'official_api', 'manual_import'];
  if (!name || name.length > 60 || !platforms.includes(platform as ShopConnection['platform']) || !connectors.includes(connector as ShopConnection['connector'])) {
    return Response.json({ error: '店铺名称或接入方式不正确。' }, { status: 400 });
  }
  try {
    const shop = await createShopConnection(env.DB, merchant.id, { name, platform: platform as ShopConnection['platform'], connector: connector as ShopConnection['connector'] });
    return Response.json({ shop }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && /UNIQUE/i.test(error.message) ? '同一平台下已绑定同名店铺。' : '绑定店铺失败，请稍后重试。';
    return Response.json({ error: message }, { status: 400 });
  }
}
