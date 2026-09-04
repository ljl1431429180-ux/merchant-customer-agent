import { env } from 'cloudflare:workers';
import { confirmPendingProductDetailKnowledge } from '@/lib/catalog-db';
import { requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

export async function POST(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const confirmed = await confirmPendingProductDetailKnowledge(env.DB, scope.shop.id);
  return Response.json({ confirmed });
}
