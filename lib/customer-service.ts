import type { ConfirmedProductKnowledge, Product } from '@/lib/catalog-db';
import { customerSafeColors, customerSafeSizes, isPendingProductFact } from '@/lib/product-facts';

// 规则优先于模型：无法由商品事实安全确认的事项必须交给人工。
const handoffPattern = /(退款|退货|换货|售后|投诉|差评|改价|赔偿|人工|骗子|质量问题|破损|开胶|磨脚|发错|少发|催发|催物流|物流异常|快递|发货时间|几天到|到货时间|脚长|脚宽|脚胖|偏大|偏小|怎么选码|推荐.*码|尺码建议)/;
const internalPattern = /(1688|货源|供应商|厂家|工厂|采购价|进货价|成本价|批发价|拿货价)/;
const pendingField = (value: string) => isPendingProductFact(value);
const ignoredClues = new Set(['您好', '请问', '这个', '这双', '那双', '商品', '鞋子', '女鞋', '什么', '怎么', '材质', '鞋面', '面料', '有货', '库存', '尺码', '价格', '多少', '优惠']);

const normalizedTitle = (value: string) => value.toLowerCase().replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
const safeColorValues = (...values: string[]) => [...new Set(
  values.flatMap((value) => customerSafeColors(value).split('、').filter(Boolean)),
)];

function knowledgeForProduct(product: Product, knowledge: ConfirmedProductKnowledge[]) {
  const direct = knowledge.filter((item) => item.productId === product.id || item.sku === product.sku);
  if (direct.length) return direct;
  const name = normalizedTitle(product.name);
  const byExactName = knowledge.filter((item) => normalizedTitle(item.productName) === name);
  return byExactName.length ? byExactName : [];
}

function productClues(question: string) {
  const compact = question.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
  const clues = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    const clue = compact.slice(index, index + 2).toLowerCase();
    if (!ignoredClues.has(clue)) clues.add(clue);
  }
  return clues;
}

function matchedProducts(question: string, products: Product[], requestedSize?: string) {
  const normalizedQuestion = question.toLowerCase();
  const clues = productClues(question);
  return products.map((product) => {
    const facts = [product.name, product.color, product.size, product.material, product.sku].join(' ').toLowerCase();
    let score = facts.includes(normalizedQuestion) ? 20 : 0;
    for (const clue of clues) if (facts.includes(clue)) score += 1;
    if (requestedSize && product.size === requestedSize) score += 3;
    if (product.color && question.includes(product.color)) score += 2;
    return { product, score };
  }).filter(({ score }) => score >= 2).sort((left, right) => right.score - left.score).map(({ product }) => product);
}

function skuStockForSize(knowledge: ConfirmedProductKnowledge[], size: string) {
  let found = false;
  let total = 0;
  for (const item of knowledge) {
    const raw = item.attributes?.['分码库存'];
    if (!raw) continue;
    try {
      const stocks = JSON.parse(raw) as Record<string, unknown>;
      const quantity = Number(stocks[size]);
      if (Number.isFinite(quantity) && quantity >= 0) { found = true; total += quantity; }
    } catch { /* Ignore malformed local stock snapshots. */ }
  }
  return found ? total : null;
}

export function replyToCustomer(text: string, products: Product[], knowledge: ConfirmedProductKnowledge[]) {
  const question = text.trim();
  if (internalPattern.test(question)) {
    return { reply: '您好，商品的采购、货源和成本信息属于店铺内部资料，不对外提供。商品零售价请以店铺页面实际展示为准。', useModel: false };
  }
  if (handoffPattern.test(question)) {
    return { reply: '您好，这类售后、物流、尺码建议或服务承诺问题需要人工客服为您核实处理。我已为您创建人工接管提醒，请稍候。', handoffReason: `客户咨询：${question.slice(0, 120)}`, useModel: false };
  }

  const requestedSize = question.match(/(\d{2})\s*码/)?.[1];
  const matched = matchedProducts(question, products, requestedSize);
  const product = matched.find((item) => item.status === 'active' && item.stock > 0) ?? matched.find((item) => item.status === 'active') ?? matched[0];

  if (!product) return { reply: '您好，请告诉我商品名称、颜色或尺码，我再为您准确核对商品资料。', useModel: false };
  if (product.status === 'off_shelf') return { reply: `您好，${product.name}目前已下架，暂时不能下单。如需寻找相近款式，我可以为您转人工客服协助。`, handoffReason: `已下架商品咨询：${question.slice(0, 120)}`, useModel: false };
  const productKnowledge = knowledgeForProduct(product, knowledge);
  const reviewedColors = safeColorValues(
    pendingField(product.color) ? '' : product.color,
    ...productKnowledge.map((item) => pendingField(item.color || '') ? '' : item.color || ''),
  );
  const reviewedMaterial = productKnowledge.find((item) => item.material)?.material || product.material;
  const reviewedSellingPoints = productKnowledge.map((item) => item.sellingPoints).filter(Boolean).join('；');
  if (/(库存|有货|尺码|\d{2}\s*码)/.test(question)) {
    const listedSizes = [...new Set(product.size.match(/\b(?:2\d|3\d|4\d|5\d)\b/g) || [])];
    if (requestedSize) {
      const materialAnswer = /(材质|鞋面|真皮|面料)/.test(question) && !pendingField(reviewedMaterial) ? `这款商品的材质为${reviewedMaterial}。` : '';
      const syncedSkuStock = skuStockForSize(productKnowledge, requestedSize);
      if (syncedSkuStock !== null) return { reply: syncedSkuStock > 0 ? `您好，${materialAnswer}${requestedSize} 码当前有货，可售库存 ${syncedSkuStock} 双。` : `您好，${materialAnswer}${requestedSize} 码当前暂时缺货。`, useModel: false };
      if (pendingField(product.size) || !listedSizes.length) return { reply: `您好，${materialAnswer}${product.name}的 SKU 级尺码库存还未同步完成，不能确认 ${requestedSize} 码是否有货，我已为您转人工核实。`, handoffReason: `待核实尺码库存：${question.slice(0, 120)}`, useModel: false };
      if (!listedSizes.includes(requestedSize)) return { reply: `您好，${materialAnswer}当前商品规格中没有找到 ${requestedSize} 码。可选尺码为 ${listedSizes.join('、')} 码；如需确认其他尺码，我可以为您转人工核实。`, useModel: false };
      return { reply: `您好，${materialAnswer}这款商品有 ${requestedSize} 码规格；但分码库存尚未同步到客服系统，我不能直接确认现货，已为您转人工核实。`, handoffReason: `待核实分码库存：${question.slice(0, 120)}`, useModel: false };
    }
    const colors = customerSafeColors(product.color);
    const sizes = customerSafeSizes(product.size);
    const specification = [colors, sizes ? `${sizes} 码` : ''].filter(Boolean).join('、');
    return { reply: product.stock > 0 ? `亲，这款${specification ? `（${specification}）` : ''}有现货，目前库存 ${product.stock} 双，售价 ¥${(product.priceCents / 100).toFixed(0)}。` : `亲，这款${specification ? `（${specification}）` : ''}目前暂时缺货。`, useModel: false };
  }
  if (/(材质|鞋面|真皮|面料)/.test(question)) {
    if (pendingField(reviewedMaterial)) return { reply: `您好，${product.name}的材质资料还未同步完成，我不能给您猜测，已为您转人工核实。`, handoffReason: `待核实商品材质：${question.slice(0, 120)}`, useModel: false };
    return { reply: `亲，这款鞋的鞋面材质是${reviewedMaterial}哦。`, useModel: false };
  }
  if (/(颜色|色号|什么色|白色|黑色|银色|米色|红色|粉色|蓝色|灰色|棕色)/.test(question)) {
    if (!reviewedColors.length) return { reply: `您好，${product.name}的颜色资料还未确认完成，为避免答错，我已为您转人工核实。`, handoffReason: `待核实商品颜色：${question.slice(0, 120)}`, useModel: false };
    const askedColor = reviewedColors.find((color) => question.includes(color));
    if (askedColor) return { reply: `有的亲，这款有${askedColor}。`, useModel: false };
    return { reply: `亲，这款现有${reviewedColors.join('、')}。`, useModel: false };
  }
  if (/(价格|多少钱|优惠)/.test(question)) return { reply: `您好，${product.name}当前登记售价为 ¥${(product.priceCents / 100).toFixed(0)}。优惠以店铺结算页实际展示为准，我不会擅自承诺折扣。`, useModel: false };
  const knownFields = [
    !pendingField(product.color) ? customerSafeColors(product.color) : '',
    !pendingField(product.size) ? `${customerSafeSizes(product.size)} 码` : '',
    !pendingField(reviewedMaterial) ? reviewedMaterial : '',
  ].filter(Boolean).join('、');
  const knowledgeHint = reviewedSellingPoints ? ` 已确认商品资料：${reviewedSellingPoints.slice(0, 120)}` : '';
  return { reply: `您好，我已查到${product.name}${knownFields ? `：${knownFields}` : ''}，售价 ¥${(product.priceCents / 100).toFixed(0)}。${knowledgeHint} 您想了解库存、材质还是尺码？`, useModel: true };
}
