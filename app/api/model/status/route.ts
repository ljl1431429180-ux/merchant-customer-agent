import { env } from 'cloudflare:workers';
import { isQwenConfigured } from '@/lib/qwen';

export const runtime = 'edge';

export async function GET() {
  return Response.json({ provider: 'qwen-plus', configured: isQwenConfigured(env) });
}
