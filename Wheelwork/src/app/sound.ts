// The sound of the crank: one soft tick as each tooth of the crank's pinion comes into mesh, and a
// low whirr when the teeth pass too fast to tell apart. Synthesised; off until asked for.

export class Sound {
  ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private whirr: GainNode | null = null;
  private whirrFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastTooth = 0;
  private lastTime = 0;
  on = false;

  /** Must be called from a user gesture the first time. */
  setOn(on: boolean): void {
    this.on = on;
    if (on && !this.ctx) this.start();
    if (this.ctx) {
      if (on) void this.ctx.resume();
      this.out!.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
    }
  }

  private start(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(ctx.destination);
    // One second of noise, reused for ticks and looped for the whirr.
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 22222;
    for (let i = 0; i < data.length; i++) { seed = (seed * 16807) % 2147483647; data[i] = (seed / 2147483647) * 2 - 1; }
    this.noise = buffer;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    this.whirrFilter = ctx.createBiquadFilter();
    this.whirrFilter.type = 'bandpass';
    this.whirrFilter.frequency.value = 500;
    this.whirrFilter.Q.value = 1.2;
    this.whirr = ctx.createGain();
    this.whirr.gain.value = 0;
    src.connect(this.whirrFilter).connect(this.whirr).connect(this.out);
    src.start();
  }

  private tick(strength: number, delay = 0): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2300 + 500 * strength;
    filter.Q.value = 4;
    const gain = ctx.createGain();
    const t = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.5 * strength, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    src.connect(filter).connect(gain).connect(this.out!);
    src.start(t, (t * 7.3) % 0.9, 0.05);
  }

  /** Called every frame with the crank's turn count and its pinion's tooth count. */
  update(turns: number, teeth: number, now: number): void {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') { this.lastTooth = Math.floor(turns * teeth); this.lastTime = now; return; }
    const tooth = Math.floor(turns * teeth);
    const passed = Math.abs(tooth - this.lastTooth);
    const dt = Math.max(1e-3, (now - this.lastTime) / 1000);
    const rate = passed / dt;
    this.lastTooth = tooth;
    this.lastTime = now;
    // Under about thirty teeth a second each is heard; above, they blur into a whirr.
    // A slow frame may span several teeth: each gets its tick, spread over the frame just past.
    if (passed > 0 && rate < 32) {
      const n = Math.min(passed, 8);
      for (let k = 0; k < n; k++) this.tick(0.6 + 0.4 * Math.min(1, rate / 20), (k * dt) / n);
    }
    const level = rate < 20 ? 0 : Math.min(0.5, 0.12 + 0.1 * Math.log10(rate / 20));
    this.whirr!.gain.setTargetAtTime(level, this.ctx.currentTime, 0.06);
    this.whirrFilter!.frequency.setTargetAtTime(Math.min(2400, 300 + 14 * Math.min(rate, 150)), this.ctx.currentTime, 0.1);
  }
}
