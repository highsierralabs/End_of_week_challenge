// PURPOSE: Make the README pictures and clips of Lightbox from the production build: stills as
//          PNG or JPEG after a set number of samples, clips as GIFs with
//          Playwright's video recorder, cut by ffmpeg.
// USAGE:   npm run build && npx vite preview   (port 5197), then
//          node scripts/clip.mjs stills | studio | spectroscope | all
// OUTPUT:  docs/screenshots/*.jpg and *.png, card.jpg, studio.gif, spectroscope.gif
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const which = process.argv[2] ?? 'all';
const base = 'http://127.0.0.1:5197/';
const root = join(import.meta.dirname, '..');
const outDir = join(root, 'docs', 'screenshots');
mkdirSync(outDir, { recursive: true });
const launch = () => chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const ready = (page) => page.waitForFunction(() => window.lightbox?.ready, null, { timeout: 90000 });
const samples = (page, n) => page.waitForFunction((k) => window.lightbox.view.tracer.frame >= k, n, { timeout: 600000 });
const hideToast = (page) => page.addStyleTag({ content: '.lb-toast { display: none !important; }' });

async function stills() {
  const browser = await launch();
  const shots = [
    // name, viewport, setup, samples, bare (interface hidden)
    ['app.jpg', [1280, 720], '', 3000, false],
    ['gems.jpg', [1280, 720], "window.lightbox.go('scene:gems')", 6000, true],
    ['glassware.jpg', [1280, 720], "window.lightbox.go('scene:glass')", 5000, true],
    ['prism.jpg', [1280, 720], "window.lightbox.go('scene:prism')", 4000, true],
    ['lens.jpg', [1280, 720], "window.lightbox.go('scene:lens')", 4000, true],
    ['tour.jpg', [1280, 720], "window.lightbox.go('tour:9')", 3000, false],
    ['camera.jpg', [1280, 720], "(async () => { await window.lightbox.go('tour:10'); [...document.querySelectorAll('.lb-tour button')].find((b) => /in the studio/.test(b.textContent)).click(); await new Promise((r) => setTimeout(r, 600)); document.querySelector('[data-tab=camera]').click(); })()", 3000, false],
    ['spectroscope.png', [1280, 720], "(async () => { await window.lightbox.setMode('spectro'); document.querySelector('.lb-spectro [data-gas=Hg]').click(); })()", 4000, false],
    ['phone.jpg', [390, 780], "window.lightbox.go('scene:gems')", 1500, false],
  ];
  for (const [name, [w, h], setup, spp, bare] of shots) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 });
    await page.goto(base);
    await ready(page);
    await hideToast(page);
    if (setup) await page.evaluate(setup);
    await page.waitForTimeout(400);
    if (bare) await page.keyboard.press('h');
    await page.waitForTimeout(300);
    await samples(page, spp);
    await page.screenshot(name.endsWith('.jpg') ? { path: join(outDir, name), type: 'jpeg', quality: 90 } : { path: join(outDir, name) });
    console.log(`still: ${name}`);
    if (name === 'lens.jpg') {
      // The index card: the ray box, 1200 x 675 JPEG.
      const r = spawnSync('ffmpeg', ['-y', '-i', join(outDir, name), '-vf', 'scale=1200:675:flags=lanczos', '-q:v', '4', join(outDir, 'card.jpg')], { encoding: 'utf8' });
      if (r.status !== 0) console.log(r.stderr.split('\n').slice(-5).join('\n'));
    }
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await page.goto(`${base}validation.html`);
  await page.waitForFunction(() => window.lightboxValidation?.done, null, { timeout: 600000 });
  await page.screenshot({ path: join(outDir, 'validation.png'), clip: { x: 0, y: 0, width: 1100, height: 1500 } });
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

async function clip(name, W, H, act, { fps, width, colors = 128, dither = 'bayer:bayer_scale=5' }) {
  const tmp = join(root, 'shots', 'video');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  await page.goto(base);
  await ready(page);
  await hideToast(page);
  await act(page, () => flash(page));
  await flash(page);
  await page.waitForTimeout(800);
  await ctx.close();
  await browser.close();
  const webm = join(tmp, readdirSync(tmp).find((f) => f.endsWith('.webm')));
  // Find the two flashes: tiny frames at 25 per second, magenta ones marked.
  const RATE = 25;
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', webm, '-vf', `fps=${RATE},scale=8:8`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  const frames = Math.floor(raw.stdout.length / 192);
  const magenta = [];
  for (let i = 0; i < frames; i++) {
    let r = 0, g = 0, b = 0;
    for (let k = 0; k < 64; k++) { r += raw.stdout[i * 192 + k * 3]; g += raw.stdout[i * 192 + k * 3 + 1]; b += raw.stdout[i * 192 + k * 3 + 2]; }
    magenta.push(r / 64 > 180 && b / 64 > 180 && g / 64 < 90);
  }
  // The first flash runs from the first magenta frame until half a second passes without one
  // (a flash can be recorded with gaps); the second flash is the last run of magenta frames.
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

const studio = () => clip('studio', 1280, 720, async (page, start) => {
  // Start from a fresh picture so the clip opens on the noise clearing.
  await start();
  await page.evaluate(() => window.lightbox.go('scene:still'));
  await page.waitForTimeout(2000);
  const ball = await page.evaluate(() => window.lightbox.pointOf(window.lightbox.store.scene.objects.find((o) => o.name === 'Glass ball').id));
  await page.mouse.move(ball.x, ball.y);
  await page.mouse.down();
  await page.mouse.move(ball.x + 150, ball.y + 40, { steps: 18 });
  await page.mouse.move(ball.x + 260, ball.y - 30, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(2000);
  await page.mouse.move(500, 130);
  await page.mouse.down();
  await page.mouse.move(400, 165, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(2200);
}, { fps: 6, width: 600, colors: 56, dither: 'none' });

const spectroscope = () => clip('spectroscope', 1280, 720, async (page, start) => {
  await page.click('[data-mode="spectro"]');
  await page.waitForTimeout(600);
  await start();
  for (const gas of ['Ne', 'H', 'He', 'Na', 'Hg', 'Ar']) {
    await page.click(`.lb-spectro [data-gas="${gas}"]`);
    await page.waitForTimeout(1700);
  }
}, { fps: 6, width: 800, colors: 96 });

if (which === 'stills' || which === 'all') await stills();
if (which === 'studio' || which === 'all') await studio();
if (which === 'spectroscope' || which === 'all') await spectroscope();
