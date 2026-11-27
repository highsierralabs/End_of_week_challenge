// Sky mode: a faithful slice of real time. Showers above eMin arrive over the square
// as a Poisson process at the all-particle flux; energies follow the spectrum (E^-2.7
// below the knee), zenith angles the flux through a horizontal plane. Every shower is
// simulated and merged into one replay on a common clock.
import { simulateShower, DEFAULT_PARAMS } from './cascade';
import { Rng } from './rng';
import { GND_STRIDE, RCLASS_COUNT, SEG_STRIDE, type Primary, type ShowerResult } from './types';

export interface SkyOptions {
  showers: number;
  seed: number;
  /** Energy range, eV, sampled from the differential spectrum (E^-2.7 below the knee). */
  eMinEV: number;
  eMaxEV: number;
  /** Half-width of the square the cores land in, metres. */
  halfWidthM: number;
  maxSegments: number;
  thinning: number;
}

export const DEFAULT_SKY: SkyOptions = {
  showers: 36,
  seed: 1,
  eMinEV: 2e13,
  eMaxEV: 1e17,
  halfWidthM: 9000,
  maxSegments: 500_000,
  thinning: 1e-4,
};

export interface SkyInfo {
  showers: number;
  /** Real time spanned by the arrivals, s. */
  realSpanSeconds: number;
  /** Mean arrival rate of showers above eMin into the square, per second. */
  ratePerSecond: number;
  energiesEV: number[];
  primaries: Primary[];
  /** Index (into energiesEV) of the most energetic shower. */
  brightest: number;
}

/** All-particle integral flux above E (eV), m^-2 s^-1 sr^-1: E^2.6 J = 4000 GeV^1.6 below a 4 PeV knee. */
function integralFlux(eEV: number): number {
  const E = eEV * 1e-9;
  const knee = 4e6;
  const atKnee = 4000 * Math.pow(knee, -2.6);
  if (E >= knee) return (atKnee * knee) / 2.1 * Math.pow(E / knee, -2.1);
  const below = (atKnee * knee / 1.7) * (Math.pow(E / knee, -1.7) - 1);
  return below + (atKnee * knee) / 2.1;
}

export function simulateSky(o: SkyOptions, onProgress?: (f: number, tracked: number) => void): { result: ShowerResult; info: SkyInfo; brightest: ShowerResult } {
  const rng = new Rng(o.seed);
  const perShower = Math.max(2000, Math.floor(o.maxSegments / o.showers));
  const segs: Float32Array[] = [];
  const gnds: Float32Array[] = [];
  const energies: number[] = [];
  const prims: Primary[] = [];
  let tracked = 0;
  let best: ShowerResult | null = null;
  let bestShift = 0;
  let bestE = 0;
  let segTotal = 0, gndTotal = 0;
  let tMin = Infinity, tMax = -Infinity;
  const profiles: ShowerResult['profile'][] = [];
  const area = (2 * o.halfWidthM) ** 2;
  const rate = integralFlux(o.eMinEV) * Math.PI * 0.75 * area; // showers per second above eMin into the square
  let tArrive = 0;
  let firstCore = Infinity;
  for (let k = 0; k < o.showers; k++) {
    tArrive += rng.exp(1e9 / rate); // ns
    // Differential spectrum E^-2.7 (inverse CDF); the knee is above where most land anyway.
    const a = Math.pow(o.eMinEV, -1.7), bq = Math.pow(o.eMaxEV, -1.7);
    const E = Math.pow(a - rng.uniform() * (a - bq), -1 / 1.7);
    const u = rng.uniform();
    const primary: Primary = u < 0.45 ? 'proton' : u < 0.75 ? 'helium' : u < 0.9 ? 'nitrogen' : 'iron';
    const cosT = Math.sqrt(1 - rng.uniform() * 0.75); // up to 60 deg, flux through a horizontal plane
    const r = simulateShower({
      ...DEFAULT_PARAMS,
      primary,
      energyEV: E,
      zenithDeg: (Math.acos(cosT) * 180) / Math.PI,
      azimuthDeg: 360 * rng.uniform(),
      seed: (o.seed * 7919 + k * 104729) >>> 0,
      thinning: o.thinning,
      maxSegments: perShower,
      coreX: (rng.uniform() * 2 - 1) * o.halfWidthM,
      coreY: (rng.uniform() * 2 - 1) * o.halfWidthM,
      recordTracks: true,
    });
    tracked += r.stats.particlesTracked;
    // Put the core's arrival at its Poisson arrival time.
    const shift = tArrive - r.stats.tCore;
    firstCore = Math.min(firstCore, tArrive);
    const s = r.segments;
    for (let i = 0; i < r.segmentCount; i++) { s[i * SEG_STRIDE + 3]! += shift; s[i * SEG_STRIDE + 7]! += shift; }
    const g = r.ground;
    for (let i = 0; i < r.groundCount; i++) g[i * GND_STRIDE + 2]! += shift;
    tMin = Math.min(tMin, r.stats.tMin + shift);
    tMax = Math.max(tMax, r.stats.tMax + shift);
    segs.push(s); gnds.push(g); segTotal += r.segmentCount; gndTotal += r.groundCount;
    profiles.push(r.profile);
    energies.push(E); prims.push(primary);
    if (E > bestE) { bestE = E; best = r; bestShift = shift; }
    onProgress?.((k + 1) / o.showers, tracked);
  }
  const segments = new Float32Array(segTotal * SEG_STRIDE);
  let off = 0;
  for (const s of segs) { segments.set(s, off); off += s.length; }
  const ground = new Float32Array(gndTotal * GND_STRIDE);
  off = 0;
  for (const g of gnds) { ground.set(g, off); off += g.length; }
  const bins = Math.max(...profiles.map((p) => p.bins));
  const profile = {
    step: profiles[0]!.step, bins,
    byClass: Array.from({ length: RCLASS_COUNT }, (_, c) => { const a = new Float64Array(bins); for (const p of profiles) p.byClass[c]!.forEach((v, i) => { a[i]! += v; }); return a; }),
    charged: (() => { const a = new Float64Array(bins); for (const p of profiles) p.charged.forEach((v, i) => { a[i]! += v; }); return a; })(),
  };
  const b = best!;
  // The brightest shower's arrays were shifted onto the common clock; shift its stats too.
  b.stats = { ...b.stats, tMin: b.stats.tMin + bestShift, tMax: b.stats.tMax + bestShift, tCore: b.stats.tCore + bestShift };
  const result: ShowerResult = {
    params: { ...b.params },
    segments, segmentCount: segTotal, ground, groundCount: gndTotal, profile,
    // The clock window: from shortly before the first core lands to shortly after the last,
    // so a few slow hadrons do not stretch the replay.
    stats: { ...b.stats, tMin: Math.max(tMin, firstCore - 60_000), tMax: Math.min(tMax, tArrive + 25_000), particlesTracked: tracked, truncated: true },
  };
  return {
    result,
    brightest: b,
    info: { showers: o.showers, realSpanSeconds: tArrive * 1e-9, ratePerSecond: rate, energiesEV: energies, primaries: prims, brightest: energies.indexOf(bestE) },
  };
}
