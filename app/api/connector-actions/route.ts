import { env } from 'cloudflare:workers';
import { finishDraftFillAction, getConversationDraft, nextPendingDraftFillAction, queueDraftFillAction } from '@/lib/catalog-db';
import { requestShopScope, shopScopeError } from '@/lib/request-shop';

export const runtime = 'edge';

export async function GET(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  return Response.json({ action: await nextPendingDraftFillAction(env.DB, scope.shop.id) });
}

export async function POST(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const body: unknown = await request.json().catch(() => null);
  const conversationId = typeof body === 'object' && body ? String((body as Record<string, unknown>).conversationId || '').trim() : '';
  const draftText = typeof body === 'object' && body ? String((body as Record<string, unknown>).draftText || '').trim() : '';
  if (!conversationId || !draftText || draftText.length > 500) return Response.json({ error: '草稿内容不完整。' }, { status: 400 });
  const draft = await getConversationDraft(env.DB, conversationId, scope.shop.id);
  if (!draft || draft.status === 'needs_human' || draft.draftText !== draftText) return Response.json({ error: '该草稿不可填入，请先人工处理或刷新页面。' }, { status: 409 });
  return Response.json({ action: await queueDraftFillAction(env.DB, conversationId, draftText, scope.shop.id) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const scope = await requestShopScope(env.DB, request);
  if (!scope) return shopScopeError();
  const body: unknown = await request.json().catch(() => null);
  const id = typeof body === 'object' && body ? String((body as Record<string, unknown>).id || '').trim() : '';
  const status = typeof body === 'object' && body ? String((body as Record<string, unknown>).status || '') : '';
  const errorText = typeof body === 'object' && body ? String((body as Record<string, unknown>).errorText || '') : '';
  if (!id || (status !== 'filled' && status !== 'failed')) return Response.json({ error: '操作状态无效。' }, { status: 400 });
  return Response.json({ updated: await finishDraftFillAction(env.DB, id, status, errorText, scope.shop.id) });
}
