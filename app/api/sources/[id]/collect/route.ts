import { env } from 'cloudflare:workers';
import { getSourceProduct, saveCollectedSourceFacts } from '@/lib/catalog-db';
import { collectPublic1688Product } from '@/lib/source-collector';

export const runtime = 'edge';

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const source = await getSourceProduct(env.DB, id);
  if (!source) return Response.json({ error: '没有找到这条货源记录。' }, { status: 404 });
  const facts = await collectPublic1688Product(source.sourceUrl);
  const saved = await saveCollectedSourceFacts(env.DB, id, facts);
  if (!saved) return Response.json({ error: '保存采集结果失败。' }, { status: 500 });
  const message = facts.status === 'enriched'
    ? '已提取公开页面信息，等待你确认后才能供客服使用。'
    : facts.status === 'needs_authorization'
      ? '页面要求登录或验证，已停止采集；请改用平台授权的数据来源。'
      : '未能从公开页面识别商品详情，请稍后重试或改用授权数据源。';
  return Response.json({ source: saved, message });
}
