// npx vite-node tests/bench/rate.ts -- <primaries> [eMin] [siteAlt]
import { simulateRate, DEFAULT_RATE } from '../../src/physics/rate';
const a = process.argv.slice(2).filter((x) => x !== '--');
const r = simulateRate({ ...DEFAULT_RATE, primaries: Number(a[0] ?? 5000), eMinGeV: Number(a[1] ?? DEFAULT_RATE.eMinGeV), siteAltitudeM: Number(a[2] ?? 1539) });
const p = r.planes[1]!;
console.log('alt', p.altitudeM.toFixed(0), 'X', p.depth.toFixed(1), 'muons', p.muons, 'Fh', (p.horizontalFlux*60).toFixed(3), '/cm2/min', 'Fh1', (p.horizontalFlux1GeV*60).toFixed(3), 'Iv1 (m-2s-1sr-1)', (p.verticalIntensity1GeV*1e4).toFixed(1), 'bare', p.crystalBare.toFixed(4), 'shield', p.crystalShielded.toFixed(4), '+-', (p.crystalShieldedRelErr*100).toFixed(1)+'%', 'baro', r.barometricPctPerHPa.toFixed(3), '+-', r.barometricErr.toFixed(3), 'ms', r.cpuMs.toFixed(0));
