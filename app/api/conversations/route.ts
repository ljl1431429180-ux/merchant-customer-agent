import { env } from 'cloudflare:workers';
import { listConversationDrafts } from '@/lib/catalog-db';
import { requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

/** Drafts are private to the signed-in merchant dashboard. They are never sent from this endpoint. */
export async function GET(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  return Response.json({ conversations: await listConversationDrafts(env.DB, scope.shop.id) });
}
