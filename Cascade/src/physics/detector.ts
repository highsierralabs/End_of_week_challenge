// What one simulated shower delivers to the detector at the origin: particle
// densities at the detector's core distance and the expected number of
// particles crossing a 1 cm^3 crystal, bare and behind the lead castle.
import { M_MU } from './constants';
import { GND, GND_STRIDE, RClass, RCLASS_COUNT, type ShowerResult } from './types';

export interface DetectorExposure {
  /** Detector distance from the shower axis, measured in the shower plane, m. */
  coreDistance: number;
  /** Annulus used for the density estimate (shower-plane radii), m. */
  rLo: number;
  rHi: number;
  /** Ground densities per class at the detector distance, m^-2 (weighted). */
  density: number[];
  /** Weighted records in the annulus (statistical quality). */
  records: number;
  /** Expected particles through a bare 1 cm^3 cube (charged + photons crossing), all classes. */
  bareCharged: number;
  /** Expected muons through the crystal that clear the lead (30-40 mm) and cross >= 0.5 cm of CsI. */
  shieldedMuons: number;
}

/** Mean effective area of a 1 cm cube for near-vertical arrivals (projected area x long-chord fraction), cm^2. */
const CUBE_AREA_CM2 = 1.3;
const CHORD_FRACTION = 0.62;
const LEAD_THRESHOLD_GEV = 0.055;

export function detectorExposure(r: ShowerResult): DetectorExposure {
  const [ax, ay, az] = r.stats.axis;
  const cosT = -az;
  const shower = (x: number, y: number): number => {
    // Distance from the axis line through the core, in 3D, for a ground point.
    const dx = x - r.params.coreX, dy = y - r.params.coreY;
    const along = dx * ax + dy * ay;
    return Math.sqrt(Math.max(0, dx * dx + dy * dy - along * along));
  };
  const rd = shower(0, 0);
  // Annulus around the detector distance; widen until it holds enough records.
  let lo = rd * 0.8, hi = rd * 1.25 + 5;
  const g = r.ground;
  const count = (a: number, b: number): number => {
    let n = 0;
    for (let i = 0; i < r.groundCount; i++) {
      const o = i * GND_STRIDE;
      const s = shower(g[o + GND.X]!, g[o + GND.Y]!);
      if (s >= a && s < b) n++;
    }
    return n;
  };
  for (let k = 0; k < 6 && count(lo, hi) < 40; k++) { lo *= 0.75; hi = hi * 1.35 + 5; }
  const density = new Array<number>(RCLASS_COUNT).fill(0);
  let records = 0;
  let muonsPass = 0;
  for (let i = 0; i < r.groundCount; i++) {
    const o = i * GND_STRIDE;
    const s = shower(g[o + GND.X]!, g[o + GND.Y]!);
    if (s < lo || s >= hi) continue;
    records++;
    const c = g[o + GND.CLASS]!;
    const w = g[o + GND.W]!;
    density[c]! += w;
    if (c === RClass.MUON) {
      const E = 10 ** g[o + GND.LOGE]!;
      const dz = Math.abs(g[o + GND.DZ]!);
      const lead = Math.min(4 / Math.max(dz, 0.05), 3 / Math.max(Math.sqrt(1 - dz * dz), 0.05));
      if (E - M_MU > LEAD_THRESHOLD_GEV * (lead / 4)) muonsPass += w;
    }
  }
  // Shower-plane annulus area projected onto the ground.
  const area = (Math.PI * (hi * hi - lo * lo)) / Math.max(cosT, 0.2);
  for (let c = 0; c < RCLASS_COUNT; c++) density[c]! /= area;
  const charged = density[RClass.ELECTRON]! + density[RClass.POSITRON]! + density[RClass.MUON]! + density[RClass.HADRON]!;
  return {
    coreDistance: rd,
    rLo: lo,
    rHi: hi,
    density,
    records,
    bareCharged: charged * CUBE_AREA_CM2 * 1e-4,
    shieldedMuons: (muonsPass / area) * CUBE_AREA_CM2 * CHORD_FRACTION * 1e-4,
  };
}
