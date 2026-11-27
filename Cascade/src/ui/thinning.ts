// "Auto" Hillas thinning: pick epsilon from the primary energy so the work per shower
// stays roughly constant across 10^12 .. 10^19 eV.
//
// Cost model. With Hillas thinning every particle above E_thin = eps * E0 is followed
// in full; there are of order 1 / eps of them, whatever E0 is. Below E_thin each one
// continues as (on average) a single weighted chain whose length grows with the
// number of halvings between E_thin and the transport cut, ~ ln(E_thin / E_cut). So
//
//     cost(eps) ~ (1 / eps) * ln(eps * E0 / E_cut)
//
// and holding cost = K fixed gives eps = ln(eps * E0 / E_cut) / K, solved by a few
// fixed-point iterations. K is anchored so a 1 PeV shower with a 1 MeV EM cut gets
// eps = 1e-5 (the engine's default), which yields eps ~ 2e-5 at 10 EeV and ~ 6e-6 at
// 30 TeV. When E_thin would fall below 100 MeV (about the critical energy in air,
// where splitting stops and thinning saves little) the cascade is small enough to run
// exactly, so auto returns 0 (no thinning): that happens below ~ 20-30 TeV.
// The result is clamped to [1e-7, 1e-3]. This is a heuristic, not a guarantee: the
// real budget also depends on zenith angle, the muon/hadron cuts and maxSegments.

const REF_E0_GEV = 1e6;
const REF_ECUT_GEV = 1e-3;
const REF_EPS = 1e-5;
const K = Math.log((REF_EPS * REF_E0_GEV) / REF_ECUT_GEV) / REF_EPS;
/** Below this thinning energy (GeV) auto turns thinning off. */
export const AUTO_THIN_MIN_GEV = 0.1;

/** Auto thinning level epsilon for a primary of `energyEV` with EM cut `emCutMeV`. 0 = off. */
export function autoThinning(energyEV: number, emCutMeV: number): number {
  const E0 = energyEV / 1e9;
  const eCut = Math.max(emCutMeV, 0.01) / 1e3;
  if (!(E0 > 0)) return 0;
  let eps = REF_EPS;
  for (let i = 0; i < 6; i++) {
    const ratio = (eps * E0) / eCut;
    eps = ratio > Math.E ? Math.log(ratio) / K : 1 / K;
  }
  if (eps * E0 < AUTO_THIN_MIN_GEV) return 0;
  const c = Math.min(1e-3, Math.max(1e-7, eps));
  // Two significant digits: stable, readable, and reproducible from the URL / readout.
  return Number(c.toPrecision(2));
}
