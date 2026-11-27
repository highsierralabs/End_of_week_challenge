// Diagnostics panel: four canvas-2D charts behind tabs.
//   profile   - longitudinal profile per class vs slant depth, Gaisser-Hillas fit, markers
//   lateral   - ground density vs core distance in the shower plane, NKG overlay
//   footprint - 2D ground density map around the core
//   timing    - arrival delay behind a plane front moving at c (shower-front thickness)
import { gaisserHillas, nkgDensity, showerAge, xmaxNucleusMatthews, xmaxPhoton } from '../physics/analytic';
import { moliereRadiusM, TOP_ALTITUDE_M, verticalDepth } from '../physics/atmosphere';
import { GND, GND_STRIDE, PRIMARY_MASS_NUMBER, RClass, RCLASS_COUNT, type ShowerResult } from '../physics/types';
import { ACCENT, CLASS_COLORS, NEUTRAL_CSS } from './colors';
import { h } from './dom';
import { compass, metres, si, timeNs } from './format';
import {
  Axis, clipTo, decadeCeil, decadeFloor, drawAxes, drawPow10, drawSeries, haloText, INK, linearTicks, logTicks, MONO,
  niceStep, SANS, Surface, type Rect,
} from './plot';

export type ChartTab = 'profile' | 'lateral' | 'footprint' | 'timing';

const C_M_PER_NS = 0.299792458;

const TABS: { id: ChartTab; label: string; caption: string }[] = [
  {
    id: 'profile', label: 'Profile',
    caption: 'Weighted number of particles crossing each slant depth along the axis (log scale). Dashed: Gaisser–Hillas fit to the charged curve. ▲ on the axis: the Heitler–Matthews estimate of Xmax for this primary (a toy-model guide, not a measurement).',
  },
  {
    id: 'lateral', label: 'Lateral',
    caption: 'Particle density at ground versus distance from the shower axis, measured in the plane perpendicular to the axis. Dashed: NKG function for this shower\'s electron number, age and Molière radius. Bars: statistical uncertainty from the thinning weights.',
  },
  {
    id: 'footprint', label: 'Footprint',
    caption: 'Where the particles land (particles per m² on the ground, log colour scale), centred on the core with north up. The dashed line points to where the shower came from.',
  },
  {
    id: 'timing', label: 'Timing',
    caption: 'Arrival delay behind a flat front moving at c through the core, each class normalised to unit area. Muons lead; electrons and photons scatter, take longer paths and trail behind: this spread is the thickness of the shower front.',
  },
];

interface Group { id: string; label: string; color: string; classes: RClass[] }
const GROUPS: Group[] = [
  { id: 'g', label: 'γ', color: CLASS_COLORS[RClass.GAMMA]!.css, classes: [RClass.GAMMA] },
  { id: 'e', label: 'e±', color: CLASS_COLORS[RClass.ELECTRON]!.css, classes: [RClass.ELECTRON, RClass.POSITRON] },
  { id: 'm', label: 'μ±', color: CLASS_COLORS[RClass.MUON]!.css, classes: [RClass.MUON] },
  { id: 'h', label: 'hadrons', color: CLASS_COLORS[RClass.HADRON]!.css, classes: [RClass.HADRON] },
];
const GROUP_OF_CLASS: number[] = [0, 1, 1, 2, 3];

const LAT_PER_DECADE = 5;
const LAT_KMAX = 24; // 1 m .. ~63 km
const FOOT_N = 120;
const TIME_BINS = 72;

type FootExtent = 'auto' | 50 | 200 | 1000 | 5000;
type FootFilter = 'all' | 'g' | 'e' | 'm' | 'h';
type RadialFilter = 'all' | '0-50' | '50-200' | '200-1000' | '1000+';

interface Derived {
  r: ShowerResult;
  n: number;
  cx: number;
  cy: number;
  ax: number;
  ay: number;
  az: number;
  cosT: number;
  zg: number;
  rPerp: Float32Array;
  delay: Float32Array;
  rDet: number;
  tPlaneDet: number;
  /** Per lateral group (0 g, 1 e, 2 m, 3 h): sum of w and w^2 per annulus. */
  latW: Float64Array[];
  latW2: Float64Array[];
  timeOrder: Uint32Array | null;
}

interface TimingHist { lo: number; hi: number; bw: number; hist: Float64Array[]; total: number[]; inRange: number[]; median: number[] }

export class ChartsPanel {
  private readonly el: HTMLElement;
  private readonly surface: Surface;
  private readonly wrap: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly legend: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly options: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly tabBtns = new Map<ChartTab, HTMLButtonElement>();
  private tab: ChartTab = 'profile';
  private d: Derived | null = null;
  private tNs: number | null = null;
  private queued = false;
  private hover: ((px: number, py: number) => string | null) | null = null;

  private footExtent: FootExtent = 'auto';
  private footFilter: FootFilter = 'all';
  private footFollow = false;
  private foot = { key: '', grid: new Float64Array(FOOT_N * FOOT_N), ptr: 0, tLast: -Infinity };
  private footMaxCache: { key: string; d: Derived | null; max: number } = { key: '', d: null, max: 0 };
  private radial: RadialFilter = 'all';
  private timingCache: { key: string; th: TimingHist | null } = { key: '', th: null };

  constructor(el: HTMLElement) {
    this.el = el;
    el.classList.add('cx-charts');
    const tabs = h('div', { class: 'cx-ctabs', role: 'tablist', 'aria-label': 'Chart' });
    for (const t of TABS) {
      const b = h('button', { type: 'button', role: 'tab', class: 'cx-ctab', 'aria-selected': 'false', text: t.label });
      b.addEventListener('click', () => this.showTab(t.id));
      tabs.append(b);
      this.tabBtns.set(t.id, b);
    }
    tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = TABS.findIndex((t) => t.id === this.tab);
      const j = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      this.showTab(TABS[j]!.id);
      this.tabBtns.get(TABS[j]!.id)?.focus();
      e.preventDefault();
    });
    this.options = h('div', { class: 'cx-copts' });
    this.readout = h('div', { class: 'cx-creadout', 'aria-live': 'off' });
    const canvas = h('canvas', { class: 'cx-canvas', role: 'img', 'aria-label': 'Chart' });
    this.surface = new Surface(canvas);
    this.empty = h('div', { class: 'cx-chart-empty', text: 'Run a simulation to see the shower diagnostics.' });
    this.wrap = h('div', { class: 'cx-chart-wrap' }, canvas, this.empty);
    this.legend = h('div', { class: 'cx-legend' });
    this.caption = h('p', { class: 'cx-caption' });
    el.append(tabs, h('div', { class: 'cx-ctoolbar' }, this.options, this.readout), this.wrap, this.legend, this.caption);

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const txt = this.hover?.(e.clientX - rect.left, e.clientY - rect.top) ?? null;
      this.readout.textContent = txt ?? '';
    });
    canvas.addEventListener('pointerleave', () => { this.readout.textContent = ''; });

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.requestDraw()).observe(this.wrap);
    }
    this.showTab('profile');
  }

  /** Switch the visible chart. */
  showTab(id: ChartTab): void {
    this.tab = id;
    for (const [tid, b] of this.tabBtns) {
      const on = tid === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.caption.textContent = TABS.find((t) => t.id === id)!.caption;
    this.buildOptions();
    this.readout.textContent = '';
    this.draw();
  }

  update(r: ShowerResult): void {
    this.d = derive(r);
    this.foot.key = '';
    this.timingCache.key = '';
    this.draw();
  }

  setTime(tNs: number): void {
    this.tNs = tNs;
    if (this.tab === 'lateral') return;
    if (this.tab === 'footprint' && !this.footFollow) return;
    this.requestDraw();
  }

  resize(): void {
    this.draw();
  }

  private requestDraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.draw();
    });
  }

  // ------------------------------------------------------------------ toolbar

  private buildOptions(): void {
    this.options.replaceChildren();
    if (this.tab === 'footprint') {
      const ext = select('Extent', [
        ['auto', 'auto'], ['50', '±50 m'], ['200', '±200 m'], ['1000', '±1 km'], ['5000', '±5 km'],
      ], String(this.footExtent), (v) => { this.footExtent = v === 'auto' ? 'auto' : (Number(v) as FootExtent); this.draw(); });
      const fil = select('Particles', [
        ['all', 'all'], ['e', 'e±'], ['m', 'μ±'], ['g', 'γ'], ['h', 'hadrons'],
      ], this.footFilter, (v) => { this.footFilter = v as FootFilter; this.draw(); });
      const chk = h('input', { type: 'checkbox', class: 'cx-check' });
      chk.checked = this.footFollow;
      chk.addEventListener('change', () => { this.footFollow = chk.checked; this.draw(); });
      const follow = h('label', { class: 'cx-checkrow cx-checkrow--sm', title: 'Only show particles that have landed by the replay clock' }, chk, h('span', { text: 'follow clock' }));
      this.options.append(ext, fil, follow);
    } else if (this.tab === 'timing') {
      const rad = select('Core distance', [
        ['all', 'all r'], ['0-50', 'r < 50 m'], ['50-200', '50–200 m'], ['200-1000', '200 m–1 km'], ['1000+', 'r > 1 km'],
      ], this.radial, (v) => { this.radial = v as RadialFilter; this.draw(); });
      this.options.append(rad);
    } else {
      this.options.append(h('span', { class: 'cx-copts-hint', text: this.tab === 'profile' ? 'slant depth along the axis' : 'shower-plane distance' }));
    }
  }

  // ------------------------------------------------------------------ drawing

  private draw(): void {
    const w = this.wrap.clientWidth;
    if (w <= 0) return;
    const ht = Math.round(Math.min(Math.max(w * 0.8, 250), 420));
    this.surface.canvas.style.height = `${ht}px`;
    this.wrap.style.height = `${ht}px`;
    if (!this.surface.fit(w, ht)) return;
    this.hover = null;
    const d = this.d;
    if (!d) {
      this.setEmpty('Run a simulation to see the shower diagnostics.');
      this.legend.replaceChildren();
      return;
    }
    try {
      if (this.tab === 'profile') this.drawProfile(d);
      else if (this.tab === 'lateral') this.drawLateral(d);
      else if (this.tab === 'footprint') this.drawFootprint(d);
      else this.drawTiming(d);
    } catch (err) {
      // A chart must never take the app down; show the failure in place.
      this.setEmpty(`Chart unavailable: ${(err as Error).message}`);
    }
  }

  private setEmpty(msg: string | null): void {
    this.empty.textContent = msg ?? '';
    this.empty.hidden = msg === null;
  }

  private setLegend(items: { color: string; label: string; dash?: boolean; marker?: string }[], note?: string): void {
    this.legend.replaceChildren();
    for (const it of items) {
      const sw = h('span', { class: `cx-lg-sw${it.dash ? ' is-dash' : ''}${it.marker ? ' is-marker' : ''}`, 'aria-hidden': 'true', text: it.marker ?? '' });
      sw.style.setProperty('--sw', it.color);
      this.legend.append(h('span', { class: 'cx-lg' }, sw, h('span', { text: it.label })));
    }
    if (note) this.legend.append(h('span', { class: 'cx-lg cx-lg--note', text: note }));
  }

  // ---- 1. longitudinal profile
  private drawProfile(d: Derived): void {
    const s = this.surface;
    const { ctx } = s;
    const r = d.r;
    const P = r.profile;
    const st = r.stats;
    const ground = Number.isFinite(st.groundSlantDepth) && st.groundSlantDepth > 0 ? st.groundSlantDepth : P.bins * P.step;
    const frame: Rect = { x: 56, y: 30, w: s.w - 56 - 14, h: s.h - 30 - 42 };
    const xs = new Float64Array(P.bins);
    for (let i = 0; i < P.bins; i++) xs[i] = (i + 0.5) * P.step;

    let maxY = 0;
    const series: { ys: ArrayLike<number>; color: string; width: number; label: string }[] = [];
    for (let c = 0; c < RCLASS_COUNT; c++) {
      const ys = P.byClass[c];
      if (!ys) continue;
      for (let i = 0; i < ys.length; i++) if (ys[i]! > maxY) maxY = ys[i]!;
      series.push({ ys, color: CLASS_COLORS[c]!.css, width: 1.25, label: CLASS_COLORS[c]!.label + 's' });
    }
    for (let i = 0; i < P.charged.length; i++) if (P.charged[i]! > maxY) maxY = P.charged[i]!;
    if (st.gh && Number.isFinite(st.gh.nmax)) maxY = Math.max(maxY, st.gh.nmax);
    if (!(maxY > 0) || P.bins === 0) {
      this.setEmpty('The longitudinal profile is empty: no particles crossed the depth planes.');
      this.legend.replaceChildren();
      return;
    }
    this.setEmpty(null);

    const xMax = Math.max(ground * 1.06, 100);
    const yMax = decadeCeil(maxY * 1.6);
    const yMin = Math.max(0.1, decadeFloor(yMax / 1e7));
    const X = new Axis(0, xMax, false, frame.x, frame.x + frame.w);
    const Y = new Axis(yMin, yMax, true, frame.y + frame.h, frame.y);
    drawAxes(s, { frame, x: X, y: Y, xLabel: 'slant depth X (g/cm²)', yLabel: 'particles (weighted)' });

    // top axis: altitude on the axis (flat-atmosphere slant = vertical / cos(zenith))
    const cosT = d.cosT;
    ctx.save();
    ctx.strokeStyle = INK.axis;
    ctx.lineWidth = s.hair;
    ctx.fillStyle = INK.muted;
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'center';
    let lastPx = -Infinity;
    for (const km of [40, 30, 25, 20, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2.5, 2]) {
      const z = km * 1000;
      if (z <= d.zg + 50) continue;
      const Xs = verticalDepth(z) / cosT;
      if (Xs > xMax) continue;
      const px = X.map(Xs);
      if (px < frame.x + 6 || px - lastPx < 26) continue;
      ctx.beginPath();
      ctx.moveTo(s.crisp(px), frame.y);
      ctx.lineTo(s.crisp(px), frame.y - 4);
      ctx.stroke();
      ctx.fillText(String(km), px, frame.y - 7);
      lastPx = px;
    }
    ctx.textAlign = 'right';
    ctx.fillText('km', frame.x - 6, frame.y - 7);
    ctx.restore();

    ctx.save();
    clipTo(s, frame);
    // below-ground shading
    const gx = X.map(ground);
    ctx.fillStyle = 'rgba(120, 100, 80, 0.14)';
    ctx.fillRect(gx, frame.y, frame.x + frame.w - gx, frame.h);
    ctx.strokeStyle = 'rgba(190, 160, 120, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = -frame.h; k < frame.x + frame.w - gx; k += 7) {
      ctx.moveTo(gx + k, frame.y + frame.h);
      ctx.lineTo(gx + k + frame.h, frame.y);
    }
    ctx.stroke();

    for (const sr of series) drawSeries(s, X, Y, xs, sr.ys, { color: sr.color, width: sr.width, alpha: 0.92 });
    drawSeries(s, X, Y, xs, P.charged, { color: NEUTRAL_CSS, width: 1.8 });

    const gh = st.gh;
    if (gh && [gh.nmax, gh.xmax, gh.x0, gh.lambda].every(Number.isFinite) && gh.lambda > 0 && gh.xmax > gh.x0) {
      const n = 240;
      const gxs = new Float64Array(n);
      const gys = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const xv = Math.max(gh.x0, 0) + ((ground - Math.max(gh.x0, 0)) * i) / (n - 1);
        gxs[i] = xv;
        const yv = gaisserHillas(xv, gh.nmax, gh.xmax, gh.x0, gh.lambda);
        gys[i] = yv >= yMin * 0.5 ? yv : NaN;
      }
      drawSeries(s, X, Y, gxs, gys, { color: '#ffffff', width: 1.3, dash: [5, 4], alpha: 0.85 });
    }
    ctx.restore();

    // markers
    const vline = (xv: number, color: string, dash: number[]): number => {
      const px = s.crisp(X.map(xv));
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = s.hair * Math.max(1, Math.round(s.dpr));
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(px, frame.y);
      ctx.lineTo(px, frame.y + frame.h);
      ctx.stroke();
      ctx.restore();
      return px;
    };
    const xFirst = st.firstInteractionDepth;
    if (Number.isFinite(xFirst) && xFirst >= 0 && xFirst <= xMax) {
      const px = vline(xFirst, 'rgba(220, 228, 245, 0.55)', [2, 3]);
      haloText(ctx, `X₁ ${xFirst.toFixed(0)}`, px + 4, frame.y + 13, INK.text);
    }
    if (gh && Number.isFinite(gh.xmax) && gh.xmax > 0 && gh.xmax <= xMax) {
      const px = vline(gh.xmax, ACCENT.css, [4, 3]);
      haloText(ctx, `Xmax ${gh.xmax.toFixed(0)}`, px + 4, frame.y + 27, ACCENT.css);
    }
    {
      const px = vline(ground, 'rgba(230, 200, 150, 0.8)', []);
      ctx.save();
      ctx.translate(px - 5, frame.y + frame.h - 6);
      ctx.rotate(-Math.PI / 2);
      haloText(ctx, `ground: ${d.zg.toFixed(0)} m, ${ground.toFixed(0)} g/cm²${d.cosT < 0.999 ? ' slant' : ''}`, 0, 0, '#e8d2a8', `10px ${MONO}`);
      ctx.restore();
    }
    // Heitler-Matthews reference
    const xRef = this.matthewsXmax(r);
    if (xRef !== null && xRef > 0 && xRef < xMax) {
      const px = X.map(xRef);
      ctx.save();
      ctx.fillStyle = ACCENT.css;
      ctx.beginPath();
      ctx.moveTo(px, frame.y + frame.h - 8);
      ctx.lineTo(px - 5, frame.y + frame.h);
      ctx.lineTo(px + 5, frame.y + frame.h);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // replay cursor: where the plane front is on the axis
    if (this.tNs !== null) {
      const xf = this.frontDepth(d, this.tNs);
      if (xf !== null && xf > 0 && xf < ground) {
        const px = s.crisp(X.map(xf));
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, frame.y);
        ctx.lineTo(px, frame.y + frame.h);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(px - 4, frame.y);
        ctx.lineTo(px + 4, frame.y);
        ctx.lineTo(px, frame.y + 5);
        ctx.fill();
        ctx.restore();
        haloText(ctx, 'front', px + 4, frame.y + frame.h - 8, '#ffffff');
      }
    }

    this.setLegend([
      { color: NEUTRAL_CSS, label: 'charged' },
      ...series.map((sr) => ({ color: sr.color, label: sr.label })),
      ...(gh ? [{ color: '#ffffff', label: 'Gaisser–Hillas fit', dash: true }] : []),
      ...(xRef !== null ? [{ color: ACCENT.css, label: `Heitler–Matthews Xmax ≈ ${xRef.toFixed(0)}`, marker: '▲' }] : []),
    ], gh ? undefined : 'no Gaisser–Hillas fit for this shower');

    this.hover = (px, py) => {
      if (px < frame.x || px > frame.x + frame.w || py < frame.y || py > frame.y + frame.h) return null;
      const xv = X.inv(px);
      const i = Math.floor(xv / P.step);
      if (i < 0 || i >= P.bins) return `X = ${xv.toFixed(0)} g/cm²`;
      return `X = ${xv.toFixed(0)} g/cm² · charged ${si(P.charged[i]!)} · μ ${si(P.byClass[RClass.MUON]?.[i] ?? 0)}`;
    };
  }

  private matthewsXmax(r: ShowerResult): number | null {
    const E0 = r.params.energyEV / 1e9;
    const A = PRIMARY_MASS_NUMBER[r.params.primary];
    if (!(E0 > 0)) return null;
    const v = A > 0 ? xmaxNucleusMatthews(E0, A) : xmaxPhoton(E0);
    return Number.isFinite(v) ? v : null;
  }

  /** Slant depth of a plane front moving at c along the axis, reaching the core at tCore. */
  private frontDepth(d: Derived, t: number): number | null {
    const st = d.r.stats;
    if (!Number.isFinite(st.tCore)) return null;
    const z = d.zg + (st.tCore - t) * C_M_PER_NS * d.cosT;
    if (z >= TOP_ALTITUDE_M) return 0;
    if (z <= d.zg) return null;
    return verticalDepth(z) / d.cosT;
  }

  // ---- 2. lateral distribution
  private drawLateral(d: Derived): void {
    const s = this.surface;
    const { ctx } = s;
    const st = d.r.stats;
    const frame: Rect = { x: 58, y: 14, w: s.w - 58 - 14, h: s.h - 14 - 42 };
    const edges = latEdges();
    const plotGroups = [1, 2];
    let maxD = 0;
    let minD = Infinity;
    let maxR = 10;
    const pts: { g: number; r: number; dens: number; err: number }[] = [];
    for (const g of plotGroups) {
      const W = d.latW[g]!;
      const W2 = d.latW2[g]!;
      for (let k = 0; k < LAT_KMAX; k++) {
        if (!(W[k]! > 0)) continue;
        const r0 = edges[k]!;
        const r1 = edges[k + 1]!;
        const area = Math.PI * (r1 * r1 - r0 * r0);
        const dens = W[k]! / area;
        const err = Math.sqrt(W2[k]!) / area;
        const rc = Math.sqrt(r0 * r1);
        pts.push({ g, r: rc, dens, err });
        maxD = Math.max(maxD, dens);
        minD = Math.min(minD, dens);
        maxR = Math.max(maxR, r1);
      }
    }
    if (!(maxD > 0)) {
      this.setEmpty(d.n === 0 ? 'No particles reached the ground above the energy cuts.' : 'No e± or muons reached the ground above the energy cuts.');
      this.legend.replaceChildren();
      return;
    }
    this.setEmpty(null);
    const xMax = Math.max(decadeCeil(maxR), 100, decadeCeil(d.rDet * 1.5));
    const yMax = decadeCeil(maxD * 2);
    const yMin = Math.max(decadeFloor(minD * 0.5), yMax / 1e9);
    const X = new Axis(1, xMax, true, frame.x, frame.x + frame.w);
    const Y = new Axis(yMin, yMax, true, frame.y + frame.h, frame.y);
    drawAxes(s, {
      frame, x: X, y: Y, xLabel: 'distance from shower axis r (m)', yLabel: 'density (m⁻²)',
      xFmt: (v) => (v >= 1e4 ? `${v / 1e3}k` : String(v)),
    });

    ctx.save();
    clipTo(s, frame);
    // NKG
    const gh = st.gh;
    const Ne = (st.groundCounts[RClass.ELECTRON] ?? 0) + (st.groundCounts[RClass.POSITRON] ?? 0);
    let nkgLabel: string | null = null;
    if (gh && Number.isFinite(gh.xmax) && gh.xmax > 0 && Ne > 0) {
      const sAge = showerAge(st.groundSlantDepth, gh.xmax);
      const rM = moliereRadiusM(d.zg);
      if (sAge > 0.05 && sAge < 2.2 && Number.isFinite(rM)) {
        const n = 160;
        const xs = new Float64Array(n);
        const ys = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const rv = 10 ** ((Math.log10(xMax) * i) / (n - 1));
          xs[i] = rv;
          const v = nkgDensity(rv, Ne, sAge, rM);
          ys[i] = v >= yMin * 0.3 ? v : NaN;
        }
        drawSeries(s, X, Y, xs, ys, { color: '#ffffff', width: 1.3, dash: [5, 4], alpha: 0.85 });
        nkgLabel = `NKG (s = ${sAge.toFixed(2)}, r_M = ${rM.toFixed(0)} m)`;
      }
    }
    // points with error bars
    for (const p of pts) {
      const col = GROUPS[p.g]!.color;
      const px = X.map(p.r);
      const py = Y.map(p.dens);
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1;
      const lo = Math.max(p.dens - p.err, yMin * 0.5);
      ctx.beginPath();
      ctx.moveTo(px, Y.map(lo));
      ctx.lineTo(px, Y.map(p.dens + p.err));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.beginPath();
      if (p.g === 2) ctx.rect(px - 2.6, py - 2.6, 5.2, 5.2);
      else ctx.arc(px, py, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // detector marker
    const rd = Math.max(d.rDet, 1);
    const px = s.crisp(X.map(rd));
    ctx.save();
    ctx.strokeStyle = 'rgba(230, 200, 150, 0.85)';
    ctx.lineWidth = s.hair * Math.max(1, Math.round(s.dpr));
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, frame.y);
    ctx.lineTo(px, frame.y + frame.h);
    ctx.stroke();
    ctx.restore();
    const lbl = d.rDet < 1 ? 'detector (r < 1 m)' : `detector ${metres(d.rDet)}`;
    const right = px + 4 + ctx.measureText(lbl).width + 30 < frame.x + frame.w;
    haloText(ctx, lbl, right ? px + 4 : px - 4, frame.y + 13, '#e8d2a8', `10.5px ${MONO}`, right ? 'left' : 'right');

    this.setLegend([
      { color: GROUPS[1]!.color, label: 'e±', marker: '●' },
      { color: GROUPS[2]!.color, label: 'μ±', marker: '■' },
      ...(nkgLabel ? [{ color: '#ffffff', label: nkgLabel, dash: true }] : []),
    ], nkgLabel ? undefined : 'NKG needs a Gaisser–Hillas Xmax and ground e±');

    this.hover = (hx, hy) => {
      if (hx < frame.x || hx > frame.x + frame.w || hy < frame.y || hy > frame.y + frame.h) return null;
      return `r = ${metres(X.inv(hx))} · ρ = ${fmtDensity(Y.inv(hy))} m⁻²`;
    };
  }

  // ---- 3. ground footprint
  private drawFootprint(d: Derived): void {
    const s = this.surface;
    const { ctx } = s;
    if (d.n === 0) {
      this.setEmpty('No particles reached the ground above the energy cuts.');
      this.legend.replaceChildren();
      return;
    }
    this.setEmpty(null);
    const L = this.footExtent === 'auto' ? autoExtent(d) : this.footExtent;
    const left = 50;
    const side = Math.max(60, Math.min(s.w - left - 74, s.h - 14 - 42));
    const frame: Rect = { x: left, y: 14, w: side, h: side };
    const tLimit = this.footFollow && this.tNs !== null ? this.tNs : null;
    const grid = this.footGrid(d, L, this.footFilter, tLimit);
    const cell = (2 * L) / FOOT_N;
    const cellArea = cell * cell;
    // In clock mode the colour scale is fixed by the complete footprint, so it does not rescale while particles land.
    let gmax = tLimit === null ? 0 : this.fullFootMax(d, L, this.footFilter);
    if (tLimit === null) for (let i = 0; i < grid.length; i++) if (grid[i]! > gmax) gmax = grid[i]!;
    const dMax = gmax / cellArea;
    const dTop = dMax > 0 ? decadeCeil(dMax) : 1;
    const dBot = dTop / 1e5;

    const X = new Axis(-L, L, false, frame.x, frame.x + frame.w);
    const Y = new Axis(-L, L, false, frame.y + frame.h, frame.y);
    const kmMode = L >= 1000;
    const fmt = (v: number): string => (kmMode ? String(Number((v / 1000).toPrecision(3))) : String(Math.round(v))).replace('-', '−');
    drawAxes(s, {
      frame, x: X, y: Y, xLabel: `east of core (${kmMode ? 'km' : 'm'})`, yLabel: `north of core (${kmMode ? 'km' : 'm'})`,
      xFmt: fmt, yFmt: fmt, grid: false,
      xTicks: linearTicks(-L, L, 4), yTicks: linearTicks(-L, L, 4),
    });

    // density image
    const img = new ImageData(FOOT_N, FOOT_N);
    const lut = colormap();
    const la = Math.log10(dBot);
    const lb = Math.log10(dTop);
    for (let j = 0; j < FOOT_N; j++) {
      for (let i = 0; i < FOOT_N; i++) {
        const v = grid[j * FOOT_N + i]! / cellArea;
        const o = (j * FOOT_N + i) * 4;
        if (!(v > 0)) { img.data[o + 3] = 0; continue; }
        const f = Math.max(0, Math.min(1, (Math.log10(v) - la) / (lb - la)));
        const k = Math.round(f * 255) * 3;
        img.data[o] = lut[k]!;
        img.data[o + 1] = lut[k + 1]!;
        img.data[o + 2] = lut[k + 2]!;
        img.data[o + 3] = 255;
      }
    }
    const off = document.createElement('canvas');
    off.width = FOOT_N;
    off.height = FOOT_N;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, frame.x, frame.y, frame.w, frame.h);
    ctx.restore();

    // light grid over the map
    ctx.save();
    ctx.strokeStyle = 'rgba(200, 215, 240, 0.10)';
    ctx.lineWidth = s.hair;
    ctx.beginPath();
    for (const v of linearTicks(-L, L, 4)) {
      const px = s.crisp(X.map(v));
      const py = s.crisp(Y.map(v));
      ctx.moveTo(px, frame.y); ctx.lineTo(px, frame.y + frame.h);
      ctx.moveTo(frame.x, py); ctx.lineTo(frame.x + frame.w, py);
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    clipTo(s, frame);
    // arrival direction: the shower comes from azimuth phi (clockwise from north)
    const p = d.r.params;
    const cx0 = X.map(0);
    const cy0 = Y.map(0);
    if (p.zenithDeg > 0.5) {
      const phi = (p.azimuthDeg * Math.PI) / 180;
      const len = frame.w * 0.7;
      const ex = cx0 + Math.sin(phi) * len;
      const ey = cy0 - Math.cos(phi) * len;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx0, cy0);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // core
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx0 - 6, cy0); ctx.lineTo(cx0 - 2, cy0);
    ctx.moveTo(cx0 + 2, cy0); ctx.lineTo(cx0 + 6, cy0);
    ctx.moveTo(cx0, cy0 - 6); ctx.lineTo(cx0, cy0 - 2);
    ctx.moveTo(cx0, cy0 + 2); ctx.lineTo(cx0, cy0 + 6);
    ctx.stroke();
    // north arrow
    const nx = frame.x + 16;
    const ny = frame.y + 12;
    ctx.fillStyle = 'rgba(235, 240, 250, 0.9)';
    ctx.beginPath();
    ctx.moveTo(nx, ny);
    ctx.lineTo(nx - 4.5, ny + 11);
    ctx.lineTo(nx, ny + 8);
    ctx.lineTo(nx + 4.5, ny + 11);
    ctx.closePath();
    ctx.fill();
    haloText(ctx, 'N', nx, ny + 24, '#eef2fb', `bold 10.5px ${SANS}`, 'center');
    // scale bar
    const sbLen = niceStep(L, 2);
    const sbPx = X.map(sbLen) - X.map(0);
    const sbx = frame.x + 12;
    const sby = frame.y + frame.h - 14;
    ctx.fillStyle = 'rgba(5, 8, 15, 0.55)';
    ctx.fillRect(sbx - 6, sby - 15, sbPx + 12, 23);
    ctx.fillStyle = '#eef2fb';
    ctx.fillRect(sbx, sby, sbPx, 2);
    ctx.fillRect(sbx, sby - 3, 1, 8);
    ctx.fillRect(sbx + sbPx - 1, sby - 3, 1, 8);
    haloText(ctx, metres(sbLen), sbx + sbPx / 2, sby - 5, '#eef2fb', `10px ${MONO}`, 'center');
    ctx.restore();

    // detector (outside the clip so the edge arrow stays visible)
    const du = -d.cx;
    const dv = -d.cy;
    const inside = Math.abs(du) <= L && Math.abs(dv) <= L;
    ctx.save();
    ctx.strokeStyle = '#ffe2a8';
    ctx.fillStyle = '#ffe2a8';
    ctx.lineWidth = 1.5;
    if (inside) {
      const px = X.map(du);
      const py = Y.map(dv);
      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px, py, 1.6, 0, Math.PI * 2);
      ctx.fill();
      const lblRight = px < frame.x + frame.w - 70;
      haloText(ctx, 'detector', lblRight ? px + 9 : px - 9, py + 4, '#ffe2a8', `10.5px ${MONO}`, lblRight ? 'left' : 'right');
    } else {
      const k = L / Math.max(Math.abs(du), Math.abs(dv));
      const px = X.map(du * k * 0.94);
      const py = Y.map(dv * k * 0.94);
      const ang = Math.atan2(-(dv), du);
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(7, 0);
      ctx.lineTo(-5, -5);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      const lblRight = px < frame.x + frame.w / 2;
      haloText(ctx, `detector ${metres(Math.hypot(du, dv))}`, lblRight ? px + 10 : px - 10, py + (py < frame.y + 20 ? 14 : -8), '#ffe2a8', `10.5px ${MONO}`, lblRight ? 'left' : 'right');
    }
    ctx.restore();

    // colour bar
    const bx = frame.x + frame.w + 12;
    const bw = 10;
    const grad = ctx.createLinearGradient(0, frame.y + frame.h, 0, frame.y);
    for (let i = 0; i <= 10; i++) {
      const k = Math.round((i / 10) * 255) * 3;
      grad.addColorStop(i / 10, `rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(bx, frame.y, bw, frame.h);
    ctx.strokeStyle = INK.axis;
    ctx.lineWidth = s.hair;
    ctx.strokeRect(s.crisp(bx), s.crisp(frame.y), bw, frame.h);
    const CB = new Axis(dBot, dTop, true, frame.y + frame.h, frame.y);
    ctx.fillStyle = INK.muted;
    for (const v of logTicks(dBot, dTop).major) {
      const py = CB.map(v);
      ctx.fillRect(bx + bw, s.crisp(py), 3, s.hair);
      drawPow10(ctx, bx + bw + 5, py + 4, Math.round(Math.log10(v)), 'left', 10);
    }
    ctx.fillStyle = INK.text;
    ctx.font = `10.5px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.save();
    ctx.translate(bx + bw + 50, frame.y + frame.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('particles per m²', 0, 0);
    ctx.restore();

    const shown = grid.reduce((a, b) => a + b, 0);
    const notes: string[] = [`${si(shown)} particles in view`, `cell ${metres(cell)}`];
    if (tLimit !== null) notes.push(`landed by t = ${timeNs(tLimit)}`);
    this.setLegend([
      { color: '#ffffff', label: 'core', marker: '+' },
      { color: '#ffe2a8', label: 'detector', marker: '◉' },
      ...(p.zenithDeg > 0.5 ? [{ color: '#ffffff', label: `arrives from ${p.azimuthDeg.toFixed(0)}° ${compass(p.azimuthDeg)}`, dash: true }] : []),
    ], notes.join(' · '));

    this.hover = (hx, hy) => {
      if (hx < frame.x || hx > frame.x + frame.w || hy < frame.y || hy > frame.y + frame.h) return null;
      const u = X.inv(hx);
      const v = Y.inv(hy);
      const i = Math.floor(((u + L) / (2 * L)) * FOOT_N);
      const j = Math.floor(((L - v) / (2 * L)) * FOOT_N);
      const val = (grid[j * FOOT_N + i] ?? 0) / cellArea;
      return `${metres(u)} E, ${metres(v)} N · ${fmtDensity(val)} m⁻²`;
    };
  }

  private footGrid(d: Derived, L: number, filter: FootFilter, tLimit: number | null): Float64Array {
    const key = `${L}|${filter}|${tLimit === null ? 'all' : 'clock'}`;
    const F = this.foot;
    if (key !== F.key || (tLimit !== null && tLimit < F.tLast)) {
      F.key = key;
      F.grid.fill(0);
      F.ptr = 0;
      F.tLast = -Infinity;
    }
    const g = d.r.ground;
    const want = filter === 'all' ? -1 : GROUPS.findIndex((x) => x.id === filter);
    const add = (i: number): void => {
      const o = i * GND_STRIDE;
      const cls = g[o + GND.CLASS]!;
      if (want >= 0 && GROUP_OF_CLASS[cls] !== want) return;
      const u = g[o + GND.X]! - d.cx;
      const v = g[o + GND.Y]! - d.cy;
      if (u < -L || u >= L || v <= -L || v > L) return;
      const ci = Math.floor(((u + L) / (2 * L)) * FOOT_N);
      const cj = Math.floor(((L - v) / (2 * L)) * FOOT_N);
      F.grid[cj * FOOT_N + ci]! += g[o + GND.W]!;
    };
    if (tLimit === null) {
      if (F.ptr === 0) {
        for (let i = 0; i < d.n; i++) add(i);
        F.ptr = d.n;
      }
    } else {
      const order = this.timeOrder(d);
      while (F.ptr < d.n) {
        const i = order[F.ptr]!;
        if (g[i * GND_STRIDE + GND.T]! > tLimit) break;
        add(i);
        F.ptr++;
      }
      F.tLast = tLimit;
    }
    return F.grid;
  }

  private fullFootMax(d: Derived, L: number, filter: FootFilter): number {
    const key = `${L}|${filter}`;
    if (this.footMaxCache.key === key && this.footMaxCache.d === d) return this.footMaxCache.max;
    const grid = new Float64Array(FOOT_N * FOOT_N);
    const g = d.r.ground;
    const want = filter === 'all' ? -1 : GROUPS.findIndex((x) => x.id === filter);
    let max = 0;
    for (let i = 0; i < d.n; i++) {
      const o = i * GND_STRIDE;
      if (want >= 0 && GROUP_OF_CLASS[g[o + GND.CLASS]!] !== want) continue;
      const u = g[o + GND.X]! - d.cx;
      const v = g[o + GND.Y]! - d.cy;
      if (u < -L || u >= L || v <= -L || v > L) continue;
      const k = Math.floor(((L - v) / (2 * L)) * FOOT_N) * FOOT_N + Math.floor(((u + L) / (2 * L)) * FOOT_N);
      grid[k]! += g[o + GND.W]!;
      if (grid[k]! > max) max = grid[k]!;
    }
    this.footMaxCache = { key, d, max };
    return max;
  }

  private timeOrder(d: Derived): Uint32Array {
    if (d.timeOrder) return d.timeOrder;
    const g = d.r.ground;
    const t = new Float32Array(d.n);
    for (let i = 0; i < d.n; i++) t[i] = g[i * GND_STRIDE + GND.T]!;
    const idx = new Uint32Array(d.n);
    for (let i = 0; i < d.n; i++) idx[i] = i;
    idx.sort((a, b) => t[a]! - t[b]!);
    d.timeOrder = idx;
    return idx;
  }

  // ---- 4. arrival-time distribution
  private drawTiming(d: Derived): void {
    const s = this.surface;
    const { ctx } = s;
    if (d.n === 0) {
      this.setEmpty('No particles reached the ground above the energy cuts.');
      this.legend.replaceChildren();
      return;
    }
    const th = this.timingHist(d);
    if (!th) {
      this.setEmpty('No ground particles in this core-distance range.');
      this.legend.replaceChildren();
      return;
    }
    this.setEmpty(null);
    const frame: Rect = { x: 56, y: 14, w: s.w - 56 - 14, h: s.h - 14 - 42 };
    let maxY = 0;
    const present: number[] = [];
    for (let g = 0; g < GROUPS.length; g++) {
      if (!(th.total[g]! > 0)) continue;
      present.push(g);
      const hist = th.hist[g]!;
      for (let b = 0; b < TIME_BINS; b++) maxY = Math.max(maxY, hist[b]! / (th.total[g]! * th.bw));
    }
    if (!(maxY > 0)) {
      this.setEmpty('No ground particles in this core-distance range.');
      this.legend.replaceChildren();
      return;
    }
    const X = new Axis(th.lo, th.hi, false, frame.x, frame.x + frame.w);
    const Y = new Axis(0, maxY * 1.12, false, frame.y + frame.h, frame.y);
    drawAxes(s, {
      frame, x: X, y: Y, xLabel: 'delay behind plane front (ns)', yLabel: 'fraction per ns',
    });
    ctx.save();
    clipTo(s, frame);
    // zero-delay line: the plane front itself
    const z0 = s.crisp(X.map(0));
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = s.hair;
    ctx.beginPath();
    ctx.moveTo(z0, frame.y);
    ctx.lineTo(z0, frame.y + frame.h);
    ctx.stroke();
    // draw muons last so they sit on top
    const orderG = [...present].sort((a, b) => (a === 2 ? 1 : 0) - (b === 2 ? 1 : 0));
    for (const g of orderG) {
      const hist = th.hist[g]!;
      const norm = 1 / (th.total[g]! * th.bw);
      const col = GROUPS[g]!.color;
      ctx.beginPath();
      ctx.moveTo(X.map(th.lo), Y.map(0));
      for (let b = 0; b < TIME_BINS; b++) {
        const y = Y.map(hist[b]! * norm);
        ctx.lineTo(X.map(th.lo + b * th.bw), y);
        ctx.lineTo(X.map(th.lo + (b + 1) * th.bw), y);
      }
      ctx.lineTo(X.map(th.hi), Y.map(0));
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'miter';
      ctx.stroke();
    }
    ctx.restore();

    // cursor: how far the replay clock is past the plane front at the detector
    if (this.tNs !== null && Number.isFinite(d.tPlaneDet)) {
      const dl = this.tNs - d.tPlaneDet;
      if (dl >= th.lo && dl <= th.hi) {
        const px = s.crisp(X.map(dl));
        ctx.save();
        ctx.strokeStyle = '#ffe2a8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px, frame.y);
        ctx.lineTo(px, frame.y + frame.h);
        ctx.stroke();
        ctx.restore();
        const right = px < frame.x + frame.w - 120;
        haloText(ctx, 'clock at detector', right ? px + 4 : px - 4, frame.y + 13, '#ffe2a8', `10.5px ${MONO}`, right ? 'left' : 'right');
      }
    }

    const outside = present.reduce((a, g) => a + (th.total[g]! - th.inRange[g]!), 0);
    const all = present.reduce((a, g) => a + th.total[g]!, 0);
    const frac = all > 0 ? outside / all : 0;
    this.setLegend(
      present.map((g) => ({ color: GROUPS[g]!.color, label: `${GROUPS[g]!.label} median ${timeNs(th.median[g]!, 2)}` })),
      frac > 0.005 ? `${(frac * 100).toFixed(1)}% outside the plotted range` : undefined,
    );
    this.hover = (hx, hy) => {
      if (hx < frame.x || hx > frame.x + frame.w || hy < frame.y || hy > frame.y + frame.h) return null;
      return `delay ${timeNs(X.inv(hx), 3)}`;
    };
  }

  private timingHist(d: Derived): TimingHist | null {
    const key = this.radial;
    if (this.timingCache.key === key) return this.timingCache.th;
    const [rLo, rHi] = radialRange(this.radial);
    const g = d.r.ground;
    // range from a strided sample of the selected particles
    const stride = Math.max(1, Math.floor(d.n / 40000));
    const sample: number[] = [];
    for (let i = 0; i < d.n; i += stride) {
      const rr = d.rPerp[i]!;
      const dl = d.delay[i]!;
      if (rr >= rLo && rr < rHi && Number.isFinite(dl)) sample.push(dl);
    }
    let th: TimingHist | null = null;
    if (sample.length > 0) {
      sample.sort((a, b) => a - b);
      const q = (f: number): number => sample[Math.min(sample.length - 1, Math.max(0, Math.floor(f * (sample.length - 1))))]!;
      let lo = Math.min(q(0.002), 0);
      let hi = q(0.95);
      lo = Math.max(lo, -50);
      if (!(hi > lo + 5)) hi = lo + 5;
      const step = niceStep(hi - lo, 6);
      lo = Math.floor(lo / step) * step;
      hi = Math.ceil(hi / step) * step;
      const bw = (hi - lo) / TIME_BINS;
      const hist = GROUPS.map(() => new Float64Array(TIME_BINS));
      const total = GROUPS.map(() => 0);
      const inRange = GROUPS.map(() => 0);
      const under = GROUPS.map(() => 0);
      for (let i = 0; i < d.n; i++) {
        const rr = d.rPerp[i]!;
        if (!(rr >= rLo && rr < rHi)) continue;
        const dl = d.delay[i]!;
        if (!Number.isFinite(dl)) continue;
        const o = i * GND_STRIDE;
        const grp = GROUP_OF_CLASS[g[o + GND.CLASS]!] ?? 3;
        const w = g[o + GND.W]!;
        total[grp]! += w;
        const b = Math.floor((dl - lo) / bw);
        if (b < 0) under[grp]! += w;
        else if (b < TIME_BINS) { hist[grp]![b]! += w; inRange[grp]! += w; }
      }
      const median = GROUPS.map((_, gi) => {
        const tot = total[gi]!;
        if (!(tot > 0)) return NaN;
        let acc = under[gi]!;
        const hh = hist[gi]!;
        for (let b = 0; b < TIME_BINS; b++) {
          if (acc + hh[b]! >= tot / 2) return lo + (b + (tot / 2 - acc) / Math.max(hh[b]!, 1e-30)) * bw;
          acc += hh[b]!;
        }
        return hi;
      });
      th = { lo, hi, bw, hist, total, inRange, median };
      if (!total.some((t) => t > 0)) th = null;
    }
    this.timingCache = { key, th };
    return th;
  }
}

// ------------------------------------------------------------------ helpers

function derive(r: ShowerResult): Derived {
  const st = r.stats;
  const n = Math.max(0, Math.min(r.groundCount, Math.floor(r.ground.length / GND_STRIDE)));
  let [ax, ay, az] = st.axis;
  const len = Math.hypot(ax, ay, az);
  if (!(len > 0)) { ax = 0; ay = 0; az = -1; } else { ax /= len; ay /= len; az /= len; }
  const cosT = Math.max(0.05, Math.abs(az));
  const cx = r.params.coreX;
  const cy = r.params.coreY;
  const zg = r.params.groundAltitudeM;
  const tCore = Number.isFinite(st.tCore) ? st.tCore : 0;
  const rPerp = new Float32Array(n);
  const delay = new Float32Array(n);
  const latW = GROUPS.map(() => new Float64Array(LAT_KMAX));
  const latW2 = GROUPS.map(() => new Float64Array(LAT_KMAX));
  const g = r.ground;
  for (let i = 0; i < n; i++) {
    const o = i * GND_STRIDE;
    const dx = g[o + GND.X]! - cx;
    const dy = g[o + GND.Y]! - cy;
    const along = dx * ax + dy * ay;
    const rr = Math.sqrt(Math.max(0, dx * dx + dy * dy - along * along));
    rPerp[i] = rr;
    delay[i] = g[o + GND.T]! - (tCore + along / C_M_PER_NS);
    const w = g[o + GND.W]!;
    const grp = GROUP_OF_CLASS[g[o + GND.CLASS]!] ?? 3;
    if (rr >= 1) {
      const k = Math.floor(Math.log10(rr) * LAT_PER_DECADE);
      if (k >= 0 && k < LAT_KMAX) {
        latW[grp]![k]! += w;
        latW2[grp]![k]! += w * w;
      }
    }
  }
  const along0 = -cx * ax - cy * ay;
  const rDet = Math.sqrt(Math.max(0, cx * cx + cy * cy - along0 * along0));
  return {
    r, n, cx, cy, ax, ay, az, cosT, zg, rPerp, delay, rDet,
    tPlaneDet: tCore + along0 / C_M_PER_NS,
    latW, latW2, timeOrder: null,
  };
}

let edgesCache: number[] | null = null;
function latEdges(): number[] {
  if (!edgesCache) {
    edgesCache = [];
    for (let k = 0; k <= LAT_KMAX; k++) edgesCache.push(10 ** (k / LAT_PER_DECADE));
  }
  return edgesCache;
}

function radialRange(f: RadialFilter): [number, number] {
  switch (f) {
    case '0-50': return [0, 50];
    case '50-200': return [50, 200];
    case '200-1000': return [200, 1000];
    case '1000+': return [1000, Infinity];
    default: return [0, Infinity];
  }
}

/** Half-width that frames the bulk of the particles and the detector. */
function autoExtent(d: Derived): number {
  const want = Math.max(150, Math.hypot(d.cx, d.cy) * 1.3);
  for (const L of [50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000]) if (L >= want) return L;
  return 10000;
}

let lutCache: Uint8Array | null = null;
/** Night-ember colour map: deep indigo -> violet -> rose -> amber -> pale gold. */
function colormap(): Uint8Array {
  if (lutCache) return lutCache;
  const stops: [number, number, number, number][] = [
    [0.0, 20, 22, 62],
    [0.2, 48, 36, 120],
    [0.4, 110, 52, 156],
    [0.6, 196, 70, 140],
    [0.78, 250, 124, 84],
    [0.9, 255, 190, 92],
    [1.0, 255, 246, 210],
  ];
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const f = i / 255;
    let k = 0;
    while (k < stops.length - 2 && f > stops[k + 1]![0]) k++;
    const [f0, r0, g0, b0] = stops[k]!;
    const [f1, r1, g1, b1] = stops[k + 1]!;
    const t = (f - f0) / (f1 - f0);
    lut[i * 3] = Math.round(r0 + (r1 - r0) * t);
    lut[i * 3 + 1] = Math.round(g0 + (g1 - g0) * t);
    lut[i * 3 + 2] = Math.round(b0 + (b1 - b0) * t);
  }
  lutCache = lut;
  return lut;
}

function fmtDensity(v: number): string {
  if (!(v > 0)) return '0';
  if (v >= 1 && v < 1e4) return v.toPrecision(3);
  const e = Math.floor(Math.log10(v));
  return `${(v / 10 ** e).toFixed(1)}e${e}`;
}

function select(label: string, opts: [string, string][], value: string, on: (v: string) => void): HTMLElement {
  const sel = h('select', { class: 'cx-select cx-select--sm', 'aria-label': label });
  for (const [v, t] of opts) sel.append(h('option', { value: v, text: t }));
  sel.value = value;
  sel.addEventListener('change', () => on(sel.value));
  return sel;
}
