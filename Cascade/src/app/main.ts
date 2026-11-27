// Cascade - application entry: wires the simulation worker, the 3D stage and the UI.
import '../styles.css';
import {
  buildLayout, createControls, createTimeline, ChartsPanel, renderStats, renderStatsEmpty, createTour, createAbout,
  CLASS_HEX, autoThinning, isPhoneLayout, type Quality, type TourStep,
} from '../ui';
import { DEFAULT_PARAMS } from '../physics/cascade';
import type { ShowerParams, ShowerResult } from '../physics/types';
import { SimClient } from '../sim/client';
import { Stage, type CameraPreset } from '../render/stage';
import { createObservatory } from '../ui/observatory';
import { renderDetector } from '../ui/detectorCard';
import { detectorExposure } from '../physics/detector';

const q = new URLSearchParams(location.search);
const layout = buildLayout(document.getElementById('app')!);
const charts = new ChartsPanel(layout.charts);
renderStatsEmpty(layout.stats, 'Simulating the first shower...');

let quality: Quality = (q.get('quality') as Quality | null) ?? (isPhoneLayout() ? 'low' : 'medium');
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
let userCamera = false;

const timeline = createTimeline(layout.timeline, {
  onPlayPause: () => {
    if (!result) return;
    if (!playing && tNs >= result.stats.tMax) tNs = result.stats.tMin;
    playing = !playing;
    pushTime();
  },
  onSeek: (f) => {
    if (!result) return;
    tNs = result.stats.tMin + f * (result.stats.tMax - result.stats.tMin);
    pushTime();
  },
  onSpeed: (v) => { nsPerSecond = v; pushTime(); },
});

function pushTime(): void {
  const st = result?.stats;
  timeline.setState({
    playing, tNs, tMinNs: st?.tMin ?? 0, tMaxNs: st?.tMax ?? 1, nsPerSecond,
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
    if (s.play && result) { tNs = result.stats.tMin; playing = true; }
  },
  onClose: () => undefined,
});
const about = createAbout(layout.overlay);
const observatory = createObservatory(layout.overlay);
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
    charts.update(r);
    renderStats(layout.stats, r);
    renderDetector(layout.stats.querySelector('.cx-panel-body') ?? layout.stats, detectorExposure(r));
    tNs = r.stats.tMin;
    playing = play;
    // Pick a replay speed that shows the whole shower in ~25 s.
    const span = r.stats.tMax - r.stats.tMin;
    nsPerSecond = Math.max(200, Math.min(100000, span / 25));
    const preset = (camera ?? (userCamera ? stage?.getPreset() : 'overview')) as CameraPreset;
    controls.setCameraPreset(preset);
    stage?.setPreset(preset);
    pushTime();
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    layout.toast(`${r.stats.particlesTracked.toLocaleString()} particles tracked in ${secs} s`);
  } catch (e) {
    controls.setBusy(null);
    if (e instanceof Error && e.message === 'cancelled') return;
    layout.toast(`Simulation failed: ${e instanceof Error ? e.message : String(e)}`);
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
      if (tNs >= result.stats.tMax) { tNs = result.stats.tMax; playing = false; }
      pushTime();
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
});

void start();
void run(controls.getParams());
// Expose a tiny hook for automated screenshots and debugging.
(window as unknown as { cascade: unknown }).cascade = {
  get result() { return result; },
  get stage() { return stage; },
  seek: (t: number) => { tNs = t; playing = false; pushTime(); },
  run: (p: Partial<ShowerParams>) => run({ ...controls.getParams(), ...p }),
};
