// Thin WebGL2 helpers: programs with cached uniform locations, float data textures and
// framebuffers.

export class Program {
  readonly handle: WebGLProgram;
  private readonly locs = new Map<string, WebGLUniformLocation | null>();
  private readonly shaders: WebGLShader[] = [];

  constructor(private readonly gl: WebGL2RenderingContext, readonly name: string, vert: string, frag: string) {
    const p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      gl.attachShader(p, s);
      this.shaders.push(s);
    }
    gl.linkProgram(p);
    this.handle = p;
  }

  /** True once the driver has finished compiling and linking (never blocks where the
   *  parallel-compile extension exists). */
  done(ext: KHR_parallel_shader_compile | null): boolean {
    if (!ext) return true;
    return this.gl.getProgramParameter(this.handle, ext.COMPLETION_STATUS_KHR) as boolean;
  }

  /** Throws with the driver's log if compilation or linking failed. */
  check(): void {
    const gl = this.gl;
    if (gl.getProgramParameter(this.handle, gl.LINK_STATUS)) return;
    const logs = this.shaders.map((s) => gl.getShaderInfoLog(s) ?? '').join('\n');
    throw new Error(`shader program "${this.name}" failed: ${gl.getProgramInfoLog(this.handle) ?? ''}\n${logs}`);
  }

  use(): void { this.gl.useProgram(this.handle); }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.handle, name);
      this.locs.set(name, l);
    }
    return l;
  }
  i(name: string, v: number): void { this.gl.uniform1i(this.loc(name), v); }
  ui(name: string, v: number): void { this.gl.uniform1ui(this.loc(name), v >>> 0); }
  f(name: string, v: number): void { this.gl.uniform1f(this.loc(name), v); }
  v2(name: string, x: number, y: number): void { this.gl.uniform2f(this.loc(name), x, y); }
  v3(name: string, v: readonly number[]): void { this.gl.uniform3f(this.loc(name), v[0]!, v[1]!, v[2]!); }
  m3(name: string, rowMajor: readonly number[]): void { this.gl.uniformMatrix3fv(this.loc(name), true, rowMajor as number[]); }
  uiv(name: string, v: Uint32Array): void { this.gl.uniform1uiv(this.loc(name), v); }
  fv(name: string, v: Float32Array): void { this.gl.uniform1fv(this.loc(name), v); }
  tex(name: string, unit: number, t: WebGLTexture | null): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(this.loc(name), unit);
  }
}

export type TexFormat = 'rgba32f' | 'r32f' | 'rgba16f' | 'rgba8';

export function createTexture(gl: WebGL2RenderingContext, format: TexFormat, w: number, h: number, data: ArrayBufferView | null = null, linear = false): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  const [internal, fmt, type] = format === 'rgba32f' ? [gl.RGBA32F, gl.RGBA, gl.FLOAT]
    : format === 'r32f' ? [gl.R32F, gl.RED, gl.FLOAT]
      : format === 'rgba16f' ? [gl.RGBA16F, gl.RGBA, data ? gl.FLOAT : gl.HALF_FLOAT]
        : [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE];
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, fmt, type, data);
  const filter = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function createFramebuffer(gl: WebGL2RenderingContext, attachments: WebGLTexture[], depth: WebGLRenderbuffer | null = null): WebGLFramebuffer {
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  attachments.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  gl.drawBuffers(attachments.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fb;
}

/** A data texture of 4-float texels laid out `width` per row; pads the array to full rows. */
export function dataTexture(gl: WebGL2RenderingContext, data: Float32Array, width: number, channels: 1 | 4 = 4): { tex: WebGLTexture; rows: number } {
  const perRow = width * channels;
  const rows = Math.max(1, Math.ceil(data.length / perRow));
  let d = data;
  if (d.length !== rows * perRow) {
    d = new Float32Array(rows * perRow);
    d.set(data);
  }
  return { tex: createTexture(gl, channels === 4 ? 'rgba32f' : 'r32f', width, rows, d), rows };
}
