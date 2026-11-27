// Regression tests for defects found in review.
import { describe, expect, it } from 'vitest';
import { MAT_TYPE, MAT_W, packScene } from '../../src/core/pack';
import { MIN_ASPECT, type Scene, isDelta } from '../../src/core/scene';
import { SCENES, obj, onTable, prismDeviation } from '../../src/core/scenes';
import { sanitizeScene } from '../../src/core/share';
import { MIN_ROUGH, REST_GAP, hitLens, lensParams, restHeight } from '../../src/core/shapes';
import { gratingAngle, spectroCamera, spectroscopeScene } from '../../src/core/tourscenes';
import { type Vec3, dot, norm, sub } from '../../src/core/vec';
import { cameraFrame } from '../../src/gpu/tracer';

const meshes = () => ({ root: 0 });

/** Deterministic pseudo-random numbers in [0, 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

describe('lens solid', () => {
  // Count boundary crossings along a ray; a closed solid is always crossed an even number of times.
  const crossings = (P: [number, number, number, number], o: Vec3, d: Vec3): number => {
    let n = 0;
    let t = 0;
    for (let i = 0; i < 12; i++) {
      const h = hitLens(...P, o, d, t + 1e-7);
      if (!h) break;
      n++;
      t = h.t;
    }
    return n;
  };
  const shapes: [string, { r: number; t: number; r1: number; r2: number }][] = [
    ['thin biconvex', { r: 0.05, t: 0.02, r1: 0.2, r2: 0.2 }],
    ['sharp-edged biconvex', { r: 0.05, t: 0.02, r1: 0.1, r2: 0.1 }],
    ['thick rod lens', { r: 0.09, t: 0.2, r1: 0.083, r2: 0.083 }],
    ['strongly concave', { r: 0.085, t: 0.04, r1: -0.083, r2: 0.22 }],
    ['biconcave', { r: 0.05, t: 0.01, r1: -0.1, r2: -0.1 }],
    ['plano-convex', { r: 0.05, t: 0.02, r1: 0.1, r2: 0 }],
    ['meniscus', { r: 0.05, t: 0.01, r1: 0.12, r2: -0.2 }],
    ['ball-like', { r: 0.5, t: 0.1, r1: 0.05, r2: 0.05 }],
  ];
  it.each(shapes)('%s is closed: every ray crosses its surface an even number of times', (_name, shape) => {
    const P = lensParams(shape);
    const rnd = lcg(12345);
    let through = 0;
    for (let i = 0; i < 4000; i++) {
      // Start well outside the lens, in a random direction.
      const o: Vec3 = norm([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]).map((v) => v * 2) as Vec3;
      // Aim near the lens so most rays meet it.
      const aim: Vec3 = [(rnd() - 0.5) * 2 * P[0], (rnd() - 0.5) * shape.t, (rnd() - 0.5) * 2 * P[0]];
      const d = norm(sub(aim, o));
      const n = crossings(P, o, d);
      if (n % 2 !== 0) throw new Error(`odd crossing count ${n} from ${o.join()} toward ${aim.join()}`);
      if (n > 0) through++;
    }
    expect(through).toBeGreaterThan(500);
  });
  it('reduces the aperture to what the faces can span', () => {
    expect(lensParams({ r: 0.09, t: 0.2, r1: 0.083, r2: 0.3 })[0]).toBeCloseTo(0.985 * 0.083, 12);
    expect(lensParams({ r: 0.05, t: 0.02, r1: 0.2, r2: 0 })[0]).toBe(0.05);
    expect(lensParams({ r: 0.05, t: 0.02, r1: 0, r2: 0 })[0]).toBe(0.05);
  });
});

describe('polish threshold', () => {
  it('treats roughness below the limit as polished, in the shader data and in the photon targets', () => {
    for (const rough of [0, 0.005, 0.01, 0.019]) {
      const o = obj('M', { kind: 'sphere', r: 0.1 }, { kind: 'metal', metal: 'gold', rough }, [0, 0.1, 0]);
      const s: Scene = { ...SCENES[6]!.make(), objects: [obj('L', { kind: 'sphere', r: 0.02 }, { kind: 'light', spectrum: { kind: 'd65' }, lumens: 100 }, [0, 1, 0]), o] };
      const p = packScene(s, meshes);
      const row = [...Array(p.numMat).keys()].find((m) => p.mat[m * MAT_W * 4] === MAT_TYPE.metal)!;
      expect(p.mat[row * MAT_W * 4 + 3]).toBe(0);
      expect(isDelta(o.material)).toBe(true);
      expect(p.numTargets).toBe(1);
    }
    const rough = obj('M', { kind: 'sphere', r: 0.1 }, { kind: 'metal', metal: 'gold', rough: MIN_ROUGH }, [0, 0.1, 0]);
    expect(isDelta(rough.material)).toBe(false);
  });
});

describe('resting on the table', () => {
  it('leaves a gap of air under every flat-bottomed shape', () => {
    const box = onTable('B', { kind: 'box', half: [0.1, 0.05, 0.1] }, { kind: 'glass', glass: 'bk7' }, 0, 0);
    expect(box.pos[1] - restHeight(box.shape)).toBeCloseTo(REST_GAP, 12);
    for (const s of SCENES) {
      for (const o of s.make().objects) {
        if (o.locked || o.material.kind !== 'glass' || o.shape.kind === 'gem' || o.shape.kind === 'lens') continue;
        if (o.rot[0] !== 0 || o.rot[2] !== 0) continue;
        expect(o.pos[1] - restHeight(o.shape)).toBeGreaterThan(REST_GAP * 0.99);
      }
    }
  });
});

describe('untrusted mesh names', () => {
  it('drops names that are not plain identifiers', () => {
    // Lower-case identifiers pass (the app then looks them up among its own models only).
    for (const mesh of ['constructor', 'cat', 'user1']) {
      const s = sanitizeScene({ objects: [{ shape: { kind: 'mesh', mesh, size: 0.2 }, material: { kind: 'diffuse', color: [1, 1, 1] } }] });
      expect(s.objects[0]!.shape.kind).toBe('mesh');
    }
    for (const mesh of ['__proto__', 'toString', '../x', 'A', 'a b', '', 'x'.repeat(40)]) {
      expect(() => sanitizeScene({ objects: [{ shape: { kind: 'mesh', mesh, size: 0.2 }, material: { kind: 'diffuse', color: [1, 1, 1] } }] })).toThrow();
    }
  });
  it('turns a lens face of tiny radius into a flat one', () => {
    const s = sanitizeScene({ objects: [{ shape: { kind: 'lens', r: 0.05, t: 0.02, r1: 1e-9, r2: -1e-7 }, material: { kind: 'glass', glass: 'bk7' } }] });
    expect(s.objects[0]!.shape).toEqual({ kind: 'lens', r: 0.05, t: 0.02, r1: 0, r2: 0 });
  });
});

describe('spectroscope framing', () => {
  it.each([0.45, 0.8, 1, 1.25, 1.5, 1.78, 2.4])('keeps 400 to 700 nm inside a picture of aspect %f, with both dispersers', (aspect) => {
    for (const disperser of ['grating', 'prism'] as const) {
      const scene = spectroscopeScene('Ne', disperser, aspect);
      const f = cameraFrame(scene.camera, aspect);
      const halfWidth = f.tanHalf * aspect;
      expect(halfWidth).toBeCloseTo((12 / scene.camera.focal) * Math.max(aspect, MIN_ASPECT), 9);
      for (const nm of [400, 550, 700]) {
        // Direction in which the line's image appears, to first order.
        const d: Vec3 = disperser === 'grating'
          ? [Math.sin(gratingAngle(nm)), 0, -Math.cos(gratingAngle(nm))]
          : [-Math.cos(prismDeviation(nm)), 0, Math.sin(prismDeviation(nm))];
        const x = dot(d, f.right) / dot(d, f.forward);
        expect(Math.abs(x)).toBeLessThan(halfWidth);
        expect(Math.abs(x)).toBeLessThan(halfWidth * (nm === 550 ? 0.5 : 1));
      }
      // And the camera matches what the scene was given.
      expect(spectroCamera(disperser, aspect).focal).toBe(scene.camera.focal);
    }
  });
});
