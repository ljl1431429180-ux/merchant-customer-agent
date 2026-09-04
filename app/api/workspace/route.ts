import { env } from 'cloudflare:workers';
import { requestMerchantWorkspace } from '@/lib/request-shop';

export const runtime = 'edge';

/** Identity-aware workspace lookup. Requests without a trusted identity never receive workspace data. */
export async function GET(request: Request) {
  const merchant = await requestMerchantWorkspace(env.DB, request);
  if (!merchant) return Response.json({ enrolled: false, message: '当前账号尚未加入商家工作空间，需要管理员邀请。' }, { status: 403 });
  return Response.json({ enrolled: true, merchant });
}
