import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = 'dist';
const types = { '.html': 'text/html', '.csv': 'text/csv', '.json': 'application/json', '.xlsx': 'application/octet-stream' };
const srv = createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; const f = join(root, p); if (!existsSync(f)) { res.writeHead(404); return res.end(); } let b = readFileSync(f); if (p === '/index.html') b = Buffer.from('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"></head><body>' + b + '</body></html>'); res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); res.end(b); }).listen(8765);
const browser = await chromium.launch();
const shots = process.argv[2] || 'test/shots';
const errs = [];
async function page(w, h, scheme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
  await ctx.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync('node_modules/xlsx/dist/xlsx.full.min.js') }));
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  return p;
}
const p = await page(1360, 900, 'light');
await p.goto('http://localhost:8765/');
await p.waitForTimeout(4000);
console.log('saved label at load:', await p.innerText('.saved'));
const tabs = ['Dashboards', 'Queries', 'Visualizations', 'Data sources', 'Datasets', 'Semantic model'];
for (const ws of ['lol', 'fieldtrials', 'reviews']) {
  await p.selectOption('select.wssel', ws); await p.waitForTimeout(3500);
  for (const t of tabs) {
    await p.click('nav.tabs.main button:has-text("' + t + '")'); await p.waitForTimeout(700);
    await p.screenshot({ path: shots + '/' + ws + '-' + t.replace(/\W+/g, '_') + '.png', fullPage: true });
  }
  await p.click('nav.tabs.main button:has-text("Dashboards")');
  const dashes = await p.$$eval('select.dsel option', os => os.map(o => o.value));
  for (const d of dashes) { await p.selectOption('select.dsel', d); await p.waitForTimeout(800); await p.screenshot({ path: shots + '/' + ws + '-dash-' + d + '.png', fullPage: true }); }
}
const m = await page(390, 844, 'dark');
await m.goto('http://localhost:8765/'); await m.waitForTimeout(4000);
await m.screenshot({ path: shots + '/mobile-dark.png', fullPage: false });
const sw = await m.evaluate(() => document.documentElement.scrollWidth);
console.log('mobile scrollWidth', sw);
console.log('errors:', errs.length); for (const e of errs.slice(0, 20)) console.log(e);
await browser.close(); srv.close();
