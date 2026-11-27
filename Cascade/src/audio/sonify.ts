// Sonification of the replay: every ground arrival becomes a soft click,
// pitched by species (muons high and dry, electrons and photons lower and softer),
// and the shower front's descent is a faint rising hiss. Web Audio only; off by default.
import { GND, GND_STRIDE, RClass, type ShowerResult } from '../physics/types';

const MAX_CLICKS_PER_FRAME = 24;

export class Sonifier {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private hissGain: GainNode | null = null;
  private times = new Float64Array(0);
  private classes = new Uint8Array(0);
  private cursor = 0;
  private lastT = -Infinity;
  private seed = 1;
  enabled = false;

  async enable(): Promise<void> {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // Hiss: filtered noise whose gain follows the descending front.
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = this.rand() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 0.7;
      this.hissGain = this.ctx.createGain();
      this.hissGain.gain.value = 0;
      src.connect(bp).connect(this.hissGain).connect(this.master);
      src.start();
      this.noise = src;
    }
    await this.ctx.resume();
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    if (this.hissGain && this.ctx) this.hissGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    void this.ctx?.suspend();
  }

  /** Index the ground arrivals of a new shower (time-sorted subsample). */
  load(r: ShowerResult): void {
    const n = r.groundCount;
    const stride = Math.max(1, Math.ceil(n / 60000));
    const idx: number[] = [];
    for (let i = 0; i < n; i += stride) idx.push(i);
    idx.sort((a, b) => r.ground[a * GND_STRIDE + GND.T]! - r.ground[b * GND_STRIDE + GND.T]!);
    this.times = new Float64Array(idx.length);
    this.classes = new Uint8Array(idx.length);
    idx.forEach((i, k) => {
      this.times[k] = r.ground[i * GND_STRIDE + GND.T]!;
      this.classes[k] = r.ground[i * GND_STRIDE + GND.CLASS]!;
    });
    this.cursor = 0;
    this.lastT = -Infinity;
  }

  /**
   * Advance to replay time t (ns). frontFrac in [0, 1] is how far the front has descended
   * (drives the hiss); playing is false while paused or scrubbing.
   */
  update(t: number, frontFrac: number, playing: boolean): void {
    if (!this.enabled || !this.ctx || !this.master || !this.hissGain) return;
    const now = this.ctx.currentTime;
    this.hissGain.gain.setTargetAtTime(playing ? 0.05 * Math.max(0, Math.min(1, frontFrac)) ** 2 : 0, now, 0.08);
    if (!playing || t < this.lastT) {
      // Re-seek the cursor without clicking.
      this.cursor = lowerBound(this.times, t);
      this.lastT = t;
      return;
    }
    const end = lowerBound(this.times, t);
    const n = end - this.cursor;
    if (n > 0) {
      const step = Math.max(1, Math.floor(n / MAX_CLICKS_PER_FRAME));
      for (let k = this.cursor; k < end; k += step) this.click(now + this.rand() * 0.016, this.classes[k]!, Math.min(1, step / 4));
    }
    this.cursor = end;
    this.lastT = t;
  }

  private click(at: number, c: number, loud: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const muon = c === RClass.MUON;
    osc.type = muon ? 'square' : 'triangle';
    osc.frequency.value = muon ? 2400 + this.rand() * 400 : c === RClass.GAMMA ? 520 + this.rand() * 120 : 900 + this.rand() * 300;
    const peak = (muon ? 0.09 : 0.035) * (0.6 + 0.4 * loud);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.001);
    g.gain.exponentialRampToValueAtTime(1e-4, at + (muon ? 0.012 : 0.03));
    osc.connect(g).connect(this.master!);
    osc.start(at);
    osc.stop(at + 0.04);
  }

  private rand(): number {
    // Small LCG: audio jitter only, not physics.
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  dispose(): void {
    this.noise?.stop();
    void this.ctx?.close();
  }
}

function lowerBound(a: Float64Array, v: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (a[m]! < v) lo = m + 1; else hi = m;
  }
  return lo;
}
