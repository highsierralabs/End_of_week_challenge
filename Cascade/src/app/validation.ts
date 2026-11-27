// Validation page: reads the precomputed ensemble (src/data/validation.json, written by
// scripts/precompute-validation.ts) and compares it with analytic scalings and an approximate
// band of accelerator-tuned full simulations. Nothing is simulated in the browser.
import './validation.css';
import raw from '../data/validation.json';
import {
  greisen, muonNumberMatthews, nmaxRuleOfThumb, xmaxNucleusMatthews, xmaxPhoton, xmaxProtonMatthews,
} from '../physics/analytic';
import { RClass } from '../physics/types';
import { CLASS_COLORS, NEUTRAL_CSS } from '../ui/colors';
import { sci, superscript } from '../ui/format';
import { Axis, INK, MONO, SANS, Surface, clipTo, decadeCeil, decadeFloor, drawAxes, drawSeries, haloText, type Rect } from '../ui/plot';

// ------------------------------------------------------------------ data contract

interface Summary { n: number; mean: number; rms: number; median: number; sem: number }
interface Shower {
  seed: number; x1: number; xmax: number | null; nmax: number | null; ghX0: number | null; ghLambda: number | null;
  nMu: number; nE: number; nG: number; cpuMs: number;
}
interface Cell {
  primary: Prim; lgE: number; thinning: number; n: number; ghFailures: number; cpuS: number;
  stats: { x1: Summary | null; xmax: Summary | null; nmax: Summary | null; nMu: Summary | null; nE: Summary | null };
  showers: Shower[];
}
interface CheckEntry {
  primary: Prim; lgE: number; thinning: number; n: number; cpuSPerShower: number;
  xmax: Summary | null; nmax: Summary | null; nMu: Summary | null; nE: Summary | null; meanGhLambda: number | null;
}
interface Doc {
  generated: string; date: string; totalCpuS: number; machine: string; seedRule: string;
  commonParams: { zenithDeg: number; emCutMeV: number; muonCutMeV: number; hadronCutGeV: number; groundAltitudeM: number; trackEm: boolean };
  notes: string[];
  cells: Cell[];
  thinningCheck: CheckEntry[];
}
type Prim = 'proton' | 'iron' | 'gamma';

const doc = raw as unknown as Doc;

// ------------------------------------------------------------------ references

type Marker = 'circle' | 'square' | 'diamond';
interface PrimStyle { label: string; sym: string; color: string; marker: Marker; A: number; dx: number }
const PRIM: Record<Prim, PrimStyle> = {
  proton: { label: 'proton', sym: 'p', color: CLASS_COLORS[RClass.ELECTRON]!.css, marker: 'circle', A: 1, dx: -0.05 },
  gamma: { label: 'gamma ray', sym: 'γ', color: CLASS_COLORS[RClass.GAMMA]!.css, marker: 'diamond', A: 0, dx: 0 },
  iron: { label: 'iron', sym: 'Fe', color: CLASS_COLORS[RClass.HADRON]!.css, marker: 'square', A: 56, dx: 0.05 },
};
const ORDER: Prim[] = ['proton', 'iron', 'gamma'];

/**
 * Mean Xmax (g/cm^2) of CORSIKA with EPOS-LHC / QGSJet-II-04 / Sibyll 2.3, approximate values
 * digitised from published reviews (Kampert & Unger 2012; Pierre Auger Xmax papers). Orientation only.
 */
const BAND: Partial<Record<Prim, [number, number, number][]>> = {
  proton: [[14, 455, 500], [15, 540, 575], [16, 600, 640], [17, 660, 690], [18, 715, 755]],
  iron: [[14, 380, 420], [15, 440, 470], [16, 515, 545], [17, 580, 610], [18, 640, 670]],
};
/** Typical full-simulation sigma(Xmax), g/cm^2. */
const RMS_REF: Partial<Record<Prim, [number, number]>> = { proton: [60, 70], iron: [20, 25] };
const MU_SLOPE_REF: [number, number] = [0.85, 0.93];
const GROUND_DEPTH = 861;
const LG_MIN = 12.72;
const LG_MAX = 18.32;

const gev = (lgE: number): number => 10 ** (lgE - 9);
const bandAt = (p: Prim, lgE: number): [number, number] | null => {
  const b = BAND[p]?.find((r) => r[0] === lgE);
  return b ? [b[1], b[2]] : null;
};
const hmXmax = (p: Prim, lgE: number): number =>
  p === 'gamma' ? xmaxPhoton(gev(lgE)) : p === 'proton' ? xmaxProtonMatthews(gev(lgE)) : xmaxNucleusMatthews(gev(lgE), PRIM[p].A);
const nmaxRef = (p: Prim, lgE: number): number =>
  p === 'gamma' ? greisen(gev(lgE), xmaxPhoton(gev(lgE))) : nmaxRuleOfThumb(gev(lgE));
const muRef = (p: Prim, lgE: number): number => muonNumberMatthews(gev(lgE), PRIM[p].A);

const cellsOf = (p: Prim): Cell[] => doc.cells.filter((c) => c.primary === p).sort((a, b) => a.lgE - b.lgE);

// ------------------------------------------------------------------ small maths

interface Fit { slope: number; intercept: number; slopeErr: number; chi2: number; ndf: number }

/** Weighted least-squares line; the slope error is scaled up by sqrt(chi2/ndf) when that exceeds 1. */
function wfit(xs: number[], ys: number[], sig: number[]): Fit | null {
  if (xs.length < 2) return null;
  let S = 0, Sx = 0, Sy = 0, Sxx = 0, Sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const w = 1 / Math.max(sig[i]!, 1e-9) ** 2;
    S += w; Sx += w * xs[i]!; Sy += w * ys[i]!; Sxx += w * xs[i]! ** 2; Sxy += w * xs[i]! * ys[i]!;
  }
  const D = S * Sxx - Sx * Sx;
  if (!(D > 0)) return null;
  const slope = (S * Sxy - Sx * Sy) / D;
  const intercept = (Sxx * Sy - Sx * Sxy) / D;
  let chi2 = 0;
  for (let i = 0; i < xs.length; i++) chi2 += ((ys[i]! - intercept - slope * xs[i]!) / Math.max(sig[i]!, 1e-9)) ** 2;
  const ndf = xs.length - 2;
  const scale = ndf > 0 ? Math.max(1, Math.sqrt(chi2 / ndf)) : 1;
  return { slope, intercept, slopeErr: Math.sqrt(S / D) * scale, chi2, ndf };
}

type Status = 'ok' | 'near' | 'bad' | 'info';
function rangeStatus(v: number, err: number, lo: number, hi: number): { status: Status; off: number } {
  if (v >= lo && v <= hi) return { status: 'ok', off: 0 };
  const off = v < lo ? v - lo : v - hi;
  return { status: Math.abs(off) <= 2 * err ? 'near' : 'bad', off };
}
const worst = (s: Status[]): Status => (s.includes('bad') ? 'bad' : s.includes('near') ? 'near' : 'ok');

// ------------------------------------------------------------------ formatting

const MINUS = '−';
const fx = (v: number, d = 0): string => (Number.isFinite(v) ? v.toFixed(d).replace('-', MINUS) : '—');
const signed = (v: number, d = 0): string => (v > 0 ? '+' : v < 0 ? MINUS : '±') + Math.abs(v).toFixed(d);
const eLabel = (lgE: number): string => `10${superscript(lgE)}`;
const sci3 = (v: number): string => sci(v, 3);
const STATUS_TEXT: Record<Status, string> = { ok: 'inside', near: 'near', bad: 'outside', info: 'reference' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ------------------------------------------------------------------ canvas marks

function drawMarker(ctx: CanvasRenderingContext2D, shape: Marker, x: number, y: number, r: number, color: string): void {
  ctx.save();
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (shape === 'square') { const a = r * 0.9; ctx.rect(x - a, y - a, 2 * a, 2 * a); }
  else { const a = r * 1.25; ctx.moveTo(x, y - a); ctx.lineTo(x + a, y); ctx.lineTo(x, y + a); ctx.lineTo(x - a, y); ctx.closePath(); }
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(6, 9, 16, 0.95)';
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Vertical error bar: a thin whisker (spread) and an optional thick inner bar (standard error). */
function errorBar(ctx: CanvasRenderingContext2D, x: number, yLo: number, yHi: number, color: string, inner?: [number, number]): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(x, yLo); ctx.lineTo(x, yHi);
  ctx.moveTo(x - 3.5, yLo); ctx.lineTo(x + 3.5, yLo);
  ctx.moveTo(x - 3.5, yHi); ctx.lineTo(x + 3.5, yHi);
  ctx.stroke();
  if (inner) {
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x, inner[0]); ctx.lineTo(x, inner[1]);
    ctx.stroke();
  }
  ctx.restore();
}

function fillBand(s: Surface, x: Axis, y: Axis, pts: [number, number, number][], color: string): void {
  const { ctx } = s;
  ctx.save();
  ctx.beginPath();
  pts.forEach(([lg, lo], i) => { const px = x.map(10 ** lg), py = y.map(lo); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
  for (let i = pts.length - 1; i >= 0; i--) { const [lg, , hi] = pts[i]!; ctx.lineTo(x.map(10 ** lg), y.map(hi)); }
  ctx.closePath();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = color;
  ctx.fill();
  // Diagonal hatching so the band reads as "reference", not data, without colour alone.
  ctx.clip();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -s.h; k < s.w + s.h; k += 7) { ctx.moveTo(k, 0); ctx.lineTo(k + s.h, s.h); }
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  pts.forEach(([lg, lo], i) => { const px = x.map(10 ** lg), py = y.map(lo); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
  pts.forEach(([lg, , hi], i) => { const px = x.map(10 ** lg), py = y.map(hi); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
  ctx.stroke();
  ctx.restore();
}

/** Sample f over the energy range for drawSeries. */
function curve(f: (lgE: number) => number, lo = LG_MIN, hi = LG_MAX): [number[], number[]] {
  const xs: number[] = [], ys: number[] = [];
  for (let lg = lo; lg <= hi + 1e-9; lg += 0.05) { xs.push(10 ** lg); ys.push(f(lg)); }
  return [xs, ys];
}

// ------------------------------------------------------------------ chart shell

interface Hit { x: number; y: number; html: string }
type DrawFn = (s: Surface) => Hit[];

function mountChart(fig: HTMLElement, label: string, draw: DrawFn): void {
  const host = fig.querySelector<HTMLElement>('[data-plot]')!;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  const tip = el('div', 'vx-tip');
  tip.hidden = true;
  host.append(canvas, tip);
  const s = new Surface(canvas);
  let hits: Hit[] = [];
  const render = (): void => {
    const r = host.getBoundingClientRect();
    if (!s.fit(r.width, r.height)) return;
    hits = draw(s);
  };
  new ResizeObserver(render).observe(host);
  render();
  const show = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    let best: Hit | null = null, bd = 18 * 18;
    for (const h of hits) { const d = (h.x - px) ** 2 + (h.y - py) ** 2; if (d < bd) { bd = d; best = h; } }
    if (!best) { tip.hidden = true; return; }
    tip.innerHTML = best.html;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = best.x + 14;
    if (left + tw > r.width - 4) left = best.x - 14 - tw;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.min(Math.max(4, best.y - th / 2), r.height - th - 4)}px`;
  };
  canvas.addEventListener('pointermove', show);
  canvas.addEventListener('pointerdown', show);
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; });
}

/** Plot frame inside the surface, with room for the axis labels. */
function frameOf(s: Surface, top = 10, bottom = 42): Rect {
  const left = 60;
  const right = 12;
  return { x: left, y: top, w: s.w - left - right, h: s.h - top - bottom };
}
const xAxisFor = (f: Rect): Axis => new Axis(10 ** LG_MIN, 10 ** LG_MAX, true, f.x, f.x + f.w);
const X_LABEL = 'primary energy E (eV)';

function tipHead(p: Prim, c: Cell): string {
  return `<b>${PRIM[p].label}, ${eLabel(c.lgE)} eV</b><div class="vx-tip-row">N = ${c.n} showers, ε = ${sci(c.thinning, 1)}</div>`;
}
const row = (t: string): string => `<div class="vx-tip-row">${t}</div>`;

// ------------------------------------------------------------------ legends

type KeyKind = { marker: Marker; color: string } | { line: string; dash: number[]; width?: number } | { band: string } | { box: string };

function keySwatch(k: KeyKind, w = 26, h = 14): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  c.width = w * dpr; c.height = h * dpr;
  c.style.width = `${w}px`; c.style.height = `${h}px`;
  const ctx = c.getContext('2d')!;
  ctx.scale(dpr, dpr);
  if ('marker' in k) {
    ctx.strokeStyle = k.color; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.25;
    ctx.beginPath(); ctx.moveTo(w / 2, 1); ctx.lineTo(w / 2, h - 1); ctx.stroke(); ctx.globalAlpha = 1;
    drawMarker(ctx, k.marker, w / 2, h / 2, 4.2, k.color);
  } else if ('line' in k) {
    ctx.strokeStyle = k.line; ctx.lineWidth = k.width ?? 1.5; ctx.setLineDash(k.dash);
    ctx.beginPath(); ctx.moveTo(1, h / 2); ctx.lineTo(w - 1, h / 2); ctx.stroke();
  } else if ('band' in k) {
    ctx.fillStyle = k.band; ctx.globalAlpha = 0.22; ctx.fillRect(1, 2, w - 2, h - 4);
    ctx.globalAlpha = 0.5; ctx.strokeStyle = k.band; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -h; x < w; x += 5) { ctx.moveTo(x, h - 2); ctx.lineTo(x + h - 4, 2); }
    ctx.save(); ctx.rect(1, 2, w - 2, h - 4); ctx.clip(); ctx.stroke(); ctx.restore();
    ctx.strokeRect(1.5, 2.5, w - 3, h - 5);
  } else {
    ctx.fillStyle = k.box; ctx.fillRect(w / 2 - 1.75, 1, 3.5, h - 2);
  }
  return c;
}

function legend(fig: HTMLElement, items: [KeyKind, string][]): void {
  const box = fig.querySelector<HTMLElement>('[data-legend]');
  if (!box) return;
  for (const [k, label] of items) {
    const item = el('span', 'vx-key');
    item.append(keySwatch(k), el('span', undefined, label));
    box.append(item);
  }
}
const primaryKeys = (ps: Prim[]): [KeyKind, string][] => ps.map((p) => [{ marker: PRIM[p].marker, color: PRIM[p].color }, `${PRIM[p].label} (Cascade)`]);

// ------------------------------------------------------------------ derived numbers

const elong = (p: Prim): Fit | null => {
  const cs = cellsOf(p).filter((c) => c.lgE >= 14 && c.stats.xmax);
  return wfit(cs.map((c) => c.lgE), cs.map((c) => c.stats.xmax!.mean), cs.map((c) => c.stats.xmax!.sem));
};
const bandElong = (p: Prim): number => {
  const b = BAND[p]!;
  const f = wfit(b.map((r) => r[0]), b.map((r) => (r[1] + r[2]) / 2), b.map(() => 1))!;
  return f.slope;
};
const muFit = (p: Prim, minLg = 0): Fit | null => {
  const cs = cellsOf(p).filter((c) => c.lgE >= minLg && c.stats.nMu && c.stats.nMu.mean > 0);
  return wfit(
    cs.map((c) => Math.log(gev(c.lgE))),
    cs.map((c) => Math.log(c.stats.nMu!.mean)),
    cs.map((c) => Math.max(0.005, c.stats.nMu!.sem / c.stats.nMu!.mean)),
  );
};
const muRange = (p: Prim): string => {
  const cs = cellsOf(p).filter((c) => c.stats.nMu && c.stats.nMu.mean > 0);
  return cs.length ? `${eLabel(cs[0]!.lgE)}–${eLabel(cs[cs.length - 1]!.lgE)} eV` : '—';
};

// ------------------------------------------------------------------ figure 1: mean Xmax

function figXmax(): void {
  const fig = document.getElementById('fig-xmax')!;
  legend(fig, [
    ...primaryKeys(ORDER),
    [{ band: NEUTRAL_CSS }, 'accelerator-tuned models (approx.)'],
    [{ line: NEUTRAL_CSS, dash: [6, 4] }, 'Heitler–Matthews'],
    [{ line: INK.muted, dash: [2, 3] }, 'ground (vertical)'],
  ]);
  let lo = Infinity, hi = -Infinity;
  for (const c of doc.cells) if (c.stats.xmax) { lo = Math.min(lo, c.stats.xmax.mean - c.stats.xmax.rms); hi = Math.max(hi, c.stats.xmax.mean + c.stats.xmax.rms); }
  for (const p of ORDER) lo = Math.min(lo, hmXmax(p, 13.2) - 25);
  hi = Math.max(hi, GROUND_DEPTH + 20);
  lo = Math.floor(lo / 50) * 50; hi = Math.ceil(hi / 50) * 50;

  mountChart(fig, 'Mean Xmax against primary energy for proton, iron and gamma, with Heitler-Matthews lines and the model band', (s) => {
    const f = frameOf(s);
    const x = xAxisFor(f);
    const y = new Axis(lo, hi, false, f.y + f.h, f.y);
    drawAxes(s, { frame: f, x, y, xLabel: X_LABEL, yLabel: 'mean Xmax (g/cm²)' });
    const { ctx } = s;
    ctx.save();
    clipTo(s, f);
    for (const p of ['proton', 'iron'] as Prim[]) fillBand(s, x, y, BAND[p]!, PRIM[p].color);
    drawSeries(s, x, y, [10 ** LG_MIN, 10 ** LG_MAX], [GROUND_DEPTH, GROUND_DEPTH], { color: INK.muted, dash: [2, 3], width: 1 });
    for (const p of ORDER) {
      const [xs, ys] = curve((lg) => hmXmax(p, lg));
      drawSeries(s, x, y, xs, ys, { color: PRIM[p].color, dash: [6, 4], width: 1.25, alpha: 0.75 });
    }
    haloText(ctx, 'ground, 861 g/cm²', f.x + 8, y.map(GROUND_DEPTH) - 6, INK.muted);
    // Band labels just under each band's lower edge, between the two bands, clear of the data points.
    const bandLbl = (p: Prim): void => {
      const lg = 15.15;
      const b = BAND[p]!;
      const i = b.findIndex((r) => r[0] > lg);
      const [l0, lo0] = b[i - 1]!, [l1, lo1] = b[i]!;
      const loAt = lo0 + ((lg - l0) / (l1 - l0)) * (lo1 - lo0);
      haloText(ctx, `${PRIM[p].sym} models (approx.)`, x.map(10 ** lg), y.map(loAt) + 14, INK.text, `10.5px ${SANS}`, 'left');
    };
    // On a phone the bands are identified by colour + the legend; in-plot labels would sit on the data.
    if (f.w >= 520) { bandLbl('proton'); bandLbl('iron'); }
    // H-M labels at the low-energy end, between the 1e13 and 1e14 points, where the lines are well separated.
    for (const p of ORDER) {
      const lg = 13.5;
      const v = hmXmax(p, lg);
      haloText(ctx, `H–M ${PRIM[p].sym}`, x.map(10 ** lg), y.map(v) + (p === 'gamma' ? -8 : 15), INK.muted, `10px ${MONO}`, 'center');
    }
    const hits: Hit[] = [];
    for (const p of ORDER) {
      const cs = cellsOf(p).filter((c) => c.stats.xmax);
      drawSeries(s, x, y, cs.map((c) => 10 ** (c.lgE + PRIM[p].dx)), cs.map((c) => c.stats.xmax!.mean), { color: PRIM[p].color, width: 1, alpha: 0.45 });
      for (const c of cs) {
        const st = c.stats.xmax!;
        const px = x.map(10 ** (c.lgE + PRIM[p].dx));
        errorBar(ctx, px, y.map(st.mean - st.rms), y.map(st.mean + st.rms), PRIM[p].color, [y.map(st.mean - st.sem), y.map(st.mean + st.sem)]);
      }
      for (const c of cs) {
        const st = c.stats.xmax!;
        const px = x.map(10 ** (c.lgE + PRIM[p].dx)), py = y.map(st.mean);
        drawMarker(ctx, PRIM[p].marker, px, py, 4.5, PRIM[p].color);
        const band = bandAt(p, c.lgE);
        const bandTxt = band ? (() => {
          const r = rangeStatus(st.mean, st.sem, band[0], band[1]);
          return row(`model band ${band[0]}–${band[1]}: ${STATUS_TEXT[r.status]}${r.off ? ` (${signed(r.off)})` : ''}`);
        })() : '';
        hits.push({
          x: px, y: py,
          html: tipHead(p, c) + row(`⟨Xmax⟩ ${fx(st.mean, 1)} ± ${fx(st.sem, 1)} g/cm²`) + row(`σ ${fx(st.rms, 1)}, median ${fx(st.median, 1)}`) +
            row(`H–M ${fx(hmXmax(p, c.lgE))}`) + bandTxt,
        });
      }
    }
    ctx.restore();
    return hits;
  });

  const text = fig.querySelector<HTMLElement>('[data-text]')!;
  const parts: string[] = [];
  for (const p of ['proton', 'iron'] as Prim[]) {
    const e = elong(p);
    if (e) parts.push(`${PRIM[p].label} <span class="vx-num">${fx(e.slope, 0)} ± ${fx(e.slopeErr, 0)}</span>`);
  }
  text.innerHTML =
    `<p>Markers are ensemble means; the thick bar is the standard error of the mean and the thin whisker the shower-to-shower ` +
    `spread (±σ). Points are nudged sideways by ±0.05 decade so they do not overlap. The hatched bands are the range of mean ` +
    `X<sub>max</sub> in CORSIKA with EPOS-LHC, QGSJet-II-04 and Sibyll 2.3: <b>approximate, digitised from published reviews; ` +
    `for orientation only.</b></p>` +
    `<p>Elongation rate (fit of mean X<sub>max</sub> against log<sub>10</sub>E over 10<sup>14</sup>–10<sup>18</sup> eV, g/cm² per decade): ` +
    `${parts.join(', ')}; the band midlines give <span class="vx-num">${fx(bandElong('proton'))}</span> (p) and ` +
    `<span class="vx-num">${fx(bandElong('iron'))}</span> (Fe). Heitler–Matthews in its simple form is 58 per decade for both ` +
    `and sits well below the full simulations in absolute depth: it is a scaling, not a prediction.</p>`;
}

// ------------------------------------------------------------------ figure 2: sigma(Xmax)

function figRms(): void {
  const fig = document.getElementById('fig-rms')!;
  legend(fig, [
    ...primaryKeys(ORDER),
    [{ band: PRIM.proton.color }, 'full sims, p: 60–70'],
    [{ band: PRIM.iron.color }, 'full sims, Fe: 20–25'],
  ]);
  let hi = 100;
  for (const c of doc.cells) if (c.stats.xmax) hi = Math.max(hi, c.stats.xmax.rms * (1 + 1.6 / Math.sqrt(2 * (c.n - 1))));
  hi = Math.ceil(hi / 20) * 20;
  mountChart(fig, 'Standard deviation of Xmax against energy', (s) => {
    const f = frameOf(s);
    const x = xAxisFor(f);
    const y = new Axis(0, hi, false, f.y + f.h, f.y);
    drawAxes(s, { frame: f, x, y, xLabel: X_LABEL, yLabel: 'σ(Xmax) (g/cm²)' });
    const { ctx } = s;
    ctx.save();
    clipTo(s, f);
    for (const p of ['proton', 'iron'] as Prim[]) {
      const [a, b] = RMS_REF[p]!;
      fillBand(s, x, y, [[14, a, b], [18, a, b]], PRIM[p].color);
    }
    const hits: Hit[] = [];
    for (const p of ORDER) {
      const cs = cellsOf(p).filter((c) => c.stats.xmax && c.n > 1);
      drawSeries(s, x, y, cs.map((c) => 10 ** (c.lgE + PRIM[p].dx)), cs.map((c) => c.stats.xmax!.rms), { color: PRIM[p].color, width: 1, alpha: 0.45 });
      for (const c of cs) {
        const st = c.stats.xmax!;
        const err = st.rms / Math.sqrt(2 * (c.n - 1));
        const px = x.map(10 ** (c.lgE + PRIM[p].dx)), py = y.map(st.rms);
        errorBar(ctx, px, y.map(st.rms - err), y.map(st.rms + err), PRIM[p].color);
        drawMarker(ctx, PRIM[p].marker, px, py, 4.5, PRIM[p].color);
        const ref = RMS_REF[p];
        hits.push({
          x: px, y: py,
          html: tipHead(p, c) + row(`σ(Xmax) ${fx(st.rms, 1)} ± ${fx(err, 1)} g/cm²`) + (ref ? row(`full sims ~${ref[0]}–${ref[1]}`) : ''),
        });
      }
    }
    ctx.restore();
    return hits;
  });
  const avg = (p: Prim): string => {
    const cs = cellsOf(p).filter((c) => c.lgE >= 14 && c.stats.xmax);
    const v = cs.map((c) => c.stats.xmax!.rms);
    return v.length ? `${fx(Math.min(...v))}–${fx(Math.max(...v))}` : '—';
  };
  fig.querySelector<HTMLElement>('[data-text]')!.innerHTML =
    `<p>Error bars are the statistical error of a standard deviation, σ/√(2(N−1)), about 15–20 per cent for these ensembles. ` +
    `Reference values: about 60–70 g/cm² for protons and 20–25 g/cm² for iron in full simulations at these energies ` +
    `(approximate, same sources as the band). Cascade over 10<sup>14</sup>–10<sup>18</sup> eV: proton ` +
    `<span class="vx-num">${avg('proton')}</span>, iron <span class="vx-num">${avg('iron')}</span>, gamma ` +
    `<span class="vx-num">${avg('gamma')}</span> g/cm².</p>` +
    `<p class="vx-small">The Gaisser–Hillas fit to a thinned profile adds its own scatter, which inflates these widths somewhat ` +
    `(not separately measured here). One deep proton shower can move a 12-shower σ by 20 g/cm² or more.</p>`;
}

// ------------------------------------------------------------------ two-panel log plot with a ratio strip

interface RatioPlot {
  yLabel: string;
  prims: Prim[];
  value: (c: Cell) => Summary | null;
  ref: (p: Prim, lgE: number) => number;
  refCurves: { f: (lg: number) => number; color: string; dash: number[]; label?: string; at?: number; below?: boolean }[];
  fits?: Partial<Record<Prim, Fit | null>>;
  tip: (p: Prim, c: Cell, v: Summary, ref: number) => string;
}

function ratioChart(fig: HTMLElement, label: string, cfg: RatioPlot): void {
  let lo = Infinity, hi = -Infinity, rlo = 0.8, rhi = 1.2;
  for (const p of cfg.prims) for (const c of cellsOf(p)) {
    const v = cfg.value(c);
    if (!v || !(v.mean > 0)) continue;
    lo = Math.min(lo, Math.max(v.mean - v.rms, v.mean / 3)); hi = Math.max(hi, v.mean + v.rms);
    const r = v.mean / cfg.ref(p, c.lgE);
    rlo = Math.min(rlo, r - 2 * v.sem / cfg.ref(p, c.lgE)); rhi = Math.max(rhi, r + 2 * v.sem / cfg.ref(p, c.lgE));
  }
  for (const rc of cfg.refCurves) for (const lg of [LG_MIN, LG_MAX]) { const v = rc.f(lg); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  lo = decadeFloor(lo); hi = decadeCeil(hi);
  rlo = Math.max(0, Math.floor(rlo * 10) / 10); rhi = Math.ceil(rhi * 10) / 10;

  mountChart(fig, label, (s) => {
    const full = frameOf(s);
    const gap = 24;
    const hTop = Math.round((full.h - gap) * 0.64);
    const fTop: Rect = { x: full.x, y: full.y, w: full.w, h: hTop };
    const fBot: Rect = { x: full.x, y: full.y + hTop + gap, w: full.w, h: full.h - hTop - gap };
    const x = xAxisFor(fTop);
    const y = new Axis(lo, hi, true, fTop.y + fTop.h, fTop.y);
    const yr = new Axis(rlo, rhi, false, fBot.y + fBot.h, fBot.y);
    drawAxes(s, { frame: fTop, x, y, xLabel: '', yLabel: cfg.yLabel, xFmt: () => '' });
    drawAxes(s, { frame: fBot, x, y: yr, xLabel: X_LABEL, yLabel: 'ratio' });
    const { ctx } = s;
    const hits: Hit[] = [];
    // top panel
    ctx.save();
    clipTo(s, fTop);
    for (const rc of cfg.refCurves) {
      const [xs, ys] = curve(rc.f);
      drawSeries(s, x, y, xs, ys, { color: rc.color, dash: rc.dash, width: 1.25, alpha: 0.85 });
      if (rc.label) {
        const at = rc.at ?? 17.4;
        const px = x.map(10 ** at), py = y.map(rc.f(at));
        haloText(ctx, rc.label, px, py + (rc.below ? 15 : -8), INK.text, `10.5px ${SANS}`, 'center');
      }
    }
    for (const p of cfg.prims) {
      const fit = cfg.fits?.[p];
      if (fit) {
        const [xs, ys] = curve((lg) => Math.exp(fit.intercept + fit.slope * Math.log(gev(lg))), 12.9, 18.2);
        drawSeries(s, x, y, xs, ys, { color: PRIM[p].color, width: 1, alpha: 0.55 });
      }
      for (const c of cellsOf(p)) {
        const v = cfg.value(c);
        if (!v || !(v.mean > 0)) continue;
        const px = x.map(10 ** (c.lgE + PRIM[p].dx)), py = y.map(v.mean);
        errorBar(ctx, px, y.map(Math.max(v.mean - v.rms, lo)), y.map(v.mean + v.rms), PRIM[p].color);
        drawMarker(ctx, PRIM[p].marker, px, py, 4.5, PRIM[p].color);
        hits.push({ x: px, y: py, html: cfg.tip(p, c, v, cfg.ref(p, c.lgE)) });
      }
    }
    ctx.restore();
    // ratio strip
    ctx.save();
    clipTo(s, fBot);
    drawSeries(s, x, yr, [10 ** LG_MIN, 10 ** LG_MAX], [1, 1], { color: NEUTRAL_CSS, width: 1, alpha: 0.6 });
    for (const p of cfg.prims) {
      const pts = cellsOf(p).map((c) => ({ c, v: cfg.value(c) })).filter((q) => q.v && q.v.mean > 0);
      drawSeries(s, x, yr, pts.map((q) => 10 ** (q.c.lgE + PRIM[p].dx)), pts.map((q) => q.v!.mean / cfg.ref(p, q.c.lgE)), { color: PRIM[p].color, width: 1, alpha: 0.45 });
      for (const { c, v } of pts) {
        const ref = cfg.ref(p, c.lgE);
        const r = v!.mean / ref, e = v!.sem / ref;
        const px = x.map(10 ** (c.lgE + PRIM[p].dx)), py = yr.map(r);
        errorBar(ctx, px, yr.map(r - e), yr.map(r + e), PRIM[p].color);
        drawMarker(ctx, PRIM[p].marker, px, py, 3.8, PRIM[p].color);
        hits.push({ x: px, y: py, html: cfg.tip(p, c, v!, ref) });
      }
    }
    ctx.restore();
    return hits;
  });
}

// ------------------------------------------------------------------ figure 3: Nmax

function figNmax(): void {
  const fig = document.getElementById('fig-nmax')!;
  legend(fig, [
    ...primaryKeys(ORDER),
    [{ line: NEUTRAL_CSS, dash: [6, 4] }, 'Greisen (γ)'],
    [{ line: NEUTRAL_CSS, dash: [1.5, 3], width: 1.75 }, 'E/1.4 GeV (hadrons)'],
  ]);
  ratioChart(fig, 'Shower size at maximum against energy, with Greisen and the E over 1.4 GeV rule', {
    yLabel: 'Nmax (charged)',
    prims: ORDER,
    value: (c) => c.stats.nmax,
    ref: nmaxRef,
    refCurves: [
      { f: (lg) => greisen(gev(lg), xmaxPhoton(gev(lg))), color: NEUTRAL_CSS, dash: [6, 4], label: 'Greisen', at: 15.5, below: false },
      { f: (lg) => nmaxRuleOfThumb(gev(lg)), color: NEUTRAL_CSS, dash: [1.5, 3], label: 'E / 1.4 GeV', at: 15.5, below: true },
    ],
    tip: (p, c, v, ref) => tipHead(p, c) + row(`⟨Nmax⟩ ${sci3(v.mean)} ± ${sci(v.sem, 2)}`) +
      row(`${p === 'gamma' ? 'Greisen' : 'E/1.4 GeV'} ${sci3(ref)}`) + row(`ratio ${fx(v.mean / ref, 3)} ± ${fx(v.sem / ref, 3)}`),
  });
  const rat = (p: Prim): string => {
    const r = cellsOf(p).filter((c) => c.stats.nmax).map((c) => c.stats.nmax!.mean / nmaxRef(p, c.lgE));
    return r.length ? `${fx(Math.min(...r), 2)}–${fx(Math.max(...r), 2)}` : '—';
  };
  fig.querySelector<HTMLElement>('[data-text]')!.innerHTML =
    `<p>N<sub>max</sub> is the Gaisser–Hillas maximum of the weighted charged profile (e<sup>±</sup> above 1 MeV kinetic, ` +
    `muons, charged hadrons). The strip below shows the ratio to the reference with the standard error. Gamma against ` +
    `Greisen at the Heitler depth: <span class="vx-num">${rat('gamma')}</span>. Hadrons against the E/1.4 GeV rule of thumb: ` +
    `proton <span class="vx-num">${rat('proton')}</span>, iron <span class="vx-num">${rat('iron')}</span>.</p>` +
    `<p class="vx-small">Greisen's formula (Approximation B) counts all electrons with no threshold; the 1 MeV cut here removes ` +
    `some, so a ratio a little below 1 is expected. E/1.4 GeV is a rough rule of thumb, not a model; the hadronic sizes fall ` +
    `below it, most at low energy and for iron.</p>`;
}

// ------------------------------------------------------------------ figure 4: ground muons

function figMuons(): void {
  const fig = document.getElementById('fig-mu')!;
  const prims: Prim[] = ['proton', 'iron'];
  const fits: Partial<Record<Prim, Fit | null>> = { proton: muFit('proton'), iron: muFit('iron') };
  legend(fig, [
    ...primaryKeys(prims),
    [{ line: CLASS_COLORS[RClass.ELECTRON]!.css, dash: [6, 4] }, 'Matthews p'],
    [{ line: CLASS_COLORS[RClass.HADRON]!.css, dash: [6, 4] }, 'Matthews Fe (×56⁰·¹⁵)'],
    [{ line: INK.text, dash: [] , width: 1 }, 'power-law fit'],
  ]);
  ratioChart(fig, 'Ground muon number against energy for proton and iron, with the Matthews scaling', {
    yLabel: 'Nμ at ground',
    prims,
    value: (c) => c.stats.nMu,
    ref: muRef,
    refCurves: [
      { f: (lg) => muonNumberMatthews(gev(lg), 1), color: PRIM.proton.color, dash: [6, 4] },
      { f: (lg) => muonNumberMatthews(gev(lg), 56), color: PRIM.iron.color, dash: [6, 4] },
    ],
    fits,
    tip: (p, c, v, ref) => tipHead(p, c) + row(`⟨Nμ⟩ ${sci3(v.mean)} ± ${sci(v.sem, 2)}`) + row(`Matthews ${sci3(ref)}`) +
      row(`ratio ${fx(v.mean / ref, 3)}`) + (c.stats.nE ? row(`⟨Ne±⟩ ground ${sci3(c.stats.nE.mean)}`) : ''),
  });
  const g = cellsOf('gamma');
  const gMu = g.map((c) => c.stats.nMu?.mean ?? 0);
  const gammaNote = gMu.every((v) => v === 0)
    ? 'Gamma-ray showers have no ground muons at all here, at every energy, because photonuclear production is not modelled; they are left off the plot.'
    : `Gamma-ray showers carry ${gMu.map((v) => sci(v, 2)).join(', ')} ground muons (left off the plot).`;
  const slope = (p: Prim): string => {
    const f = fits[p];
    return f ? `<span class="vx-num">${fx(f.slope, 3)} ± ${fx(f.slopeErr, 3)}</span>` : '—';
  };
  const slope14 = (p: Prim): string => {
    const f = muFit(p, 14);
    return f ? `<span class="vx-num">${fx(f.slope, 3)} ± ${fx(f.slopeErr, 3)}</span>` : '—';
  };
  const feP = cellsOf('iron').flatMap((c) => {
    const pc = cellsOf('proton').find((q) => q.lgE === c.lgE);
    return pc && pc.stats.nMu && c.stats.nMu ? [{ lgE: c.lgE, r: c.stats.nMu.mean / pc.stats.nMu.mean }] : [];
  });
  const fePText = feP.length ? feP.map((q) => `<span class="vx-num">${fx(q.r, 2)}</span> (${eLabel(q.lgE)})`).join(', ') : '—';
  fig.querySelector<HTMLElement>('[data-text]')!.innerHTML =
    `<p>Weighted muon count reaching the 1539 m ground (861 g/cm²) above a 10 MeV kinetic cut, against Matthews' ` +
    `N<sub>μ</sub> = A<sup>0.15</sup>(E/20 GeV)<sup>0.85</sup>. <b>Matthews is a scaling reference with uncertain normalisation</b>: ` +
    `it counts muons at production, ignores decay and energy loss, and depends on the 20 GeV pion critical energy; the ratio ` +
    `strip shows the shape, not a pass/fail.</p>` +
    `<p>Fitted slope d ln N<sub>μ</sub>/d ln E over ${muRange('proton')}: proton ${slope('proton')}, iron ${slope('iron')} ` +
    `(Matthews 0.85; full simulations 0.85–0.93). Over 10<sup>14</sup>–10<sup>18</sup> eV alone: proton ${slope14('proton')}, ` +
    `iron ${slope14('iron')}.</p>` +
    `<p>Iron/proton muon ratio at equal energy: ${fePText}, against a constant ` +
    `56<sup>0.15</sup> = ${fx(56 ** 0.15, 2)} from Matthews' superposition.</p>` +
    `<p class="vx-small">${gammaNote} Slope errors are from a weighted fit, inflated by √(χ²/ndf) where that exceeds 1.</p>`;
}

// ------------------------------------------------------------------ thinning check

function thinningCheck(): void {
  const box = document.getElementById('vx-thin')!;
  const rows = [...doc.thinningCheck].sort((a, b) => b.thinning - a.thinning);
  if (!rows.length) { box.hidden = true; return; }
  const ref = rows[rows.length - 1]!;
  const pull = (a: Summary | null, b: Summary | null): number =>
    a && b ? (a.mean - b.mean) / Math.hypot(a.sem, b.sem) : NaN;
  const pulls = rows.slice(0, -1).flatMap((r) => [pull(r.xmax, ref.xmax), pull(r.nmax, ref.nmax), pull(r.nMu, ref.nMu), pull(r.nE, ref.nE)]);
  const maxPull = Math.max(...pulls.filter(Number.isFinite).map(Math.abs));
  /** Ratio to the finest level with the error of the ratio (both samples independent). */
  const rel = (a: Summary | null, b: Summary | null): string => {
    if (!a || !b || !(b.mean > 0)) return '—';
    const r = a.mean / b.mean;
    const e = r * Math.hypot(a.sem / a.mean, b.sem / b.mean);
    return a === b ? '1 (ref.)' : `${fx(r, 2)} ± ${fx(e, 2)}`;
  };
  const t = el('table', 'vx-table');
  t.innerHTML =
    `<thead><tr><th>ε</th><th>⟨Xmax⟩<small>g/cm² ± s.e.</small></th><th>σ<small>Xmax</small></th>` +
    `<th>Nmax<small>÷ finest</small></th><th>Nμ<small>÷ finest</small></th><th>Ne±<small>÷ finest</small></th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${sci(r.thinning, 1)}</td><td>${r.xmax ? `${fx(r.xmax.mean, 1)} ± ${fx(r.xmax.sem, 1)}` : '—'}</td>` +
      `<td>${r.xmax ? fx(r.xmax.rms, 1) : '—'}</td><td>${rel(r.nmax, ref.nmax)}</td><td>${rel(r.nMu, ref.nMu)}</td><td>${rel(r.nE, ref.nE)}</td>` +
      `</tr>`).join('') + '</tbody>';
  // Largest relative size difference of a coarser level from the finest (Nmax, Nmu, Ne).
  let maxRel = 0;
  for (const r of rows.slice(0, -1)) for (const k of ['nmax', 'nMu', 'nE'] as const) {
    const a = r[k], b = ref[k];
    if (a && b && b.mean > 0) maxRel = Math.max(maxRel, Math.abs(a.mean / b.mean - 1));
  }
  box.querySelector<HTMLElement>('[data-table]')!.append(t);
  box.querySelector<HTMLElement>('[data-text]')!.innerHTML =
    `<p>${ref.n} ${PRIM[ref.primary].label} showers at ${eLabel(ref.lgE)} eV with the same seeds at ${rows.length} thinning levels ` +
    `ε (the random streams part at the first thinning decision, so these are statistically independent samples, not the same ` +
    `showers). If thinning were biased, the means would drift with ε. The largest difference from the finest level is ` +
    `<span class="vx-num">${fx(maxPull, 1)}σ</span> (combined standard errors) across X<sub>max</sub>, N<sub>max</sub>, ` +
    `N<sub>μ</sub> and N<sub>e±</sub>${maxPull < 2 ? ': no bias is significant at this precision' : ': a drift larger than the statistics, worth a closer look'}.</p>` +
    `<p>Read it with care: the coarser levels give sizes up to <span class="vx-num">${fx(maxRel * 100, 0)}%</span> ` +
    `${rows.slice(0, -1).every((r) => r.nmax && ref.nmax && r.nmax.mean > ref.nmax.mean) ? 'larger, all in the same direction' : 'different'}. ` +
    `N<sub>max</sub>, N<sub>μ</sub> and N<sub>e±</sub> of one shower are strongly correlated, so these are not independent hints, ` +
    `but 12 showers cannot exclude a thinning bias of that size.</p>` +
    `<p class="vx-small">CPU per shower: ${rows.map((r) => `${fx(r.cpuSPerShower, 1)} s at ε = ${sci(r.thinning, 1)}`).join(', ')}. ` +
    `One energy and one primary only.</p>`;
}

// ------------------------------------------------------------------ scorecard

function scorecard(): void {
  const host = document.getElementById('vx-score')!;
  const card = (title: string, status: Status, value: string, ref: string): void => {
    const c = el('div', 'vx-card');
    const top = el('div', 'vx-card-top');
    top.append(el('span', 'vx-card-title', title), el('span', `vx-status vx-status--${status}`, STATUS_TEXT[status]));
    c.append(top, el('div', 'vx-card-value', value), el('div', 'vx-card-ref', ref));
    host.append(c);
  };
  for (const p of ['proton', 'iron'] as Prim[]) {
    const res = cellsOf(p).flatMap((c) => {
      const b = bandAt(p, c.lgE);
      return b && c.stats.xmax ? [{ lgE: c.lgE, ...rangeStatus(c.stats.xmax.mean, c.stats.xmax.sem, b[0], b[1]) }] : [];
    });
    const inside = res.filter((r) => r.status === 'ok').length;
    const misses = res.filter((r) => r.status !== 'ok').map((r) => `${eLabel(r.lgE)}: ${signed(r.off)}`);
    card(`${PRIM[p].label} mean Xmax vs model band`, worst(res.map((r) => r.status)), `${inside} / ${res.length} inside`,
      misses.length ? `Off the band edge by (g/cm²) ${misses.join(', ')}` : 'Inside the band at every energy from 10¹⁴ to 10¹⁸ eV');
  }
  for (const p of ['proton', 'iron'] as Prim[]) {
    const e = elong(p);
    if (!e) continue;
    // Reference range: slopes of the band's lower edge, midline and upper edge, 1e14-1e18 eV.
    const B = BAND[p]!;
    const edge = (k: 1 | 2): number => wfit(B.map((r) => r[0]), B.map((r) => r[k]), B.map(() => 1))!.slope;
    const refs = [edge(1), bandElong(p), edge(2)];
    const lo = Math.min(...refs), hi = Math.max(...refs);
    const r = rangeStatus(e.slope, e.slopeErr, lo, hi);
    card(`${PRIM[p].label} elongation rate, 10¹⁴–10¹⁸ eV`, r.status, `${fx(e.slope)} ± ${fx(e.slopeErr)} g/cm²/decade`,
      `Model band edges give ${fx(lo)}–${fx(hi)}${r.off ? `; off by ${signed(r.off)} (${fx(Math.abs(r.off) / e.slopeErr, 1)}σ)` : ''}`);
  }
  for (const p of ['proton', 'iron'] as Prim[]) {
    const [a, b] = RMS_REF[p]!;
    const res = cellsOf(p).filter((c) => c.lgE >= 14 && c.stats.xmax && c.n > 1).map((c) => {
      const st = c.stats.xmax!;
      return { lgE: c.lgE, v: st.rms, ...rangeStatus(st.rms, st.rms / Math.sqrt(2 * (c.n - 1)), a, b) };
    });
    const v = res.map((r) => r.v);
    const inside = res.filter((r) => r.status === 'ok').length;
    card(`${PRIM[p].label} σ(Xmax)`, worst(res.map((r) => r.status)), `${fx(Math.min(...v))}–${fx(Math.max(...v))} g/cm²`,
      `Full sims ~${a}–${b}; ${inside} / ${res.length} energies inside, the rest ${res.every((r) => r.status !== 'bad') ? 'within 2σ' : 'partly outside 2σ'}`);
  }
  {
    const r = cellsOf('gamma').filter((c) => c.stats.nmax).map((c) => c.stats.nmax!.mean / nmaxRef('gamma', c.lgE));
    const w = r.reduce((a, v) => (Math.abs(v - 1) > Math.abs(a - 1) ? v : a), 1);
    const dev = Math.abs(w - 1);
    card('gamma Nmax vs Greisen', dev <= 0.2 ? 'ok' : dev <= 0.3 ? 'near' : 'bad', `ratio ${fx(Math.min(...r), 2)}–${fx(Math.max(...r), 2)}`,
      `Tolerance ±20% (cut and approximation differences); worst ${signed((w - 1) * 100)}%`);
  }
  {
    const r = (['proton', 'iron'] as Prim[]).flatMap((p) => cellsOf(p).filter((c) => c.stats.nmax).map((c) => c.stats.nmax!.mean / nmaxRef(p, c.lgE)));
    card('hadron Nmax vs E/1.4 GeV', 'info', `ratio ${fx(Math.min(...r), 2)}–${fx(Math.max(...r), 2)}`, 'Rough rule of thumb, not a model; not scored. Lowest for iron at low energy');
  }
  for (const p of ['proton', 'iron'] as Prim[]) {
    const f = muFit(p);
    if (!f) continue;
    const r = rangeStatus(f.slope, f.slopeErr, MU_SLOPE_REF[0], MU_SLOPE_REF[1]);
    card(`${PRIM[p].label} muon slope d ln Nμ / d ln E`, r.status, `${fx(f.slope, 3)} ± ${fx(f.slopeErr, 3)}`,
      `Reference 0.85 (Matthews) to 0.93 (full sims); ${muRange(p)}, ground, 10 MeV cut`);
  }
  {
    const r = doc.thinningCheck;
    if (r.length > 1) {
      const sorted = [...r].sort((a, b) => a.thinning - b.thinning);
      const ref = sorted[0]!;
      let mx = 0;
      for (const q of sorted.slice(1)) for (const k of ['xmax', 'nmax', 'nMu', 'nE'] as const) {
        const a = q[k], b = ref[k];
        if (a && b) mx = Math.max(mx, Math.abs(a.mean - b.mean) / Math.hypot(a.sem, b.sem));
      }
      card('thinning bias (1 PeV proton)', mx < 2 ? 'ok' : mx < 3 ? 'near' : 'bad', `max ${fx(mx, 1)}σ drift`,
        `ε from ${sci(sorted.at(-1)!.thinning, 1)} to ${sci(ref.thinning, 1)}, ${ref.n} showers each`);
    }
  }
}

// ------------------------------------------------------------------ table

function primChip(p: Prim): string {
  return `<span class="vx-prim" data-prim="${p}"></span>`;
}

function bigTable(): void {
  const host = document.getElementById('vx-table')!;
  const t = el('table', 'vx-table');
  const head = ['Primary', 'E<small>eV</small>', 'N', 'ε<small>thinning</small>', '⟨X₁⟩<small>g/cm²</small>', '⟨Xmax⟩<small>± s.e.</small>',
    'σ(Xmax)', 'median<small>Xmax</small>', 'model band<small>approx.</small>', 'H–M<small>Xmax</small>', '⟨Nmax⟩', 'ref Nmax<small>Greisen / E÷1.4 GeV</small>',
    'ratio', '⟨Nμ⟩<small>ground</small>', 'Matthews<small>Nμ</small>', '⟨Ne±⟩<small>ground</small>', 's / shower', 'GH fails'];
  let body = '';
  for (const p of ORDER) {
    cellsOf(p).forEach((c, i) => {
      const x = c.stats.xmax, nm = c.stats.nmax, mu = c.stats.nMu, ne = c.stats.nE, x1 = c.stats.x1;
      const b = bandAt(p, c.lgE);
      const bs = b && x ? rangeStatus(x.mean, x.sem, b[0], b[1]).status : null;
      const ref = nmaxRef(p, c.lgE);
      const cpu = c.showers.reduce((a, s) => a + s.cpuMs, 0) / Math.max(1, c.showers.length) / 1000;
      body += `<tr${i === 0 ? ' class="vx-group-start"' : ''}>` +
        `<td>${i === 0 ? primChip(p) : `<span class="vx-prim" data-prim="${p}" data-quiet></span>`}</td>` +
        `<td>${eLabel(c.lgE)}</td><td>${c.n}</td><td>${sci(c.thinning, 1)}</td>` +
        `<td>${x1 ? fx(x1.mean, 0) : '—'}</td>` +
        `<td>${x ? `${fx(x.mean, 1)} ± ${fx(x.sem, 1)}` : '—'}</td><td>${x ? fx(x.rms, 1) : '—'}</td><td>${x ? fx(x.median, 1) : '—'}</td>` +
        `<td class="${bs ? `vx-flag-${bs}` : 'vx-muted'}">${b ? `${b[0]}–${b[1]}${bs && bs !== 'ok' ? ` (${STATUS_TEXT[bs]})` : ''}` : '—'}</td>` +
        `<td class="vx-muted">${fx(hmXmax(p, c.lgE), 0)}</td>` +
        `<td>${nm ? sci3(nm.mean) : '—'}</td><td class="vx-muted">${sci3(ref)}</td><td>${nm ? fx(nm.mean / ref, 2) : '—'}</td>` +
        `<td>${mu ? (mu.mean > 0 ? sci3(mu.mean) : '0') : '—'}</td><td class="vx-muted">${p === 'gamma' ? '—' : sci3(muRef(p, c.lgE))}</td>` +
        `<td>${ne ? sci3(ne.mean) : '—'}</td><td>${fx(cpu, 2)}</td><td>${c.ghFailures}</td></tr>`;
    });
  }
  t.innerHTML = `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody>`;
  host.append(t);
  for (const chip of t.querySelectorAll<HTMLElement>('[data-prim]')) {
    const p = chip.dataset.prim as Prim;
    const sw = keySwatch({ marker: PRIM[p].marker, color: PRIM[p].color }, 12, 12);
    chip.append(sw);
    if (!('quiet' in chip.dataset)) chip.append(PRIM[p].label);
  }
}

// ------------------------------------------------------------------ meta

function meta(): void {
  const showers = doc.cells.reduce((a, c) => a + c.n, 0) + doc.thinningCheck.reduce((a, c) => a + c.n, 0);
  document.getElementById('vx-meta')!.textContent =
    `${showers} showers · ${doc.cells.length} primary × energy cells · ${fx(doc.totalCpuS / 60, 1)} CPU minutes · ${doc.generated}, ${doc.date}`;
  const cp = doc.commonParams;
  const eps = [...new Set(doc.cells.map((c) => `${eLabel(c.lgE)} eV: ${sci(c.thinning, 1)}`))].join(', ');
  document.getElementById('vx-method')!.innerHTML =
    `<b>Ensemble</b>: zenith ${cp.zenithDeg}°, core at the detector, ground ${cp.groundAltitudeM} m; cuts ${cp.emCutMeV} MeV (e<sup>±</sup> kinetic, photons), ` +
    `${cp.muonCutMeV} MeV (muon kinetic), ${cp.hadronCutGeV} GeV (hadron kinetic). Hillas thinning ε by energy: ${eps}. ` +
    `Seeds: <code>${doc.seedRule}</code>. Total CPU ${fx(doc.totalCpuS / 60, 1)} min; ${doc.machine}.`;
}

meta();
scorecard();
figXmax();
figRms();
figNmax();
figMuons();
thinningCheck();
bigTable();
