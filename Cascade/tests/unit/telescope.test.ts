import { describe, expect, it } from 'vitest';
import { simulateShower, DEFAULT_PARAMS } from '../../src/physics/cascade';
import { computeFdView, makeCamera, placeTelescope, spotAt, type Telescope } from '../../src/physics/telescope';
import type { ShowerParams, ShowerResult } from '../../src/physics/types';

const base: ShowerParams = { ...DEFAULT_PARAMS, recordTracks: false, thinning: 1e-4, coreX: 0, coreY: 0, seed: 3 };
const C = 0.299792458;

const cache = new Map<string, ShowerResult>();
function shower(p: Partial<ShowerParams>): ShowerResult {
  const key = JSON.stringify(p);
  let r = cache.get(key);
  if (!r) { r = simulateShower({ ...base, ...p }); cache.set(key, r); }
  return r;
}

/** The same eye moved k times farther from the core along the same horizontal line. */
function farther(r: ShowerResult, tel: Telescope, k: number): Telescope {
  const cx = r.params.coreX;
  const cy = r.params.coreY;
  return { ...tel, x: cx + (tel.x - cx) * k, y: cy + (tel.y - cy) * k };
}

describe('fluorescence telescope', () => {
  it('builds an Auger-like 440-pixel hexagonal camera whose cells tile the field of view', () => {
    const tel: Telescope = { x: 0, y: 0, z: 0, azimuthDeg: 0, elevationDeg: 15, fovDeg: 30, pixelDeg: 1.5, apertureM2: 3 };
    const cam = makeCamera(tel);
    expect(cam.pixels.length).toBe(440);
    for (const p of cam.pixels) expect(cam.pixelAt(p.centre[0], p.centre[1])).toBe(p.v * cam.nCols + p.u);
    expect(cam.pixelAt(40, 0)).toBe(-1);
    // straight ahead projects to the camera centre
    const [u, v] = cam.project(0, Math.cos((15 * Math.PI) / 180), Math.sin((15 * Math.PI) / 180));
    expect(Math.abs(u)).toBeLessThan(1e-9);
    expect(Math.abs(v)).toBeLessThan(1e-9);
  });

  it('photons scale roughly linearly with the primary energy (1e17 vs 1e18 eV)', () => {
    const a = shower({ energyEV: 1e17, zenithDeg: 20 });
    const b = shower({ energyEV: 1e18, zenithDeg: 20 });
    const va = computeFdView(a, placeTelescope(a));
    const vb = computeFdView(b, placeTelescope(b));
    const ratio = vb.totalPhotons / va.totalPhotons;
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(20);
    // the deposit is a sizeable fraction of E0, never more than E0
    expect(va.depositEV / 1e17).toBeGreaterThan(0.3);
    expect(va.depositEV / 1e17).toBeLessThan(1.05);
  });

  it('follows the inverse-square law times the transmission', () => {
    const r = shower({ energyEV: 1e17, zenithDeg: 20 });
    const t1 = placeTelescope(r);
    const t2 = farther(r, t1, 2);
    const noAtt = { attenuationM: Infinity };
    const q = computeFdView(r, t1, noAtt).totalPhotons / computeFdView(r, t2, noAtt).totalPhotons;
    expect(q).toBeGreaterThan(3.6);
    expect(q).toBeLessThan(4.1);
    const v1 = computeFdView(r, t1);
    const v2 = computeFdView(r, t2);
    // the extra ~18 km of air costs exp(-18/18) on top of the 1/4
    const extra = (v2.lightDelayNs - v1.lightDelayNs) * C;
    const expected = 4 * Math.exp(extra / 18000);
    expect((v1.totalPhotons / v2.totalPhotons) / expected).toBeGreaterThan(0.9);
    expect((v1.totalPhotons / v2.totalPhotons) / expected).toBeLessThan(1.1);
  });

  it('the spot moves monotonically down the camera for a downward shower seen from the side', () => {
    const r = shower({ energyEV: 1e17, zenithDeg: 30 });
    const v = computeFdView(r, placeTelescope(r));
    const tr = v.track;
    expect(tr.length).toBeGreaterThan(50);
    for (let i = 1; i < tr.length; i++) {
      expect(tr[i]!.t).toBeGreaterThanOrEqual(tr[i - 1]!.t);
      expect(tr[i]!.v).toBeLessThanOrEqual(tr[i - 1]!.v + 1e-9);
    }
    expect(tr[0]!.v - tr[tr.length - 1]!.v).toBeGreaterThan(10);
    // it crosses the camera in microseconds, as real FD tracks do
    expect(v.crossingNs).toBeGreaterThan(3000);
    expect(v.crossingNs).toBeLessThan(100000);
    const mid = spotAt(v, (v.tFirst + v.tLast) / 2);
    expect(mid).not.toBeNull();
  });

  it('arrival times are causal and follow the shower-detector-plane timing law', () => {
    const r = shower({ energyEV: 1e17, zenithDeg: 30 });
    const tel = placeTelescope(r);
    const v = computeFdView(r, tel);
    const T = [tel.x, tel.y, tel.z];
    const core = [r.params.coreX, r.params.coreY, r.params.groundAltitudeM];
    const g = core.map((c, i) => c - T[i]!);
    const gl = Math.hypot(g[0]!, g[1]!, g[2]!);
    const chi0 = (v.geometry.chiDeg * Math.PI) / 180;
    const rp = v.geometry.rpKm * 1000;
    const tCoreEye = r.stats.tCore + gl / C;
    for (const p of v.track) {
      expect(p.t).toBeGreaterThan(p.tEmit);
      expect(p.t - p.tEmit).toBeCloseTo(p.d / C, 6);
    }
    // t_i = T0 + Rp/c tan((chi0 - chi_i)/2), with chi_i the angle from the ground line;
    // check through the light from the core itself at chi = 0
    const T0 = tCoreEye - (rp / C) * Math.tan(chi0 / 2);
    const last = v.track[v.track.length - 1]!;
    // the last sample is within one sub-step of the ground: its angle from the ground line
    const P = [0, 0, 0];
    // reconstruct the emission point from the distance travelled up the axis
    const s = (r.stats.tCore - last.tEmit) * C;
    const a = r.stats.axis;
    for (let i = 0; i < 3; i++) P[i] = core[i]! - a[i]! * s;
    const w = P.map((x, i) => x - T[i]!);
    const chi = Math.acos((w[0]! * g[0]! + w[1]! * g[1]! + w[2]! * g[2]!) / (Math.hypot(w[0]!, w[1]!, w[2]!) * gl));
    expect(last.t).toBeCloseTo(T0 + (rp / C) * Math.tan((chi0 - chi) / 2), 3);
  });

  it('is deterministic and survives degenerate showers', () => {
    const r = shower({ energyEV: 1e17, zenithDeg: 20 });
    const a = computeFdView(r, placeTelescope(r));
    const b = computeFdView(r, placeTelescope(r));
    expect(a.totalPhotons).toBe(b.totalPhotons);
    expect(Array.from(a.traces.slice(0, 2000))).toEqual(Array.from(b.traces.slice(0, 2000)));
    for (const p of [
      { primary: 'gamma' as const, energyEV: 1e14, zenithDeg: 0 },
      { primary: 'proton' as const, energyEV: 1e12, zenithDeg: 0 },
      { primary: 'iron' as const, energyEV: 1e15, zenithDeg: 65 },
    ]) {
      const rr = shower(p);
      const v = computeFdView(rr, placeTelescope(rr));
      expect(Number.isFinite(v.totalPhotons)).toBe(true);
      expect(v.nBins).toBeGreaterThanOrEqual(1);
      expect(v.traces.length).toBe(v.nBins * v.pixels.length);
    }
    // an empty profile
    const empty: ShowerResult = {
      ...r,
      profile: { step: 10, bins: 0, byClass: [], charged: new Float64Array(0) },
      stats: { ...r.stats, gh: null, tCore: NaN, axis: [0, 0, 0] },
    };
    const v = computeFdView(empty, placeTelescope(empty));
    expect(v.totalPhotons).toBe(0);
    expect(v.crossingNs).toBe(0);
    expect(spotAt(v, 0)).toBeNull();
  });
});
