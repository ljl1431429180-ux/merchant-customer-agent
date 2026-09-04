import { env } from 'cloudflare:workers';
import { importProducts, recordSecurityActivity, type ProductInput } from '@/lib/catalog-db';
import { actorAuthId, requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

function validProduct(value: unknown): value is ProductInput {
  if (!value || typeof value !== 'object') return false;
  const product = value as Record<string, unknown>;
  return ['name', 'sku', 'category', 'color', 'size', 'material'].every((key) => typeof product[key] === 'string' && product[key].trim())
    && Number.isInteger(product.priceCents) && Number(product.priceCents) >= 0
    && Number.isInteger(product.stock) && Number(product.stock) >= 0
    && (product.listingStatus === undefined || ['active', 'out_of_stock', 'off_shelf'].includes(String(product.listingStatus)));
}

export async function POST(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const body: unknown = await request.json().catch(() => null);
  const products = typeof body === 'object' && body && Array.isArray((body as Record<string, unknown>).products)
    ? (body as { products: unknown[] }).products
    : [];
  if (!products.length || products.length > 500 || !products.every(validProduct)) {
    return Response.json({ error: '请上传 1 到 500 条完整商品资料。' }, { status: 400 });
  }
  const processed = await importProducts(env.DB, products.map((product) => ({
    ...product,
    name: product.name.trim(), sku: product.sku.trim(), category: product.category.trim(),
    color: product.color.trim(), size: product.size.trim(), material: product.material.trim(),
    listingStatus: product.listingStatus,
  })), scope.shop.id);
  await recordSecurityActivity(env.DB, { merchantId: scope.merchant.id, shopId: scope.shop.id, actorAuthId: actorAuthId(request), action: 'products_imported', targetId: String(processed) });
  return Response.json({ processed });
}
