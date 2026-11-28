// Geocentric position of the Moon: Meeus, Astronomical Algorithms (2nd ed.), ch. 47, a truncation
// of the lunar theory ELP-2000/82 (Chapront-Touze & Chapront): five mean elements as polynomials
// in time, 60 periodic terms each for longitude, distance and latitude, and 9 additive terms.
//
// The numbers were not typed from memory. They are the tables of ERFA's eraMoon98
// (https://github.com/liberfa/erfa, src/moon98.c, BSD 3-clause, derived from the IAU SOFA
// library), which states that it is a full implementation of Meeus's algorithm; the file is
// kept verbatim, licence included, in data-src/erfa/moon98.c, and tests/unit/astro-moon.test.ts
// parses it and checks every coefficient below against it. Like ERFA, and unlike the book, the
// constant of the mean longitude is 218.31665436 (Simon et al. 1994) rather than 218.3164477:
// the book's value has the Moon's light time (-0.70 arcsec) folded in, and positions here are
// geometric, as the Horizons vectors they are checked against are.
//
// Frame. The series gives longitude and latitude on the mean ecliptic and equinox OF DATE. The
// machine lives in an inertial frame, so the position is rotated to the mean ecliptic and
// equinox of J2000.0 with the IAU 2006 precession of the ecliptic (Capitaine et al. 2003: the
// angles pi_A, Pi_A and the general precession p_A, polynomials taken from ERFA's p06e.c, kept
// in data-src/erfa/p06e.c). The rotation is rigorous: it carries the 47 arcsec per century
// motion of the ecliptic plane itself as well as the 1.397 degree per century precession.
//   - `lon` is the J2000 longitude.
//   - `lat` is the latitude above the ecliptic OF DATE, because that is the plane the Sun moves
//     in and so the latitude that decides eclipses. `latJ2000` is the latitude above the fixed
//     J2000 ecliptic; the two differ by at most 0.0133 degree per century from J2000.
//   - `meanLon`, `node` and `perigee` are the mean elements of date minus p_A. That ignores the
//     tilt between the two ecliptics, an error below 47 arcsec x tan(5.1 deg) = 4 arcsec per
//     century from J2000, far inside the periodic terms a mean element leaves out anyway.
// The precession polynomials are fitted near J2000; a few thousand years away they drift from
// long-term models by arcseconds to tens of arcseconds, small against the series itself there.
//
// Time is a Julian Date in TT or TDB. Nutation, aberration and light time are not applied.
//
// Accuracy measured against JPL Horizons (DE441) on the dates in src/data/horizons.ts: see
// tests/unit/astro-moon.test.ts for the bounds, per era.

import { planetState } from './planets';
import { DAYS_PER_CENTURY, centuriesSinceJ2000, norm360 } from './time';

export interface MoonState {
  /** True geocentric ecliptic longitude, mean ecliptic and equinox of J2000.0, degrees in [0, 360). */
  lon: number;
  /** Geocentric latitude above the mean ecliptic of date, degrees. */
  lat: number;
  /** Geocentric latitude above the fixed J2000 ecliptic, degrees. */
  latJ2000: number;
  /** Distance between the centres of the Earth and the Moon, km. */
  distKm: number;
  /** Mean longitude L', J2000 frame, degrees in [0, 360). */
  meanLon: number;
  /** Longitude of the mean ascending node, J2000 frame, degrees in [0, 360). */
  node: number;
  /** Longitude of the mean perigee, J2000 frame, degrees in [0, 360). */
  perigee: number;
  /** True Moon minus true Sun, geocentric longitude, degrees in [0, 360): 0 new, 180 full. */
  elongation: number;
}

const RAD = Math.PI / 180;
const ARCSEC = 1 / 3600;
/** Kilometres per astronomical unit (IAU 2012). */
export const AU_KM = 149597870.7;
/**
 * Mass of the Earth over mass of the Moon. JPL's ephemerides use 81.30057; the value recovered
 * from the Horizons rows shipped in src/data/horizons.ts (Sun, Moon and Earth-Moon barycentre
 * on the same dates) agrees, see tests/unit/astro-moon.test.ts.
 */
export const EARTH_MOON_MASS_RATIO = 81.30057;

/** Polynomial coefficients in T (Julian centuries from J2000.0), degrees, lowest power first. */
type Poly = readonly [number, number, number, number, number];

/** Mean elements of the Moon and Sun, mean equinox of date (Meeus 47.1 to 47.5). */
export const MEAN_ELEMENTS = {
  /** L': mean longitude of the Moon (geometric: see the note at the top). */
  Lp: [218.31665436, 481267.88123421, -0.0015786, 1 / 538841, -1 / 65194000],
  /** D: mean elongation of the Moon from the Sun. */
  D: [297.8501921, 445267.1114034, -0.0018819, 1 / 545868, 1 / 113065000],
  /** M: mean anomaly of the Sun. */
  M: [357.5291092, 35999.0502909, -0.0001536, 1 / 24490000, 0],
  /** M': mean anomaly of the Moon. */
  Mp: [134.9633964, 477198.8675055, 0.0087414, 1 / 69699, -1 / 14712000],
  /** F: mean distance of the Moon from its ascending node (argument of latitude). */
  F: [93.272095, 483202.0175233, -0.0036539, 1 / 3526000, 1 / 863310000],
} as const satisfies Record<string, Poly>;

/** Arguments of the additive terms: A1 (Venus), A2 (Jupiter), A3; degrees, [constant, per century]. */
export const ADDITIVE_ARGUMENTS = {
  A1: [119.75, 131.849],
  A2: [53.09, 479264.29],
  A3: [313.45, 481266.484],
} as const;

/** Additive terms, degrees: longitude sin(A1), sin(L' - F), sin(A2); latitude as labelled. */
export const ADDITIVE_TERMS = {
  lonA1: 0.003958,
  lonLpMinusF: 0.001962,
  lonA2: 0.000318,
  latLp: -0.002235,
  latA3: 0.000382,
  latA1MinusF: 0.000175,
  latA1PlusF: 0.000175,
  latLpMinusMp: 0.000127,
  latLpPlusMp: -0.000115,
} as const;

/** Eccentricity factor E = 1 + E1 T + E2 T^2, applied once per power of M in a term. */
export const ECCENTRICITY_FACTOR = [-0.002516, -0.0000074] as const;

/** Constant term of the distance, km. */
export const MEAN_DISTANCE_KM = 385000.56;

/**
 * Meeus Table 47.A. Each row: multiples of D, M, M', F; coefficient of the sine of the argument
 * in longitude (degrees); coefficient of the cosine in distance (metres).
 */
export const LONGITUDE_DISTANCE_TERMS: readonly (readonly [number, number, number, number, number, number])[] = [
  [0,  0,  1,  0,  6.288774, -20905355],
  [2,  0, -1,  0,  1.274027,  -3699111],
  [2,  0,  0,  0,  0.658314,  -2955968],
  [0,  0,  2,  0,  0.213618,   -569925],
  [0,  1,  0,  0, -0.185116,     48888],
  [0,  0,  0,  2, -0.114332,     -3149],
  [2,  0, -2,  0,  0.058793,    246158],
  [2, -1, -1,  0,  0.057066,   -152138],
  [2,  0,  1,  0,  0.053322,   -170733],
  [2, -1,  0,  0,  0.045758,   -204586],
  [0,  1, -1,  0, -0.040923,   -129620],
  [1,  0,  0,  0, -0.034720,    108743],
  [0,  1,  1,  0, -0.030383,    104755],
  [2,  0,  0, -2,  0.015327,     10321],
  [0,  0,  1,  2, -0.012528,         0],
  [0,  0,  1, -2,  0.010980,     79661],
  [4,  0, -1,  0,  0.010675,    -34782],
  [0,  0,  3,  0,  0.010034,    -23210],
  [4,  0, -2,  0,  0.008548,    -21636],
  [2,  1, -1,  0, -0.007888,     24208],
  [2,  1,  0,  0, -0.006766,     30824],
  [1,  0, -1,  0, -0.005163,     -8379],
  [1,  1,  0,  0,  0.004987,    -16675],
  [2, -1,  1,  0,  0.004036,    -12831],
  [2,  0,  2,  0,  0.003994,    -10445],
  [4,  0,  0,  0,  0.003861,    -11650],
  [2,  0, -3,  0,  0.003665,     14403],
  [0,  1, -2,  0, -0.002689,     -7003],
  [2,  0, -1,  2, -0.002602,         0],
  [2, -1, -2,  0,  0.002390,     10056],
  [1,  0,  1,  0, -0.002348,      6322],
  [2, -2,  0,  0,  0.002236,     -9884],
  [0,  1,  2,  0, -0.002120,      5751],
  [0,  2,  0,  0, -0.002069,         0],
  [2, -2, -1,  0,  0.002048,     -4950],
  [2,  0,  1, -2, -0.001773,      4130],
  [2,  0,  0,  2, -0.001595,         0],
  [4, -1, -1,  0,  0.001215,     -3958],
  [0,  0,  2,  2, -0.001110,         0],
  [3,  0, -1,  0, -0.000892,      3258],
  [2,  1,  1,  0, -0.000810,      2616],
  [4, -1, -2,  0,  0.000759,     -1897],
  [0,  2, -1,  0, -0.000713,     -2117],
  [2,  2, -1,  0, -0.000700,      2354],
  [2,  1, -2,  0,  0.000691,         0],
  [2, -1,  0, -2,  0.000596,         0],
  [4,  0,  1,  0,  0.000549,     -1423],
  [0,  0,  4,  0,  0.000537,     -1117],
  [4, -1,  0,  0,  0.000520,     -1571],
  [1,  0, -2,  0, -0.000487,     -1739],
  [2,  1,  0, -2, -0.000399,         0],
  [0,  0,  2, -2, -0.000381,     -4421],
  [1,  1,  1,  0,  0.000351,         0],
  [3,  0, -2,  0, -0.000340,         0],
  [4,  0, -3,  0,  0.000330,         0],
  [2, -1,  2,  0,  0.000327,         0],
  [0,  2,  1,  0, -0.000323,      1165],
  [1,  1, -1,  0,  0.000299,         0],
  [2,  0,  3,  0,  0.000294,         0],
  [2,  0, -1, -2,  0.000000,      8752],
];

/** Meeus Table 47.B. Each row: multiples of D, M, M', F; coefficient of the sine in latitude (degrees). */
export const LATITUDE_TERMS: readonly (readonly [number, number, number, number, number])[] = [
  [0,  0,  0,  1,  5.128122],
  [0,  0,  1,  1,  0.280602],
  [0,  0,  1, -1,  0.277693],
  [2,  0,  0, -1,  0.173237],
  [2,  0, -1,  1,  0.055413],
  [2,  0, -1, -1,  0.046271],
  [2,  0,  0,  1,  0.032573],
  [0,  0,  2,  1,  0.017198],
  [2,  0,  1, -1,  0.009266],
  [0,  0,  2, -1,  0.008822],
  [2, -1,  0, -1,  0.008216],
  [2,  0, -2, -1,  0.004324],
  [2,  0,  1,  1,  0.004200],
  [2,  1,  0, -1, -0.003359],
  [2, -1, -1,  1,  0.002463],
  [2, -1,  0,  1,  0.002211],
  [2, -1, -1, -1,  0.002065],
  [0,  1, -1, -1, -0.001870],
  [4,  0, -1, -1,  0.001828],
  [0,  1,  0,  1, -0.001794],
  [0,  0,  0,  3, -0.001749],
  [0,  1, -1,  1, -0.001565],
  [1,  0,  0,  1, -0.001491],
  [0,  1,  1,  1, -0.001475],
  [0,  1,  1, -1, -0.001410],
  [0,  1,  0, -1, -0.001344],
  [1,  0,  0, -1, -0.001335],
  [0,  0,  3,  1,  0.001107],
  [4,  0,  0, -1,  0.001021],
  [4,  0, -1,  1,  0.000833],
  [0,  0,  1, -3,  0.000777],
  [4,  0, -2,  1,  0.000671],
  [2,  0,  0, -3,  0.000607],
  [2,  0,  2, -1,  0.000596],
  [2, -1,  1, -1,  0.000491],
  [2,  0, -2,  1, -0.000451],
  [0,  0,  3, -1,  0.000439],
  [2,  0,  2,  1,  0.000422],
  [2,  0, -3, -1,  0.000421],
  [2,  1, -1,  1, -0.000366],
  [2,  1,  0,  1, -0.000351],
  [4,  0,  0,  1,  0.000331],
  [2, -1,  1,  1,  0.000315],
  [2, -2,  0, -1,  0.000302],
  [0,  0,  1,  3, -0.000283],
  [2,  1,  1, -1, -0.000229],
  [1,  1,  0, -1,  0.000223],
  [1,  1,  0,  1,  0.000223],
  [0,  1, -2, -1, -0.000220],
  [2,  1, -1, -1, -0.000220],
  [1,  0,  1,  1, -0.000185],
  [2, -1, -2, -1,  0.000181],
  [0,  1,  2,  1, -0.000177],
  [4,  0, -2, -1,  0.000176],
  [4, -1, -1, -1,  0.000166],
  [1,  0,  1, -1, -0.000164],
  [4,  0,  1, -1,  0.000132],
  [1,  0, -1, -1, -0.000119],
  [4, -1,  0, -1,  0.000115],
  [2, -2,  0,  1,  0.000107],
];

/**
 * IAU 2006 precession of the ecliptic (Capitaine, Wallace & Chapront 2003), arcseconds, powers
 * of T from the first (general precession and inclination) or zeroth (node) upwards.
 */
export const PRECESSION = {
  /** p_A: general precession in longitude accumulated since J2000.0. */
  pA: [5028.796195, 1.1054348, 0.00007964, -0.000023857, -0.0000000383],
  /** pi_A: angle between the ecliptic of date and the J2000 ecliptic. */
  piA: [46.998973, -0.0334926, -0.00012559, 0.000000113, -0.0000000022],
  /** Pi_A: J2000 longitude of the ascending node of the ecliptic of date on the J2000 ecliptic. */
  PiA: [629546.7936, -867.95758, 0.157992, -0.0005371, -0.00004797, 0.000000072],
} as const;

function poly(c: Poly, T: number): number {
  return c[0] + T * (c[1] + T * (c[2] + T * (c[3] + T * c[4])));
}

/** General precession in longitude accumulated from J2000.0 to the date, degrees (IAU 2006). */
export function generalPrecessionDeg(jd: number): number {
  const T = centuriesSinceJ2000(jd);
  const c = PRECESSION.pA;
  return T * (c[0] + T * (c[1] + T * (c[2] + T * (c[3] + T * c[4])))) * ARCSEC;
}

/**
 * Rotate a direction given on the mean ecliptic and equinox of date to the mean ecliptic and
 * equinox of J2000.0. Returns J2000 longitude and latitude in degrees (longitude not wrapped).
 *
 * The ecliptic of date crosses the J2000 ecliptic at its ascending node, J2000 longitude Pi_A,
 * at the angle pi_A; the same node has longitude Pi_A + p_A in the frame of date. So: turn about
 * the pole of date to put the x axis on the node, tilt by -pi_A about it, turn back by -Pi_A.
 */
export function eclipticOfDateToJ2000(lonDeg: number, latDeg: number, jd: number): { lon: number; lat: number } {
  const T = centuriesSinceJ2000(jd);
  const a = PRECESSION.piA;
  const piA = T * (a[0] + T * (a[1] + T * (a[2] + T * (a[3] + T * a[4])))) * ARCSEC * RAD;
  const n = PRECESSION.PiA;
  const PiA = (n[0] + T * (n[1] + T * (n[2] + T * (n[3] + T * (n[4] + T * n[5]))))) * ARCSEC * RAD;
  const pA = generalPrecessionDeg(jd) * RAD;

  const fromNode = lonDeg * RAD - (PiA + pA);
  const cb = Math.cos(latDeg * RAD);
  const sb = Math.sin(latDeg * RAD);
  const x = cb * Math.cos(fromNode);
  const y0 = cb * Math.sin(fromNode);
  const y = y0 * Math.cos(piA) - sb * Math.sin(piA);
  const z = y0 * Math.sin(piA) + sb * Math.cos(piA);
  return {
    lon: (Math.atan2(y, x) + PiA) / RAD,
    lat: Math.asin(Math.max(-1, Math.min(1, z))) / RAD,
  };
}

/** The Moon on the mean ecliptic and equinox of date: longitude in [0, 360) and latitude in degrees, distance in km. */
export function moonOfDate(jd: number): { lon: number; lat: number; distKm: number } {
  const T = centuriesSinceJ2000(jd);
  const Lp = poly(MEAN_ELEMENTS.Lp, T);
  const D = poly(MEAN_ELEMENTS.D, T) * RAD;
  const M = poly(MEAN_ELEMENTS.M, T) * RAD;
  const Mp = poly(MEAN_ELEMENTS.Mp, T) * RAD;
  const F = poly(MEAN_ELEMENTS.F, T) * RAD;
  const E = 1 + T * (ECCENTRICITY_FACTOR[0] + T * ECCENTRICITY_FACTOR[1]);
  const E2 = E * E;

  let sumL = 0;
  let sumR = 0;
  for (const [d, m, mp, f, cl, cr] of LONGITUDE_DISTANCE_TERMS) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const ecc = m === 0 ? 1 : m === 1 || m === -1 ? E : E2;
    sumL += cl * ecc * Math.sin(arg);
    sumR += cr * ecc * Math.cos(arg);
  }
  let sumB = 0;
  for (const [d, m, mp, f, cb] of LATITUDE_TERMS) {
    const arg = d * D + m * M + mp * Mp + f * F;
    const ecc = m === 0 ? 1 : m === 1 || m === -1 ? E : E2;
    sumB += cb * ecc * Math.sin(arg);
  }

  const LpRad = Lp * RAD;
  const A1 = (ADDITIVE_ARGUMENTS.A1[0] + ADDITIVE_ARGUMENTS.A1[1] * T) * RAD;
  const A2 = (ADDITIVE_ARGUMENTS.A2[0] + ADDITIVE_ARGUMENTS.A2[1] * T) * RAD;
  const A3 = (ADDITIVE_ARGUMENTS.A3[0] + ADDITIVE_ARGUMENTS.A3[1] * T) * RAD;
  sumL += ADDITIVE_TERMS.lonA1 * Math.sin(A1)
    + ADDITIVE_TERMS.lonLpMinusF * Math.sin(LpRad - F)
    + ADDITIVE_TERMS.lonA2 * Math.sin(A2);
  sumB += ADDITIVE_TERMS.latLp * Math.sin(LpRad)
    + ADDITIVE_TERMS.latA3 * Math.sin(A3)
    + ADDITIVE_TERMS.latA1MinusF * Math.sin(A1 - F)
    + ADDITIVE_TERMS.latA1PlusF * Math.sin(A1 + F)
    + ADDITIVE_TERMS.latLpMinusMp * Math.sin(LpRad - Mp)
    + ADDITIVE_TERMS.latLpPlusMp * Math.sin(LpRad + Mp);

  return { lon: norm360(Lp + sumL), lat: sumB, distKm: MEAN_DISTANCE_KM + sumR / 1000 };
}

/** Mean longitude of the Moon, J2000 frame, degrees, not wrapped. */
export function moonMeanLongitudeUnwrapped(jd: number): number {
  return poly(MEAN_ELEMENTS.Lp, centuriesSinceJ2000(jd)) - generalPrecessionDeg(jd);
}

/** Longitude of the Moon's mean ascending node (L' - F), J2000 frame, degrees, not wrapped. It decreases. */
export function moonNodeUnwrapped(jd: number): number {
  const T = centuriesSinceJ2000(jd);
  return poly(MEAN_ELEMENTS.Lp, T) - poly(MEAN_ELEMENTS.F, T) - generalPrecessionDeg(jd);
}

/** Longitude of the Moon's mean perigee (L' - M'), J2000 frame, degrees, not wrapped. */
export function moonPerigeeUnwrapped(jd: number): number {
  const T = centuriesSinceJ2000(jd);
  return poly(MEAN_ELEMENTS.Lp, T) - poly(MEAN_ELEMENTS.Mp, T) - generalPrecessionDeg(jd);
}

interface MoonGeometry {
  lon: number;
  lat: number;
  latJ2000: number;
  distKm: number;
  /** Geocentric position, au, J2000 ecliptic axes. */
  xyz: readonly [number, number, number];
}

function moonGeometry(jd: number): MoonGeometry {
  const ofDate = moonOfDate(jd);
  const fixed = eclipticOfDateToJ2000(ofDate.lon, ofDate.lat, jd);
  const r = ofDate.distKm / AU_KM;
  const cb = Math.cos(fixed.lat * RAD);
  return {
    lon: norm360(fixed.lon),
    lat: ofDate.lat,
    latJ2000: fixed.lat,
    distKm: ofDate.distKm,
    xyz: [r * cb * Math.cos(fixed.lon * RAD), r * cb * Math.sin(fixed.lon * RAD), r * Math.sin(fixed.lat * RAD)],
  };
}

function sunLongitudeFrom(jd: number, moon: MoonGeometry): number {
  // The elements give the Earth-Moon barycentre. The Earth's centre sits on the far side of it
  // from the Moon, at 1/(1 + 81.30057) of the Moon's distance (4671 km on average); seen from the
  // Earth that moves the Sun by up to 7 arcsec (0.002 degree) either way over a month.
  const emb = planetState('earth', jd).xyz;
  const k = 1 / (1 + EARTH_MOON_MASS_RATIO);
  const x = -(emb[0] - k * moon.xyz[0]);
  const y = -(emb[1] - k * moon.xyz[1]);
  return norm360(Math.atan2(y, x) / RAD);
}

/**
 * True geocentric longitude of the Sun, mean ecliptic and equinox of J2000.0, degrees in
 * [0, 360). Geometric: no aberration (20.5 arcsec) or light time. It is the direction opposite
 * the Earth's centre, the Earth's centre being the Earth-Moon barycentre of planets.ts moved by
 * the Moon's pull; taking the barycentre for the Earth, i.e. planetState('earth').lon + 180,
 * would differ by at most 7 arcsec (0.002 degree). The error that remains is that of the
 * Keplerian elements: tens of arcseconds, see tests/unit/astro-moon.test.ts.
 */
export function sunGeocentricLongitude(jd: number): number {
  return sunLongitudeFrom(jd, moonGeometry(jd));
}

/** True elongation of the Moon from the Sun in longitude, degrees in [0, 360): 0 new, 180 full. */
export function moonElongation(jd: number): number {
  const moon = moonGeometry(jd);
  return norm360(moon.lon - sunLongitudeFrom(jd, moon));
}

/** Geocentric state of the Moon at a Julian Date (TT or TDB). */
export function moonState(jd: number): MoonState {
  const moon = moonGeometry(jd);
  return {
    lon: moon.lon,
    lat: moon.lat,
    latJ2000: moon.latJ2000,
    distKm: moon.distKm,
    meanLon: norm360(moonMeanLongitudeUnwrapped(jd)),
    node: norm360(moonNodeUnwrapped(jd)),
    perigee: norm360(moonPerigeeUnwrapped(jd)),
    elongation: norm360(moon.lon - sunLongitudeFrom(jd, moon)),
  };
}

// Mean rates at J2000.0, degrees per Julian century. Those of the mean elements are measured
// from the moving equinox; taking off the rate of the general precession refers them to the
// fixed J2000 frame.
const PRECESSION_RATE = PRECESSION.pA[0] * ARCSEC;
const SIDEREAL_RATE = MEAN_ELEMENTS.Lp[1] - PRECESSION_RATE;
const NODE_RATE = MEAN_ELEMENTS.Lp[1] - MEAN_ELEMENTS.F[1] - PRECESSION_RATE;
const PERIGEE_RATE = MEAN_ELEMENTS.Lp[1] - MEAN_ELEMENTS.Mp[1] - PRECESSION_RATE;
const FULL_TURN_DAYS = 360 * DAYS_PER_CENTURY;

/**
 * Mean periods of the Moon at J2000.0, days, derived from the linear rates of the polynomials
 * above. All but the synodic month are sidereal: relative to the fixed J2000 frame.
 */
export const MOON = {
  /** One circuit of the mean longitude against the stars: 27.321662 days. */
  siderealMonthDays: FULL_TURN_DAYS / SIDEREAL_RATE,
  /** New moon to new moon (one circuit of the mean elongation D): 29.530589 days. */
  synodicMonthDays: FULL_TURN_DAYS / MEAN_ELEMENTS.D[1],
  /** One retrograde circuit of the mean node against the stars: 6793.48 days, 18.60 years. */
  nodeRegressionDays: FULL_TURN_DAYS / -NODE_RATE,
  /** One prograde circuit of the mean perigee against the stars: 3232.61 days, 8.85 years. */
  apsidalPeriodDays: FULL_TURN_DAYS / PERIGEE_RATE,
} as const;
