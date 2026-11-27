import { describe, expect, it } from 'vitest';
import { assemble } from '../../src/solver/fem';
import { polyArea, polyPerimeter } from '../../src/solver/geometry';
import { latticeMesh, refineTriangles } from '../../src/solver/mesh';
import { circle, GWW, gwwMesh, PRESETS } from '../../src/solver/shapes';
import { hearShape, solveDrum } from '../../src/solver/spectrum';

// Driscoll (1997), Table 3.1: the first 25 eigenvalues of the GWW drums, legs of length 2.
const DRISCOLL = [
  2.53794399980, 3.65550971352, 5.17555935622, 6.53755744376, 7.24807786256,
  9.20929499840, 10.5969856913, 11.5413953956, 12.3370055014, 13.0536540557,
  14.3138624643, 15.8713026200, 16.9417516880, 17.6651184368, 18.9810673877,
  20.8823950433, 21.2480051774, 22.2328517930, 23.7112974848, 24.4792340693,
  24.6740110027, 26.0802400997, 27.3040189211, 28.1751285815, 29.5697729132,
];

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('geometry of the twins', () => {
  it('both GWW drums have area 14 and the same perimeter, and are not congruent', () => {
    expect(Math.abs(polyArea([...GWW.left.outline]))).toBeCloseTo(14, 12);
    expect(Math.abs(polyArea([...GWW.right.outline]))).toBeCloseTo(14, 12);
    expect(polyPerimeter([...GWW.left.outline])).toBeCloseTo(polyPerimeter([...GWW.right.outline]), 12);
    // Sorted side lengths agree but the turning sequences differ.
    const turns = (p: readonly number[]) => {
      const n = p.length / 2;
      return Array.from({ length: n }, (_, i) => {
        const a = (i + n - 1) % n, c = (i + 1) % n;
        const ux = p[2 * i]! - p[2 * a]!, uy = p[2 * i + 1]! - p[2 * a + 1]!, vx = p[2 * c]! - p[2 * i]!, vy = p[2 * c + 1]! - p[2 * i + 1]!;
        return Math.round((Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI);
      });
    };
    const canon = (t: number[]) => {
      const all: string[] = [];
      for (const s of [t, [...t].reverse().map((x) => -x)]) for (let r = 0; r < s.length; r++) all.push([...s.slice(r), ...s.slice(0, r)].join(','));
      return all.sort()[0];
    };
    expect(canon(turns(GWW.left.outline))).not.toBe(canon(turns(GWW.right.outline)));
  });
  it('the pieces tile each outline', () => {
    for (const g of [GWW.left, GWW.right]) {
      const sum = g.pieces.reduce((a, t) => a + Math.abs(polyArea([...t])), 0);
      expect(sum).toBeCloseTo(14, 12);
    }
  });
});

describe('membrane eigenvalues', () => {
  it('unit square converges to pi^2 (m^2 + n^2)', () => {
    const sq = [0, 0, 1, 0, 1, 1, 0, 1];
    const mesh = refineTriangles([[0, 0, 1, 0, 1, 1], [0, 0, 1, 1, 0, 1]], 6, sq);
    const d = solveDrum(mesh, 12);
    const exact = [2, 5, 5, 8, 10, 10, 13, 13, 17, 17, 18, 20].map((s) => Math.PI ** 2 * s);
    exact.forEach((e, i) => expect(rel(d.lambda[i]!, e)).toBeLessThan(0.01));
    // Doubly-degenerate pairs stay degenerate on a mesh symmetric under x <-> y.
    expect(rel(d.lambda[1]!, d.lambda[2]!)).toBeLessThan(1e-8);
  });

  it('unit disc converges to the Bessel zeros squared', () => {
    const mesh = latticeMesh(circle(1, 400), 6000)!;
    const d = solveDrum(mesh, 6);
    const j = [2.404825557695773, 3.831705970207512, 3.831705970207512, 5.135622301840683, 5.135622301840683, 5.520078110286311];
    j.forEach((z, i) => expect(rel(d.lambda[i]!, z * z)).toBeLessThan(0.01));
  });

  it('modes are mass-orthonormal', () => {
    const mesh = refineTriangles([[0, 0, 1, 0, 1, 1], [0, 0, 1, 1, 0, 1]], 4, [0, 0, 1, 0, 1, 1, 0, 1]);
    const sys = assemble(mesh);
    const d = solveDrum(mesh, 8);
    const nv = mesh.xy.length / 2;
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        let s = 0;
        for (let i = 0; i < sys.n; i++) s += sys.mass[i]! * d.shape[a * nv + sys.dof[i]!]! * d.shape[b * nv + sys.dof[i]!]!;
        expect(s).toBeCloseTo(a === b ? 1 : 0, 4);
      }
    }
  });
});

describe('you cannot hear the shape of a drum', () => {
  it('the two GWW meshes are exactly isospectral (discrete transplantation)', () => {
    const a = solveDrum(gwwMesh('left', 1, 4), 25);
    const b = solveDrum(gwwMesh('right', 1, 4), 25);
    for (let i = 0; i < 25; i++) expect(rel(a.lambda[i]!, b.lambda[i]!)).toBeLessThan(1e-9);
  });

  it('their spectrum converges to Driscoll (1997)', () => {
    const d = solveDrum(gwwMesh('left', 1, 6), 25);
    const errs = DRISCOLL.map((e, i) => rel(d.lambda[i]!, e));
    // Linear elements converge as h^(4/3) here (the re-entrant corners); a 1% band at this mesh.
    errs.forEach((e) => expect(e).toBeLessThan(0.01));
    // Mode 9 is the triangle's own first mode, 5 pi^2 / 4, and has no corner singularity.
    expect(rel(d.lambda[8]!, (5 * Math.PI ** 2) / 4)).toBeLessThan(2e-3);
  });

  it('Weyl hears the area and the perimeter', () => {
    const d = solveDrum(gwwMesh('left', 1, 5), 80);
    const h = hearShape(d.lambda);
    expect(rel(h.area, 14)).toBeLessThan(0.08);
    expect(rel(h.perimeter, polyPerimeter([...GWW.left.outline]))).toBeLessThan(0.25);
  });
});

describe('presets', () => {
  it('every preset meshes and solves at the interactive size', () => {
    for (const p of PRESETS) {
      const t0 = performance.now();
      const d = solveDrum(p.mesh(2600), 64);
      const ms = performance.now() - t0;
      expect(d.count).toBe(64);
      expect(d.lambda[0]!).toBeGreaterThan(0);
      for (let i = 1; i < 64; i++) expect(d.lambda[i]!).toBeGreaterThanOrEqual(d.lambda[i - 1]! * (1 - 1e-9));
      console.log(`${p.id}: ${d.mesh.xy.length / 2} vertices, f1 ratio ${Math.sqrt(d.lambda[63]! / d.lambda[0]!).toFixed(2)}, ${ms.toFixed(0)} ms`);
    }
  });
});
