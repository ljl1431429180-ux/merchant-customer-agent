import { env } from 'cloudflare:workers';
import { listConfirmedProductKnowledge, listProducts } from '@/lib/catalog-db';
import { requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

/** Called only from the merchant's logged-in private dashboard browser session. */
export async function GET(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const [products, knowledge] = await Promise.all([
    listProducts(env.DB, scope.shop.id),
    listConfirmedProductKnowledge(env.DB, scope.shop.id),
  ]);
  return Response.json({
    products: products.map(({ id, name, sku, color, size, material, priceCents, stock, status }) => ({ id, name, sku, color, size, material, priceCents, stock, status })),
    knowledge: knowledge.map(({ productId, productName, sku, color, size, material, specifications, attributes, sellingPoints, updatedAt }) => ({ productId, productName, sku, color, size, material, specifications, attributes, sellingPoints, updatedAt })),
  });
}
