import XLSX from 'xlsx';
import puppeteer from 'puppeteer-core';

const inputFile = process.argv.slice(2).find((argument) => argument !== '--');
if (!inputFile) {
  console.error('用法：node scripts\\import-collected-results-via-dashboard.mjs "D:\\采集结果.xlsx"');
  process.exit(1);
}

const statusMap = { '已采集待确认': 'enriched', '需要授权数据源': 'needs_authorization', '采集失败': 'failed' };
function attributes(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
const workbook = XLSX.readFile(inputFile);
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
const sources = rows.map((row) => ({
  sourceUrl: String(row['链接地址'] || '').trim(),
  sourceTitle: String(row['商品标题'] || '').trim(),
  shopSaleCents: Math.round(Number(row['售卖价'] || 0) * 100),
  externalSku: String(row['货号'] || '').trim(),
  collectionStatus: statusMap[row['采集状态']] || 'failed',
  title: String(row['实际标题'] || ''),
  material: String(row['材质'] || ''),
  specifications: String(row['规格'] || ''),
  attributes: attributes(row['类目属性']),
  sellingPoints: String(row['卖点'] || ''),
  imageUrl: String(row['主图链接'] || ''),
  sourcePriceCents: row['货源价'] === '' ? null : Math.round(Number(row['货源价'] || 0) * 100),
})).filter((source) => source.sourceUrl && source.sourceTitle && source.externalSku);

if (!sources.length) {
  console.error('采集文件中没有可导入的记录。');
  process.exit(1);
}

const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json());
const browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
const page = (await browser.pages()).find((candidate) => /chatgpt\.site/i.test(candidate.url()));
if (!page) {
  console.error('未找到已登录的私有项目后台页面。请先通过启动器打开后台。');
  process.exit(1);
}

const result = await page.evaluate(async (payload) => {
  const response = await fetch('/api/sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sources: payload }),
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}, sources);

if (!result.ok) throw new Error(result.body?.error || `导入失败（${result.status}）`);
console.log(JSON.stringify({ imported: result.body?.processed ?? sources.length, knowledgeStatus: 'pending' }));
