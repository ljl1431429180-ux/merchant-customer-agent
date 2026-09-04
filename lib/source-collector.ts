import type { CollectedSourceFacts } from '@/lib/catalog-db';

const blockedPagePattern = /验证码|请先登录|登录后|访问受限|安全验证|异常访问|滑动验证|完成验证/i;

function decodeHtml(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function clean(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 500);
}

function meta(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`, 'i'),
  ];
  return patterns.map((pattern) => pattern.exec(html)?.[1]).find(Boolean) ?? '';
}

function textAfterLabel(text: string, labels: string[]) {
  for (const label of labels) {
    const result = new RegExp(`${label}[：:\\s]{0,4}([^\\n]{2,80})`, 'i').exec(text);
    if (result?.[1]) return result[1].replace(/(颜色|尺码|规格|库存|发货).*/i, '').trim();
  }
  return '';
}

const genericDetailLabels = [
  '品牌', '型号', '货号', '适用人群', '适用性别', '风格', '图案', '季节', '产地', '功能',
  '厚度', '闭合方式', '跟高', '鞋头', '鞋底材质', '内里材质', '填充物', '成分', '容量',
  '尺寸', '重量', '功率', '电压', '保质期', '配料', '规格型号',
];

function genericAttributes(text: string) {
  const attributes: Record<string, string> = {};
  for (const label of genericDetailLabels) {
    const value = textAfterLabel(text, [label]);
    if (value && value.length <= 160) attributes[label] = value;
  }
  return attributes;
}

function priceCentsFrom(html: string) {
  const candidates = [meta(html, 'product:price:amount'), meta(html, 'price'), /(?:¥|￥)\s*(\d{1,6}(?:\.\d{1,2})?)/.exec(html)?.[1] ?? ''];
  for (const value of candidates) {
    const parsed = Number(String(value).replace(/[^\d.]/g, ''));
    if (Number.isFinite(parsed) && parsed >= 0 && parsed < 1_000_000) return Math.round(parsed * 100);
  }
  return null;
}

function factsFromPublicHtml(html: string): CollectedSourceFacts {
  const text = clean(html);
  if (blockedPagePattern.test(text)) return { status: 'needs_authorization' };
  const title = clean(meta(html, 'og:title') || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  const sellingPoints = clean(meta(html, 'og:description') || meta(html, 'description'));
  const imageUrl = meta(html, 'og:image');
  const material = textAfterLabel(text, ['鞋面材质', '材质', '面料']);
  const specifications = textAfterLabel(text, ['尺码', '规格']);
  const attributes = genericAttributes(text);
  const sourcePriceCents = priceCentsFrom(html);
  if (!title && !sellingPoints && !imageUrl && sourcePriceCents === null) return { status: 'failed' };
  return { status: 'enriched', title, material, specifications, attributes, sellingPoints, imageUrl, sourcePriceCents };
}

export async function collectPublic1688Product(sourceUrl: string): Promise<CollectedSourceFacts> {
  const url = new URL(sourceUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'detail.1688.com' || !/^\/offer\/\d+/.test(url.pathname)) return { status: 'failed' };
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { accept: 'text/html,application/xhtml+xml' } });
    if (response.status >= 300 && response.status < 400) return { status: 'needs_authorization' };
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/html')) return { status: 'failed' };
    const html = (await response.text()).slice(0, 1_500_000);
    return factsFromPublicHtml(html);
  } catch {
    return { status: 'failed' };
  }
}
