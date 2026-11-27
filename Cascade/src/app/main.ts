// Cascade - application entry: wires the simulation worker, the 3D stage and the UI.
import '../styles.css';
import {
  buildLayout, createControls, createTimeline, ChartsPanel, renderStats, renderStatsEmpty, createTour, createAbout,
  CLASS_HEX, autoThinning, isPhoneLayout, type Quality, type TourStep,
} from '../ui';
import { DEFAULT_PARAMS } from '../physics/cascade';
import { DEFAULT_SKY } from '../physics/sky';
import { GND, GND_STRIDE, type ShowerParams, type ShowerResult } from '../physics/types';
import { SimClient } from '../sim/client';
import { Stage, type CameraPreset } from '../render/stage';
import { createObservatory } from '../ui/observatory';
import { renderDetector } from '../ui/detectorCard';
import { maybeShowWelcome } from '../ui/welcome';
import { detectorExposure } from '../physics/detector';
import { Sonifier } from '../audio/sonify';

const q = new URLSearchParams(location.search);
const layout = buildLayout(document.getElementById('app')!);
const charts = new ChartsPanel(layout.charts);
renderStatsEmpty(layout.stats, 'Simulating the first shower...');

const qParam = q.get('quality');
let quality: Quality = qParam === 'low' || qParam === 'medium' || qParam === 'high' ? qParam : isPhoneLayout() ? 'low' : 'medium';
const SEGMENTS: Record<Quality, number> = { low: 150_000, medium: 450_000, high: 1_000_000 };

const initial: ShowerParams = {
  ...DEFAULT_PARAMS,
  thinning: autoThinning(DEFAULT_PARAMS.energyEV, DEFAULT_PARAMS.emCutMeV),
  seed: Number(q.get('seed') ?? 7),
};

const sim = new SimClient();
let result: ShowerResult | null = null;
let playing = false;
let tNs = 0;
let nsPerSecond = 5000;
let stage: Stage | null = null;
/** The part of the shower clock the replay plays: from just before the first interaction
 *  to just after nearly all ground arrivals (a few slow hadrons would otherwise add seconds of empty tail). */
let win = { t0: 0, t1: 1 };
function replayWindow(r: ShowerResult, sky: boolean): { t0: number; t1: number } {
  const t0 = sky ? r.stats.tMin : Math.max(r.stats.tMin, -4000);
  const n = r.groundCount;
  let t1 = r.stats.tMax;
  if (n > 20 && !sky) {
    const stride = Math.max(1, Math.floor(n / 20000));
    const ts: number[] = [];
    for (let i = 0; i < n; i += stride) ts.push(r.ground[i * GND_STRIDE + GND.T]!);
    ts.sort((a, b) => a - b);
    t1 = Math.min(r.stats.tMax, ts[Math.floor(ts.length * 0.995)]! + 4000);
  }
  return { t0, t1: Math.max(t1, t0 + 1000) };
}
let userCamera = false;

const timeline = createTimeline(layout.timeline, {
  onPlayPause: () => {
    if (!result) return;
    if (!playing && tNs >= win.t1) tNs = win.t0;
    playing = !playing;
    pushTime();
  },
  onSeek: (f) => {
    if (!result) return;
    tNs = win.t0 + f * (win.t1 - win.t0);
    pushTime();
  },
  onSpeed: (v) => { nsPerSecond = v; pushTime(); },
});

function pushTime(): void {
  const st = result?.stats;
  timeline.setState({
    playing, tNs, tMinNs: st ? win.t0 : 0, tMaxNs: st ? win.t1 : 1, nsPerSecond,
    markers: st && Number.isFinite(st.tCore) ? [{ tNs: st.tCore, label: 'core at ground' }] : [],
  });
  charts.setTime(tNs);
}

const controls = createControls(layout.controls, initial, {
  onRun: (p) => void run(p),
  onClassToggle: (c, v) => stage?.shower.setClassVisible(c, v),
  onCameraPreset: (id) => { userCamera = true; stage?.setPreset(id as CameraPreset); },
  onTour: () => tour.open(),
  onAbout: () => about.open(),
  onObservatory: () => observatory.open(),
  onSky: () => void runSky(),
  onQuality: (qq) => { quality = qq; stage?.setQuality(qq); layout.toast(`Quality: ${qq} (applies to the next shower)`); },
}, { quality, camera: 'overview' });

const tour = createTour(layout.overlay, {
  onStep: (s: TourStep) => {
    if (s.chart) charts.showTab(s.chart);
    if (s.params) {
      const p = { ...controls.getParams(), ...s.params };
      controls.setParams(p);
      void run(controls.getParams(), s.camera, s.play);
      return;
    }
    if (s.camera) { controls.setCameraPreset(s.camera); stage?.setPreset(s.camera as CameraPreset); }
    if (s.play && result) { tNs = win.t0; playing = true; }
  },
  onClose: () => undefined,
});
const about = createAbout(layout.overlay);
const observatory = createObservatory(layout.overlay);
const sound = new Sonifier();
const soundBtn = document.createElement('button');
soundBtn.type = 'button';
soundBtn.className = 'cx-btn cx-sound';
soundBtn.setAttribute('aria-pressed', 'false');
soundBtn.title = 'Sonify the replay: a click for every ground arrival (S)';
const setSoundLabel = (): void => { soundBtn.textContent = sound.enabled ? 'Sound on' : 'Sound off'; soundBtn.setAttribute('aria-pressed', String(sound.enabled)); };
const toggleSound = async (): Promise<void> => { if (sound.enabled) sound.disable(); else await sound.enable(); setSoundLabel(); };
soundBtn.addEventListener('click', () => void toggleSound());
setSoundLabel();
layout.overlay.append(soundBtn);
if (q.has('data')) setTimeout(() => observatory.open(), 300);

async function run(p: ShowerParams, camera?: string, play = true): Promise<void> {
  const params: ShowerParams = { ...p, maxSegments: SEGMENTS[quality] };
  controls.setBusy(0, 'Starting...');
  const started = performance.now();
  try {
    const r = await sim.run(params, (f, n) => {
      controls.setBusy(f, `Simulating ${Math.round(f * 100)}% - ${n.toLocaleString()} particles`);
    });
    controls.setBusy(null);
    result = r;
    stage?.load(r);
    sound.load(r);
    charts.update(r);
    renderStats(layout.stats, r);
    renderDetector(layout.stats.querySelector('.cx-panel-body') ?? layout.stats, detectorExposure(r));
    win = replayWindow(r, false);
    tNs = win.t0;
    playing = play;
    // Pick a replay speed that shows the whole shower in ~25 s.
    nsPerSecond = Math.max(200, Math.min(100000, (win.t1 - win.t0) / 25));
    const preset = (camera ?? (userCamera ? stage?.getPreset() : 'overview')) as CameraPreset;
    controls.setCameraPreset(preset === 'sky' ? null : preset);
    stage?.setPreset(preset === 'sky' ? 'overview' : preset);
    pushTime();
    const el = (performance.now() - started) / 1000;
    const secs = el < 0.1 ? '<0.1' : el.toFixed(1);
    layout.toast(`${r.stats.particlesTracked.toLocaleString()} particles tracked in ${secs} s`);
  } catch (e) {
    controls.setBusy(null);
    if (e instanceof Error && e.message === 'cancelled') return;
    layout.toast(`Simulation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

let skySeed = 1;
async function runSky(): Promise<void> {
  controls.setBusy(0, 'Filling the sky...');
  try {
    const opts = { ...DEFAULT_SKY, seed: skySeed++, maxSegments: SEGMENTS[quality], showers: quality === 'low' ? 20 : DEFAULT_SKY.showers };
    const { result: r, brightest, info } = await sim.skyParallel(opts, (f, n) => {
      controls.setBusy(f, `Sky: ${Math.round(f * opts.showers)} of ${opts.showers} showers - ${n.toLocaleString()} particles`);
    });
    controls.setBusy(null);
    result = r;
    stage?.load(r);
    sound.load(r);
    charts.update(brightest);
    renderStats(layout.stats, brightest);
    const body = layout.stats.querySelector('.cx-panel-body') ?? layout.stats;
    body.querySelector('.cx-det')?.remove();
    const note = document.createElement('div');
    note.className = 'cx-det';
    const eMax = Math.max(...info.energiesEV);
    note.innerHTML = `<span class="cx-det-k">Sky mode</span><span>${info.showers} showers above ${(opts.eMinEV / 1e12).toFixed(0)} TeV landing in an ${(2 * opts.halfWidthM / 1000).toFixed(0)} km square during <b>${(info.realSpanSeconds * 1e6).toFixed(0)} &micro;s</b> of real time (about ${(info.ratePerSecond / 1000).toFixed(0)} thousand per second). Energies follow the spectrum; the readout and charts show the largest, ${(eMax / 1e12).toFixed(0)} TeV ${info.primaries[info.brightest]}.</span>`;
    body.append(note);
    win = replayWindow(r, true);
    tNs = win.t0;
    playing = true;
    nsPerSecond = Math.max(200, Math.min(100000, (win.t1 - win.t0) / 30));
    stage?.setPreset('sky');
    controls.setCameraPreset(null);
    pushTime();
  } catch (e) {
    controls.setBusy(null);
    if (e instanceof Error && e.message === 'cancelled') return;
    layout.toast(`Sky failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function start(): Promise<void> {
  const st = new Stage({ container: layout.viewport, colors: CLASS_HEX, forceWebGL: q.has('webgl'), quality });
  try {
    await st.init();
  } catch (e) {
    layout.toast(`3D view unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  stage = st;
  document.documentElement.dataset.backend = st.backend;
  layout.toast(`Rendering with ${st.backend}`);
  if (result) { st.load(result); st.setPreset('overview', false); }
  let last = performance.now();
  st.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing && result) {
      tNs += dt * nsPerSecond;
      if (tNs >= win.t1) { tNs = win.t1; playing = false; }
      pushTime();
    }
    if (result) {
      const st0 = result.stats;
      sound.update(tNs, (tNs - st0.tMin) / Math.max(1, st0.tCore - st0.tMin), playing);
    }
    st.render(dt, tNs);
  });
}

// H hides the interface (presentation mode); ?clean starts with it hidden.
if (q.has('clean')) document.documentElement.classList.add('cx-clean');
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  if (e.key === 'h' || e.key === 'H') document.documentElement.classList.toggle('cx-clean');
  if (e.key === 's' || e.key === 'S') void toggleSound();
});

void start();
void run(controls.getParams());
if (!q.has('clean') && !q.has('data')) {
  maybeShowWelcome(layout.overlay, {
    onTour: () => tour.open(),
    onSky: () => void runSky(),
    onExplore: () => undefined,
  }, q.has('welcome'));
}
// Expose a tiny hook for automated screenshots and debugging.
(window as unknown as { cascade: unknown }).cascade = {
  get result() { return result; },
  get stage() { return stage; },
  seek: (t: number) => { tNs = t; playing = false; pushTime(); },
  run: (p: Partial<ShowerParams>) => { controls.setParams({ ...controls.getParams(), ...p }); return run(controls.getParams()); },
  sky: () => runSky(),
};
