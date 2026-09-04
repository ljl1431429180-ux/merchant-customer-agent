const pendingValues = new Set(['', '待补充', '待核实', '未同步', '未知']);

export function isPendingProductFact(value: string | null | undefined) {
  return pendingValues.has(String(value || '').trim());
}

const colorMatchers: Array<[string, RegExp]> = [
  ['米白色', /米白(?:色)?/g], ['奶白色', /奶白(?:色)?/g], ['象牙白', /象牙白/g],
  ['卡其色', /卡其(?:色)?/g], ['酒红色', /酒红(?:色)?/g], ['玫红色', /玫红(?:色)?/g],
  ['深蓝色', /深蓝(?:色)?/g], ['藏蓝色', /藏蓝(?:色)?/g], ['宝蓝色', /宝蓝(?:色)?/g],
  ['浅蓝色', /浅蓝(?:色)?/g], ['墨绿色', /墨绿(?:色)?/g], ['军绿色', /军绿(?:色)?/g],
  ['浅绿色', /浅绿(?:色)?/g], ['深灰色', /深灰(?:色)?/g], ['浅灰色', /浅灰(?:色)?/g],
  ['黑色', /黑(?:色)?/g], ['白色', /白(?:色)?/g], ['灰色', /灰(?:色)?/g], ['蓝色', /蓝(?:色)?/g],
  ['红色', /红(?:色)?/g], ['粉色', /粉(?:色)?/g], ['紫色', /紫(?:色)?/g], ['绿色', /绿(?:色)?/g],
  ['黄色', /黄(?:色)?/g], ['橙色', /橙(?:色)?/g], ['棕色', /棕(?:色)?/g], ['咖色', /咖(?:色)?/g],
  ['杏色', /杏(?:色)?/g], ['米色', /米(?:色)?/g], ['银色', /银(?:色)?/g], ['金色', /金(?:色)?/g],
];

/** Extracts only customer-safe colour names; option controls such as “上移/下移” are discarded. */
export function customerSafeColors(value: string | null | undefined) {
  let remaining = String(value || '');
  const colors: string[] = [];
  for (const [name, matcher] of colorMatchers) {
    if (!matcher.test(remaining)) continue;
    colors.push(name);
    remaining = remaining.replace(matcher, ' ');
  }
  return [...new Set(colors)].join('、');
}

/** Shoe-size text is reduced to actual numeric sizes, never page button labels. */
export function customerSafeSizes(value: string | null | undefined) {
  return [...new Set(String(value || '').match(/\b(?:2\d|3\d|4\d|5\d)\b/g) || [])].join('、');
}

export function displayProductFact(value: string | null | undefined) {
  return isPendingProductFact(value) ? '待核实' : String(value).trim();
}
