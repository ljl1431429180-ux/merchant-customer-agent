import XLSX from 'xlsx';

const fileArguments = process.argv.slice(2).filter((argument) => argument !== '--');
const inputFile = fileArguments[0];
const dashboardUrl = process.env.LOCAL_DASHBOARD_URL;
const bearerToken = process.env.LOCAL_DASHBOARD_BEARER;

if (!inputFile || !dashboardUrl || !bearerToken) {
  console.error('需要采集结果文件、LOCAL_DASHBOARD_URL 和 LOCAL_DASHBOARD_BEARER。');
  process.exit(1);
}

const statusMap = { '已采集待确认': 'enriched', '需要授权数据源': 'needs_authorization', '采集失败': 'failed' };
const workbook = XLSX.readFile(inputFile);
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
const sources = rows.map((row) => ({
  sourceUrl: String(row['链接地址'] || '').trim(), sourceTitle: String(row['商品标题'] || '').trim(),
  shopSaleCents: Math.round(Number(row['售卖价'] || 0) * 100), externalSku: String(row['货号'] || '').trim(),
  collectionStatus: statusMap[row['采集状态']] || 'failed', title: String(row['实际标题'] || ''), material: String(row['材质'] || ''),
  specifications: String(row['规格'] || ''), sellingPoints: String(row['卖点'] || ''), imageUrl: String(row['主图链接'] || ''),
  sourcePriceCents: row['货源价'] === '' ? null : Math.round(Number(row['货源价'] || 0) * 100),
})).filter((source) => source.sourceUrl && source.sourceTitle && source.externalSku);

const response = await fetch(`${dashboardUrl.replace(/\/$/, '')}/api/sources`, {
  method: 'POST', headers: { authorization: `Bearer ${bearerToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ sources }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(body.error || `导入失败（${response.status}）`);
console.log(`已导入 ${body.processed} 条采集结果到待确认知识库。`);
