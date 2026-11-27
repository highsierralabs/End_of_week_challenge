// From a mesh to a playable drum: modes on every mesh vertex, plus what the spectrum says about the shape.

import { assemble } from './fem';
import { polyArea, polyPerimeter } from './geometry';
import { lowestModes } from './lanczos';
import { type Mesh } from './mesh';

export interface Drum {
  mesh: Mesh;
  /** Eigenvalues lambda in 1/m^2, ascending. */
  lambda: Float64Array;
  /** Mode shapes on every mesh vertex (0 on the rim), mass-normalised: shape[k * nv + v]. */
  shape: Float32Array;
  count: number;
  /** Area and perimeter of the mesh (m^2, m). */
  area: number;
  perimeter: number;
}

export function meshArea(m: Mesh): number {
  let a = 0;
  for (let t = 0; t < m.tri.length; t += 3) {
    const i = m.tri[t]!, j = m.tri[t + 1]!, k = m.tri[t + 2]!;
    a += 0.5 * ((m.xy[2 * j]! - m.xy[2 * i]!) * (m.xy[2 * k + 1]! - m.xy[2 * i + 1]!) - (m.xy[2 * k]! - m.xy[2 * i]!) * (m.xy[2 * j + 1]! - m.xy[2 * i + 1]!));
  }
  return a;
}

/** Perimeter of the mesh boundary (edges used by one triangle). */
export function meshPerimeter(m: Mesh): number {
  const nv = m.xy.length / 2;
  const count = new Map<number, number>();
  for (let t = 0; t < m.tri.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = m.tri[t + e]!, b = m.tri[t + ((e + 1) % 3)]!;
      const k = a < b ? a * nv + b : b * nv + a;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  let s = 0;
  for (const [k, c] of count) {
    if (c !== 1) continue;
    const a = Math.floor(k / nv), b = k % nv;
    s += Math.hypot(m.xy[2 * a]! - m.xy[2 * b]!, m.xy[2 * a + 1]! - m.xy[2 * b + 1]!);
  }
  return s;
}

export function solveDrum(mesh: Mesh, want: number, onProgress?: (f: number) => void): Drum {
  const sys = assemble(mesh);
  const modes = lowestModes(sys, want, onProgress);
  const nv = mesh.xy.length / 2;
  const shape = new Float32Array(modes.count * nv);
  for (let k = 0; k < modes.count; k++) {
    for (let i = 0; i < sys.n; i++) shape[k * nv + sys.dof[i]!] = modes.vec[k * sys.n + i]!;
  }
  return { mesh, lambda: modes.lambda, shape, count: modes.count, area: meshArea(mesh), perimeter: meshPerimeter(mesh) };
}

/**
 * Weyl's law, with the perimeter correction: the number of eigenvalues below lambda is about
 *   N(lambda) = A lambda / 4pi - P sqrt(lambda) / 4pi + C.
 * Fitting it to the spectrum "hears" the area A and the perimeter P.
 */
export function hearShape(lambda: ArrayLike<number>): { area: number; perimeter: number } {
  // Least squares on the staircase midpoints (lambda_i, i - 1/2), skipping the first few.
  const rows: [number, number, number, number][] = [];
  for (let i = 3; i < lambda.length; i++) {
    const l = lambda[i]!;
    rows.push([l / (4 * Math.PI), -Math.sqrt(l) / (4 * Math.PI), 1, i + 0.5]);
  }
  const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const atb = [0, 0, 0];
  for (const r of rows) for (let a = 0; a < 3; a++) { atb[a]! += r[a]! * r[3]; for (let b = 0; b < 3; b++) ata[a]![b]! += r[a]! * r[b]!; }
  const x = solve3(ata, atb);
  return { area: x[0]!, perimeter: x[1]! };
}

function solve3(a: number[][], b: number[]): number[] {
  const m = a.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[p]![c]!)) p = r;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r]![c]! / m[c]![c]!;
      for (let k = c; k < 4; k++) m[r]![k]! -= f * m[c]![k]!;
    }
  }
  return [m[0]![3]! / m[0]![0]!, m[1]![3]! / m[1]![1]!, m[2]![3]! / m[2]![2]!];
}

/** Faber-Krahn: the disc has the lowest fundamental of all shapes of the same area. */
export function discFundamental(area: number): number {
  const j01 = 2.404825557695773;
  return (j01 * j01 * Math.PI) / area;
}

export { polyArea, polyPerimeter };
