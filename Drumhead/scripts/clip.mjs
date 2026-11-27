// PURPOSE: Record the README clips of Drumhead (a struck drum, the sand sweep) as GIFs, from the
//          production build, with Playwright's video recorder and ffmpeg.
// USAGE:   npm run build && npx vite preview  (port 5193), then  node scripts/clip.mjs play|sand|twins
// OUTPUT:  docs/screenshots/<name>.gif
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const which = process.argv[2] ?? 'play';
const base = 'http://127.0.0.1:5193/';
const tmp = join(import.meta.dirname, '..', 'shots', 'video');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const W = 960, H = 600;
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
const page = await ctx.newPage();
const url = { play: '?shape=guitar', twins: '?shape=twins', sand: '?shape=circle&mode=sand' }[which];
await page.goto(base + url);
await page.waitForFunction(() => window.drumhead?.ready, null, { timeout: 60000 });
const t0 = Date.now();
let trimStart = 0;
if (which === 'play') {
  await page.waitForTimeout(600);
  trimStart = (Date.now() - t0) / 1000;
  const box = await page.locator('.dh-stage').boundingBox();
  const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  for (const [fx, fy, wait] of [[0.53, 0.42, 1400], [0.45, 0.62, 1100], [0.56, 0.7, 700], [0.5, 0.3, 1600]]) {
    const [x, y] = at(fx, fy);
    await page.mouse.click(x, y);
    await page.waitForTimeout(wait);
  }
} else if (which === 'twins') {
  await page.waitForTimeout(600);
  trimStart = (Date.now() - t0) / 1000;
  await page.evaluate(() => { window.drumhead.strike(0, -0.05, 0.02); window.drumhead.strike(1, 0.02, -0.04); });
  await page.waitForTimeout(3200);
} else {
  await page.evaluate(() => document.querySelector('[data-act="sweep"]').click());
  await page.waitForTimeout(400);
  trimStart = (Date.now() - t0) / 1000;
  await page.waitForTimeout(20500);
}
const dur = (Date.now() - t0) / 1000 - trimStart;
await ctx.close();
await browser.close();
const webm = join(tmp, readdirSync(tmp).find((f) => f.endsWith('.webm')));
// The video starts at page creation; skip the load and keep the action.
const lead = 1.2; // seconds of page load before t0, roughly
const out = join(import.meta.dirname, '..', 'docs', 'screenshots', `${which}.gif`);
const fps = which === 'sand' ? 8 : 14;
const width = which === 'sand' ? 560 : 640;
const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`;
const r = spawnSync('ffmpeg', ['-y', '-ss', String(lead + trimStart), '-t', String(dur), '-i', webm, '-vf', filter, '-loop', '0', out], { encoding: 'utf8' });
if (r.status !== 0) { console.log(r.stderr.split('\n').slice(-8).join('\n')); process.exit(1); }
console.log(`clip: ${out} (${dur.toFixed(1)} s)`);
