import { env } from 'cloudflare:workers';
import { confirmProductDetailKnowledge } from '@/lib/catalog-db';
import { requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

export async function POST(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const { sku } = await params;
  if (!/^\d{6,}$/.test(sku)) return Response.json({ error: '商品 SKU 格式不正确。' }, { status: 400 });
  const detail = await confirmProductDetailKnowledge(env.DB, sku, scope.shop.id);
  if (!detail) return Response.json({ error: '未找到待确认的商品详情。' }, { status: 404 });
  return Response.json({ detail });
}
