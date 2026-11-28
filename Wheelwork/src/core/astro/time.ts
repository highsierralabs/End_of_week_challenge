// Time and angle helpers for the reference astronomy.
//
// Time throughout src/core/astro is a Julian Date on a uniform dynamical scale (TT, or TDB: the
// two never differ by more than 2 ms). The difference between that scale and civil time (delta T
// = TT - UT, about 69 s in the 2020s, hours in antiquity) is ignored: a calendar date handed to
// jdFromCalendar is read as a date in dynamical time. For a machine whose own errors are degrees
// that matters only for the Moon, which moves 0.55 degree per hour.

/** Julian Date of the epoch J2000.0 (2000 January 1, 12h TT). */
export const J2000 = 2451545.0;
export const DAYS_PER_CENTURY = 36525;

/** First Julian Date of the Gregorian calendar: 1582 October 15, 0h. */
const GREGORIAN_START_JD = 2299160.5;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Julian centuries of 36525 days from J2000.0. */
export function centuriesSinceJ2000(jd: number): number {
  return (jd - J2000) / DAYS_PER_CENTURY;
}

/** Reduce an angle in degrees to [0, 360). */
export function norm360(deg: number): number {
  const r = deg % 360;
  if (r === 0) return 0; // also turns the -0 of a negative multiple of 360 into 0
  const p = r < 0 ? r + 360 : r;
  // -1e-20 % 360 + 360 rounds to exactly 360; fold it back so the range stays half open.
  return p >= 360 ? 0 : p;
}

/** Reduce an angle in degrees to (-180, 180]. */
export function norm180(deg: number): number {
  const p = norm360(deg);
  return p > 180 ? p - 360 : p;
}

/**
 * Julian Date of a calendar date (Meeus, Astronomical Algorithms, ch. 7). `day` may carry a
 * fraction. Years use astronomical numbering (year 0 = 1 BC, year -43 = 44 BC). Dates before
 * 1582 October 15 are read in the Julian calendar, later ones in the Gregorian. Valid for
 * years after -4712.
 */
export function jdFromCalendar(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const gregorian = year > 1582 || (year === 1582 && (month > 10 || (month === 10 && day >= 15)));
  let b = 0;
  if (gregorian) {
    const a = Math.floor(y / 100);
    b = 2 - a + Math.floor(a / 4);
  }
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/**
 * Inverse of jdFromCalendar (Meeus ch. 7): the calendar date holding `jd`, Julian calendar
 * before JD 2299160.5 and Gregorian from it. `day` is a whole day of the month and `hour` the
 * time since its midnight, in [0, 24). Valid for jd >= 0.
 */
export function calendarFromJd(jd: number): { year: number; month: number; day: number; hour: number } {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  let a = z;
  if (jd >= GREGORIAN_START_JD) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25);
    a = z + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { year, month, day, hour: f * 24 };
}

/**
 * A date for people: "27 November 2026", "15 March 44 BC". Years before 1000 carry an era
 * ("9 August AD 378") so that a short year cannot be mistaken for a day number.
 */
export function formatDate(jd: number): string {
  const { year, month, day } = calendarFromJd(jd);
  const name = MONTH_NAMES[month - 1] ?? '';
  if (year <= 0) return `${day} ${name} ${1 - year} BC`;
  if (year < 1000) return `${day} ${name} AD ${year}`;
  return `${day} ${name} ${year}`;
}
