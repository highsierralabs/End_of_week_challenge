// A drum in play: its tuning, its strikes (sent to the audio bank), its slowed-down picture of
// the vibration, and its Chladni response to a steady drive.

import { buildRaster, cellAt, sampleCell, type Raster } from '../render/raster';
import type { DrumData } from './worker';

export interface Tuning {
  /** Membrane wave speed sqrt(tension / surface density), m/s. Sets the pitch. */
  speed: number;
  /** Decay time of the low modes, s. */
  sustain: number;
  /** Mallet corner frequency, Hz: soft felt ~250, bare stick ~4000. */
  mallet: number;
}

export const DEFAULT_TUNING: Tuning = { speed: 100, sustain: 1.6, mallet: 900 };

/** Seconds of on-screen motion per second of real vibration, as a fraction: the fundamental shows at about 0.8 Hz. */
const VIS_FUNDAMENTAL_HZ = 0.8;
/** On-screen frequencies are capped at this multiple of the fundamental so fast modes do not alias at 60 frames/s. */
const VIS_MAX_RATIO = 9;
/**
 * Plates: the Pitch slider's wave speed c (m/s) becomes sqrt(D / rho_s) = c * PLATE_LENGTH (m^2/s). With the
 * default c this puts a 66 cm plate near 200 Hz: a notional thick metal plate rather than a measured one.
 */
export const PLATE_LENGTH = 0.255;
const VIS_SUSTAIN_STRETCH = 2.2;

export class LiveDrum {
  readonly data: DrumData;
  readonly raster: Raster;
  freqs = new Float32Array(0);
  decays = new Float32Array(0);
  /** Visual state per mode (complex). */
  readonly vr: Float32Array;
  readonly vi: Float32Array;
  /** Displacement per vertex for the renderer. */
  readonly u: Float32Array;
  /** Peak visual amplitude after the latest strike, for colour scaling. */
  energy = 0;
  private visW = new Float32Array(0);
  private visR = new Float32Array(0);
  private scale: number;

  constructor(data: DrumData, tuning: Tuning) {
    this.data = data;
    this.raster = buildRaster(data.xy, data.tri, 256);
    this.vr = new Float32Array(data.count);
    this.vi = new Float32Array(data.count);
    this.u = new Float32Array(data.nv);
    this.scale = Math.sqrt(data.area);
    this.retune(tuning);
  }

  retune(t: Tuning): void {
    const n = this.data.count;
    this.freqs = new Float32Array(n);
    this.decays = new Float32Array(n);
    this.visW = new Float32Array(n);
    this.visR = new Float32Array(n);
    const plate = this.data.material === 'plate';
    for (let k = 0; k < n; k++) {
      // Membrane: omega = c sqrt(lambda). Plate: omega = sqrt(D / rho_s) sqrt(lambda), lambda in 1/m^4.
      const f = ((plate ? t.speed * PLATE_LENGTH : t.speed) * Math.sqrt(this.data.lambda[k]!)) / (2 * Math.PI);
      this.freqs[k] = f;
      // Air and internal losses grow with frequency; metal rings far longer than skin.
      this.decays[k] = plate ? (2.5 * t.sustain) / (1 + f / 1500) : t.sustain / (1 + f / 450);
    }
    const f1 = this.freqs[0]!;
    for (let k = 0; k < n; k++) {
      this.visW[k] = 2 * Math.PI * VIS_FUNDAMENTAL_HZ * Math.min(VIS_MAX_RATIO, this.freqs[k]! / f1);
      this.visR[k] = 1 / (this.decays[k]! * VIS_SUSTAIN_STRETCH);
    }
  }

  get fundamental(): number { return this.freqs[0] ?? 0; }

  inside(x: number, y: number): boolean { return cellAt(this.raster, x, y) >= 0; }

  /** Mode shape values at a point (mass-normalised, times sqrt(area) so they are O(1)). */
  shapesAt(x: number, y: number): Float32Array | null {
    const c = cellAt(this.raster, x, y);
    if (c < 0) return null;
    const out = new Float32Array(this.data.count);
    for (let k = 0; k < this.data.count; k++) out[k] = sampleCell(this.raster, c, this.data.shape, k * this.data.nv) * this.scale;
    return out;
  }

  /** Amplitudes of a strike at (x, y): mode shape there times the mallet's spectrum. */
  strikeAmps(x: number, y: number, velocity: number, t: Tuning): Float32Array | null {
    const phi = this.shapesAt(x, y);
    if (!phi) return null;
    for (let k = 0; k < phi.length; k++) {
      const h = 1 / Math.sqrt(1 + (this.freqs[k]! / t.mallet) ** 2);
      phi[k] = phi[k]! * h * velocity;
    }
    return phi;
  }

  /**
   * Add a strike to the picture. A strike sets each mode's velocity; its displacement is that over
   * the mode's angular frequency, so the picture weights mode k by f1 / fk.
   */
  kick(amps: Float32Array): void {
    let e = 0;
    const f1 = this.freqs[0]!;
    for (let k = 0; k < amps.length; k++) {
      const a = amps[k]! * (f1 / this.freqs[k]!);
      this.vr[k] = this.vr[k]! + a;
      e += Math.abs(a);
    }
    this.energy = Math.max(this.energy * 0.5, e);
  }

  /** Advance the slowed-down picture by dt seconds and compute the displacement per vertex. */
  step(dt: number): number {
    const n = this.data.count, nv = this.data.nv;
    const u = this.u;
    u.fill(0);
    let live = 0;
    for (let k = 0; k < n; k++) {
      let xr = this.vr[k]!, xi = this.vi[k]!;
      if (xr * xr + xi * xi < 1e-8) { this.vr[k] = 0; this.vi[k] = 0; continue; }
      const r = Math.exp(-this.visR[k]! * dt), a = this.visW[k]! * dt;
      const c = r * Math.cos(a), s = r * Math.sin(a);
      const nr = xr * c - xi * s;
      xi = xr * s + xi * c;
      xr = nr;
      this.vr[k] = xr; this.vi[k] = xi;
      live += Math.abs(xr) + Math.abs(xi);
      const g = xi * this.scale;
      const o = k * nv;
      const sh = this.data.shape;
      for (let v = 0; v < nv; v++) u[v] = u[v]! + g * sh[o + v]!;
    }
    this.energy *= Math.exp(-dt / 6);
    return live;
  }

  /** Show one mode, still: its shape at unit amplitude. */
  showMode(k: number): void {
    const nv = this.data.nv;
    for (let v = 0; v < nv; v++) this.u[v] = this.data.shape[k * nv + v]! * this.scale;
  }

  clear(): void { this.vr.fill(0); this.vi.fill(0); this.u.fill(0); }

  /**
   * Steady response to a drive of frequency f at (x, y): |sum_k phi_k(x0) phi_k(v) / (w_k^2 - w^2 + i g w w_k)|,
   * per vertex, normalised so its maximum is 1. Also returns the response at the drive point.
   */
  chladni(f: number, x: number, y: number, out: Float32Array): number {
    const phi0 = this.shapesAt(x, y);
    const nv = this.data.nv, n = this.data.count;
    out.fill(0);
    if (!phi0) return 0;
    const re = new Float32Array(nv), im = new Float32Array(nv);
    const w2 = f * f;
    const g = 0.012; // loss factor of the plate in the sand demo
    let dRe = 0, dIm = 0;
    for (let k = 0; k < n; k++) {
      const fk = this.freqs[k]!;
      const dr = fk * fk - w2, di = g * f * fk;
      const den = dr * dr + di * di;
      const cr = (phi0[k]! * dr) / den, ci = (-phi0[k]! * di) / den;
      dRe += phi0[k]! * cr; dIm += phi0[k]! * ci;
      const o = k * nv;
      const sh = this.data.shape;
      for (let v = 0; v < nv; v++) { const s = sh[o + v]! * this.scale; re[v] = re[v]! + cr * s; im[v] = im[v]! + ci * s; }
    }
    let mx = 0;
    for (let v = 0; v < nv; v++) { const a = Math.hypot(re[v]!, im[v]!); out[v] = a; if (a > mx) mx = a; }
    if (mx > 0) for (let v = 0; v < nv; v++) out[v] = out[v]! / mx;
    // Drive-point receptance, made dimensionless by the fundamental.
    return Math.hypot(dRe, dIm) * this.freqs[0]! ** 2;
  }
}
