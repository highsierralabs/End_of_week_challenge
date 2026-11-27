// Sky mode: a faithful slice of real time. Showers above eMin arrive over the square
// as a Poisson process at the all-particle flux; energies follow the spectrum (E^-2.7
// below the knee), zenith angles the flux through a horizontal plane. Every shower is
// simulated and merged into one replay on a common clock.
import { simulateShower, DEFAULT_PARAMS } from './cascade';
import { Rng } from './rng';
import { GND_STRIDE, RCLASS_COUNT, SEG_STRIDE, type Primary, type ShowerParams, type ShowerResult } from './types';

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

/** All-particle integral flux above E (eV), m^-2 s^-1 sr^-1: E^2.6 J = 4000 GeV^1.6 at a 4 PeV knee (slope -2.7 below, -3.1 above). */
function integralFlux(eEV: number): number {
  const E = eEV * 1e-9;
  const knee = 4e6;
  const atKnee = 4000 * Math.pow(knee, -2.6);
  if (E >= knee) return (atKnee * knee) / 2.1 * Math.pow(E / knee, -2.1);
  const below = (atKnee * knee / 1.7) * (Math.pow(E / knee, -1.7) - 1);
  return below + (atKnee * knee) / 2.1;
}

export interface SkyPlan {
  options: SkyOptions;
  /** Parameters of each shower, in arrival order. */
  params: ShowerParams[];
  /** Arrival time of each shower's core at the ground, ns. */
  arrivals: number[];
  ratePerSecond: number;
}

/** Draw the showers: Poisson arrivals, energies, composition, directions, cores. Pure and seeded. */
export function planSky(o: SkyOptions): SkyPlan {
  const rng = new Rng(o.seed);
  const perShower = Math.max(2000, Math.floor(o.maxSegments / o.showers));
  const area = (2 * o.halfWidthM) ** 2;
  const rate = integralFlux(o.eMinEV) * Math.PI * 0.75 * area; // showers per second above eMin into the square
  const params: ShowerParams[] = [];
  const arrivals: number[] = [];
  let tArrive = 0;
  for (let k = 0; k < o.showers; k++) {
    tArrive += rng.exp(1e9 / rate); // ns
    // Differential spectrum E^-2.7 (inverse CDF); the knee is above where nearly all of them land.
    const a = Math.pow(o.eMinEV, -1.7), bq = Math.pow(o.eMaxEV, -1.7);
    const E = Math.pow(a - rng.uniform() * (a - bq), -1 / 1.7);
    const u = rng.uniform();
    const primary: Primary = u < 0.45 ? 'proton' : u < 0.75 ? 'helium' : u < 0.9 ? 'nitrogen' : 'iron';
    const cosT = Math.sqrt(1 - rng.uniform() * 0.75); // up to 60 deg, flux through a horizontal plane
    const azimuthDeg = 360 * rng.uniform();
    const coreX = (rng.uniform() * 2 - 1) * o.halfWidthM;
    const coreY = (rng.uniform() * 2 - 1) * o.halfWidthM;
    params.push({
      ...DEFAULT_PARAMS, primary, energyEV: E, zenithDeg: (Math.acos(cosT) * 180) / Math.PI, azimuthDeg,
      seed: (o.seed * 7919 + k * 104729) >>> 0, thinning: o.thinning, maxSegments: perShower, coreX, coreY, recordTracks: true,
    });
    arrivals.push(tArrive);
  }
  return { options: o, params, arrivals, ratePerSecond: rate };
}

/** Put every simulated shower on the common clock and merge them into one replay. Mutates the inputs' arrays. */
export function mergeSky(plan: SkyPlan, showers: ShowerResult[]): { result: ShowerResult; info: SkyInfo; brightest: ShowerResult } {
  let tracked = 0, segTotal = 0, gndTotal = 0;
  let tMin = Infinity, tMax = -Infinity;
  let bi = 0;
  const shifts: number[] = [];
  showers.forEach((r, k) => {
    const shift = plan.arrivals[k]! - r.stats.tCore;
    shifts.push(shift);
    const s = r.segments;
    for (let i = 0; i < r.segmentCount; i++) { s[i * SEG_STRIDE + 3]! += shift; s[i * SEG_STRIDE + 7]! += shift; }
    const g = r.ground;
    for (let i = 0; i < r.groundCount; i++) g[i * GND_STRIDE + 2]! += shift;
    tMin = Math.min(tMin, r.stats.tMin + shift);
    tMax = Math.max(tMax, r.stats.tMax + shift);
    tracked += r.stats.particlesTracked;
    segTotal += r.segmentCount;
    gndTotal += r.groundCount;
    if (plan.params[k]!.energyEV > plan.params[bi]!.energyEV) bi = k;
  });
  const segments = new Float32Array(segTotal * SEG_STRIDE);
  const ground = new Float32Array(gndTotal * GND_STRIDE);
  let so = 0, go = 0;
  for (const r of showers) {
    segments.set(r.segments.subarray(0, r.segmentCount * SEG_STRIDE), so); so += r.segmentCount * SEG_STRIDE;
    ground.set(r.ground.subarray(0, r.groundCount * GND_STRIDE), go); go += r.groundCount * GND_STRIDE;
  }
  const profiles = showers.map((r) => r.profile);
  const bins = Math.max(...profiles.map((p) => p.bins));
  const sum = (pick: (p: ShowerResult['profile']) => Float64Array): Float64Array => {
    const a = new Float64Array(bins);
    for (const p of profiles) pick(p).forEach((v, i) => { a[i]! += v; });
    return a;
  };
  const profile = {
    step: profiles[0]!.step, bins,
    byClass: Array.from({ length: RCLASS_COUNT }, (_, c) => sum((p) => p.byClass[c]!)),
    charged: sum((p) => p.charged),
  };
  const b = showers[bi]!;
  // The brightest shower's arrays were shifted onto the common clock; shift its stats too.
  b.stats = { ...b.stats, tMin: b.stats.tMin + shifts[bi]!, tMax: b.stats.tMax + shifts[bi]!, tCore: b.stats.tCore + shifts[bi]! };
  const first = plan.arrivals[0]!, last = plan.arrivals[plan.arrivals.length - 1]!;
  const result: ShowerResult = {
    params: { ...b.params },
    segments, segmentCount: segTotal, ground, groundCount: gndTotal, profile,
    // From shortly before the first core lands to shortly after the last, so a few slow hadrons
    // do not stretch the replay.
    stats: { ...b.stats, tMin: Math.max(tMin, first - 60_000), tMax: Math.min(tMax, last + 25_000), particlesTracked: tracked, truncated: true },
  };
  const energies = plan.params.map((p) => p.energyEV);
  return {
    result,
    brightest: b,
    info: {
      showers: showers.length, realSpanSeconds: last * 1e-9, ratePerSecond: plan.ratePerSecond,
      energiesEV: energies, primaries: plan.params.map((p) => p.primary), brightest: bi,
    },
  };
}

/** Sequential sky (tests, Node): plan, simulate each shower, merge. */
export function simulateSky(o: SkyOptions, onProgress?: (f: number, tracked: number) => void): { result: ShowerResult; info: SkyInfo; brightest: ShowerResult } {
  const plan = planSky(o);
  let tracked = 0;
  const showers = plan.params.map((p, k) => {
    const r = simulateShower(p);
    tracked += r.stats.particlesTracked;
    onProgress?.((k + 1) / plan.params.length, tracked);
    return r;
  });
  return mergeSky(plan, showers);
}