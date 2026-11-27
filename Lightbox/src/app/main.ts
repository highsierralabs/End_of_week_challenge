// Lightbox: the app shell. Builds the page, wires the view, the editor state, the panels and
// the three modes (studio, tour, spectroscope), and handles sharing and export.
import './style.css';
import { boundCentre } from '../core/pack';
import { SCENES, sceneById } from '../core/scenes';
import type { Scene } from '../core/scene';
import { compactScene, fromBase64Url, sanitizeScene, toBase64Url } from '../core/share';
import { button, clear, h } from './controls';
import { Interaction } from './interact';
import { Panel } from './panel';
import { Spectroscope } from './spectroscope';
import { REST_GAP } from '../core/shapes';
import { Meshes, type Stash, Store } from './store';
import { Tour } from './tour';
import { View } from './view';

type Mode = 'studio' | 'tour' | 'spectro';

declare global {
  interface Window {
    lightbox: {
      view: View;
      store: Store;
      ready: boolean;
      error: string | null;
      load: (s: Scene) => Promise<void>;
      setMode: (m: Mode) => Promise<void>;
      /** For scripts: 'scene:<id>' loads a built-in scene, 'tour:<n>' opens a tour step. */
      go: (what: string) => Promise<void>;
      /** For scripts: where an object's centre appears in the picture, in CSS pixels of the page. */
      pointOf: (id: string) => { x: number; y: number } | null;
      state: () => unknown;
    };
  }
}

const app = document.getElementById('app')!;
const canvas = h('canvas', { id: 'view', 'aria-label': 'The rendered picture' });
const overlay = h('canvas', { id: 'overlay', 'aria-hidden': 'true' });
const stage = h('div', { class: 'lb-stage' }, canvas, overlay);
const status = h('div', { class: 'lb-status', 'aria-live': 'off' });
const toast = h('div', { class: 'lb-toast', role: 'status' });
const progress = h('div', { class: 'lb-progress', hidden: true });
stage.append(status, toast, progress);
const sceneSelect = h('select', { class: 'lb-scene-select', 'aria-label': 'Scene' });
const modeBar = h('div', { class: 'lb-modes', role: 'tablist', 'aria-label': 'Mode' });
const actions = h('div', { class: 'lb-actions' });
const top = h('header', { class: 'lb-top' }, h('h1', { class: 'lb-mark' }, 'Lightbox'), modeBar, sceneSelect, actions);
const studioRoot = h('div', { class: 'lb-panel-root' });
const tourRoot = h('div', { class: 'lb-panel-root lb-tour', hidden: true });
const spectroRoot = h('div', { class: 'lb-panel-root lb-spectro', hidden: true });
const side = h('aside', { class: 'lb-side', 'aria-label': 'Controls' }, studioRoot, tourRoot, spectroRoot);
app.append(top, stage, side);

function fail(message: string): void {
  clear(stage);
  stage.append(h('div', { class: 'lb-fatal' }, h('h2', { text: 'Lightbox cannot start here' }), h('p', { text: message }),
    h('p', { text: 'It needs WebGL2 with floating-point render targets, which current Chrome, Edge, Firefox and Safari provide on most hardware.' })));
  window.lightbox = { ...(window.lightbox ?? {}), ready: false, error: message } as Window['lightbox'];
}

let toastTimer = 0;
function say(text: string, ms = 2600): void {
  if (!text) return;
  toast.textContent = text;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('on'), ms);
}

async function deflate(text: string): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(text)).catch(() => {});
  w.close().catch(() => {});
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function inflate(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  // Failures surface on the reading side; these promises must not be left unhandled.
  w.write(bytes as unknown as BufferSource).catch(() => {});
  w.close().catch(() => {});
  // Read in pieces and stop as soon as the scene is larger than any real one could be.
  const reader = ds.readable.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 400_000) { void reader.cancel(); throw new Error('The shared scene is too large.'); }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { all.set(part, at); at += part.byteLength; }
  return new TextDecoder().decode(all);
}

function download(blob: Blob, name: string): void {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function start(): void {
  let view: View;
  try {
    view = new View(canvas);
  } catch (e) {
    fail((e as Error).message);
    return;
  }
  const meshes = new Meshes(view);
  const store = new Store(view, meshes);
  const interaction = new Interaction(canvas, overlay, store);
  const panel = new Panel(studioRoot, store, interaction);
  const tour = new Tour(tourRoot, store);
  const spectro = new Spectroscope(spectroRoot, store);
  let mode: Mode = 'studio';
  let exporting = false;
  interaction.onHint = say;
  panel.onNote = (text) => say(text, 6000);
  spectro.project = (p) => interaction.project(p);

  // ---- layout
  const fit = () => {
    const w = stage.clientWidth;
    const hgt = stage.clientHeight;
    if (w < 2 || hgt < 2 || exporting) return;
    // Cap the pixel count: phones report three device pixels per CSS pixel.
    const k = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2.4e6 / (w * hgt)));
    view.resize(Math.round(w * k), Math.round(hgt * k));
    if (mode === 'spectro') spectro.fit();
    interaction.drawOverlay();
  };
  new ResizeObserver(fit).observe(stage);

  // ---- top bar
  sceneSelect.append(h('option', { value: '', text: 'Your scene', disabled: true }));
  for (const sc of SCENES) sceneSelect.append(h('option', { value: sc.id, text: sc.title }));
  const resetBtn = button('Reset', () => { const e = sceneById(sceneSelect.value); if (e) void loadScene(e.make()); }, 'ghost');
  resetBtn.title = 'Put this scene back as it was';
  sceneSelect.after(resetBtn);
  store.on((c) => {
    if (c !== 'load' || mode !== 'studio') return;
    sceneSelect.value = SCENES.find((sc) => sc.title === store.scene.name)?.id ?? '';
    resetBtn.disabled = sceneSelect.value === '';
  });
  sceneSelect.addEventListener('change', () => { void loadScene(sceneById(sceneSelect.value)!.make()); });
  const modes: [Mode, string][] = [['studio', 'Studio'], ['tour', 'Tour'], ['spectro', 'Spectroscope']];
  for (const [m, label] of modes) modeBar.append(h('button', { type: 'button', role: 'tab', class: 'lb-mode', 'data-mode': m, text: label, onclick: () => { void setMode(m); } }));
  const undoBtn = button('Undo', () => store.undo(), 'ghost');
  const redoBtn = button('Redo', () => store.redo(), 'ghost');
  actions.append(undoBtn, redoBtn, button('Share', () => { void share(); }, 'ghost'), button('Save', () => savePicture(), 'ghost'),
    h('a', { class: 'lb-btn ghost', href: './validation.html', text: 'Validation' }), button('About', () => about.showModal(), 'ghost'));
  const syncButtons = () => { undoBtn.disabled = !store.canUndo || mode !== 'studio'; redoBtn.disabled = !store.canRedo || mode !== 'studio'; };
  store.on(syncButtons);

  const about = h('dialog', { class: 'lb-about' },
    h('h2', { text: 'Lightbox' }),
    h('p', { text: 'A spectral path tracer. Every sample follows one ray of one wavelength from the camera into the scene, bouncing, refracting and being absorbed as light is, until it finds a lamp. Colour is not painted on: it comes from the lamp’s spectrum, each material’s response to each wavelength, and the standard observer’s colour matching functions.' }),
    h('p', { text: 'Glass bends each wavelength by its own index (measured Sellmeier formulas), so prisms and diamonds split white light on their own. Metals reflect by their measured complex index. Gas tubes emit the lines NIST lists for each element. A second tracer follows photons from the lamps through glass and off mirrors to paint the caustics; where a caustic is itself seen through glass or in a mirror, camera paths gather those photons from a map whose reach shrinks as the picture refines.' }),
    h('p', { text: 'The picture starts noisy and sharpens for as long as you leave it. Nothing is precomputed, and nothing leaves your device.' }),
    h('p', {}, h('a', { href: './validation.html', text: 'How it is checked against known answers' }), ' · ', h('a', { href: 'https://github.com/highsierralabs/End_of_week_challenge/tree/main/Lightbox', text: 'Source and notes' })),
    h('form', { method: 'dialog' }, h('button', { class: 'lb-btn', text: 'Close' })));
  app.append(about);

  async function loadScene(scene: Scene): Promise<void> {
    try {
      await store.load(scene);
      interaction.drawOverlay();
    } catch (e) {
      say((e as Error).message, 5000);
    }
  }

  // The studio's own scene and history, set aside while another mode borrows the picture.
  let studioStash: Stash | null = null;
  async function setMode(m: Mode, adopt = false): Promise<void> {
    if (exporting) return;
    if (mode === 'studio' && m !== 'studio' && store.scene) studioStash = store.stash();
    if (mode === 'spectro' && m !== 'spectro') spectro.leave();
    const back = mode !== 'studio' && m === 'studio';
    mode = m;
    for (const b of modeBar.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.mode === m));
    studioRoot.hidden = m !== 'studio';
    tourRoot.hidden = m !== 'tour';
    spectroRoot.hidden = m !== 'spectro';
    sceneSelect.hidden = m !== 'studio';
    resetBtn.hidden = m !== 'studio';
    interaction.editable = m === 'studio';
    interaction.cameraLocked = m === 'spectro';
    interaction.decorate = m === 'spectro' ? spectro.ruler : null;
    view.meterMode = m === 'spectro' ? 'peak' : 'average';
    app.dataset.mode = m;
    if (m === 'tour') await tour.enter();
    else if (m === 'spectro') await spectro.enter();
    else {
      // Coming back: the studio's scene returns, unless the visitor asked to keep this one.
      if (back && !adopt && studioStash) await store.unstash(studioStash);
      if (back && adopt) await store.load(store.scene);
      studioStash = null;
      panel.render();
    }
    interaction.drawOverlay();
    syncButtons();
  }
  tour.onTry = async () => { await setMode('studio', true); panel.show('scene'); say('This scene is yours now: move things, change the light.'); };

  // ---- status line
  let lastStatus = 0;
  let lastFrame = 0;
  let rate = 0;
  view.onFrame = () => {
    const now = performance.now();
    if (now - lastStatus < 400) return;
    const t = view.tracer;
    if (t.frame >= lastFrame && lastStatus) rate = 0.6 * rate + 0.4 * (((t.frame - lastFrame) * 1000) / (now - lastStatus));
    lastStatus = now;
    lastFrame = t.frame;
    const ph = t.photons > 0 ? ` · ${t.photons >= 1e9 ? `${(t.photons / 1e9).toFixed(1)} G` : `${Math.round(t.photons / 1e6)} M`} photons` : '';
    status.textContent = `${t.frame.toLocaleString()} samples${ph} · ${t.renderWidth}×${t.renderHeight}${rate > 0.5 ? ` · ${rate >= 10 ? Math.round(rate) : rate.toFixed(1)}/s` : ''}`;
  };

  // ---- sharing
  async function share(): Promise<void> {
    const scene = store.copy();
    const before = scene.objects.length;
    scene.objects = scene.objects.filter((o) => o.shape.kind !== 'mesh' || !meshes.user.has(o.shape.mesh));
    const code = toBase64Url(await deflate(compactScene(scene)));
    const url = `${location.origin}${location.pathname}#s=${code}`;
    history.replaceState(null, '', `#s=${code}`);
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch { /* the address bar has it */ }
    say(`${copied ? 'Link copied' : 'Link is in the address bar'}${scene.objects.length < before ? ' (without your own models, which stay on this device)' : ''}.`, 4000);
  }
  let badLink = false;
  async function fromHash(): Promise<Scene | null> {
    const m = /^#s=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m) return null;
    try {
      return sanitizeScene(JSON.parse(await inflate(fromBase64Url(m[1]!))));
    } catch {
      badLink = true;
      return null;
    }
  }

  // ---- pictures
  function savePicture(): void {
    view.tracer.present(view.look());
    canvas.toBlob((b) => { if (b) download(b, `lightbox-${view.tracer.frame}spp.png`); }, 'image/png');
  }
  let cancelExport = false;
  async function exportPicture(w: number, hgt: number, samples: number): Promise<void> {
    const t = view.tracer;
    const max = t.gl.getParameter(t.gl.MAX_TEXTURE_SIZE) as number;
    if (w > max || hgt > max) { say(`This GPU's largest image is ${max} pixels a side.`); return; }
    exporting = true;
    cancelExport = false;
    panel.exportBusy = true;
    interaction.frozen = true;
    app.classList.add('lb-exporting');
    view.stop();
    const old: [number, number] = [t.width, t.height];
    const exposure = view.autoExposure;
    const label = h('span');
    clear(progress);
    progress.append(label, button('Cancel', () => { cancelExport = true; }, 'small'));
    progress.hidden = false;
    try {
      t.setScale(1);
      view.resize(w, hgt);
      let tiles = 1;
      let last = performance.now();
      while (t.frame < samples && !cancelExport) {
        t.step(Math.min(Math.max(1, Math.floor(tiles)), (samples - t.frame) * t.tilesPerSweep));
        t.present(view.look());
        label.textContent = `Rendering ${w}×${hgt}: ${t.frame} of ${samples} samples`;
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        tiles = now - last > 60 ? Math.max(1, tiles * 0.6) : tiles * 1.3 + 0.3;
        last = now;
      }
      if (!cancelExport) {
        view.autoExposure = exposure;
        t.present(view.look());
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
        if (blob) download(blob, `lightbox-${w}x${hgt}-${samples}spp.png`);
      }
    } catch (e) {
      say(`Export failed: ${(e as Error).message}`, 5000);
    } finally {
      progress.hidden = true;
      exporting = false;
      panel.exportBusy = false;
      interaction.frozen = false;
      app.classList.remove('lb-exporting');
      view.resize(old[0], old[1]);
      fit();
      view.start();
    }
  }
  panel.onExport = (w, hgt, n) => { void exportPicture(w, hgt, n); };
  panel.onSavePicture = savePicture;

  // ---- your own models
  const filePick = h('input', { type: 'file', accept: '.glb,.obj', hidden: true });
  app.append(filePick);
  async function addModel(file: File): Promise<void> {
    try {
      say(`Reading ${file.name}…`, 10000);
      const name = await meshes.addFile(file);
      store.snapshot();
      const cam = store.scene.camera;
      store.scene.objects.push({ id: `u${Date.now().toString(36)}`, name: meshes.label(name), shape: { kind: 'mesh', mesh: name, size: 0.3 }, pos: [cam.target[0], REST_GAP, cam.target[2]], rot: [0, 0, 0], material: { kind: 'glass', glass: 'bk7' } });
      await store.load(store.scene, true);
      store.select(store.scene.objects[store.scene.objects.length - 1]!.id);
      say(`${meshes.label(name)}: ${meshes.triangles(name).toLocaleString()} triangles.`);
    } catch (e) {
      say(`Could not use ${file.name}: ${(e as Error).message}`, 6000);
    }
  }
  filePick.addEventListener('change', () => { const f = filePick.files?.[0]; filePick.value = ''; if (f) void addModel(f); });
  panel.onLoadFile = () => filePick.click();
  stage.addEventListener('dragover', (e) => { e.preventDefault(); });
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f || exporting) return;
    if (mode !== 'studio') say('Open the studio to add a model.');
    else if (/\.(glb|obj)$/i.test(f.name)) void addModel(f);
    else say('Lightbox can read .glb and .obj models.');
  });

  // ---- keyboard
  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (exporting || el.closest('input[type=text], textarea, dialog')) return;
    const mod = e.ctrlKey || e.metaKey;
    // Undo and redo work wherever the focus is; the single-key shortcuts only from the page.
    if (!mod && el.closest('input, select, [role=slider]')) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
    if (mod) return;
    if (e.key === 'h' || e.key === 'H') app.classList.toggle('lb-bare');
    else if ((e.key === 'Delete' || e.key === 'Backspace') && mode === 'studio' && store.selected) {
      store.snapshot();
      store.scene.objects = store.scene.objects.filter((o) => o.id !== store.selectedId);
      store.select(null);
      store.apply();
      panel.render();
    } else if (e.key === 'Escape') store.select(null);
  });

  window.lightbox = {
    view, store, ready: false, error: null,
    load: loadScene,
    setMode,
    go: async (what) => {
      const [kind, arg] = what.split(':');
      if (kind === 'tour') { await setMode('tour'); await tour.go(Number(arg)); } else { await setMode('studio'); const e = sceneById(arg ?? ''); if (e) { sceneSelect.value = e.id; await loadScene(e.make()); } }
    },
    pointOf: (id) => {
      const o = store.scene.objects.find((x) => x.id === id);
      const p = o && interaction.project(boundCentre(o));
      const r = canvas.getBoundingClientRect();
      return p ? { x: r.left + p.x, y: r.top + p.y } : null;
    },
    state: () => ({ mode, frame: view.tracer.frame, photons: view.tracer.photons, size: [view.tracer.width, view.tracer.height], objects: store.scene?.objects.length ?? 0, selected: store.selectedId, scene: store.scene?.name, tourStep: tour.step, canUndo: store.canUndo }),
  };

  stage.classList.add('lb-loading');
  view.tracer.ready().then(() => stage.classList.remove('lb-loading'), () => {});
  status.textContent = 'Compiling shaders…';
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); view.stop(); say('The graphics context was lost. Reload the page to continue.', 60000); });
  view.tracer.ready().then(async () => {
    fit();
    const shared = await fromHash();
    const attempts: (() => Scene)[] = [
      ...(shared ? [() => shared] : []),
      () => SCENES[0]!.make(),
      // Last resort if the models cannot be fetched: the default scene without them.
      () => { const s = SCENES[0]!.make(); s.objects = s.objects.filter((o) => o.shape.kind !== 'mesh'); return s; },
    ];
    let problem = badLink ? 'That shared link could not be read; showing the default scene.' : '';
    for (const make of attempts) {
      try {
        await store.load(make());
        break;
      } catch (e) {
        problem = `${(e as Error).message} Showing what could be loaded.`;
      }
    }
    await setMode('studio');
    view.start();
    window.lightbox.ready = true;
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    say(problem || (shared ? '' : coarse ? 'Drag an object to move it. Drag the background to look around, pinch to move in.' : 'Drag an object to move it. Drag the background to look around.'), problem ? 6000 : 5000);
  }).catch((e: Error) => fail(e.message));
}

start();
