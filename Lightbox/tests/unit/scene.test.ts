import { describe, expect, it } from 'vitest';
import { LIGHT_W, emitterLuminance, objectTransform, packScene } from '../../src/core/pack';
import { hitHorizontal, pick } from '../../src/core/pick';
import type { GasName, Scene } from '../../src/core/scene';
import { SCENES, minimumDeviation, obj, prismDeviation } from '../../src/core/scenes';
import { compactScene, fromBase64Url, sanitizeScene, toBase64Url } from '../../src/core/share';
import { hitPolytope, shapePlanes } from '../../src/core/shapes';
import { NL, glassIndex } from '../../src/core/spectrum';
import { ballLens, causticScene, depthScene, fresnelScene, sodiumScene, softShadows, spectroscopeScene } from '../../src/core/tourscenes';
import { type Vec3, add, dot, invertAffine, mul, norm, sub, xformDir, xformPoint } from '../../src/core/vec';

const meshes = () => ({ root: 0 });
const all: [string, () => Scene][] = [
  ...SCENES.map((s) => [s.id, s.make] as [string, () => Scene]),
  ['shadows', softShadows], ['fresnel', fresnelScene], ['ball', ballLens], ['caustic', causticScene], ['sodium', sodiumScene], ['depth', depthScene],
  ...(['H', 'He', 'Ne', 'Na', 'Hg', 'Ar', 'Kr', 'Xe'] as GasName[]).flatMap((g) => [
    [`grating ${g}`, () => spectroscopeScene(g, 'grating')] as [string, () => Scene],
    [`prism ${g}`, () => spectroscopeScene(g, 'prism')] as [string, () => Scene],
  ]),
];

describe('built-in scenes', () => {
  it.each(all)('%s packs into finite arrays with normalised light shares', (_name, make) => {
    const scene = make();
    const p = packScene(scene, meshes);
    expect(p.numObj).toBe(scene.objects.length);
    for (const arr of [p.obj, p.mat, p.planes, p.spec, p.lam, p.lights, p.targets]) {
      for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i]!)) throw new Error(`non-finite value at ${i}`);
    }
    expect(p.numLights).toBeGreaterThan(0);
    let share = 0;
    for (let l = 0; l < p.numLights; l++) share += p.lights[l * LIGHT_W * 4 + 2]!;
    expect(share).toBeCloseTo(1, 5);
    expect(p.lam.length).toBe(NL + 1);
    for (let k = 1; k <= NL; k++) expect(p.lam[k]!).toBeGreaterThan(p.lam[k - 1]!);
  });

  it.each(all)('%s survives a share-link round trip unchanged', (_name, make) => {
    const scene = make();
    const back = sanitizeScene(JSON.parse(compactScene(scene)));
    expect(back.objects.length).toBe(scene.objects.length);
    back.objects.forEach((o, i) => {
      const src = scene.objects[i]!;
      expect(o.shape.kind).toBe(src.shape.kind);
      expect(o.material.kind).toBe(src.material.kind);
      for (let k = 0; k < 3; k++) expect(o.pos[k]).toBeCloseTo(src.pos[k]!, 3);
    });
    // The repacked scene is the same picture: same object records to the rounding of the link.
    const a = packScene(scene, meshes);
    const b = packScene(back, meshes);
    expect(b.numObj).toBe(a.numObj);
    expect(b.numLights).toBe(a.numLights);
    for (let i = 0; i < a.obj.length; i++) expect(Math.abs(a.obj[i]! - b.obj[i]!)).toBeLessThan(2e-2 * Math.max(1, Math.abs(a.obj[i]!)));
  });

  it('the camera of the default scene looks at something', () => {
    const s = SCENES[0]!.make();
    const d = norm(sub(s.camera.target, s.camera.pos));
    const hit = pick(s, s.camera.pos, d, () => null);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeGreaterThan(0.5);
  });
});

describe('untrusted scenes', () => {
  it('rejects junk and empty scenes', () => {
    for (const junk of [null, 42, 'x', [], {}, { objects: [] }, { objects: [{ shape: { kind: 'teapot' } }] }]) {
      expect(() => sanitizeScene(junk)).toThrow();
    }
  });
  it('clamps wild numbers, drops unknown fields and caps the object count', () => {
    const many = Array.from({ length: 500 }, () => ({ shape: { kind: 'sphere', r: 1e9 }, pos: [1e12, NaN, 'x'], rot: [0, 0, 0], material: { kind: 'light', lumens: -5, spectrum: { kind: 'gas', gas: 'Unobtainium' } }, evil: '<script>' }));
    const s = sanitizeScene({ objects: many, camera: { focal: -3, fstop: 1e9 }, bounces: 1e6, name: 'x'.repeat(500) });
    expect(s.objects.length).toBe(64);
    const o = s.objects[0]!;
    expect(o.shape).toEqual({ kind: 'sphere', r: 20 });
    expect(o.pos).toEqual([100, 0, 0]);
    expect(o.material).toEqual({ kind: 'light', lumens: 0, spectrum: { kind: 'gas', gas: 'Ne' } });
    expect('evil' in o).toBe(false);
    expect(s.camera.focal).toBe(10);
    expect(s.camera.fstop).toBe(64);
    expect(s.bounces).toBe(64);
    expect(s.name.length).toBe(60);
    expect(() => packScene(s, meshes)).not.toThrow();
  });
  it('base64url round-trips bytes', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_v, i) => (i * 37) % 256);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(toBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('light and picking helpers', () => {
  it('a spherical lamp of 4 pi^2 r^2 lumens has a luminance of 1 cd/m2', () => {
    const r = 0.05;
    const lamp = obj('L', { kind: 'sphere', r }, { kind: 'light', spectrum: { kind: 'd65' }, lumens: 4 * Math.PI * Math.PI * r * r }, [0, 0, 0]);
    expect(emitterLuminance(lamp)).toBeCloseTo(1, 10);
  });
  it('a beam is brighter by the ratio of the hemisphere to its cone', () => {
    const q = (m: 'light' | 'beam') => obj('L', { kind: 'disc', r: 0.1 }, m === 'light' ? { kind: 'light', spectrum: { kind: 'd65' }, lumens: 100 } : { kind: 'beam', spectrum: { kind: 'd65' }, lumens: 100, spread: 30 }, [0, 0, 0]);
    expect(emitterLuminance(q('beam')) / emitterLuminance(q('light'))).toBeCloseTo(1 / Math.sin(Math.PI / 6) ** 2, 9);
  });
  it('finds where a ray meets a horizontal plane', () => {
    expect(hitHorizontal([0, 1, 0], [1, -1, 0], 0)).toEqual([1, 0, 0]);
    expect(hitHorizontal([0, 1, 0], [1, 1, 0], 0)).toBeNull();
  });
});

describe('prism at minimum deviation', () => {
  const refract = (d: Vec3, n: Vec3, eta: number): Vec3 => {
    const ci = -dot(d, n);
    const s2 = eta * eta * (1 - ci * ci);
    return norm(add(mul(d, eta), mul(n, eta * ci - Math.sqrt(1 - s2))));
  };
  it.each([['sf11', 0.1], ['bk7', 0.07], ['sf11', 0.12]] as const)('%s prism of size %f passes a 550 nm ray symmetrically through the middle of its faces', (glassName, size) => {
    const m = minimumDeviation(size, glassName);
    const prism = obj('P', { kind: 'prism', sides: 3, apex: 60, size, h: 0.1 }, { kind: 'glass', glass: glassName }, [m.centre[0], 0, m.centre[1]], [90, m.turn, 0]);
    const fwd = objectTransform(prism);
    const inv = invertAffine(fwd);
    const planes = shapePlanes(prism.shape)!;
    const n = glassIndex(glassName, 550);
    const o = xformPoint(inv, [-1, 0, 0]);
    const d = norm(xformDir(inv, [1, 0, 0]));
    const h1 = hitPolytope(planes, o, d, 1e-9)!;
    // It enters through a slanted face (not the base, not an end), at the origin of the world.
    expect(h1.n[2]).toBe(0);
    expect(h1.n[1]).toBeGreaterThan(0);
    const p1 = add(o, mul(d, h1.t));
    const w1 = xformPoint(fwd, p1);
    expect(Math.hypot(w1[0], w1[2])).toBeLessThan(1e-9);
    const d1 = refract(d, h1.n, 1 / n);
    // Inside, it runs parallel to the base.
    expect(Math.abs(d1[1])).toBeLessThan(1e-9);
    const h2 = hitPolytope(planes, p1, d1, 1e-7)!;
    expect(h2.n[1]).toBeGreaterThan(0);
    const d2 = norm(xformDir(fwd, refract(d1, mul(h2.n, -1), n)));
    const w2 = xformPoint(fwd, add(p1, mul(d1, h2.t)));
    expect(w2[0]).toBeCloseTo(m.exit[0], 9);
    expect(w2[2]).toBeCloseTo(m.exit[1], 9);
    expect(d2[0]).toBeCloseTo(m.out[0], 9);
    expect(d2[2]).toBeCloseTo(m.out[1], 9);
    // And the turn is the textbook minimum deviation, 2 asin(n sin(A/2)) - A.
    expect(prismDeviation(550, glassName)).toBeCloseTo(2 * Math.asin(n * 0.5) - Math.PI / 3, 12);
  });
  it('deviates blue more than red', () => {
    expect(prismDeviation(450)).toBeGreaterThan(prismDeviation(650));
  });
});
