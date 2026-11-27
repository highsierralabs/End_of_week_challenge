// PURPOSE: Smoke-test the production build in GPU Chromium on both backends: boot, first
//          shower, a split (100 PeV) shower, sky mode and the Data dialog, with no page errors.
// USAGE:   npm run build && node scripts/smoke.mjs        (serves dist/ itself on 127.0.0.1:5191)
// OUTPUT:  one ASCII line per check and "smoke: PASS" or "smoke: FAIL"; exit 0 / 1.
// VERSION HISTORY:
//   1.0  2026-11-26  Initial release.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn('npx vite preview --port 5191 --strictPort', { cwd: new URL('..', import.meta.url), shell: true, stdio: 'ignore' });
const base = 'http://127.0.0.1:5191';
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

try {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/'); if (r.ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const browser = await chromium.launch({
    headless: true, channel: 'chromium',
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
  });
  for (const [label, query] of [['WebGPU', ''], ['WebGL2', '?webgl']]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => localStorage.setItem('cascade.welcomed.v1', '1'));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base + '/' + query);
    await page.waitForFunction(() => window.cascade?.result && window.cascade?.stage, null, { timeout: 120000 });
    const backend = await page.evaluate(() => document.documentElement.dataset.backend);
    check(backend === label, `${label}: backend reported ${backend}`);
    const first = await page.evaluate(() => window.cascade.result.segmentCount);
    check(first > 10000, `${label}: first shower has ${first} segments`);
    const split = await page.evaluate(async () => { await window.cascade.run({ energyEV: 1e17 }); return window.cascade.result.stats.gh?.xmax ?? NaN; });
    check(split > 500 && split < 950, `${label}: 100 PeV split shower, Xmax ${split.toFixed(0)} g/cm2`);
    const sky = await page.evaluate(async () => { await window.cascade.sky(); return window.cascade.result.segmentCount; });
    check(sky > 10000, `${label}: sky mode has ${sky} segments`);
    await page.evaluate(() => document.querySelector('.cx-btn--obs')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForTimeout(500);
    const dataOpen = await page.evaluate(() => !!document.querySelector('dialog.cx-obs[open]'));
    check(dataOpen, `${label}: Data dialog opens`);
    check(errors.length === 0, `${label}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
    await page.close();
  }
  const page = await browser.newPage();
  const verrs = [];
  page.on('pageerror', (e) => verrs.push(e.message));
  await page.goto(base + '/validation.html');
  await page.waitForTimeout(1500);
  const cards = await page.evaluate(() => document.querySelectorAll('canvas').length);
  check(cards >= 3 && verrs.length === 0, `validation page: ${cards} charts, ${verrs.length} errors`);
  await browser.close();
} catch (e) {
  check(false, `exception: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else server.kill();
}
console.log(`smoke: ${failed ? 'FAIL' : 'PASS'}`);
process.exit(failed ? 1 : 0);
