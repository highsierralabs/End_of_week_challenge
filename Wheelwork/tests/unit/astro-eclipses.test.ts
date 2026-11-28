import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ECLIPSES, MOON, type CatalogueEclipse,
  calendarFromJd, jdFromCalendar, moonElongation, moonLatitudeAt, moonState, norm180, syzygies,
} from '../../src/core/astro';

const read = (name: string) => readFileSync(fileURLToPath(new URL('../../data-src/eclipses/' + name, import.meta.url)), 'utf8');

const JD_1901 = jdFromCalendar(1901, 1, 1);
const JD_2101 = jdFromCalendar(2101, 1, 1);
const solar = ECLIPSES.filter((e) => e.kind === 'solar');
const lunar = ECLIPSES.filter((e) => e.kind === 'lunar');

// Computed once: every new and full moon of the two centuries.
const all = syzygies(JD_1901, JD_2101);
const newMoons = all.filter((s) => s.kind === 'new').map((s) => s.jd);
const fullMoons = all.filter((s) => s.kind === 'full').map((s) => s.jd);

/** Signed hours from the catalogue instant to the nearest instant in a sorted list. */
function hoursToNearest(sorted: number[], jd: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < jd) lo = mid + 1;
    else hi = mid;
  }
  const after = sorted[lo]! - jd;
  const before = lo > 0 ? sorted[lo - 1]! - jd : Infinity;
  return (Math.abs(before) < Math.abs(after) ? before : after) * 24;
}

describe('the eclipse catalogue', () => {
  it('holds 452 solar and 457 lunar eclipses, 1901 to 2100, sorted', () => {
    expect(solar.length).toBe(452);
    expect(lunar.length).toBe(457);
    expect(ECLIPSES.length).toBe(909);
    for (let i = 1; i < ECLIPSES.length; i++) expect(ECLIPSES[i]!.jd).toBeGreaterThan(ECLIPSES[i - 1]!.jd);
    expect(ECLIPSES[0]!.jd).toBeGreaterThan(JD_1901);
    expect(ECLIPSES[ECLIPSES.length - 1]!.jd).toBeLessThan(JD_2101);
  });

  it('has as many rows as the four NASA pages it was made from', () => {
    const rows = (name: string) => read(name).replace(/<[^>]*>/g, '').split('\n').filter((line) => /^\d{5}\s+-?\d{4} [A-Z][a-z]{2} \d{2}\s/.test(line)).length;
    expect(rows('SE1901-2000.html') + rows('SE2001-2100.html')).toBe(solar.length);
    expect(rows('LE1901-2000.html') + rows('LE2001-2100.html')).toBe(lunar.length);
    expect(read('SE1901-2000.html')).toContain('Eclipse Predictions by Fred Espenak');
  });

  it('carries the type letters NASA uses, and gamma in range', () => {
    const count = (list: CatalogueEclipse[], type: string) => list.filter((e) => e.type === type).length;
    expect([count(solar, 'P'), count(solar, 'A'), count(solar, 'T'), count(solar, 'H')]).toEqual([155, 145, 139, 13]);
    expect([count(lunar, 'N'), count(lunar, 'P'), count(lunar, 'T')]).toEqual([169, 122, 166]);
    for (const e of ECLIPSES) expect(Math.abs(e.gamma)).toBeLessThan(1.6);
    // Central solar eclipses have the shadow axis on the Earth, total lunar ones the Moon deep in the umbra.
    for (const e of solar) if (e.type !== 'P') expect(Math.abs(e.gamma)).toBeLessThan(1.03);
    for (const e of lunar) if (e.type === 'T') expect(Math.abs(e.gamma)).toBeLessThan(0.52);
  });

  it('finds two well known eclipses on their dates', () => {
    const on = (list: CatalogueEclipse[], year: number, month: number, day: number) =>
      list.find((e) => { const c = calendarFromJd(e.jd); return c.year === year && c.month === month && c.day === day; });
    // Catalogue rows: 2017 Aug 21 18:26:40 TD, total, gamma 0.4367; 2024 Apr 08 18:18:29 TD, total, gamma 0.3431.
    const y2017 = on(solar, 2017, 8, 21)!;
    expect(y2017.type).toBe('T');
    expect(y2017.gamma).toBe(0.4367);
    expect(y2017.jd).toBeCloseTo(jdFromCalendar(2017, 8, 21) + (18 * 3600 + 26 * 60 + 40) / 86400, 5);
    const y2024 = on(solar, 2024, 4, 8)!;
    expect(y2024.type).toBe('T');
    expect(y2024.gamma).toBe(0.3431);
    expect(y2024.jd).toBeCloseTo(jdFromCalendar(2024, 4, 8) + (18 * 3600 + 18 * 60 + 29) / 86400, 5);
    // The first row of the lunar catalogue: 1901 May 03 18:30:38 TD, penumbral, gamma -1.0101.
    expect(lunar[0]).toEqual({ jd: 2415508.27127, kind: 'lunar', type: 'N', gamma: -1.0101 });
  });
});

describe('syzygies', () => {
  it('returns new and full moons alternately, 13.9 to 15.7 days apart', () => {
    expect(all.length).toBe(4948);
    expect(newMoons.length).toBe(2474);
    expect(fullMoons.length).toBe(2474);
    for (let i = 1; i < all.length; i++) {
      expect(all[i]!.kind).not.toBe(all[i - 1]!.kind);
      const gap = all[i]!.jd - all[i - 1]!.jd;
      expect(gap).toBeGreaterThan(13.85);
      expect(gap).toBeLessThan(15.7);
    }
    // The mean spacing of new moons is the synodic month.
    expect((newMoons[newMoons.length - 1]! - newMoons[0]!) / (newMoons.length - 1)).toBeCloseTo(MOON.synodicMonthDays, 3);
  });

  it('each is a true conjunction or opposition, converged far below a minute', () => {
    for (let i = 0; i < all.length; i += 37) {
      const s = all[i]!;
      const target = s.kind === 'new' ? 0 : 180;
      // 1e-5 degree of elongation is 0.07 s.
      expect(Math.abs(norm180(moonElongation(s.jd) - target))).toBeLessThan(1e-5);
      expect(moonState(s.jd).elongation).toBe(moonElongation(s.jd));
    }
  });

  it('keeps to the half-open range and does not depend on where the range starts', () => {
    const first = all[10]!;
    const second = all[11]!;
    expect(syzygies(first.jd - 1, second.jd + 1).map((s) => s.kind)).toEqual([first.kind, second.kind]);
    expect(syzygies(first.jd + 0.001, second.jd - 0.001)).toEqual([]);
    expect(syzygies(first.jd + 0.001, second.jd + 0.001).length).toBe(1);
    expect(syzygies(second.jd, first.jd)).toEqual([]);
    const shifted = syzygies(JD_1901 + 3.21, JD_1901 + 400);
    const reference = all.filter((s) => s.jd >= JD_1901 + 3.21 && s.jd < JD_1901 + 400);
    expect(shifted.length).toBe(reference.length);
    shifted.forEach((s, i) => {
      expect(s.kind).toBe(reference[i]!.kind);
      expect(Math.abs(s.jd - reference[i]!.jd)).toBeLessThan(2e-6);
    });
  });

  it('puts the new moon of 2000 January 6 at 18:14 UT', () => {
    // 18:14 UT is 18:15 TT. The geometric conjunction computed here precedes the apparent one by
    // about 40 s, and the Keplerian Sun is good to about a minute.
    const s = syzygies(jdFromCalendar(2000, 1, 1), jdFromCalendar(2000, 1, 12));
    expect(s.length).toBe(1);
    expect(s[0]!.kind).toBe('new');
    expect(Math.abs(s[0]!.jd - (jdFromCalendar(2000, 1, 6) + (18 * 60 + 15) / 1440)) * 1440).toBeLessThan(3);
  });
});

describe('catalogue eclipses against the reference Moon and Sun', () => {
  // Measured (hours from greatest eclipse to the computed syzygy):
  //   452 solar eclipses to the nearest new moon:  max 0.306, rms 0.156
  //   457 lunar eclipses to the nearest full moon: max 0.325, rms 0.155
  // Greatest eclipse is the instant of least separation, not of conjunction in longitude, so most
  // of this is real; the computed syzygies themselves are good to about a minute.
  it('every solar eclipse lies within 0.4 hour of a new moon', () => {
    let worst = 0;
    for (const e of solar) worst = Math.max(worst, Math.abs(hoursToNearest(newMoons, e.jd)));
    expect(worst).toBeLessThan(0.4);
    expect(worst).toBeGreaterThan(0.2);
  });

  it('every lunar eclipse lies within 0.4 hour of a full moon', () => {
    let worst = 0;
    for (const e of lunar) worst = Math.max(worst, Math.abs(hoursToNearest(fullMoons, e.jd)));
    expect(worst).toBeLessThan(0.4);
    expect(worst).toBeGreaterThan(0.2);
  });

  it('no eclipse is nearer the wrong kind of syzygy', () => {
    for (const e of solar) expect(Math.abs(hoursToNearest(fullMoons, e.jd))).toBeGreaterThan(300);
    for (const e of lunar) expect(Math.abs(hoursToNearest(newMoons, e.jd))).toBeGreaterThan(300);
  });

  // Measured largest |latitude| of the Moon at greatest eclipse, degrees:
  //   solar: all 1.546; partial 1.546 (least 0.925); annular 0.949; total 1.020; hybrid 0.963
  //   lunar: all 1.567; penumbral 1.567 (least 0.889); partial 1.027 (least 0.408); total 0.486
  it('the Moon is near the ecliptic at every eclipse: |latitude| below 1.6 degrees', () => {
    const largest = (list: CatalogueEclipse[]) => Math.max(...list.map((e) => Math.abs(moonLatitudeAt(e.jd))));
    expect(largest(solar)).toBeLessThan(1.6);
    expect(largest(solar)).toBeGreaterThan(1.5);
    expect(largest(lunar)).toBeLessThan(1.6);
    expect(largest(lunar)).toBeGreaterThan(1.5);
    expect(largest(solar.filter((e) => e.type !== 'P'))).toBeLessThan(1.05);
    expect(largest(lunar.filter((e) => e.type !== 'N'))).toBeLessThan(1.06);
    expect(largest(lunar.filter((e) => e.type === 'T'))).toBeLessThan(0.5);
    // And it is not near the ecliptic at an ordinary syzygy: most new moons pass well clear.
    const clear = newMoons.filter((jd) => Math.abs(moonLatitudeAt(jd)) > 1.6).length;
    expect(clear / newMoons.length).toBeGreaterThan(0.7);
  });

  it('the Moon is on the side of the ecliptic that gamma says', () => {
    let checked = 0;
    for (const e of ECLIPSES) {
      if (Math.abs(e.gamma) < 0.02) continue;
      expect(Math.sign(moonLatitudeAt(e.jd))).toBe(Math.sign(e.gamma));
      checked++;
    }
    expect(checked).toBeGreaterThan(880);
  });

  it('every syzygy with the Moon within 0.85 degree of the ecliptic is a catalogue eclipse', () => {
    // The converse of the tests above. 0.85 degree is inside the least latitude at which the catalogue
    // has a miss; the true limits depend on the distances of the Moon and the Sun.
    let hits = 0;
    for (const [list, catalogue] of [[newMoons, solar], [fullMoons, lunar]] as const) {
      const times = catalogue.map((e) => e.jd);
      for (const jd of list) {
        if (Math.abs(moonLatitudeAt(jd)) > 0.85) continue;
        expect(Math.abs(hoursToNearest(times, jd))).toBeLessThan(0.4);
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(400);
  });
});
