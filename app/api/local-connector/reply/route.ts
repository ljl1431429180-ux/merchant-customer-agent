import { env } from 'cloudflare:workers';
import { createCustomerReply } from '@/lib/customer-reply';
import { requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

/** A local connector uses the merchant's existing private-dashboard session. */
export async function POST(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const body: unknown = await request.json().catch(() => null);
  const text = typeof body === 'object' && body ? String((body as Record<string, unknown>).text ?? '').trim() : '';
  const productHint = typeof body === 'object' && body ? String((body as Record<string, unknown>).productHint ?? '').trim() : '';
  if (!text || text.length > 500) return Response.json({ error: '请输入不超过 500 字的客户消息。' }, { status: 400 });
  if (productHint.length > 300) return Response.json({ error: '当前咨询商品名称不能超过 300 字。' }, { status: 400 });
  return Response.json(await createCustomerReply(env.DB, env, { text, productHint: productHint || undefined, shopId: scope.shop.id }));
}
