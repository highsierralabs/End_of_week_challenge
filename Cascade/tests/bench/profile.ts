// Print a shower's charged profile next to its GH fit: npx vite-node tests/bench/profile.ts -- iron 15 1e-5 seed
import { simulateShower, DEFAULT_PARAMS } from '../../src/physics/cascade';
import { gaisserHillas } from '../../src/physics/analytic';
import { type Primary } from '../../src/physics/types';
import { TUNE } from '../../src/physics/xsec';
if (process.env.TUNE) Object.assign(TUNE, JSON.parse(process.env.TUNE));
const a = process.argv.slice(2).filter((x) => x !== '--');
const r = simulateShower({ ...DEFAULT_PARAMS, primary: (a[0] ?? 'iron') as Primary, energyEV: 10 ** Number(a[1] ?? 15), zenithDeg: 0, thinning: Number(a[2] ?? 1e-5), seed: Number(a[3] ?? 1), recordTracks: false });
const p = r.profile;
const gh = r.stats.gh;
console.log('X1', r.stats.firstInteractionDepth.toFixed(1), 'gh', JSON.stringify(gh));
for (let i = 0; i < p.bins; i += 5) {
  const X = (i + 0.5) * p.step;
  const f = gh ? gaisserHillas(X, gh.nmax, gh.xmax, gh.x0, gh.lambda) : 0;
  console.log(X.toFixed(0).padStart(5), p.charged[i]!.toExponential(2), f.toExponential(2), 'mu', p.byClass[3]![i]!.toExponential(2), 'h', p.byClass[4]![i]!.toExponential(2));
}
