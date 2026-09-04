import { env } from 'cloudflare:workers';
import { importProductDetailKnowledge, listProductDetailKnowledge, validProductDetailKnowledge } from '@/lib/catalog-db';
import { requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

export async function GET(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const details = await listProductDetailKnowledge(env.DB, scope.shop.id);
  return Response.json({ details });
}

export async function POST(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const body: unknown = await request.json().catch(() => null);
  const details = typeof body === 'object' && body && Array.isArray((body as Record<string, unknown>).details)
    ? (body as { details: unknown[] }).details
    : [];
  if (!details.length || details.length > 500 || !details.every(validProductDetailKnowledge)) {
    return Response.json({ error: '请上传 1 到 500 条带商品 SKU 和名称的抖店详情资料。' }, { status: 400 });
  }
  const processed = await importProductDetailKnowledge(env.DB, details.map((item) => {
    const detail = item as Record<string, unknown>;
    return {
      sku: String(detail.sku).trim(), productName: String(detail.productName).trim(),
      category: typeof detail.category === 'string' ? detail.category : '', material: typeof detail.material === 'string' ? detail.material : '',
      specifications: typeof detail.specifications === 'string' ? detail.specifications : '',
      attributes: detail.attributes && typeof detail.attributes === 'object' && !Array.isArray(detail.attributes) ? detail.attributes as Record<string, string> : {},
      colors: typeof detail.colors === 'string' ? detail.colors : '', sizes: typeof detail.sizes === 'string' ? detail.sizes : '',
      conflicts: Array.isArray(detail.conflicts) ? detail.conflicts.map((value) => String(value)) : [],
    };
  }), scope.shop.id);
  return Response.json({ processed });
}
