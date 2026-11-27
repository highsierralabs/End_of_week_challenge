// PURPOSE: Smoke-test the production build of Drumhead the way a visitor meets it: served from a
//          subfolder (/drumhead/), in GPU Chromium, on a desktop and a phone viewport. Checks the
//          boot, the circle's fundamental against the exact value, the twins' isospectrality, a
//          freehand drawing, sand mode, the listening game, the mode gallery, an offline audio
//          render, the validation page, and that no page errors were raised.
// USAGE:   npm run build && node scripts/smoke.mjs
// OUTPUT:  one ASCII line per check and "smoke: PASS" or "smoke: FAIL"; exit 0 / 1.
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const dist = join(import.meta.dirname, '..', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith('/drumhead/')) { res.writeHead(404); res.end(); return; }
  let rel = normalize(path.slice('/drumhead/'.length));
  if (rel === '.' || rel.endsWith('/') || rel === '') rel = join(rel, 'index.html');
  if (rel.startsWith('..')) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(join(dist, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(5194, '127.0.0.1', r));
const base = 'http://127.0.0.1:5194/drumhead/';

let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
try {
  // Desktop.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base);
    await page.waitForFunction(() => window.drumhead?.ready, null, { timeout: 60000 });
    // Worker code must stay in the workers: a handler on the page would answer its own messages.
    check(await page.evaluate(() => window.onmessage === null), 'page: no worker message handler on the main thread');
    const st = await page.evaluate(() => window.drumhead.state());
    const d = st.drums[0];
    const exact = (100 * 2.404825557695773) / 0.33 / (2 * Math.PI);
    check(d.modes >= 64, `circle: ${d.modes} modes on ${d.nv} vertices in ${Math.round(d.ms)} ms`);
    check(Math.abs(d.f1 / exact - 1) < 0.01, `circle: fundamental ${d.f1.toFixed(2)} Hz, exact ${exact.toFixed(2)} Hz`);
    check(Math.abs(d.heard.area / d.area - 1) < 0.06, `circle: Weyl hears ${d.heard.area.toFixed(3)} m2 of ${d.area.toFixed(3)} m2`);

    const audio = await page.evaluate(() => window.drumhead.renderOffline(1.5, 0));
    check(audio.finite && audio.peak > 0.05 && audio.peak < 1, `audio: offline strike peak ${audio.peak.toFixed(3)}, rms ${audio.rms.toFixed(3)}`);

    await page.click('[data-shape="twins"]');
    await page.waitForFunction(() => window.drumhead.state().drums.length === 2, null, { timeout: 60000 });
    const worst = await page.evaluate(() => {
      const [a, b] = window.drumhead.state().drums;
      let w = 0;
      for (let k = 0; k < Math.min(a.lambda.length, b.lambda.length); k++) w = Math.max(w, Math.abs(a.lambda[k] - b.lambda[k]) / a.lambda[k]);
      return w;
    });
    check(worst < 1e-9, `twins: largest relative frequency difference ${worst.toExponential(1)}`);

    await page.click('[data-act="modes"]');
    await page.waitForTimeout(300);
    const thumbs = await page.evaluate(() => document.querySelectorAll('dialog.dh-gallery[open] .dh-thumb').length);
    check(thumbs >= 24, `modes: gallery shows ${thumbs} mode pairs`);
    await page.keyboard.press('Escape');

    // Draw a loop.
    await page.click('[data-mode="draw"]');
    const box = await page.locator('.dh-stage').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx + 180, cy);
    await page.mouse.down();
    for (let i = 1; i <= 90; i++) {
      const t = (i / 90) * Math.PI * 2, r = 150 + 50 * Math.sin(3 * t);
      await page.mouse.move(cx + r * Math.cos(t), cy - r * Math.sin(t));
    }
    await page.mouse.up();
    await page.waitForFunction(() => window.drumhead.state().drums[0]?.name === 'Your drum', null, { timeout: 60000 });
    const drawn = await page.evaluate(() => window.drumhead.state().drums[0]);
    check(drawn.modes >= 64 && drawn.f1 > 20, `draw: freehand drum, ${drawn.nv} vertices, fundamental ${drawn.f1.toFixed(1)} Hz`);
    await page.mouse.click(cx + 20, cy + 10);

    // Sand: a tap in a corner (every mode still there) must not poison the drive.
    await page.click('[data-shape="square"]');
    await page.waitForFunction(() => window.drumhead.state().current === 'square', null, { timeout: 60000 });
    // Sand.
    await page.click('[data-mode="sand"]');
    {
      const b2 = await page.locator('.dh-stage').boundingBox();
      const corner = await page.evaluate(() => { const r = document.querySelector('.dh-stage').getBoundingClientRect(); return [r.width, r.height]; });
      // The square spans +-0.28 m on a 1 m table centred in the stage: aim just inside its lower-right corner.
      const side = Math.min(corner[0], corner[1]) * 0.96;
      await page.mouse.click(b2.x + corner[0] / 2 + side * 0.278, b2.y + corner[1] / 2 + side * 0.278);
    }
    await page.waitForTimeout(1500);
    const sand = await page.evaluate(() => window.drumhead.state());
    check(sand.mode === 'sand' && sand.levels.every(Number.isFinite), `sand: ran 1.5 s after a corner tap at (${sand.drives[0].map((v) => v.toFixed(3))}), drive level ${sand.levels[0]}`);

    // Listen.
    await page.click('[data-mode="listen"]');
    await page.waitForFunction(() => window.drumhead.quiz().options.length === 3, null, { timeout: 60000 });
    const q = await page.evaluate(() => window.drumhead.quiz());
    await page.click(`[data-opt="${q.answer}"]`);
    const q2 = await page.evaluate(() => window.drumhead.quiz());
    check(q2.done && q2.score === 1, `listen: round answered (${q.answer}), score ${q2.score} of ${q2.rounds}`);

    check(errors.length === 0, `desktop: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
    await page.close();
  }
  // Validation page: every check recomputed in the browser.
  {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + 'validation.html');
    await page.waitForFunction(() => document.documentElement.dataset.done === '1', null, { timeout: 120000 });
    const rows = await page.evaluate(() => document.querySelectorAll('.v-gww-table tbody tr').length);
    const finest = await page.evaluate(() => document.querySelector('.v-gww-table tbody tr td:last-child').textContent);
    check(rows === 25 && errors.length === 0, `validation: 25 Driscoll rows, mode 1 error ${finest} at the finest mesh, no errors`);
    await page.close();
  }
  // Phone.
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '?shape=star');
    await page.waitForFunction(() => window.drumhead?.ready, null, { timeout: 60000 });
    const box = await page.locator('.dh-stage').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const visible = await page.evaluate(() => ['[data-act="about"]', '[data-shape="twins"]', '[data-mode="listen"]'].every((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 && r.width > 0;
    }));
    check(visible, 'phone: About, Twins and Listen are on screen');
    check(errors.length === 0, `phone: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
    await page.close();
  }
} catch (e) {
  check(false, `exception: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await browser.close();
  server.close();
}
console.log(`smoke: ${failed ? 'FAIL' : 'PASS'}`);
process.exit(failed ? 1 : 0);
