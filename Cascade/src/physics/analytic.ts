// Closed-form shower models used as references for the Monte Carlo:
// Heitler-Matthews scalings, Gaisser-Hillas longitudinal profile, Greisen
// electron number, the NKG lateral distribution, and the muon spectrum.

/** Radiation length of air, g/cm^2 (PDG). */
export const X0_AIR = 36.62;
/** Critical energy of electrons in air, GeV (Rossi definition, ~ Heitler's xi_c^e). */
export const EC_AIR = 0.0848;
/** Pion critical energy in the Matthews model, GeV. */
export const XI_PI = 20;

/** Gaisser-Hillas profile N(X). */
export function gaisserHillas(X: number, nmax: number, xmax: number, x0: number, lambda: number): number {
  if (X <= x0) return 0;
  const a = (xmax - x0) / lambda;
  const r = (X - x0) / (xmax - x0);
  return nmax * Math.pow(r, a) * Math.exp((xmax - X) / lambda);
}

/** Longitudinal shower age (electromagnetic convention). */
export function showerAge(X: number, xmax: number): number {
  return (3 * X) / (X + 2 * xmax);
}

/** Greisen's electron number for a photon of energy E0 (GeV) at depth X (g/cm^2). */
export function greisen(E0: number, X: number): number {
  const y = Math.log(E0 / EC_AIR);
  const t = X / X0_AIR;
  if (t <= 0) return 0;
  const s = (3 * t) / (t + 2 * y);
  return (0.31 / Math.sqrt(y)) * Math.exp(t * (1 - 1.5 * Math.log(s)));
}

/** Heitler-Matthews depth of maximum for a photon-initiated shower, g/cm^2. */
export function xmaxPhoton(E0: number): number {
  return X0_AIR * Math.log(E0 / EC_AIR);
}

/**
 * Matthews (2005) proton Xmax: X0 ln(2N) ... in its widely used refined form
 * Xmax ~ X_first + X0 ln(E0 / (3 N_ch xi_c)), with lambda_I and N_ch energy dependent.
 * Here: the published approximate elongation form, g/cm^2, for E0 in GeV.
 */
export function xmaxProtonMatthews(E0: number): number {
  return 470 + 58 * Math.log10(E0 / 1e6);
}

/** Superposition: a nucleus of mass A at E0 behaves like A protons of E0/A. */
export function xmaxNucleusMatthews(E0: number, A: number): number {
  return xmaxProtonMatthews(E0 / A);
}

/** Matthews muon number, N_mu = (E0 / xi_pi)^beta, beta ~ 0.85; nuclei scale A^(1 - beta). */
export function muonNumberMatthews(E0: number, A = 1, beta = 0.85): number {
  return Math.pow(A, 1 - beta) * Math.pow(E0 / XI_PI, beta);
}

/** Heitler maximum size of the electromagnetic cascade, N_max = E0 / xi_c (an over-estimate by ~ g = 10 in Matthews). */
export function nmaxHeitler(E0: number): number {
  return E0 / EC_AIR;
}

/** Rule-of-thumb maximum size of a hadronic shower: N_max ~ E0 / 1.4 GeV (charged, above ~1 MeV). */
export function nmaxRuleOfThumb(E0: number): number {
  return E0 / 1.4;
}

/**
 * Nishimura-Kamata-Greisen lateral density of charged particles (m^-2) at
 * core distance r (m) for shower size Ne, age s, Moliere radius rM (m).
 */
export function nkgDensity(r: number, Ne: number, s: number, rM: number): number {
  const x = Math.max(r, 1e-3) / rM;
  const c = (gamma(4.5 - s) / (2 * Math.PI * gamma(s) * gamma(4.5 - 2 * s))) / (rM * rM);
  return Ne * c * Math.pow(x, s - 2) * Math.pow(1 + x, s - 4.5);
}

/** Lanczos approximation of the gamma function (positive real arguments). */
export function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  const zz = z - 1;
  let x = p[0]!;
  for (let i = 1; i < g + 2; i++) x += p[i]! / (zz + i);
  const t = zz + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, zz + 0.5) * Math.exp(-t) * x;
}

/**
 * Gaisser's sea-level muon spectrum (PDG review "Cosmic rays", eq. 30.4),
 * dN/dE dOmega in cm^-2 s^-1 sr^-1 GeV^-1, E in GeV, zenith theta in radians.
 * Valid for E > 100 / cos(theta) GeV roughly; used here only as a reference curve.
 */
export function gaisserMuonSpectrum(E: number, theta: number): number {
  const c = Math.cos(theta);
  return 0.14 * Math.pow(E, -2.7) * (1 / (1 + (1.1 * E * c) / 115) + 0.054 / (1 + (1.1 * E * c) / 850));
}

/** PDG reference: integral vertical muon intensity above 1 GeV/c at sea level, cm^-2 s^-1 sr^-1. */
export const PDG_VERTICAL_MUON_INTENSITY_SEA = 70e-4;
/** PDG reference: horizontal-detector muon flux at sea level, ~1 per cm^2 per minute. */
export const PDG_HORIZONTAL_MUON_FLUX_SEA = 1 / 60;
