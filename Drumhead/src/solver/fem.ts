// Linear finite elements for the clamped membrane: -Laplace(u) = lambda u inside, u = 0 on the rim.
// Stiffness K and lumped (diagonal) mass M over the free vertices only.

import { type Mesh } from './mesh';

export interface System {
  /** Number of free vertices (unknowns). */
  n: number;
  /** free index -> mesh vertex */
  dof: Int32Array;
  /** mesh vertex -> free index, or -1 on the rim */
  index: Int32Array;
  /** K in compressed sparse rows (symmetric, both triangles stored). */
  rowPtr: Int32Array;
  col: Int32Array;
  val: Float64Array;
  /** Lumped mass per free vertex. */
  mass: Float64Array;
}

export function assemble(mesh: Mesh): System {
  const nv = mesh.xy.length / 2;
  const used = new Uint8Array(nv);
  for (const v of mesh.tri) used[v] = 1;
  const index = new Int32Array(nv).fill(-1);
  const dofList: number[] = [];
  for (let v = 0; v < nv; v++) if (used[v] && !mesh.rim[v]) { index[v] = dofList.length; dofList.push(v); }
  const n = dofList.length;

  const rows: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  const mass = new Float64Array(n);
  const { xy, tri } = mesh;
  for (let t = 0; t < tri.length; t += 3) {
    const v = [tri[t]!, tri[t + 1]!, tri[t + 2]!];
    const x = v.map((i) => xy[2 * i]!), y = v.map((i) => xy[2 * i + 1]!);
    const b = [y[1]! - y[2]!, y[2]! - y[0]!, y[0]! - y[1]!];
    const c = [x[2]! - x[1]!, x[0]! - x[2]!, x[1]! - x[0]!];
    const area = 0.5 * (b[0]! * c[1]! - b[1]! * c[0]!);
    for (let i = 0; i < 3; i++) {
      const I = index[v[i]!]!;
      if (I < 0) continue;
      mass[I] = mass[I]! + area / 3;
      for (let j = 0; j < 3; j++) {
        const J = index[v[j]!]!;
        if (J < 0) continue;
        const k = (b[i]! * b[j]! + c[i]! * c[j]!) / (4 * area);
        rows[I]!.set(J, (rows[I]!.get(J) ?? 0) + k);
      }
    }
  }
  const rowPtr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) rowPtr[i + 1] = rowPtr[i]! + rows[i]!.size;
  const col = new Int32Array(rowPtr[n]!);
  const val = new Float64Array(rowPtr[n]!);
  for (let i = 0; i < n; i++) {
    const entries = [...rows[i]!.entries()].sort((a, b) => a[0] - b[0]);
    let p = rowPtr[i]!;
    for (const [j, k] of entries) { col[p] = j; val[p] = k; p++; }
  }
  return { n, dof: Int32Array.from(dofList), index, rowPtr, col, val, mass };
}
