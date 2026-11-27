// A live view of a scene: owns the tracer, repacks the scene when it changes, paces the work
// to the display's frame rate and runs the exposure meter. No DOM beyond the canvas.
import { type MeshLookup, type Packed, packScene } from '../core/pack';
import type { Darkroom, Scene } from '../core/scene';
import { cameraMatrix } from '../core/spectrum';
import { type Look, Tracer, cameraFrame } from '../gpu/tracer';

const TONES = { film: 0, linear: 1, contrast: 2, mono: 3 } as const;

/** Display multiplier for a manual exposure: saturation at 1.2 * 2^EV100 cd/m2. */
export function manualExposure(fstop: number, shutter: number, iso: number): number {
  const n = fstop > 0 ? fstop : 16;
  const ev100 = Math.log2((n * n) / shutter) - Math.log2(iso / 100);
  return 1 / (1.2 * 2 ** ev100);
}

export class View {
  readonly tracer: Tracer;
  scene: Scene | null = null;
  packed: Packed | null = null;
  /** Stop refining after this many samples per pixel (0 = never). */
  maxSamples = 0;
  /** Called after each displayed frame. */
  onFrame: (() => void) | null = null;
  meshes: MeshLookup = () => null;
  /** Tiles traced per animation frame; adapts to keep the page responsive. */
  tilesPerFrame = 1;
  running = false;
  /** 'average' exposes for the whole picture; 'peak' for its brightest part (a spectrum on black). */
  meterMode: 'average' | 'peak' = 'average';
  /** The exposure the meter last settled on. */
  autoExposure = 1;
  private metered = -1;
  private lastTime = 0;
  private raf = 0;
  private dirtyDisplay = true;
  private slowFrames = 0;

  /** True when the GPU needs several animation frames for one sample of the picture. */
  get slow(): boolean { return this.tracer.tileSize < 256 || this.tilesPerFrame < this.tracer.tilesPerSweep * 0.5; }

  constructor(readonly canvas: HTMLCanvasElement) {
    this.tracer = new Tracer(canvas);
  }

  /** Replace the scene (or tell the view it was edited in place). */
  setScene(scene: Scene): void {
    this.scene = scene;
    this.packed = packScene(scene, this.meshes);
    this.tracer.vignette = scene.darkroom.vignette;
    this.tracer.setScene(this.packed, scene.bounces);
    this.applyCamera();
    this.metered = -1;
  }

  /** The camera moved or its lens changed: restart the picture without repacking. */
  applyCamera(): void {
    if (!this.scene) return;
    this.tracer.setCamera(cameraFrame(this.scene.camera, this.tracer.width / Math.max(1, this.tracer.height)));
    this.metered = -1;
  }

  /** Darkroom settings changed: only the development needs redoing. */
  invalidateDisplay(): void {
    this.dirtyDisplay = true;
    if (this.scene && this.tracer.vignette !== this.scene.darkroom.vignette) {
      this.tracer.vignette = this.scene.darkroom.vignette;
      this.tracer.reset();
    }
  }

  resize(width: number, height: number): void {
    if (width === this.tracer.width && height === this.tracer.height) return;
    this.tracer.resize(width, height);
    this.applyCamera();
  }

  look(): Look {
    const d: Darkroom = this.scene!.darkroom;
    const cam = this.scene!.camera;
    const base = d.auto ? this.autoExposure : manualExposure(cam.fstop, cam.shutter, cam.iso);
    return { matrix: cameraMatrix(d.wb), exposure: base * 2 ** d.ev, tone: TONES[d.tone], bloom: d.bloom };
  }

  private meter(): void {
    const t = this.tracer;
    // Meter early and often at first, then leave the exposure alone so it does not drift.
    const due = t.frame >= 1 && (this.metered < 0 || (t.frame < 64 && t.frame >= this.metered * 2));
    if (!due) return;
    const m = t.meter();
    const target = this.meterMode === 'peak' ? 0.2 / Math.max(1e-3, m.peak) : 0.16 / Math.max(1e-3, Math.exp(m.logMean));
    this.autoExposure = this.metered < 0 && t.frame < 3 && this.autoExposure !== 1 ? 0.5 * (this.autoExposure + target) : target;
    this.metered = Math.max(1, t.frame);
    this.dirtyDisplay = true;
  }

  /** Trace for one animation frame and show the result. */
  tick(now: number): void {
    const t = this.tracer;
    if (!t.hasScene || !this.scene) return;
    const dt = this.lastTime ? now - this.lastTime : 16;
    this.lastTime = now;
    const done = this.maxSamples > 0 && t.frame >= this.maxSamples;
    if (!done) {
      if (dt > 45) this.tilesPerFrame = Math.max(1, this.tilesPerFrame * 0.6);
      // A single tile that takes several frames makes the page sluggish: use smaller tiles.
      this.slowFrames = dt > 70 && this.tilesPerFrame <= 1 ? this.slowFrames + 1 : 0;
      if (this.slowFrames >= 3 && t.tileSize > 64) { t.setTileSize(t.tileSize / 2); this.slowFrames = 0; }
      else if (dt < 24) this.tilesPerFrame = Math.min(t.tilesPerSweep * 16, this.tilesPerFrame * 1.25 + 0.25);
      let n = Math.max(1, Math.floor(this.tilesPerFrame));
      if (this.maxSamples > 0) n = Math.min(n, (this.maxSamples - t.frame) * t.tilesPerSweep);
      t.step(n);
      this.dirtyDisplay = true;
    }
    if (this.scene.darkroom.auto) this.meter();
    if (this.dirtyDisplay) {
      t.present(this.look());
      this.dirtyDisplay = false;
      this.onFrame?.();
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      this.tick(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
