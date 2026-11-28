// The machine against the sky. The reference astronomy says where each body is and how fast it
// goes in the mean; this module sets the machine by it, and reads the machine back against it.
import { moonMeanLongitudeUnwrapped, moonNodeUnwrapped, moonState, MOON, sunGeocentricLongitude } from '../astro/moon';
import { meanLongitudeUnwrapped, planetState, siderealPeriodDays } from '../astro/planets';
import { norm180, norm360 } from '../astro/time';
import { BODIES, type Body, CHAIN, DESIGN } from './design';
import { type Rates, type Setting, zeroSetting } from './kinematics';
import { type MachinePose } from './pose';
import { type Targets } from './spec';

const DEG = Math.PI / 180;

/** What the sky asks of the gear trains: the mean sidereal periods of the reference astronomy. */
export function skyTargets(): Targets {
  const period = {} as Targets['period'];
  for (const m of CHAIN) period[m] = m === 'month' ? MOON.siderealMonthDays : siderealPeriodDays(m);
  return { period, nodeDays: MOON.nodeRegressionDays };
}

/**
 * Set the machine for a date, as its maker would: each arm is turned to the body's mean longitude
 * (the machine knows nothing of ellipses), the Moon to its mean longitude, the inclined ring to
 * the mean node, and the earth's axis is leaned towards longitude 90, where the June solstice Sun
 * stands.
 */
export function settingFor(jd: number): Setting {
  const s = zeroSetting();
  for (const b of BODIES) s[b] = norm360(meanLongitudeUnwrapped(b, jd)) * DEG;
  // The month tube itself carries no pointer; start it with the Moon, which it drives 1:1.
  s.moonSleeve = norm360(moonMeanLongitudeUnwrapped(jd)) * DEG;
  s.moonStalk = s.moonSleeve;
  s.month = s.moonSleeve;
  s.nodeSleeve = norm360(moonNodeUnwrapped(jd)) * DEG;
  s.earthAxis = 90 * DEG;
  return s;
}

/** Days of machine time that pass in one turn of the crank: the earth arm is the calendar. */
export function daysPerTurn(rates: Rates, targets: Targets): number {
  return rates.value.earth * targets.period.earth;
}

export interface BodyReading {
  /** Heliocentric ecliptic longitude shown by the machine, degrees. */
  machine: number;
  /** True longitude from the reference astronomy. */
  truth: number;
  /** Mean longitude from the reference astronomy. */
  mean: number;
  /** machine - truth, in (-180, 180]. */
  error: number;
  /**
   * What the gearing alone has lost or gained since the machine was set: the angle the arm has
   * turned, less the angle the body's mean motion covers in the same time.
   */
  gearing: number;
  /**
   * The rest of the error: what steady circular motion cannot follow. Mostly the ellipse (the
   * equation of centre); for Jupiter and Saturn also the slow swing of their mutual pull, and
   * whatever of either was already present on the day the machine was set to mean places.
   */
  circle: number;
}

export interface MoonReading extends BodyReading {
  /** Longitude of the ascending node: machine, truth (mean node) and their difference. */
  node: number;
  nodeTruth: number;
  nodeError: number;
  /** Elongation from the Sun, degrees in [0, 360): 0 new, 90 first quarter, 180 full. */
  elongation: number;
  elongationTruth: number;
  /** Ecliptic latitude, degrees. */
  latitude: number;
  latitudeTruth: number;
  /** Illuminated fraction of the disc. */
  lit: number;
  /** Name of the phase the machine shows. */
  phase: string;
}

export interface EclipseReading {
  /** Angle of the Sun from the nearer node as the machine shows it, degrees in [-90, 90]. */
  sunFromNode: number;
  /** The Sun is close enough to a node for eclipses to happen at this new or full moon. */
  season: boolean;
  /**
   * What the machine shows at this instant: an eclipse when it is within a few degrees of a new or
   * full Moon whose latitude, taken at the exact new or full, is inside the limit.
   */
  now: 'solar' | 'lunar' | null;
  /** Days from now to the machine's nearer new or full Moon (negative when it has passed). */
  daysToSyzygy: number;
  /** The machine Moon's latitude at that new or full Moon, degrees. */
  latitudeAtSyzygy: number;
}

export interface Reading {
  jd: number;
  planets: Record<Body, BodyReading>;
  moon: MoonReading;
  eclipse: EclipseReading;
}

/** Half-widths of the windows in which eclipses can happen, as the Moon's latitude at syzygy. */
export const ECLIPSE_LIMITS = {
  /** A solar eclipse is seen somewhere on Earth when the new Moon's latitude is under about this. */
  solarLatitude: 1.5,
  /** The full Moon touches the Earth's umbra when its latitude is under about this. */
  lunarLatitude: 1.0,
  /** How close to exact new or full the Moon must be for the machine to call it, degrees of elongation. */
  syzygy: 6,
  /**
   * The Sun within this of a node makes an eclipse season: the textbook major limit for solar
   * eclipses is 18.5 degrees. The machine's Sun and node are mean ones, each up to 2 degrees from
   * the true, so a few real eclipses fall just outside its seasons (the validation page counts them).
   */
  season: 18.5,
} as const;

const PHASES = ['New Moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full Moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'] as const;

export function phaseName(elongation: number): string {
  const e = norm360(elongation);
  // The four principal phases get a narrow window; the others take what is left.
  if (e < 12 || e >= 348) return PHASES[0];
  if (Math.abs(e - 90) < 12) return PHASES[2];
  if (Math.abs(e - 180) < 12) return PHASES[4];
  if (Math.abs(e - 270) < 12) return PHASES[6];
  return PHASES[e < 90 ? 1 : e < 180 ? 3 : e < 270 ? 5 : 7];
}

/** Latitude of a body on an orbit inclined by `inclination` degrees, `fromNode` degrees past its ascending node. */
export function latitudeOnInclinedOrbit(fromNode: number, inclination: number = DESIGN.moonInclination): number {
  return Math.atan(Math.tan(inclination * DEG) * Math.sin(fromNode * DEG)) / DEG;
}

/** Read the machine at a pose and set it beside the sky at the date it shows. */
export function readMachine(pose: MachinePose, setJd: number, rates: Rates, targets: Targets): Reading {
  const days = pose.turns * daysPerTurn(rates, targets);
  const jd = setJd + days;
  // Degrees gained on the sky's mean motion since the setting: turned by the gears, less turned by the sky.
  const gained = (rate: number, period: number) => norm180(360 * (rate * pose.turns - days / period));
  const planets = {} as Record<Body, BodyReading>;
  for (const b of BODIES) {
    const machine = norm360(pose.angle[b] / DEG);
    const state = planetState(b, jd);
    const mean = norm360(meanLongitudeUnwrapped(b, jd));
    const error = norm180(machine - state.lon);
    const gearing = gained(rates.value[b], targets.period[b]);
    planets[b] = { machine, truth: state.lon, mean, error, gearing, circle: norm180(error - gearing) };
  }
  const m = moonState(jd);
  const machineMoon = norm360(pose.angle.moonSleeve / DEG);
  const machineNode = norm360(pose.angle.nodeSleeve / DEG);
  const machineSun = norm360(planets.earth.machine + 180);
  const elongation = norm360(machineMoon - machineSun);
  const latitude = latitudeOnInclinedOrbit(machineMoon - machineNode);
  const meanMoon = norm360(moonMeanLongitudeUnwrapped(jd));
  const moonError = norm180(machineMoon - m.lon);
  const moonGearing = gained(rates.value.moonSleeve, targets.period.month);
  const moon: MoonReading = {
    machine: machineMoon, truth: m.lon, mean: meanMoon,
    error: moonError, gearing: moonGearing, circle: norm180(moonError - moonGearing),
    node: machineNode, nodeTruth: m.node, nodeError: norm180(machineNode - m.node),
    elongation, elongationTruth: norm360(m.lon - sunGeocentricLongitude(jd)),
    latitude, latitudeTruth: m.lat,
    lit: (1 - Math.cos(elongation * DEG)) / 2,
    phase: phaseName(elongation),
  };
  // The Sun's distance from the nearer node, folded into [-90, 90].
  let sunFromNode = norm180(machineSun - machineNode);
  if (sunFromNode > 90) sunFromNode -= 180;
  if (sunFromNode < -90) sunFromNode += 180;
  // The verdict is taken at the exact new or full Moon, not at this instant: the Moon's latitude
  // changes by half a degree in the few hours either side.
  const perDay = (rate: number) => (360 * rate) / daysPerTurn(rates, targets);
  const toNew = norm180(elongation);
  const toFull = norm180(elongation - 180);
  const isNew = Math.abs(toNew) <= Math.abs(toFull);
  const off = isNew ? toNew : toFull;
  const elongationRate = perDay(rates.value.moonSleeve - rates.value.earth);
  const daysToSyzygy = elongationRate !== 0 ? -off / elongationRate : 0;
  const latitudeAtSyzygy = latitudeOnInclinedOrbit(machineMoon - machineNode + perDay(rates.value.moonSleeve - rates.value.nodeSleeve) * daysToSyzygy);
  let now: EclipseReading['now'] = null;
  if (Math.abs(off) < ECLIPSE_LIMITS.syzygy && Math.abs(latitudeAtSyzygy) < (isNew ? ECLIPSE_LIMITS.solarLatitude : ECLIPSE_LIMITS.lunarLatitude)) now = isNew ? 'solar' : 'lunar';
  return { jd, planets, moon, eclipse: { sunFromNode, season: Math.abs(sunFromNode) < ECLIPSE_LIMITS.season, now, daysToSyzygy, latitudeAtSyzygy } };
}

/**
 * The machine's verdict on one real syzygy: with the machine set at `setJd`, what its Moon, Sun
 * and node say at the catalogue instant `jd`. Used to score the machine against the eclipse
 * catalogue without posing the whole mechanism.
 */
export function machineAtSyzygy(jd: number, setJd: number, rates: Rates, targets: Targets, setting: Setting): { elongation: number; latitude: number; sunFromNode: number } {
  const turns = (jd - setJd) / daysPerTurn(rates, targets);
  const tau = 2 * Math.PI;
  const moon = norm360((setting.moonSleeve + tau * rates.value.moonSleeve * turns) / DEG);
  const node = norm360((setting.nodeSleeve + tau * rates.value.nodeSleeve * turns) / DEG);
  const sun = norm360((setting.earth + tau * rates.value.earth * turns) / DEG + 180);
  let sunFromNode = norm180(sun - node);
  if (sunFromNode > 90) sunFromNode -= 180;
  if (sunFromNode < -90) sunFromNode += 180;
  return { elongation: norm360(moon - sun), latitude: latitudeOnInclinedOrbit(moon - node), sunFromNode };
}
