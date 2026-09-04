import { env } from 'cloudflare:workers';
import { confirmSourceKnowledge } from '@/lib/catalog-db';

export const runtime = 'edge';

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const result = await confirmSourceKnowledge(env.DB, id);
  if (!result) return Response.json({ error: '没有找到这条货源记录。' }, { status: 404 });
  if (result.state === 'not_collected') {
    return Response.json({ error: '请先完成商品详情采集，再确认资料。' }, { status: 400 });
  }
  return Response.json({ confirmed: true, updatedAt: result.updatedAt });
}
