// AudioWorklet: a bank of damped resonators per drum (modal synthesis).
//
// Mode k of drum d is a complex phasor z = r^t e^(i w t); the output is its imaginary part, so a
// strike that adds a real amount a starts a sine at zero displacement, as a struck membrane does.
// A strike also fires a few milliseconds of filtered noise: the mallet's contact click.
// A drive is a steady sine (the Chladni mode), its level eased to avoid clicks.

interface Bank {
  n: number;
  cr: Float32Array; ci: Float32Array; // per-sample rotation * decay
  zr: Float32Array; zi: Float32Array;
  pan: number;
}

interface Msg {
  type: 'bank' | 'strike' | 'drive' | 'stop';
  id?: number;
  freqs?: Float32Array;
  decays?: Float32Array; // seconds to 1/e
  amps?: Float32Array;
  click?: number; // click gain
  cutoff?: number; // click lowpass, Hz
  pan?: number;
  freq?: number;
  gain?: number;
}

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class ModalProcessor extends AudioWorkletProcessor {
  private banks = new Map<number, Bank>();
  private click = 0;
  private clickEnv = 0;
  private clickLp = 0;
  private clickA = 0.5;
  private clickPan = 0;
  private seed = 22222;
  private dPhase = 0;
  private dFreq = 0;
  private dGain = 0;
  private dTarget = 0;

  constructor(options?: { processorOptions?: { init?: Msg[] } }) {
    super();
    this.port.onmessage = (e: MessageEvent<Msg>) => this.onMsg(e.data);
    // Messages passed at construction run before the first block (used for offline renders).
    for (const m of options?.processorOptions?.init ?? []) this.onMsg(m);
  }

  private onMsg(m: Msg) {
    if (m.type === 'bank' && m.freqs && m.decays && m.id !== undefined) {
      const n = m.freqs.length;
      const b: Bank = { n, cr: new Float32Array(n), ci: new Float32Array(n), zr: new Float32Array(n), zi: new Float32Array(n), pan: m.pan ?? 0 };
      for (let k = 0; k < n; k++) {
        const f = m.freqs[k]!;
        // Modes above Nyquist (cannot happen at sane tension, but guard) are silenced.
        const w = f < sampleRate * 0.45 ? (2 * Math.PI * f) / sampleRate : 0;
        const r = w > 0 ? Math.exp(-1 / (m.decays[k]! * sampleRate)) : 0;
        b.cr[k] = r * Math.cos(w);
        b.ci[k] = r * Math.sin(w);
      }
      this.banks.set(m.id, b);
    } else if (m.type === 'strike' && m.amps && m.id !== undefined) {
      const b = this.banks.get(m.id);
      if (!b) return;
      for (let k = 0; k < Math.min(b.n, m.amps.length); k++) b.zr[k] = b.zr[k]! + m.amps[k]!;
      if (m.click) {
        this.click = m.click;
        this.clickEnv = 1;
        this.clickA = 1 - Math.exp((-2 * Math.PI * (m.cutoff ?? 2000)) / sampleRate);
        this.clickPan = b.pan;
      }
    } else if (m.type === 'drive') {
      this.dFreq = m.freq ?? 0;
      this.dTarget = m.gain ?? 0;
    } else if (m.type === 'stop') {
      for (const b of this.banks.values()) { b.zr.fill(0); b.zi.fill(0); }
      this.dTarget = 0;
    }
  }

  process(_in: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]!;
    const L = out[0]!, R = out[1] ?? out[0]!;
    const len = L.length;
    L.fill(0);
    if (R !== L) R.fill(0);
    for (const b of this.banks.values()) {
      const gl = Math.sqrt(0.5 * (1 - b.pan)), gr = Math.sqrt(0.5 * (1 + b.pan));
      const { cr, ci, zr, zi, n } = b;
      for (let k = 0; k < n; k++) {
        let xr = zr[k]!, xi = zi[k]!;
        if (xr * xr + xi * xi < 1e-14) { zr[k] = 0; zi[k] = 0; continue; }
        const c = cr[k]!, s = ci[k]!;
        for (let t = 0; t < len; t++) {
          const nr = xr * c - xi * s;
          xi = xr * s + xi * c;
          xr = nr;
          L[t] = L[t]! + xi * gl;
          if (R !== L) R[t] = R[t]! + xi * gr;
        }
        zr[k] = xr; zi[k] = xi;
      }
    }
    // Mallet click.
    if (this.clickEnv > 1e-4) {
      const gl = Math.sqrt(0.5 * (1 - this.clickPan)), gr = Math.sqrt(0.5 * (1 + this.clickPan));
      const decay = Math.exp(-1 / (0.004 * sampleRate));
      for (let t = 0; t < len; t++) {
        this.seed = (this.seed * 1103515245 + 12345) >>> 0;
        const white = this.seed / 2147483648 - 1;
        this.clickLp += this.clickA * (white - this.clickLp);
        const v = this.clickLp * this.clickEnv * this.click;
        this.clickEnv *= decay;
        L[t] = L[t]! + v * gl;
        if (R !== L) R[t] = R[t]! + v * gr;
      }
    }
    // Chladni drive.
    if (this.dGain > 1e-5 || this.dTarget > 0) {
      const w = (2 * Math.PI * this.dFreq) / sampleRate;
      for (let t = 0; t < len; t++) {
        this.dGain += 0.0008 * (this.dTarget - this.dGain);
        this.dPhase += w;
        if (this.dPhase > 2 * Math.PI) this.dPhase -= 2 * Math.PI;
        const v = Math.sin(this.dPhase) * this.dGain;
        L[t] = L[t]! + v;
        if (R !== L) R[t] = R[t]! + v;
      }
    }
    // Gentle saturation keeps fast rolls from clipping.
    for (let t = 0; t < len; t++) {
      L[t] = Math.tanh(L[t]!);
      if (R !== L) R[t] = Math.tanh(R[t]!);
    }
    return true;
  }
}

registerProcessor('modal-bank', ModalProcessor);
