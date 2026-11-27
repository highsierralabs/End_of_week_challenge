import { describe, expect, it } from 'vitest';
import { altitudeAtDepth, density, moliereRadiusM, verticalDepth } from '../../src/physics/atmosphere';
import { gamma as gammaFn, greisen, nkgDensity } from '../../src/physics/analytic';
import { M_MU, M_PI, M_PI0 } from '../../src/physics/constants';
import { twoBodyDecay, type Daughter } from '../../src/physics/kinematics';
import { Rng } from '../../src/physics/rng';
import { muCompton, muPair, MU_PAIR_INF, sigmaProtonAir, lambdaFromSigma, bremPerX0 } from '../../src/physics/xsec';
import { fitGaisserHillas } from '../../src/physics/fit';
import { gaisserHillas } from '../../src/physics/analytic';
import { simulateShower, DEFAULT_PARAMS } from '../../src/physics/cascade';
import { SEG_STRIDE, GND_STRIDE, RClass } from '../../src/physics/types';

describe('atmosphere (Linsley US standard)', () => {
  it('has ~1036 g/cm^2 at sea level and ~861 at the 1539 m site', () => {
    expect(verticalDepth(0)).toBeCloseTo(1036.1, 0);
    expect(verticalDepth(1539)).toBeGreaterThan(855);
    expect(verticalDepth(1539)).toBeLessThan(866);
  });
  it('the site depth matches the site barometric mean (~844 hPa -> ~861 g/cm^2) within 1%', () => {
    expect(Math.abs(verticalDepth(1539) - 844.1 / 0.980665) / 861).toBeLessThan(0.01);
  });
  it('inverts depth to altitude consistently across all layers', () => {
    for (const h of [0, 1539, 3999, 4001, 9000, 15000, 30000, 60000, 105000]) {
      expect(altitudeAtDepth(verticalDepth(h))).toBeCloseTo(h, 0);
    }
  });
  it('density integrates to the depth', () => {
    let X = 0;
    for (let h = 1539; h < 112000; h += 5) X += density(h + 2.5) * 500;
    expect(X).toBeCloseTo(verticalDepth(1539), -1);
  });
  it('gives a Moliere radius of ~80 m at sea level and ~95 m at the site', () => {
    expect(moliereRadiusM(0)).toBeGreaterThan(75);
    expect(moliereRadiusM(0)).toBeLessThan(85);
    expect(moliereRadiusM(1539)).toBeGreaterThan(88);
    expect(moliereRadiusM(1539)).toBeLessThan(100);
  });
});

describe('cross sections', () => {
  it('Compton attenuation in air at 1 MeV matches NIST XCOM (0.0636 cm^2/g) within 2%', () => {
    expect(Math.abs(muCompton(1e-3) - 0.0636) / 0.0636).toBeLessThan(0.02);
  });
  it('pair attenuation rises to 7/(9 X0) at high energy and vanishes below threshold', () => {
    expect(muPair(1e-3)).toBe(0);
    expect(muPair(1e4) / MU_PAIR_INF).toBeGreaterThan(0.98);
  });
  it('proton-air interaction length is ~60 g/cm^2 at 1 PeV and falls with energy', () => {
    const l15 = lambdaFromSigma(sigmaProtonAir(1e6));
    expect(l15).toBeGreaterThan(55);
    expect(l15).toBeLessThan(68);
    expect(lambdaFromSigma(sigmaProtonAir(1e9))).toBeLessThan(l15);
  });
  it('bremsstrahlung emission count is positive and grows as the cut falls', () => {
    expect(bremPerX0(1e-3)).toBeGreaterThan(bremPerX0(1e-2));
    expect(bremPerX0(1)).toBe(0);
  });
});

describe('kinematics', () => {
  const d1: Daughter = { E: 0, d: { x: 0, y: 0, z: -1 } };
  const d2: Daughter = { E: 0, d: { x: 0, y: 0, z: -1 } };
  it('two-body decays conserve energy and momentum', () => {
    const rng = new Rng(3);
    for (const [M, E, m1, m2] of [[M_PI0, 5, 0, 0], [M_PI, 2, M_MU, 0], [M_PI, 0.3, M_MU, 0]] as const) {
      const dir = { x: 0.3, y: -0.2, z: -Math.sqrt(1 - 0.13) };
      twoBodyDecay(rng, M, E, dir, m1, m2, d1, d2);
      expect(d1.E + d2.E).toBeCloseTo(E, 6);
      const p = Math.sqrt(E * E - M * M);
      const p1 = Math.sqrt(Math.max(0, d1.E ** 2 - m1 * m1));
      const p2 = Math.sqrt(Math.max(0, d2.E ** 2 - m2 * m2));
      expect(p1 * d1.d.x + p2 * d2.d.x).toBeCloseTo(p * dir.x, 5);
      expect(p1 * d1.d.z + p2 * d2.d.z).toBeCloseTo(p * dir.z, 5);
    }
  });
  it('the RNG is deterministic per seed', () => {
    const a = new Rng(42), b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.uniform()).toBe(b.uniform());
  });
});

describe('analytic references', () => {
  it('Lanczos gamma matches known values', () => {
    expect(gammaFn(5)).toBeCloseTo(24, 8);
    expect(gammaFn(0.5)).toBeCloseTo(Math.sqrt(Math.PI), 8);
  });
  it('NKG integrates to the shower size', () => {
    const rM = 90, Ne = 1e5, s = 1.2;
    let sum = 0;
    for (let r = 0.05; r < 5000; r *= 1.01) sum += nkgDensity(r * 1.005, Ne, s, rM) * 2 * Math.PI * r * 1.005 * r * 0.01;
    expect(sum / Ne).toBeGreaterThan(0.95);
    expect(sum / Ne).toBeLessThan(1.05);
  });
  it('the Gaisser-Hillas fitter recovers known parameters', () => {
    const c = new Float64Array(100);
    for (let i = 0; i < 100; i++) c[i] = gaisserHillas((i + 0.5) * 10, 1e6, 600, -50, 65);
    const f = fitGaisserHillas(10, c, 1000)!;
    expect(f.xmax).toBeCloseTo(600, -1);
    expect(f.nmax / 1e6).toBeCloseTo(1, 1);
  });
});

describe('shower Monte Carlo', () => {
  const base = { ...DEFAULT_PARAMS, zenithDeg: 0, recordTracks: false };

  it('a 100 TeV photon shower reproduces Greisen within 20% at its maximum', () => {
    const r = simulateShower({ ...base, primary: 'gamma', energyEV: 1e14, thinning: 1e-4, seed: 5 });
    const gh = r.stats.gh!;
    const g = greisen(1e5, gh.xmax);
    expect(Math.abs(gh.nmax - g) / g).toBeLessThan(0.2);
    expect(gh.xmax).toBeGreaterThan(450);
    expect(gh.xmax).toBeLessThan(600);
  });

  it('proton Xmax at 1 PeV is in the accelerator-model band; iron is shallower and fluctuates less', () => {
    const xs = (primary: 'proton' | 'iron'): number[] =>
      Array.from({ length: 8 }, (_, i) => simulateShower({ ...base, primary, energyEV: 1e15, thinning: 1e-4, seed: 11 + i }).stats.gh!.xmax);
    const p = xs('proton');
    const fe = xs('iron');
    const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
    const sd = (a: number[]): number => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
    // Medians: a single rare deep first interaction (P ~ 1e-3) must not fail the build.
    const median = (a: number[]): number => { const b = [...a].sort((x, y) => x - y); return (b[3]! + b[4]!) / 2; };
    expect(median(p)).toBeGreaterThan(500);
    expect(median(p)).toBeLessThan(640);
    expect(median(p) - median(fe)).toBeGreaterThan(40);
    expect(sd(fe)).toBeLessThan(sd(p));
  });

  it('is deterministic and keeps its records inside the declared layouts', () => {
    const p = { ...base, energyEV: 1e13, thinning: 0, recordTracks: true, maxSegments: 20000, seed: 9 };
    const a = simulateShower(p);
    const b = simulateShower(p);
    expect(a.segmentCount).toBe(b.segmentCount);
    expect(a.stats.groundCounts).toEqual(b.stats.groundCounts);
    expect(a.segments.length).toBe(a.segmentCount * SEG_STRIDE);
    expect(a.ground.length).toBe(a.groundCount * GND_STRIDE);
    for (let i = 0; i < a.groundCount; i++) {
      const c = a.ground[i * GND_STRIDE + 3]!;
      expect(c).toBeGreaterThanOrEqual(RClass.GAMMA);
      expect(c).toBeLessThanOrEqual(RClass.HADRON);
    }
    // The first interaction defines t = 0; the core time is positive.
    expect(a.stats.tCore).toBeGreaterThan(0);
  });

  it('gamma showers are muon-poor compared with hadronic ones', () => {
    const g = simulateShower({ ...base, primary: 'gamma', energyEV: 1e14, thinning: 1e-4, seed: 2 });
    const p = simulateShower({ ...base, primary: 'proton', energyEV: 1e14, thinning: 1e-4, seed: 2 });
    expect(g.stats.groundCounts[RClass.MUON]! * 5).toBeLessThan(p.stats.groundCounts[RClass.MUON]!);
  });
});
