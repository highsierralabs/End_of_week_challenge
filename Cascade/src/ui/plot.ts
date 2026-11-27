// Small canvas-2D plotting kit: devicePixelRatio-aware surface, linear/log axes,
// crisp hairlines, tick labels with real superscripts.

export const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", Consolas, "Roboto Mono", "Liberation Mono", monospace';
export const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const INK = {
  text: '#c9d3e3',
  muted: '#8794a8',
  faint: '#5b6678',
  grid: 'rgba(150, 175, 215, 0.10)',
  gridMajor: 'rgba(150, 175, 215, 0.18)',
  axis: 'rgba(170, 190, 225, 0.45)',
  plotBg: 'rgba(4, 7, 14, 0.35)',
};

export interface Rect { x: number; y: number; w: number; h: number }

export class Surface {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D unavailable');
    this.ctx = ctx;
  }

  /** Size the backing store to css size x DPR; returns false when there is nothing to draw on. */
  fit(cssW: number, cssH: number): boolean {
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const w = Math.max(0, Math.floor(cssW));
    const hh = Math.max(0, Math.floor(cssH));
    const bw = Math.round(w * dpr);
    const bh = Math.round(hh * dpr);
    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;
    this.w = w;
    this.h = hh;
    this.dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, w, hh);
    return w > 20 && hh > 20;
  }

  /** Snap a CSS coordinate to the centre of a device pixel (for 1-device-pixel lines). */
  crisp(v: number): number {
    return (Math.floor(v * this.dpr) + 0.5) / this.dpr;
  }

  get hair(): number {
    return 1 / this.dpr;
  }
}

export class Axis {
  constructor(
    public min: number,
    public max: number,
    public log: boolean,
    public p0: number,
    public p1: number,
  ) {
    if (log) {
      this.min = Math.max(this.min, 1e-300);
      this.max = Math.max(this.max, this.min * 10);
    } else if (!(this.max > this.min)) {
      this.max = this.min + 1;
    }
  }

  map(v: number): number {
    if (this.log) {
      const lv = Math.log10(Math.max(v, 1e-300));
      const a = Math.log10(this.min);
      const b = Math.log10(this.max);
      return this.p0 + ((lv - a) / (b - a)) * (this.p1 - this.p0);
    }
    return this.p0 + ((v - this.min) / (this.max - this.min)) * (this.p1 - this.p0);
  }

  inv(p: number): number {
    const f = (p - this.p0) / (this.p1 - this.p0);
    if (this.log) {
      const a = Math.log10(this.min);
      const b = Math.log10(this.max);
      return 10 ** (a + f * (b - a));
    }
    return this.min + f * (this.max - this.min);
  }

  contains(v: number): boolean {
    return v >= Math.min(this.min, this.max) && v <= Math.max(this.min, this.max);
  }
}

export function niceStep(range: number, target: number): number {
  const raw = range / Math.max(1, target);
  const e = Math.floor(Math.log10(raw));
  const f = raw / 10 ** e;
  const n = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return n * 10 ** e;
}

export function linearTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min];
  const step = niceStep(max - min, target);
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function logTicks(min: number, max: number): { major: number[]; minor: number[] } {
  const a = Math.ceil(Math.log10(min) - 1e-9);
  const b = Math.floor(Math.log10(max) + 1e-9);
  const decades = b - a;
  const every = decades > 9 ? 3 : decades > 6 ? 2 : 1;
  const major: number[] = [];
  for (let k = a; k <= b; k++) if ((k - a) % every === 0) major.push(10 ** k);
  const minor: number[] = [];
  if (decades <= 6) {
    for (let k = a - 1; k <= b; k++) for (let m = 2; m <= 9; m++) {
      const v = m * 10 ** k;
      if (v >= min && v <= max) minor.push(v);
    }
  }
  return { major, minor };
}

export function decadeFloor(v: number): number {
  return 10 ** Math.floor(Math.log10(v));
}
export function decadeCeil(v: number): number {
  return 10 ** Math.ceil(Math.log10(v));
}

export type TickFormat = 'pow10' | 'plain' | ((v: number) => string);

export function formatTick(v: number, fmt: TickFormat, decimals?: number): string {
  if (typeof fmt === 'function') return fmt(v);
  if (fmt === 'plain') {
    if (v === 0) return '0';
    if (decimals !== undefined) return v.toFixed(decimals).replace('-', '−');
    const a = Math.abs(v);
    if (a >= 1e4 || a < 1e-3) return v.toExponential(0);
    return String(Number(v.toPrecision(6))).replace('-', '−');
  }
  return '';
}

/** Draw "10^k" with a proper superscript, anchored by textAlign-like `align` at (x, y = baseline). */
export function drawPow10(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, align: 'left' | 'right' | 'center', size: number): void {
  const base = '10';
  const exp = String(k).replace('-', '−');
  ctx.save();
  ctx.font = `${size}px ${MONO}`;
  const wb = ctx.measureText(base).width;
  ctx.font = `${Math.round(size * 0.78)}px ${MONO}`;
  const we = ctx.measureText(exp).width;
  const total = wb + we + 0.5;
  let x0 = x;
  if (align === 'right') x0 = x - total;
  else if (align === 'center') x0 = x - total / 2;
  ctx.textAlign = 'left';
  ctx.font = `${size}px ${MONO}`;
  ctx.fillText(base, x0, y);
  ctx.font = `${Math.round(size * 0.78)}px ${MONO}`;
  ctx.fillText(exp, x0 + wb + 0.5, y - size * 0.42);
  ctx.restore();
}

export interface AxesSpec {
  frame: Rect;
  x: Axis;
  y: Axis;
  xLabel: string;
  yLabel: string;
  xFmt?: TickFormat;
  yFmt?: TickFormat;
  xTicks?: number[];
  yTicks?: number[];
  grid?: boolean;
}

/** Frame, grid, ticks and labels. Call before the data so the grid sits underneath. */
export function drawAxes(s: Surface, a: AxesSpec): void {
  const { ctx } = s;
  const f = a.frame;
  ctx.save();
  ctx.fillStyle = INK.plotBg;
  ctx.fillRect(f.x, f.y, f.w, f.h);

  const xFmt = a.xFmt ?? (a.x.log ? 'pow10' : 'plain');
  const yFmt = a.yFmt ?? (a.y.log ? 'pow10' : 'plain');
  const xt = a.xTicks ?? (a.x.log ? logTicks(a.x.min, a.x.max).major : linearTicks(a.x.min, a.x.max, Math.max(3, Math.round(f.w / 70))));
  const yt = a.yTicks ?? (a.y.log ? logTicks(a.y.min, a.y.max).major : linearTicks(a.y.min, a.y.max, Math.max(3, Math.round(f.h / 45))));
  const stepDec = (t: number[]): number | undefined =>
    t.length > 1 ? Math.max(0, Math.min(6, Math.ceil(-Math.log10(Math.abs(t[1]! - t[0]!)) - 1e-9))) : undefined;
  const xDec = a.x.log ? undefined : stepDec(xt);
  const yDec = a.y.log ? undefined : stepDec(yt);
  const xMinor = a.x.log && !a.xTicks ? logTicks(a.x.min, a.x.max).minor : [];
  const yMinor = a.y.log && !a.yTicks ? logTicks(a.y.min, a.y.max).minor : [];

  ctx.lineWidth = s.hair;
  if (a.grid !== false) {
    ctx.strokeStyle = INK.grid;
    ctx.beginPath();
    for (const v of xMinor) { const px = s.crisp(a.x.map(v)); ctx.moveTo(px, f.y); ctx.lineTo(px, f.y + f.h); }
    for (const v of yMinor) { const py = s.crisp(a.y.map(v)); ctx.moveTo(f.x, py); ctx.lineTo(f.x + f.w, py); }
    ctx.stroke();
    ctx.strokeStyle = INK.gridMajor;
    ctx.beginPath();
    for (const v of xt) { const px = s.crisp(a.x.map(v)); if (px < f.x - 0.5 || px > f.x + f.w + 0.5) continue; ctx.moveTo(px, f.y); ctx.lineTo(px, f.y + f.h); }
    for (const v of yt) { const py = s.crisp(a.y.map(v)); if (py < f.y - 0.5 || py > f.y + f.h + 0.5) continue; ctx.moveTo(f.x, py); ctx.lineTo(f.x + f.w, py); }
    ctx.stroke();
  }

  // frame
  ctx.strokeStyle = INK.axis;
  ctx.strokeRect(s.crisp(f.x), s.crisp(f.y), Math.round(f.w * s.dpr) / s.dpr, Math.round(f.h * s.dpr) / s.dpr);

  // tick marks
  ctx.beginPath();
  for (const v of xt) { const px = s.crisp(a.x.map(v)); if (px < f.x - 0.5 || px > f.x + f.w + 0.5) continue; ctx.moveTo(px, f.y + f.h); ctx.lineTo(px, f.y + f.h + 4); }
  for (const v of yt) { const py = s.crisp(a.y.map(v)); if (py < f.y - 0.5 || py > f.y + f.h + 0.5) continue; ctx.moveTo(f.x - 4, py); ctx.lineTo(f.x, py); }
  ctx.stroke();

  // labels
  const size = 10.5;
  ctx.fillStyle = INK.muted;
  ctx.font = `${size}px ${MONO}`;
  ctx.textBaseline = 'alphabetic';
  let lastRight = -Infinity;
  for (const v of xt) {
    const px = a.x.map(v);
    if (px < f.x - 0.5 || px > f.x + f.w + 0.5) continue;
    const yb = f.y + f.h + 16;
    if (xFmt === 'pow10') {
      const k = Math.round(Math.log10(v));
      if (px - 12 < lastRight) continue;
      drawPow10(ctx, px, yb, k, 'center', size);
      lastRight = px + 14;
    } else {
      const t = formatTick(v, xFmt, xDec);
      const w = ctx.measureText(t).width;
      if (px - w / 2 < lastRight + 4) continue;
      ctx.textAlign = 'center';
      ctx.fillText(t, px, yb);
      lastRight = px + w / 2;
    }
  }
  let lastTop = Infinity;
  for (const v of yt) {
    const py = a.y.map(v);
    if (py < f.y - 0.5 || py > f.y + f.h + 0.5) continue;
    if (py + 6 > lastTop) continue;
    if (yFmt === 'pow10') drawPow10(ctx, f.x - 7, py + 4, Math.round(Math.log10(v)), 'right', size);
    else {
      ctx.textAlign = 'right';
      ctx.fillText(formatTick(v, yFmt, yDec), f.x - 7, py + 4);
    }
    lastTop = py - 6;
  }

  // axis titles
  ctx.fillStyle = INK.text;
  ctx.font = `11px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.fillText(a.xLabel, f.x + f.w / 2, f.y + f.h + 32);
  ctx.save();
  ctx.translate(f.x - (yFmt === 'pow10' ? 40 : 44), f.y + f.h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(a.yLabel, 0, 0);
  ctx.restore();
  ctx.restore();
}

/** Polyline through (xs[i], ys[i]); non-finite or non-positive-on-log points break the line. */
export function drawSeries(s: Surface, x: Axis, y: Axis, xs: ArrayLike<number>, ys: ArrayLike<number>, style: { color: string; width?: number; dash?: number[]; alpha?: number }): void {
  const { ctx } = s;
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.lineWidth = style.width ?? 1.25;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(style.dash ?? []);
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < xs.length; i++) {
    const xv = xs[i]!;
    const yv = ys[i]!;
    const ok = Number.isFinite(xv) && Number.isFinite(yv) && (!y.log || yv > 0) && (!x.log || xv > 0);
    if (!ok) { pen = false; continue; }
    const px = x.map(xv);
    const py = y.map(Math.max(yv, y.log ? y.min * 0.5 : -Infinity));
    if (pen) ctx.lineTo(px, py);
    else { ctx.moveTo(px, py); pen = true; }
  }
  ctx.stroke();
  ctx.restore();
}

export function clipTo(s: Surface, f: Rect): void {
  s.ctx.beginPath();
  s.ctx.rect(f.x, f.y, f.w, f.h);
  s.ctx.clip();
}

/** Small text with a dark halo, for labels drawn over data. */
export function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, font = `10.5px ${MONO}`, align: CanvasTextAlign = 'left'): void {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(5, 8, 15, 0.85)';
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
