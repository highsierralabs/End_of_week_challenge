// PURPOSE: Make the README pictures and the lead clip of Wheelwork from the production build:
//          stills as JPEG or PNG, the clip as a GIF filmed with Playwright's video recorder and
//          cut by ffmpeg between two marker flashes.
// USAGE:   npm run build && npx vite preview   (port 5207), then
//          node scripts/clip.mjs stills | clip | all
// OUTPUT:  docs/screenshots/*.jpg, validation.png, card.jpg, orrery.gif
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const which = process.argv[2] ?? 'all';
const base = 'http://127.0.0.1:5207/';
const root = join(import.meta.dirname, '..');
const outDir = join(root, 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });
const launch = () => chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const ready = (page) => page.waitForFunction(() => window.wheelwork?.ready, null, { timeout: 90000 });
// Every picture shows the machine set on the same day, whenever it is taken.
const FIXED_DAY = "window.wheelwork.model.resetTo(2461371.5);";
const camera = (pos, target) => `(() => { const s = window.wheelwork.stage; s.controls.autoRotate = false; s.camera.position.set(${pos.join(',')}); s.controls.target.set(${target.join(',')}); s.controls.update(); })()`;

async function stills() {
  const browser = await launch();
  const shots = [
    // name, viewport, query, script run after boot, wait (ms)
    ['app.jpg', [1440, 810], '?still=1', '', 800],
    ['wheelwork.jpg', [1440, 810], '?still=1&ui=0&view=train', camera([430, -290, 235], [22, 6, 80]), 800],
    ['exploded.jpg', [1440, 810], '?still=1&ui=0&view=exploded', '', 1200],
    ['tellurion.jpg', [1440, 810], '?still=1&ui=0&view=tellurion', '', 800],
    ['phases.jpg', [1440, 810], '?still=1&ui=0&view=tellurion&lamp=1', 'window.wheelwork.model.setTurns(0.32)', 2500],
    ['above.jpg', [1440, 810], '?still=1&ui=0&view=above', '', 800],
    ['workbench.jpg', [1440, 810], '?still=1&view=train', "window.wheelwork.app.selectTrain('mars-jupiter'); document.querySelector('.editor .buttons button').click();", 1800],
    ['sky.jpg', [1440, 810], '?still=1&tab=sky', 'window.wheelwork.model.setTurns(1450)', 800],
    ['phone.jpg', [390, 800], '?still=1', '', 800],
  ];
  for (const [name, [w, h], query, script, wait] of shots) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500 });
    await page.goto(base + query);
    await ready(page);
    await page.evaluate(FIXED_DAY);
    if (script) await page.evaluate(script);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: join(outDir, name), type: 'jpeg', quality: 88 });
    console.log(`still: ${name}`);
    if (name === 'wheelwork.jpg') {
      const r = spawnSync('ffmpeg', ['-y', '-i', join(outDir, name), '-vf', 'scale=1200:675:flags=lanczos', '-q:v', '4', join(outDir, 'card.jpg')], { encoding: 'utf8' });
      if (r.status !== 0) console.log(r.stderr.split('\n').slice(-5).join('\n'));
      else console.log('still: card.jpg');
    }
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await page.goto(`${base}validation.html`);
  await page.waitForFunction(() => window.wheelworkValidation?.done, null, { timeout: 300000 });
  await page.screenshot({ path: join(outDir, 'validation.png'), clip: { x: 0, y: 0, width: 1000, height: 1280 } });
  console.log('still: validation.png');
  await browser.close();
}

// Clips are filmed with Playwright's video recorder, whose clock does not line up with ours. So
// the action is bracketed by two flashes of solid magenta, and the cut is made between them by
// looking for those frames in the recording.
const flash = (page) => page.evaluate(() => new Promise((res) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;background:#ff00ff;z-index:99999';
  document.body.append(d);
  setTimeout(() => { d.remove(); requestAnimationFrame(() => requestAnimationFrame(() => res())); }, 800);
}));

async function clip(name, W, H, query, act, { fps, width, colors = 96, dither = 'bayer:bayer_scale=5' }) {
  const tmp = join(root, 'shots', 'video');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  await page.goto(base + query);
  await ready(page);
  await page.evaluate(FIXED_DAY);
  await act(page, () => flash(page));
  await flash(page);
  await page.waitForTimeout(800);
  await ctx.close();
  await browser.close();
  const webm = join(tmp, readdirSync(tmp).find((f) => f.endsWith('.webm')));
  const RATE = 25;
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', webm, '-vf', `fps=${RATE},scale=8:8`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  const frames = Math.floor(raw.stdout.length / 192);
  const magenta = [];
  for (let i = 0; i < frames; i++) {
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < 64; k++) { r += raw.stdout[i * 192 + k * 3]; g += raw.stdout[i * 192 + k * 3 + 1]; b += raw.stdout[i * 192 + k * 3 + 2]; }
    magenta.push(r / 64 > 180 && b / 64 > 180 && g / 64 < 90);
  }
  const first = magenta.indexOf(true);
  let startFrame = first;
  for (let i = first; i >= 0 && i < frames && i - startFrame < RATE / 2; i++) if (magenta[i]) startFrame = i + 1;
  let endFrame = magenta.lastIndexOf(true);
  while (endFrame > startFrame && magenta[endFrame - 1]) endFrame--;
  if (first < 0 || endFrame <= startFrame + RATE) { console.log(`clip ${name}: could not find the two marker flashes`); process.exit(1); }
  const from = (startFrame + 1) / RATE;
  const length = (endFrame - 1 - startFrame - 1) / RATE;
  const out = join(outDir, `${name}.gif`);
  const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`;
  const r = spawnSync('ffmpeg', ['-y', '-ss', from.toFixed(3), '-t', length.toFixed(3), '-i', webm, '-vf', filter, '-loop', '0', out], { encoding: 'utf8' });
  if (r.status !== 0) { console.log(r.stderr.split('\n').slice(-8).join('\n')); process.exit(1); }
  console.log(`clip: ${name}.gif (${length.toFixed(1)} s)`);
}

// The lead clip: the machine running, the case opening on the wheelwork, then the Earth and Moon.
const orrery = () => clip('orrery', 1280, 720, '?ui=0', async (page, start) => {
  await page.evaluate(() => {
    const s = window.wheelwork.stage;
    s.camera.position.set(330, -520, 330);
    s.controls.target.set(0, 0, 70);
    s.controls.update();
    window.wheelwork.app.play(2, 1);
  });
  await page.waitForTimeout(600);
  await start();
  await page.waitForTimeout(2400);
  await page.evaluate(() => window.wheelwork.app.setView('train', 1.8));
  await page.waitForTimeout(3800);
  await page.evaluate(() => { window.wheelwork.app.play(1, 1); window.wheelwork.app.setView('tellurion', 2.0); });
  await page.waitForTimeout(4000);
}, { fps: 9, width: 600, colors: 72 });

if (which === 'stills' || which === 'all') await stills();
if (which === 'clip' || which === 'all') await orrery();
