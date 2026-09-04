import { findConfirmedProductKnowledge, listConfirmedProductKnowledge, listProducts, saveConversationTurn } from '@/lib/catalog-db';
import { replyToCustomer } from '@/lib/customer-service';
import { askQwen } from '@/lib/qwen';

type CustomerReplyEnv = { DASHSCOPE_API_KEY?: string; DASHSCOPE_BASE_URL?: string };

function normalizedTitle(value: string) {
  return value.toLowerCase().replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
}

function contextProduct(products: Awaited<ReturnType<typeof listProducts>>, productHint?: string) {
  if (!productHint) return { product: undefined, state: 'not_provided' as const };
  const hint = normalizedTitle(productHint);
  if (!hint) return { product: undefined, state: 'not_provided' as const };
  const ranked = products.map((product) => {
    const title = normalizedTitle(product.name);
    if (title.includes(hint) || hint.includes(title) || hint.includes(product.sku.toLowerCase())) return { product, score: 1 };
    const hintPairs = new Set(Array.from({ length: Math.max(hint.length - 1, 0) }, (_, index) => hint.slice(index, index + 2)));
    const titlePairs = new Set(Array.from({ length: Math.max(title.length - 1, 0) }, (_, index) => title.slice(index, index + 2)));
    const shared = [...hintPairs].filter((pair) => titlePairs.has(pair)).length;
    return { product, score: hintPairs.size ? shared / hintPairs.size : 0 };
  }).sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const next = ranked[1];
  if (!best || best.score < 0.72) return { product: undefined, state: 'not_found' as const };
  if (next && best.score - next.score < 0.12) return { product: undefined, state: 'ambiguous' as const };
  return { product: best.product, state: 'matched' as const };
}

function confirmedKnowledgeForProduct(product: Awaited<ReturnType<typeof listProducts>>[number], knowledge: ConfirmedProductKnowledge[]) {
  const direct = knowledge.filter((item) => item.productId === product.id || item.sku === product.sku);
  if (direct.length) return direct;

  // 历史采集记录可能在商品目录刷新后保留旧的关联 ID。仅当已确认详情的
  // 商品名称能唯一、完整匹配当前店铺商品时，才恢复该关联；相似名称仍保持
  // 静默并转人工，绝不把 A 款资料答给 B 款。
  const title = normalizedTitle(product.name);
  if (!title) return [];
  const byExactName = knowledge.filter((item) => normalizedTitle(item.productName) === title);
  return byExactName.length ? byExactName : [];
}

export async function createCustomerReply(db: D1Database, env: CustomerReplyEnv, input: { text: string; conversationId?: string; productHint?: string; shopId?: string }) {
  // The product title comes from the active customer-service session.  It is used
  // only to choose the right catalogue facts; the saved customer message remains
  // exactly what the customer wrote.
  const retrievalText = [input.productHint, input.text].filter(Boolean).join(' ');
  const [products, retrievedKnowledge, allConfirmedKnowledge] = await Promise.all([
    listProducts(db, input.shopId),
    findConfirmedProductKnowledge(db, retrievalText, input.shopId),
    listConfirmedProductKnowledge(db, input.shopId),
  ]);
  const context = contextProduct(products, input.productHint);
  const matchedContextProduct = context.product;
  if (input.productHint && !matchedContextProduct) {
    const reason = context.state === 'ambiguous' ? '当前会话商品可能对应多个店铺商品' : '当前会话商品未在店铺资料库中找到';
    const reply = `您好，${reason}，为避免答错商品资料，已为您转人工核实，请稍候。`;
    const conversationId = await saveConversationTurn(db, {
      conversationId: input.conversationId,
      customerText: input.text,
      assistantText: reply,
      handoffReason: `${reason}：${input.productHint.slice(0, 120)}`,
      shopId: input.shopId,
    });
    return { conversationId, reply, needsHuman: true, knowledgeUsed: 0, productMatch: context.state, autoSendAllowed: false };
  }
  const replyProducts = matchedContextProduct ? [matchedContextProduct] : products;
  // A Feige product hint is authoritative for the active session. Do not let a
  // similar title pull confirmed facts from another product into this reply.
  const knowledge = matchedContextProduct
    ? confirmedKnowledgeForProduct(matchedContextProduct, allConfirmedKnowledge)
    : retrievedKnowledge;
  const result = replyToCustomer(retrievalText, replyProducts, knowledge);
  const modelQuestion = input.productHint ? `当前咨询商品：${input.productHint}\n客户问题：${input.text}` : input.text;
  const reply = result.useModel ? await askQwen(env, modelQuestion, replyProducts, knowledge) ?? result.reply : result.reply;
  const conversationId = await saveConversationTurn(db, {
    conversationId: input.conversationId,
    customerText: input.text,
    assistantText: reply,
    handoffReason: result.handoffReason,
    shopId: input.shopId,
  });
  const needsHuman = Boolean(result.handoffReason);
  // Model text can be useful as a draft, but only deterministic, fact-based
  // replies may enter the automatic-send path.
  return {
    conversationId, reply, needsHuman, knowledgeUsed: knowledge.length,
    productMatch: context.state,
    autoSendAllowed: !needsHuman && Boolean(matchedContextProduct) && knowledge.length > 0 && !result.useModel,
  };
}
