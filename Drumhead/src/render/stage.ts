// WebGL2 picture of the drums: a membrane washed in two inks (vermilion where it is up, Prussian
// blue where it is down), contour lines of the displacement, and the nodal lines in black. In
// sand mode the membrane becomes a dark plate and the sand grains are drawn on it.

const VS = `#version 300 es
in vec2 aPos;
in float aU;
in float aRim;
uniform vec4 uXf; // world -> clip: x * s + ox, y * s + oy (s for x and y separately)
out float vU;
out float vRim;
void main() {
  vU = aU;
  vRim = aRim;
  gl_Position = vec4(aPos.x * uXf.x + uXf.z, aPos.y * uXf.y + uXf.w, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in float vU;
in float vRim;
uniform float uStep;   // contour spacing in displacement units
uniform float uLive;   // 0 at rest .. 1 ringing
uniform float uPlate;  // 1 in sand mode
out vec4 o;
void main() {
  vec3 skin = vec3(0.972, 0.955, 0.914);
  vec3 warm = vec3(0.741, 0.231, 0.149);
  vec3 cool = vec3(0.137, 0.227, 0.400);
  vec3 ink = vec3(0.110, 0.098, 0.086);
  if (uPlate > 0.5) {
    o = vec4(0.157, 0.169, 0.192, 1.0);
    return;
  }
  float u = vU;
  vec3 tone = u > 0.0 ? warm : cool;
  float a = clamp(abs(u) / (uStep * 6.0), 0.0, 1.0);
  vec3 col = mix(skin, tone, 0.34 * a * uLive);
  float f = u / uStep;
  float fw = max(fwidth(f), 1e-5);
  float d = abs(fract(f + 0.5) - 0.5) / fw;
  float line = (1.0 - smoothstep(0.25, 1.05, d)) * step(0.5, abs(f)) * uLive;
  col = mix(col, tone, line * 0.55);
  // Nodal lines, except along the rim itself, where u is pinned to zero.
  float dz = abs(u) / max(fwidth(u), 1e-7);
  float zero = (1.0 - smoothstep(0.3, 1.1, dz)) * uLive * (1.0 - smoothstep(0.25, 0.6, vRim));
  col = mix(col, ink, zero * 0.62);
  o = vec4(col, 1.0);
}`;

const SAND_VS = `#version 300 es
in vec2 aPos;
uniform vec4 uXf;
uniform float uSize;
void main() {
  gl_Position = vec4(aPos.x * uXf.x + uXf.z, aPos.y * uXf.y + uXf.w, 0.0, 1.0);
  gl_PointSize = uSize;
}`;

const SAND_FS = `#version 300 es
precision mediump float;
out vec4 o;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = dot(p, p);
  if (r > 0.25) discard;
  o = vec4(0.925, 0.890, 0.800, 0.9);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
  return prog;
}

export interface Rect { x: number; y: number; w: number; h: number }

/** The table: a 1 m square of world space (centred on the origin) shown in a screen rectangle. */
export interface View {
  /** Screen rectangle of the table, CSS pixels. */
  rect: Rect;
}

export function worldToScreen(v: View, x: number, y: number): [number, number] {
  return [v.rect.x + (x + 0.5) * v.rect.w, v.rect.y + (0.5 - y) * v.rect.h];
}

export function screenToWorld(v: View, sx: number, sy: number): [number, number] {
  return [(sx - v.rect.x) / v.rect.w - 0.5, 0.5 - (sy - v.rect.y) / v.rect.h];
}

export class DrumGL {
  readonly vao: WebGLVertexArrayObject;
  readonly uBuf: WebGLBuffer;
  readonly count: number;
  sandVao: WebGLVertexArrayObject | null = null;
  sandBuf: WebGLBuffer | null = null;
  sandCount = 0;
  private gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext, prog: WebGLProgram, xy: Float64Array, tri: Uint32Array, rim: Uint8Array) {
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const pos = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(xy), gl.STATIC_DRAW);
    const lp = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(lp);
    gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    this.uBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(xy.length / 2), gl.DYNAMIC_DRAW);
    const lu = gl.getAttribLocation(prog, 'aU');
    gl.enableVertexAttribArray(lu);
    gl.vertexAttribPointer(lu, 1, gl.FLOAT, false, 0, 0);
    const rb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, rb);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(rim), gl.STATIC_DRAW);
    const lr = gl.getAttribLocation(prog, 'aRim');
    gl.enableVertexAttribArray(lr);
    gl.vertexAttribPointer(lr, 1, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tri, gl.STATIC_DRAW);
    this.count = tri.length;
    gl.bindVertexArray(null);
  }

  setSand(prog: WebGLProgram, pos: Float32Array): void {
    const gl = this.gl;
    if (!this.sandVao) {
      this.sandVao = gl.createVertexArray()!;
      gl.bindVertexArray(this.sandVao);
      this.sandBuf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sandBuf);
      const l = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sandBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STREAM_DRAW);
    this.sandCount = pos.length / 2;
  }

  dispose(): void {
    // Buffers are small; let the context reclaim them with the VAOs.
    this.gl.deleteVertexArray(this.vao);
    if (this.sandVao) this.gl.deleteVertexArray(this.sandVao);
  }
}

export interface DrawItem {
  drum: DrumGL;
  view: View;
  u: Float32Array;
  live: number;
  plate: boolean;
  step: number;
}

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly prog: WebGLProgram;
  readonly sandProg: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null>;
  private sloc: Record<string, WebGLUniformLocation | null>;
  dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.prog = compile(gl, VS, FS);
    this.sandProg = compile(gl, SAND_VS, SAND_FS);
    this.loc = Object.fromEntries(['uXf', 'uStep', 'uLive', 'uPlate'].map((n) => [n, gl.getUniformLocation(this.prog, n)]));
    this.sloc = Object.fromEntries(['uXf', 'uSize'].map((n) => [n, gl.getUniformLocation(this.sandProg, n)]));
  }

  resize(w: number, h: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  private xf(v: View): [number, number, number, number] {
    const W = this.canvas.width / this.dpr, H = this.canvas.height / this.dpr;
    // world x -> screen sx = rect.x + (x + 0.5) w -> clip = 2 sx / W - 1
    const sx = (2 * v.rect.w) / W, sy = (2 * v.rect.h) / H;
    const ox = (2 * (v.rect.x + 0.5 * v.rect.w)) / W - 1;
    const oy = 1 - (2 * (v.rect.y + 0.5 * v.rect.h)) / H;
    return [sx, sy, ox, oy];
  }

  draw(items: DrawItem[]): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    for (const it of items) {
      gl.bindBuffer(gl.ARRAY_BUFFER, it.drum.uBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, it.u);
      gl.uniform4f(this.loc.uXf!, ...this.xf(it.view));
      gl.uniform1f(this.loc.uStep!, it.step);
      gl.uniform1f(this.loc.uLive!, it.live);
      gl.uniform1f(this.loc.uPlate!, it.plate ? 1 : 0);
      gl.bindVertexArray(it.drum.vao);
      gl.drawElements(gl.TRIANGLES, it.drum.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    const sandItems = items.filter((i) => i.plate && i.drum.sandVao && i.drum.sandCount);
    if (sandItems.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.sandProg);
      for (const it of sandItems) {
        gl.uniform4f(this.sloc.uXf!, ...this.xf(it.view));
        gl.uniform1f(this.sloc.uSize!, Math.max(1.5, 1.6 * this.dpr * Math.sqrt(it.view.rect.w / 700)));
        gl.bindVertexArray(it.drum.sandVao);
        gl.drawArrays(gl.POINTS, 0, it.drum.sandCount);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }
  }
}
