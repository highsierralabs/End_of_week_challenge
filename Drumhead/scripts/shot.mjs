// PURPOSE: Screenshot a Drumhead page in GPU Chromium, optionally after running a script in the page.
// USAGE:   node scripts/shot.mjs --url "<url>" --out shots/x.png [--w 1280 --h 800] [--eval "<js>"] [--wait ms]
// OUTPUT:  the PNG, plus the page's errors and the eval result on stdout.
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://127.0.0.1:5193/');
const out = arg('out', 'shots/shot.png');
const w = Number(arg('w', 1280)), h = Number(arg('h', 800));
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(arg('dpr', 1)), hasTouch: arg('touch') === '1', isMobile: arg('touch') === '1' });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
await page.goto(url);
if (!url.includes("validation")) await page.waitForFunction(() => window.drumhead?.ready, null, { timeout: 60000 });
const ev = arg('eval');
if (ev) console.log('eval:', JSON.stringify(await page.evaluate(`(async () => { ${ev} })()`)));
await page.waitForTimeout(Number(arg('wait', 400)));
await page.screenshot({ path: out });
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
