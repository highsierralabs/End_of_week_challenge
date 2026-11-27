// Control panel: shower inputs, the Simulate button, display toggles, camera presets.
import { PRIMARY_MASS_NUMBER, RCLASS_COUNT, type Primary, type RClass, type ShowerParams } from '../physics/types';
import { CLASS_COLORS } from './colors';
import { h, icon, ICONS, newId } from './dom';
import { clamp, compass, energyEV, metres, sci } from './format';
import { autoThinning } from './thinning';

export { autoThinning } from './thinning';

export type CameraPreset = 'overview' | 'follow' | 'side' | 'ground' | 'detector';
export type Quality = 'low' | 'medium' | 'high';

export interface ControlHandlers {
  onRun(p: ShowerParams): void;
  onClassToggle(c: RClass, visible: boolean): void;
  onCameraPreset(id: CameraPreset): void;
  onTour(): void;
  onAbout(): void;
  /** Open the observatory comparison (optional). */
  onObservatory?(): void;
  onQuality(q: Quality): void;
}

export interface Controls {
  /** progress in [0, 1] shows a busy Simulate button; null returns to idle. NaN = indeterminate. */
  setBusy(progress: number | null, label?: string): void;
  setParams(p: ShowerParams): void;
  getParams(): ShowerParams;
  /** Highlight a camera preset without firing onCameraPreset (e.g. when the tour moves the camera). */
  setCameraPreset(id: CameraPreset | null): void;
  setQuality(q: Quality): void;
  setClassVisible(c: RClass, visible: boolean): void;
}

export interface ControlOptions {
  quality?: Quality;
  camera?: CameraPreset;
}

const PRIMARIES: { id: Primary; sym: string; name: string; hint: string }[] = [
  { id: 'proton', sym: 'p', name: 'proton', hint: 'A = 1' },
  { id: 'helium', sym: 'He', name: 'helium', hint: 'A = 4' },
  { id: 'nitrogen', sym: 'N', name: 'nitrogen', hint: 'A = 14' },
  { id: 'iron', sym: 'Fe', name: 'iron', hint: 'A = 56' },
  { id: 'gamma', sym: 'γ', name: 'gamma ray', hint: 'photon' },
];

const CAMERAS: { id: CameraPreset; label: string; title: string }[] = [
  { id: 'overview', label: 'Overview', title: 'Whole shower from a distance' },
  { id: 'follow', label: 'Follow', title: 'Ride along with the shower front' },
  { id: 'side', label: 'Side', title: 'Side-on view of the longitudinal development' },
  { id: 'ground', label: 'Ground', title: 'Looking up from the ground near the core' },
  { id: 'detector', label: 'Detector', title: 'The detector castle at the origin' },
];

const QUALITIES: Quality[] = ['low', 'medium', 'high'];

type ThinMode = 'auto' | number;
const THIN_PRESETS: { mode: ThinMode; label: string }[] = [
  { mode: 'auto', label: 'Auto (constant budget)' },
  { mode: 0, label: 'Off (exact, slow)' },
  { mode: 1e-6, label: 'ε = 10⁻⁶ (fine)' },
  { mode: 1e-5, label: 'ε = 10⁻⁵' },
  { mode: 1e-4, label: 'ε = 10⁻⁴' },
  { mode: 1e-3, label: 'ε = 10⁻³ (coarse)' },
];

const EM_CUTS = [0.3, 1, 3, 10, 30];

const E_MIN = 12;
const E_MAX = 19;
const CORE_MAX_M = 2000;
const CORE_STEPS = 1000;

function distToSlider(d: number): number {
  return Math.round(CORE_STEPS * Math.sqrt(clamp(d, 0, CORE_MAX_M) / CORE_MAX_M));
}
function sliderToDist(s: number): number {
  const d = CORE_MAX_M * (s / CORE_STEPS) ** 2;
  const step = d < 100 ? 1 : d < 1000 ? 5 : 10;
  return Math.round(d / step) * step;
}

function approx(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 + 1e-6 * Math.max(Math.abs(a), Math.abs(b));
}

export function createControls(el: HTMLElement, initial: ShowerParams, hd: ControlHandlers, opts: ControlOptions = {}): Controls {
  el.classList.add('cx-controls');
  let params: ShowerParams = { ...initial };
  let thinMode: ThinMode = matchThin(initial.thinning, initial, 'auto');
  let coreDist = Math.hypot(initial.coreX, initial.coreY);
  let coreAz = bearing(initial.coreX, initial.coreY);
  let busy = false;

  // ---- header actions
  const tourBtn = h('button', { type: 'button', class: 'cx-btn cx-btn--ghost', title: 'Guided tour of air-shower physics' });
  tourBtn.append(icon(ICONS.tour), h('span', { text: 'Tour' }));
  tourBtn.addEventListener('click', () => hd.onTour());
  const aboutBtn = h('button', { type: 'button', class: 'cx-btn cx-btn--ghost', title: 'About Cascade, the model and its limits' });
  aboutBtn.append(icon(ICONS.info), h('span', { text: 'About' }));
  aboutBtn.addEventListener('click', () => hd.onAbout());
  // Tour / About sit in the panel header when buildLayout made one, else in a row on top.
  const slot = el.closest('.cx-panel')?.querySelector('.cx-panel-actions');
  const obsBtn = h('button', { type: 'button', class: 'cx-btn cx-btn--ghost cx-btn--obs', title: 'RHACO observatory data next to the simulation' });
  obsBtn.append(h('span', { class: 'cx-obs-dot' }), h('span', { text: 'Data' }));
  obsBtn.addEventListener('click', () => hd.onObservatory?.());
  const actions = slot ? null : h('div', { class: 'cx-actions' }, obsBtn, tourBtn, aboutBtn);
  if (slot) slot.append(obsBtn, tourBtn, aboutBtn);

  // ---- primary
  const primaryGroup = h('div', { class: 'cx-seg cx-seg--primary', role: 'radiogroup', 'aria-label': 'Primary particle' });
  const primaryBtns = new Map<Primary, HTMLButtonElement>();
  for (const p of PRIMARIES) {
    const b = h('button', { type: 'button', role: 'radio', class: 'cx-seg-btn', 'aria-checked': 'false', title: `${p.name} (${p.hint})` },
      h('span', { class: 'cx-seg-sym', text: p.sym }),
      h('span', { class: 'cx-seg-hint', text: p.hint }),
    );
    b.addEventListener('click', () => { params.primary = p.id; syncPrimary(); refreshReadouts(); });
    primaryBtns.set(p.id, b);
    primaryGroup.append(b);
  }
  primaryGroup.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = PRIMARIES.findIndex((p) => p.id === params.primary);
    const j = (i + (e.key === 'ArrowRight' ? 1 : PRIMARIES.length - 1)) % PRIMARIES.length;
    params.primary = PRIMARIES[j]!.id;
    syncPrimary();
    primaryBtns.get(params.primary)?.focus();
    refreshReadouts();
    e.preventDefault();
  });

  // ---- energy
  const eId = newId('energy');
  const eSlider = h('input', { id: eId, type: 'range', min: E_MIN, max: E_MAX, step: 0.05, class: 'cx-range' });
  const eValue = h('output', { class: 'cx-value', for: eId });
  const eSub = h('span', { class: 'cx-sub' });
  const eTicks = h('div', { class: 'cx-ticks', 'aria-hidden': 'true' });
  for (let lg = E_MIN; lg <= E_MAX; lg++) {
    const lab = ({ 12: '1 TeV', 15: '1 PeV', 18: '1 EeV' } as Record<number, string>)[lg] ?? '';
    const t = h('span', { text: lab, class: lab ? '' : 'is-minor' });
    t.style.left = `${((lg - E_MIN) / (E_MAX - E_MIN)) * 100}%`;
    eTicks.append(t);
  }
  eSlider.addEventListener('input', () => {
    params.energyEV = Number((10 ** Number(eSlider.value)).toPrecision(4));
    refreshReadouts();
  });

  // ---- direction
  const zId = newId('zenith');
  const zSlider = h('input', { id: zId, type: 'range', min: 0, max: 70, step: 1, class: 'cx-range' });
  const zValue = h('output', { class: 'cx-value', for: zId });
  zSlider.addEventListener('input', () => { params.zenithDeg = Number(zSlider.value); refreshReadouts(); });
  const aId = newId('azimuth');
  const aSlider = h('input', { id: aId, type: 'range', min: 0, max: 359, step: 1, class: 'cx-range' });
  const aValue = h('output', { class: 'cx-value', for: aId });
  aSlider.addEventListener('input', () => { params.azimuthDeg = Number(aSlider.value); refreshReadouts(); });

  // ---- core
  const cdId = newId('coredist');
  const cdSlider = h('input', { id: cdId, type: 'range', min: 0, max: CORE_STEPS, step: 1, class: 'cx-range' });
  const cdValue = h('output', { class: 'cx-value', for: cdId });
  cdSlider.addEventListener('input', () => { coreDist = sliderToDist(Number(cdSlider.value)); refreshReadouts(); });
  const caId = newId('coreaz');
  const caSlider = h('input', { id: caId, type: 'range', min: 0, max: 359, step: 1, class: 'cx-range' });
  const caValue = h('output', { class: 'cx-value', for: caId });
  caSlider.addEventListener('input', () => { coreAz = Number(caSlider.value); refreshReadouts(); });
  const coreSub = h('p', { class: 'cx-note' });

  // ---- seed
  const sId = newId('seed');
  const seedInput = h('input', { id: sId, type: 'number', min: 0, max: 4294967295, step: 1, inputmode: 'numeric', class: 'cx-input cx-input--mono' });
  seedInput.addEventListener('change', () => {
    const v = Math.floor(Number(seedInput.value));
    params.seed = Number.isFinite(v) ? clamp(v, 0, 4294967295) : params.seed;
    seedInput.value = String(params.seed);
  });
  seedInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { seedInput.dispatchEvent(new Event('change')); run(); } });
  const dice = h('button', { type: 'button', class: 'cx-btn cx-btn--icon', title: 'Random seed', 'aria-label': 'Random seed' });
  dice.append(icon(ICONS.dice));
  dice.addEventListener('click', () => {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    params.seed = a[0]! % 1_000_000_000;
    seedInput.value = String(params.seed);
  });

  // ---- thinning
  const tId = newId('thin');
  const thinSelect = h('select', { id: tId, class: 'cx-select' });
  const thinNote = h('p', { class: 'cx-note' });
  thinSelect.addEventListener('change', () => {
    const v = thinSelect.value;
    thinMode = v === 'auto' ? 'auto' : Number(v);
    refreshReadouts();
  });

  // ---- EM cut
  const cId = newId('emcut');
  const cutSelect = h('select', { id: cId, class: 'cx-select' });
  cutSelect.addEventListener('change', () => { params.emCutMeV = Number(cutSelect.value); refreshReadouts(); });

  // ---- advanced
  const muId = newId('mucut');
  const muInput = h('input', { id: muId, type: 'number', min: 1, max: 10000, step: 1, class: 'cx-input cx-input--mono' });
  muInput.addEventListener('change', () => {
    const v = Number(muInput.value);
    if (Number.isFinite(v) && v > 0) params.muonCutMeV = v;
    muInput.value = String(params.muonCutMeV);
  });
  const hcId = newId('hcut');
  const hcInput = h('input', { id: hcId, type: 'number', min: 0.05, max: 100, step: 0.05, class: 'cx-input cx-input--mono' });
  hcInput.addEventListener('change', () => {
    const v = Number(hcInput.value);
    if (Number.isFinite(v) && v > 0) params.hadronCutGeV = v;
    hcInput.value = String(params.hadronCutGeV);
  });
  const emChk = h('input', { type: 'checkbox', class: 'cx-check' });
  emChk.addEventListener('change', () => { params.trackEm = emChk.checked; });
  const advanced = h('details', { class: 'cx-details' },
    h('summary', { text: 'Advanced cuts' }),
    h('div', { class: 'cx-grid2' },
      field(muId, 'Muon cut', muInput, 'MeV'),
      field(hcId, 'Hadron cut', hcInput, 'GeV'),
    ),
    h('label', { class: 'cx-checkrow' }, emChk, h('span', { text: 'Track the electromagnetic component' })),
    h('p', { class: 'cx-note', text: 'Without EM tracking only hadrons and muons are followed: fast, but the profile and footprint lose their e± and γ.' }),
  );

  // ---- run
  const runLabel = h('span', { class: 'cx-run-label', text: 'Simulate' });
  const runFill = h('span', { class: 'cx-run-fill', 'aria-hidden': 'true' });
  const runBtn = h('button', { type: 'button', class: 'cx-run' }, runFill, runLabel);
  runBtn.addEventListener('click', run);

  // ---- display: classes
  const classRow = h('div', { class: 'cx-chips', role: 'group', 'aria-label': 'Particle classes shown' });
  const classBtns: HTMLButtonElement[] = [];
  for (let c = 0; c < RCLASS_COUNT; c++) {
    const col = CLASS_COLORS[c]!;
    const b = h('button', { type: 'button', class: 'cx-chip', 'aria-pressed': 'true', title: `Show ${col.label}s` },
      h('span', { class: 'cx-swatch', 'aria-hidden': 'true' }),
      h('span', { text: col.label }),
    );
    b.style.setProperty('--sw', col.css);
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      hd.onClassToggle(c as RClass, on);
    });
    classBtns.push(b);
    classRow.append(b);
  }

  // ---- camera
  const camRow = h('div', { class: 'cx-seg cx-seg--cam', role: 'group', 'aria-label': 'Camera presets' });
  const camBtns = new Map<CameraPreset, HTMLButtonElement>();
  for (const c of CAMERAS) {
    const b = h('button', { type: 'button', class: 'cx-seg-btn', 'aria-pressed': 'false', title: c.title, text: c.label });
    b.addEventListener('click', () => { setCameraPreset(c.id); hd.onCameraPreset(c.id); });
    camBtns.set(c.id, b);
    camRow.append(b);
  }

  // ---- quality
  const qRow = h('div', { class: 'cx-seg cx-seg--quality', role: 'radiogroup', 'aria-label': 'Render quality' });
  const qBtns = new Map<Quality, HTMLButtonElement>();
  for (const q of QUALITIES) {
    const b = h('button', { type: 'button', role: 'radio', class: 'cx-seg-btn', 'aria-checked': 'false', text: q });
    b.addEventListener('click', () => { setQuality(q); hd.onQuality(q); });
    qBtns.set(q, b);
    qRow.append(b);
  }

  // ---- assemble
  el.append(
    ...(actions ? [actions] : []),
    group('Primary', primaryGroup),
    h('div', { class: 'cx-field' },
      h('div', { class: 'cx-label-row' }, h('label', { for: eId, text: 'Energy' }), eValue),
      eSlider, eTicks, eSub,
    ),
    h('div', { class: 'cx-grid2' },
      h('div', { class: 'cx-field' }, h('div', { class: 'cx-label-row' }, h('label', { for: zId, text: 'Zenith θ' }), zValue), zSlider),
      h('div', { class: 'cx-field' }, h('div', { class: 'cx-label-row' }, h('label', { for: aId, text: 'From az.' }), aValue), aSlider),
    ),
    h('div', { class: 'cx-grid2' },
      h('div', { class: 'cx-field' }, h('div', { class: 'cx-label-row' }, h('label', { for: cdId, text: 'Core dist.' }), cdValue), cdSlider),
      h('div', { class: 'cx-field' }, h('div', { class: 'cx-label-row' }, h('label', { for: caId, text: 'Core az.' }), caValue), caSlider),
    ),
    coreSub,
    h('div', { class: 'cx-grid2 cx-grid2--seed' },
      h('div', { class: 'cx-field' }, h('label', { for: sId, class: 'cx-label', text: 'Seed' }), h('div', { class: 'cx-inline' }, seedInput, dice)),
      h('div', { class: 'cx-field' }, h('label', { for: cId, class: 'cx-label', text: 'EM cut' }), cutSelect),
    ),
    h('div', { class: 'cx-field' }, h('label', { for: tId, class: 'cx-label', text: 'Thinning' }), thinSelect, thinNote),
    advanced,
    runBtn,
    h('hr', { class: 'cx-rule' }),
    group('Particles', classRow),
    group('Camera', camRow),
    group('Quality', qRow),
  );

  // ---- state sync
  function syncPrimary(): void {
    for (const [id, b] of primaryBtns) {
      const on = id === params.primary;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  function fillThinSelect(): void {
    thinSelect.replaceChildren();
    for (const t of THIN_PRESETS) thinSelect.append(h('option', { value: String(t.mode), text: t.label }));
    if (typeof thinMode === 'number' && !THIN_PRESETS.some((t) => t.mode === thinMode)) {
      thinSelect.append(h('option', { value: String(thinMode), text: `ε = ${sci(thinMode)} (custom)` }));
    }
    thinSelect.value = String(thinMode);
  }

  function fillCutSelect(): void {
    cutSelect.replaceChildren();
    const cuts = EM_CUTS.includes(params.emCutMeV) ? EM_CUTS : [...EM_CUTS, params.emCutMeV].sort((a, b) => a - b);
    for (const c of cuts) cutSelect.append(h('option', { value: String(c), text: `${c} MeV` }));
    cutSelect.value = String(params.emCutMeV);
  }

  function effectiveThinning(): number {
    return thinMode === 'auto' ? autoThinning(params.energyEV, params.emCutMeV) : thinMode;
  }

  function refreshReadouts(): void {
    const lg = Math.log10(params.energyEV);
    eValue.textContent = energyEV(params.energyEV);
    const A = primaryA();
    eSub.textContent = `log₁₀(E/eV) = ${lg.toFixed(2)}${A > 1 ? ` · ${energyEV(params.energyEV / A)} per nucleon` : ''}`;
    zValue.textContent = `${params.zenithDeg.toFixed(0)}°`;
    aValue.textContent = `${params.azimuthDeg.toFixed(0)}° ${compass(params.azimuthDeg)}`;
    cdValue.textContent = metres(coreDist);
    caValue.textContent = `${coreAz.toFixed(0)}° ${compass(coreAz)}`;
    coreSub.textContent = coreDist < 0.5
      ? 'The shower core lands on the detector.'
      : `The core lands ${metres(coreDist)} ${compass(coreAz)} of the detector (measured on the ground).`;
    const eps = effectiveThinning();
    const eThin = eps * params.energyEV;
    const prefix = thinMode === 'auto' ? 'Auto: ' : '';
    thinNote.textContent = eps > 0
      ? `${prefix}ε = ${sci(eps)}; below ${energyEV(eThin)} (ε·E₀) particles are sampled and carry weights.`
      : `${prefix}no thinning; every particle above the cuts is followed${params.energyEV > 3e13 ? ' (this can take a long time at this energy)' : ''}.`;
  }

  function primaryA(): number {
    return Math.max(1, PRIMARY_MASS_NUMBER[params.primary]);
  }

  function syncInputs(): void {
    syncPrimary();
    eSlider.value = String(clamp(Math.log10(params.energyEV), E_MIN, E_MAX));
    zSlider.value = String(clamp(params.zenithDeg, 0, 70));
    aSlider.value = String(((params.azimuthDeg % 360) + 360) % 360);
    cdSlider.value = String(distToSlider(coreDist));
    caSlider.value = String(Math.round(coreAz) % 360);
    seedInput.value = String(params.seed);
    muInput.value = String(params.muonCutMeV);
    hcInput.value = String(params.hadronCutGeV);
    emChk.checked = params.trackEm;
    fillThinSelect();
    fillCutSelect();
    refreshReadouts();
  }

  function getParams(): ShowerParams {
    const rad = (coreAz * Math.PI) / 180;
    return {
      ...params,
      thinning: effectiveThinning(),
      coreX: Math.round(coreDist * Math.sin(rad) * 100) / 100,
      coreY: Math.round(coreDist * Math.cos(rad) * 100) / 100,
    };
  }

  function matchThin(eps: number, p: ShowerParams, current: ThinMode): ThinMode {
    if (current === 'auto' && approx(eps, autoThinning(p.energyEV, p.emCutMeV))) return 'auto';
    const preset = THIN_PRESETS.find((t) => typeof t.mode === 'number' && approx(t.mode, eps));
    if (preset) return preset.mode;
    if (approx(eps, autoThinning(p.energyEV, p.emCutMeV))) return 'auto';
    return eps;
  }

  function setParams(p: ShowerParams): void {
    // Keep "auto" when the incoming epsilon is what auto gave for the old or the new energy
    // (so a tour step that only changes the energy stays on auto).
    const wasAutoValue = thinMode === 'auto' && approx(p.thinning, autoThinning(params.energyEV, params.emCutMeV));
    const next = matchThin(p.thinning, p, thinMode);
    thinMode = wasAutoValue ? 'auto' : next;
    params = { ...p };
    coreDist = Math.hypot(p.coreX, p.coreY);
    coreAz = bearing(p.coreX, p.coreY);
    syncInputs();
  }

  function run(): void {
    if (busy) return;
    hd.onRun(getParams());
  }

  function setBusy(progress: number | null, label?: string): void {
    busy = progress !== null;
    runBtn.disabled = busy;
    runBtn.classList.toggle('is-busy', busy);
    runBtn.setAttribute('aria-busy', String(busy));
    const indeterminate = busy && !Number.isFinite(progress);
    runBtn.classList.toggle('is-indeterminate', indeterminate);
    if (!busy) {
      runFill.style.transform = 'scaleX(0)';
      runLabel.textContent = 'Simulate';
      return;
    }
    const f = indeterminate ? 1 : clamp(progress!, 0, 1);
    runFill.style.transform = `scaleX(${f})`;
    runLabel.textContent = label ?? (indeterminate ? 'Simulating…' : `Simulating… ${Math.round(f * 100)}%`);
  }

  function setCameraPreset(id: CameraPreset | null): void {
    for (const [cid, b] of camBtns) b.setAttribute('aria-pressed', String(cid === id));
  }

  function setQuality(q: Quality): void {
    for (const [qid, b] of qBtns) {
      b.setAttribute('aria-checked', String(qid === q));
      b.tabIndex = qid === q ? 0 : -1;
    }
  }

  function setClassVisible(c: RClass, visible: boolean): void {
    classBtns[c]?.setAttribute('aria-pressed', String(visible));
  }

  syncInputs();
  setQuality(opts.quality ?? 'medium');
  setCameraPreset(opts.camera ?? null);

  return { setBusy, setParams, getParams, setCameraPreset, setQuality, setClassVisible };
}

function bearing(x: number, y: number): number {
  if (Math.hypot(x, y) < 1e-6) return 0;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

function group(title: string, body: HTMLElement): HTMLElement {
  return h('div', { class: 'cx-group' }, h('div', { class: 'cx-label', text: title }), body);
}

function field(id: string, label: string, input: HTMLElement, unit: string): HTMLElement {
  return h('div', { class: 'cx-field' },
    h('label', { for: id, class: 'cx-label', text: label }),
    h('div', { class: 'cx-inline' }, input, h('span', { class: 'cx-unit', text: unit })),
  );
}
