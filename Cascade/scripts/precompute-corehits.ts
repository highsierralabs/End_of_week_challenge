// PURPOSE: How often does any air shower put several particles through a 1 cm^2 crystal at once?
//          Simulates proton showers from 1e14 to 1e18 eV, measures the mean charged-particle
//          ground density against shower-plane core distance, finds the radius inside which the
//          density exceeds k particles per cm^2, and folds that area with the all-particle flux.
// USAGE:   npx vite-node scripts/precompute-corehits.ts -- [showersPerEnergy]
// OUTPUT:  src/data/corehits.json
// VERSION HISTORY:
//   1.0  2026-11-26  Initial release.
import { writeFileSync } from 'node:fs';
import { simulateShower, DEFAULT_PARAMS } from '../src/physics/cascade';
import { GND, GND_STRIDE, RClass } from '../src/physics/types';

const a = process.argv.slice(2).filter((x) => x !== '--');
const perE = Number(a[0] ?? 3);
const LOGE = [14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5, 18];
const THRESH_PER_CM2 = [0.1, 1, 3];
// Radial bins, shower plane, metres.
const RB = Array.from({ length: 41 }, (_, i) => 0.1 * Math.pow(10, i / 10)); // 0.1 m .. 1 km

/**
 * All-particle differential flux, m^-2 s^-1 sr^-1 GeV^-1: E^2.6 J ~ 4000 GeV^1.6 at a knee of
 * 4 PeV with slope -2.7, then -3.1 (round numbers from the PDG cosmic-ray review's all-particle plot;
 * normalisation uncertain by a factor of about 2).
 */
function flux(EGeV: number): number {
  const knee = 4e6;
  const atKnee = 4000 * Math.pow(knee, -2.6);
  return EGeV < knee ? atKnee * Math.pow(EGeV / knee, -2.7) : atKnee * Math.pow(EGeV / knee, -3.1);
}

const rows: { logE: number; rk: number[]; density1m: number; density10m: number; ms: number }[] = [];
for (const lg of LOGE) {
  const sum = new Float64Array(RB.length - 1);
  let ms = 0;
  for (let k = 0; k < perE; k++) {
    const r = simulateShower({
      ...DEFAULT_PARAMS, primary: 'proton', energyEV: 10 ** lg, zenithDeg: 20, azimuthDeg: 90 * k,
      seed: 500 + k, thinning: lg <= 14 ? 0 : 2e-5, recordTracks: false, coreX: 0, coreY: 0,
    });
    ms += r.stats.cpuMs;
    const [ax, ay] = r.stats.axis;
    for (let i = 0; i < r.groundCount; i++) {
      const o = i * GND_STRIDE;
      const c = r.ground[o + GND.CLASS]!;
      if (c === RClass.GAMMA) continue;
      const x = r.ground[o + GND.X]!, y = r.ground[o + GND.Y]!;
      const along = x * ax + y * ay;
      const s = Math.sqrt(Math.max(0, x * x + y * y - along * along));
      for (let b = 0; b < RB.length - 1; b++) {
        if (s >= RB[b]! && s < RB[b + 1]!) { sum[b]! += r.ground[o + GND.W]!; break; }
      }
    }
  }
  const dens = Array.from(sum, (v, b) => v / perE / (Math.PI * (RB[b + 1]! ** 2 - RB[b]! ** 2)));
  // Outermost radius at which the (monotone envelope of the) density still exceeds the threshold.
  const rk = THRESH_PER_CM2.map((t) => {
    const need = t * 1e4;
    let r = 0;
    for (let b = 0; b < dens.length; b++) if (dens[b]! >= need) r = RB[b + 1]!;
    return r;
  });
  const at = (m: number): number => dens[RB.findIndex((v) => v > m) - 1] ?? 0;
  rows.push({ logE: lg, rk, density1m: at(1), density10m: at(10), ms: Math.round(ms) });
  console.log(`1e${lg}: r(0.1,1,3 /cm2) = ${rk.map((v) => v.toFixed(2)).join(', ')} m; rho(1m)=${at(1).toExponential(2)} rho(10m)=${at(10).toExponential(2)} /m2; ${(ms / 1000).toFixed(0)} s`);
}

// Fold with the flux: rate = (pi sr, zenith < 60 deg) * integral J(E) pi r_k(E)^2 dE, trapezoid in log E.
const SR = Math.PI;
const rates = THRESH_PER_CM2.map((_, t) => {
  let total = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const e0 = 10 ** (rows[i]!.logE - 9), e1 = 10 ** (rows[i + 1]!.logE - 9);
    const f0 = flux(e0) * Math.PI * rows[i]!.rk[t]! ** 2;
    const f1 = flux(e1) * Math.PI * rows[i + 1]!.rk[t]! ** 2;
    // Integrate in ln E: dE = E dlnE.
    total += 0.5 * (f0 * e0 + f1 * e1) * Math.log(e1 / e0);
  }
  // Showers above the last energy: extrapolate with r_k^2 ~ E (density ~ E) and J ~ E^-3.1.
  const last = rows[rows.length - 1]!;
  const eL = 10 ** (last.logE - 9);
  total += (flux(eL) * Math.PI * last.rk[t]! ** 2 * eL) / (3.1 - 1 - 1);
  return total * SR; // per second
});
const out = {
  generated: 'scripts/precompute-corehits.ts v1.0',
  primary: 'proton', zenithDeg: 20, showersPerEnergy: perE, groundAltitudeM: 1539,
  thresholdsPerCm2: THRESH_PER_CM2,
  rows,
  ratePerSecond: rates,
  ratePerDay: rates.map((r) => r * 86400),
  ratePerYear: rates.map((r) => r * 86400 * 365.25),
  fluxNote: 'All-particle flux E^2.6 J = 4000 GeV^1.6 m^-2 s^-1 sr^-1 below a 4 PeV knee (slope -2.7, then -3.1); zenith < 60 deg (pi sr); normalisation uncertain by ~2.',
  method: 'Mean charged (e+-, mu, hadron) ground density vs shower-plane core distance from proton showers at 20 deg; r_k = outermost radius with density >= k per cm^2; rate = pi sr x integral J(E) pi r_k^2 dE.',
};
writeFileSync(new URL('../src/data/corehits.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log('rates per year (>=0.1, >=1, >=3 per cm2):', out.ratePerYear.map((v) => v.toExponential(2)).join(', '));
