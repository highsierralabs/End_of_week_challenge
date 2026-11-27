// PURPOSE: Screenshot a Lightbox page in GPU Chromium after it has traced a number of samples.
// USAGE:   node scripts/shot.mjs --url "http://127.0.0.1:5196/" --out shots/x.png [--spp 64]
//          [--w 1280 --h 800] [--eval "js run in the page before waiting"] [--timeout 120]
//          [--after "js run after the wait; its JSON result is printed"]
// OUTPUT:  the PNG, and one line with samples, photons and the wait.
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://127.0.0.1:5196/');
const out = arg('out', 'shots/shot.png');
const spp = Number(arg('spp', '64'));
const w = Number(arg('w', '1280'));
const h = Number(arg('h', '800'));
const timeout = Number(arg('timeout', '120')) * 1000;
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('console', (m) => console.log(`[page ${m.type()}] ${m.text().slice(0, 2000)}`));
page.on('pageerror', (e) => console.log(`[page error] ${e.message.slice(0, 2000)}`));
const t0 = Date.now();
try {
  await page.goto(url);
  await page.waitForFunction(() => window.lightbox && (window.lightbox.ready || window.lightbox.error), null, { timeout });
  const pre = arg('eval', '');
  if (pre) await page.evaluate(pre);
  await page.waitForFunction((n) => window.lightbox.error || window.lightbox.view.tracer.frame >= n, spp, { timeout });
  const st = await page.evaluate(() => ({ frame: window.lightbox.view.tracer.frame, photons: window.lightbox.view.tracer.photons, tiles: window.lightbox.view.tilesPerFrame, err: window.lightbox.error, size: [window.lightbox.view.tracer.width, window.lightbox.view.tracer.height] }));
  const after = arg('after', '');
  if (after) console.log(`after: ${JSON.stringify(await page.evaluate(after))}`);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`shot: ${out} ${JSON.stringify(st)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} finally {
  await browser.close();
}
