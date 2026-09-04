import { env } from 'cloudflare:workers';
import { autoLinkRecommendedSources } from '@/lib/catalog-db';

export const runtime = 'edge';

/** Reversible association only; collected facts remain outside customer knowledge until separately confirmed. */
export async function POST() {
  return Response.json(await autoLinkRecommendedSources(env.DB));
}
