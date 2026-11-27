// CPU ray casting against a scene, for clicking on objects and for focusing.
import { objectTransform } from './pack';
import type { Scene, SceneObject } from './scene';
import { hitCanonical, shapePlanes } from './shapes';
import { type Vec3, add, invertAffine, mul, xformDir, xformPoint } from './vec';

export type MeshHit = (mesh: string, o: Vec3, d: Vec3) => number | null;

export interface Picked {
  object: SceneObject;
  index: number;
  t: number;
  point: Vec3;
}

/** Nearest object along a ray (direction need not be unit; t is in units of its length). */
export function pick(scene: Scene, o: Vec3, d: Vec3, meshHit: MeshHit, skipLocked = false): Picked | null {
  let best: Picked | null = null;
  scene.objects.forEach((obj, index) => {
    if (skipLocked && obj.locked) return;
    const inv = invertAffine(objectTransform(obj));
    const lo = xformPoint(inv, o);
    const ld = xformDir(inv, d);
    let t: number | null;
    if (obj.shape.kind === 'mesh') t = meshHit(obj.shape.mesh, lo, ld);
    else t = hitCanonical(obj.shape, shapePlanes(obj.shape), lo, ld, 1e-9)?.t ?? null;
    if (t !== null && t > 0 && (!best || t < best.t)) best = { object: obj, index, t, point: add(o, mul(d, t)) };
  });
  return best;
}

/** Where a ray crosses the horizontal plane y = height, or null if it runs away from it. */
export function hitHorizontal(o: Vec3, d: Vec3, height: number): Vec3 | null {
  if (Math.abs(d[1]) < 1e-9) return null;
  const t = (height - o[1]) / d[1];
  if (t <= 0) return null;
  return add(o, mul(d, t));
}
