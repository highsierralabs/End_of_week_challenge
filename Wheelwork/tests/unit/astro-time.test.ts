import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DAYS_PER_CENTURY, J2000, calendarFromJd, centuriesSinceJ2000, formatDate, jdFromCalendar, norm180, norm360 } from '../../src/core/astro';

const HORIZONS_DIR = fileURLToPath(new URL('../../data-src/horizons/', import.meta.url));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

describe('Julian Date from a calendar date', () => {
  it('gives the standard epochs', () => {
    expect(J2000).toBe(2451545);
    expect(DAYS_PER_CENTURY).toBe(36525);
    expect(jdFromCalendar(2000, 1, 1.5)).toBe(2451545);
    expect(jdFromCalendar(-4712, 1, 1.5)).toBe(0);
    expect(centuriesSinceJ2000(J2000 + 36525)).toBe(1);
  });

  it('reproduces the worked examples of Meeus ch. 7', () => {
    expect(jdFromCalendar(1957, 10, 4.81)).toBeCloseTo(2436116.31, 6);
    expect(jdFromCalendar(333, 1, 27.5)).toBe(1842713);
    expect(jdFromCalendar(-584, 5, 28.63)).toBeCloseTo(1507900.13, 6);
    expect(jdFromCalendar(1600, 12, 31)).toBe(2305812.5);
    expect(jdFromCalendar(837, 4, 10.3)).toBeCloseTo(2026871.8, 6);
    expect(jdFromCalendar(-1000, 7, 12.5)).toBe(1356001);
    expect(jdFromCalendar(-1001, 8, 17.9)).toBeCloseTo(1355671.4, 6);
  });

  it('switches from the Julian to the Gregorian calendar in October 1582', () => {
    // Thursday 4 October 1582 (Julian) was followed by Friday 15 October 1582 (Gregorian).
    expect(jdFromCalendar(1582, 10, 4)).toBe(2299159.5);
    expect(jdFromCalendar(1582, 10, 15)).toBe(2299160.5);
    expect(calendarFromJd(2299159.5)).toEqual({ year: 1582, month: 10, day: 4, hour: 0 });
    expect(calendarFromJd(2299160.5)).toEqual({ year: 1582, month: 10, day: 15, hour: 0 });
    // Julian leap year 1500 has a 29 February; Gregorian 1900 has none.
    expect(jdFromCalendar(1500, 3, 1) - jdFromCalendar(1500, 2, 28)).toBe(2);
    expect(jdFromCalendar(1900, 3, 1) - jdFromCalendar(1900, 2, 28)).toBe(1);
    expect(jdFromCalendar(2000, 3, 1) - jdFromCalendar(2000, 2, 28)).toBe(2);
  });

  it('uses astronomical year numbering before the era', () => {
    // The Ides of March, 44 BC = year -43.
    expect(jdFromCalendar(-43, 3, 15)).toBe(1705425.5);
    // Year 0 (1 BC) is a leap year and runs straight into AD 1.
    expect(jdFromCalendar(1, 1, 1) - jdFromCalendar(0, 1, 1)).toBe(366);
    expect(jdFromCalendar(0, 1, 1) - jdFromCalendar(-1, 1, 1)).toBe(365);
    expect(jdFromCalendar(-1000, 1, 1)).toBe(1355807.5);
    expect(jdFromCalendar(3000, 1, 1)).toBe(2816787.5);
  });
});

describe('calendar date from a Julian Date', () => {
  it('returns a whole day and the hours since its midnight', () => {
    expect(calendarFromJd(J2000)).toEqual({ year: 2000, month: 1, day: 1, hour: 12 });
    const c = calendarFromJd(2436116.31);
    expect([c.year, c.month, c.day]).toEqual([1957, 10, 4]);
    expect(c.hour).toBeCloseTo(0.81 * 24, 5);
    expect(calendarFromJd(1842713)).toEqual({ year: 333, month: 1, day: 27, hour: 12 });
    const bc = calendarFromJd(1507900.13);
    expect([bc.year, bc.month, bc.day]).toEqual([-584, 5, 28]);
    expect(bc.hour).toBeCloseTo(0.63 * 24, 5);
  });

  it('round trips with jdFromCalendar from 4713 BC to AD 4000', () => {
    let checked = 0;
    for (let jd = 0; jd < 3200000; jd += 997.13) {
      const c = calendarFromJd(jd);
      expect(Number.isInteger(c.day)).toBe(true);
      expect(c.month).toBeGreaterThanOrEqual(1);
      expect(c.month).toBeLessThanOrEqual(12);
      expect(c.hour).toBeGreaterThanOrEqual(0);
      expect(c.hour).toBeLessThan(24);
      expect(Math.abs(jdFromCalendar(c.year, c.month, c.day + c.hour / 24) - jd)).toBeLessThan(1e-6);
      checked++;
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('round trips every day across the 1582 switch and across year 0', () => {
    for (const start of [2299100.5, 1721000.5]) {
      for (let i = 0; i < 200; i++) {
        const jd = start + i;
        const c = calendarFromJd(jd);
        expect(c.hour).toBe(0);
        expect(jdFromCalendar(c.year, c.month, c.day)).toBe(jd);
      }
    }
  });

  it('agrees with the calendar dates JPL Horizons prints, 1001 BC to AD 3000', () => {
    // Horizons labels each requested JD with a date in the same mixed Julian/Gregorian calendar.
    const row = /^(\d+\.\d+), (A\.D\.|B\.C\.) (\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.\d+,/;
    let checked = 0;
    let beforeEra = 0;
    for (const name of readdirSync(HORIZONS_DIR).filter((n) => n.startsWith('mercury-'))) {
      for (const line of readFileSync(HORIZONS_DIR + name, 'utf8').split('\n')) {
        const m = row.exec(line.trim());
        if (!m) continue;
        const year = m[2] === 'B.C.' ? 1 - Number(m[3]) : Number(m[3]);
        const c = calendarFromJd(Number(m[1]));
        expect([c.year, c.month, c.day]).toEqual([year, MONTHS.indexOf(m[4]!) + 1, Number(m[5])]);
        expect(c.hour).toBeCloseTo(Number(m[6]) + Number(m[7]) / 60 + Number(m[8]) / 3600, 3);
        checked++;
        if (year <= 0) beforeEra++;
      }
    }
    expect(checked).toBe(460);
    expect(beforeEra).toBe(40);
  });
});

describe('formatDate', () => {
  it('writes day, month name and year', () => {
    expect(formatDate(jdFromCalendar(2026, 11, 27))).toBe('27 November 2026');
    expect(formatDate(jdFromCalendar(2026, 11, 27.99))).toBe('27 November 2026');
    expect(formatDate(J2000)).toBe('1 January 2000');
  });

  it('writes years before the era as BC', () => {
    expect(formatDate(jdFromCalendar(-43, 3, 15))).toBe('15 March 44 BC');
    expect(formatDate(jdFromCalendar(0, 12, 31))).toBe('31 December 1 BC');
    expect(formatDate(0)).toBe('1 January 4713 BC');
  });

  it('marks years before 1000 as AD', () => {
    expect(formatDate(jdFromCalendar(378, 8, 9))).toBe('9 August AD 378');
    expect(formatDate(jdFromCalendar(1, 1, 1))).toBe('1 January AD 1');
    expect(formatDate(jdFromCalendar(1000, 1, 1))).toBe('1 January 1000');
  });
});

describe('angle reduction', () => {
  it('norm360 lands in [0, 360)', () => {
    expect(norm360(0)).toBe(0);
    expect(norm360(360)).toBe(0);
    expect(norm360(-360)).toBe(0);
    expect(norm360(725)).toBe(5);
    expect(norm360(-10)).toBe(350);
    expect(norm360(-1e-20)).toBe(0);
    for (const x of [-1e7, -721.5, -0.25, 0.25, 359.999999, 1e7 + 0.5]) {
      const r = norm360(x);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(360);
      expect(Math.abs(Math.sin(((r - x) * Math.PI) / 180))).toBeLessThan(1e-8);
    }
  });

  it('norm180 lands in (-180, 180]', () => {
    expect(norm180(180)).toBe(180);
    expect(norm180(-180)).toBe(180);
    expect(norm180(181)).toBe(-179);
    expect(norm180(-181)).toBe(179);
    expect(norm180(540)).toBe(180);
    expect(norm180(359)).toBe(-1);
    expect(norm180(0)).toBe(0);
  });
});
