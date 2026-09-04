import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import XLSX from 'xlsx';

const dataDir = resolve('data');
const file = (await readdir(dataDir)).filter((name) => name.startsWith('商品知识合并待确认-')).sort().at(-1);
if (!file) throw new Error('未找到商品知识合并待确认表。');

const workbook = XLSX.readFile(resolve(dataDir, file));
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
const materialPattern = /(真皮|牛皮|羊皮|猪皮|麂皮|超纤|pu|pvc|橡胶|eva|网布|帆布|绒|革)/i;
const normalize = (value) => String(value || '').replace(/[（(].*?[）)]/g, '').replace(/\s+/g, '').toLowerCase();
const validMaterial = (value) => materialPattern.test(String(value || ''));

const audited = rows.map((row) => {
  const storeMaterial = String(row.抖店材质 || '');
  const sourceMaterial = String(row['1688材质'] || '');
  const storeValid = validMaterial(storeMaterial);
  const sourceValid = validMaterial(sourceMaterial);
  const conflict = storeValid && sourceValid && normalize(storeMaterial) !== normalize(sourceMaterial);
  const recommendedMaterial = sourceValid && !conflict ? sourceMaterial : (!sourceValid && storeValid ? storeMaterial : '');
  const status = conflict ? '需人工确认：抖店与1688材质不一致' : (recommendedMaterial ? '可用于客服' : '需人工确认：缺少可靠材质');
  return {
    商品名称: row.商品名称,
    SKU: row.SKU,
    关联状态: row.关联状态,
    推荐材质: recommendedMaterial,
    推荐规格: row['1688规格'] || row.抖店规格 || '',
    抖店材质: storeMaterial,
    '1688材质': sourceMaterial,
    审核结论: status,
    客服规则: status === '可用于客服' ? '可回答材质与规格；不得提及货源、供应商或货源价。' : '材质问题转人工；尺码仅按已确认规格回答。',
  };
});

const output = resolve(dataDir, `商品知识审核-${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`);
const out = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(out, XLSX.utils.json_to_sheet(audited), '知识审核');
XLSX.writeFile(out, output);
console.log(JSON.stringify({
  products: audited.length,
  ready: audited.filter((item) => item.审核结论 === '可用于客服').length,
  needsReview: audited.filter((item) => item.审核结论 !== '可用于客服').length,
  output,
}, null, 2));
