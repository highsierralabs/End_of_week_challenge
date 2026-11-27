// What one simulated shower delivers to the detector at the origin: particle
// densities at the detector's core distance and the expected number of particles
// crossing the 1 cm^3 crystal, bare and behind the lead castle. Uses the same
// crystal acceptance and lead model as rate mode (rate.ts).
import { M_MU } from './constants';
import { DEFAULT_RATE, acceptanceTable, crossingArea, leadPathCm } from './rate';
import { GND, GND_STRIDE, RClass, RCLASS_COUNT, type ShowerResult } from './types';

export interface DetectorExposure {
  /** Detector distance from the shower axis, measured in the shower plane, m. */
  coreDistance: number;
  /** Annulus used for the density estimate (shower-plane radii), m. */
  rLo: number;
  rHi: number;
  /** Ground densities per class at the detector distance, m^-2 (weighted). */
  density: number[];
  /** Ground records in the annulus (statistical quality). */
  records: number;
  /** Expected charged particles (e+-, mu, hadrons) crossing a bare 1 cm^3 crystal, any chord. */
  bareCharged: number;
  /** Expected muons that clear the lead and cross enough CsI to pass the 2.78 MeV threshold. */
  shieldedMuons: number;
}

export function detectorExposure(r: ShowerResult): DetectorExposure {
  const o = DEFAULT_RATE;
  const accShield = acceptanceTable(o.crystalCm, o.thresholdMeV / o.csiDedxMeVPerCm);
  const accBare = acceptanceTable(o.crystalCm, 1e-6);
  const [ax, ay, az] = r.stats.axis;
  const cosAxis = -az;
  const shower = (x: number, y: number): number => {
    // Distance of a ground point from the axis line through the core (both on the ground plane).
    const dx = x - r.params.coreX, dy = y - r.params.coreY;
    const along = dx * ax + dy * ay;
    return Math.sqrt(Math.max(0, dx * dx + dy * dy - along * along));
  };
  const rd = shower(0, 0);
  const g = r.ground;
  // Annulus around the detector distance; widen until it holds enough records.
  let lo = rd * 0.8, hi = rd * 1.25 + 5;
  const count = (a: number, b: number): number => {
    let n = 0;
    for (let i = 0; i < r.groundCount; i++) {
      const s = shower(g[i * GND_STRIDE + GND.X]!, g[i * GND_STRIDE + GND.Y]!);
      if (s >= a && s < b) n++;
    }
    return n;
  };
  for (let k = 0; k < 6 && count(lo, hi) < 40; k++) { lo *= 0.75; hi = hi * 1.35 + 5; }
  const density = new Array<number>(RCLASS_COUNT).fill(0);
  let records = 0;
  let bare = 0;
  let shielded = 0;
  for (let i = 0; i < r.groundCount; i++) {
    const p = i * GND_STRIDE;
    const s = shower(g[p + GND.X]!, g[p + GND.Y]!);
    if (s < lo || s >= hi) continue;
    records++;
    const c = g[p + GND.CLASS]!;
    const w = g[p + GND.W]!;
    density[c]! += w;
    if (c === RClass.GAMMA) continue;
    const dx = g[p + GND.DX]!, dy = g[p + GND.DY]!, dz = g[p + GND.DZ]!;
    bare += w * crossingArea(accBare, dx, dy, dz);
    if (c === RClass.MUON) {
      const E = 10 ** g[p + GND.LOGE]!;
      if (E - M_MU > leadPathCm(dx, dy, dz, o.lidCm, o.wallCm) * o.leadLossGeVPerCm) shielded += w * crossingArea(accShield, dx, dy, dz);
    }
  }
  // Shower-plane annulus area projected onto the ground, m^2; crossing areas are cm^2.
  const area = (Math.PI * (hi * hi - lo * lo)) / Math.max(cosAxis, 0.2);
  for (let c = 0; c < RCLASS_COUNT; c++) density[c]! /= area;
  return {
    coreDistance: rd,
    rLo: lo,
    rHi: hi,
    density,
    records,
    bareCharged: (bare * 1e-4) / area,
    shieldedMuons: (shielded * 1e-4) / area,
  };
}
