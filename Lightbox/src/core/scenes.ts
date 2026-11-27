// Built-in scenes. Lengths in metres; the table top is y = 0, the camera looks along -z.
import { type Camera, type Material, type Rgb, type Scene, type SceneObject, type Shape, defaultCamera, defaultDarkroom, newId } from './scene';
import { restHeight } from './shapes';
import { glassIndex } from './spectrum';
import type { Vec3 } from './vec';

export function obj(name: string, shape: Shape, material: Material, pos: Vec3, rot: Vec3 = [0, 0, 0], locked = false): SceneObject {
  const o: SceneObject = { id: newId(), name, shape, pos, rot, material };
  if (locked) o.locked = true;
  return o;
}

/** Place a shape so it rests on the table at (x, z). */
export function onTable(name: string, shape: Shape, material: Material, x: number, z: number, rot: Vec3 = [0, 0, 0]): SceneObject {
  return obj(name, shape, material, [x, restHeight(shape), z], rot);
}

const matte = (color: Rgb): Material => ({ kind: 'diffuse', color });
const glass = (g: Extract<Material, { kind: 'glass' }>['glass'] = 'bk7'): Material => ({ kind: 'glass', glass: g });
const lamp = (kelvin: number, lumens: number): Material => ({ kind: 'light', spectrum: { kind: 'blackbody', kelvin }, lumens });

/** A table top and a wall behind it. */
function backdrop(color: Rgb = [0.78, 0.78, 0.76], wall: Rgb = color): SceneObject[] {
  return [
    obj('Table', { kind: 'quad', half: [4, 4] }, matte(color), [0, 0, 0], [0, 0, 0], true),
    obj('Backdrop', { kind: 'quad', half: [4, 2] }, matte(wall), [0, 2, -1.6], [90, 0, 0], true),
  ];
}

function scene(name: string, objects: SceneObject[], camera: Partial<Camera>, extra: Partial<Scene> = {}): Scene {
  return { v: 1, name, objects, camera: { ...defaultCamera(), ...camera }, darkroom: defaultDarkroom(), env: { luminance: 0, spectrum: { kind: 'd65' } }, bounces: 12, ...extra };
}

export function stillLife(): Scene {
  return scene('Still life', [
    ...backdrop(),
    obj('Softbox', { kind: 'quad', half: [0.45, 0.3] }, lamp(5200, 2600), [-0.5, 1.25, 0.5], [180, 0, 25]),
    onTable('Glass ball', { kind: 'sphere', r: 0.1 }, glass(), -0.24, 0.14),
    onTable('Wine glass', { kind: 'mesh', mesh: 'wineglass', size: 0.3 }, glass(), 0.04, -0.22),
    onTable('Gold knot', { kind: 'mesh', mesh: 'knot', size: 0.2 }, { kind: 'metal', metal: 'gold', rough: 0.12 }, 0.36, 0.06, [0, -20, 0]),
    onTable('Red block', { kind: 'box', half: [0.07, 0.07, 0.07] }, { kind: 'plastic', color: [0.8, 0.12, 0.1], rough: 0 }, -0.44, -0.3, [0, 20, 0]),
    obj('Neon tube', { kind: 'cylinder', r: 0.012, h: 0.3 }, { kind: 'light', spectrum: { kind: 'gas', gas: 'Ne' }, lumens: 260 }, [0.62, 0.32, -0.7], [0, 0, 20]),
  ], { pos: [0.05, 0.5, 1.45], target: [0.02, 0.14, 0], focus: 1.5 });
}

/** Deviation (radians) of a ray through a 60 degree prism set for minimum deviation at 550 nm. */
export function prismDeviation(nm: number, glassName: Parameters<typeof glassIndex>[0] = 'sf11'): number {
  const A = Math.PI / 3;
  const i = Math.asin(glassIndex(glassName, 550) * Math.sin(A / 2));
  const n = glassIndex(glassName, nm);
  const r1 = Math.asin(Math.sin(i) / n);
  return i + Math.asin(Math.min(1, n * Math.sin(A - r1))) - A;
}

/**
 * Where to stand an upright 60 degree prism (triangle height `size`) so that a ray travelling
 * along +x through the origin crosses it symmetrically, entering and leaving at the middle of
 * its faces: the prism's centre (x, z), its turn about the vertical in degrees, the point where
 * the ray leaves and the direction it leaves in (for 550 nm light).
 */
export function minimumDeviation(size: number, glassName: Parameters<typeof glassIndex>[0] = 'sf11'): { centre: [number, number]; turn: number; exit: [number, number]; out: [number, number] } {
  const dev = prismDeviation(550, glassName);
  const psi = dev / 2;
  const w = size * Math.tan(Math.PI / 6);
  const b: [number, number] = [Math.cos(psi), -Math.sin(psi)];
  const a: [number, number] = [Math.sin(psi), Math.cos(psi)];
  const centre: [number, number] = [(w / 2) * b[0] - (size / 6) * a[0], (w / 2) * b[1] - (size / 6) * a[1]];
  return { centre, turn: (psi * 180) / Math.PI, exit: [w * b[0], w * b[1]], out: [Math.cos(dev), -Math.sin(dev)] };
}

/** A slit of white light through a dense flint prism at minimum deviation, onto a card. */
export function newtonPrism(): Scene {
  const m = minimumDeviation(0.1);
  const s = scene('Prism and beam', [
    ...backdrop([0.3, 0.3, 0.3], [0.16, 0.16, 0.17]),
    obj('Fill light', { kind: 'quad', half: [0.4, 0.4] }, lamp(4500, 110), [0, 1.6, 0.6], [180, 0, 0]),
    obj('Slit lamp', { kind: 'quad', half: [0.035, 0.0025] }, { kind: 'beam', spectrum: { kind: 'blackbody', kelvin: 5600 }, lumens: 0.7, spread: 0.25 }, [-0.75, 0.06, 0], [0, 0, -90]),
    obj('Prism', { kind: 'prism', sides: 3, apex: 60, size: 0.1, h: 0.06 }, glass('sf11'), [m.centre[0], 0.06, m.centre[1]], [90, m.turn, 0]),
    obj('Card', { kind: 'box', half: [0.3, 0.16, 0.004] }, matte([0.92, 0.92, 0.9]), [m.exit[0] + 0.8 * m.out[0], 0.16, m.exit[1] + 0.8 * m.out[1]], [0, (Math.atan2(-m.out[0], -m.out[1]) * 180) / Math.PI, 0]),
  ], { pos: [-0.4, 0.5, 0.62], target: [0.2, 0.1, -0.42], focus: 1.25, focal: 35 });
  s.bounces = 16;
  s.darkroom.ev = -0.6;
  return s;
}

export function gems(): Scene {
  const dark: Rgb = [0.045, 0.045, 0.05];
  const bulb = (x: number, y: number, z: number, k: number): SceneObject => obj('Pin light', { kind: 'sphere', r: 0.012 }, lamp(k, 420), [x, y, z]);
  const s = scene('Gems', [
    ...backdrop(dark, dark),
    obj('Softbox', { kind: 'quad', half: [0.25, 0.18] }, lamp(5600, 500), [0.1, 0.7, 0.35], [180, 0, 0]),
    bulb(-0.35, 0.45, 0.2, 5600), bulb(0.4, 0.5, -0.1, 5600), bulb(-0.05, 0.55, -0.4, 6500), bulb(0.25, 0.4, 0.45, 4500),
    obj('Diamond', { kind: 'gem', cut: 'brilliant', r: 0.055 }, glass('diamond'), [0, 0.052, 0], [12, 20, 8]),
    obj('Emerald', { kind: 'gem', cut: 'step', r: 0.04 }, { kind: 'glass', glass: 'sapphire', tint: [0.08, 0.62, 0.3], density: 22 }, [-0.16, 0.044, 0.07], [5, 35, -6]),
    obj('Sapphire', { kind: 'gem', cut: 'brilliant', r: 0.035 }, { kind: 'glass', glass: 'sapphire', tint: [0.1, 0.22, 0.8], density: 30 }, [0.15, 0.034, 0.08], [-10, 0, 14]),
    obj('Crystal', { kind: 'gem', cut: 'octahedron', r: 0.04 }, glass('silica'), [0.07, 0.024, 0.19], [35.3, 0, 45]),
  ], { pos: [0.04, 0.42, 0.8], target: [0, 0.03, 0.05], focal: 62, fstop: 8, focus: 0.88 });
  s.bounces = 32;
  s.darkroom.ev = -1.8;
  return s;
}

export function glassware(): Scene {
  return scene('Glassware', [
    ...backdrop([0.75, 0.75, 0.74], [0.5, 0.5, 0.5]),
    obj('Back light', { kind: 'quad', half: [0.6, 0.4] }, lamp(5600, 2400), [0.1, 0.5, -1.2], [90, 0, 0]),
    obj('Key light', { kind: 'quad', half: [0.2, 0.2] }, lamp(4200, 900), [-0.9, 0.9, 0.5], [180, 0, 50]),
    onTable('Wine glass', { kind: 'mesh', mesh: 'wineglass', size: 0.32 }, glass(), -0.1, 0),
    onTable('Tumbler', { kind: 'mesh', mesh: 'tumbler', size: 0.13 }, glass(), 0.22, 0.12),
    onTable('Cat', { kind: 'mesh', mesh: 'cat', size: 0.2 }, { kind: 'glass', glass: 'bk7', tint: [0.1, 0.5, 0.6], density: 14 }, -0.42, 0.1, [0, 25, 0]),
    onTable('Knot', { kind: 'mesh', mesh: 'knot', size: 0.16 }, { kind: 'metal', metal: 'gold', rough: 0.08 }, 0.5, -0.12, [0, 30, 0]),
  ], { pos: [0.05, 0.4, 1.35], target: [0.03, 0.13, 0], focus: 1.35, focal: 42, fstop: 5.6 });
}

/** A collimated beam through a lens, sliced by the table so the cone of light draws itself. */
export function lensBench(): Scene {
  return scene('Lens bench', [
    ...backdrop([0.82, 0.82, 0.8], [0.2, 0.2, 0.21]),
    obj('Fill light', { kind: 'quad', half: [0.4, 0.4] }, lamp(4500, 90), [0, 1.6, 0.4], [180, 0, 0]),
    obj('Beam', { kind: 'disc', r: 0.075 }, { kind: 'beam', spectrum: { kind: 'blackbody', kelvin: 5600 }, lumens: 45, spread: 0.12 }, [-0.62, 0.012, 0], [0, 0, -90]),
    obj('Lens', { kind: 'lens', r: 0.085, t: 0.04, r1: 0.22, r2: 0.22 }, glass('sf11'), [-0.2, 0.012, 0], [0, 0, 90]),
    obj('Card', { kind: 'box', half: [0.004, 0.11, 0.14] }, matte([0.92, 0.92, 0.9]), [0.42, 0.11, 0]),
  ], { pos: [0.0, 1.05, 0.75], target: [-0.02, 0, 0], focus: 1.25, focal: 40, fstop: 0 }, { darkroom: { ...defaultDarkroom(), ev: -0.4 } });
}

export function cornellBox(): Scene {
  const white: Rgb = [0.74, 0.74, 0.72];
  const wallQ = (name: string, color: Rgb, pos: Vec3, rot: Vec3): SceneObject => obj(name, { kind: 'quad', half: [0.5, 0.5] }, matte(color), pos, rot, true);
  return scene('Box', [
    wallQ('Floor', white, [0, 0, 0], [0, 0, 0]),
    wallQ('Ceiling', white, [0, 1, 0], [180, 0, 0]),
    wallQ('Back wall', white, [0, 0.5, -0.5], [90, 0, 0]),
    wallQ('Left wall', [0.63, 0.065, 0.05], [-0.5, 0.5, 0], [0, 0, -90]),
    wallQ('Right wall', [0.14, 0.45, 0.091], [0.5, 0.5, 0], [0, 0, 90]),
    obj('Lamp', { kind: 'quad', half: [0.12, 0.1] }, lamp(4000, 1500), [0, 0.999, 0], [180, 0, 0]),
    obj('Tall block', { kind: 'box', half: [0.15, 0.3, 0.15] }, matte(white), [-0.17, 0.3, -0.15], [0, 17, 0]),
    onTable('Glass ball', { kind: 'sphere', r: 0.16 }, glass(), 0.2, 0.16),
  ], { pos: [0, 0.5, 1.9], target: [0, 0.5, 0], focus: 1.9, focal: 40, fstop: 0 });
}

export function gasTubes(): Scene {
  const tube = (gas: 'Ne' | 'He' | 'Hg' | 'H' | 'Ar', x: number): SceneObject =>
    obj(`${gas} tube`, { kind: 'cylinder', r: 0.011, h: 0.26 }, { kind: 'light', spectrum: { kind: 'gas', gas }, lumens: 160 }, [x, 0.34, -0.5]);
  return scene('Gas tubes', [
    obj('Table', { kind: 'quad', half: [4, 4] }, { kind: 'plastic', color: [0.03, 0.03, 0.035], rough: 0.12 }, [0, 0, 0], [0, 0, 0], true),
    obj('Backdrop', { kind: 'quad', half: [4, 2] }, matte([0.06, 0.06, 0.065]), [0, 2, -0.75], [90, 0, 0], true),
    tube('H', -0.6), tube('He', -0.3), tube('Ne', 0), tube('Hg', 0.3), tube('Ar', 0.6),
    onTable('Chrome ball', { kind: 'sphere', r: 0.1 }, { kind: 'metal', metal: 'silver', rough: 0 }, -0.15, 0.05),
    onTable('White block', { kind: 'box', half: [0.07, 0.07, 0.07] }, matte([0.85, 0.85, 0.83]), 0.25, 0.0, [0, 30, 0]),
  ], { pos: [0, 0.4, 1.35], target: [0, 0.2, -0.2], focus: 1.6, focal: 40 }, { darkroom: { ...defaultDarkroom(), bloom: 0.35, ev: -2.2 } });
}

export interface SceneEntry { id: string; title: string; make: () => Scene }
export const SCENES: SceneEntry[] = [
  { id: 'still', title: 'Still life', make: stillLife },
  { id: 'prism', title: 'Prism and beam', make: newtonPrism },
  { id: 'gems', title: 'Gems', make: gems },
  { id: 'glass', title: 'Glassware', make: glassware },
  { id: 'lens', title: 'Lens bench', make: lensBench },
  { id: 'tubes', title: 'Gas tubes', make: gasTubes },
  { id: 'box', title: 'Box', make: cornellBox },
];
export const sceneById = (id: string): SceneEntry | undefined => SCENES.find((s) => s.id === id);
