// PURPOSE: Smoke-test the production build of Wheelwork the way a visitor meets it: served from a
//          subfolder (/wheelwork/), in GPU Chromium, on a desktop and a phone viewport. Checks the
//          boot, that a picture is drawn, running and stopping, the crank (dial and in the scene),
//          turning to a date, re-setting, every view, the case and the lamp, hovering and clicking
//          a wheel, the workbench (editing teeth, the solver, a redesign, restoring), the sky
//          panel, every tour stop, the print kit (checked and downloaded as a zip), a machine
//          carried in a link, the validation page (every check), and that no page errors were
//          raised. Then boots on the software renderer as a stand-in for a slow device.
// USAGE:   npm run build && node scripts/smoke.mjs
// OUTPUT:  one ASCII line per check and "smoke: PASS" or "smoke: FAIL"; exit 0 / 1.
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith('/wheelwork/')) { res.writeHead(404); res.end(); return; }
  let rel = normalize(path.slice('/wheelwork/'.length));
  if (rel === '.' || rel.endsWith('/') || rel === '') rel = join(rel, 'index.html');
  if (rel.startsWith('..')) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(join(dist, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(5208, '127.0.0.1', r));
const base = 'http://127.0.0.1:5208/wheelwork/';

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
const ready = (page, timeout = 90000) => page.waitForFunction(() => window.wheelwork && (window.wheelwork.ready || window.wheelwork.error), null, { timeout });
const W = (page, fn, arg) => page.evaluate(fn, arg);
// Mean brightness and spread of the picture, drawn in the same task as a frame so the buffer is still there.
const picture = (page) => W(page, () => {
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
const settle = (page, ms = 400) => page.waitForTimeout(ms);

const gpu = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
try {
  // ------------------------------------------------------------------ desktop
  {
    const { ctx, page, errors } = await open(gpu, { viewport: { width: 1440, height: 900 } });
    const t0 = Date.now();
    await page.goto(base);
    await ready(page);
    const boot = await W(page, () => ({ error: window.wheelwork.error ?? null, quality: window.wheelwork.stage?.options.quality, parts: window.wheelwork.stage?.parts.length }));
    check(!boot.error && boot.parts > 90, `desktop: boots in ${Date.now() - t0} ms with ${boot.parts} parts at ${boot.quality} quality${boot.error ? ` (${ascii(boot.error)})` : ''}`);
    const pic = await picture(page);
    check(pic.mean > 8 && pic.spread > 12, `desktop: a picture is drawn (mean ${pic.mean.toFixed(1)}, spread ${pic.spread.toFixed(1)})`);
    const drift0 = await W(page, () => window.wheelwork.stage.camera.position.toArray());
    await settle(page, 500);
    const drift1 = await W(page, () => window.wheelwork.stage.camera.position.toArray());
    check(Math.hypot(drift0[0] - drift1[0], drift0[1] - drift1[1]) > 0.2, 'desktop: the camera drifts round the machine until it is taken hold of');
    await page.click('.views button:has-text("Sound")');
    await settle(page, 200);
    const snd = await W(page, () => ({ on: window.wheelwork.app.sound.on, state: window.wheelwork.app.sound.ctx?.state }));
    check(snd.on && snd.state === 'running', `desktop: sound switches on (${snd.state})`);
    const date = await page.textContent('.brand .date');
    check(/\d{4}/.test(date ?? ''), `desktop: the header shows a date (${ascii(date)})`);

    // Run and stop.
    await page.click('.transport .play');
    await settle(page, 700);
    const ran = await W(page, () => window.wheelwork.model.turns);
    await page.click('.transport .play');
    const stopped = await W(page, () => window.wheelwork.model.turns);
    await settle(page, 300);
    const still = await W(page, () => window.wheelwork.model.turns);
    check(ran > 0.2 && still === stopped, `desktop: Run turns the crank (${ran.toFixed(2)} turns) and Stop holds it`);
    await page.keyboard.press('Space');
    await settle(page, 300);
    await page.keyboard.press('Space');
    check((await W(page, () => window.wheelwork.model.turns)) > stopped, 'desktop: the space bar runs and stops');

    // The dial.
    const dial = await page.locator('.dial').boundingBox();
    const before = await W(page, () => window.wheelwork.model.turns);
    const cx = dial.x + dial.width / 2, cy = dial.y + dial.height / 2;
    await page.mouse.move(cx, cy - 18);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx + 18 * Math.sin((i / 12) * Math.PI), cy - 18 * Math.cos((i / 12) * Math.PI));
    await page.mouse.up();
    const afterDial = await W(page, () => window.wheelwork.model.turns);
    check(Math.abs(afterDial - before - 0.5) < 0.05, `desktop: half a turn of the dial is half a turn of the crank (${(afterDial - before).toFixed(3)})`);

    // The crank in the scene.
    await page.click('.views button:has-text("Whole")');
    await W(page, () => window.wheelwork.stage.setView('crank', 0));
    await settle(page, 200);
    const handle = await W(page, () => {
      const { stage, model } = window.wheelwork;
      const f = model.pose().frame.crank;
      const part = stage.parts.find((p) => p.id === 'crankHandle');
      const [x, y, z] = part.anchor;
      const wx = f[0] * x + f[1] * y + f[2] * z + f[3], wy = f[4] * x + f[5] * y + f[6] * z + f[7], wz = f[8] * x + f[9] * y + f[10] * z + f[11];
      const p = stage.project(wx, wy, wz);
      const end = stage.project(f[3] + f[0] * 150, f[7] + f[4] * 150, f[11] + f[8] * 150);
      return { p, end };
    });
    const b3 = await W(page, () => window.wheelwork.model.turns);
    await page.mouse.move(handle.p.x, handle.p.y);
    await page.mouse.down();
    const r0 = Math.hypot(handle.p.x - handle.end.x, handle.p.y - handle.end.y);
    const a0 = Math.atan2(handle.p.y - handle.end.y, handle.p.x - handle.end.x);
    for (let i = 1; i <= 10; i++) await page.mouse.move(handle.end.x + r0 * Math.cos(a0 + i * 0.15), handle.end.y + r0 * Math.sin(a0 + i * 0.15));
    await page.mouse.up();
    const a3 = await W(page, () => window.wheelwork.model.turns);
    check(Math.abs(Math.abs(a3 - b3) - 1.5 / (2 * Math.PI)) < 0.03, `desktop: dragging the crank handle in the scene turns the machine (${(a3 - b3).toFixed(3)} turns for 1.5 rad)`);
    const camBefore = await W(page, () => window.wheelwork.stage.camera.position.toArray());
    await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(600, 340, { steps: 5 }); await page.mouse.up();
    const camAfter = await W(page, () => window.wheelwork.stage.camera.position.toArray());
    check(Math.hypot(camBefore[0] - camAfter[0], camBefore[1] - camAfter[1]) > 5, 'desktop: dragging elsewhere walks round the machine');

    // Turn to a date, re-set, come back.
    await page.fill('.goto .day', '1');
    await page.selectOption('.goto select', '1');
    await page.fill('.goto .year', '2100');
    await page.click('.goto button[type="submit"]');
    await settle(page, 3400);
    const d2100 = await page.textContent('.brand .date');
    check(d2100 === '1 January 2100', `desktop: turns to a date (${ascii(d2100)})`);
    const sinceText = await page.textContent('.brand .since');
    check(/turns of the crank/.test(sinceText ?? ''), `desktop: says how far it has run (${ascii(sinceText).slice(0, 60)})`);
    await page.fill('.goto .year', '-500');
    await page.click('.goto button[type="submit"]');
    await settle(page, 3400);
    check((await page.textContent('.brand .date')) === '1 January 501 BC', `desktop: turns to a BC date (${ascii(await page.textContent('.brand .date'))})`);
    await page.click('button:has-text("Re-set here")');
    const reset = await W(page, () => ({ turns: window.wheelwork.model.turns, err: Math.abs(window.wheelwork.model.reading().planets.mars.gearing) }));
    check(reset.turns === 0 && reset.err < 1e-9, 'desktop: re-setting zeroes the crank count and the gearing error');
    await W(page, () => window.wheelwork.model.resetTo(window.wheelwork.model.constructor.todayJd()));

    // Views, case, lamp.
    for (const [label, id] of [['Wheelwork', 'train'], ['Exploded', 'exploded'], ['Earth and Moon', 'tellurion'], ['From above', 'above'], ['Whole', 'whole']]) {
      await page.click(`.views button:has-text("${label}")`);
      await settle(page, 1700);
      const v = await W(page, () => ({ view: window.wheelwork.stage.view, open: window.wheelwork.stage.caseOpen, explode: window.wheelwork.stage.explode }));
      const p = await picture(page);
      check(v.view === id && p.spread > 8, `desktop: view "${label}" (case ${v.open.toFixed(2)}, exploded ${v.explode.toFixed(2)}, spread ${p.spread.toFixed(0)})`);
      if (id === 'train') {
        const tags = await page.locator('.toothlabels span:visible').count();
        check(tags === 24, `desktop: ${tags} tooth counts are written beside the wheels`);
      }
    }
    await page.click('.views button:has-text("Sun lamp")');
    await page.waitForFunction(() => window.wheelwork.stage.lamp > 0.97, null, { timeout: 15000 }).catch(() => {});
    const lamp = await W(page, () => window.wheelwork.stage.lamp);
    const dark = await picture(page);
    check(lamp > 0.95 && dark.mean < pic.mean, `desktop: the Sun lamp darkens the room (mean ${dark.mean.toFixed(1)} from ${pic.mean.toFixed(1)})`);
    await page.click('.views button:has-text("Sun lamp")');
    await page.click('.views button:has-text("Case")');
    await settle(page, 1800);
    check((await W(page, () => window.wheelwork.stage.caseOpen)) > 0.95, 'desktop: the case opens');

    // Hover and click a wheel.
    await W(page, () => window.wheelwork.stage.setView('train', 0));
    await settle(page, 300);
    const wheel = await W(page, () => {
      const { stage, model } = window.wheelwork;
      // Find a screen point that picks a wheel: scan a grid.
      const r = stage.canvas.getBoundingClientRect();
      for (let y = 0.2; y < 0.9; y += 0.03) for (let x = 0.1; x < 0.6; x += 0.03) {
        const p = stage.pick(r.left + r.width * x, r.top + r.height * y);
        if (p && p.wheel && !model.layout.byId.get(p.wheel).tellurion) return { x: r.left + r.width * x, y: r.top + r.height * y, train: model.layout.byId.get(p.wheel).train };
      }
      return null;
    });
    check(!!wheel, 'desktop: a wheel can be found under the pointer');
    if (wheel) {
      await page.mouse.move(wheel.x, wheel.y);
      await settle(page, 200);
      const tip = await page.textContent('.tooltip.on').catch(() => null);
      check(/teeth/.test(tip ?? ''), `desktop: hovering a wheel says what it is (${ascii(tip).slice(0, 70)})`);
      await page.mouse.click(wheel.x, wheel.y);
      await settle(page, 300);
      const sel = await W(page, () => ({ train: window.wheelwork.app.selectedTrain, tab: window.wheelwork.app.tab }));
      check(sel.train === wheel.train && sel.tab === 'workbench', `desktop: clicking it opens its train on the workbench (${sel.train})`);
    }

    // Workbench.
    await W(page, () => window.wheelwork.app.selectTrain('earth-mars'));
    const spec0 = await W(page, () => JSON.stringify(window.wheelwork.model.spec));
    await page.click('.editor .teeth label:nth-child(4) button:last-child');
    await settle(page, 500);
    const edited = await W(page, () => ({ d: window.wheelwork.model.spec.steps['earth-mars'].d, ok: window.wheelwork.model.layout.ok, parts: window.wheelwork.stage.parts.length, drift: document.querySelector('.editor strong.bad, .editor strong.warn, .editor strong.good')?.textContent }));
    check(edited.d === JSON.parse(spec0).steps['earth-mars'].d + 1 && edited.ok && edited.parts > 90, `desktop: one more tooth on wheel D rebuilds the machine (${ascii(edited.drift)})`);
    await page.click('.editor button:has-text("Find the closest trains")');
    await settle(page, 300);
    const cands = await page.locator('.candidates button').count();
    check(cands >= 5, `desktop: the solver lists ${cands} trains`);
    await page.click('.candidates li:first-child button');
    await settle(page, 500);
    const best = await W(page, () => Math.abs(window.wheelwork.model.reading().planets.mars.gearing));
    const marsDrift = await page.textContent('.summary tbody tr:nth-child(5) td:last-child');
    check(best < 1e-6 && /century/.test(marsDrift ?? ''), `desktop: the closest train is fitted (Mars ${ascii(marsDrift)})`);
    // A wheel too small for its tube stays on the bench.
    await page.fill('.editor .teeth label:nth-child(1) input', '10');
    await page.keyboard.press('Tab');
    await settle(page, 300);
    const fault = await page.textContent('.editor .fault').catch(() => null);
    const kept = await W(page, () => window.wheelwork.model.spec.steps['earth-mars'].a);
    check(!!fault && kept !== 10, `desktop: a wheel that does not fit is refused (${ascii(fault).slice(0, 60)})`);
    // Redesign under tight limits.
    await page.locator('.designer input[type="range"]').first().evaluate((el) => { el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('.designer button:has-text("Design a machine")');
    await settle(page, 1500);
    const small = await W(page, () => {
      const s = window.wheelwork.model.spec;
      let max = 0;
      for (const id of Object.keys(s.steps)) for (const r of ['a', 'b', 'c', 'd']) max = Math.max(max, s.steps[id][r]);
      return { max, ok: window.wheelwork.model.layout.ok, status: document.querySelector('.designer .status').textContent };
    });
    check(small.max <= 40 && small.ok, `desktop: a machine designed with at most 40 teeth (${small.max}; ${ascii(small.status)})`);
    await page.click('.designer button:has-text("Copy a link")');
    await settle(page, 200);
    const linked = await W(page, () => location.search);
    check(/^\?m=[\d.-]+$/.test(linked), `desktop: the link carries the machine (${linked.slice(0, 40)}...)`);
    const smallSpec = await W(page, () => JSON.stringify(window.wheelwork.model.spec));
    await page.click('.designer button:has-text("Restore the original")');
    await settle(page, 800);
    check((await W(page, () => JSON.stringify(window.wheelwork.model.spec) === JSON.stringify(window.wheelwork.model.original))), 'desktop: the original machine is restored');

    // Sky.
    await page.click('.drawer .tabs button:has-text("Sky")');
    await settle(page, 300);
    const earthView = await W(page, () => ({ rows: document.querySelectorAll('.sky .fromearth tbody tr').length, sun: Math.abs(window.wheelwork.model.geocentric().sun.error) }));
    check(earthView.rows === 7 && earthView.sun < 2.5, `desktop: the view from the Earth lists seven bodies (Sun ${earthView.sun.toFixed(2)} deg from the sky's)`);
    const sky = await W(page, () => ({ rows: document.querySelectorAll('.sky table.readings tbody tr').length, dots: document.querySelectorAll('.sky .plan circle').length, moon: document.querySelector('.sky .moonbox p')?.textContent }));
    check(sky.rows >= 15 && sky.dots > 20 && /lit/.test(sky.moon ?? ''), `desktop: the sky panel reads the machine (${ascii(sky.moon).slice(0, 50)})`);

    // Tour.
    await page.click('.drawer .tabs button:has-text("Tour")');
    const stops = await W(page, () => window.wheelwork.app.tour.length);
    let toured = 0;
    for (let i = 0; i < stops; i++) {
      await W(page, (k) => window.wheelwork.app.tour.go(k), i);
      await settle(page, 450);
      const t = await W(page, () => ({ title: document.querySelector('.tour h2').textContent, body: document.querySelector('.tour .stopbody').textContent.length }));
      if (t.title && t.body > 150) toured++;
    }
    check(toured === stops, `desktop: all ${stops} tour stops show`);
    await W(page, () => window.wheelwork.app.tour.go(9));
    await page.click('.tour button:has-text("next eclipse")');
    await settle(page, 5600);
    const ecl = await W(page, () => window.wheelwork.model.reading().eclipse.now);
    check(ecl === 'solar' || ecl === 'lunar', `desktop: runs to the next eclipse the machine shows (${ecl})`);
    await W(page, () => { window.wheelwork.app.tour.go(0); window.wheelwork.model.setTurns(0); });

    // Print.
    await page.click('.drawer .tabs button:has-text("Print")');
    await page.click('.print button:has-text("Check the kit")');
    await page.waitForFunction(() => /closed|faults|could not/.test(document.querySelector('.print .status').textContent), null, { timeout: 60000 });
    const kitStatus = await page.textContent('.print .status');
    const files = await page.locator('.print .files li:not(.group)').count();
    check(/no pair of spur wheels interferes/.test(kitStatus ?? '') && files >= 60, `desktop: the kit checks out (${files} files; ${ascii(kitStatus)})`);
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.print button:has-text("Download")')]);
    const path = await dl.path();
    const size = (await stat(path)).size;
    const head = (await readFile(path)).subarray(0, 4);
    check(dl.suggestedFilename() === 'wheelwork-kit.zip' && size > 1e6 && head[0] === 0x50 && head[1] === 0x4b, `desktop: the kit downloads as a zip (${(size / 1e6).toFixed(1)} MB)`);

    // About and its link to the validation page.
    await page.click('.drawer .tabs button:has-text("About")');
    check((await page.locator('.about a[href="./validation.html"]').count()) === 1, 'desktop: About links to the validation page');
    check(errors.length === 0, `desktop: no page errors${errors.length ? `: ${ascii(errors.slice(0, 3).join(' | '))}` : ''}`);

    // A machine carried in a link.
    const { page: p2, errors: e2 } = await open(gpu, { viewport: { width: 1280, height: 800 } });
    await p2.goto(`${base}${linked}`);
    await ready(p2);
    check((await W(p2, () => JSON.stringify(window.wheelwork.model.spec))) === smallSpec && e2.length === 0, 'link: a machine carried in the link is rebuilt');
    await p2.goto(`${base}?m=1.1.1.1-broken`);
    await ready(p2);
    check((await W(p2, () => JSON.stringify(window.wheelwork.model.spec) === JSON.stringify(window.wheelwork.model.original))) && e2.length === 0, 'link: a bad link falls back to the original machine');
    await p2.close();
    await ctx.close();
  }

  // ------------------------------------------------------------------ validation
  {
    const { ctx, page, errors } = await open(gpu, { viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}validation.html`);
    await page.waitForFunction(() => window.wheelworkValidation && window.wheelworkValidation.done, null, { timeout: 120000 });
    const v = await W(page, () => ({ n: window.wheelworkValidation.rows.length, failed: window.wheelworkValidation.rows.filter((r) => !r.ok).map((r) => r.name), error: window.wheelworkValidation.error ?? null }));
    check(v.n >= 50 && v.failed.length === 0 && !v.error, `validation: ${v.n - v.failed.length} of ${v.n} checks agree${v.failed.length ? `; differing: ${ascii(v.failed.join('; '))}` : ''}${v.error ? `; error ${ascii(v.error)}` : ''}`);
    check(errors.length === 0, `validation: no page errors${errors.length ? `: ${ascii(errors.slice(0, 3).join(' | '))}` : ''}`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ phone
  {
    const { ctx, page, errors } = await open(gpu, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await page.goto(base);
    await ready(page);
    const boot = await W(page, () => ({ error: window.wheelwork.error ?? null, quality: window.wheelwork.stage?.options.quality }));
    const pic = await picture(page);
    check(!boot.error && boot.quality === 'low' && pic.spread > 8, `phone: boots at ${boot.quality} quality and draws (spread ${pic.spread.toFixed(0)})`);
    const fits = await W(page, () => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll('.transport, .views, .drawer .bar')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1; }));
    check(fits, 'phone: the controls fit the width');
    await page.tap('.drawer .tabs button:has-text("Sky")');
    await settle(page, 300);
    check((await page.locator('.sky table.readings').count()) >= 1, 'phone: the tabs work by touch');
    await page.tap('.transport .play');
    await settle(page, 600);
    check((await W(page, () => window.wheelwork.model.turns)) > 0.1, 'phone: Run works by touch');
    await page.tap('.transport .play');
    await page.tap('.drawer .collapse');
    await settle(page, 400);
    const closed = await W(page, () => document.querySelector('.drawer').classList.contains('closed'));
    check(closed, 'phone: the sheet closes');
    check(errors.length === 0, `phone: no page errors${errors.length ? `: ${ascii(errors.slice(0, 3).join(' | '))}` : ''}`);
    await ctx.close();
  }
} finally {
  await gpu.close();
}

// ------------------------------------------------------------------ software renderer
{
  const soft = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const { ctx, page, errors } = await open(soft, { viewport: { width: 1024, height: 700 } });
    await page.goto(`${base}?q=low`);
    await ready(page, 180000);
    const boot = await W(page, () => ({ error: window.wheelwork.error ?? null }));
    const pic = await picture(page);
    check(!boot.error && pic.spread > 8, `software renderer: boots and draws (spread ${pic.spread.toFixed(0)})`);
    check(errors.length === 0, `software renderer: no page errors${errors.length ? `: ${ascii(errors.slice(0, 3).join(' | '))}` : ''}`);
    await ctx.close();
  } finally {
    await soft.close();
  }
}

server.close();
console.log(failed ? 'smoke: FAIL' : 'smoke: PASS');
process.exit(failed ? 1 : 0);
