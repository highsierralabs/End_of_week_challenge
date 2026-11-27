import { describe, expect, it } from 'vitest';
import { type Plane, brilliantCut, hitCanonical, hitLens, hitPolytope, lensSag, octahedron, prismPlanes, stepCut } from '../../src/core/shapes';
import { type Vec3, compose, eulerToMat3, invertAffine, mat3ToEuler, xformPoint } from '../../src/core/vec';

describe('brilliant cut', () => {
  const { planes, vertices } = brilliantCut();
  it('has the 73 facets of a round brilliant with a 16-sided girdle', () => {
    expect(planes.length).toBe(73);
  });
  it('is convex: every facet junction lies on or inside every facet plane', () => {
    for (const v of vertices) for (const p of planes) expect(p[0] * v[0] + p[1] * v[1] + p[2] * v[2] - p[3]).toBeLessThan(1e-9);
  });
  it('every facet touches at least three junctions', () => {
    for (const p of planes) {
      const on = vertices.filter((v) => Math.abs(p[0] * v[0] + p[1] * v[1] + p[2] * v[2] - p[3]) < 1e-9).length;
      expect(on).toBeGreaterThanOrEqual(3);
    }
  });
  it('has standard proportions: crown about 15%, pavilion about 43% of the diameter', () => {
    const top = Math.max(...vertices.map((v) => v[1]));
    const bottom = Math.min(...vertices.map((v) => v[1]));
    expect((top - 0.03) / 2).toBeGreaterThan(0.13);
    expect((top - 0.03) / 2).toBeLessThan(0.165);
    expect((-bottom - 0.03) / 2).toBeGreaterThan(0.42);
    expect((-bottom - 0.03) / 2).toBeLessThan(0.445);
  });
});

describe('polytopes', () => {
  it('step cut, octahedron and prisms contain their centre and are bounded', () => {
    for (const planes of [stepCut(), octahedron(), prismPlanes(3, 60, 0.1, 0.1), prismPlanes(6, 60, 0.1, 0.2)]) {
      for (const p of planes) expect(p[3]).toBeGreaterThan(0);
      for (const d of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0.3, 0.2], [0.2, -1, 0.4], [0.1, 0.3, -1]] as Vec3[]) {
        const h = hitPolytope(planes, [0, 0, 0], d, 0);
        expect(h).not.toBeNull();
        expect(h!.t).toBeLessThan(10);
      }
    }
  });
  it('an equilateral prism has 60 degree corners', () => {
    const planes = prismPlanes(3, 60, 0.09, 0.1);
    const side = planes.filter((p) => p[2] === 0);
    expect(side.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        expect(side[i]![0] * side[j]![0] + side[i]![1] * side[j]![1]).toBeCloseTo(-0.5, 9);
      }
    }
  });
  it('a ray through a cube enters and leaves at the right distances', () => {
    const cube: Plane[] = [[1, 0, 0, 1], [-1, 0, 0, 1], [0, 1, 0, 1], [0, -1, 0, 1], [0, 0, 1, 1], [0, 0, -1, 1]];
    const h = hitPolytope(cube, [-3, 0.2, 0.1], [1, 0, 0], 0)!;
    expect(h.t).toBeCloseTo(2, 12);
    expect(h.n).toEqual([-1, 0, 0]);
    const out = hitPolytope(cube, [-3, 0.2, 0.1], [1, 0, 0], 2.0001)!;
    expect(out.t).toBeCloseTo(4, 12);
    expect(hitPolytope(cube, [-3, 2, 0], [1, 0, 0], 0)).toBeNull();
  });
});

describe('lens', () => {
  it('a biconvex lens is hit on its axis at its vertices', () => {
    const h = hitLens(0.05, 0.02, 0.1, 0.1, [0, 1, 0], [0, -1, 0], 0)!;
    expect(h.t).toBeCloseTo(0.99, 9);
    expect(h.n[1]).toBeCloseTo(1, 9);
    const out = hitLens(0.05, 0.02, 0.1, 0.1, [0, 1, 0], [0, -1, 0], 0.995)!;
    expect(out.t).toBeCloseTo(1.01, 9);
    expect(out.n[1]).toBeCloseTo(-1, 9);
  });
  it('its edge thickness follows the sag of both faces', () => {
    const ra = 0.05;
    const R = 0.2;
    const x = ra * 0.9999;
    const edge = 0.02 - 2 * lensSag(R, x);
    const a = hitLens(ra, 0.02, R, R, [x, 1, 0], [0, -1, 0], 0)!;
    const b = hitLens(ra, 0.02, R, R, [x, 1, 0], [0, -1, 0], a.t + 1e-9)!;
    expect(b.t - a.t).toBeCloseTo(edge, 9);
  });
  it('a ray outside the aperture misses', () => {
    expect(hitLens(0.05, 0.02, 0.1, 0.1, [0.051, 1, 0], [0, -1, 0], 0)).toBeNull();
  });
  it('a biconcave lens is thinnest at the centre and has a side wall', () => {
    const c = hitLens(0.05, 0.01, -0.1, -0.1, [0, 1, 0], [0, -1, 0], 0)!;
    const c2 = hitLens(0.05, 0.01, -0.1, -0.1, [0, 1, 0], [0, -1, 0], c.t + 1e-9)!;
    expect(c2.t - c.t).toBeCloseTo(0.01, 9);
    const e = hitLens(0.05, 0.01, -0.1, -0.1, [0.04, 1, 0], [0, -1, 0], 0)!;
    const e2 = hitLens(0.05, 0.01, -0.1, -0.1, [0.04, 1, 0], [0, -1, 0], e.t + 1e-9)!;
    expect(e2.t - e.t).toBeCloseTo(0.01 - 2 * lensSag(-0.1, 0.04), 9);
    const side = hitLens(0.05, 0.01, -0.1, -0.1, [1, 0, 0], [-1, 0, 0], 0)!;
    expect(side.t).toBeCloseTo(0.95, 9);
    expect(side.n[0]).toBeGreaterThan(0);
  });
  it('a plano-convex lens has a flat back', () => {
    const h = hitLens(0.05, 0.02, 0.1, 0, [0.01, -1, 0], [0, 1, 0], 0)!;
    expect(h.t).toBeCloseTo(0.99, 9);
    expect(h.n).toEqual([0, -1, 0]);
  });
});

describe('canonical shapes', () => {
  it('sphere, box, cylinder, quad and disc are hit where expected', () => {
    expect(hitCanonical({ kind: 'sphere', r: 1 }, null, [0, 0, 5], [0, 0, -1], 0)!.t).toBeCloseTo(4, 12);
    expect(hitCanonical({ kind: 'sphere', r: 1 }, null, [0, 0, 0], [0, 0, -1], 0)!.t).toBeCloseTo(1, 12);
    expect(hitCanonical({ kind: 'box', half: [1, 1, 1] }, null, [0.5, 5, 0.5], [0, -1, 0], 0)!.n).toEqual([0, 1, 0]);
    expect(hitCanonical({ kind: 'cylinder', r: 1, h: 1 }, null, [5, 0.5, 0], [-1, 0, 0], 0)!.t).toBeCloseTo(4, 12);
    expect(hitCanonical({ kind: 'cylinder', r: 1, h: 1 }, null, [0.5, 5, 0], [0, -1, 0], 0)!.t).toBeCloseTo(4, 12);
    expect(hitCanonical({ kind: 'quad', half: [1, 1] }, null, [0.9, 2, -0.9], [0, -1, 0], 0)!.t).toBeCloseTo(2, 12);
    expect(hitCanonical({ kind: 'quad', half: [1, 1] }, null, [1.1, 2, 0], [0, -1, 0], 0)).toBeNull();
    expect(hitCanonical({ kind: 'disc', r: 1 }, null, [0.8, 2, 0.8], [0, -1, 0], 0)).toBeNull();
  });
});

describe('affine helpers', () => {
  it('invert a composed transform', () => {
    const m = compose([0.3, -1, 2], [20, 45, -70], [0.5, 2, 1.5]);
    const inv = invertAffine(m);
    const p: Vec3 = [0.7, -0.2, 0.4];
    const q = xformPoint(inv, xformPoint(m, p));
    for (let k = 0; k < 3; k++) expect(q[k]).toBeCloseTo(p[k]!, 12);
  });
  it('round-trip Euler angles', () => {
    for (const e of [[10, 20, 30], [-50, 70, 120], [0, 0, 0], [170, -30, -100]] as Vec3[]) {
      const m = eulerToMat3(e);
      const m2 = eulerToMat3(mat3ToEuler(m));
      for (let k = 0; k < 9; k++) expect(m2[k]).toBeCloseTo(m[k]!, 10);
    }
  });
});
