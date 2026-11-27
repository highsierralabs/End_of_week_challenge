// Ad-hoc benchmark / calibration driver: npx vite-node tests/bench/run.ts -- <primary> <log10E> <n> [thin]
import { simulateShower, DEFAULT_PARAMS } from '../../src/physics/cascade';
import { muonNumberMatthews, xmaxNucleusMatthews } from '../../src/physics/analytic';
import { PRIMARY_MASS_NUMBER, type Primary } from '../../src/physics/types';
import { TUNE } from '../../src/physics/xsec';
if (process.env.TUNE) Object.assign(TUNE, JSON.parse(process.env.TUNE));
const quiet = !!process.env.QUIET;

const args = process.argv.slice(2).filter((a) => a !== '--');
const primary = (args[0] ?? 'proton') as Primary;
const lg = Number(args[1] ?? 15);
const n = Number(args[2] ?? 3);
const thin = Number(args[3] ?? 1e-5);
const xs: number[] = [];
const mus: number[] = [];
for (let i = 0; i < n; i++) {
  const r = simulateShower({ ...DEFAULT_PARAMS, primary, energyEV: 10 ** lg, zenithDeg: 0, seed: Number(process.env.SEED0 ?? 100) + i, thinning: thin, recordTracks: i === 0 });
  const s = r.stats;
  xs.push(s.gh?.xmax ?? NaN);
  mus.push(s.groundCounts[3]!);
  if (!quiet) console.log(
    `seed ${i}: X1=${s.firstInteractionDepth.toFixed(1)} Xmax=${s.gh?.xmax.toFixed(1)} Nmax=${s.gh?.nmax.toExponential(2)} ` +
      `lam=${s.gh?.lambda.toFixed(1)} gnd[g,e-,e+,mu,h]=${s.groundCounts.map((c) => c.toExponential(2)).join(',')} ` +
      `tracked=${s.particlesTracked} segs=${r.segmentCount} gnd=${r.groundCount} trunc=${s.truncated} ms=${s.cpuMs.toFixed(0)}`,
  );
}
const mean = (a: number[]): number => a.reduce((p, c) => p + c, 0) / a.length;
const E0 = 10 ** (lg - 9);
const sd = Math.sqrt(mean(xs.map((v) => (v - mean(xs)) ** 2)));
console.log(`${JSON.stringify(TUNE)} ${primary} 1e${lg} sd ${sd.toFixed(0)} mean Xmax ${mean(xs).toFixed(1)} (Matthews ${xmaxNucleusMatthews(E0, Math.max(1, PRIMARY_MASS_NUMBER[primary])).toFixed(1)}), mean Nmu ${mean(mus).toExponential(2)} (Matthews ${muonNumberMatthews(E0, Math.max(1, PRIMARY_MASS_NUMBER[primary])).toExponential(2)})`);
