// Physics frame -> render frame (architecture.md section 3).
// Physics: metres, x east, y north, z altitude above sea level.
// Render (three.js, Y up): X = x, Y = z - GROUND_ALT_M, Z = -y. 1 unit = 1 m.
import type * as THREE from 'three/webgpu';

/** Altitude of the physics ground plane (and of render Y = 0), metres above sea level. */
export const GROUND_ALT_M = 1539;

export interface RenderPoint {
  x: number;
  y: number;
  z: number;
}

/** Convert a physics-frame point (east, north, altitude) to render coordinates. */
export function toRender(x: number, y: number, z: number): RenderPoint {
  return { x, y: z - GROUND_ALT_M, z: -y };
}

/** Allocation-free variant of {@link toRender}: writes into `v` and returns it. */
export function toRenderInto(v: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
  v.x = x;
  v.y = z - GROUND_ALT_M;
  v.z = -y;
  return v;
}
