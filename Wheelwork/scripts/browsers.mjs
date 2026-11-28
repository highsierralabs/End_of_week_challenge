// PURPOSE: Boot Wheelwork in Playwright's Firefox and WebKit builds (the latter a stand-in for
//          Safari) and check that it starts, draws a picture, runs, opens the case, rebuilds after a
//          tooth is changed and passes its validation page, with no page errors.
// USAGE:   node scripts/browsers.mjs [--base http://127.0.0.1:5207]   (a running server)
//          Needs `npx playwright install firefox webkit` once.
// OUTPUT:  one ASCII line per check and "browsers: PASS" or "browsers: FAIL"; exit 0 / 1.
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { firefox, webkit } from 'playwright';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const base = arg('base', 'http://127.0.0.1:5207');
const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '?');
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };

for (const [name, type] of [['firefox', firefox], ['webkit', webkit]]) {
  let browser;
  try {
    browser = await type.launch({ headless: true });
  } catch (e) {
    check(false, `${name}: could not launch (${ascii(e.message).slice(0, 120)})`);
    continue;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(`${base}/?still=1`);
    await page.waitForFunction(() => window.wheelwork && (window.wheelwork.ready || window.wheelwork.error), null, { timeout: 180000 });
    const boot = await page.evaluate(() => ({ error: window.wheelwork.error ?? null, quality: window.wheelwork.stage?.options.quality, parts: window.wheelwork.stage?.parts.length, renderer: (() => { const gl = window.wheelwork.stage?.renderer.getContext(); const e = gl?.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })() }));
    check(!boot.error && boot.parts > 90, `${name}: boots with ${boot.parts} parts (${ascii(boot.renderer).slice(0, 60)})${boot.error ? `: ${ascii(boot.error)}` : ''}`);
    const pic = await page.evaluate(() => {
      const { stage } = window.wheelwork;
      stage.frame(0);
      const c = document.createElement('canvas');
      c.width = 160; c.height = 100;
      const g = c.getContext('2d');
      g.drawImage(stage.canvas, 0, 0, 160, 100);
      const d = g.getImageData(0, 0, 160, 100).data;
      let sum = 0, sq = 0;
      for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += v; sq += v * v; }
      const n = d.length / 4;
      return { mean: sum / n, spread: Math.sqrt(sq / n - (sum / n) ** 2) };
    });
    check(pic.mean > 8 && pic.spread > 12, `${name}: a picture is drawn (mean ${pic.mean.toFixed(1)}, spread ${pic.spread.toFixed(1)})`);
    await page.click('.transport .play');
    await page.waitForTimeout(1200);
    await page.click('.transport .play');
    check((await page.evaluate(() => window.wheelwork.model.turns)) > 0.1, `${name}: Run turns the crank`);
    await page.click('.views button:has-text("Wheelwork")');
    await page.waitForTimeout(2500);
    const tags = await page.locator('.toothlabels span:visible').count();
    check((await page.evaluate(() => window.wheelwork.stage.caseOpen)) > 0.9 && tags >= 12, `${name}: the case opens and ${tags} tooth counts are written`);
    await page.evaluate(() => window.wheelwork.app.selectTrain('earth-mars'));
    await page.click('.editor .teeth label:nth-child(4) button:last-child');
    await page.waitForTimeout(800);
    check((await page.evaluate(() => window.wheelwork.model.layout.ok && window.wheelwork.stage.parts.length > 90)), `${name}: the machine rebuilds after a tooth is added`);
    await page.click('.views button:has-text("Sun lamp")');
    await page.waitForTimeout(2500);
    check((await page.evaluate(() => window.wheelwork.stage.lamp)) > 0.9, `${name}: the Sun lamp lights`);
    check(errors.length === 0, `${name}: no page errors${errors.length ? `: ${ascii(errors.slice(0, 3).join(' | ')).slice(0, 300)}` : ''}`);
    errors.length = 0;
    await page.goto(`${base}/validation.html`);
    await page.waitForFunction(() => window.wheelworkValidation && window.wheelworkValidation.done, null, { timeout: 300000 });
    const v = await page.evaluate(() => ({ n: window.wheelworkValidation.rows.length, failed: window.wheelworkValidation.rows.filter((r) => !r.ok).map((r) => r.name), error: window.wheelworkValidation.error ?? null }));
    check(v.failed.length === 0 && !v.error && errors.length === 0, `${name}: validation, ${v.n - v.failed.length} of ${v.n} agree${v.failed.length ? `; differing: ${ascii(v.failed.join('; '))}` : ''}${v.error ? `; ${ascii(v.error)}` : ''}`);
  } catch (e) {
    check(false, `${name}: ${ascii(e.message).slice(0, 300)}`);
  }
  await browser.close();
}
console.log(failed ? 'browsers: FAIL' : 'browsers: PASS');
process.exit(failed ? 1 : 0);
