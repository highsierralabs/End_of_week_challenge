// Audio: one AudioContext and the modal-bank worklet, started on the first gesture.

import workletUrl from './modal.worklet.ts?worker&url';

export class AudioEngine {
  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;
  private pending: unknown[] = [];
  private master: GainNode | null = null;
  muted = false;

  /** Call from a user gesture. Safe to call often. */
  start(): Promise<void> {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx({ latencyHint: 'interactive' });
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'modal-bank', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.9;
      node.connect(master).connect(ctx.destination);
      // A little room: a synthetic stereo impulse response (decaying noise), mixed in quietly.
      const conv = ctx.createConvolver();
      conv.buffer = roomImpulse(ctx, 1.3);
      const wet = ctx.createGain();
      wet.gain.value = 0.16;
      node.connect(conv).connect(wet).connect(master);
      this.node = node;
      this.master = master;
      for (const m of this.pending) node.port.postMessage(m);
      this.pending = [];
      if (ctx.state === 'suspended') await ctx.resume();
    })();
    return this.starting;
  }

  send(msg: unknown): void {
    if (this.node) this.node.port.postMessage(msg);
    else this.pending.push(msg);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  get running(): boolean { return this.ctx?.state === 'running'; }
}

/** Exponentially decaying, slightly low-passed stereo noise: a plain, small hall. */
function roomImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.round(seconds * ctx.sampleRate);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  let seed = 987654321;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = seed / 2147483648 - 1;
      const t = i / ctx.sampleRate;
      // Brighter early, darker late.
      const a = 0.55 - 0.4 * Math.min(1, t / seconds);
      lp += a * (white - lp);
      d[i] = lp * Math.exp(-t / (seconds * 0.28)) * (t < 0.012 ? t / 0.012 : 1);
    }
  }
  return buf;
}
