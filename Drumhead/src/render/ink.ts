// The 2D overlay: rims drawn in ink, the stroke being drawn, strike marks, the sand driver.

import { worldToScreen, type View } from './stage';

export interface Ripple { view: View; x: number; y: number; t0: number; v: number }

const INK = '#1c1916';

export class Ink {
  readonly canvas: HTMLCanvasElement;
  private c: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  ripples: Ripple[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.c = canvas.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w; this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.c.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear(): void { this.c.clearRect(0, 0, this.w, this.h); }

  /** The rim: a doubled ink line, the way a drumhead's hoop reads on a printed plate. */
  rim(view: View, outline: number[], plate: boolean): void {
    const c = this.c;
    const n = outline.length / 2;
    if (n < 3) return;
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const [sx, sy] = worldToScreen(view, outline[2 * i]!, outline[2 * i + 1]!);
      if (i) c.lineTo(sx, sy); else c.moveTo(sx, sy);
    }
    c.closePath();
    c.lineJoin = 'round';
    c.strokeStyle = INK;
    c.lineWidth = plate ? 3.2 : 2.8;
    c.stroke();
  }

  stroke(view: View, pts: number[]): void {
    const c = this.c;
    if (pts.length < 4) return;
    c.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const [sx, sy] = worldToScreen(view, pts[i]!, pts[i + 1]!);
      if (i) c.lineTo(sx, sy); else c.moveTo(sx, sy);
    }
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = INK;
    c.lineWidth = 2.4;
    c.stroke();
    // A faint dashed closing line shows where the loop will be joined.
    const [ax, ay] = worldToScreen(view, pts[0]!, pts[1]!);
    const [bx, by] = worldToScreen(view, pts[pts.length - 2]!, pts[pts.length - 1]!);
    c.setLineDash([4, 5]);
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(bx, by); c.lineTo(ax, ay); c.stroke();
    c.setLineDash([]);
  }

  drawRipples(now: number): void {
    const c = this.c;
    this.ripples = this.ripples.filter((r) => now - r.t0 < 700);
    for (const r of this.ripples) {
      const age = (now - r.t0) / 700;
      const [sx, sy] = worldToScreen(r.view, r.x, r.y);
      c.strokeStyle = `rgba(28,25,22,${(1 - age) * 0.7 * Math.min(1, r.v + 0.3)})`;
      c.lineWidth = 1.2;
      c.beginPath();
      c.arc(sx, sy, 4 + age * 26, 0, Math.PI * 2);
      c.stroke();
    }
  }

  driver(view: View, x: number, y: number): void {
    const c = this.c;
    const [sx, sy] = worldToScreen(view, x, y);
    c.strokeStyle = '#e8dcc0';
    c.lineWidth = 1.5;
    c.beginPath(); c.arc(sx, sy, 7, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(sx - 11, sy); c.lineTo(sx - 4, sy); c.moveTo(sx + 4, sy); c.lineTo(sx + 11, sy);
    c.moveTo(sx, sy - 11); c.lineTo(sx, sy - 4); c.moveTo(sx, sy + 4); c.lineTo(sx, sy + 11); c.stroke();
  }

  /** Small italic caption under a drum. */
  caption(view: View, text: string): void {
    const c = this.c;
    c.font = 'italic 14px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
    c.fillStyle = 'rgba(28,25,22,0.75)';
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.fillText(text, view.rect.x + view.rect.w / 2, view.rect.y + view.rect.h - 18);
  }
}
