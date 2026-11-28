import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ADDITIVE_ARGUMENTS, ADDITIVE_TERMS, AU_KM, EARTH_MOON_MASS_RATIO, ECCENTRICITY_FACTOR, J2000, LATITUDE_TERMS,
  LONGITUDE_DISTANCE_TERMS, MEAN_DISTANCE_KM, MEAN_ELEMENTS, MOON, PRECESSION,
  eclipticOfDateToJ2000, generalPrecessionDeg, jdFromCalendar, moonElongation, moonMeanLongitudeUnwrapped,
  moonNodeUnwrapped, moonOfDate, moonPerigeeUnwrapped, moonState, norm180, norm360, planetState,
  sunGeocentricLongitude,
} from '../../src/core/astro';
import { HORIZONS } from '../../src/data/horizons';

const read = (relative: string) => readFileSync(fileURLToPath(new URL('../../data-src/' + relative, import.meta.url)), 'utf8');
const RAD = Math.PI / 180;
const JD_1900 = jdFromCalendar(1900, 1, 1);
const JD_2100 = jdFromCalendar(2100, 1, 1);

interface Stat { n: number; max: number; rms: number; mean: number }
function stat(values: number[]): Stat {
  let max = 0;
  let sq = 0;
  let sum = 0;
  for (const v of values) {
    max = Math.max(max, Math.abs(v));
    sq += v * v;
    sum += v;
  }
  return { n: values.length, max, rms: Math.sqrt(sq / values.length), mean: sum / values.length };
}

describe('the lunar series is the one in ERFA moon98.c (Meeus ch. 47)', () => {
  const c = read('erfa/moon98.c');
  /** Value of a `name = number` or `name = 1.0 / number` initialiser in the C source. */
  const value = (name: string): number => {
    const m = new RegExp('\\b' + name + '\\s*=\\s*(-?)(1\\.0 / )?(\\d+\\.?\\d*)\\s*[,;]').exec(c);
    if (!m) throw new Error('not found in moon98.c: ' + name);
    const magnitude = m[2] ? 1 / Number(m[3]) : Number(m[3]);
    return m[1] === '-' ? -magnitude : magnitude;
  };

  it('is an implementation of the Meeus algorithm, by its own account', () => {
    expect(c).toContain('full implementation of the algorithm');
    expect(c).toContain('Meeus, J., Astronomical Algorithms, 2nd edition');
  });

  it('mean elements match', () => {
    const names = { Lp: 'elp', D: 'd', M: 'em', Mp: 'emp', F: 'f' } as const;
    for (const key of ['Lp', 'D', 'M', 'Mp', 'F'] as const) {
      for (let power = 0; power <= 4; power++) {
        expect(MEAN_ELEMENTS[key][power], key + power).toBe(value(names[key] + power));
      }
    }
  });

  it('additive terms, eccentricity factor and mean distance match', () => {
    expect(ADDITIVE_ARGUMENTS).toEqual({
      A1: [value('a10'), value('a11')], A2: [value('a20'), value('a21')], A3: [value('a30'), value('a31')],
    });
    expect(ADDITIVE_TERMS).toEqual({
      lonA1: value('al1'), lonLpMinusF: value('al2'), lonA2: value('al3'),
      latLp: value('ab1'), latA3: value('ab2'), latA1MinusF: value('ab3'), latA1PlusF: value('ab4'),
      latLpMinusMp: value('ab5'), latLpPlusMp: value('ab6'),
    });
    expect([...ECCENTRICITY_FACTOR]).toEqual([value('e1'), value('e2')]);
    expect(MEAN_DISTANCE_KM * 1000).toBeCloseTo(value('r0'), 3);
  });

  it('all 60 longitude and distance terms and all 60 latitude terms match', () => {
    const number = '\\s*(-?\\d+\\.?\\d*)';
    const lr = [...c.matchAll(new RegExp('\\{' + (number + ',').repeat(5) + number + '\\}', 'g'))].map((m) => m.slice(1).map(Number));
    const b = [...c.matchAll(new RegExp('\\{' + (number + ',').repeat(4) + number + '\\}', 'g'))].map((m) => m.slice(1).map(Number));
    expect(lr.length).toBe(60);
    expect(b.length).toBe(60);
    expect(LONGITUDE_DISTANCE_TERMS.map((row) => [...row])).toEqual(lr);
    expect(LATITUDE_TERMS.map((row) => [...row])).toEqual(b);
  });

  it('the precession polynomials are the IAU 2006 ones in ERFA p06e.c', () => {
    const p = read('erfa/p06e.c');
    const coefficients = (name: string): number[] => {
      const start = p.indexOf('*' + name + ' = (');
      expect(start).toBeGreaterThan(0);
      const body = p.slice(start, p.indexOf('ERFA_DAS2R', start));
      return [...body.matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0]));
    };
    expect([...PRECESSION.pA]).toEqual(coefficients('pa'));
    expect([...PRECESSION.piA]).toEqual(coefficients('pia'));
    expect([...PRECESSION.PiA]).toEqual(coefficients('bpia'));
    expect(PRECESSION.pA.length).toBe(5);
    expect(PRECESSION.PiA.length).toBe(6);
  });
});

describe('the Moon of date', () => {
  it('reproduces Meeus example 47.a (1992 April 12, 0h TD)', () => {
    // The book: longitude 133.162655, latitude -3.229126, distance 368409.7 km. The longitude here is
    // 0.000207 degree greater because the constant of L' leaves out the light time (see moon.ts).
    const m = moonOfDate(jdFromCalendar(1992, 4, 12));
    expect(m.lon).toBeCloseTo(133.162655 + (218.31665436 - 218.3164477), 5);
    expect(m.lat).toBeCloseTo(-3.229126, 5);
    expect(m.distKm).toBeCloseTo(368409.7, 1);
  });

  it('rotating to J2000 is the identity at J2000 and takes off the precession elsewhere', () => {
    expect(eclipticOfDateToJ2000(123.4, -4.5, J2000).lon).toBeCloseTo(123.4, 10);
    expect(eclipticOfDateToJ2000(123.4, -4.5, J2000).lat).toBeCloseTo(-4.5, 10);
    expect(generalPrecessionDeg(J2000)).toBe(0);
    expect(generalPrecessionDeg(J2000 + 36525)).toBeCloseTo(5029.9017 / 3600, 5);
    for (const T of [-30, -10, -1, 1, 10]) {
      const jd = J2000 + T * 36525;
      for (const lon of [0, 77, 190, 301]) {
        for (const lat of [-5, 0, 5]) {
          const r = eclipticOfDateToJ2000(lon, lat, jd);
          // Longitude: precession, plus at most pi_A tan(lat); latitude: at most pi_A.
          const tilt = Math.abs((47.0 / 3600) * T) * 1.02 + 1e-6;
          expect(Math.abs(norm180(r.lon - (lon - generalPrecessionDeg(jd))))).toBeLessThan(tilt * (Math.tan(5 * RAD) + 0.01 * Math.abs(T)));
          expect(Math.abs(r.lat - lat)).toBeLessThan(tilt);
        }
      }
    }
  });
});

describe('mean elements and periods', () => {
  it('mean periods at J2000 are the known ones', () => {
    expect(MOON.siderealMonthDays).toBeCloseTo(27.321662, 6);
    expect(MOON.synodicMonthDays).toBeCloseTo(29.530589, 6);
    expect(MOON.nodeRegressionDays).toBeCloseTo(6793.5, 1);
    expect(MOON.nodeRegressionDays / 365.25).toBeCloseTo(18.6, 2);
    expect(MOON.apsidalPeriodDays).toBeCloseTo(3232.6, 1);
    // The synodic month follows from the sidereal month and the sidereal year of planets.ts.
    const year = 360 / (planetState('earth', J2000 + 1).meanLon - planetState('earth', J2000).meanLon);
    expect(1 / (1 / MOON.siderealMonthDays - 1 / year)).toBeCloseTo(MOON.synodicMonthDays, 5);
  });

  it('the unwrapped mean longitude, node and perigee turn once per period near J2000', () => {
    expect(moonMeanLongitudeUnwrapped(J2000 + MOON.siderealMonthDays) - moonMeanLongitudeUnwrapped(J2000)).toBeCloseTo(360, 6);
    expect(moonNodeUnwrapped(J2000 + MOON.nodeRegressionDays) - moonNodeUnwrapped(J2000)).toBeCloseTo(-360, 3);
    expect(moonPerigeeUnwrapped(J2000 + MOON.apsidalPeriodDays) - moonPerigeeUnwrapped(J2000)).toBeCloseTo(360, 2);
    // The node regresses, steadily, for the whole span.
    for (let jd = jdFromCalendar(-1000, 1, 1); jd < jdFromCalendar(3000, 1, 1); jd += 50000) {
      expect(moonNodeUnwrapped(jd + 100) - moonNodeUnwrapped(jd)).toBeCloseTo((-360 * 100) / MOON.nodeRegressionDays, 2);
      expect(moonMeanLongitudeUnwrapped(jd + 1) - moonMeanLongitudeUnwrapped(jd)).toBeCloseTo(360 / MOON.siderealMonthDays, 4);
    }
  });

  it('moonState carries the wrapped mean elements, of date at J2000', () => {
    const s = moonState(J2000);
    expect(s.meanLon).toBeCloseTo(218.31665436, 9);
    expect(s.node).toBeCloseTo(218.31665436 - 93.272095, 9);
    expect(s.perigee).toBeCloseTo(218.31665436 - 134.9633964, 9);
    expect(s.lat).toBeCloseTo(s.latJ2000, 12);
    const t = moonState(jdFromCalendar(1950, 6, 1.25));
    expect(t.meanLon).toBe(norm360(moonMeanLongitudeUnwrapped(jdFromCalendar(1950, 6, 1.25))));
    expect(t.node).toBe(norm360(moonNodeUnwrapped(jdFromCalendar(1950, 6, 1.25))));
    expect(t.elongation).toBe(moonElongation(jdFromCalendar(1950, 6, 1.25)));
    expect(t.elongation).toBeCloseTo(norm360(t.lon - sunGeocentricLongitude(jdFromCalendar(1950, 6, 1.25))), 10);
    // The true Moon stays within about 8 degrees of the mean Moon.
    for (let jd = JD_1900; jd < JD_1900 + 800; jd += 3.3) {
      const m = moonState(jd);
      expect(Math.abs(norm180(m.lon - m.meanLon))).toBeLessThan(8.5);
      expect(Math.abs(m.lat)).toBeLessThan(5.35);
      expect(m.distKm).toBeGreaterThan(356000);
      expect(m.distKm).toBeLessThan(407000);
    }
  });
});

describe('Moon against JPL Horizons (DE441)', () => {
  const rows = HORIZONS.moon;
  const modern = rows.filter(([jd]) => jd >= JD_1900 && jd < JD_2100);
  const diff = (list: typeof rows) => {
    const lon: number[] = [];
    const latFixed: number[] = [];
    const dist: number[] = [];
    for (const [jd, hLon, hLat, hKm] of list) {
      const s = moonState(jd);
      lon.push(norm180(s.lon - hLon));
      latFixed.push(s.latJ2000 - hLat);
      dist.push(s.distKm - hKm);
    }
    return { lon: stat(lon), lat: stat(latFixed), dist: stat(dist) };
  };

  it('ships 460 rows: 308 in 1900 to 2100, the rest spread over 1001 BC to AD 3000', () => {
    expect(rows.length).toBe(460);
    expect(modern.length).toBe(308);
    expect(rows[0]![0]).toBeGreaterThanOrEqual(jdFromCalendar(-1000, 1, 1));
    expect(rows[rows.length - 1]![0]).toBeLessThan(jdFromCalendar(3000, 1, 1));
  });

  // Measured on the shipped rows; each bound is the measurement plus about a third.
  //
  //                       lon max   lon rms   lat max   lat rms   dist max  dist rms
  //                       (deg)     (deg)     (deg)     (deg)     (km)      (km)
  // 1900 to 2100, n=308   0.00364   0.00078   0.00092   0.00028   10.5      3.2
  // whole span,   n=460   0.03473   0.00720   0.00302   0.00052   15.5      3.5
  // (0.00364 degree = 13 arcsec, 0.00078 degree = 2.8 arcsec.)
  it('1900 to 2100: longitude within 0.005 degree, 0.001 rms', () => {
    const d = diff(modern);
    expect(d.lon.max).toBeLessThan(0.005);
    expect(d.lon.rms).toBeLessThan(0.001);
    expect(d.lon.max).toBeGreaterThan(0.002);
    // No offset: a wrong constant in the mean longitude would show here.
    expect(Math.abs(d.lon.mean)).toBeLessThan(0.00015);
    expect(d.lat.max).toBeLessThan(0.0013);
    expect(d.lat.rms).toBeLessThan(0.0004);
    expect(d.dist.max).toBeLessThan(14);
    expect(d.dist.rms).toBeLessThan(4.5);
  });

  it('1001 BC to AD 3000: longitude within 0.045 degree', () => {
    const d = diff(rows);
    expect(d.lon.max).toBeLessThan(0.045);
    expect(d.lon.rms).toBeLessThan(0.0095);
    expect(d.lat.max).toBeLessThan(0.004);
    expect(d.dist.max).toBeLessThan(20);
  });

  it('the error grows only in the distant past: by era', () => {
    // Measured longitude maxima: 1001 BC to 1 BC 0.0347, AD 1 to 1000 0.0123, 1000 to 1800 0.0024,
    // 2100 to 3000 0.0037. The growth is a slow drift (mean +0.028 degree before 500 BC), not noise.
    const era = (y0: number, y1: number) => diff(rows.filter(([jd]) => jd >= jdFromCalendar(y0, 1, 1) && jd < jdFromCalendar(y1, 1, 1))).lon;
    expect(era(-1000, 0).max).toBeLessThan(0.045);
    expect(era(0, 1000).max).toBeLessThan(0.016);
    expect(era(1000, 1800).max).toBeLessThan(0.0035);
    expect(era(2100, 3000).max).toBeLessThan(0.005);
    expect(era(-1000, -500).mean).toBeGreaterThan(0.015);
  });

  it('lat is the latitude of date: it leaves the J2000 latitude by at most 0.0133 degree per century', () => {
    let worstModern = 0;
    for (const [jd] of rows) {
      const s = moonState(jd);
      const T = Math.abs((jd - J2000) / 36525);
      expect(Math.abs(s.lat - s.latJ2000)).toBeLessThan(0.0134 * T + 1e-5);
      if (jd >= JD_1900 && jd < JD_2100) worstModern = Math.max(worstModern, Math.abs(s.lat - s.latJ2000));
    }
    expect(worstModern).toBeLessThan(0.0135);
  });

  it('a single wrong coefficient would be seen: no table argument carries a residual above 1.5 arcsec', () => {
    // Fit a + b sin(arg) + c cos(arg) to the 1900 to 2100 longitude residual at each of the 60
    // arguments of Table 47.A. Measured largest amplitude: 0.00025 degree (0.9 arcsec).
    const T = modern.map(([jd]) => (jd - J2000) / 36525);
    const residual = modern.map(([jd, lon]) => norm180(moonState(jd).lon - lon));
    let largest = 0;
    for (const [d, m, mp, f] of LONGITUDE_DISTANCE_TERMS) {
      const phase = (t: number) => (d * (MEAN_ELEMENTS.D[0] + MEAN_ELEMENTS.D[1] * t) + m * (MEAN_ELEMENTS.M[0] + MEAN_ELEMENTS.M[1] * t)
        + mp * (MEAN_ELEMENTS.Mp[0] + MEAN_ELEMENTS.Mp[1] * t) + f * (MEAN_ELEMENTS.F[0] + MEAN_ELEMENTS.F[1] * t)) * RAD;
      largest = Math.max(largest, sinusoidAmplitude(T, residual, phase));
    }
    expect(largest).toBeLessThan(1.5 / 3600);
  });
});

describe('Sun and elongation against JPL Horizons (DE441)', () => {
  const sun = HORIZONS.sun;
  const modern = sun.filter(([jd]) => jd >= JD_1900 && jd < JD_2100);

  it('the Sun rows share the dates of the Moon rows', () => {
    expect(sun.length).toBe(HORIZONS.moon.length);
    sun.forEach((row, i) => expect(row[0]).toBe(HORIZONS.moon[i]![0]));
  });

  // Measured, degrees:      Sun lon max  rms       elongation max  rms
  // 1900 to 2100, n=308     0.01046      0.00401   0.01242         0.00417
  // whole span,   n=460     0.01332      0.00422   0.03849         0.00875
  it('Sun longitude: within 0.013 degree in 1900 to 2100, 0.017 over the whole span', () => {
    const now = stat(modern.map(([jd, lon]) => norm180(sunGeocentricLongitude(jd) - lon)));
    const all = stat(sun.map(([jd, lon]) => norm180(sunGeocentricLongitude(jd) - lon)));
    expect(now.max).toBeLessThan(0.013);
    expect(now.rms).toBeLessThan(0.005);
    expect(all.max).toBeLessThan(0.017);
    expect(all.rms).toBeLessThan(0.0053);
  });

  it('moving from the Earth-Moon barycentre to the Earth changes the Sun by at most 7 arcsec, and helps', () => {
    let largest = 0;
    const withShift: number[] = [];
    const without: number[] = [];
    for (const [jd, lon] of sun) {
      const barycentric = norm360(planetState('earth', jd).lon + 180);
      largest = Math.max(largest, Math.abs(norm180(sunGeocentricLongitude(jd) - barycentric)));
      withShift.push(norm180(sunGeocentricLongitude(jd) - lon));
      without.push(norm180(barycentric - lon));
    }
    expect(largest).toBeLessThan(7 / 3600);
    expect(largest).toBeGreaterThan(5 / 3600);
    expect(stat(withShift).rms).toBeLessThan(stat(without).rms);
  });

  it('the Earth to Moon mass ratio agrees with the one Horizons implies', () => {
    // Sun(geocentric) = -(EMB - k Moon), with k = 1 / (1 + ratio). Solve for k on the 160 dates the
    // Earth-Moon barycentre rows share with the Moon and Sun rows. Measured: ratio 81.3024 from rows
    // rounded to 1e-6 degree.
    const vector = (lon: number, lat: number, r: number) => [
      r * Math.cos(lat * RAD) * Math.cos(lon * RAD), r * Math.cos(lat * RAD) * Math.sin(lon * RAD), r * Math.sin(lat * RAD),
    ] as const;
    const barycentre = new Map(HORIZONS.planets.earth.map((row) => [row[0], row]));
    let sum = 0;
    let n = 0;
    sun.forEach((s, i) => {
      const e = barycentre.get(s[0]);
      const m = HORIZONS.moon[i]!;
      if (!e) return;
      const sv = vector(s[1], s[2], s[3]);
      const ev = vector(e[1], e[2], e[3]);
      const mv = vector(m[1], m[2], m[3] / AU_KM);
      const dot = (ev[0] + sv[0]) * mv[0] + (ev[1] + sv[1]) * mv[1] + (ev[2] + sv[2]) * mv[2];
      sum += dot / (mv[0] * mv[0] + mv[1] * mv[1] + mv[2] * mv[2]);
      n++;
    });
    expect(n).toBe(160);
    expect(1 / (sum / n) - 1).toBeCloseTo(EARTH_MOON_MASS_RATIO, 1);
  });

  it('elongation: within 0.016 degree in 1900 to 2100 (under 2 minutes of the Moon\'s motion)', () => {
    const error = (list: typeof sun) => stat(list.map(([jd, sunLon]) => {
      const moonRow = HORIZONS.moon.find((row) => row[0] === jd)!;
      return norm180(moonState(jd).elongation - (moonRow[1] - sunLon));
    }));
    const now = error(modern);
    expect(now.max).toBeLessThan(0.016);
    expect(now.rms).toBeLessThan(0.0053);
    // In time: degrees over the mean rate of the elongation, in minutes.
    const minutesPerDegree = (MOON.synodicMonthDays / 360) * 1440;
    expect(now.max * minutesPerDegree).toBeLessThan(2);
    const all = error(sun);
    expect(all.max).toBeLessThan(0.05);
    expect(all.rms).toBeLessThan(0.011);
  });
});

/** Amplitude of the best fitting a + b sin(phase) + c cos(phase), by least squares. */
function sinusoidAmplitude(t: number[], v: number[], phase: (t: number) => number): number {
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const B = [0, 0, 0];
  t.forEach((ti, i) => {
    const basis = [1, Math.sin(phase(ti)), Math.cos(phase(ti))];
    for (let r = 0; r < 3; r++) {
      B[r]! += basis[r]! * v[i]!;
      for (let col = 0; col < 3; col++) A[r]![col]! += basis[r]! * basis[col]!;
    }
  });
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const factor = A[j]![i]! / A[i]![i]!;
      for (let k = i; k < 3; k++) A[j]![k]! -= factor * A[i]![k]!;
      B[j]! -= factor * B[i]!;
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = B[i]!;
    for (let k = i + 1; k < 3; k++) s -= A[i]![k]! * x[k]!;
    x[i] = s / A[i]![i]!;
  }
  return Math.hypot(x[1]!, x[2]!);
}
