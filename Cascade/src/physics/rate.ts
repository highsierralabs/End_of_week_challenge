// Rate mode: the steady rain of secondary muons at the observatory, and what a
// 1 cm^3 crystal inside a lead castle would count from it.
//
// Translation invariance of a flat atmosphere makes this cheap: the muon flux
// through a horizontal plane equals (rate of primaries per unit horizontal
// area) x (mean muons per primary crossing that plane). We sample primaries
// from the PDG nucleon spectrum (superposition: a nucleus of energy E is A
// nucleons of E/A), simulate the hadronic cascade and its muons only, and record
// every muon crossing three planes around the site: the site depth and +-dX,
// which gives the barometric coefficient from one correlated sample.
import { altitudeAtDepth, verticalDepth } from './atmosphere';
import { simulateShower, DEFAULT_PARAMS } from './cascade';
import { M_MU } from './constants';
import { Rng } from './rng';
import { PType } from './types';

export interface RateOptions {
  primaries: number;
  seed: number;
  /** Nucleon energy range sampled, GeV (lower end ~ the geomagnetic cutoff). */
  eMinGeV: number;
  eMaxGeV: number;
  /** PDG nucleon intensity I(E) = norm * E^-gamma, m^-2 s^-1 sr^-1 GeV^-1. */
  norm: number;
  gamma: number;
  zenithMaxDeg: number;
  siteAltitudeM: number;
  /** Depth offset of the two extra planes, g/cm^2 (1 g/cm^2 = 0.980665 hPa). */
  dX: number;
  /** Castle: lid and wall lead thickness, cm; muon loss in lead, GeV per cm. */
  lidCm: number;
  wallCm: number;
  leadLossGeVPerCm: number;
  /** Crystal edge, cm; overflow threshold, MeV; muon dE/dx in CsI, MeV/cm. */
  crystalCm: number;
  thresholdMeV: number;
  csiDedxMeVPerCm: number;
}

export const DEFAULT_RATE: RateOptions = {
  primaries: 60000,
  seed: 1,
  eMinGeV: 4.5,
  eMaxGeV: 2e5,
  norm: 1.8e4,
  gamma: 2.7,
  zenithMaxDeg: 85,
  siteAltitudeM: 1539,
  dX: 10.2,
  lidCm: 4,
  wallCm: 3,
  leadLossGeVPerCm: 0.0127,
  crystalCm: 1,
  thresholdMeV: 2.78,
  csiDedxMeVPerCm: 5.6,
};

export interface PlaneRate {
  altitudeM: number;
  depth: number;
  pressureHPa: number;
  /** Muons through a horizontal surface, cm^-2 s^-1 (all energies above the muon cut). */
  horizontalFlux: number;
  /** Same, above 1 GeV (comparable with the PDG sea-level figure). */
  horizontalFlux1GeV: number;
  /** Vertical intensity above 1 GeV, cm^-2 s^-1 sr^-1, from muons with cos(theta) > 0.95. */
  verticalIntensity1GeV: number;
  /** Muons through a bare 1 cm^3 crystal, s^-1 (any chord). */
  crystalBare: number;
  /** Muons that clear the lead and leave more than the threshold in the crystal, s^-1. */
  crystalShielded: number;
  /** Relative statistical error of crystalShielded. */
  crystalShieldedRelErr: number;
  muons: number;
}

export interface RateResult {
  options: RateOptions;
  planes: PlaneRate[];
  /** d ln(R) / dP for the shielded crystal, percent per hPa, with its statistical error. */
  barometricPctPerHPa: number;
  barometricErr: number;
  /** Rate of primaries through a horizontal unit area used for normalisation, m^-2 s^-1. */
  primaryRatePerM2: number;
  cpuMs: number;
}

/**
 * Effective area (cm^2) of the crystal for a muon from direction (cosT, phi):
 * projected area times the fraction of chords at least `minChord` long. Tabulated
 * once by Monte Carlo over entry points.
 */
export function crystalAcceptanceTable(edge: number, minChord: number, nT = 20, nP = 12, samples = 4000): Float64Array {
  const t = new Float64Array(nT * nP);
  const rng = new Rng(12345);
  for (let i = 0; i < nT; i++) {
    const cosT = (i + 0.5) / nT;
    const sinT = Math.sqrt(1 - cosT * cosT);
    for (let j = 0; j < nP; j++) {
      const phi = ((j + 0.5) / nP) * (Math.PI / 2);
      // Direction of travel (downward).
      const d = [sinT * Math.cos(phi), sinT * Math.sin(phi), -cosT] as const;
      // Sample lines on a plane perpendicular to d through the cube centre, over a square that covers the projection.
      const u = Math.abs(d[2]) < 0.9 ? norm(cross(d, [0, 0, 1])) : norm(cross(d, [1, 0, 0]));
      const v = cross(d, u);
      const R = edge * 0.87;
      let hits = 0;
      let good = 0;
      for (let k = 0; k < samples; k++) {
        const a = (rng.uniform() * 2 - 1) * R;
        const b = (rng.uniform() * 2 - 1) * R;
        const p = [a * u[0] + b * v[0], a * u[1] + b * v[1], a * u[2] + b * v[2]];
        const chord = slabChord(p, d, edge / 2);
        if (chord > 0) { hits++; if (chord >= minChord) good++; }
      }
      const area = (2 * R) * (2 * R);
      t[i * nP + j] = (good / samples) * area;
      void hits;
    }
  }
  return t;
}

// ---------------------------------------------------------------- shared detector model

const TABLE_T = 20;
const TABLE_P = 12;
const tableCache = new Map<string, Float64Array>();

/** Memoised acceptance table for a cube of the given edge and minimum chord. */
export function acceptanceTable(edge: number, minChord: number): Float64Array {
  const key = `${edge}/${minChord}`;
  let t = tableCache.get(key);
  if (!t) { t = crystalAcceptanceTable(edge, minChord, TABLE_T, TABLE_P); tableCache.set(key, t); }
  return t;
}

/**
 * Crystal crossings per unit horizontal-plane flux for one direction of travel, cm^2:
 * effective area (projected area x long-chord fraction) divided by cos(theta).
 */
export function crossingArea(table: Float64Array, dx: number, dy: number, dz: number): number {
  const cosT = -dz;
  if (cosT <= 0.02) return 0;
  const ti = Math.min(TABLE_T - 1, Math.floor(cosT * TABLE_T));
  const phi = Math.min(Math.PI / 2, Math.atan2(Math.abs(dy), Math.abs(dx)));
  const pj = Math.min(TABLE_P - 1, Math.floor((phi / (Math.PI / 2)) * TABLE_P));
  return table[ti * TABLE_P + pj]! / cosT;
}

/**
 * Lead crossed on the way to a crystal at the centre of a cube-shaped cavity: through
 * the lid when the direction's horizontal run stays inside the cavity over its height
 * (max(|dx|,|dy|) <= cos(theta)), otherwise through the wall it meets. cm.
 */
export function leadPathCm(dx: number, dy: number, dz: number, lidCm: number, wallCm: number): number {
  const cosT = Math.max(-dz, 1e-3);
  const horiz = Math.max(Math.abs(dx), Math.abs(dy));
  return horiz <= cosT ? lidCm / cosT : wallCm / Math.max(horiz, 1e-3);
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}
function norm(a: [number, number, number]): [number, number, number] {
  const m = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / m, a[1] / m, a[2] / m];
}
/** Length of the line p + s d inside the axis-aligned cube [-h, h]^3. */
function slabChord(p: number[], d: readonly number[], h: number): number {
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]!) < 1e-12) { if (Math.abs(p[k]!) > h) return 0; continue; }
    let a = (-h - p[k]!) / d[k]!, b = (h - p[k]!) / d[k]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t1 > t0 ? t1 - t0 : 0;
}

export function simulateRate(o: RateOptions, onProgress?: (f: number) => void): RateResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const rng = new Rng(o.seed);
  const X0 = verticalDepth(o.siteAltitudeM);
  const depths = [X0 - o.dX, X0, X0 + o.dX];
  const alts = depths.map((x) => altitudeAtDepth(x));
  const ground = alts[2]! - 5;

  const minChord = o.thresholdMeV / o.csiDedxMeVPerCm;
  const acc = acceptanceTable(o.crystalCm, minChord);
  const bare = acceptanceTable(o.crystalCm, 1e-6);
  // Primary normalisation: flux through a horizontal plane = pi sin^2(thmax) * integral I dE.
  const g1 = o.gamma - 1;
  const intI = (o.norm / g1) * (Math.pow(o.eMinGeV, -g1) - Math.pow(o.eMaxGeV, -g1));
  const sin2 = Math.sin((o.zenithMaxDeg * Math.PI) / 180) ** 2;
  const primaryRate = Math.PI * sin2 * intI; // m^-2 s^-1
  const perPrimary = primaryRate / o.primaries / 1e4; // cm^-2 s^-1 per simulated primary

  const acc3 = depths.map(() => ({ flux: 0, flux1: 0, vert: 0, bare: 0, shield: 0, shield2: 0, n: 0 }));
  // Per-primary shielded sums, for the correlated barometric error.
  const perShower = depths.map(() => new Float64Array(o.primaries));
  let current = 0;
  const hooks = {
    planes: alts,
    onCross: (i: number, type: PType, E: number, dx: number, dy: number, dz: number, w: number) => {
      if (type !== PType.MUON_MINUS && type !== PType.MUON_PLUS) return;
      const cosT = -dz;
      if (cosT <= 0.02) return;
      const a = acc3[i]!;
      const wf = w * perPrimary;
      a.n++;
      a.flux += wf;
      if (E > 1) {
        a.flux1 += wf;
        if (cosT > 0.95) a.vert += wf / (2 * Math.PI * 0.05 * cosT);
      }
      // Flux per horizontal area -> particles through the crystal: area_eff / cos(theta).
      a.bare += wf * crossingArea(bare, dx, dy, dz);
      const lead = leadPathCm(dx, dy, dz, o.lidCm, o.wallCm);
      if (E - M_MU > lead * o.leadLossGeVPerCm) {
        const c = wf * crossingArea(acc, dx, dy, dz);
        a.shield += c;
        a.shield2 += c * c;
        perShower[i]![current]! += c;
      }
    },
  };
  for (let k = 0; k < o.primaries; k++) {
    current = k;
    // Energy from E^-gamma (inverse CDF), zenith from cos^2 (flux through a horizontal plane).
    const u = rng.uniform();
    const a = Math.pow(o.eMinGeV, -g1), b = Math.pow(o.eMaxGeV, -g1);
    const E = Math.pow(a - u * (a - b), -1 / g1);
    const cosT = Math.sqrt(1 - rng.uniform() * sin2);
    const az = 360 * rng.uniform();
    simulateShower({
      ...DEFAULT_PARAMS,
      primary: 'proton',
      energyEV: E * 1e9,
      zenithDeg: (Math.acos(cosT) * 180) / Math.PI,
      azimuthDeg: az,
      seed: (o.seed * 1000003 + k) >>> 0,
      thinning: 0,
      trackEm: false,
      recordTracks: false,
      maxSegments: 0,
      muonCutMeV: 20,
      hadronCutGeV: 1,
      groundAltitudeM: ground,
      coreX: 0,
      coreY: 0,
    }, undefined, hooks);
    if (onProgress && k % 500 === 0) onProgress(k / o.primaries);
  }

  const planes: PlaneRate[] = acc3.map((a, i) => ({
    altitudeM: alts[i]!,
    depth: depths[i]!,
    pressureHPa: depths[i]! * 0.980665,
    horizontalFlux: a.flux,
    horizontalFlux1GeV: a.flux1,
    verticalIntensity1GeV: a.vert,
    crystalBare: a.bare,
    crystalShielded: a.shield,
    crystalShieldedRelErr: perShowerRelErr(perShower[i]!),
    muons: a.n,
  }));
  // Barometric coefficient from the correlated difference between the outer planes.
  const lo = perShower[0]!, hi = perShower[2]!;
  const n = o.primaries;
  let sLo = 0, sHi = 0;
  for (let k = 0; k < n; k++) { sLo += lo[k]!; sHi += hi[k]!; }
  const mid = planes[1]!.crystalShielded;
  const dP = 2 * o.dX * 0.980665;
  const beta = ((sHi - sLo) / mid / dP) * 100;
  // Error of the difference using per-primary differences (they share the shower).
  let m = 0, v = 0;
  for (let k = 0; k < n; k++) m += hi[k]! - lo[k]!;
  m /= n;
  for (let k = 0; k < n; k++) v += (hi[k]! - lo[k]! - m) ** 2;
  const seDiff = Math.sqrt(v / (n - 1)) * Math.sqrt(n);
  const betaErr = (seDiff / mid / dP) * 100;
  return {
    options: o,
    planes,
    barometricPctPerHPa: beta,
    barometricErr: betaErr,
    primaryRatePerM2: primaryRate,
    cpuMs: (typeof performance !== 'undefined' ? performance.now() : 0) - t0,
  };
}

function perShowerRelErr(a: Float64Array): number {
  let s = 0, s2 = 0;
  for (const v of a) { s += v; s2 += v * v; }
  const n = a.length;
  if (s <= 0) return 1;
  const mean = s / n;
  const varMean = (s2 / n - mean * mean) / (n - 1);
  return Math.sqrt(Math.max(varMean, 0)) / mean;
}
