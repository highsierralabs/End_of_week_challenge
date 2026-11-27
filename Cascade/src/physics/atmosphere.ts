// Linsley's five-layer parameterisation of the US Standard Atmosphere, as used
// by CORSIKA (atmosphere model 1). Vertical depth X(h) = a + b * exp(-h / c)
// in layers 1-4 and X(h) = a - b * h / c in layer 5, with h in cm.
// Source: D. Heck et al., CORSIKA user's guide, appendix D (US standard after Linsley).

const A = [-186.555305, -94.919, 0.61289, 0.0, 0.01128292];
const B = [1222.6562, 1144.9069, 1305.5948, 540.1778, 1.0];
const C = [994186.38, 878153.55, 636143.04, 772170.16, 1.0e9];
/** Lower boundary of each layer, cm. */
const H = [0, 4.0e5, 1.0e6, 4.0e6, 1.0e7];
/** Top of the atmosphere (X = 0), m. */
export const TOP_ALTITUDE_M = 112829.2;

const layerTopDepth: number[] = [];
for (let i = 0; i < 5; i++) layerTopDepth.push(depthAtCm(H[i]!, i));

function depthAtCm(hcm: number, i: number): number {
  if (i < 4) return A[i]! + B[i]! * Math.exp(-hcm / C[i]!);
  return A[4]! - (B[4]! * hcm) / C[4]!;
}

function layerOfCm(hcm: number): number {
  if (hcm < H[1]!) return 0;
  if (hcm < H[2]!) return 1;
  if (hcm < H[3]!) return 2;
  if (hcm < H[4]!) return 3;
  return 4;
}

/** Vertical atmospheric depth above altitude h (metres), g/cm^2. */
export function verticalDepth(hM: number): number {
  if (hM >= TOP_ALTITUDE_M) return 0;
  const hcm = Math.max(hM, -1000) * 100;
  return depthAtCm(hcm, layerOfCm(hcm));
}

/** Air density at altitude h (metres), g/cm^3. */
export function density(hM: number): number {
  if (hM >= TOP_ALTITUDE_M) return 0;
  const hcm = Math.max(hM, -1000) * 100;
  const i = layerOfCm(hcm);
  if (i < 4) return (B[i]! / C[i]!) * Math.exp(-hcm / C[i]!);
  return B[4]! / C[4]!;
}

/** Altitude (metres) at which the vertical depth equals X (g/cm^2). */
export function altitudeAtDepth(X: number): number {
  if (X <= 0) return TOP_ALTITUDE_M;
  // layerTopDepth[i] is the depth at the bottom boundary of layer i.
  let i = 4;
  while (i > 0 && X > layerTopDepth[i]!) i--;
  if (i < 4) {
    const arg = (X - A[i]!) / B[i]!;
    return (-C[i]! * Math.log(arg)) / 100;
  }
  return ((A[4]! - X) * C[4]!) / B[4]! / 100;
}

/** Station pressure (hPa) implied by a vertical depth: 1 g/cm^2 = 0.980665 hPa. */
export function depthToPressureHPa(X: number): number {
  return X * 0.980665;
}

/** Moliere radius at altitude h, metres: r_M = 9.6 g/cm^2 / rho. */
export function moliereRadiusM(hM: number): number {
  return 9.6 / density(hM) / 100;
}
