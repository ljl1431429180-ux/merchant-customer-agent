import { env } from 'cloudflare:workers';
import { linkSourceProduct, unlinkSourceProduct } from '@/lib/catalog-db';

export const runtime = 'edge';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  const productId = typeof body === 'object' && body ? String((body as Record<string, unknown>).productId ?? '').trim() : '';
  if (!productId || productId.length > 100) return Response.json({ error: '请选择要关联的抖店商品。' }, { status: 400 });
  const result = await linkSourceProduct(env.DB, id, productId);
  if (!result) return Response.json({ error: '没有找到这条货源记录。' }, { status: 404 });
  if (result.state === 'product_not_found') return Response.json({ error: '没有找到所选的抖店商品，请刷新后重试。' }, { status: 404 });
  return Response.json({ linked: true, product: result.product });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await unlinkSourceProduct(env.DB, id);
  if (result === null) return Response.json({ error: '没有找到这条货源记录。' }, { status: 404 });
  if (!result) return Response.json({ error: '这条货源尚未关联抖店商品。' }, { status: 400 });
  return Response.json({ unlinked: true });
}
