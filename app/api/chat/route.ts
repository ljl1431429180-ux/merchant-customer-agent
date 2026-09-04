import { env } from 'cloudflare:workers';
import { createCustomerReply } from '@/lib/customer-reply';
import { requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

export async function POST(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const body: unknown = await request.json().catch(() => null);
  const text = typeof body === 'object' && body ? String((body as Record<string, unknown>).text ?? '').trim() : '';
  const conversationId = typeof body === 'object' && body ? String((body as Record<string, unknown>).conversationId ?? '').trim() : '';
  if (!text || text.length > 500) return Response.json({ error: '请输入不超过 500 字的问题。' }, { status: 400 });
  return Response.json(await createCustomerReply(env.DB, env, { text, conversationId: conversationId || undefined, shopId: scope.shop.id }));
}
