// Spectra and colour. Every spectrum the tracer uses is a row of NS samples, linear in
// wavelength from LAM0 to LAM1, and the shader interpolates linearly between samples. Light
// spectra are normalised to unit luminance, so a light's "scale" is its luminance in cd/m2 and
// the Y the tracer accumulates is luminance in cd/m2.
import { BASIS_B, BASIS_G, BASIS_R, BASIS_STEP, CMF_X, CMF_Y, CMF_Z, D65, GLASSES, LINES, METALS, TABLE_START } from '../data/optics';
import type { GasName, GlassName, LightSpectrum, MetalName, Rgb } from './scene';

export const LAM0 = 380;
export const LAM1 = 750;
export const NS = 1024;
export const DLAM = (LAM1 - LAM0) / (NS - 1);
/** Entries in the wavelength sampler's inverse CDF. */
export const NL = 2048;

export type Spectrum = Float32Array;

export const lamAt = (i: number): number => LAM0 + i * DLAM;

function tableAt(table: readonly number[], start: number, step: number, lam: number): number {
  const x = (lam - start) / step;
  const i = Math.min(table.length - 2, Math.max(0, Math.floor(x)));
  const f = Math.min(1, Math.max(0, x - i));
  return table[i]! * (1 - f) + table[i + 1]! * f;
}

export function tabulate(fn: (lam: number) => number): Spectrum {
  const s = new Float32Array(NS);
  for (let i = 0; i < NS; i++) s[i] = fn(lamAt(i));
  return s;
}

/** Trapezoid integral of a tabulated spectrum (optionally times another) over wavelength. */
export function integrate(a: Spectrum, b?: Spectrum): number {
  let s = 0;
  for (let i = 0; i < NS; i++) {
    const w = i === 0 || i === NS - 1 ? 0.5 : 1;
    s += w * a[i]! * (b ? b[i]! : 1);
  }
  return s * DLAM;
}

export const CMF: [Spectrum, Spectrum, Spectrum] = [
  tabulate((l) => tableAt(CMF_X, TABLE_START, 1, l)),
  tabulate((l) => tableAt(CMF_Y, TABLE_START, 1, l)),
  tabulate((l) => tableAt(CMF_Z, TABLE_START, 1, l)),
];

/** CIE XYZ of a spectrum (no normalisation: Y is the integral against y-bar). */
export function toXYZ(s: Spectrum): [number, number, number] {
  return [integrate(s, CMF[0]), integrate(s, CMF[1]), integrate(s, CMF[2])];
}

/** Planck's law, relative spectral radiance per unit wavelength. */
export function planck(lamNm: number, kelvin: number): number {
  const l = lamNm * 1e-9;
  const c2 = 1.438776877e-2; // hc/k, metre kelvin
  return 1e-30 / (l ** 5 * Math.expm1(c2 / (l * kelvin)));
}

/** Deposit a narrow line: split between the two nearest samples so the centroid is kept. */
function addLine(s: Spectrum, nm: number, power: number): void {
  const x = (nm - LAM0) / DLAM;
  if (x < 0 || x > NS - 1) return;
  const i = Math.min(NS - 2, Math.floor(x));
  const f = x - i;
  s[i]! += (power * (1 - f)) / DLAM;
  s[i + 1]! += (power * f) / DLAM;
}

export function gasSpectrum(gas: GasName): Spectrum {
  const s = new Float32Array(NS);
  for (const [nm, rel] of LINES[gas] ?? []) addLine(s, nm, rel);
  return s;
}

/** A light's spectrum before normalisation. */
export function rawLightSpectrum(d: LightSpectrum): Spectrum {
  switch (d.kind) {
    case 'blackbody': return tabulate((l) => planck(l, d.kelvin));
    case 'd65': return tabulate((l) => tableAt(D65, TABLE_START, 1, l));
    case 'equal': return tabulate(() => 1);
    case 'gas': return gasSpectrum(d.gas);
    case 'laser': { const s = new Float32Array(NS); addLine(s, d.nm, 1); return s; }
    case 'led': {
      const sigma = Math.max(d.width, 1) / 2.3548;
      return tabulate((l) => Math.exp(-0.5 * ((l - d.nm) / sigma) ** 2));
    }
  }
}

/** A light's spectrum scaled to unit luminance: its integral against y-bar is 1. */
export function lightSpectrum(d: LightSpectrum): Spectrum {
  const s = rawLightSpectrum(d);
  const y = integrate(s, CMF[1]);
  if (!(y > 0)) throw new Error(`light spectrum ${JSON.stringify(d)} has no visible output`);
  for (let i = 0; i < NS; i++) s[i]! /= y;
  return s;
}

// ---------------------------------------------------------------- colour
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** XYZ (D65 white) to linear sRGB, row-major. */
export const XYZ_TO_RGB = [
  3.2404542, -1.5371385, -0.4985314,
  -0.969266, 1.8760108, 0.041556,
  0.0556434, -0.2040259, 1.0572252,
];

export function xyzToLinearRgb(xyz: [number, number, number]): [number, number, number] {
  const m = XYZ_TO_RGB;
  return [
    m[0]! * xyz[0] + m[1]! * xyz[1] + m[2]! * xyz[2],
    m[3]! * xyz[0] + m[4]! * xyz[1] + m[5]! * xyz[2],
    m[6]! * xyz[0] + m[7]! * xyz[1] + m[8]! * xyz[2],
  ];
}

/** Reflectance spectrum of an sRGB colour: smooth, within [0, 1], and exact under D65. */
export function reflectance(rgb: Rgb): Spectrum {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  return tabulate((l) =>
    r * tableAt(BASIS_R, TABLE_START, BASIS_STEP, l) + g * tableAt(BASIS_G, TABLE_START, BASIS_STEP, l) + b * tableAt(BASIS_B, TABLE_START, BASIS_STEP, l));
}

/** Refractive index of a glass at a wavelength (nm), from its Sellmeier formula. */
export function glassIndex(glass: GlassName, lamNm: number): number {
  const g = GLASSES[glass]!;
  const L2 = (lamNm / 1000) ** 2;
  let n2 = 1;
  for (let i = 0; i < g.B.length; i++) {
    const c = g.squareC ? g.C[i]! * g.C[i]! : g.C[i]!;
    n2 += (g.B[i]! * L2) / (L2 - c);
  }
  return Math.sqrt(n2);
}
export const glassSpectrum = (glass: GlassName): Spectrum => tabulate((l) => glassIndex(glass, l));

/** Abbe number from the d, F and C lines. */
export function abbe(glass: GlassName): number {
  return (glassIndex(glass, 587.5618) - 1) / (glassIndex(glass, 486.1327) - glassIndex(glass, 656.2725));
}

function metalAt(m: { nm: number[]; n: number[]; k: number[] }, which: 'n' | 'k', lam: number): number {
  const nm = m.nm;
  let i = 0;
  while (i < nm.length - 2 && nm[i + 1]! < lam) i++;
  const f = Math.min(1, Math.max(0, (lam - nm[i]!) / (nm[i + 1]! - nm[i]!)));
  return m[which][i]! * (1 - f) + m[which][i + 1]! * f;
}
/** Complex index n + ik of a metal, tabulated (linear between the source's points). */
export function metalSpectra(metal: MetalName): [Spectrum, Spectrum] {
  const m = METALS[metal]!;
  return [tabulate((l) => metalAt(m, 'n', l)), tabulate((l) => metalAt(m, 'k', l))];
}

/** Normal-incidence reflectance of a metal at a wavelength. */
export function metalReflectance(metal: MetalName, lam: number): number {
  const m = METALS[metal]!;
  const n = metalAt(m, 'n', lam);
  const k = metalAt(m, 'k', lam);
  return ((n - 1) ** 2 + k * k) / ((n + 1) ** 2 + k * k);
}

/**
 * Absorption coefficient (per metre) of tinted glass: after 1 / density metres the light has
 * the tint's colour.
 */
export function absorption(tint: Rgb, density: number): Spectrum {
  const r = reflectance(tint);
  return tabulate((l) => {
    const i = Math.min(NS - 1, Math.max(0, Math.round((l - LAM0) / DLAM)));
    return -Math.log(Math.max(r[i]!, 1e-4)) * density;
  });
}

// ---------------------------------------------------------------- wavelength sampling
/**
 * Inverse CDF of the wavelength sampler: NL + 1 wavelengths; a uniform u in [k/NL, (k+1)/NL)
 * maps linearly onto [table[k], table[k+1]]. The density follows the given power spectrum
 * weighted by the eye's response, mixed with a little of the plain response so that every
 * visible wavelength keeps a non-zero chance.
 */
export function wavelengthTable(power: Spectrum): Float32Array {
  const resp = tabulate((l) => tableAt(CMF_X, TABLE_START, 1, l) + tableAt(CMF_Y, TABLE_START, 1, l) + tableAt(CMF_Z, TABLE_START, 1, l));
  const target = new Float64Array(NS);
  let sum = 0;
  let rsum = 0;
  for (let i = 0; i < NS; i++) { target[i] = power[i]! * resp[i]!; sum += target[i]!; rsum += resp[i]!; }
  for (let i = 0; i < NS; i++) target[i] = (sum > 0 ? (0.9 * target[i]!) / sum : 0) + ((sum > 0 ? 0.1 : 1) * resp[i]!) / rsum + 1e-7;
  // CDF of the piecewise-linear density at the sample points.
  const cdf = new Float64Array(NS);
  for (let i = 1; i < NS; i++) cdf[i] = cdf[i - 1]! + 0.5 * (target[i - 1]! + target[i]!);
  const total = cdf[NS - 1]!;
  const out = new Float32Array(NL + 1);
  let j = 0;
  for (let k = 0; k <= NL; k++) {
    const c = (k / NL) * total;
    while (j < NS - 2 && cdf[j + 1]! < c) j++;
    // Invert the quadratic CDF segment between samples j and j + 1.
    const a = target[j]!;
    const b = target[j + 1]!;
    const dc = c - cdf[j]!;
    let f: number;
    if (Math.abs(b - a) < 1e-12 * (a + b)) f = dc / Math.max(a, 1e-30);
    else f = (-a + Math.sqrt(Math.max(0, a * a + 2 * (b - a) * dc))) / (b - a);
    out[k] = lamAt(j) + Math.min(1, Math.max(0, f)) * DLAM;
  }
  out[0] = LAM0;
  out[NL] = LAM1;
  // Float32 rounding must not produce an empty interval (its density would be infinite).
  for (let k = 1; k <= NL; k++) if (out[k]! <= out[k - 1]!) out[k] = out[k - 1]! + 1e-4;
  return out;
}

// ---------------------------------------------------------------- white balance
/** Chromaticity-preserving XYZ of a blackbody at unit luminance. */
export function blackbodyXYZ(kelvin: number): [number, number, number] {
  return toXYZ(lightSpectrum({ kind: 'blackbody', kelvin }));
}

const BRADFORD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const BRADFORD_INV = [0.9869929, -0.1470543, 0.1599627, 0.4323053, 0.5183603, 0.0492912, -0.0085287, 0.0400428, 0.9684867];
const mul3 = (a: number[], b: number[]): number[] => {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
  return o;
};
const D65_XYZ: [number, number, number] = [0.95047, 1, 1.08883];

/**
 * 3x3 (row-major) taking tracer XYZ to linear sRGB with a white balance: a blackbody at
 * `kelvin` comes out neutral (Bradford adaptation to D65).
 */
export function cameraMatrix(kelvin: number): number[] {
  const w = blackbodyXYZ(kelvin);
  const cone = (v: [number, number, number]) => [0, 1, 2].map((r) => BRADFORD[r * 3]! * v[0] + BRADFORD[r * 3 + 1]! * v[1] + BRADFORD[r * 3 + 2]! * v[2]);
  const src = cone(w);
  const dst = cone(D65_XYZ);
  const scale = [dst[0]! / src[0]!, 0, 0, 0, dst[1]! / src[1]!, 0, 0, 0, dst[2]! / src[2]!];
  return mul3(XYZ_TO_RGB, mul3(BRADFORD_INV, mul3(scale, BRADFORD)));
}

/** A stable key for a spectrum description, for sharing rows between materials. */
export const spectrumKey = (kind: string, d: unknown): string => `${kind}:${JSON.stringify(d)}`;
