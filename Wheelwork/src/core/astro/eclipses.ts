// New and full moons from the reference Moon and Sun, and the catalogue of real eclipses they
// are checked against.
//
// The catalogue is Fred Espenak's Five Millennium Catalogs of Solar and Lunar Eclipses, 1901 to
// 2100 ("Eclipse Predictions by Fred Espenak, NASA's GSFC"), shipped in
// src/data/eclipse-catalogue.ts: the instant of greatest eclipse as a Julian Date in Terrestrial
// Dynamical Time, the type (solar P, A, T, H; lunar N, P, T) and gamma.

import { MOON, moonElongation, moonState } from './moon';

export { ECLIPSES, type CatalogueEclipse } from '../../data/eclipse-catalogue';

export interface Syzygy {
  /** Instant of the true conjunction or opposition in longitude, Julian Date (TT). */
  jd: number;
  kind: 'new' | 'full';
}

/** Mean rate of the elongation, degrees per day (one turn per synodic month). */
const MEAN_ELONGATION_RATE = 360 / MOON.synodicMonthDays;
/** Stop refining when the step is below this many days (0.1 s). */
const TIME_TOLERANCE_DAYS = 1e-6;

/** Signed difference a - b of two angles in degrees, in [-180, 180). */
function angleDiff(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180;
}

/**
 * Refine an instant near which the elongation equals `target` (0 or 180 degrees). The true rate
 * of the elongation stays between 0.88 and 1.18 of the mean (10.7 to 14.4 degrees per day), so
 * stepping with the mean rate closes on the root by a factor of five or better each pass.
 */
function refine(jdGuess: number, target: number): number {
  let jd = jdGuess;
  for (let i = 0; i < 40; i++) {
    const step = angleDiff(target, moonElongation(jd)) / MEAN_ELONGATION_RATE;
    jd += step;
    if (Math.abs(step) < TIME_TOLERANCE_DAYS) break;
  }
  return jd;
}

/**
 * Every new and full moon with jd0 <= jd < jd1, in order: the instants at which the true
 * geocentric longitudes of the Moon and the Sun (moonState, sunGeocentricLongitude: geometric,
 * J2000 frame) are equal or opposite. Each is converged numerically to well under a second. How
 * close it is to the real instant is set by the two theories: over 1900 to 2100 the elongation
 * is within 0.013 degree of JPL Horizons (rms 0.004), which is 1.5 minutes of time at worst and
 * half a minute rms; nearly all of it is the Sun (the Keplerian Earth), not the Moon. Geometric:
 * the apparent syzygy, with aberration, falls about 40 s later. Time is dynamical: no delta T.
 */
export function syzygies(jd0: number, jd1: number): Syzygy[] {
  const out: Syzygy[] = [];
  if (!(jd1 > jd0)) return out;
  // Start from the syzygy at or before jd0, so that one falling exactly on jd0 is not stepped over.
  const startElongation = moonElongation(jd0);
  let index = Math.floor(startElongation / 180); // the syzygy at or before jd0: 0 new, 1 full
  let guess = jd0 - (startElongation - index * 180) / MEAN_ELONGATION_RATE;
  for (;;) {
    const jd = refine(guess, index % 2 === 0 ? 0 : 180);
    if (jd >= jd1) break;
    if (jd >= jd0) out.push({ jd, kind: index % 2 === 0 ? 'new' : 'full' });
    index += 1;
    guess = jd + 180 / MEAN_ELONGATION_RATE;
  }
  return out;
}

/**
 * Geocentric latitude of the Moon above the ecliptic of date, degrees. At a syzygy it says how
 * far the Moon passes from the Sun or from the Earth's shadow: an eclipse needs it small. At the
 * 909 catalogue eclipses of 1901 to 2100 it is below 1.55 degrees for every solar eclipse, 1.57
 * for every lunar one, 1.03 for the umbral lunar ones and 0.49 for the total lunar ones.
 */
export function moonLatitudeAt(jd: number): number {
  return moonState(jd).lat;
}
