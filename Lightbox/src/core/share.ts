// Scenes as text: validation of anything loaded from outside, and the compact form used in
// share links. Compression itself needs browser streams and lives in the app.
import { type Camera, type Darkroom, type Material, type Scene, type SceneObject, type Shape, defaultCamera, defaultDarkroom } from './scene';
import type { Vec3 } from './vec';

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const vec3 = (v: unknown, lo: number, hi: number, fallback: Vec3): Vec3 =>
  Array.isArray(v) && v.length === 3 ? [num(v[0], lo, hi, fallback[0]), num(v[1], lo, hi, fallback[1]), num(v[2], lo, hi, fallback[2])] : fallback;
const rgb = (v: unknown): Vec3 => vec3(v, 0, 1, [0.8, 0.8, 0.8]);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

const GASES = ['H', 'He', 'Ne', 'Na', 'Hg', 'Ar', 'Kr', 'Xe'] as const;
const GLASS = ['bk7', 'silica', 'sf10', 'sf11', 'diamond', 'water', 'sapphire'] as const;
const METAL = ['gold', 'silver', 'copper', 'aluminium'] as const;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});

function spectrum(v: unknown): Extract<Material, { kind: 'light' }>['spectrum'] {
  const s = rec(v);
  switch (s.kind) {
    case 'd65': return { kind: 'd65' };
    case 'equal': return { kind: 'equal' };
    case 'gas': return { kind: 'gas', gas: oneOf(s.gas, GASES, 'Ne') };
    case 'laser': return { kind: 'laser', nm: num(s.nm, 400, 700, 633) };
    case 'led': return { kind: 'led', nm: num(s.nm, 400, 700, 460), width: num(s.width, 5, 150, 25) };
    default: return { kind: 'blackbody', kelvin: num(s.kelvin, 1000, 20000, 5000) };
  }
}

function material(v: unknown): Material {
  const m = rec(v);
  switch (m.kind) {
    case 'plastic': return { kind: 'plastic', color: rgb(m.color), rough: num(m.rough, 0, 1, 0) };
    case 'metal': return { kind: 'metal', metal: oneOf(m.metal, METAL, 'gold'), rough: num(m.rough, 0, 1, 0.1) };
    case 'mirror': return { kind: 'mirror' };
    case 'glass': {
      const g: Extract<Material, { kind: 'glass' }> = { kind: 'glass', glass: oneOf(m.glass, GLASS, 'bk7') };
      if (Array.isArray(m.tint)) { g.tint = rgb(m.tint); g.density = num(m.density, 0, 2000, 20); }
      return g;
    }
    case 'light': return { kind: 'light', spectrum: spectrum(m.spectrum), lumens: num(m.lumens, 0, 1e7, 800) };
    case 'beam': return { kind: 'beam', spectrum: spectrum(m.spectrum), lumens: num(m.lumens, 0, 1e7, 200), spread: num(m.spread, 0.05, 89, 2) };
    case 'grating': return { kind: 'grating', linesPerMm: num(m.linesPerMm, 50, 2400, 600) };
    default: return { kind: 'diffuse', color: rgb(m.color) };
  }
}

function shape(v: unknown): Shape | null {
  const s = rec(v);
  const size = (x: unknown, fallback: number) => num(x, 1e-3, 20, fallback);
  switch (s.kind) {
    case 'sphere': return { kind: 'sphere', r: size(s.r, 0.1) };
    case 'box': return { kind: 'box', half: vec3(s.half, 1e-3, 20, [0.1, 0.1, 0.1]) };
    case 'cylinder': return { kind: 'cylinder', r: size(s.r, 0.05), h: size(s.h, 0.1) };
    case 'quad': {
      const h = Array.isArray(s.half) ? s.half : [];
      return { kind: 'quad', half: [size(h[0], 0.2), size(h[1], 0.2)] };
    }
    case 'disc': return { kind: 'disc', r: size(s.r, 0.1) };
    case 'prism': return { kind: 'prism', sides: Math.round(num(s.sides, 3, 12, 3)), apex: num(s.apex, 10, 150, 60), size: size(s.size, 0.1), h: size(s.h, 0.1) };
    case 'gem': return { kind: 'gem', cut: oneOf(s.cut, ['brilliant', 'step', 'octahedron'] as const, 'brilliant'), r: size(s.r, 0.05) };
    case 'lens': {
      // A face flatter than 1 mm of radius is not a lens; treat tiny radii as flat.
      const radius = (v: unknown, fallback: number) => { const R = num(v, -50, 50, fallback); return Math.abs(R) < 1e-3 ? 0 : R; };
      return { kind: 'lens', r: size(s.r, 0.08), t: size(s.t, 0.03), r1: radius(s.r1, 0.2), r2: radius(s.r2, 0.2) };
    }
    case 'mesh': return typeof s.mesh === 'string' && /^[a-z][a-z0-9]{0,31}$/.test(s.mesh) ? { kind: 'mesh', mesh: s.mesh, size: size(s.size, 0.3) } : null;
    default: return null;
  }
}

function camera(v: unknown): Camera {
  const c = rec(v);
  const d = defaultCamera();
  return {
    pos: vec3(c.pos, -100, 100, d.pos), target: vec3(c.target, -100, 100, d.target),
    focal: num(c.focal, 10, 400, d.focal), fstop: num(c.fstop, 0, 64, d.fstop), focus: num(c.focus, 0.02, 200, d.focus),
    shutter: num(c.shutter, 1e-5, 60, d.shutter), iso: num(c.iso, 25, 102400, d.iso), blades: Math.round(num(c.blades, 0, 12, 0)),
  };
}

function darkroom(v: unknown): Darkroom {
  const c = rec(v);
  const d = defaultDarkroom();
  return {
    ev: num(c.ev, -10, 10, 0), auto: typeof c.auto === 'boolean' ? c.auto : d.auto, wb: num(c.wb, 1500, 15000, d.wb),
    tone: oneOf(c.tone, ['film', 'linear', 'contrast', 'mono'] as const, d.tone), bloom: num(c.bloom, 0, 1, d.bloom),
    vignette: c.vignette === true,
  };
}

/**
 * Rebuild a scene from untrusted JSON: every number is clamped to a sane range, unknown kinds
 * are dropped, and nothing but the fields of the scene model survives. Throws if the result
 * would be empty.
 */
export function sanitizeScene(input: unknown): Scene {
  const s = rec(input);
  const objects: SceneObject[] = [];
  const list = Array.isArray(s.objects) ? s.objects.slice(0, 64) : [];
  list.forEach((raw, i) => {
    const o = rec(raw);
    const sh = shape(o.shape);
    if (!sh) return;
    const out: SceneObject = {
      id: `o${(i + 1).toString(36)}`,
      name: typeof o.name === 'string' ? o.name.slice(0, 40) : sh.kind,
      shape: sh,
      pos: vec3(o.pos, -100, 100, [0, 0, 0]),
      rot: vec3(o.rot, -3600, 3600, [0, 0, 0]),
      material: material(o.material),
    };
    if (o.locked === true) out.locked = true;
    objects.push(out);
  });
  if (!objects.length) throw new Error('The scene has no objects.');
  const env = rec(s.env);
  return {
    v: 1,
    name: typeof s.name === 'string' ? s.name.slice(0, 60) : 'Shared scene',
    objects,
    camera: camera(s.camera),
    darkroom: darkroom(s.darkroom),
    env: { luminance: num(env.luminance, 0, 1e6, 0), spectrum: spectrum(env.spectrum) },
    bounces: Math.round(num(s.bounces, 1, 64, 12)),
  };
}

/** Round the numbers in a scene so its JSON is short (a tenth of a millimetre, a tenth of a degree). */
export function compactScene(scene: Scene): string {
  return JSON.stringify(scene, (_k, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : (v as unknown)));
}

export const toBase64Url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const fromBase64Url = (text: string): Uint8Array => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
