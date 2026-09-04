import { env } from 'cloudflare:workers';
import { getMerchantWorkspace } from '@/lib/catalog-db';

export const runtime = 'edge';

/** Identity-aware workspace lookup. It intentionally never creates a second merchant without an invite flow. */
export async function GET(request: Request) {
  const merchant = await getMerchantWorkspace(env.DB, request.headers);
  if (!merchant) return Response.json({ enrolled: false, message: '当前账号尚未加入商家工作空间，需要管理员邀请。' }, { status: 403 });
  return Response.json({ enrolled: true, merchant });
}
