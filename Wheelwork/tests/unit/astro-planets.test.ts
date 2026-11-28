import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ELEMENT_TABLE, EXTRA_TERMS, J2000, PLANETS, type Planet,
  elements, jdFromCalendar, meanLongitudeUnwrapped, meanMotionDegPerDay, norm180, norm360, planetState,
  siderealPeriodDays, solveKepler,
} from '../../src/core/astro';
import { HORIZONS } from '../../src/data/horizons';

const SOURCE_PAGE = fileURLToPath(new URL('../../data-src/jpl/approx_pos.html', import.meta.url));
const RAD = Math.PI / 180;

interface Errors { n: number; lonMax: number; lonRms: number; latMax: number; rMax: number }

/** Errors of planetState against the Horizons rows with jdFrom <= jd < jdTo. */
function errors(p: Planet, jdFrom: number, jdTo: number): Errors {
  let n = 0;
  let lonMax = 0;
  let lonSq = 0;
  let latMax = 0;
  let rMax = 0;
  for (const [jd, lon, lat, r] of HORIZONS.planets[p]) {
    if (jd < jdFrom || jd >= jdTo) continue;
    const s = planetState(p, jd);
    const dLon = norm180(s.lon - lon);
    n++;
    lonMax = Math.max(lonMax, Math.abs(dLon));
    lonSq += dLon * dLon;
    latMax = Math.max(latMax, Math.abs(s.lat - lat));
    rMax = Math.max(rMax, Math.abs(s.r - r));
  }
  return { n, lonMax, lonRms: Math.sqrt(lonSq / n), latMax, rMax };
}

describe('the element table is the one JPL publishes', () => {
  const text = readFileSync(SOURCE_PAGE, 'utf8').replace(/<[^>]*>/g, '');
  const table2a = text.slice(text.indexOf('Table 2a'), text.lastIndexOf('Table 2b'));
  const table2b = text.slice(text.lastIndexOf('Table 2b'));
  const names: Record<Planet, string> = {
    mercury: 'Mercury', venus: 'Venus', earth: 'EM Bary', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn',
  };
  const six = '\\s+(-?\\d+\\.\\d+)'.repeat(6);

  it('is the 3000 BC to 3000 AD set', () => {
    expect(table2a).toContain('3000&nbsp;BC -- 3000&nbsp;AD');
    expect(table2a).toContain('mean ecliptic and equinox of J2000');
  });

  it.each(PLANETS)('Table 2a row for %s matches the page digit for digit', (p) => {
    const m = new RegExp('^' + names[p] + six + '\\s*\\n' + six + '\\s*$', 'm').exec(table2a);
    expect(m).not.toBeNull();
    const v = m!.slice(1).map(Number);
    const row = ELEMENT_TABLE[p];
    expect([row.a[0], row.e[0], row.I[0], row.L[0], row.lonPeri[0], row.lonNode[0]]).toEqual(v.slice(0, 6));
    expect([row.a[1], row.e[1], row.I[1], row.L[1], row.lonPeri[1], row.lonNode[1]]).toEqual(v.slice(6, 12));
  });

  it('Table 2b rows for Jupiter and Saturn match the page, and only they are used', () => {
    expect(Object.keys(EXTRA_TERMS).sort()).toEqual(['jupiter', 'saturn']);
    for (const p of ['jupiter', 'saturn'] as const) {
      const m = new RegExp('^' + names[p] + '\\s+(-?\\d+\\.\\d+)'.repeat(4) + '\\s*$', 'm').exec(table2b);
      expect(m).not.toBeNull();
      const extra = EXTRA_TERMS[p]!;
      expect([extra.b, extra.c, extra.s, extra.f]).toEqual(m!.slice(1).map(Number));
    }
  });
});

describe('Kepler and the elements', () => {
  it('solves Kepler\'s equation to 1e-10 rad', () => {
    for (const e of [0, 0.0167, 0.0934, 0.2056, 0.6]) {
      for (let M = -Math.PI; M <= Math.PI; M += 0.137) {
        const E = solveKepler(M, e);
        expect(Math.abs(E - e * Math.sin(E) - M)).toBeLessThan(1e-10);
      }
    }
  });

  it('elements at J2000 are the table values, with the Table 2b cosine term in L', () => {
    const me = elements('mercury', J2000);
    expect(me).toEqual({ a: 0.38709843, e: 0.20563661, I: 7.00559432, L: 252.25166724, lonPeri: 77.45771895, lonNode: 48.33961819 });
    expect(elements('jupiter', J2000).L).toBeCloseTo(34.33479152 + 0.0606406, 10);
    expect(elements('saturn', J2000).L).toBeCloseTo(50.07571329 - 0.13434469, 10);
    const later = elements('mars', J2000 + 36525);
    expect(later.a).toBeCloseTo(1.52371243 + 0.00000097, 12);
    expect(later.lonNode).toBeCloseTo(49.71320984 - 0.26852431, 10);
  });

  it('state is self-consistent: xyz, r, lon, lat, meanLon', () => {
    for (const p of PLANETS) {
      for (const jd of [J2000 - 1.1e6, J2000 - 12345.6, J2000, J2000 + 9876.5, J2000 + 3.6e5]) {
        const s = planetState(p, jd);
        const [x, y, z] = s.xyz;
        expect(Math.hypot(x, y, z)).toBeCloseTo(s.r, 12);
        expect(norm180(Math.atan2(y, x) / RAD - s.lon)).toBeCloseTo(0, 9);
        expect(Math.asin(z / s.r) / RAD).toBeCloseTo(s.lat, 12);
        expect(s.lon).toBeGreaterThanOrEqual(0);
        expect(s.lon).toBeLessThan(360);
        expect(s.meanLon).toBe(norm360(meanLongitudeUnwrapped(p, jd)));
        const el = elements(p, jd);
        expect(s.r).toBeGreaterThan(el.a * (1 - el.e) - 1e-12);
        expect(s.r).toBeLessThan(el.a * (1 + el.e) + 1e-12);
        // The equation of centre is at most about 2e + (5/4)e^2 radians.
        expect(Math.abs(norm180(s.lon - s.meanLon))).toBeLessThan((2 * el.e + 1.25 * el.e * el.e) / RAD + 0.3);
      }
    }
  });

  it('the mean longitude is continuous and advances at the mean motion', () => {
    for (const p of PLANETS) {
      const rate = meanMotionDegPerDay(p);
      expect(rate).toBe(ELEMENT_TABLE[p].L[1] / 36525);
      expect(siderealPeriodDays(p)).toBe(360 / rate);
      // Over ten centuries the unwrapped L advances by the linear rate, give or take the Table 2b terms.
      const advance = meanLongitudeUnwrapped(p, J2000 + 365250) - meanLongitudeUnwrapped(p, J2000);
      expect(Math.abs(advance - rate * 365250)).toBeLessThan(p === 'jupiter' || p === 'saturn' ? 2 : 1e-6);
      let previous = meanLongitudeUnwrapped(p, J2000 - 365250);
      for (let jd = J2000 - 365250 + 10; jd < J2000 - 365250 + 4000; jd += 10) {
        const L = meanLongitudeUnwrapped(p, jd);
        expect(L - previous).toBeCloseTo(rate * 10, 3);
        previous = L;
      }
    }
  });

  it('sidereal periods are the known ones', () => {
    // Days. Reference values: the sidereal orbital periods to the digits commonly quoted.
    expect(siderealPeriodDays('mercury')).toBeCloseTo(87.969, 3);
    expect(siderealPeriodDays('venus')).toBeCloseTo(224.701, 3);
    expect(siderealPeriodDays('earth')).toBeCloseTo(365.25636, 4);
    expect(siderealPeriodDays('mars')).toBeCloseTo(686.98, 2);
    expect(siderealPeriodDays('jupiter')).toBeCloseTo(4332.59, 2);
    expect(siderealPeriodDays('saturn')).toBeCloseTo(10759.22, 2);
  });
});

describe('planets against JPL Horizons (DE441)', () => {
  const JD_1800 = jdFromCalendar(1800, 1, 1);
  const JD_2050 = jdFromCalendar(2050, 1, 1);

  it('ships 460 rows per body spanning 1001 BC to AD 3000', () => {
    for (const p of PLANETS) {
      const rows = HORIZONS.planets[p];
      expect(rows.length).toBe(460);
      expect(rows[0]![0]).toBeGreaterThanOrEqual(jdFromCalendar(-1000, 1, 1));
      expect(rows[rows.length - 1]![0]).toBeLessThan(jdFromCalendar(3000, 1, 1));
      for (let i = 1; i < rows.length; i++) expect(rows[i]![0]).toBeGreaterThan(rows[i - 1]![0]);
    }
  });

  // Bounds in degrees and au. Each is the error measured on the shipped rows (in the comment)
  // plus a margin of about a quarter. The maxima are maxima over the sample dates, not over all time.
  //
  // 1800 to 2050, 260 dates:        lon max   lon rms
  //   mercury                       0.00667   0.00211
  //   venus                         0.00819   0.00340
  //   earth (Earth-Moon barycentre) 0.01042   0.00335
  //   mars                          0.04384   0.01683
  //   jupiter                       0.18499   0.06481
  //   saturn                        0.35096   0.16042
  const modern: Record<Planet, { lonMax: number; lonRms: number }> = {
    mercury: { lonMax: 0.0085, lonRms: 0.0027 },
    venus: { lonMax: 0.0105, lonRms: 0.0043 },
    earth: { lonMax: 0.013, lonRms: 0.0042 },
    mars: { lonMax: 0.055, lonRms: 0.021 },
    jupiter: { lonMax: 0.23, lonRms: 0.081 },
    saturn: { lonMax: 0.44, lonRms: 0.2 },
  };

  // 1001 BC to AD 3000, 460 dates:  lon max   lon rms   lat max   r max (au)
  //   mercury                       0.00801   0.00241   0.00480   0.000012
  //   venus                         0.01452   0.00406   0.01800   0.000107
  //   earth (Earth-Moon barycentre) 0.01332   0.00397   0.00446   0.000125
  //   mars                          0.04807   0.01702   0.01881   0.000358
  //   jupiter                       0.21079   0.06682   0.02790   0.008521
  //   saturn                        0.36016   0.16533   0.03232   0.032440
  const whole: Record<Planet, { lonMax: number; lonRms: number; latMax: number; rMax: number }> = {
    mercury: { lonMax: 0.01, lonRms: 0.003, latMax: 0.006, rMax: 0.000015 },
    venus: { lonMax: 0.018, lonRms: 0.0051, latMax: 0.023, rMax: 0.00014 },
    earth: { lonMax: 0.017, lonRms: 0.005, latMax: 0.0056, rMax: 0.00016 },
    mars: { lonMax: 0.06, lonRms: 0.0215, latMax: 0.024, rMax: 0.00045 },
    jupiter: { lonMax: 0.265, lonRms: 0.084, latMax: 0.035, rMax: 0.011 },
    saturn: { lonMax: 0.45, lonRms: 0.21, latMax: 0.041, rMax: 0.041 },
  };

  it.each(PLANETS)('%s, 1800 to 2050', (p) => {
    const e = errors(p, JD_1800, JD_2050);
    expect(e.n).toBe(260);
    expect(e.lonMax).toBeLessThan(modern[p].lonMax);
    expect(e.lonRms).toBeLessThan(modern[p].lonRms);
    // Not vacuous: the bound is within a factor of two of what is measured.
    expect(e.lonMax).toBeGreaterThan(modern[p].lonMax / 2);
  });

  it.each(PLANETS)('%s, 1001 BC to AD 3000', (p) => {
    const e = errors(p, 0, Infinity);
    expect(e.n).toBe(460);
    expect(e.lonMax).toBeLessThan(whole[p].lonMax);
    expect(e.lonRms).toBeLessThan(whole[p].lonRms);
    expect(e.latMax).toBeLessThan(whole[p].latMax);
    expect(e.rMax).toBeLessThan(whole[p].rMax);
    expect(e.lonMax).toBeGreaterThan(whole[p].lonMax / 2);
  });

  it('no era is much worse than another: every 1000-year block stays inside the whole-span bound', () => {
    for (const p of PLANETS) {
      for (let year = -1000; year < 3000; year += 1000) {
        const e = errors(p, jdFromCalendar(year, 1, 1), jdFromCalendar(year + 1000, 1, 1));
        expect(e.n).toBeGreaterThanOrEqual(40);
        expect(e.lonMax).toBeLessThan(whole[p].lonMax);
      }
    }
  });

  it('Jupiter and Saturn need the Table 2b terms: without them the error roughly triples', () => {
    // Measured worst longitude error over the whole span without the terms: Jupiter 0.566 degree
    // (0.211 with), Saturn 1.311 (0.360 with).
    const floor = { jupiter: 0.5, saturn: 1.2 } as const;
    for (const p of ['jupiter', 'saturn'] as const) {
      let worst = 0;
      for (const [jd, lon] of HORIZONS.planets[p]) {
        const T = (jd - J2000) / 36525;
        const x = EXTRA_TERMS[p]!;
        const term = x.b * T * T + x.c * Math.cos(x.f * T * RAD) + x.s * Math.sin(x.f * T * RAD);
        // To first order a change dM of the mean anomaly moves the longitude by dM.
        worst = Math.max(worst, Math.abs(norm180(planetState(p, jd).lon - term - lon)));
      }
      expect(worst).toBeGreaterThan(floor[p]);
    }
  });
});
