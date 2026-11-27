// Draw a freehand loop with the mouse and report the resulting drum (dev check).
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.argv[2] ?? 'http://127.0.0.1:5193/');
await page.waitForFunction(() => window.drumhead?.ready);
await page.click('[data-mode="draw"]');
const cx = 640, cy = 380;
await page.mouse.move(cx + 200, cy);
await page.mouse.down();
for (let i = 1; i <= 120; i++) {
  const t = (i / 120) * Math.PI * 2;
  const r = 170 + 60 * Math.sin(3 * t) + 25 * Math.cos(5 * t);
  await page.mouse.move(cx + r * Math.cos(t), cy - r * Math.sin(t) * 0.8);
}
await page.mouse.up();
await page.waitForFunction(() => window.drumhead.state().drums[0]?.name === 'Your drum', null, { timeout: 30000 });
await page.mouse.click(cx + 40, cy + 30);
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/draw.png' });
console.log(JSON.stringify(await page.evaluate(() => { const d = window.drumhead.state().drums[0]; return { nv: d.nv, f1: d.f1, ms: Math.round(d.ms), area: d.area, heard: d.heard }; })));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
