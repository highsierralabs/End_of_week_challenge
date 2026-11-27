// Drumhead: draw a drum, hear its shape.

import './style.css';
import { AudioEngine } from '../audio/engine';
import workletUrl from '../audio/modal.worklet.ts?worker&url';
import { Ink } from '../render/ink';
import { Sand } from '../render/sand';
import { DrumGL, screenToWorld, Stage, type DrawItem, type View } from '../render/stage';
import { Strip, type StripRow } from '../render/strip';
import { polyArea, type Poly } from '../solver/geometry';
import { PRESETS } from '../solver/shapes';
import { discFundamental } from '../solver/spectrum';
import { ABOUT_HTML } from './about';
import { modeThumb } from './gallery';
import { DEFAULT_TUNING, LiveDrum, type Tuning } from './live';
import { formatNote } from './notes';
import { Quiz } from './quiz';
import { type DrumData, type SolveJob, type SolveReply, type SolveRequest } from './worker';

type Mode = 'play' | 'draw' | 'sand' | 'listen';

interface Slot {
  live: LiveDrum;
  gl: DrumGL;
  view: View;
  name: string;
  note: string;
  sand: Sand | null;
  amp: Float32Array;
  ampDirty: boolean;
  drive: [number, number];
  level: number;
  peak: number;
  pan: number;
}

const params = new URLSearchParams(location.search);
const small = Math.min(screen.width, screen.height) < 700 || (navigator.hardwareConcurrency ?? 8) <= 4;
const DETAIL = Number(params.get('detail')) || (small ? 1900 : 2600);
const MODES = Math.min(160, Number(params.get('modes')) || (small ? 72 : 96));
const AUDIO_GAIN = 0.07;
const TWINS = 'twins';

// ---------------------------------------------------------------- DOM

const app = document.getElementById('app')!;
app.innerHTML = `
  <header class="dh-head"><h1>Drumhead</h1><p class="dh-hint"></p></header>
  <aside class="dh-card" aria-live="polite"></aside>
  <div class="dh-stage is-play">
    <canvas class="dh-gl"></canvas>
    <canvas class="dh-ink"></canvas>
    <div class="dh-busy" role="status"></div>
  </div>
  <div class="dh-bottom">
    <canvas class="dh-strip" aria-label="The drum's frequencies. Tap a mark to hear that mode."></canvas>
    <nav class="dh-bar" aria-label="Tools">
      <div class="dh-group" role="group" aria-label="Mode">
        <button class="dh-btn" data-mode="play" title="Play (P)">${icon('play')}<span class="dh-label">Play</span></button>
        <button class="dh-btn" data-mode="draw" title="Draw a drum (D)">${icon('draw')}<span class="dh-label">Draw</span></button>
        <button class="dh-btn" data-mode="sand" title="Sand (S)">${icon('sand')}<span class="dh-label">Sand</span></button>
        <button class="dh-btn" data-mode="listen" title="Which drum? A listening game (L)">${icon('ear')}<span class="dh-label">Listen</span></button>
      </div>
      <span class="dh-sep"></span>
      <div class="dh-group dh-shapes" role="group" aria-label="Shapes"></div>
      <span class="dh-sep"></span>
      <div class="dh-group">
        <button class="dh-btn" data-act="modes" title="Mode shapes (M)"><span>Modes</span></button>
        <button class="dh-btn" data-act="sound" title="Sound settings" aria-expanded="false"><span>Sound</span></button>
        <button class="dh-btn" data-act="about" title="About (A)"><span>About</span></button>
        <button class="dh-btn" data-act="mute" title="Mute" aria-pressed="false">${icon('speaker')}</button>
      </div>
    </nav>
  </div>
  <div class="dh-pop" hidden>
    <h3>Sound</h3>
    <label><span>Pitch</span><span data-out="speed"></span><input type="range" data-in="speed" min="0" max="1000" /></label>
    <label><span>Sustain</span><span data-out="sustain"></span><input type="range" data-in="sustain" min="0" max="1000" /></label>
    <label><span>Mallet</span><span data-out="mallet"></span><input type="range" data-in="mallet" min="0" max="1000" /></label>
  </div>
  <dialog class="dh-about"><div class="dh-dlg-head"><h2 tabindex="-1" autofocus>About Drumhead</h2><button class="dh-btn" data-close>Close</button></div><div class="dh-dlg-body">${ABOUT_HTML}</div></dialog>
  <dialog class="dh-gallery"><div class="dh-dlg-head"><h2 tabindex="-1" autofocus>Modes</h2><button class="dh-btn" data-close>Close</button></div><div class="dh-gallery-grid"></div></dialog>
`;

function icon(name: string): string {
  const s = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  switch (name) {
    case 'play': return s('<ellipse cx="12" cy="13" rx="8" ry="4"/><path d="M4 13v3c0 2.2 3.6 4 8 4s8-1.8 8-4v-3"/><path d="M15 3l-3 8"/>');
    case 'draw': return s('<path d="M4 20c2-1 3-4 6-4s3 3 6 2 3-6 1-9-6-4-8-2"/><circle cx="9" cy="7" r="1"/>');
    case 'sand': return s('<circle cx="6" cy="7" r=".8"/><circle cx="12" cy="5" r=".8"/><circle cx="17" cy="8" r=".8"/><circle cx="8" cy="12" r=".8"/><circle cx="15" cy="13" r=".8"/><path d="M3 18c3-2 6-2 9 0s6 2 9 0"/>');
    case 'speaker': return s('<path d="M4 9h4l5-4v14l-5-4H4z"/><path class="dh-wave" d="M16 9c1.5 1.5 1.5 4.5 0 6M18.5 6.5c3 3 3 8 0 11"/>');
    case 'ear': return s('<path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5.5 1.6"/><path d="M10 9.5a2 2 0 0 1 4 0c0 1.2-1 1.6-1.6 2.4"/>');
    case 'muted': return s('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>');
    default: return '';
  }
}

function shapeIcon(outline: Poly): string {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < outline.length; i += 2) {
    x0 = Math.min(x0, outline[i]!); x1 = Math.max(x1, outline[i]!); y0 = Math.min(y0, outline[i + 1]!); y1 = Math.max(y1, outline[i + 1]!);
  }
  const s = 22 / Math.max(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const pts: string[] = [];
  for (let i = 0; i < outline.length; i += 2) pts.push(`${(15 + (outline[i]! - cx) * s).toFixed(1)},${(15 - (outline[i + 1]! - cy) * s).toFixed(1)}`);
  return `<polygon points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`;
}

const $ = <T extends Element>(sel: string) => app.querySelector<T>(sel)!;
const stageEl = $<HTMLDivElement>('.dh-stage');
const hintEl = $<HTMLParagraphElement>('.dh-hint');
const cardEl = $<HTMLElement>('.dh-card');
const busyEl = $<HTMLDivElement>('.dh-busy');
const popEl = $<HTMLDivElement>('.dh-pop');
$('.dh-bottom').append(popEl);
const aboutDlg = $<HTMLDialogElement>('.dh-about');
const galleryDlg = $<HTMLDialogElement>('.dh-gallery');

const shapesEl = $<HTMLDivElement>('.dh-shapes');
const visiblePresets = PRESETS.filter((p) => !p.id.startsWith('gww'));
const twinIcon = (() => {
  const a = PRESETS.find((p) => p.id === 'gww-left')!.outline, b = PRESETS.find((p) => p.id === 'gww-right')!.outline;
  return `<button class="dh-btn dh-shape dh-twins" data-shape="${TWINS}" title="The twins: two drums, one sound" aria-label="Twins"><svg viewBox="0 0 30 30" style="width:40px"><g transform="translate(-6 0) scale(0.62) translate(9 9)">${shapeIcon(a)}</g><g transform="translate(9 0) scale(0.62) translate(9 9)">${shapeIcon(b)}</g></svg><span class="dh-label">Twins</span></button>`;
})();
visiblePresets.forEach((p, i) => {
  shapesEl.insertAdjacentHTML('beforeend', `<button class="dh-btn dh-shape" data-shape="${p.id}" title="${p.name}" aria-label="${p.name}"><svg viewBox="0 0 30 30">${shapeIcon(p.outline)}</svg></button>`);
  // The twins sit right after the circle: they are the point of the whole thing.
  if (i === 0) shapesEl.insertAdjacentHTML('beforeend', twinIcon);
});

// ---------------------------------------------------------------- state

const stage = new Stage($<HTMLCanvasElement>('.dh-gl'));
const ink = new Ink($<HTMLCanvasElement>('.dh-ink'));
const strip = new Strip($<HTMLCanvasElement>('.dh-strip'));
const audio = new AudioEngine();

const quiz = new Quiz(stageEl, {
  getDrum: (id) => getDrum(id),
  strike: (bank, live, x, y) => {
    void audio.start();
    const amps = live.strikeAmps(x, y, 0.85, tuning);
    if (amps) audio.send({ type: 'strike', id: bank, amps: amps.map((v) => v * AUDIO_GAIN), click: 0.04, cutoff: tuning.mallet * 3 });
  },
  sendBank: (bank, live) => audio.send({ type: 'bank', id: bank, freqs: live.freqs, decays: live.decays, pan: 0 }),
  tuning: () => tuning,
  shapeIcon,
});

let mode: Mode = 'play';
let slots: Slot[] = [];
let current = '';
let tuning: Tuning = { ...DEFAULT_TUNING };
let driveF = 0;
let stroke: number[] | null = null;
let strokeView: View | null = null;
let highlight = -1;
let hideUi = false;
let lastStrike: { slot: number; x: number; y: number } | null = null;

// ---------------------------------------------------------------- solver pool

const workers = [0, 1].map(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }));
let nextId = 1;
function solveOn(w: Worker, req: SolveJob, onProgress: (f: number) => void): Promise<DrumData> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const handler = (ev: MessageEvent<SolveReply>) => {
      const m = ev.data;
      if (m.id !== id) return;
      if (m.type === 'progress') onProgress(m.f);
      else {
        w.removeEventListener('message', handler);
        if (m.type === 'done') resolve(m.drum); else reject(new Error(m.message));
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ ...req, id } as SolveRequest);
  });
}

/** Solved presets, kept: shapes and frequencies do not depend on the tuning. */
const cache = new Map<string, Promise<DrumData>>();
let rr = 0;
function getDrum(id: string, onProgress: (f: number) => void = () => {}): Promise<DrumData> {
  let p = cache.get(id);
  if (!p) {
    p = solveOn(workers[rr++ % workers.length]!, { kind: 'preset', preset: id, detail: DETAIL, modes: MODES }, onProgress);
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

let loadToken = 0;
async function load(what: string | Poly): Promise<void> {
  const token = ++loadToken;
  const twins = what === TWINS;
  const reqs: SolveJob[] = twins
    ? [{ kind: 'preset', preset: 'gww-left', detail: DETAIL, modes: MODES }, { kind: 'preset', preset: 'gww-right', detail: DETAIL, modes: MODES }]
    : typeof what === 'string'
      ? [{ kind: 'preset', preset: what, detail: DETAIL, modes: MODES }]
      : [{ kind: 'poly', poly: what, detail: DETAIL, modes: MODES }];
  const prog = reqs.map(() => 0);
  const show = () => { busyEl.textContent = `Tuning the drum… ${Math.round((100 * prog.reduce((a, b) => a + b, 0)) / prog.length)}%`; };
  busyEl.classList.remove('is-error');
  busyEl.classList.add('is-on');
  show();
  try {
    const data = await Promise.all(reqs.map((r, i) => {
      const progress = (f: number) => { prog[i] = f; show(); };
      return r.kind === 'preset' ? getDrum(r.preset, progress) : solveOn(workers[i]!, r, progress);
    }));
    if (token !== loadToken) return;
    for (const s of slots) s.gl.dispose();
    audio.send({ type: 'stop' });
    slots = data.map((d, i) => {
      const preset = twins ? PRESETS.find((p) => p.id === (i ? 'gww-right' : 'gww-left'))! : typeof what === 'string' ? PRESETS.find((p) => p.id === what)! : null;
      const live = new LiveDrum(d, tuning);
      const slot: Slot = {
        live, gl: new DrumGL(stage.gl, stage.prog, d.xy, d.tri, d.rim), view: { rect: { x: 0, y: 0, w: 1, h: 1 } },
        name: preset ? preset.name : 'Your drum', note: preset ? preset.note : 'Drawn by hand.',
        sand: null, amp: new Float32Array(d.nv), ampDirty: true, drive: defaultDrive(live), level: 0, peak: 1e-9,
        pan: twins ? (i ? 0.35 : -0.35) : 0,
      };
      return slot;
    });
    slots.forEach((s, i) => sendBank(s, i));
    current = typeof what === 'string' ? what : '';
    if (typeof what === 'string') {
      const u = new URL(location.href);
      u.searchParams.set('shape', what);
      history.replaceState(null, '', u);
    }
    for (const b of shapesEl.querySelectorAll<HTMLButtonElement>('[data-shape]')) b.setAttribute('aria-pressed', String(b.dataset.shape === current));
    driveF = slots[0]!.live.freqs[Math.min(4, slots[0]!.live.data.count - 1)]!;
    highlight = -1;
    lastStrike = null;
    layout();
    if (mode === 'sand') enterSand();
    if (mode === 'draw') setMode('play');
    updateCard();
    if (galleryDlg.open) fillGallery();
    busyEl.classList.remove('is-on');
    (window as unknown as { drumhead: Record<string, unknown> }).drumhead.ready = true;
  } catch (e) {
    if (token !== loadToken) return;
    busyEl.textContent = e instanceof Error ? e.message : String(e);
    busyEl.classList.add('is-error');
    setTimeout(() => { if (token === loadToken) busyEl.classList.remove('is-error', 'is-on'); }, 3500);
  }
}

function defaultDrive(live: LiveDrum): [number, number] {
  // Off-centre, so that most modes are excited: the first point inside along a spiral.
  const d = live.data;
  let cx = 0, cy = 0;
  for (let i = 0; i < d.nv; i++) { cx += d.xy[2 * i]!; cy += d.xy[2 * i + 1]!; }
  cx /= d.nv; cy /= d.nv;
  const R = Math.sqrt(d.area);
  for (let t = 0; t < 60; t++) {
    const r = R * (0.21 - t * 0.003), a = 0.7 + t * 0.9;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (live.inside(x, y)) return [x, y];
  }
  return [cx, cy];
}

function sendBank(s: Slot, id: number): void {
  audio.send({ type: 'bank', id, freqs: s.live.freqs, decays: s.live.decays, pan: s.pan });
}

// ---------------------------------------------------------------- layout

function layout(): void {
  const r = stageEl.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  stage.resize(r.width, r.height, dpr);
  ink.resize(r.width, r.height, dpr);
  const sb = $<HTMLCanvasElement>('.dh-strip').parentElement!.getBoundingClientRect();
  strip.resize(sb.width, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--strip-h')) || 66, dpr);
  const n = Math.max(1, slots.length);
  const W = r.width, H = r.height;
  const pad = 0.96;
  if (n === 1) {
    const side = Math.min(W, H) * pad;
    const v = { x: (W - side) / 2, y: (H - side) / 2, w: side, h: side };
    if (slots[0]) slots[0].view.rect = v;
    drawView.rect = v;
  } else {
    const across = Math.min(W / 2, H), down = Math.min(W, H / 2);
    const side = Math.max(across, down) * pad;
    slots.forEach((s, i) => {
      s.view.rect = across >= down
        ? { x: W / 2 + (i ? 0 : -side) + (i ? 1 : -1) * (W / 4 - side / 2), y: (H - side) / 2, w: side, h: side }
        : { x: (W - side) / 2, y: H / 2 + (i ? 0 : -side) + (i ? 1 : -1) * (H / 4 - side / 2), w: side, h: side };
    });
    const side1 = Math.min(W, H) * pad;
    drawView.rect = { x: (W - side1) / 2, y: (H - side1) / 2, w: side1, h: side1 };
  }
}
const drawView: View = { rect: { x: 0, y: 0, w: 1, h: 1 } };

// ---------------------------------------------------------------- card

function updateCard(): void {
  if (!slots.length) return;
  const twins = slots.length === 2;
  const a = slots[0]!.live;
  const f1 = a.fundamental;
  // Distinct overtones: degenerate pairs (two modes, one pitch) are listed once.
  const distinct: number[] = [];
  for (let k = 1; k < a.freqs.length && distinct.length < 5; k++) {
    const r = a.freqs[k]! / f1;
    if (!distinct.length || r / distinct[distinct.length - 1]! > 1.004) distinct.push(r);
  }
  const ratios = distinct.map((r) => r.toFixed(2)).join(', ');
  const d = a.data;
  const circle = (tuning.speed * Math.sqrt(discFundamental(d.area))) / (2 * Math.PI);
  let html = `<h2>${twins ? 'The twins' : slots[0]!.name}</h2>
    <p class="dh-note">${twins ? 'Two different drums with exactly the same frequencies (Gordon, Webb and Wolpert, 1992).' : slots[0]!.note}</p>
    <dl>
      <dt>Fundamental</dt><dd>${f1.toFixed(1)} Hz, ${formatNote(f1)}</dd>
      <dt>Overtones</dt><dd>&times; ${ratios}&hellip;</dd>
      <dt>Area</dt><dd>${d.area.toFixed(3)} m&sup2;</dd>
      <dt class="dh-more">Heard area</dt><dd class="dh-more">${d.heard.area.toFixed(3)} m&sup2; <span class="dh-small">(Weyl's law)</span></dd>
      <dt class="dh-more">Perimeter</dt><dd class="dh-more">${d.perimeter.toFixed(2)} m, heard ${d.heard.perimeter.toFixed(2)} m</dd>
    </dl>`;
  if (twins) {
    const b = slots[1]!.live;
    let worst = 0;
    for (let k = 0; k < Math.min(a.data.count, b.data.count); k++) worst = Math.max(worst, Math.abs(a.data.lambda[k]! - b.data.lambda[k]!) / a.data.lambda[k]!);
    html += `<p class="dh-small">All ${a.data.count} computed frequencies of Twin A and Twin B agree. Largest difference: <span class="dh-warm">${worst === 0 ? '0' : worst.toExponential(0).replace('e', ' &times; 10<sup>') + '</sup>'}</span> of the frequency.</p>`;
  } else {
    const above = (f1 / circle - 1) * 100;
    html += `<p class="dh-small">A circle with the same area would sound at ${circle.toFixed(1)} Hz. The circle is always the lowest shape (Faber-Krahn), and this drum sits ${above < 0.05 ? 'right on that floor' : `${above.toFixed(1)}% above it`}.</p>`;
  }
  cardEl.innerHTML = html;
}

function setHint(): void {
  hintEl.textContent = mode === 'listen'
    ? 'Can you hear the shape of a drum? Listen, then pick one.'
    : mode === 'draw'
    ? 'Draw a closed shape in one stroke. Lift to make it a drum.'
    : mode === 'sand'
      ? 'Drag along the notes below to sweep the drive. Tap the plate to move the driver.'
      : slots.length === 2 ? 'Same notes, different shapes. Tap either drum.' : 'Tap the drum. Draw your own with “Draw”.';
}

// ---------------------------------------------------------------- modes

function setMode(m: Mode): void {
  if (mode === 'sand' && m !== 'sand') audio.send({ type: 'drive', freq: driveF, gain: 0 });
  if (m === 'listen') void quiz.open(); else quiz.close();
  cardEl.hidden = m === 'listen';
  mode = m;
  stageEl.className = `dh-stage is-${m}`;
  for (const b of app.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  if (m === 'sand') enterSand();
  if (m !== 'draw') { stroke = null; }
  if (m === 'draw' && slots.length === 2) { /* drawing replaces the twins with one drum */ }
  setHint();
}

function enterSand(): void {
  for (const s of slots) {
    for (const l of [s.live]) l.clear();
    s.sand = new Sand(s.live.raster, small ? 7000 : 14000);
    s.ampDirty = true;
  }
  updateResponse();
}

/** Drive-point response curve across the strip, for the first drum; and each drum's level now. */
let responseCurve: Float32Array | undefined;
function updateResponse(): void {
  const s = slots[0];
  if (!s || !strip.state) { responseCurve = undefined; return; }
  const phi = s.live.shapesAt(s.drive[0], s.drive[1]);
  if (!phi) return;
  const n = 300, out = new Float32Array(n);
  const { lo, hi } = strip.state;
  let mx = 0;
  for (let i = 0; i < n; i++) {
    const f = Math.exp(Math.log(lo) + (i / (n - 1)) * (Math.log(hi) - Math.log(lo)));
    out[i] = response(s, phi, f);
    mx = Math.max(mx, out[i]!);
  }
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(out[i]! / mx);
  responseCurve = out;
}

function response(s: Slot, phi: Float32Array, f: number): number {
  let re = 0, im = 0;
  const g = 0.012;
  for (let k = 0; k < phi.length; k++) {
    const fk = s.live.freqs[k]!;
    const dr = fk * fk - f * f, di = g * f * fk, den = dr * dr + di * di;
    re += (phi[k]! * phi[k]! * dr) / den;
    im -= (phi[k]! * phi[k]! * di) / den;
  }
  return Math.hypot(re, im);
}

/** Sand level for a drum at the drive: its response relative to its strongest resonance. */
function sandLevel(s: Slot): number {
  const phi = s.live.shapesAt(s.drive[0], s.drive[1]);
  if (!phi) return 0;
  let peak = 0;
  for (let k = 0; k < phi.length; k++) peak = Math.max(peak, response(s, phi, s.live.freqs[k]!));
  return Math.min(1, Math.sqrt(response(s, phi, driveF) / peak) * 1.6);
}

// ---------------------------------------------------------------- input

function slotAt(sx: number, sy: number): { i: number; x: number; y: number } | null {
  for (let i = 0; i < slots.length; i++) {
    const [x, y] = screenToWorld(slots[i]!.view, sx, sy);
    if (slots[i]!.live.inside(x, y)) return { i, x, y };
  }
  return null;
}

function strike(i: number, x: number, y: number, vel: number): void {
  const s = slots[i];
  if (!s) return;
  void audio.start();
  const amps = s.live.strikeAmps(x, y, vel, tuning);
  if (!amps) return;
  const a = amps.map((v) => v * AUDIO_GAIN);
  audio.send({ type: 'strike', id: i, amps: a, click: 0.05 * vel * Math.min(1, tuning.mallet / 1500), cutoff: tuning.mallet * 3 });
  s.live.kick(amps);
  ink.ripples.push({ view: s.view, x, y, t0: performance.now(), v: vel });
  lastStrike = { slot: i, x, y };
}

function playMode(i: number, k: number): void {
  const s = slots[i];
  if (!s || k < 0 || k >= s.live.data.count) return;
  void audio.start();
  const one = new Float32Array(s.live.data.count);
  one[k] = 1;
  audio.send({ type: 'strike', id: i, amps: one.map((v) => v * AUDIO_GAIN * 4) });
  s.live.clear();
  s.live.kick(one);
  highlight = k;
}

const pointers = new Map<number, { last: number; x: number; y: number }>();
stageEl.addEventListener('pointerdown', (e) => {
  void audio.start();
  closePop();
  const r = stageEl.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (mode === 'draw') {
    stageEl.setPointerCapture(e.pointerId);
    strokeView = drawView;
    const [x, y] = screenToWorld(drawView, sx, sy);
    stroke = [x, y];
    return;
  }
  if (mode === 'listen') return;
  const hit = slotAt(sx, sy);
  if (!hit) return;
  if (mode === 'sand') {
    slots[hit.i]!.drive = [hit.x, hit.y];
    slots[hit.i]!.ampDirty = true;
    slots[hit.i]!.sand?.scatter();
    if (hit.i === 0) updateResponse();
    return;
  }
  stageEl.setPointerCapture(e.pointerId);
  const p = e.pointerType === 'mouse' || e.pressure === 0 || e.pressure === 0.5 ? 0.85 : Math.min(1, 0.3 + e.pressure);
  strike(hit.i, hit.x, hit.y, p);
  pointers.set(e.pointerId, { last: performance.now(), x: sx, y: sy });
});
stageEl.addEventListener('pointermove', (e) => {
  const r = stageEl.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (mode === 'draw' && stroke && strokeView) {
    const [x, y] = screenToWorld(strokeView, sx, sy);
    const lx = stroke[stroke.length - 2]!, ly = stroke[stroke.length - 1]!;
    if (Math.hypot(x - lx, y - ly) * strokeView.rect.w > 2.5) stroke.push(Math.max(-0.5, Math.min(0.5, x)), Math.max(-0.5, Math.min(0.5, y)));
    return;
  }
  const p = pointers.get(e.pointerId);
  if (!p || mode !== 'play') return;
  // Dragging across the drum is a roll: a softer strike every 70 ms.
  const now = performance.now();
  if (now - p.last > 70 && Math.hypot(sx - p.x, sy - p.y) > 6) {
    const hit = slotAt(sx, sy);
    if (hit) strike(hit.i, hit.x, hit.y, 0.5);
    pointers.set(e.pointerId, { last: now, x: sx, y: sy });
  }
});
const endPointer = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  if (mode === 'draw' && stroke) {
    const pts = stroke;
    stroke = null;
    const area = Math.abs(polyArea(pts));
    if (pts.length < 16 || area < 0.004) {
      hintEl.textContent = 'Too small to be a drum. Draw a bigger closed shape.';
      return;
    }
    void load(pts);
  }
};
stageEl.addEventListener('pointerup', endPointer);
stageEl.addEventListener('pointercancel', endPointer);

// Spectrum strip: tap a tick to play that mode; in sand mode, drag to set the drive frequency.
const stripCanvas = $<HTMLCanvasElement>('.dh-strip');
let stripDrag = false;
function stripAt(e: PointerEvent): void {
  const r = stripCanvas.getBoundingClientRect();
  const x = e.clientX - r.left;
  if (!strip.state) return;
  if (mode === 'sand') {
    // Snap to a mode when close, so a resonance is easy to hit exactly.
    const k = strip.modeAt(x, 0, 5);
    driveF = k >= 0 ? slots[0]!.live.freqs[k]! : strip.fOf(x);
    for (const s of slots) s.ampDirty = true;
  } else {
    const row = strip.rowAt(e.clientY - r.top);
    const k = strip.modeAt(x, row, 14);
    if (k >= 0) playMode(row, k);
  }
}
stripCanvas.addEventListener('pointerdown', (e) => {
  void audio.start();
  stripDrag = true;
  stripCanvas.setPointerCapture(e.pointerId);
  stripAt(e);
});
stripCanvas.addEventListener('pointermove', (e) => { if (stripDrag && mode === 'sand') stripAt(e); });
stripCanvas.addEventListener('pointerup', () => { stripDrag = false; });

// Buttons.
app.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!b) return;
  if (b.dataset.mode) setMode(b.dataset.mode as Mode);
  else if (b.dataset.shape) { if (mode === 'draw' || mode === 'listen') setMode('play'); void load(b.dataset.shape); }
  else if (b.dataset.close !== undefined) (b.closest('dialog') as HTMLDialogElement).close();
  else if (b.dataset.act === 'about') aboutDlg.showModal();
  else if (b.dataset.act === 'modes') { fillGallery(); galleryDlg.showModal(); }
  else if (b.dataset.act === 'sound') { popEl.hidden = !popEl.hidden; b.setAttribute('aria-expanded', String(!popEl.hidden)); }
  else if (b.dataset.act === 'mute') {
    audio.setMuted(!audio.muted);
    b.setAttribute('aria-pressed', String(audio.muted));
    b.innerHTML = icon(audio.muted ? 'muted' : 'speaker');
  }
});
for (const d of [aboutDlg, galleryDlg]) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
function closePop(): void { popEl.hidden = true; app.querySelector('[data-act="sound"]')?.setAttribute('aria-expanded', 'false'); }

// Sound sliders, on log scales.
const SLIDERS = {
  speed: { lo: 35, hi: 300, fmt: () => `${formatNote(slots[0]?.live.fundamental ?? 0)}` },
  sustain: { lo: 0.15, hi: 8, fmt: (v: number) => `${v.toFixed(v < 1 ? 2 : 1)} s` },
  mallet: { lo: 150, hi: 6000, fmt: (v: number) => (v < 500 ? 'soft felt' : v < 1500 ? 'felt' : v < 3500 ? 'wood' : 'hard') },
} as const;
type SliderKey = keyof typeof SLIDERS;
const toPos = (k: SliderKey, v: number) => (1000 * Math.log(v / SLIDERS[k].lo)) / Math.log(SLIDERS[k].hi / SLIDERS[k].lo);
const fromPos = (k: SliderKey, p: number) => SLIDERS[k].lo * (SLIDERS[k].hi / SLIDERS[k].lo) ** (p / 1000);
function syncSliders(): void {
  for (const k of Object.keys(SLIDERS) as SliderKey[]) {
    popEl.querySelector<HTMLInputElement>(`[data-in="${k}"]`)!.value = String(Math.round(toPos(k, tuning[k])));
    popEl.querySelector<HTMLSpanElement>(`[data-out="${k}"]`)!.textContent = SLIDERS[k].fmt(tuning[k]);
  }
}
popEl.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  const k = el.dataset.in as SliderKey;
  tuning = { ...tuning, [k]: fromPos(k, Number(el.value)) };
  slots.forEach((s, i) => { s.live.retune(tuning); sendBank(s, i); s.ampDirty = true; });
  if (k === 'speed' && slots[0]) { driveF = driveF * 1; updateResponse(); updateCard(); }
  syncSliders();
});

// Keyboard.
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'p') setMode('play');
  else if (k === 'd') setMode('draw');
  else if (k === 's') setMode('sand');
  else if (k === 'l') setMode('listen');
  else if (k === 'm') { fillGallery(); galleryDlg.showModal(); }
  else if (k === 'a') aboutDlg.showModal();
  else if (k === 'h') { hideUi = !hideUi; for (const el of [cardEl, $('.dh-head'), $('.dh-bottom')]) (el as HTMLElement).style.visibility = hideUi ? 'hidden' : ''; }
  else if (k === ' ' && mode === 'play' && slots.length) {
    e.preventDefault();
    const at = lastStrike ?? { slot: 0, x: slots[0]!.drive[0], y: slots[0]!.drive[1] };
    strike(at.slot, at.x, at.y, 0.85);
  } else if ((k === 'arrowleft' || k === 'arrowright') && mode === 'sand') {
    driveF *= 2 ** ((k === 'arrowright' ? 1 : -1) / (e.shiftKey ? 12 : 96));
    for (const s of slots) s.ampDirty = true;
  }
});

// ---------------------------------------------------------------- gallery

function fillGallery(): void {
  const grid = galleryDlg.querySelector<HTMLDivElement>('.dh-gallery-grid')!;
  grid.innerHTML = '';
  if (!slots.length) return;
  const twins = slots.length === 2;
  grid.classList.toggle('is-twins', twins);
  const f1 = slots[0]!.live.fundamental;
  const px = Math.round(108 * Math.min(2, window.devicePixelRatio || 1));
  const count = Math.min(slots[0]!.live.data.count, 36);
  for (let k = 0; k < count; k++) {
    const b = document.createElement('button');
    b.className = 'dh-thumb';
    b.title = `Play mode ${k + 1}`;
    const pair = document.createElement('div');
    pair.className = 'dh-pair';
    for (const s of slots) pair.append(modeThumb(s.live, k, px));
    const f = slots[0]!.live.freqs[k]!;
    const cap = document.createElement('span');
    cap.innerHTML = `${k + 1}. ${f.toFixed(1)} Hz <em>&times;${(f / f1).toFixed(3)}</em>`;
    b.append(pair, cap);
    b.addEventListener('click', () => {
      galleryDlg.close();
      if (mode !== 'play') setMode('play');
      slots.forEach((_, i) => playMode(i, k));
    });
    grid.append(b);
  }
  if (twins) grid.insertAdjacentHTML('afterbegin', '<p class="dh-fig" style="grid-column:1/-1;margin:0">Each pair: the same mode number on Twin A and Twin B. Different patterns, identical frequency.</p>');
}

// ---------------------------------------------------------------- frame loop

let lastT = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  const items: DrawItem[] = [];
  const rows: StripRow[] = [];
  const shown = mode === 'listen' ? [] : slots;
  for (let i = 0; i < shown.length; i++) {
    const s = shown[i]!;
    const lv = new Float32Array(s.live.data.count);
    if (mode === 'sand' && s.sand) {
      if (s.ampDirty) {
        s.live.chladni(driveF, s.drive[0], s.drive[1], s.amp);
        s.level = sandLevel(s);
        s.ampDirty = false;
        if (i === 0) audio.send({ type: 'drive', freq: driveF, gain: 0.05 + 0.13 * s.level });
      }
      const hop = Math.sqrt(s.live.data.area) * 0.035;
      for (let sub = 0; sub < 3; sub++) s.sand.step(s.amp, s.level, hop);
      s.gl.setSand(stage.sandProg, s.sand.pos);
      items.push({ drum: s.gl, view: s.view, u: s.live.u, live: 0, plate: true, step: 1 });
    } else {
      s.live.step(dt);
      let mx = 0;
      for (let v = 0; v < s.live.u.length; v++) mx = Math.max(mx, Math.abs(s.live.u[v]!));
      s.peak = Math.max(s.peak * Math.exp(-dt / 2.5), mx);
      const liveness = Math.min(1, Math.max(0, (mx / s.peak - 0.01) / 0.05));
      items.push({ drum: s.gl, view: s.view, u: s.live.u, live: liveness * (mx > 1e-6 ? 1 : 0), plate: false, step: Math.max(1e-6, s.peak / 9) });
      let lmx = 0;
      for (let k = 0; k < lv.length; k++) { lv[k] = Math.hypot(s.live.vr[k]!, s.live.vi[k]!); lmx = Math.max(lmx, lv[k]!); }
      const norm = Math.max(lmx, s.peak * 0.05, 1e-6);
      for (let k = 0; k < lv.length; k++) lv[k] = lv[k]! / norm;
    }
    rows.push({ freqs: s.live.freqs, level: lv, label: slots.length === 2 ? (i ? 'B' : 'A') : undefined });
  }
  stage.draw(items);
  ink.clear();
  for (const s of shown) ink.rim(s.view, s.live.data.outline, mode === 'sand');
  if (mode === 'sand') for (const s of shown) ink.driver(s.view, s.drive[0], s.drive[1]);
  if (shown.length === 2) shown.forEach((s, i) => ink.caption(s.view, i ? 'Twin B' : 'Twin A'));
  ink.drawRipples(now);
  if (stroke && strokeView) ink.stroke(strokeView, stroke);

  if (mode === 'listen') strip.state = null;
  else if (slots.length) {
    const f0 = slots[0]!.live.freqs;
    const lo = f0[0]! / 1.35, hi = f0[f0.length - 1]! * 1.08;
    const firstStrip = !strip.state;
    strip.state = { rows, lo, hi, cursor: mode === 'sand' ? driveF : undefined, response: mode === 'sand' ? responseCurve : undefined, highlight: highlight >= 0 ? highlight : undefined };
    if (firstStrip || (mode === 'sand' && !responseCurve)) updateResponse();
  }
  strip.draw();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot

window.addEventListener('resize', () => { layout(); updateResponse(); });
new ResizeObserver(() => layout()).observe(stageEl);

/** Render a strike offline and report its level, for tests: no audio device needed. */
async function renderOffline(seconds = 2, slot = 0): Promise<{ peak: number; rms: number; finite: boolean; sampleRate: number }> {
  const s = slots[slot];
  if (!s) throw new Error('no drum');
  const sr = 48000;
  const ctx = new OfflineAudioContext(2, Math.round(seconds * sr), sr);
  await ctx.audioWorklet.addModule(workletUrl);
  const amps = s.live.strikeAmps(s.drive[0], s.drive[1], 0.85, tuning)!.map((v) => v * AUDIO_GAIN);
  const node = new AudioWorkletNode(ctx, 'modal-bank', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    processorOptions: { init: [{ type: 'bank', id: 0, freqs: s.live.freqs, decays: s.live.decays, pan: 0 }, { type: 'strike', id: 0, amps, click: 0.04, cutoff: 2700 }] },
  });
  node.connect(ctx.destination);
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0, sum = 0, finite = true;
  for (let i = 0; i < d.length; i++) { const v = d[i]!; if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
  return { peak, rms: Math.sqrt(sum / d.length), finite, sampleRate: sr };
}

(window as unknown as { drumhead: Record<string, unknown> }).drumhead = {
  ready: false,
  load: (w: string | Poly) => load(w),
  setMode,
  strike: (i: number, x: number, y: number) => strike(i, x, y, 0.85),
  state: () => ({
    mode, current, driveF, drums: slots.map((s) => ({ name: s.name, nv: s.live.data.nv, modes: s.live.data.count, f1: s.live.fundamental, ms: s.live.data.ms, area: s.live.data.area, heard: s.live.data.heard, lambda: Array.from(s.live.data.lambda) })),
  }),
  setDrive: (f: number) => { driveF = f; for (const s of slots) s.ampDirty = true; },
  quiz: () => quiz.state,
  renderOffline,
};

syncSliders();
{
  const m = params.get('mode');
  setMode(m === 'sand' || m === 'listen' ? m : 'play');
}
layout();
const startShape = params.get('shape');
void load(startShape && (startShape === TWINS || PRESETS.some((p) => p.id === startShape)) ? startShape : 'circle').then(syncSliders);
requestAnimationFrame(frame);
