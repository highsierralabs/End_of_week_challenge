import { describe, expect, it } from 'vitest';
import { latticeMesh, refineTriangles } from '../../src/solver/mesh';
import { solvePlate } from '../../src/solver/plate';
import { FREE_SQUARE_PLATE } from '../../src/solver/reference';
import { circle } from '../../src/solver/shapes';

const FREE_SQUARE = FREE_SQUARE_PLATE;

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('free plates (Ritz)', () => {
  it('free square plate matches the published eigenvalues', () => {
    const sq = refineTriangles([[-1, -1, 1, -1, 1, 1], [-1, -1, 1, 1, -1, 1]], 4, [-1, -1, 1, -1, 1, 1, -1, 1]);
    const t0 = performance.now();
    const p = solvePlate(sq, sq, 16, 0.225, 12);
    console.log(`plate square: ${(performance.now() - t0).toFixed(0)} ms`, Array.from(p.lambda.slice(0, 10), (v) => v.toFixed(3)).join(' '));
    FREE_SQUARE.forEach((e, i) => expect(rel(p.lambda[i]!, e)).toBeLessThan(0.005));
  });

  it('works on a lattice-meshed curved shape, and is scale-consistent', () => {
    const a = latticeMesh(circle(1, 300), 2500)!;
    const b = latticeMesh(circle(0.5, 300), 2500)!;
    const pa = solvePlate(a, a, 14, 0.3, 8);
    const pb = solvePlate(b, b, 14, 0.3, 8);
    // lambda scales as 1 / length^4.
    for (let i = 0; i < 8; i++) expect(rel(pb.lambda[i]!, pa.lambda[i]! * 16)).toBeLessThan(0.01);
    // The free disc's first bending modes are a degenerate pair (two nodal diameters).
    expect(rel(pa.lambda[0]!, pa.lambda[1]!)).toBeLessThan(0.01);
    console.log('free disc, nu 0.3, sqrt(lambda) a^2:', Array.from(pa.lambda.slice(0, 8), (v) => Math.sqrt(v).toFixed(3)).join(' '));
  });
});
