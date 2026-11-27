// Built-in scenes. Lengths in metres; the table top is y = 0.
import { type Material, type Scene, type SceneObject, type Shape, defaultCamera, defaultDarkroom, newId } from './scene';
import { restHeight } from './shapes';
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

const WHITE: Material = { kind: 'diffuse', color: [0.82, 0.82, 0.8] };

/** A table top and a curved-looking backdrop: floor plus back wall. */
function backdrop(color: [number, number, number] = [0.78, 0.78, 0.76]): SceneObject[] {
  const m: Material = { kind: 'diffuse', color };
  return [
    obj('Table', { kind: 'quad', half: [4, 4] }, m, [0, 0, 0], [0, 0, 0], true),
    obj('Backdrop', { kind: 'quad', half: [4, 2] }, m, [0, 2, -1.6], [90, 0, 0], true),
  ];
}

export function studioScene(): Scene {
  return {
    v: 1,
    name: 'Still life',
    objects: [
      ...backdrop(),
      obj('Softbox', { kind: 'quad', half: [0.45, 0.3] }, { kind: 'light', spectrum: { kind: 'blackbody', kelvin: 5200 }, lumens: 2600 }, [-0.5, 1.25, 0.5], [180, 0, 25]),
      onTable('Glass ball', { kind: 'sphere', r: 0.12 }, { kind: 'glass', glass: 'bk7' }, -0.2, 0.05),
      onTable('Gold ball', { kind: 'sphere', r: 0.09 }, { kind: 'metal', metal: 'gold', rough: 0.25 }, 0.18, -0.2),
      onTable('Prism', { kind: 'prism', sides: 3, apex: 60, size: 0.12, h: 0.1 }, { kind: 'glass', glass: 'sf11' }, 0.22, 0.18, [0, 35, 0]),
      onTable('Red block', { kind: 'box', half: [0.07, 0.07, 0.07] }, { kind: 'plastic', color: [0.8, 0.12, 0.1], rough: 0 }, -0.48, -0.25, [0, 20, 0]),
      obj('Neon tube', { kind: 'cylinder', r: 0.012, h: 0.3 }, { kind: 'light', spectrum: { kind: 'gas', gas: 'Ne' }, lumens: 300 }, [0.45, 0.32, -0.6], [0, 0, 20]),
    ],
    camera: { ...defaultCamera(), pos: [0.05, 0.55, 1.5], target: [0, 0.14, 0], focus: 1.5 },
    darkroom: defaultDarkroom(),
    env: { luminance: 0, spectrum: { kind: 'd65' } },
    bounces: 12,
  };
}

export { WHITE };
