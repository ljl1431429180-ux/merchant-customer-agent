import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import XLSX from 'xlsx';
import puppeteer from 'puppeteer-core';
const dir=resolve('data'); const file=(await readdir(dir)).filter(x=>x.startsWith('抖店详情知识待确认-')).sort().at(-1); if(!file) throw new Error('未找到待确认详情表');
const book=XLSX.readFile(resolve(dir,file)); const products=XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{defval:''});
const v=await (await fetch('http://127.0.0.1:9223/json/version')).json(); const b=await puppeteer.connect({browserWSEndpoint:v.webSocketDebuggerUrl}); const p=(await b.pages()).find(x=>/chatgpt\.site/.test(x.url())); if(!p) throw new Error('未找到私有后台');
const data=await p.evaluate(async()=> (await fetch('/api/sources')).json()); await b.disconnect();
const invalidMaterial = /包装体积|包装清单|请选择|待补充/;
const rows=products.map(x=>{
  const s=data.sources.find(y=>y.sourceProductId===String(x.SKU));
  const douyinMaterial=invalidMaterial.test(String(x.材质||'')) ? '' : String(x.材质||'');
  return {
    商品名称: x.商品名称 || '', SKU: String(x.SKU || ''), 商品ID: String(x.商品ID || ''),
    抖店材质: douyinMaterial, 抖店规格: x.规格 || '', 类目属性: x.类目属性 || '{}',
    '1688材质': s?.material||'', '1688规格': s?.specifications||'',
    关联状态:s?.linkedProductName?'已关联':'未关联', 知识状态:'待确认'
  };
});
const out=resolve(dir,`商品知识合并待确认-${new Date().toISOString().replace(/[:.]/g,'-')}.xlsx`);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'合并待确认');XLSX.writeFile(wb,out);console.log(JSON.stringify({products:rows.length,linked:rows.filter(x=>x.关联状态==='已关联').length,output:out}));
