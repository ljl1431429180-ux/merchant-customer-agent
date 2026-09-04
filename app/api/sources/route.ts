import { env } from 'cloudflare:workers';
import { importCollectedSourceProducts, importSourceProducts, listSourceProducts, validCollectedSourceProduct, validSourceProduct } from '@/lib/catalog-db';

export const runtime = 'edge';

export async function GET() {
  const sources = await listSourceProducts(env.DB);
  return Response.json({ sources });
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const sources = typeof body === 'object' && body && Array.isArray((body as Record<string, unknown>).sources)
    ? (body as { sources: unknown[] }).sources
    : [];
  const isCollectedImport = sources.some((item) => typeof item === 'object' && item && 'collectionStatus' in item);
  if (!sources.length || sources.length > 500 || !(isCollectedImport ? sources.every(validCollectedSourceProduct) : sources.every(validSourceProduct))) {
    return Response.json({ error: '请上传 1 到 500 条完整的 1688 商品链接记录。' }, { status: 400 });
  }
  const normalized = sources.map((item) => {
    const source = item as Record<string, unknown>;
    return {
      sourceUrl: String(source.sourceUrl).trim(), sourceTitle: String(source.sourceTitle).trim(), shopSaleCents: Number(source.shopSaleCents), externalSku: String(source.externalSku).trim(),
      collectionStatus: source.collectionStatus, title: typeof source.title === 'string' ? source.title : '', material: typeof source.material === 'string' ? source.material : '',
      specifications: typeof source.specifications === 'string' ? source.specifications : '', attributes: source.attributes && typeof source.attributes === 'object' && !Array.isArray(source.attributes) ? source.attributes : {}, sellingPoints: typeof source.sellingPoints === 'string' ? source.sellingPoints : '',
      imageUrl: typeof source.imageUrl === 'string' ? source.imageUrl : '', sourcePriceCents: Number.isInteger(source.sourcePriceCents) ? Number(source.sourcePriceCents) : null,
    };
  });
  const processed = isCollectedImport
    ? await importCollectedSourceProducts(env.DB, normalized as Parameters<typeof importCollectedSourceProducts>[1])
    : await importSourceProducts(env.DB, normalized);
  return Response.json({ processed });
}
