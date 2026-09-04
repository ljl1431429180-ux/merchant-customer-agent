import { env } from 'cloudflare:workers';
import { listSyncRuns, recordSecurityActivity, resetStoreSyncSnapshot, syncStoreListings, type StoreSyncProduct } from '@/lib/catalog-db';
import { actorAuthId, requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

function validProduct(value: unknown): value is StoreSyncProduct {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.sku === 'string' && item.sku.trim().length >= 4
    && typeof item.name === 'string' && item.name.trim().length >= 2
    && Number.isInteger(item.priceCents) && Number(item.priceCents) >= 0
    && Number.isInteger(item.stock) && Number(item.stock) >= 0
    && ['active', 'out_of_stock', 'off_shelf'].includes(String(item.listingStatus));
}

export async function GET(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  return Response.json({ runs: await listSyncRuns(env.DB, scope.shop.id) });
}

export async function POST(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const products = Array.isArray(body?.products) ? body.products : [];
  if (!products.length || products.length > 100 || !products.every(validProduct)) return Response.json({ error: '本次同步未读取到完整商品资料。' }, { status: 400 });
  const sourceTotal = Math.max(products.length, Math.min(100000, Number(body?.sourceTotal) || products.length));
  const run = await syncStoreListings(env.DB, products, { platform: 'douyin', scope: '当前商品页', sourceTotal }, scope.shop.id);
  await recordSecurityActivity(env.DB, { merchantId: scope.merchant.id, shopId: scope.shop.id, actorAuthId: actorAuthId(request), action: 'store_listing_synced', targetId: `${run.processed}/${run.sourceTotal}` });
  return Response.json({ run });
}

/** Explicit recovery action for a failed full-store sync. Confirmed knowledge is never removed. */
export async function DELETE(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const removed = await resetStoreSyncSnapshot(env.DB, scope.shop.id);
  await recordSecurityActivity(env.DB, { merchantId: scope.merchant.id, shopId: scope.shop.id, actorAuthId: actorAuthId(request), action: 'store_sync_snapshot_reset', targetId: `${removed.listingsRemoved}/${removed.pendingDetailsRemoved}` });
  return Response.json({ ok: true, removed });
}
