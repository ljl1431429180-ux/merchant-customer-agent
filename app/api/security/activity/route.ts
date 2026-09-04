import { env } from 'cloudflare:workers';
import { listSecurityActivity } from '@/lib/catalog-db';
import { requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

/** The signed-in merchant may view only their own operational audit metadata. */
export async function GET(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  return Response.json({ activity: await listSecurityActivity(env.DB, scope.merchant.id, scope.shop.id) });
}
