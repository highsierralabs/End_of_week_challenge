// Cross sections and secondary-energy samplers.
import { ELECTRONS_PER_GRAM, LAMBDA_FROM_MB, M_E, R_E_CM, X0 } from './constants';
import type { Rng } from './rng';

// ---------------------------------------------------------------- hadronic

/**
 * Inelastic proton-air cross section, mb, for lab energy E (GeV). A smooth fit
 * through ~250 mb at 10 GeV, ~280 mb at 1 TeV, ~390 mb at 1 PeV and ~490 mb
 * at 1 EeV - the band spanned by accelerator-tuned models and the Auger/TA
 * measurements near 10^18 eV.
 */
export function sigmaProtonAir(E: number): number {
  const L = Math.log10(Math.max(E, 1) / 1000);
  if (L < 0) return Math.max(200, 280 + 15 * L);
  return 280 + 38.5 * L - 0.6 * L * L;
}

/** Inelastic pi-air cross section, mb (about 0.78 of p-air in this energy range). */
export function sigmaPionAir(E: number): number {
  return 0.78 * sigmaProtonAir(E);
}

/**
 * Nucleus-air cross section from the proton-air value at the same energy per
 * nucleon, with a geometric (A^1/3 + c)^2 scaling tuned so that iron-air is
 * ~4.4 times proton-air (~1750 mb).
 */
export function sigmaNucleusAir(E: number, A: number): number {
  if (A <= 1) return sigmaProtonAir(E);
  const c = 1.574;
  const r = (Math.cbrt(A) + c) / (1 + c);
  return sigmaProtonAir(E / A) * r * r;
}

export function lambdaFromSigma(sigmaMb: number): number {
  return LAMBDA_FROM_MB / sigmaMb;
}

/**
 * Mean charged multiplicity of a hadron-air collision at lab energy E (GeV):
 * the UA5-style pp fit n = -4.2 + 4.69 s^0.155 (s in GeV^2) times a nuclear
 * target enhancement. The enhancement is the main free parameter of the toy
 * model. Calibrated 2026-11-26 (tests/unit/calibration.test.ts) so that mean proton
 * Xmax at 1 PeV ~ 555 g/cm^2 and iron sits ~ 90-100 g/cm^2 shallower, as in
 * accelerator-tuned models (Kampert & Unger 2012, Astropart. Phys. 35, 660).
 */
export const TUNE = {
  /** Nuclear-target enhancement of the pp charged multiplicity. */
  enhancement: 0.7,
  /** Dirichlet concentration of the energy sharing among produced pions (lower = harder leaders). */
  alpha: 0.6,
  /** Inelasticity K ~ U(kMin, kMin + kRange). */
  kMin: 0.3,
  kRange: 0.5,
  /** Mean wounded projectile nucleons in a nucleus-air collision: 1 + wounded * (A^(2/3) - 1). */
  wounded: 0.45,
  /** Spectator break-up: the largest surviving fragment is spect * u^fragPow, the rest free nucleons. */
  fragPow: 1.5,
};
export function chargedMultiplicity(E: number): number {
  const s = 2 * 0.938 * E + 2 * 0.938 * 0.938;
  const npp = -4.2 + 4.69 * Math.pow(s, 0.155);
  return Math.max(2, npp * TUNE.enhancement);
}

// ---------------------------------------------------------------- photons

/** Klein-Nishina total cross section per electron, cm^2, photon energy E (GeV). */
export function sigmaKleinNishina(E: number): number {
  const k = E / M_E;
  if (k < 1e-3) return (8 / 3) * Math.PI * R_E_CM * R_E_CM * (1 - 2 * k);
  const l = Math.log(1 + 2 * k);
  const t1 = ((1 + k) / (k * k)) * ((2 * (1 + k)) / (1 + 2 * k) - l / k);
  const t2 = l / (2 * k);
  const t3 = (1 + 3 * k) / ((1 + 2 * k) * (1 + 2 * k));
  return 2 * Math.PI * R_E_CM * R_E_CM * (t1 + t2 - t3);
}

/** Compton mass attenuation coefficient of air, cm^2/g. */
export function muCompton(E: number): number {
  return sigmaKleinNishina(E) * ELECTRONS_PER_GRAM;
}

/** High-energy (complete screening) pair-production attenuation, cm^2/g: 7 / (9 X0). */
export const MU_PAIR_INF = 7 / (9 * X0);

// Ratio of the pair attenuation in air to its asymptote, vs photon energy:
// approximate interpolation of NIST XCOM (nuclear + electron field).
const PAIR_LOGE = [Math.log(1.022e-3), Math.log(2e-3), Math.log(5e-3), Math.log(1e-2), Math.log(2e-2), Math.log(5e-2), Math.log(0.1), Math.log(1), Math.log(10), Math.log(100)];
const PAIR_RATIO = [0, 0.019, 0.10, 0.22, 0.37, 0.565, 0.68, 0.885, 0.965, 0.993];

export function muPair(E: number): number {
  if (E <= 2 * M_E) return 0;
  const l = Math.log(E);
  if (l >= PAIR_LOGE[PAIR_LOGE.length - 1]!) return MU_PAIR_INF * PAIR_RATIO[PAIR_RATIO.length - 1]!;
  let i = 0;
  while (i < PAIR_LOGE.length - 2 && l > PAIR_LOGE[i + 1]!) i++;
  const f = (l - PAIR_LOGE[i]!) / (PAIR_LOGE[i + 1]! - PAIR_LOGE[i]!);
  return MU_PAIR_INF * (PAIR_RATIO[i]! + f * (PAIR_RATIO[i + 1]! - PAIR_RATIO[i]!));
}

/**
 * Sample the electron's energy fraction x in pair production from the
 * complete-screening Bethe-Heitler distribution 1 - (4/3) x (1 - x).
 */
export function samplePairFraction(rng: Rng, E: number): number {
  const xmin = M_E / E;
  for (;;) {
    const x = xmin + (1 - 2 * xmin) * rng.uniform();
    if (rng.uniform() <= 1 - (4 / 3) * x * (1 - x)) return x;
  }
}

/**
 * Sample Compton scattering (Klein-Nishina, the Butcher-Messel scheme used by
 * EGS and Geant4). Returns eps = E'/E and writes cos(theta) of the photon.
 */
export function sampleCompton(rng: Rng, E: number, out: { cosT: number }): number {
  const k = E / M_E;
  const eps0 = 1 / (1 + 2 * k);
  const eps0sq = eps0 * eps0;
  const alpha1 = -Math.log(eps0);
  const alpha2 = alpha1 + 0.5 * (1 - eps0sq);
  let eps: number, epssq: number, onecost: number, greject: number;
  do {
    if (alpha1 > alpha2 * rng.uniform()) {
      eps = Math.exp(-alpha1 * rng.uniform());
      epssq = eps * eps;
    } else {
      epssq = eps0sq + (1 - eps0sq) * rng.uniform();
      eps = Math.sqrt(epssq);
    }
    onecost = (1 - eps) / (eps * k);
    const sint2 = onecost * (2 - onecost);
    greject = 1 - (eps * sint2) / (1 + epssq);
  } while (greject < rng.uniform());
  out.cosT = 1 - onecost;
  return eps;
}

// ---------------------------------------------------------------- electrons

/**
 * Number of bremsstrahlung photons with energy fraction above vmin emitted per
 * radiation length (complete screening): integral of (1/v)(4/3 - 4/3 v + v^2).
 */
export function bremPerX0(vmin: number): number {
  if (vmin >= 1) return 0;
  return (4 / 3) * Math.log(1 / vmin) - (4 / 3) * (1 - vmin) + 0.5 * (1 - vmin * vmin);
}

/** Sample the photon energy fraction v in (vmin, 1) of a bremsstrahlung emission. */
export function sampleBremFraction(rng: Rng, vmin: number): number {
  const lnv = Math.log(vmin);
  for (;;) {
    const v = Math.exp(lnv * rng.uniform());
    if (rng.uniform() <= 1 - v + 0.75 * v * v) return v;
  }
}

/** Highland multiple-scattering width (radians) for a step of t radiation lengths. */
export function highlandTheta0(pBeta: number, t: number, charge = 1): number {
  if (t <= 0) return 0;
  const corr = 1 + 0.038 * Math.log(Math.max(t * charge * charge, 1e-6));
  return ((0.0136 / pBeta) * charge * Math.sqrt(t) * Math.max(corr, 0.3));
}

/**
 * Rossi-Greisen multiple scattering for e+-: projected width E_s / sqrt(2) / (p beta) * sqrt(t),
 * E_s = 21.2 MeV. Additive in t (no log term), the convention behind the NKG function and r_M.
 */
export function rossiTheta0(pBeta: number, t: number): number {
  if (t <= 0) return 0;
  return (0.0149906 / pBeta) * Math.sqrt(t);
}