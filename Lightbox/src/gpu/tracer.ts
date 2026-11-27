// The render engine: owns the WebGL2 context, the scene textures and the accumulation
// buffers, and advances the picture a few tiles at a time so the page stays responsive on any
// GPU.
import { LIGHT_W, MAT_W, OBJ_W, PLANE_W, type Packed } from '../core/pack';
import { type Camera, SENSOR_HEIGHT_MM } from '../core/scene';
import { NL, NS } from '../core/spectrum';
import { type Vec3, cross, norm, sub } from '../core/vec';
import { Program, createFramebuffer, createTexture, dataTexture } from './gl';
import { DEVELOP_FRAG, DOWN_FRAG, METER_FRAG, PRINT_FRAG, UP_FRAG } from './shaders/display';
import { ADD_FRAG, COUNT_FRAG, FULLSCREEN_VERT, HASH_FRAG, HASH_VERT, LT_FRAG, PT_FRAG, SPLAT_FRAG, SPLAT_VERT } from './shaders/trace';

export interface Look {
  /** Row-major 3x3 from tracer XYZ to linear sRGB (includes the white balance). */
  matrix: number[];
  /** Multiplier from luminance (cd/m2) to display-linear values. */
  exposure: number;
  /** 0 film, 1 linear, 2 contrast, 3 mono. */
  tone: number;
  bloom: number;
}

export interface CameraFrame {
  pos: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  tanHalf: number;
  lensRadius: number;
  focus: number;
  blades: number;
}

/** Basis and lens of a camera for an image of the given aspect (width / height). */
export function cameraFrame(cam: Camera, aspect: number): CameraFrame {
  const forward = norm(sub(cam.target, cam.pos));
  let right = norm(cross(forward, [0, 1, 0]));
  if (!(Math.hypot(...right) > 0.5)) right = [1, 0, 0];
  const up = cross(right, forward);
  // The 24 mm side of the frame is the picture's shorter side.
  const tanHalf = (SENSOR_HEIGHT_MM / 2 / cam.focal) * Math.max(1, 1 / aspect);
  const lensRadius = cam.fstop > 0 ? cam.focal / 1000 / (2 * cam.fstop) : 0;
  return { pos: cam.pos, right, up, forward, tanHalf, lensRadius, focus: Math.max(0.01, cam.focus), blades: cam.blades };
}

const BVH_W = 2048;
/** Wavelengths per sweep (NK in the shaders). */
const NK = 8;
/** How fast the gather radius shrinks: r^2 falls as sweep^(ALPHA - 1). */
const PM_ALPHA = 0.7;
const METER_W = 32;
const METER_H = 18;

/** Kronecker-sequence multipliers (the R_d sequence of Roberts) as 32-bit fixed point. */
function kroneckerAlphas(d: number): Uint32Array {
  let phi = 2;
  for (let i = 0; i < 60; i++) phi = Math.pow(1 + phi, 1 / (d + 1));
  const out = new Uint32Array(8);
  for (let k = 0; k < 8; k++) {
    const a = Math.pow(1 / phi, k + 1) % 1;
    out[k] = Math.floor(a * 4294967296) >>> 0;
  }
  return out;
}

export class Tracer {
  readonly gl: WebGL2RenderingContext;
  readonly floatBlend: boolean;
  private readonly parallel: KHR_parallel_shader_compile | null;
  private readonly progs: Record<'pt' | 'lt' | 'splat' | 'hash' | 'count' | 'add' | 'develop' | 'meter' | 'down' | 'up' | 'print', Program>;
  private readonly vao: WebGLVertexArrayObject;

  width = 0;
  height = 0;
  /** Render resolution divisor (1 = full, 2 = half per side...), for previews while dragging. */
  scale = 1;
  /** Completed sweeps over the image: the sample count of every pixel. */
  frame = 0;
  photons = 0;
  /** Edge of a work tile in pixels. */
  tileSize = 256;
  photonSize = 256;
  useLT = true;
  /** Gather photons for caustics seen through glass or in mirrors (needs the photon pass). */
  usePM = true;
  /** Gather radius of the first sweep, metres; it shrinks from sweep to sweep. */
  radius0 = 0.01;
  vignette = false;
  clamp = 1e30;

  private rw = 1;
  private rh = 1;
  private cursor = 0;
  private scene: Packed | null = null;
  private cam: CameraFrame | null = null;
  private maxBounces = 12;
  private readonly tex: Record<string, WebGLTexture | null> = { obj: null, mat: null, planes: null, spec: null, lights: null, targets: null, bvh: null, tri: null };
  private accum: [WebGLTexture, WebGLTexture] | null = null;
  private accumFb: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  private lt: [WebGLTexture, WebGLTexture] | null = null;
  private ltFb: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
  private splat16: WebGLTexture | null = null;
  private splat16Fb: WebGLFramebuffer | null = null;
  private phot: WebGLTexture[] | null = null;
  private photFb: WebGLFramebuffer | null = null;
  private photAlloc = 0;
  private hashTex: [WebGLTexture, WebGLTexture, WebGLTexture] | null = null;
  private hashFb: WebGLFramebuffer | null = null;
  private countFb: WebGLFramebuffer | null = null;
  private hashDepth: WebGLRenderbuffer | null = null;
  private hashW = 0;
  private radius2 = 1e-4;
  private radiusFrame = -1;
  private readonly lamK = new Float32Array(NK);
  private readonly invPdfK = new Float32Array(NK);
  private gridShift: [number, number, number] = [0, 0, 0];
  private hdr: WebGLTexture | null = null;
  private hdrFb: WebGLFramebuffer | null = null;
  private bloom: { tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number }[] = [];
  private meterTex: WebGLTexture;
  private meterFb: WebGLFramebuffer;
  private readonly alphas = kroneckerAlphas(7);

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This GPU cannot render to floating-point textures (EXT_color_buffer_float is missing).');
    this.gl = gl;
    this.floatBlend = !!gl.getExtension('EXT_float_blend');
    this.parallel = gl.getExtension('KHR_parallel_shader_compile');
    const mk = (name: string, vert: string, frag: string) => new Program(gl, name, vert, frag);
    this.progs = {
      pt: mk('path tracer', FULLSCREEN_VERT, PT_FRAG),
      lt: mk('light tracer', FULLSCREEN_VERT, LT_FRAG),
      splat: mk('splat', SPLAT_VERT, SPLAT_FRAG),
      hash: mk('photon map', HASH_VERT, HASH_FRAG),
      count: mk('photon count', HASH_VERT, COUNT_FRAG),
      add: mk('add', FULLSCREEN_VERT, ADD_FRAG),
      develop: mk('develop', FULLSCREEN_VERT, DEVELOP_FRAG),
      meter: mk('meter', FULLSCREEN_VERT, METER_FRAG),
      down: mk('downsample', FULLSCREEN_VERT, DOWN_FRAG),
      up: mk('upsample', FULLSCREEN_VERT, UP_FRAG),
      print: mk('print', FULLSCREEN_VERT, PRINT_FRAG),
    };
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.meterTex = createTexture(gl, 'rgba32f', METER_W, METER_H);
    this.meterFb = createFramebuffer(gl, [this.meterTex]);
    // Placeholder mesh textures so the samplers are always complete.
    this.setMeshes(new Float32Array(8), new Float32Array(24));
  }

  /** Resolves when every shader has compiled; rejects with the driver's log on failure. */
  ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      const poll = () => {
        if (this.gl.isContextLost()) { reject(new Error('The WebGL context was lost while compiling.')); return; }
        if (!Object.values(this.progs).every((p) => p.done(this.parallel))) { setTimeout(poll, 30); return; }
        try {
          for (const p of Object.values(this.progs)) p.check();
          resolve();
        } catch (e) { reject(e as Error); }
      };
      poll();
    });
  }

  // ------------------------------------------------------------------ scene
  setMeshes(nodes: Float32Array, tris: Float32Array): void {
    const gl = this.gl;
    for (const k of ['bvh', 'tri'] as const) if (this.tex[k]) gl.deleteTexture(this.tex[k]);
    this.tex.bvh = dataTexture(gl, nodes, BVH_W).tex;
    this.tex.tri = dataTexture(gl, tris, BVH_W).tex;
    this.reset();
  }

  setScene(p: Packed, bounces: number): void {
    const gl = this.gl;
    for (const k of ['obj', 'mat', 'planes', 'spec', 'lights', 'targets'] as const) if (this.tex[k]) gl.deleteTexture(this.tex[k]);
    this.tex.obj = dataTexture(gl, p.obj, OBJ_W).tex;
    this.tex.mat = dataTexture(gl, p.mat, MAT_W).tex;
    this.tex.planes = dataTexture(gl, p.planes, PLANE_W).tex;
    this.tex.spec = createTexture(gl, 'r32f', NS, p.numSpec, p.spec);
    this.tex.lights = dataTexture(gl, p.lights, LIGHT_W).tex;
    this.tex.targets = dataTexture(gl, p.targets, 1).tex;
    this.scene = p;
    this.maxBounces = bounces;
    this.reset();
  }

  setCamera(cam: CameraFrame): void {
    this.cam = cam;
    this.reset();
  }

  resize(width: number, height: number): void {
    width = Math.max(8, Math.floor(width));
    height = Math.max(8, Math.floor(height));
    if (width === this.width && height === this.height) return;
    const gl = this.gl;
    this.width = width;
    this.height = height;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const drop = (t: WebGLTexture | null, f: WebGLFramebuffer | null) => { if (t) gl.deleteTexture(t); if (f) gl.deleteFramebuffer(f); };
    if (this.accum) for (let i = 0; i < 2; i++) { drop(this.accum[i]!, this.accumFb![i]!); drop(this.lt![i]!, this.ltFb![i]!); }
    drop(this.splat16, this.splat16Fb);
    drop(this.hdr, this.hdrFb);
    for (const b of this.bloom) drop(b.tex, b.fb);
    const pair = (): [WebGLTexture, WebGLTexture] => [createTexture(gl, 'rgba32f', width, height), createTexture(gl, 'rgba32f', width, height)];
    this.accum = pair();
    this.accumFb = [createFramebuffer(gl, [this.accum[0]]), createFramebuffer(gl, [this.accum[1]])];
    this.lt = pair();
    this.ltFb = [createFramebuffer(gl, [this.lt[0]]), createFramebuffer(gl, [this.lt[1]])];
    if (!this.floatBlend) {
      this.splat16 = createTexture(gl, 'rgba16f', width, height);
      this.splat16Fb = createFramebuffer(gl, [this.splat16]);
    }
    this.hdr = createTexture(gl, 'rgba16f', width, height, null, true);
    this.hdrFb = createFramebuffer(gl, [this.hdr]);
    this.bloom = [];
    let w = width;
    let h = height;
    for (let i = 0; i < 6; i++) {
      w = Math.max(2, w >> 1);
      h = Math.max(2, h >> 1);
      const tex = createTexture(gl, 'rgba16f', w, h, null, true);
      this.bloom.push({ tex, fb: createFramebuffer(gl, [tex]), w, h });
      if (Math.min(w, h) <= 8) break;
    }
    this.reset();
  }

  /** Change the preview divisor (restarts the picture). */
  setScale(scale: number): void {
    scale = Math.max(1, Math.round(scale));
    if (scale === this.scale) return;
    this.scale = scale;
    this.reset();
  }

  /** Change the work tile's size; the current sweep starts over (pixels keep their own counts). */
  setTileSize(size: number): void {
    this.tileSize = Math.max(32, Math.round(size));
    this.cursor = 0;
  }

  /** Forget the accumulated picture and start again. */
  reset(): void {
    this.frame = 0;
    this.photons = 0;
    this.cursor = 0;
    this.radiusFrame = -1;
    this.rw = Math.max(4, Math.floor(this.width / this.scale));
    this.rh = Math.max(4, Math.floor(this.height / this.scale));
    if (!this.accumFb) return;
    const gl = this.gl;
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    for (const fb of [...this.accumFb, ...this.ltFb!]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  get renderWidth(): number { return this.rw; }
  get renderHeight(): number { return this.rh; }
  get tilesPerSweep(): number { return Math.ceil(this.rw / this.tileSize) * Math.ceil(this.rh / this.tileSize); }
  get hasScene(): boolean { return this.scene !== null && this.cam !== null && this.accum !== null; }

  // ------------------------------------------------------------------ tracing
  private bindScene(p: Program, firstUnit: number): void {
    const s = this.scene!;
    const c = this.cam!;
    const names = ['obj', 'mat', 'planes', 'spec', 'lights', 'bvh', 'tri', 'targets'] as const;
    const uni = ['uObj', 'uMat', 'uPlanes', 'uSpec', 'uLights', 'uBvh', 'uTri', 'uTargets'];
    names.forEach((n, i) => p.tex(uni[i]!, firstUnit + i, this.tex[n]!));
    p.i('uNumObj', s.numObj);
    p.i('uNumLights', s.numLights);
    p.i('uNumTargets', s.numTargets);
    p.i('uMaxBounces', this.maxBounces);
    p.i('uPathIters', 2 * this.maxBounces + 8);
    p.i('uBvhIters', 4096);
    p.f('uEnvScale', s.envScale);
    p.i('uEnvRow', s.envRow);
    p.v2('uRes', this.rw, this.rh);
    p.v3('uCamPos', c.pos);
    p.v3('uCamR', c.right);
    p.v3('uCamU', c.up);
    p.v3('uCamF', c.forward);
    p.f('uTanHalf', c.tanHalf);
    p.f('uLensR', c.lensRadius);
    p.f('uFocus', c.focus);
    p.i('uBlades', c.blades);
    p.i('uVignette', this.vignette ? 1 : 0);
    p.fv('uLamK[0]', this.lamK);
    p.fv('uInvPdfK[0]', this.invPdfK);
  }

  private get ltActive(): boolean {
    return this.useLT && this.scene !== null && this.scene.numTargets > 0 && this.scene.numLights > 0;
  }
  private get pmActive(): boolean { return this.usePM && this.ltActive; }

  /** The gather radius in use, metres. */
  get gatherRadius(): number { return Math.sqrt(this.radius2); }

  /**
   * Start a sweep: choose its wavelengths, shrink the gather radius, and trace the photons
   * the sweep's camera paths will gather from.
   */
  private beginSweep(): void {
    const lam = this.scene!.lam;
    const u0 = (0.5 + this.frame * 0.6180339887498949) % 1;
    for (let k = 0; k < NK; k++) {
      const x = ((u0 + k / NK) % 1) * NL;
      const i = Math.min(NL - 1, Math.floor(x));
      this.lamK[k] = lam[i]! + (lam[i + 1]! - lam[i]!) * (x - i);
      this.invPdfK[k] = NL * (lam[i + 1]! - lam[i]!);
    }
    if (this.radiusFrame < 0 || this.radiusFrame > this.frame) { this.radius2 = this.radius0 * this.radius0; this.radiusFrame = 0; }
    while (this.radiusFrame < this.frame) {
      this.radiusFrame++;
      this.radius2 *= (this.radiusFrame - 1 + PM_ALPHA) / this.radiusFrame;
    }
    const f = this.frame + 1;
    this.gridShift = [(f * 0.7548776662) % 1, (f * 0.5698402909) % 1, (f * 0.4301597090) % 1];
    if (this.ltActive) this.photonBatch();
  }

  /**
   * Trace `tiles` more tiles. When a sweep of the whole image completes, the sample count
   * goes up by one and a batch of photons is traced.
   */
  step(tiles: number): void {
    if (!this.hasScene) return;
    const gl = this.gl;
    const cols = Math.ceil(this.rw / this.tileSize);
    const total = this.tilesPerSweep;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    const pt = this.progs.pt;
    for (let n = 0; n < tiles; n++) {
      if (this.cursor === 0) { this.beginSweep(); gl.disable(gl.BLEND); }
      const tx = (this.cursor % cols) * this.tileSize;
      const ty = Math.floor(this.cursor / cols) * this.tileSize;
      const tw = Math.min(this.tileSize, this.rw - tx);
      const th = Math.min(this.tileSize, this.rh - ty);
      pt.use();
      this.bindScene(pt, 1);
      pt.tex('uPrev', 0, this.accum![0]);
      pt.ui('uFrame', this.frame);
      pt.uiv('uAlpha[0]', this.alphas);
      pt.i('uLT', this.ltActive ? 1 : 0);
      pt.i('uPM', this.pmActive ? 1 : 0);
      pt.tex('uHashA', 10, this.hashTex?.[0] ?? null);
      pt.tex('uHashB', 11, this.hashTex?.[1] ?? null);
      pt.tex('uHashN', 12, this.hashTex?.[2] ?? null);
      pt.i('uHashW', Math.max(1, this.hashW));
      pt.f('uCell', 2 * Math.sqrt(this.radius2));
      pt.f('uRadius2', this.radius2);
      pt.f('uPhotK', (this.photonSize * this.photonSize) / NK);
      pt.v3('uGridShift', this.gridShift);
      pt.f('uClamp', this.clamp);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFb![1]);
      gl.viewport(0, 0, this.rw, this.rh);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(tx, ty, tw, th);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.accumFb![1]);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.accumFb![0]);
      gl.blitFramebuffer(tx, ty, tx + tw, ty + th, tx, ty, tx + tw, ty + th, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.disable(gl.SCISSOR_TEST);
      this.cursor++;
      if (this.cursor >= total) {
        this.cursor = 0;
        this.frame++;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private photonBatch(): void {
    const gl = this.gl;
    const P = this.photonSize;
    if (!this.phot || this.photAlloc !== P) {
      if (this.phot) { for (const t of this.phot) gl.deleteTexture(t); gl.deleteFramebuffer(this.photFb); }
      // Per photon: where it lands on the screen, its value there, where it landed in the
      // scene with its weight, and the direction it came from with its wavelength slot.
      this.phot = [0, 1, 2, 3].map(() => createTexture(gl, 'rgba32f', P, P));
      this.photFb = createFramebuffer(gl, this.phot);
      this.photAlloc = P;
      if (this.hashTex) { for (const t of this.hashTex) gl.deleteTexture(t); gl.deleteFramebuffer(this.hashFb); gl.deleteFramebuffer(this.countFb); gl.deleteRenderbuffer(this.hashDepth); }
      const H = 2 * P;
      this.hashW = H;
      this.hashTex = [createTexture(gl, 'rgba32f', H, H), createTexture(gl, 'rgba32f', H, H), createTexture(gl, 'rgba16f', H, H)];
      this.hashDepth = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.hashDepth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, H, H);
      this.hashFb = createFramebuffer(gl, [this.hashTex[0], this.hashTex[1]], this.hashDepth);
      this.countFb = createFramebuffer(gl, [this.hashTex[2]]);
    }
    const lt = this.progs.lt;
    lt.use();
    this.bindScene(lt, 1);
    lt.ui('uFrame', this.frame);
    lt.i('uPhotW', P);
    const c = this.cam!;
    lt.f('uPixArea', ((2 * c.tanHalf) / this.rh) ** 2);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.photFb);
    gl.viewport(0, 0, P, P);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (this.pmActive) {
      // Build the hashed grid: one random photon per texel (depth test on a random depth),
      // then how many photons fell on each texel.
      const H = this.hashW;
      for (const pass of ['hash', 'count'] as const) {
        const hp = this.progs[pass];
        hp.use();
        hp.tex('uPhotHit', 0, this.phot[2]!);
        hp.tex('uPhotDir', 1, this.phot[3]!);
        hp.i('uPhotW', P);
        hp.i('uHashW', H);
        hp.f('uCell', 2 * Math.sqrt(this.radius2));
        hp.v3('uGridShift', this.gridShift);
        hp.ui('uFrame', this.frame);
        gl.bindFramebuffer(gl.FRAMEBUFFER, pass === 'hash' ? this.hashFb : this.countFb);
        gl.viewport(0, 0, H, H);
        gl.clearColor(0, 0, 0, 0);
        if (pass === 'hash') {
          gl.enable(gl.DEPTH_TEST);
          gl.depthFunc(gl.LESS);
          gl.clearDepth(1);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        } else {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.drawArrays(gl.POINTS, 0, P * P);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
      }
    }

    const sp = this.progs.splat;
    sp.use();
    sp.tex('uPhotPos', 0, this.phot[0]!);
    sp.tex('uPhotVal', 1, this.phot[1]!);
    sp.i('uPhotW', P);
    sp.v2('uRes', this.rw, this.rh);
    gl.viewport(0, 0, this.rw, this.rh);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    if (this.floatBlend) {
      sp.f('uScale', 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ltFb![0]);
      gl.drawArrays(gl.POINTS, 0, P * P);
      gl.disable(gl.BLEND);
    } else {
      // Half-float splats (scaled down to stay in range), then a full-precision add.
      const k = 1 / 4096;
      sp.f('uScale', k);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.splat16Fb);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, P * P);
      gl.disable(gl.BLEND);
      const add = this.progs.add;
      add.use();
      add.tex('uA', 0, this.lt![0]);
      add.tex('uB', 1, this.splat16);
      add.f('uScaleB', 1 / k);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ltFb![1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.ltFb![1]);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.ltFb![0]);
      gl.blitFramebuffer(0, 0, this.rw, this.rh, 0, 0, this.rw, this.rh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    this.photons += P * P;
  }

  // ------------------------------------------------------------------ display
  private bindAccum(p: Program): void {
    p.tex('uPT', 0, this.accum![0]);
    p.tex('uLT', 1, this.lt![0]);
    p.f('uPhotons', this.ltActive ? this.photons : 0);
    p.v2('uSrcRes', this.rw, this.rh);
  }

  /** Develop the accumulated light and draw it to the canvas. */
  present(look: Look): void {
    if (!this.accum) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    const dev = this.progs.develop;
    dev.use();
    this.bindAccum(dev);
    dev.v2('uDstRes', this.width, this.height);
    dev.m3('uCam', look.matrix);
    dev.f('uExposure', look.exposure);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdrFb);
    gl.viewport(0, 0, this.width, this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (look.bloom > 0 && this.bloom.length > 1) {
      const down = this.progs.down;
      down.use();
      let src = this.hdr!;
      let sw = this.width;
      let sh = this.height;
      this.bloom.forEach((b, i) => {
        down.tex('uSrc', 0, src);
        down.v2('uTexel', 1 / sw, 1 / sh);
        down.f('uThreshold', i === 0 ? 1 : 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
        gl.viewport(0, 0, b.w, b.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = b.tex;
        sw = b.w;
        sh = b.h;
      });
      const up = this.progs.up;
      up.use();
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.bloom.length - 1; i > 0; i--) {
        const s = this.bloom[i]!;
        const d = this.bloom[i - 1]!;
        up.tex('uSrc', 0, s.tex);
        up.v2('uTexel', 1 / s.w, 1 / s.h);
        up.v2('uDstRes', d.w, d.h);
        gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb);
        gl.viewport(0, 0, d.w, d.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }

    const pr = this.progs.print;
    pr.use();
    pr.tex('uHdr', 0, this.hdr);
    pr.tex('uBloom', 1, this.bloom[0]?.tex ?? this.hdr);
    pr.f('uBloomAmount', this.bloom.length > 1 ? look.bloom / this.bloom.length : 0);
    pr.v2('uRes', this.width, this.height);
    pr.i('uTone', look.tone);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Mean log-luminance, mean luminance and the brightest metering cell (cd/m2) so far. */
  meter(): { logMean: number; mean: number; peak: number } {
    if (!this.accum) return { logMean: 0, mean: 0, peak: 0 };
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    const m = this.progs.meter;
    m.use();
    this.bindAccum(m);
    m.v2('uDstRes', METER_W, METER_H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.meterFb);
    gl.viewport(0, 0, METER_W, METER_H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Float32Array(METER_W * METER_H * 4);
    gl.readPixels(0, 0, METER_W, METER_H, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    let a = 0;
    let b = 0;
    let peak = 0;
    for (let i = 0; i < px.length; i += 4) { a += px[i]!; b += px[i + 1]!; peak = Math.max(peak, px[i + 1]!); }
    const n = METER_W * METER_H;
    return { logMean: a / n, mean: b / n, peak };
  }

  /**
   * Mean tracer XYZ over a rectangle of the render (pixels, origin bottom left): the measured
   * value the validation page compares with theory. Returns the two tracers' parts separately.
   */
  measure(x: number, y: number, w: number, h: number): { pt: [number, number, number]; lt: [number, number, number] } {
    const gl = this.gl;
    const read = (fb: WebGLFramebuffer): Float32Array => {
      const px = new Float32Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, px);
      return px;
    };
    const a = read(this.accumFb![0]);
    const b = read(this.ltFb![0]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const pt: [number, number, number] = [0, 0, 0];
    const lt: [number, number, number] = [0, 0, 0];
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const s = Math.max(1, a[i * 4 + 3]!);
      for (let c = 0; c < 3; c++) {
        pt[c]! += a[i * 4 + c]! / s / n;
        if (this.photons > 0 && this.ltActive) lt[c]! += b[i * 4 + c]! / this.photons / n;
      }
    }
    return { pt, lt };
  }

  /** Per-pixel luminance (cd/m2) of a rectangle of the render, both tracers summed. */
  luminance(x: number, y: number, w: number, h: number): Float32Array {
    const gl = this.gl;
    const a = new Float32Array(w * h * 4);
    const b = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFb![0]);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, a);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ltFb![0]);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.FLOAT, b);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Float32Array(w * h);
    const lt = this.photons > 0 && this.ltActive;
    for (let i = 0; i < w * h; i++) out[i] = a[i * 4 + 1]! / Math.max(1, a[i * 4 + 3]!) + (lt ? b[i * 4 + 1]! / this.photons : 0);
    return out;
  }
}
