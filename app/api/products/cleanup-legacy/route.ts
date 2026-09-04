import { env } from 'cloudflare:workers';
import { cleanupVerifiedLegacyProducts, recordSecurityActivity } from '@/lib/catalog-db';
import { actorAuthId, requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

/** Deletes only the pre-reviewed nine legacy rows; it fails closed if they differ. */
export async function DELETE(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const result = await cleanupVerifiedLegacyProducts(env.DB, scope.shop.id);
  if (result.state !== 'cleaned') {
    return Response.json({ error: '历史记录与已核对清单不一致，未执行删除。请重新核对。', found: result.found }, { status: 409 });
  }
  await recordSecurityActivity(env.DB, {
    merchantId: scope.merchant.id,
    shopId: scope.shop.id,
    actorAuthId: actorAuthId(request),
    action: 'verified_legacy_products_cleaned',
    targetId: String(result.removed),
  });
  return Response.json(result);
}
