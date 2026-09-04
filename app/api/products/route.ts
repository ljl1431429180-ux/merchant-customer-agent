import { env } from 'cloudflare:workers';
import { createProduct, listProducts, recordSecurityActivity, type ProductInput } from '@/lib/catalog-db';
import { actorAuthId, requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

function validProduct(value: unknown): value is ProductInput {
  if (!value || typeof value !== 'object') return false;
  const product = value as Record<string, unknown>;
  return ['name', 'sku', 'category', 'color', 'size', 'material'].every((key) => typeof product[key] === 'string' && product[key].trim())
    && Number.isInteger(product.priceCents) && Number(product.priceCents) >= 0
    && Number.isInteger(product.stock) && Number(product.stock) >= 0;
}

export async function GET(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  return Response.json({ products: await listProducts(env.DB, scope.shop.id), shop: scope.shop });
}

export async function POST(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const body: unknown = await request.json().catch(() => null);
  if (!validProduct(body)) return Response.json({ error: '商品信息不完整，请检查后再保存。' }, { status: 400 });
  try {
    const product = await createProduct(env.DB, {
      ...body,
      name: body.name.trim(), sku: body.sku.trim(), category: body.category.trim(),
      color: body.color.trim(), size: body.size.trim(), material: body.material.trim(),
    }, scope.shop.id);
    await recordSecurityActivity(env.DB, { merchantId: scope.merchant.id, shopId: scope.shop.id, actorAuthId: actorAuthId(request), action: 'product_created', targetId: product.id });
    return Response.json({ product }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && /UNIQUE/i.test(error.message) ? '该 SKU 已存在，请换一个 SKU。' : '保存失败，请稍后重试。';
    return Response.json({ error: message }, { status: 400 });
  }
}
