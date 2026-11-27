// PURPOSE: Screenshot the running app with headless Chromium (GPU), for visual checks and README images.
// USAGE:   node scripts/shot.mjs --url "/?seed=7" --out shots/app.png [--w 1600 --h 900] [--wait 0]
//          [--seek <ns>] [--preset overview|follow|side|ground|detector] [--eval "<js>"]
//          Needs a server on 127.0.0.1:5190 (npm run dev) or --base http://127.0.0.1:5191 (preview).
// OUTPUT:  the PNG, plus console errors and the backend used on stdout.
// VERSION HISTORY:
//   1.0  2026-11-26  Initial release.
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:5190');
const url = arg('url', '/');
const out = arg('out', 'shots/app.png');
const w = Number(arg('w', 1600));
const h = Number(arg('h', 900));
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(arg('dpr', 1)) });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(base + url);
await page.waitForFunction(() => window.cascade && window.cascade.result && window.cascade.stage, null, { timeout: 180000 });
const preset = arg('preset', null);
if (preset) await page.evaluate((p) => window.cascade.stage.setPreset(p, false), preset);
const seek = arg('seek', null);
if (seek !== null) await page.evaluate((t) => window.cascade.seek(Number(t)), seek);
const ev = arg('eval', null);
if (ev) await page.evaluate(ev);
await page.waitForTimeout(Number(arg('wait', 2500)));
await page.screenshot({ path: out });
const info = await page.evaluate(() => ({
  backend: document.documentElement.dataset.backend,
  segs: window.cascade.result.segmentCount,
  tMin: window.cascade.result.stats.tMin,
  tMax: window.cascade.result.stats.tMax,
  tCore: window.cascade.result.stats.tCore,
}));
console.log(JSON.stringify(info));
for (const l of logs.slice(0, 40)) console.log(l);
await browser.close();
