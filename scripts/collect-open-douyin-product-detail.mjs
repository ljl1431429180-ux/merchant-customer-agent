import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import XLSX from 'xlsx';
import puppeteer from 'puppeteer-core';

const labels = ['品牌', '货号', '材质', '帮面材质', '鞋面内里材质', '鞋底材质', '鞋面材质', '重量', '靴筒材质', '鞋头款式', '鞋跟高度', '中底材质', '皮质特征', '开口深度', '鞋跟款式', '工艺', '鞋帮高度', '图案', '厚度', '适用季节', '鞋底工艺', '靴筒内里材质', '风格', '流行元素', '鞋垫材质', '鞋垫功能', '功能', '闭合方式', '产地', '商品类型', '尺寸', '适用人群', '上市时间', '包装体积', '品名'];
const requestedProductId = process.argv[2] || '';
const ignored = /^(\*|请选择|新增标品|最多选|可选无品牌|准确填写|重要属性|其他属性|商品系列|鞋靴|女鞋|休闲鞋)$/;

function lineValue(lines, label) {
  const exact = new RegExp(`^\\*?[ \\t]*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]+(.+)$`);
  for (let index = 0; index < lines.length; index += 1) {
    const inline = exact.exec(lines[index]);
    if (inline?.[1] && !ignored.test(inline[1].trim())) return inline[1].trim().slice(0, 160);
    if (lines[index].replace(/^\*\s*/, '') === label) {
      const value = lines.slice(index + 1, index + 4).find((item) => item && !ignored.test(item) && !/^请选择/.test(item) && !labels.includes(item.replace(/^\*\s*/, '')) && !/(材质|款式|高度|特征|深度|图案|厚度|季节|工艺|功能|闭合|是否)/.test(item));
      if (value) return value.slice(0, 160);
    }
  }
  return '';
}

function explicitValue(raw, label) {
  const names = labels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flat = raw.replace(/\s+/g, ' ');
  const match = new RegExp(`(?:\\*\\s*)?${escaped}\\s+(.{1,100}?)(?=\\s+(?:\\*\\s*)?(?:${names})\\s|\\s+其他属性|\\s+图文信息|$)`).exec(flat);
  const value = match?.[1]?.trim() || '';
  return ignored.test(value) || /^请选择/.test(value) || value.includes('请输入') || value.includes('*') || /(商品系列|品名)/.test(value) ? '' : value;
}

const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json());
const browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
const page = (await browser.pages()).find((item) => /fxg\.jinritemai\.com\/ffa\/g\/create\?/.test(item.url()) && (!requestedProductId || item.url().includes(`product_id=${requestedProductId}`)));
if (!page) throw new Error('未找到已打开的抖店商品详情页。');

const raw = await page.evaluate(() => document.body?.innerText || '');
const lines = raw.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
const title = (await page.$eval('input[placeholder*="15-60"]', (input) => input.value).catch(() => ''))?.trim();
const sku = await page.evaluate(() => [...document.querySelectorAll('input')].map((input) => input.value).find((value) => /^[A-Za-z]#\d{6,}$/.test(value)) || '').then((value) => value.replace(/^[A-Za-z]#/, ''));
const categoryLine = lines.find((line) => line.includes('>')) || '';
const category = /([\u4e00-\u9fffA-Za-z0-9]+\s*>\s*[\u4e00-\u9fffA-Za-z0-9]+(?:\s*>\s*[\u4e00-\u9fffA-Za-z0-9]+)?)/.exec(categoryLine)?.[1] || '';
const attributes = Object.fromEntries(labels.map((label) => [label, explicitValue(raw, label)]).filter(([, value]) => value));
const specificationText = /颜色分类([\s\S]{0,700}?)添加规格类型/.exec(raw)?.[1] || '';
const colorValues = [...new Set(specificationText.split(/\n+/).map((line) => line.trim()).filter((line) => /[\u4e00-\u9fff]/.test(line) && !/添加|上传|下移|上移|自定义|请选择/.test(line)))];
const sizeBlock = /鞋码大小([\s\S]{0,400}?)添加规格类型/.exec(raw)?.[1] || '';
const sizes = [...new Set(sizeBlock.match(/\b(?:2\d|3\d|4\d|5\d)\b/g) || [])];
const record = {
  抖店商品标题: title,
  SKU: sku,
  商品类目: category,
  材质: attributes['鞋面材质'] || attributes['帮面材质'] || attributes['材质'] || attributes['鞋面内里材质'] || '',
  规格: `颜色：${colorValues.join('、')}；尺码：${sizes.join('、')}`,
  类目属性: JSON.stringify(attributes),
  采集状态: '已采集待确认',
  采集说明: '来自已登录抖店商品详情页；需人工确认后再作为客服知识使用。',
};
const output = resolve('data', `抖店详情采集-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`);
await mkdir(resolve(output, '..'), { recursive: true });
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([record]), '详情采集');
XLSX.writeFile(workbook, output);
console.log(JSON.stringify({ record, output }, null, 2));
await browser.disconnect();
