// Heliocentric positions of Mercury to Saturn from Keplerian elements with linear rates:
// "Keplerian Elements for Approximate Positions of the Major Planets" (E. M. Standish, JPL;
// after Standish & Williams 1992), as published at https://ssd.jpl.nasa.gov/planets/approx_pos.html
// and kept verbatim in data-src/jpl/approx_pos.html. tests/unit/astro-planets.test.ts parses that
// file and checks every number below against it.
//
// This is the set fitted over 3000 BC to 3000 AD (the page's Table 2a), with the Table 2b terms
// added to the mean anomaly of Jupiter and Saturn. It is a best fit, not a mean: the elements
// are not valid outside that interval.
//
// Frame: the mean ecliptic and equinox of J2000.0, at every date. Time: Julian Date in TDB (the
// page's "Julian ephemeris date"); TT is the same to 2 ms.
//
// 'earth' is the Earth-Moon barycentre row ("EM Bary"), not the Earth's centre: the Earth itself
// circles that point at about 4671 km once a month, which is at most 7 arcsec seen from the Sun.
// 'mars', 'jupiter' and 'saturn' describe the planetary systems as the JPL ephemerides integrate
// them, that is, their barycentres.
//
// Measured against JPL Horizons (DE441) on the dates in src/data/horizons.ts: see
// tests/unit/astro-planets.test.ts for the bounds per body and era.

import { DAYS_PER_CENTURY, centuriesSinceJ2000, norm180, norm360 } from './time';

export const PLANETS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn'] as const;
export type Planet = (typeof PLANETS)[number];

export interface PlanetState {
  /** True heliocentric ecliptic longitude, J2000 frame, degrees in [0, 360). */
  lon: number;
  /** Heliocentric ecliptic latitude, J2000 frame, degrees. */
  lat: number;
  /** Distance from the Sun, au. */
  r: number;
  /** Mean longitude L, J2000 frame, degrees in [0, 360). Includes the Table 2b terms. */
  meanLon: number;
  /** Heliocentric position, au, J2000 ecliptic axes (x to the equinox, z to the ecliptic pole). */
  xyz: readonly [number, number, number];
}

export interface PlanetElements {
  /** Semi-major axis, au. */
  a: number;
  /** Eccentricity. */
  e: number;
  /** Inclination to the J2000 ecliptic, degrees. */
  I: number;
  /** Mean longitude, degrees, unwrapped, including the Table 2b terms. */
  L: number;
  /** Longitude of perihelion, degrees. */
  lonPeri: number;
  /** Longitude of the ascending node, degrees. */
  lonNode: number;
}

/** One row pair of Table 2a: values at J2000.0, then rates per Julian century. */
export interface ElementRow {
  readonly a: readonly [number, number];
  readonly e: readonly [number, number];
  readonly I: readonly [number, number];
  readonly L: readonly [number, number];
  readonly lonPeri: readonly [number, number];
  readonly lonNode: readonly [number, number];
}

/** Table 2a: a in au, e dimensionless, angles in degrees; rates per Julian century. */
export const ELEMENT_TABLE: Readonly<Record<Planet, ElementRow>> = {
  mercury: {
    a: [0.38709843, 0.00000000],
    e: [0.20563661, 0.00002123],
    I: [7.00559432, -0.00590158],
    L: [252.25166724, 149472.67486623],
    lonPeri: [77.45771895, 0.15940013],
    lonNode: [48.33961819, -0.12214182],
  },
  venus: {
    a: [0.72332102, -0.00000026],
    e: [0.00676399, -0.00005107],
    I: [3.39777545, 0.00043494],
    L: [181.97970850, 58517.81560260],
    lonPeri: [131.76755713, 0.05679648],
    lonNode: [76.67261496, -0.27274174],
  },
  earth: {
    a: [1.00000018, -0.00000003],
    e: [0.01673163, -0.00003661],
    I: [-0.00054346, -0.01337178],
    L: [100.46691572, 35999.37306329],
    lonPeri: [102.93005885, 0.31795260],
    lonNode: [-5.11260389, -0.24123856],
  },
  mars: {
    a: [1.52371243, 0.00000097],
    e: [0.09336511, 0.00009149],
    I: [1.85181869, -0.00724757],
    L: [-4.56813164, 19140.29934243],
    lonPeri: [-23.91744784, 0.45223625],
    lonNode: [49.71320984, -0.26852431],
  },
  jupiter: {
    a: [5.20248019, -0.00002864],
    e: [0.04853590, 0.00018026],
    I: [1.29861416, -0.00322699],
    L: [34.33479152, 3034.90371757],
    lonPeri: [14.27495244, 0.18199196],
    lonNode: [100.29282654, 0.13024619],
  },
  saturn: {
    a: [9.54149883, -0.00003065],
    e: [0.05550825, -0.00032044],
    I: [2.49424102, 0.00451969],
    L: [50.07571329, 1222.11494724],
    lonPeri: [92.86136063, 0.54179478],
    lonNode: [113.63998702, -0.25015002],
  },
};

/**
 * Table 2b: M = L - lonPeri + b T^2 + c cos(f T) + s sin(f T), all in degrees with f T in
 * degrees and T in centuries: a quadratic plus one long-period term (360 / 38.35125 centuries =
 * 939 years) standing in for the great inequality of Jupiter and Saturn. Planets without a row
 * take none.
 */
export const EXTRA_TERMS: Readonly<Partial<Record<Planet, { readonly b: number; readonly c: number; readonly s: number; readonly f: number }>>> = {
  jupiter: { b: -0.00012452, c: 0.06064060, s: -0.35635438, f: 38.35125000 },
  saturn: { b: 0.00025899, c: -0.13434469, s: 0.87320147, f: 38.35125000 },
};

const RAD = Math.PI / 180;
/** Convergence of the eccentric anomaly, radians. */
const KEPLER_TOLERANCE = 1e-10;

/**
 * Mean longitude without wrapping, degrees: the linear part plus, for Jupiter and Saturn, the
 * Table 2b terms (which the source adds to the mean anomaly; with the perihelion left alone
 * that is the same as adding them to L). Differences over centuries are meaningful.
 */
export function meanLongitudeUnwrapped(p: Planet, jd: number): number {
  const T = centuriesSinceJ2000(jd);
  const row = ELEMENT_TABLE[p];
  let L = row.L[0] + row.L[1] * T;
  const extra = EXTRA_TERMS[p];
  if (extra) L += extra.b * T * T + extra.c * Math.cos(extra.f * T * RAD) + extra.s * Math.sin(extra.f * T * RAD);
  return L;
}

/** Linear rate of the mean longitude, degrees per day, relative to the fixed J2000 frame. */
export function meanMotionDegPerDay(p: Planet): number {
  return ELEMENT_TABLE[p].L[1] / DAYS_PER_CENTURY;
}

/** Sidereal period implied by the linear rate of L, days. */
export function siderealPeriodDays(p: Planet): number {
  return 360 / meanMotionDegPerDay(p);
}

/** The six elements at a date. Angles in degrees, not wrapped. */
export function elements(p: Planet, jd: number): PlanetElements {
  const T = centuriesSinceJ2000(jd);
  const row = ELEMENT_TABLE[p];
  return {
    a: row.a[0] + row.a[1] * T,
    e: row.e[0] + row.e[1] * T,
    I: row.I[0] + row.I[1] * T,
    L: meanLongitudeUnwrapped(p, jd),
    lonPeri: row.lonPeri[0] + row.lonPeri[1] * T,
    lonNode: row.lonNode[0] + row.lonNode[1] * T,
  };
}

/** Solve M = E - e sin E for E (radians) by Newton's method, to 1e-10 rad. */
export function solveKepler(meanAnomalyRad: number, e: number): number {
  let E = meanAnomalyRad + e * Math.sin(meanAnomalyRad);
  for (let i = 0; i < 30; i++) {
    const dE = (meanAnomalyRad - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < KEPLER_TOLERANCE) break;
  }
  return E;
}

/** Heliocentric state of a planet at a Julian Date (TDB), J2000 ecliptic frame. */
export function planetState(p: Planet, jd: number): PlanetState {
  const el = elements(p, jd);
  const M = norm180(el.L - el.lonPeri) * RAD;
  const E = solveKepler(M, el.e);

  // In the orbital plane, x' towards perihelion.
  const xp = el.a * (Math.cos(E) - el.e);
  const yp = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);

  // r = Rz(-node) Rx(-I) Rz(-argPeri) r'
  const w = (el.lonPeri - el.lonNode) * RAD;
  const node = el.lonNode * RAD;
  const inc = el.I * RAD;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const cn = Math.cos(node);
  const sn = Math.sin(node);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  const x = (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp;
  const y = (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp;
  const z = sw * si * xp + cw * si * yp;

  const r = Math.hypot(x, y, z);
  return {
    lon: norm360(Math.atan2(y, x) / RAD),
    lat: Math.asin(z / r) / RAD,
    r,
    meanLon: norm360(el.L),
    xyz: [x, y, z],
  };
}
