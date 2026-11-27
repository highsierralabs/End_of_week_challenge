// The spectrum strip: every mode as a tick on a logarithmic frequency ruler, with octave marks.
// Ticks rise while their mode rings. In sand mode a cursor marks the drive frequency and a thin
// line traces the drive-point response, peaking at each resonance.

import { midiToHz } from '../app/notes';

export interface StripRow {
  freqs: Float32Array;
  /** Current loudness per mode, 0..1. */
  level: Float32Array;
  label?: string;
}

export interface StripState {
  rows: StripRow[];
  lo: number;
  hi: number;
  cursor?: number;
  response?: Float32Array; // samples across [lo, hi], 0..1
  highlight?: number; // mode index
}

const INK = '#1c1916';
const FAINT = 'rgba(28,25,22,0.28)';
const WARM = '#bd3b26';

export class Strip {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  state: StripState | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private pad = 14;

  xOf(f: number): number {
    const s = this.state!;
    return this.pad + ((Math.log(f) - Math.log(s.lo)) / (Math.log(s.hi) - Math.log(s.lo))) * (this.w - 2 * this.pad);
  }

  fOf(x: number): number {
    const s = this.state!;
    const t = (x - this.pad) / (this.w - 2 * this.pad);
    return Math.exp(Math.log(s.lo) + Math.min(1, Math.max(0, t)) * (Math.log(s.hi) - Math.log(s.lo)));
  }

  /** Nearest mode to a screen x in row r, within a few pixels. */
  modeAt(x: number, r = 0, slop = 10): number {
    const row = this.state?.rows[r];
    if (!row) return -1;
    let best = -1, bd = slop;
    for (let k = 0; k < row.freqs.length; k++) {
      const d = Math.abs(this.xOf(row.freqs[k]!) - x);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  rowAt(y: number): number {
    const n = this.state?.rows.length ?? 1;
    return Math.min(n - 1, Math.max(0, Math.floor((y / (this.h - 16)) * n)));
  }

  draw(): void {
    const s = this.state, c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    if (!s) return;
    const axisY = this.h - 16;
    c.font = '11px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'top';
    // Octave marks at each C.
    for (let m = 12; m < 120; m += 12) {
      const f = midiToHz(m);
      if (f < s.lo || f > s.hi) continue;
      const x = this.xOf(f);
      c.fillStyle = FAINT;
      c.fillRect(Math.round(x), 4, 1, axisY - 4);
      c.fillStyle = 'rgba(28,25,22,0.62)';
      c.fillText(`C${m / 12 - 1}`, x, axisY + 3);
    }
    c.fillStyle = INK;
    c.fillRect(this.pad, axisY, this.w - 2 * this.pad, 1);

    // Drive-point response in sand mode.
    if (s.response) {
      c.strokeStyle = 'rgba(35,58,102,0.55)';
      c.lineWidth = 1;
      c.beginPath();
      const n = s.response.length;
      for (let i = 0; i < n; i++) {
        const x = this.pad + (i / (n - 1)) * (this.w - 2 * this.pad);
        const y = axisY - 3 - s.response[i]! * (axisY - 10);
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.stroke();
    }

    const rows = s.rows.length;
    const rowH = (axisY - 4) / rows;
    s.rows.forEach((row, r) => {
      const base = 4 + rowH * (r + 1) - (rows > 1 && r === 0 ? 3 : 0);
      if (row.label) {
        c.textAlign = 'left';
        c.textBaseline = 'bottom';
        c.fillStyle = 'rgba(28,25,22,0.6)';
        c.fillText(row.label, this.pad + 2, base - rowH + 14);
        c.textAlign = 'center';
        c.textBaseline = 'top';
      }
      for (let k = 0; k < row.freqs.length; k++) {
        const f = row.freqs[k]!;
        if (f < s.lo || f > s.hi) continue;
        const x = Math.round(this.xOf(f)) + 0.5;
        const lv = Math.min(1, row.level[k] ?? 0);
        const hgt = rowH * (0.22 + 0.7 * lv);
        c.strokeStyle = k === s.highlight ? WARM : lv > 0.05 ? WARM : INK;
        c.globalAlpha = k === s.highlight ? 1 : 0.55 + 0.45 * lv;
        c.lineWidth = k === 0 ? 2 : 1;
        c.beginPath();
        c.moveTo(x, base);
        c.lineTo(x, base - hgt);
        c.stroke();
      }
      c.globalAlpha = 1;
    });

    if (s.cursor !== undefined) {
      const x = Math.round(this.xOf(s.cursor)) + 0.5;
      c.strokeStyle = WARM;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x, 2);
      c.lineTo(x, axisY);
      c.stroke();
      c.fillStyle = WARM;
      c.beginPath();
      c.moveTo(x - 5, 0); c.lineTo(x + 5, 0); c.lineTo(x, 6); c.closePath();
      c.fill();
    }
  }
}
