import puppeteer from 'puppeteer-core';

const version = await fetch('http://127.0.0.1:9223/json/version').then((response) => response.json());
const browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
const detailPage = (await browser.pages()).find((page) => /fxg\.jinritemai\.com\/ffa\/g\/create\?/.test(page.url()));
if (!detailPage) throw new Error('未找到已打开的抖店商品详情页。');

const result = await detailPage.evaluate(() => {
  const visible = (node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
  };
  const controls = [...document.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
    .filter(visible)
    .map((node) => {
      const input = node;
      const parentText = (input.closest('label, [class*="form" i], [class*="item" i], [class*="field" i]')?.innerText || '').replace(/\s+/g, ' ').trim();
      return {
        tag: input.tagName,
        name: input.getAttribute('name') || '',
        placeholder: input.getAttribute('placeholder') || '',
        value: 'value' in input ? String(input.value || '').slice(0, 500) : (input.textContent || '').slice(0, 500),
        context: parentText.slice(0, 600),
      };
    });
  return {
    title: document.title,
    text: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20000),
    controls,
  };
});
console.log(JSON.stringify(result, null, 2));
await browser.disconnect();
