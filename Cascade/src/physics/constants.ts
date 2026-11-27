// Particle data (PDG 2024) and material constants. Energies in GeV.
import { PType } from './types';

export const C_M_PER_NS = 0.299792458;

export const M_E = 0.00051099895;
export const M_MU = 0.1056583755;
export const M_PI = 0.13957039;
export const M_PI0 = 0.1349768;
export const M_P = 0.93827209;
export const M_N = 0.93956542;
/** Mean nucleon mass used for nuclei, GeV. */
export const M_NUCLEON = 0.9315;

/** Proper decay lengths c*tau, metres. */
export const CTAU_PI = 7.8045;
export const CTAU_MU = 658.6384;

/** Air: radiation length (g/cm^2), Z/A, electrons per gram. */
export const X0 = 36.62;
export const Z_OVER_A_AIR = 0.49919;
export const ELECTRONS_PER_GRAM = 6.02214076e23 * Z_OVER_A_AIR;
export const R_E_CM = 2.8179403262e-13;

/** Mean ionisation loss of relativistic e+- in air, GeV per g/cm^2 (Rossi approximation B: E_c / X0). */
export const DEDX_E = 0.00222;
/** Mean ionisation loss of muons in air, GeV per g/cm^2. */
export const DEDX_MU = 0.00207;
/** Muon radiative loss coefficient b in air, per g/cm^2 (PDG, ~ 3e-6 in standard rock; air is lower). */
export const B_MU_AIR = 2.5e-6;

/** Mean air mass number (for nuclear cross sections). */
export const A_AIR = 14.5;
/** Conversion: interaction length (g/cm^2) = LAMBDA_FROM_MB / sigma(mb). */
export const LAMBDA_FROM_MB = (A_AIR * 1.66053907e-24) / 1e-27;

export function massOf(t: PType, A = 1): number {
  switch (t) {
    case PType.GAMMA: return 0;
    case PType.ELECTRON:
    case PType.POSITRON: return M_E;
    case PType.MUON_MINUS:
    case PType.MUON_PLUS: return M_MU;
    case PType.PION_PLUS:
    case PType.PION_MINUS: return M_PI;
    case PType.PROTON: return M_P;
    case PType.NEUTRON: return M_N;
    case PType.NUCLEUS: return A * M_NUCLEON;
    default: return 0;
  }
}

export function isCharged(t: PType): boolean {
  return t !== PType.GAMMA && t !== PType.NEUTRON;
}
