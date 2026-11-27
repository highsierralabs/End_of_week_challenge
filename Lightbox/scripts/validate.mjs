// PURPOSE: Run the Lightbox validation page in GPU Chromium and print every comparison.
// USAGE:   node scripts/validate.mjs [--url http://127.0.0.1:5196/validation.html] [--out shots/validation.png]
// OUTPUT:  one line per comparison, the totals, and optionally a full-page screenshot; exit 1
//          if any comparison is outside its tolerance.
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://127.0.0.1:5196/validation.html');
const out = arg('out', '');
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on('pageerror', (e) => console.log(`[page error] ${e.message.slice(0, 1500)}`));
page.on('console', (m) => { if (m.type() === 'error') console.log(`[console error] ${m.text().slice(0, 1500)}`); });
let bad = 0;
try {
  await page.goto(url);
  await page.waitForFunction(() => window.lightboxValidation?.done, null, { timeout: 600000 });
  const v = await page.evaluate(() => window.lightboxValidation);
  for (const r of v.results) {
    console.log(`${r.title}  (${r.seconds.toFixed(1)} s)`);
    for (const row of r.rows) {
      if (row.info) { console.log(`  info ${row.what}: ${row.measured.toPrecision(5)} ${row.unit}`); continue; }
      const ok = row.abs ? Math.abs(row.measured - row.expected) <= row.tol : Math.abs(row.measured / row.expected - 1) <= row.tol;
      if (!ok) bad++;
      const diff = row.abs ? `${(row.measured - row.expected).toFixed(3)} ${row.unit}` : `${((row.measured / row.expected - 1) * 100).toFixed(2)}%`;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${row.what}: ${row.measured.toPrecision(5)} vs ${row.expected.toPrecision(5)} ${row.unit} (${diff})`);
    }
  }
  console.log(`validation: ${v.passed} of ${v.total} agree${v.error ? `; error: ${v.error}` : ''}`);
  if (v.error || v.passed !== v.total) bad++;
  if (out) await page.screenshot({ path: out, fullPage: true });
} finally {
  await browser.close();
}
process.exit(bad ? 1 : 0);
