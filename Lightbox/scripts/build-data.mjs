// PURPOSE: Turn the fetched reference data in data-src/ into the module the app imports,
//          src/data/optics.ts, and derive the three-spectrum basis used to turn an sRGB colour
//          into a reflectance spectrum.
// USAGE:   node scripts/build-data.mjs
// OUTPUT:  writes src/data/optics.ts (committed; CI does not regenerate it) and prints the basis
//          residuals.
// VERSION HISTORY:
//   1.0  2026-11-27  Initial release.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data-src', f), 'utf8'));
const cie = load('cie1931_2deg.json');
const d65 = load('cie_d65.json');
const glasses = load('glasses.json');
const lines = load('emission_lines_aki.json');
const metals = load('metals.json');

const L0 = 380;
const L1 = 750;
const slice = (arr, start) => arr.slice(L0 - start, L1 - start + 1);
const cmfX = slice(cie.x, cie.start_nm);
const cmfY = slice(cie.y, cie.start_nm);
const cmfZ = slice(cie.z, cie.start_nm);
const d65s = slice(d65.spd, d65.start_nm);

// ---------------------------------------------------------------- glasses
const GLASS_KEYS = { bk7: 'N-BK7', silica: 'fused_silica', sf10: 'SF10', sf11: 'N-SF11', diamond: 'diamond', water: 'water_20C', sapphire: 'sapphire_o' };
const glassOut = {};
for (const [key, src] of Object.entries(GLASS_KEYS)) {
  const g = glasses[src];
  if (!g) throw new Error(`glass ${src} missing`);
  if (g.A !== 0) throw new Error(`glass ${src}: unexpected constant term`);
  glassOut[key] = { name: g.name, B: g.B, C: g.C, squareC: g.rii_formula_type === 1, nd: g.nd ?? null, vd: g.Vd ?? null };
}

// ---------------------------------------------------------------- emission lines
// NIST's catalogue intensities mix sources and do not give a lamp's colour, so each line's
// strength is modelled instead: upper levels populated by a Boltzmann factor at one excitation
// temperature, power proportional to g_k A_ki / lambda * exp(-E_k / kT). Wavelengths, A_ki, g_k
// and E_k are NIST's. A real discharge is not in equilibrium, so the strengths are approximate
// (least so for krypton and xenon, where NIST has A_ki for only some of the lines).
const KT_EV = 0.6;
const lineOut = {};
for (const gas of ['H', 'He', 'Ne', 'Na', 'Hg', 'Ar', 'Kr', 'Xe']) {
  const merged = new Map();
  for (const r of lines[gas]) {
    if (r.core_excited || (r.type && r.type !== 'E1') || !(r.Aki > 0) || r.nm < L0 || r.nm > L1) continue;
    const key = Math.round(r.nm * 100);
    const p = ((r.gk * r.Aki) / r.nm) * Math.exp(-r.Ek_eV / KT_EV);
    const have = merged.get(key);
    if (have) { have.w += p * r.nm; have.p += p; } else merged.set(key, { w: p * r.nm, p });
  }
  let rows = [...merged.values()].map((m) => ({ nm: m.w / m.p, p: m.p }));
  const max = Math.max(...rows.map((r) => r.p));
  rows = rows.filter((r) => r.p > 3e-4 * max).sort((x, y) => y.p - x.p).slice(0, 60).sort((x, y) => x.nm - y.nm);
  lineOut[gas] = rows.map((r) => [Math.round(r.nm * 1000) / 1000, Number(((1000 * r.p) / max).toPrecision(4))]);
}

// ---------------------------------------------------------------- metals
const METAL_KEYS = { gold: 'Au', silver: 'Ag', copper: 'Cu', aluminium: 'Al_McPeak2015' };
const metalOut = {};
for (const [key, src] of Object.entries(METAL_KEYS)) {
  const m = metals[src];
  const pts = m.nm.map((nm, i) => [nm, m.n[i], m.k[i]]);
  for (const edge of [m.nearest_source_point_below_350nm, m.nearest_source_point_above_800nm]) {
    if (edge && typeof edge.nm === 'number') pts.push([edge.nm, edge.n, edge.k]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  metalOut[key] = { name: m.name, nm: pts.map((p) => p[0]), n: pts.map((p) => p[1]), k: pts.map((p) => p[2]) };
}

// ---------------------------------------------------------------- sRGB reflectance basis
// Three smooth, non-negative spectra that sum to one at every wavelength and that, lit by D65,
// have the colours of the sRGB primaries (the construction of Mallett and Yuksel 2019). Any
// sRGB colour in [0,1] is then a valid reflectance: r*R + g*G + b*B. Solved here as a small
// quadratic programme (smoothest spectra subject to those constraints) by ADMM.
const STEP = 5;
const n = (L1 - L0) / STEP + 1;
const at = (arr, i) => arr[i * STEP];
let ySum = 0;
for (let i = 0; i < n; i++) ySum += at(d65s, i) * at(cmfY, i);
const w = [cmfX, cmfY, cmfZ].map((c) => Array.from({ length: n }, (_, i) => (at(d65s, i) * at(c, i)) / ySum));
const PRIM = [[0.4124564, 0.2126729, 0.0193339], [0.3575761, 0.7151522, 0.119192]];
const N = 3 * n;
const m = n + 6;
// P = second-difference smoothness on each spectrum.
const P = Array.from({ length: N }, () => new Float64Array(N));
for (let c = 0; c < 3; c++) {
  for (let i = 1; i < n - 1; i++) {
    const idx = [c * n + i - 1, c * n + i, c * n + i + 1];
    const co = [1, -2, 1];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) P[idx[a]][idx[b]] += co[a] * co[b];
  }
}
const A = Array.from({ length: m }, () => new Float64Array(N));
const bvec = new Float64Array(m);
for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) A[i][c * n + i] = 1; bvec[i] = 1; }
for (let c = 0; c < 2; c++) for (let j = 0; j < 3; j++) {
  for (let i = 0; i < n; i++) A[n + c * 3 + j][c * n + i] = w[j][i];
  bvec[n + c * 3 + j] = PRIM[c][j];
}
const rho = 0.05;
const K = Array.from({ length: N + m }, () => new Float64Array(N + m));
for (let i = 0; i < N; i++) { for (let j = 0; j < N; j++) K[i][j] = P[i][j]; K[i][i] += rho; }
for (let r = 0; r < m; r++) for (let j = 0; j < N; j++) { K[N + r][j] = A[r][j]; K[j][N + r] = A[r][j]; }
function invert(M) {
  const s = M.length;
  const a = M.map((row, i) => { const r = new Float64Array(2 * s); r.set(row); r[s + i] = 1; return r; });
  for (let c = 0; c < s; c++) {
    let p = c;
    for (let r = c + 1; r < s; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    if (Math.abs(d) < 1e-14) throw new Error('singular KKT matrix');
    for (let j = 0; j < 2 * s; j++) a[c][j] /= d;
    for (let r = 0; r < s; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f === 0) continue;
      for (let j = 0; j < 2 * s; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((r) => r.slice(s));
}
const Kinv = invert(K);
const z = new Float64Array(N).fill(1 / 3);
const u = new Float64Array(N);
const x = new Float64Array(N);
const rhs = new Float64Array(N + m);
for (let it = 0; it < 30000; it++) {
  for (let i = 0; i < N; i++) rhs[i] = rho * (z[i] - u[i]);
  for (let r = 0; r < m; r++) rhs[N + r] = bvec[r];
  for (let i = 0; i < N; i++) {
    let s = 0;
    const row = Kinv[i];
    for (let j = 0; j < N + m; j++) s += row[j] * rhs[j];
    x[i] = s;
  }
  for (let i = 0; i < N; i++) { z[i] = Math.max(0, x[i] + u[i]); u[i] += x[i] - z[i]; }
}
// Enforce the partition exactly, then report how well the colours are met.
const basis = [0, 1, 2].map(() => new Array(n));
for (let i = 0; i < n; i++) {
  const s = z[i] + z[n + i] + z[2 * n + i];
  for (let c = 0; c < 3; c++) basis[c][i] = z[c * n + i] / s;
}
let worst = 0;
for (let c = 0; c < 2; c++) for (let j = 0; j < 3; j++) {
  let s = 0;
  for (let i = 0; i < n; i++) s += basis[c][i] * w[j][i];
  worst = Math.max(worst, Math.abs(s - PRIM[c][j]));
}
console.log(`basis: ${n} samples, worst primary XYZ residual ${worst.toExponential(2)}, min ${Math.min(...basis.flat()).toExponential(2)}`);
if (worst > 2e-4) throw new Error('reflectance basis did not converge');

// ---------------------------------------------------------------- write
const num = (v, d) => Number(v.toPrecision(d));
const arr = (a, d) => `[${a.map((v) => num(v, d)).join(',')}]`;
const out = `// GENERATED by scripts/build-data.mjs from the files in data-src/. Do not edit by hand.
// Sources and licences are listed in data-src/SOURCES.md and THIRD-PARTY-NOTICES.md: the CIE
// tables are CC BY-SA 4.0, the line list is from the NIST Atomic Spectra Database, the glass
// and metal data are from the refractiveindex.info database (CC0).

/** First and last wavelength (nm) of the 1 nm tables below. */
export const TABLE_START = ${L0};
export const TABLE_END = ${L1};

/** CIE 1931 2-degree colour matching functions at 1 nm. */
export const CMF_X: readonly number[] = ${arr(cmfX, 7)};
export const CMF_Y: readonly number[] = ${arr(cmfY, 7)};
export const CMF_Z: readonly number[] = ${arr(cmfZ, 7)};

/** CIE standard illuminant D65, relative power at 1 nm. */
export const D65: readonly number[] = ${arr(d65s, 6)};

export interface GlassData { name: string; B: number[]; C: number[]; squareC: boolean; nd: number | null; vd: number | null }
/** Sellmeier dispersion: n^2 = 1 + sum B_i L^2 / (L^2 - C_i), L in micrometres; where squareC is
 *  true the tabulated C_i is squared first. */
export const GLASSES: Record<string, GlassData> = ${JSON.stringify(glassOut)};

/** Emission lines per gas: [wavelength in air (nm), modelled relative power, strongest = 1000]. */
export const LINE_KT_EV = ${KT_EV};
export const LINES: Record<string, [number, number][]> = ${JSON.stringify(lineOut)};

export interface MetalData { name: string; nm: number[]; n: number[]; k: number[] }
/** Complex refractive index n + ik at the source's own wavelengths. */
export const METALS: Record<string, MetalData> = ${JSON.stringify(metalOut)};

/** Reflectance basis at ${STEP} nm from ${L0} nm: reflectance(l) = r*R(l) + g*G(l) + b*B(l) for linear sRGB (r, g, b). */
export const BASIS_STEP = ${STEP};
export const BASIS_R: readonly number[] = ${arr(basis[0], 5)};
export const BASIS_G: readonly number[] = ${arr(basis[1], 5)};
export const BASIS_B: readonly number[] = ${arr(basis[2], 5)};
`;
writeFileSync(join(root, 'src', 'data', 'optics.ts'), out);
console.log(`wrote src/data/optics.ts (${out.length} bytes)`);
