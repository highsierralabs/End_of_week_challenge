// PURPOSE: Take a screenshot of the running dev server (or any URL) in GPU Chromium.
// USAGE:   node scripts/shot.mjs --url "/?view=train" --out shots/x.png [--w 1600 --h 1000] [--wait 800] [--base http://127.0.0.1:5206]
// OUTPUT:  the PNG, and any page errors on stdout (ASCII).
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const base = arg('base', 'http://127.0.0.1:5206');
const url = base + arg('url', '/');
const out = arg('out', 'shots/shot.png');
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: Number(arg('w', 1600)), height: Number(arg('h', 1000)) }, deviceScaleFactor: Number(arg('dpr', 1)) });
page.on('pageerror', (e) => console.log('pageerror:', String(e.message).replace(/[^\x20-\x7e]/g, '?')));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`${m.type()}:`, m.text().replace(/[^\x20-\x7e]/g, '?').slice(0, 400)); });
await page.goto(url);
await page.waitForFunction(() => window.wheelwork && window.wheelwork.ready, null, { timeout: 60000 });
const js = arg('eval', '');
if (js) await page.evaluate(js);
await page.waitForTimeout(Number(arg('wait', 600)));
await mkdir(dirname(out), { recursive: true });
await page.screenshot({ path: out });
await browser.close();
console.log(`shot: ${out}`);
