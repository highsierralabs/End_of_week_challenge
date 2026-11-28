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
  /** machine - mean: what the gearing alone has lost or gained since the machine was set. */
  gearing: number;
  /** mean - truth: what uniform circular motion costs at this moment. */
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
  /** What the machine predicts at this instant. */
  now: 'solar' | 'lunar' | null;
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
  /** The Sun within this of a node makes an eclipse season. */
  season: 17,
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
  const jd = setJd + pose.turns * daysPerTurn(rates, targets);
  const planets = {} as Record<Body, BodyReading>;
  for (const b of BODIES) {
    const machine = norm360(pose.angle[b] / DEG);
    const state = planetState(b, jd);
    const mean = norm360(meanLongitudeUnwrapped(b, jd));
    planets[b] = {
      machine, truth: state.lon, mean,
      error: norm180(machine - state.lon), gearing: norm180(machine - mean), circle: norm180(mean - state.lon),
    };
  }
  const m = moonState(jd);
  const machineMoon = norm360(pose.angle.moonSleeve / DEG);
  const machineNode = norm360(pose.angle.nodeSleeve / DEG);
  const machineSun = norm360(planets.earth.machine + 180);
  const elongation = norm360(machineMoon - machineSun);
  const latitude = latitudeOnInclinedOrbit(machineMoon - machineNode);
  const meanMoon = norm360(moonMeanLongitudeUnwrapped(jd));
  const moon: MoonReading = {
    machine: machineMoon, truth: m.lon, mean: meanMoon,
    error: norm180(machineMoon - m.lon), gearing: norm180(machineMoon - meanMoon), circle: norm180(meanMoon - m.lon),
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
  const nearNew = Math.min(elongation, 360 - elongation) < ECLIPSE_LIMITS.syzygy;
  const nearFull = Math.abs(elongation - 180) < ECLIPSE_LIMITS.syzygy;
  let now: EclipseReading['now'] = null;
  if (nearNew && Math.abs(latitude) < ECLIPSE_LIMITS.solarLatitude) now = 'solar';
  else if (nearFull && Math.abs(latitude) < ECLIPSE_LIMITS.lunarLatitude) now = 'lunar';
  return { jd, planets, moon, eclipse: { sunFromNode, season: Math.abs(sunFromNode) < ECLIPSE_LIMITS.season, now } };
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
