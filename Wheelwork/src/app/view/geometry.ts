// From the mesh kit's indexed solids to drawable geometry: normals that are smooth along a turned
// or involute surface and sharp at real edges, and texture coordinates where a material wants them.
import * as THREE from 'three';
import { type Mesh } from '../../core/mesh/types';

export type UvMode = 'none' | 'planar' | 'sphere';

export interface GeometryOptions {
  /** Edges sharper than this stay sharp (radians). */
  crease?: number;
  uv?: UvMode;
  /** planar: half-width of the square mapped to the texture. sphere: unused. */
  extent?: number;
  /** sphere: centre of the ball. */
  centre?: readonly [number, number, number];
  /** sphere: rotation about Y (radians) that was applied to the ball, undone for the lookup. */
  lean?: number;
}

export function toGeometry(mesh: Mesh, options: GeometryOptions = {}): THREE.BufferGeometry {
  const crease = options.crease ?? 0.6;
  const cosCrease = Math.cos(crease);
  const p = mesh.positions;
  const ix = mesh.indices;
  const tris = ix.length / 3;
  const nVerts = p.length / 3;

  // Face normals, area-weighted (not normalised) and unit.
  const fn = new Float32Array(tris * 3);
  const fu = new Float32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    const a = ix[3 * t]! * 3, b = ix[3 * t + 1]! * 3, c = ix[3 * t + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    fn[3 * t] = nx; fn[3 * t + 1] = ny; fn[3 * t + 2] = nz;
    fu[3 * t] = nx / len; fu[3 * t + 1] = ny / len; fu[3 * t + 2] = nz / len;
  }
  // Faces around each vertex.
  const count = new Uint32Array(nVerts + 1);
  for (let i = 0; i < ix.length; i++) count[ix[i]! + 1]!++;
  for (let v = 0; v < nVerts; v++) count[v + 1]! += count[v]!;
  const fill = count.slice(0, nVerts);
  const faces = new Uint32Array(ix.length);
  for (let i = 0; i < ix.length; i++) faces[fill[ix[i]!]!++] = (i / 3) | 0;

  const pos = new Float32Array(tris * 9);
  const nor = new Float32Array(tris * 9);
  for (let t = 0; t < tris; t++) {
    const ax = fu[3 * t]!, ay = fu[3 * t + 1]!, az = fu[3 * t + 2]!;
    for (let k = 0; k < 3; k++) {
      const v = ix[3 * t + k]!;
      let nx = 0, ny = 0, nz = 0;
      for (let j = count[v]!; j < count[v + 1]!; j++) {
        const f = faces[j]!;
        if (fu[3 * f]! * ax + fu[3 * f + 1]! * ay + fu[3 * f + 2]! * az >= cosCrease) {
          nx += fn[3 * f]!; ny += fn[3 * f + 1]!; nz += fn[3 * f + 2]!;
        }
      }
      const len = Math.hypot(nx, ny, nz) || 1;
      const o = 9 * t + 3 * k;
      pos[o] = p[3 * v]!; pos[o + 1] = p[3 * v + 1]!; pos[o + 2] = p[3 * v + 2]!;
      nor[o] = nx / len; nor[o + 1] = ny / len; nor[o + 2] = nz / len;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));

  const mode = options.uv ?? 'none';
  if (mode !== 'none') {
    const uv = new Float32Array(tris * 6);
    if (mode === 'planar') {
      const e = options.extent ?? 1;
      for (let i = 0; i < tris * 3; i++) {
        uv[2 * i] = pos[3 * i]! / (2 * e) + 0.5;
        uv[2 * i + 1] = pos[3 * i + 1]! / (2 * e) + 0.5;
      }
    } else {
      const [cx, cy, cz] = options.centre ?? [0, 0, 0];
      const cl = Math.cos(-(options.lean ?? 0));
      const sl = Math.sin(-(options.lean ?? 0));
      for (let t = 0; t < tris; t++) {
        const us: number[] = [];
        for (let k = 0; k < 3; k++) {
          const o = 9 * t + 3 * k;
          const dx0 = pos[o]! - cx, dy = pos[o + 1]! - cy, dz0 = pos[o + 2]! - cz;
          // Undo the lean (a rotation about Y) to get the ball's own latitude and longitude.
          const dx = dx0 * cl + dz0 * sl;
          const dz = -dx0 * sl + dz0 * cl;
          const r = Math.hypot(dx, dy, dz) || 1;
          us.push(Math.atan2(dy, dx) / (2 * Math.PI) + 0.5);
          uv[6 * t + 2 * k + 1] = Math.asin(Math.max(-1, Math.min(1, dz / r))) / Math.PI + 0.5;
        }
        // Keep a triangle on one side of the seam; the texture repeats.
        const max = Math.max(...us);
        for (let k = 0; k < 3; k++) uv[6 * t + 2 * k] = max - us[k]! > 0.5 ? us[k]! + 1 : us[k]!;
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
