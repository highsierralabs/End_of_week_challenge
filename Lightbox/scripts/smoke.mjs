// PURPOSE: Smoke-test the production build of Lightbox the way a visitor meets it: served from a
//          subfolder (/lightbox/), in GPU Chromium, on a desktop and a phone viewport. Checks the
//          boot, that the picture is not black and both tracers run, selecting, dragging,
//          orbiting, focusing, undo, the inspector, every built-in scene, every tour step, the
//          spectroscope with both dispersers and all eight gases, share links, picture export,
//          a dropped model, the validation page (every comparison), and that no page errors
//          were raised. Then boots on ANGLE's Vulkan backend (a second shader compiler) and on the
//          software renderer (a stand-in for a slow device).
// USAGE:   npm run build && node scripts/smoke.mjs
// OUTPUT:  one ASCII line per check and "smoke: PASS" or "smoke: FAIL"; exit 0 / 1.
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith('/lightbox/')) { res.writeHead(404); res.end(); return; }
  let rel = normalize(path.slice('/lightbox/'.length));
  if (rel === '.' || rel.endsWith('/') || rel === '') rel = join(rel, 'index.html');
  if (rel.startsWith('..')) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(join(dist, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(5198, '127.0.0.1', r));
const base = 'http://127.0.0.1:5198/lightbox/';

let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };
const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '?');

async function open(browser, opts) {
  const ctx = await browser.newContext({ acceptDownloads: true, ...opts });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  return { ctx, page, errors };
}
const ready = (page, timeout = 90000) => page.waitForFunction(() => window.lightbox && (window.lightbox.ready || window.lightbox.error), null, { timeout });
const samples = (page, n, timeout = 60000) => page.waitForFunction((k) => window.lightbox.view.tracer.frame >= k, n, { timeout });
const state = (page) => page.evaluate(() => window.lightbox.state());

const gpu = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
try {
  // ------------------------------------------------------------------ desktop
  {
    const { ctx, page, errors } = await open(gpu, { viewport: { width: 1280, height: 800 } });
    const t0 = Date.now();
    await page.goto(base);
    await ready(page);
    const err = await page.evaluate(() => window.lightbox.error);
    check(!err, `boot: ready in ${((Date.now() - t0) / 1000).toFixed(1)} s${err ? `, error: ${ascii(err)}` : ''}`);
    await samples(page, 24);
    let st = await state(page);
    const mean = await page.evaluate(() => window.lightbox.view.tracer.meter().mean);
    check(st.objects >= 6 && mean > 0.5 && Number.isFinite(mean), `picture: ${st.objects} objects, mean luminance ${mean.toFixed(1)} cd/m2 after ${st.frame} samples`);
    check(st.photons > 0, `photon pass: ${st.photons} photons traced`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'layout: no horizontal overflow at 1280 px');

    // Select by clicking, move by dragging, undo.
    const ball = await page.evaluate(() => { const o = window.lightbox.store.scene.objects.find((x) => x.name === 'Glass ball'); return { id: o.id, pos: o.pos, at: window.lightbox.pointOf(o.id) }; });
    await page.mouse.click(ball.at.x, ball.at.y);
    st = await state(page);
    check(st.selected === ball.id, 'select: clicking the glass ball selects it');
    await page.mouse.move(ball.at.x, ball.at.y);
    await page.mouse.down();
    await page.mouse.move(ball.at.x + 60, ball.at.y + 10, { steps: 6 });
    await page.mouse.move(ball.at.x + 120, ball.at.y + 20, { steps: 6 });
    await page.mouse.up();
    const moved = await page.evaluate((id) => window.lightbox.store.scene.objects.find((x) => x.id === id).pos, ball.id);
    check(moved[0] > ball.pos[0] + 0.05 && Math.abs(moved[1] - ball.pos[1]) < 1e-9, `drag: the ball moved from x=${ball.pos[0].toFixed(3)} to x=${moved[0].toFixed(3)} at the same height`);
    await page.keyboard.press('Control+z');
    const back = await page.evaluate((id) => window.lightbox.store.scene.objects.find((x) => x.id === id).pos, ball.id);
    check(Math.abs(back[0] - ball.pos[0]) < 1e-9, 'undo: Ctrl+Z puts it back');

    // Orbit, dolly and focus.
    const cam0 = await page.evaluate(() => ({ ...window.lightbox.store.scene.camera }));
    await page.mouse.move(640, 120);
    await page.mouse.down();
    await page.mouse.move(540, 150, { steps: 5 });
    await page.mouse.up();
    await page.mouse.wheel(0, -300);
    const cam1 = await page.evaluate(() => ({ ...window.lightbox.store.scene.camera }));
    const dist = (c) => Math.hypot(c.pos[0] - c.target[0], c.pos[1] - c.target[1], c.pos[2] - c.target[2]);
    check(Math.abs(cam1.pos[0] - cam0.pos[0]) > 0.01 && dist(cam1) < dist(cam0) * 0.95, `camera: orbit moved it, wheel brought it in from ${dist(cam0).toFixed(2)} m to ${dist(cam1).toFixed(2)} m`);
    const at2 = await page.evaluate((id) => window.lightbox.pointOf(id), ball.id);
    await page.mouse.dblclick(at2.x, at2.y);
    const focus = await page.evaluate(() => window.lightbox.store.scene.camera.focus);
    check(Math.abs(focus - cam1.focus) > 0.02 && focus > 0.3 && focus < 3, `focus: double-click set it to ${focus.toFixed(2)} m`);

    // Inspector: change the material, turn a lens ring.
    await page.mouse.click(at2.x, at2.y);
    await page.waitForTimeout(450);
    await page.mouse.click(at2.x, at2.y);
    await page.waitForFunction((id) => window.lightbox.store.selectedId === id, ball.id, { timeout: 5000 }).catch(() => {});
    await page.selectOption('select[aria-label="Made of"]', 'metal');
    const kind = await page.evaluate((id) => window.lightbox.store.scene.objects.find((x) => x.id === id).material.kind, ball.id);
    check(kind === 'metal', 'inspector: the ball becomes metal');
    await page.click('[data-tab="camera"]');
    const f0 = await page.evaluate(() => window.lightbox.store.scene.camera.fstop);
    await page.focus('[aria-label="Aperture"]');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const f1 = await page.evaluate(() => window.lightbox.store.scene.camera.fstop);
    check(f1 > f0 * 1.3, `lens ring: aperture stopped down from f/${f0.toFixed(1)} to f/${f1.toFixed(1)}`);
    await page.click('[data-tab="darkroom"]');
    check(await page.locator('text=Render and save').count() === 1, 'darkroom: tab shows the print controls');

    // Every built-in scene.
    const ids = await page.evaluate(() => [...document.querySelectorAll('.lb-scene-select option')].map((o) => o.value));
    let scenesOk = ids.length >= 7;
    for (const id of ids) {
      await page.evaluate((x) => window.lightbox.go(`scene:${x}`), id);
      await samples(page, 6).catch(() => { scenesOk = false; });
      const m = await page.evaluate(() => window.lightbox.view.tracer.meter().mean);
      if (!(m > 0) || !Number.isFinite(m)) { scenesOk = false; console.log(`     scene ${id}: mean ${m}`); }
    }
    check(scenesOk, `scenes: all ${ids.length} load and render (${ids.join(', ')})`);

    // The tour.
    await page.click('[data-mode="tour"]');
    let steps = 0;
    let tourOk = true;
    for (let i = 0; i < 12; i++) {
      await samples(page, 4).catch(() => { tourOk = false; });
      st = await state(page);
      if (st.tourStep !== i) tourOk = false;
      const m = await page.evaluate(() => window.lightbox.view.tracer.meter().mean);
      if (!(m > 0)) { tourOk = false; console.log(`     tour step ${i + 1}: mean ${m}`); }
      steps++;
      if (i < 11) { await page.click('.lb-tour .lb-btn.primary'); await page.waitForFunction((k) => window.lightbox.state().tourStep === k && window.lightbox.view.tracer.frame < 4, i + 1, { timeout: 20000 }).catch(() => {}); }
    }
    check(tourOk && steps === 12, 'tour: all 12 steps load and render');
    await page.click('text=Open this scene in the studio');
    st = await state(page);
    check(st.mode === 'studio' && st.scene === 'Lens bench', 'tour: the last step opens in the studio');

    // The spectroscope.
    await page.click('[data-mode="spectro"]');
    let specOk = true;
    for (const disperser of ['grating', 'prism']) {
      for (const gas of ['H', 'He', 'Ne', 'Na', 'Ar', 'Kr', 'Xe', 'Hg']) {
        await page.click(`.lb-spectro [data-gas="${gas}"]`);
        await page.waitForFunction(() => window.lightbox.view.tracer.frame >= 20, null, { timeout: 30000 }).catch(() => { specOk = false; });
        const peak = await page.evaluate(() => window.lightbox.view.tracer.meter().peak);
        if (!(peak > 0)) { specOk = false; console.log(`     ${disperser} ${gas}: nothing visible`); }
      }
      if (disperser === 'grating') await page.click('text=Use a prism instead');
    }
    check(specOk, 'spectroscope: all eight gases show lines through the grating and through the prism');
    await page.click('text=Mystery lamp');
    await page.waitForSelector('.lb-quiz');
    await page.click('.lb-quiz [data-gas="H"]');
    check((await page.textContent('.lb-verdict')).trim().length > 0, 'spectroscope: the quiz answers a guess');
    await page.click('text=Back to the lamps');

    // Share link round trip.
    await page.click('[data-mode="studio"]');
    await page.evaluate(() => window.lightbox.go('scene:gems'));
    await page.click('text=Share');
    await page.waitForFunction(() => location.hash.startsWith('#s='), null, { timeout: 5000 });
    const link = await page.evaluate(() => location.href);
    const page2 = await ctx.newPage();
    await page2.goto(link);
    await ready(page2);
    const shared = await page2.evaluate(() => ({ n: window.lightbox.store.scene.objects.length, name: window.lightbox.store.scene.name, cut: window.lightbox.store.scene.objects.find((o) => o.name === 'Diamond')?.shape.cut }));
    check(shared.name === 'Gems' && shared.cut === 'brilliant' && shared.n === 11, `share: a ${link.length}-character link reopens the gems scene (${shared.n} objects)`);
    await page2.close();
    const page3 = await ctx.newPage();
    await page3.goto(`${base}#s=AAAA`);
    await ready(page3);
    check(await page3.evaluate(() => window.lightbox.store.scene.name === 'Still life'), 'share: a broken link falls back to the default scene');
    await page3.close();

    // Pictures.
    await page.click('[data-tab="darkroom"]');
    const [dl1] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('text=Save this picture')]);
    check(/\.png$/.test(dl1.suggestedFilename()), `save: ${dl1.suggestedFilename()}`);
    await page.locator('[aria-label="Samples"]').evaluate((el) => { el.value = '0'; el.dispatchEvent(new Event('input')); });
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('text=Render and save')]);
    const path2 = await dl2.path();
    const bytes = (await readFile(path2)).length;
    check(/16spp\.png$/.test(dl2.suggestedFilename()) && bytes > 20000, `export: ${dl2.suggestedFilename()}, ${bytes} bytes`);
    await page.waitForFunction(() => window.lightbox.view.running, null, { timeout: 10000 });

    // A visitor's own model.
    await page.click('[data-tab="scene"]');
    const before = (await state(page)).objects;
    await page.setInputFiles('input[type=file]', join(root, 'public', 'models', 'knot.glb'));
    await page.waitForFunction((n) => window.lightbox.state().objects === n + 1, before, { timeout: 20000 });
    await samples(page, 4);
    check(true, 'own model: a dropped GLB joins the scene and renders');

    check(errors.length === 0, `desktop: no page errors${errors.length ? `: ${ascii(errors.slice(0, 3).join(' | '))}` : ''}`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ validation page
  {
    const { ctx, page, errors } = await open(gpu, { viewport: { width: 1100, height: 900 } });
    await page.goto(`${base}validation.html`);
    await page.waitForFunction(() => window.lightboxValidation?.done, null, { timeout: 300000 });
    const v = await page.evaluate(() => ({ passed: window.lightboxValidation.passed, total: window.lightboxValidation.total, error: window.lightboxValidation.error }));
    check(!v.error && v.total >= 30 && v.passed === v.total, `validation: ${v.passed} of ${v.total} comparisons agree`);
    check(errors.length === 0, `validation: no page errors${errors.length ? `: ${ascii(errors.slice(0, 3).join(' | '))}` : ''}`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ phone
  {
    const { ctx, page, errors } = await open(gpu, { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
    await page.goto(base);
    await ready(page);
    await samples(page, 8);
    const lay = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > window.innerWidth, stage: r('.lb-stage'), side: r('.lb-side'), top: r('.lb-top'), px: [window.lightbox.view.tracer.width, window.lightbox.view.tracer.height] };
    });
    check(!lay.overflow && lay.stage.height > 250 && lay.side.top >= lay.stage.bottom - 1 && lay.side.height > 250, `phone: picture ${Math.round(lay.stage.width)}x${Math.round(lay.stage.height)} above a ${Math.round(lay.side.height)} px panel, rendering ${lay.px[0]}x${lay.px[1]}`);
    const ball = await page.evaluate(() => { const o = window.lightbox.store.scene.objects.find((x) => x.name === 'Glass ball'); return { id: o.id, at: window.lightbox.pointOf(o.id) }; });
    await page.touchscreen.tap(ball.at.x, ball.at.y);
    check((await state(page)).selected === ball.id, 'phone: a tap selects the glass ball');
    await page.tap('[data-mode="tour"]');
    await samples(page, 2);
    await page.tap('.lb-tour .lb-btn.primary');
    await page.waitForFunction(() => window.lightbox.state().tourStep === 1, null, { timeout: 10000 });
    check(true, 'phone: the tour advances');
    check(errors.length === 0, `phone: no page errors${errors.length ? `: ${ascii(errors.slice(0, 3).join(' | '))}` : ''}`);
    await ctx.close();
  }
} finally {
  await gpu.close();
}

// ------------------------------------------------------------------ other backends
// ANGLE's Vulkan backend is a second shader compiler (the default above is Direct3D 11), and
// the software renderer stands in for a slow device: the app must stay alive and adapt.
for (const [backend, label, slow] of [['vulkan', 'vulkan backend', false], ['swiftshader', 'software renderer', true]]) {
  const b = await chromium.launch({ headless: true, channel: 'chromium', args: [`--use-angle=${backend}`, '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-swiftshader'] });
  try {
    const { ctx, page, errors } = await open(b, { viewport: { width: 900, height: 600 } });
    await page.goto(base);
    await ready(page, 180000);
    const err = await page.evaluate(() => window.lightbox.error);
    if (err) check(false, `${label}: ${ascii(err).slice(0, 1500)}`);
    else {
      await samples(page, slow ? 3 : 16, 180000);
      const r = await page.evaluate(() => {
        const g = window.lightbox.view.tracer.gl;
        const d = g.getExtension('WEBGL_debug_renderer_info');
        return { mean: window.lightbox.view.tracer.meter().mean, tile: window.lightbox.view.tracer.tileSize, lost: g.isContextLost(), renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown' };
      });
      check(r.mean > 0.5 && !r.lost && errors.length === 0 && (!slow || r.tile < 256), `${label}: renders (mean ${r.mean.toFixed(1)} cd/m2, ${r.tile} px tiles) on ${ascii(r.renderer).slice(0, 70)}`);
    }
    await ctx.close();
  } finally {
    await b.close();
  }
}

server.close();
console.log(failed ? 'smoke: FAIL' : 'smoke: PASS');
process.exit(failed ? 1 : 0);
