// PURPOSE: Run the validation page in GPU Chromium against a running server and print every row.
// USAGE:   node scripts/validate.mjs [--base http://127.0.0.1:5206]
// OUTPUT:  one ASCII line per check and a summary; exit 0 when all agree, 1 otherwise.
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { chromium } from 'playwright';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const base = arg('base', 'http://127.0.0.1:5206');
const ascii = (s) => String(s).replace(/−/g, '-').replace(/°/g, ' deg').replace(/[^\x20-\x7e]/g, '?');
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', ascii(e.message)));
await page.goto(`${base}/validation.html`);
await page.waitForFunction(() => window.wheelworkValidation && window.wheelworkValidation.done, null, { timeout: 120000 });
const v = await page.evaluate(() => window.wheelworkValidation);
let group = '';
for (const r of v.rows) {
  if (r.group !== group) { group = r.group; console.log(`\n${ascii(group)}`); }
  console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${ascii(r.name)}: ${ascii(r.measured)}  [${ascii(r.expected)}]`);
}
if (v.error) console.log(`error: ${ascii(v.error)}`);
console.log(`\nvalidation: ${v.rows.length - v.failed} of ${v.rows.length} agree${v.error ? ' (stopped by an error)' : ''}`);
await browser.close();
process.exit(v.failed === 0 && !v.error ? 0 : 1);
