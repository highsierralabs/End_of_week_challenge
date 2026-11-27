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
