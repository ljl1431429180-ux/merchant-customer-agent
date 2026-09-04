import { env } from 'cloudflare:workers';
import { deleteProduct, recordSecurityActivity, updateProductStock } from '@/lib/catalog-db';
import { actorAuthId, requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const body: unknown = await request.json().catch(() => null);
  const stock = typeof body === 'object' && body && Number((body as Record<string, unknown>).stock);
  if (!Number.isInteger(stock) || stock < 0) return Response.json({ error: '库存必须是不小于 0 的整数。' }, { status: 400 });
  const { id } = await params;
  const product = await updateProductStock(env.DB, id, stock, scope.shop.id);
  if (!product) return Response.json({ error: '未找到该商品。' }, { status: 404 });
  await recordSecurityActivity(env.DB, { merchantId: scope.merchant.id, shopId: scope.shop.id, actorAuthId: actorAuthId(request), action: 'product_stock_changed', targetId: id });
  return Response.json({ product });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const { id } = await params;
  const removed = await deleteProduct(env.DB, id, scope.shop.id);
  if (!removed) return Response.json({ error: '未找到该商品。' }, { status: 404 });
  await recordSecurityActivity(env.DB, { merchantId: scope.merchant.id, shopId: scope.shop.id, actorAuthId: actorAuthId(request), action: 'product_deleted', targetId: id });
  return new Response(null, { status: 204 });
}
