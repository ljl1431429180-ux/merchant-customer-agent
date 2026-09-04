import { env } from 'cloudflare:workers';
import { resolveProductDetailWithConfirmedSource } from '@/lib/catalog-db';

export const runtime = 'edge';

type AdminEnv = { CATALOG_ADMIN_ACTION_TOKEN?: string };

function isAuthorized(request: Request) {
  const expected = (env as typeof env & AdminEnv).CATALOG_ADMIN_ACTION_TOKEN;
  const supplied = request.headers.get('x-catalog-admin-token');
  return Boolean(expected && supplied && supplied.length === expected.length && supplied === expected);
}

export async function POST(request: Request, { params }: { params: Promise<{ sku: string }> }) {
  if (!isAuthorized(request)) return Response.json({ error: '管理员验证失败。' }, { status: 403 });
  const { sku } = await params;
  if (!/^\d{6,}$/.test(sku)) return Response.json({ error: '商品 SKU 格式不正确。' }, { status: 400 });
  const result = await resolveProductDetailWithConfirmedSource(env.DB, sku);
  if (!result) return Response.json({ error: '未找到该商品详情。' }, { status: 404 });
  if (result.state === 'source_not_confirmed') return Response.json({ error: '该商品没有已确认且已关联的1688资料，不能自动采用货源口径。' }, { status: 409 });
  return Response.json(result);
}
