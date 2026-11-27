// Chladni sand: grains hop by an amount proportional to how hard the surface under them is
// shaking, so they drain off the moving regions and collect where the membrane stands still
// (the nodal lines). The amplitude field is sampled through the drum's raster grid.

import { cellAt, sampleCell, type Raster } from './raster';

export class Sand {
  readonly pos: Float32Array;
  readonly n: number;
  private seed = 12345;
  private raster: Raster;

  constructor(raster: Raster, n: number) {
    this.raster = raster;
    this.n = n;
    this.pos = new Float32Array(2 * n);
    this.scatter();
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  /** Sprinkle grains uniformly over the drum. */
  scatter(): void {
    const r = this.raster;
    for (let i = 0; i < this.n; i++) {
      for (let tries = 0; tries < 200; tries++) {
        const x = r.x0 + this.rand() * r.size * r.cell, y = r.y0 + this.rand() * r.size * r.cell;
        if (cellAt(r, x, y) >= 0) { this.pos[2 * i] = x; this.pos[2 * i + 1] = y; break; }
      }
    }
  }

  /**
   * One hop. `amp` is the per-vertex amplitude (max 1), `level` the overall drive strength (0..1),
   * `hop` the largest hop in metres.
   */
  step(amp: Float32Array, level: number, hop: number): void {
    const r = this.raster;
    const p = this.pos;
    for (let i = 0; i < this.n; i++) {
      const x = p[2 * i]!, y = p[2 * i + 1]!;
      const c = cellAt(r, x, y);
      if (c < 0) continue;
      const a = sampleCell(r, c, amp) * level;
      // Below a threshold the grain is not thrown at all: it rests.
      if (a < 0.02) continue;
      const s = hop * a;
      // Two uniforms make a cheap rounded kick.
      const dx = (this.rand() + this.rand() - 1) * s, dy = (this.rand() + this.rand() - 1) * s;
      const nx = x + dx, ny = y + dy;
      if (cellAt(r, nx, ny) >= 0) { p[2 * i] = nx; p[2 * i + 1] = ny; }
    }
  }
}
