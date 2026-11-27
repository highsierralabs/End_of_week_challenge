// Validation worker: re-runs the solver checks in the visitor's browser and streams the results.

import { circle, gwwMesh, PRESETS } from '../solver/shapes';
import { latticeMesh, refineTriangles } from '../solver/mesh';
import { hearShape, solveDrum } from '../solver/spectrum';

export type VMsg =
  | { type: 'square'; rows: { label: string; exact: number; got: number }[]; nv: number }
  | { type: 'disc'; rows: { label: string; exact: number; got: number }[]; nv: number }
  | { type: 'gww'; level: number; h: number; nv: number; left: number[]; right: number[]; ms: number }
  | { type: 'weyl'; rows: { name: string; area: number; heardArea: number; perimeter: number; heardPerimeter: number }[] }
  | { type: 'done' };

const post = (m: VMsg) => (self as unknown as Worker).postMessage(m);

self.onmessage = () => {
  // Unit square: lambda = pi^2 (m^2 + n^2).
  {
    const sq = [0, 0, 1, 0, 1, 1, 0, 1];
    const mesh = refineTriangles([[0, 0, 1, 0, 1, 1], [0, 0, 1, 1, 0, 1]], 6, sq);
    const d = solveDrum(mesh, 10);
    const exact: [string, number][] = [['(1,1)', 2], ['(1,2)', 5], ['(2,1)', 5], ['(2,2)', 8], ['(1,3)', 10], ['(3,1)', 10], ['(2,3)', 13], ['(3,2)', 13], ['(1,4)', 17], ['(4,1)', 17]];
    post({ type: 'square', nv: d.mesh.xy.length / 2, rows: exact.map(([l, s], i) => ({ label: `(m,n) = ${l}`, exact: Math.PI ** 2 * s, got: d.lambda[i]! })) });
  }
  // Unit disc: lambda = j_{n,k}^2.
  {
    const mesh = latticeMesh(circle(1, 400), 6000)!;
    const d = solveDrum(mesh, 6);
    const z: [string, number][] = [['j(0,1)', 2.404825557695773], ['j(1,1)', 3.831705970207512], ['j(1,1)', 3.831705970207512], ['j(2,1)', 5.135622301840683], ['j(2,1)', 5.135622301840683], ['j(0,2)', 5.520078110286311]];
    post({ type: 'disc', nv: d.mesh.xy.length / 2, rows: z.map(([l, j], i) => ({ label: `${l}²`, exact: j * j, got: d.lambda[i]! })) });
  }
  // The GWW twins at increasing refinement (legs of length 2, as in Driscoll's table).
  for (let level = 2; level <= 6; level++) {
    const t0 = performance.now();
    const a = solveDrum(gwwMesh('left', 1, level), 25);
    const b = solveDrum(gwwMesh('right', 1, level), 25);
    post({ type: 'gww', level, h: 2 / 2 ** level, nv: a.mesh.xy.length / 2, left: Array.from(a.lambda), right: Array.from(b.lambda), ms: performance.now() - t0 });
  }
  // Weyl's law on every preset, at the size the app uses.
  {
    const rows = PRESETS.map((p) => {
      const d = solveDrum(p.mesh(2600), 64);
      const h = hearShape(d.lambda);
      return { name: p.name, area: d.area, heardArea: h.area, perimeter: d.perimeter, heardPerimeter: h.perimeter };
    });
    post({ type: 'weyl', rows });
  }
  post({ type: 'done' });
};
