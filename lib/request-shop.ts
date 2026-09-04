import { resolveMerchantShopScope } from '@/lib/catalog-db';

/**
 * All merchant-facing endpoints call this before touching shop records.
 * A shop id from the browser is only a preference; ownership is checked again
 * on the server so one merchant cannot select another merchant's shop.
 */
export async function requestShopScope(db: D1Database, request: Request) {
  const requestedShopId = new URL(request.url).searchParams.get('shopId');
  return resolveMerchantShopScope(db, request.headers, requestedShopId);
}

export function shopScopeError() {
  return Response.json({ error: '未找到可用店铺，或当前账号无权访问该店铺。' }, { status: 403 });
}

export function actorAuthId(request: Request) {
  return request.headers.get('oai-authenticated-user-id')?.trim() || 'unknown';
}
