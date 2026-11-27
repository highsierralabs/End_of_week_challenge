// PURPOSE: Precompute the rate-mode Monte Carlo shipped with the site (src/data/rate_*.json):
//          the muon rain at the observatory depth and at sea level (the PDG anchor).
// USAGE:   npx vite-node scripts/precompute-rate.ts -- <site|sea> <primaries> <seed>
// OUTPUT:  src/data/rate_<site|sea>.json
// VERSION HISTORY:
//   1.0  2026-11-26  Initial release.
import { writeFileSync } from 'node:fs';
import { simulateRate, DEFAULT_RATE } from '../src/physics/rate';

const a = process.argv.slice(2).filter((x) => x !== '--');
const which = a[0] === 'sea' ? 'sea' : 'site';
const primaries = Number(a[1] ?? 200000);
const seed = Number(a[2] ?? 2026);
const r = simulateRate(
  { ...DEFAULT_RATE, primaries, seed, siteAltitudeM: which === 'sea' ? 0 : DEFAULT_RATE.siteAltitudeM },
  (f) => { if (Math.round(f * 1000) % 50 === 0) console.log(`${which} ${(f * 100).toFixed(0)}%`); },
);
const out = new URL(`../src/data/rate_${which}.json`, import.meta.url);
writeFileSync(out, JSON.stringify({ generated: 'scripts/precompute-rate.ts v1.0', ...r, cpuMs: Math.round(r.cpuMs) }, null, 1) + '\n');
console.log(`wrote rate_${which}.json in ${(r.cpuMs / 1000).toFixed(0)} s`);
