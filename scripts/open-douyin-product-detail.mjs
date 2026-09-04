import puppeteer from 'puppeteer-core';

const productId = process.argv[2];
const categoryId = process.argv[3] || '1000007624';
if (!/^\d{8,}$/.test(productId || '')) throw new Error('请提供有效的抖店商品 ID。');
const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json());
const browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
const page = await browser.newPage();
await page.goto(`https://fxg.jinritemai.com/ffa/g/create?product_id=${productId}&cid=${categoryId}&entrance=edit`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
await new Promise((resolve) => setTimeout(resolve, 6000));
console.log(JSON.stringify({ title: await page.title(), url: page.url(), ready: (await page.evaluate(() => document.body?.innerText?.includes('类目属性') || false)) }, null, 2));
await browser.disconnect();
