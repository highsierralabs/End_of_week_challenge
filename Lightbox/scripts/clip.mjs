// PURPOSE: Make the README pictures and clips of Lightbox from the production build: stills as
//          PNG or JPEG after a set number of samples, clips as GIFs with Playwright's video
//          recorder and ffmpeg.
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
    ['camera.jpg', [1280, 720], "(async () => { await window.lightbox.go('tour:10'); await window.lightbox.setMode('studio'); document.querySelector('[data-tab=camera]').click(); })()", 3000, false],
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
    if (name === 'gems.jpg') {
      // The index card: the same picture, 1200 x 675 JPEG.
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

async function clip(name, W, H, act, { fps, width, colors = 128 }) {
  const tmp = join(root, 'shots', 'video');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(base);
  await ready(page);
  await hideToast(page);
  const span = await act(page, () => (Date.now() - t0) / 1000);
  await ctx.close();
  await browser.close();
  const webm = join(tmp, readdirSync(tmp).find((f) => f.endsWith('.webm')));
  const out = join(outDir, `${name}.gif`);
  const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  const r = spawnSync('ffmpeg', ['-y', '-ss', String(span.start), '-t', String(span.end - span.start), '-i', webm, '-vf', filter, '-loop', '0', out], { encoding: 'utf8' });
  if (r.status !== 0) { console.log(r.stderr.split('\n').slice(-8).join('\n')); process.exit(1); }
  console.log(`clip: ${name}.gif (${(span.end - span.start).toFixed(1)} s)`);
}

const studio = () => clip('studio', 1280, 720, async (page, now) => {
  // Start from a fresh picture so the clip opens on the noise clearing.
  await page.evaluate(() => window.lightbox.go('scene:still'));
  const start = now();
  await page.waitForTimeout(2600);
  const ball = await page.evaluate(() => window.lightbox.pointOf(window.lightbox.store.scene.objects.find((o) => o.name === 'Glass ball').id));
  await page.mouse.move(ball.x, ball.y);
  await page.mouse.down();
  await page.mouse.move(ball.x + 150, ball.y + 40, { steps: 28 });
  await page.waitForTimeout(150);
  await page.mouse.move(ball.x + 260, ball.y - 30, { steps: 24 });
  await page.mouse.up();
  await page.waitForTimeout(2400);
  await page.mouse.move(500, 130);
  await page.mouse.down();
  await page.mouse.move(380, 170, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(2600);
  return { start, end: now() };
}, { fps: 10, width: 800, colors: 160 });

const spectroscope = () => clip('spectroscope', 1280, 720, async (page, now) => {
  await page.click('[data-mode="spectro"]');
  await page.waitForTimeout(600);
  const start = now();
  for (const gas of ['Ne', 'H', 'He', 'Na', 'Hg', 'Ar']) {
    await page.click(`.lb-spectro [data-gas="${gas}"]`);
    await page.waitForTimeout(1700);
  }
  return { start, end: now() };
}, { fps: 6, width: 800, colors: 96 });

if (which === 'stills' || which === 'all') await stills();
if (which === 'studio' || which === 'all') await studio();
if (which === 'spectroscope' || which === 'all') await spectroscope();
