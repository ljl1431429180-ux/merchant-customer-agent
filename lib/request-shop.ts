import { getMerchantWorkspace, resolveMerchantShopScope, type MerchantIdentity } from '@/lib/catalog-db';

function isLocalHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '[::1]';
}

/**
 * This V1 trusts the identity injected by ChatGPT Sites, not a browser-supplied
 * value from arbitrary deployments. Localhost remains available for development.
 * A future standalone deployment must replace this adapter with its own signed
 * session / OAuth verification before serving real merchant data.
 */
function trustedIdentity(request: Request): MerchantIdentity | null {
  const url = new URL(request.url);
  const trustedHost = isLocalHost(url.hostname) || url.hostname.endsWith('.chatgpt.site');
  if (!trustedHost) return null;

  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (origin && origin !== url.origin) return null;
  if (fetchSite === 'cross-site') return null;
  // State-changing requests must originate from the signed-in dashboard itself.
  if (!['GET', 'HEAD'].includes(request.method)) {
    if (!origin || origin !== url.origin) return null;
    if (fetchSite && fetchSite !== 'same-origin') return null;
  }

  const authId = request.headers.get('oai-authenticated-user-id')?.trim() || '';
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(authId)) return null;
  const email = request.headers.get('oai-authenticated-user-email')?.trim().slice(0, 320) || '';
  return { authId, email };
}

export async function requestMerchantWorkspace(db: D1Database, request: Request) {
  const identity = trustedIdentity(request);
  return identity ? getMerchantWorkspace(db, identity) : null;
}

/**
 * All merchant-facing endpoints call this before touching shop records.
 * A shop id from the browser is only a preference; ownership is checked again
 * on the server so one merchant cannot select another merchant's shop.
 */
export async function requestShopScope(db: D1Database, request: Request) {
  const requestedShopId = new URL(request.url).searchParams.get('shopId');
  const identity = trustedIdentity(request);
  return identity ? resolveMerchantShopScope(db, identity, requestedShopId) : null;
}

export function shopScopeError() {
  return Response.json({ error: '未找到可用店铺，或当前账号无权访问该店铺。' }, { status: 403 });
}

export function actorAuthId(request: Request) {
  return trustedIdentity(request)?.authId || 'unauthenticated';
}
