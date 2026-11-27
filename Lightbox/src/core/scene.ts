// The scene model: what a Lightbox picture is made of. Plain JSON, lengths in metres, angles in
// degrees, light in lumens. This is what share links carry and what the GPU packer consumes.
import type { Vec3 } from './vec';

/** A reflectance or tint, given as an sRGB colour (0..1 per channel, gamma-encoded). */
export type Rgb = [number, number, number];

export type GasName = 'H' | 'He' | 'Ne' | 'Na' | 'Hg' | 'Ar' | 'Kr' | 'Xe';
export type GlassName = 'bk7' | 'silica' | 'sf10' | 'sf11' | 'diamond' | 'water' | 'sapphire';
export type MetalName = 'gold' | 'silver' | 'copper' | 'aluminium';

/** What a light emits, as a spectrum. */
export type LightSpectrum =
  | { kind: 'blackbody'; kelvin: number }
  | { kind: 'd65' }
  | { kind: 'gas'; gas: GasName }
  | { kind: 'laser'; nm: number }
  | { kind: 'led'; nm: number; width: number }
  | { kind: 'equal' };

export type Material =
  | { kind: 'diffuse'; color: Rgb }
  | { kind: 'plastic'; color: Rgb; rough: number }
  | { kind: 'metal'; metal: MetalName; rough: number }
  | { kind: 'mirror' }
  | { kind: 'glass'; glass: GlassName; tint?: Rgb; density?: number; rough?: number }
  /** A diffuse emitter. `lumens` is its total luminous flux. */
  | { kind: 'light'; spectrum: LightSpectrum; lumens: number }
  /** An emitter that shines only within `spread` degrees of its surface normal: a spotlight, a
   *  collimated beam, a laser. Only quads and discs can be beams. */
  | { kind: 'beam'; spectrum: LightSpectrum; lumens: number; spread: number }
  /** An idealised thin transmission grating; grooves run along the quad's local z axis. */
  | { kind: 'grating'; linesPerMm: number };

export type GemCut = 'brilliant' | 'step' | 'octahedron';

export type Shape =
  | { kind: 'sphere'; r: number }
  | { kind: 'box'; half: Vec3 }
  /** Axis along local y; `h` is the half height. */
  | { kind: 'cylinder'; r: number; h: number }
  /** A rectangle in the local xz plane facing +y. */
  | { kind: 'quad'; half: [number, number] }
  | { kind: 'disc'; r: number }
  /** An isosceles triangular prism (apex angle `apex`, base to apex height `size`), or with
   *  `sides` > 3 a regular polygon prism of circumradius `size`. Extruded along local z by
   *  +-`h`. */
  | { kind: 'prism'; sides: number; apex: number; size: number; h: number }
  | { kind: 'gem'; cut: GemCut; r: number }
  /** A lens on the local y axis: aperture radius `r`, centre thickness `t`, and the radii of
   *  curvature of the top (+y) and bottom (-y) faces. Positive is convex, negative concave,
   *  0 flat. */
  | { kind: 'lens'; r: number; t: number; r1: number; r2: number }
  /** A triangle mesh by asset name, scaled so its largest dimension is `size`. */
  | { kind: 'mesh'; mesh: string; size: number };

export interface SceneObject {
  id: string;
  name: string;
  shape: Shape;
  pos: Vec3;
  /** Euler angles in degrees, applied X, then Y, then Z. */
  rot: Vec3;
  material: Material;
  /** Part of the set (walls, floor): not selectable by clicking in the picture. */
  locked?: boolean;
}

export interface Camera {
  pos: Vec3;
  target: Vec3;
  /** Focal length in millimetres on a 36 x 24 mm frame. */
  focal: number;
  /** f-number; the aperture diameter is focal / fstop. 0 means a pinhole. */
  fstop: number;
  /** Distance from the lens to the plane of sharp focus, metres. */
  focus: number;
  /** Shutter time in seconds. */
  shutter: number;
  iso: number;
  /** Aperture blades: 0 for a round aperture. */
  blades: number;
}

export type ToneCurve = 'film' | 'linear' | 'contrast' | 'mono';

export interface Darkroom {
  /** Exposure compensation in stops, applied on top of the camera's exposure. */
  ev: number;
  /** When true the meter picks the exposure and the camera's shutter and ISO are ignored. */
  auto: boolean;
  /** White balance, kelvin. */
  wb: number;
  tone: ToneCurve;
  /** Glare from bright sources, 0..1. */
  bloom: number;
  /** Natural cos^4 falloff of a real lens, on or off. */
  vignette: boolean;
}

export interface Environment {
  /** Luminance of a uniform surround, cd/m2; 0 is a dark room. */
  luminance: number;
  spectrum: LightSpectrum;
}

export interface Scene {
  v: 1;
  name: string;
  objects: SceneObject[];
  camera: Camera;
  darkroom: Darkroom;
  env: Environment;
  /** Longest path, in bounces. */
  bounces: number;
}

export const SENSOR_HEIGHT_MM = 24;
export const SENSOR_WIDTH_MM = 36;

export const defaultCamera = (): Camera => ({
  pos: [0, 0.6, 1.6], target: [0, 0.25, 0], focal: 50, fstop: 4, focus: 1.6, shutter: 1 / 60, iso: 400, blades: 0,
});
export const defaultDarkroom = (): Darkroom => ({ ev: 0, auto: true, wb: 5000, tone: 'film', bloom: 0.15, vignette: false });

export function isEmitter(m: Material): m is Extract<Material, { kind: 'light' | 'beam' }> {
  return m.kind === 'light' || m.kind === 'beam';
}

/** True when a ray meeting this material is deflected in exactly one or two directions. */
export function isDelta(m: Material): boolean {
  return m.kind === 'mirror' || m.kind === 'grating' || (m.kind === 'glass' && !(m.rough && m.rough > 0)) || (m.kind === 'metal' && m.rough <= 0);
}

let idCounter = 0;
/** A short id, unique within a session. Scenes keep their ids when serialised. */
export function newId(prefix = 'o'): string {
  idCounter += 1;
  return `${prefix}${idCounter.toString(36)}`;
}
/** Make sure new ids do not collide with the ids of a loaded scene. */
export function reserveIds(scene: Scene): void {
  for (const o of scene.objects) {
    const n = parseInt(o.id.slice(1), 36);
    if (Number.isFinite(n) && n > idCounter) idCounter = n;
  }
}

export function cloneScene(s: Scene): Scene {
  return JSON.parse(JSON.stringify(s)) as Scene;
}
