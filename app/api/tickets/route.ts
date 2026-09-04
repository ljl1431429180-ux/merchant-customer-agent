import { env } from 'cloudflare:workers';
import { listOpenHandoffTickets } from '@/lib/catalog-db';
import { requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

export async function GET(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  return Response.json({ tickets: await listOpenHandoffTickets(env.DB, scope.shop.id) });
}
