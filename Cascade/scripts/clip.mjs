// PURPOSE: Render a short animated clip of a replay for the README: steps the shower clock
//          frame by frame in GPU Chromium (deterministic, independent of frame rate) and
//          encodes a palette-optimised GIF with ffmpeg.
// USAGE:   node scripts/clip.mjs --out docs/screenshots/shower.gif [--mode shower|sky] [--frames 72]
//          [--w 960 --h 540] [--preset side] [--base http://127.0.0.1:5190]   (needs a running server)
// OUTPUT:  the GIF; frames are written to shots/clip/ (gitignored).
// VERSION HISTORY:
//   1.0  2026-11-26  Initial release.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://127.0.0.1:5190');
const out = arg('out', 'docs/screenshots/shower.gif');
const mode = arg('mode', 'shower');
const frames = Number(arg('frames', 72));
const w = Number(arg('w', 960)), h = Number(arg('h', 540));
const preset = arg('preset', mode === 'sky' ? 'sky' : 'side');
const dir = `shots/clip-${mode}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  headless: true, channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
await page.goto(`${base}/?clean&quality=high`);
await page.waitForFunction(() => window.cascade?.result && window.cascade?.stage, null, { timeout: 180000 });
if (mode === 'sky') await page.evaluate(() => window.cascade.sky());
const span = await page.evaluate((m) => {
  const s = window.cascade.result.stats;
  return m === 'sky' ? [s.tMin + (s.tMax - s.tMin) * 0.15, s.tMax] : [-3000, s.tCore + 2500];
}, mode);
await page.evaluate((p) => window.cascade.stage.setPreset(p, false), preset);
for (let f = 0; f < frames; f++) {
  const t = span[0] + ((span[1] - span[0]) * f) / (frames - 1);
  await page.evaluate((tt) => window.cascade.seek(tt), t);
  await page.waitForTimeout(f === 0 ? 1500 : 60);
  await page.screenshot({ path: `${dir}/f${String(f).padStart(4, '0')}.png` });
}
await browser.close();
const fps = 18;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/f%04d.png`,
  '-vf', `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
  out], { stdio: 'inherit' });
console.log(`wrote ${out}`);
