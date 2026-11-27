// PURPOSE: Precompute the validation ensemble shipped with validation.html (src/data/validation.json):
//          vertical proton / iron / gamma showers over a ladder of energies, with per-shower
//          X1, Gaisser-Hillas Xmax and Nmax, ground muon and e+- counts, and per-energy summaries.
// USAGE:   npx vite-node scripts/precompute-validation.ts
//          npx vite-node scripts/precompute-validation.ts -- probe <primary> <log10E> <thinning> [n]
// OUTPUT:  src/data/validation.json (full run); timings on stdout (probe)
// VERSION HISTORY:
//   1.0  2026-11-26  Initial release.
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { simulateShower, DEFAULT_PARAMS } from '../src/physics/cascade';
import { RClass, type Primary, type ShowerParams } from '../src/physics/types';

/** One ensemble cell: primary x energy, with the thinning chosen to keep a shower at ~0.5-3 s. */
interface Cell { primary: Primary; lgE: number; n: number; thinning: number }

const PRIMARIES: Primary[] = ['proton', 'iron', 'gamma'];

/**
 * Thinning per log10(E/eV), chosen from probe runs on the build machine (probe mode)
 * for ~0.5-3 s per shower. Measured at fixed epsilon = 1e-4 (proton): 0.17 s at 1e13,
 * 0.6 s at 1e15, 1.7 s at 1e17, 2.4 s at 1e18 (the EM weight limit grows with E0, so the
 * tracked count still rises slowly). Epsilon is lowered where showers are cheap.
 */
const THINNING: Record<number, number> = { 13: 1e-5, 14: 2e-5, 15: 3e-5, 16: 1e-4, 17: 1e-4, 18: 1e-4 };
/** Thinning-convergence check: proton 1e15 eV at three epsilons, same seeds. */
const CHECK = { primary: 'proton' as Primary, lgE: 15, n: 12, eps: [1e-4, 3e-5, 1e-5] };
const SIZE: Record<number, number> = { 13: 24, 14: 24, 15: 24, 16: 12, 17: 12, 18: 12 };
const LADDER: Record<Primary, number[]> = {
  proton: [13, 14, 15, 16, 17, 18],
  iron: [13, 14, 15, 16, 17, 18],
  gamma: [13, 14, 15, 16, 17],
  helium: [],
  nitrogen: [],
};

function paramsFor(primary: Primary, lgE: number, thinning: number, seed: number): ShowerParams {
  return {
    ...DEFAULT_PARAMS,
    primary,
    energyEV: 10 ** lgE,
    zenithDeg: 0,
    azimuthDeg: 0,
    coreX: 0,
    coreY: 0,
    seed,
    thinning,
    recordTracks: false,
    maxSegments: 0,
  };
}

/** Deterministic seed per (primary, energy, index). */
function seedFor(primary: Primary, lgE: number, i: number): number {
  return 100_000 * (PRIMARIES.indexOf(primary) + 1) + 1000 * lgE + i + 1;
}

interface ShowerRow {
  seed: number;
  /** Slant depth of the first interaction, g/cm^2. */
  x1: number;
  /** Gaisser-Hillas fit to the charged profile (null when the fit failed). */
  xmax: number | null;
  nmax: number | null;
  ghX0: number | null;
  ghLambda: number | null;
  /** Weighted ground muons (kinetic > muon cut). */
  nMu: number;
  /** Weighted ground e+- (kinetic > EM cut). */
  nE: number;
  /** Weighted ground photons. */
  nG: number;
  cpuMs: number;
  tracked: number;
}

function runOne(primary: Primary, lgE: number, thinning: number, seed: number): ShowerRow {
  const r = simulateShower(paramsFor(primary, lgE, thinning, seed));
  const s = r.stats;
  const gc = s.groundCounts;
  const gh = s.gh;
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  const sig = (v: number): number => Number(v.toPrecision(5));
  return {
    seed,
    x1: r1(s.firstInteractionDepth),
    xmax: gh ? r1(gh.xmax) : null,
    nmax: gh ? sig(gh.nmax) : null,
    ghX0: gh ? r1(gh.x0) : null,
    ghLambda: gh ? r1(gh.lambda) : null,
    nMu: sig(gc[RClass.MUON]!),
    nE: sig(gc[RClass.ELECTRON]! + gc[RClass.POSITRON]!),
    nG: sig(gc[RClass.GAMMA]!),
    cpuMs: Math.round(s.cpuMs),
    tracked: s.particlesTracked,
  };
}

interface Summary { n: number; mean: number; rms: number; median: number; sem: number }

function summarise(vals: number[]): Summary | null {
  const v = vals.filter((x) => Number.isFinite(x));
  if (v.length === 0) return null;
  const n = v.length;
  const mean = v.reduce((a, b) => a + b, 0) / n;
  // Sample standard deviation (N - 1): the shower-to-shower fluctuation, "RMS" in the Xmax literature.
  const rms = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const s = [...v].sort((a, b) => a - b);
  const median = n % 2 ? s[(n - 1) / 2]! : 0.5 * (s[n / 2 - 1]! + s[n / 2]!);
  const r = (x: number): number => Number(x.toPrecision(5));
  return { n, mean: r(mean), rms: r(rms), median: r(median), sem: r(rms / Math.sqrt(n)) };
}

function probe(args: string[]): void {
  const primary = (args[0] ?? 'proton') as Primary;
  const lgE = Number(args[1] ?? 15);
  const thinning = Number(args[2] ?? 1e-4);
  const n = Number(args[3] ?? 2);
  for (let i = 0; i < n; i++) {
    const row = runOne(primary, lgE, thinning, seedFor(primary, lgE, i));
    console.log(`probe ${primary} lgE=${lgE} eps=${thinning} seed=${row.seed}: ${(row.cpuMs / 1000).toFixed(2)} s, ` +
      `tracked=${row.tracked}, Xmax=${row.xmax}, Nmax=${row.nmax?.toExponential(3)}, Nmu=${row.nMu.toExponential(3)}, Ne=${row.nE.toExponential(3)}`);
  }
}

function full(): void {
  const cells: Cell[] = [];
  for (const primary of PRIMARIES) for (const lgE of LADDER[primary]) cells.push({ primary, lgE, n: SIZE[lgE]!, thinning: THINNING[lgE]! });
  const total = cells.reduce((a, c) => a + c.n, 0);
  const t0 = performance.now();
  let done = 0;
  const out = [];
  for (const c of cells) {
    const rows: ShowerRow[] = [];
    const tc = performance.now();
    for (let i = 0; i < c.n; i++) {
      rows.push(runOne(c.primary, c.lgE, c.thinning, seedFor(c.primary, c.lgE, i)));
      done++;
    }
    const cellS = (performance.now() - tc) / 1000;
    const xm = rows.map((r) => r.xmax ?? NaN);
    const cell = {
      primary: c.primary,
      lgE: c.lgE,
      thinning: c.thinning,
      n: c.n,
      ghFailures: xm.filter((x) => !Number.isFinite(x)).length,
      cpuS: Math.round(cellS * 10) / 10,
      stats: {
        x1: summarise(rows.map((r) => r.x1)),
        xmax: summarise(xm),
        nmax: summarise(rows.map((r) => r.nmax ?? NaN)),
        nMu: summarise(rows.map((r) => r.nMu)),
        nE: summarise(rows.map((r) => r.nE)),
      },
      showers: rows.map(({ tracked: _t, ...rest }) => rest),
    };
    out.push(cell);
    const xs = cell.stats.xmax;
    const elapsed = (performance.now() - t0) / 1000;
    console.log(`[${done}/${total}] ${c.primary.padEnd(6)} 1e${c.lgE} eV eps=${c.thinning}: ` +
      `<Xmax>=${xs?.mean.toFixed(1)} rms=${xs?.rms.toFixed(1)} <Nmu>=${cell.stats.nMu?.mean.toExponential(2)} ` +
      `cell ${cellS.toFixed(1)} s, total ${(elapsed / 60).toFixed(1)} min`);
  }
  const thinningCheck = [];
  for (const eps of CHECK.eps) {
    const tc = performance.now();
    const rows: ShowerRow[] = [];
    for (let i = 0; i < CHECK.n; i++) rows.push(runOne(CHECK.primary, CHECK.lgE, eps, seedFor(CHECK.primary, CHECK.lgE, i)));
    const cellS = (performance.now() - tc) / 1000;
    const entry = {
      primary: CHECK.primary, lgE: CHECK.lgE, thinning: eps, n: CHECK.n,
      cpuSPerShower: Math.round((cellS / CHECK.n) * 100) / 100,
      xmax: summarise(rows.map((r) => r.xmax ?? NaN)),
      nmax: summarise(rows.map((r) => r.nmax ?? NaN)),
      nMu: summarise(rows.map((r) => r.nMu)),
      nE: summarise(rows.map((r) => r.nE)),
      meanGhLambda: summarise(rows.map((r) => r.ghLambda ?? NaN))?.mean ?? null,
    };
    thinningCheck.push(entry);
    console.log(`[thinning check] eps=${eps}: <Xmax>=${entry.xmax?.mean.toFixed(1)} <Nmax>=${entry.nmax?.mean.toExponential(3)} ` +
      `<Nmu>=${entry.nMu?.mean.toExponential(3)} <Ne>=${entry.nE?.mean.toExponential(3)} ${entry.cpuSPerShower} s/shower`);
  }
  const { recordTracks: _r, maxSegments: _m, primary: _p, energyEV: _e, seed: _s, thinning: _th, ...common } = paramsFor('proton', 15, 1e-4, 0);
  const doc = {
    generated: 'scripts/precompute-validation.ts v1.0',
    date: '2026-11-26',
    totalCpuS: Math.round((performance.now() - t0) / 100) / 10,
    machine: `${cpus().length} logical CPUs, single thread, node ${process.version}; machine shared with other jobs (timings are indicative only)`,
    commonParams: common,
    seedRule: 'seed = 100000*(primaryIndex+1) + 1000*log10(E/eV) + i + 1, primaryIndex: proton 0, iron 1, gamma 2',
    notes: [
      'xmax, nmax, ghX0, ghLambda: Gaisser-Hillas fit (src/physics/fit.ts) to the weighted charged-particle profile, slant depth, 10 g/cm^2 bins.',
      'x1: slant depth of the first interaction (photons: first pair/Compton interaction).',
      'nMu: weighted ground muons above the muon kinetic cut; nE: weighted ground e+ + e- above the EM kinetic cut; nG: ground photons above the photon cut.',
      'rms: sample standard deviation (N-1) of the per-shower values; sem = rms / sqrt(n).',
    ],
    cells: out,
    thinningCheck,
  };
  const file = new URL('../src/data/validation.json', import.meta.url);
  const text = JSON.stringify(doc) + '\n';
  writeFileSync(file, text);
  console.log(`wrote validation.json (${(text.length / 1024).toFixed(1)} KB) in ${(doc.totalCpuS / 60).toFixed(1)} min`);
}

const a = process.argv.slice(2).filter((x) => x !== '--');
if (a[0] === 'probe') probe(a.slice(1));
else full();
