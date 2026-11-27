// A simplified fluorescence detector (FD) looking at the shower from the side, after the
// Pierre Auger Observatory's eyes (440 hexagonal 1.5 degree pixels, a 30 x 30 degree field of
// view, ~3.8 m^2 effective aperture after the corrector ring). Pure and deterministic: no DOM,
// no three, no randomness.
//
// Light model (every number is a stated simplification, see FD_MODEL):
//  - The longitudinal profile r.profile.charged (weighted charged particles crossing each slant
//    depth) is the light source, placed as a point on the shower axis at that depth: slant
//    depth -> vertical depth (x cos zenith, the flat-Earth geometry of docs/physics.md) ->
//    altitude (Linsley atmosphere) -> point on the axis through the core.
//  - Energy deposit dE = N(X) * 2.2 MeV/(g/cm^2) * dX, using the charged count (muons and
//    hadrons included, a slight overestimate of the deposit; the ionisation of electrons below
//    the tracking cut is not added back, an underestimate).
//  - Fluorescence yield 20 photons per MeV deposited over 300-420 nm, emitted isotropically: the
//    337 nm band alone is ~5.6 photons/MeV (AIRFLY) and carries roughly a quarter of the band.
//    Approximate (good to tens of percent); no pressure, temperature or humidity dependence.
//  - Photons reaching the aperture: Y dE A / (4 pi d^2) * exp(-d / 18 km). The exponential is a
//    single Rayleigh-like attenuation length; aerosols, its altitude dependence and the
//    wavelength dependence are not modelled.
//  - Times: the light is emitted when a plane front moving at c along the axis passes the point,
//    t_emit = tCore - (distance from the core along the axis) / c, and arrives at t_emit + d / c.
//  - Not modelled: direct and scattered Cherenkov light (the main background of real FD
//    reconstructions, strong when the axis points near the telescope), the lateral width of the
//    shower, multiple scattering of the light, the mirror and camera optics, night-sky background
//    and electronics. A real FD runs only on clear, moonless nights: a duty cycle of ~15 %.
import { altitudeAtDepth } from './atmosphere';
import { C_M_PER_NS } from './constants';
import type { ShowerResult } from './types';

export const FD_MODEL = {
  /** Mean ionisation deposit per charged particle, MeV per g/cm^2. */
  dedxMeV: 2.2,
  /** Fluorescence photons per MeV deposited, 300-420 nm (approximate; see the header note). */
  yieldPerMeV: 20,
  /** Rayleigh-like attenuation length of the light, m. */
  attenuationM: 18000,
  /** FADC-like trace bin, ns (Auger FD: 100 ns). */
  timeBinNs: 100,
  /** Default distance from the core to the eye, m. */
  distanceM: 18000,
  /** Eye altitude above sea level, m. */
  altitudeM: 1700,
  fovDeg: 30,
  pixelDeg: 1.5,
  /** Effective light-collecting area, m^2 (Auger: ~3.8 m^2 after the corrector, less shadowing). */
  apertureM2: 3,
} as const;

export interface Telescope {
  /** Position in the physics frame, m (x east, y north, z altitude). */
  x: number;
  y: number;
  z: number;
  /** Pointing direction: azimuth clockwise from north, elevation above the horizon, degrees. */
  azimuthDeg: number;
  elevationDeg: number;
  /** Full width of the (square) field of view, degrees. */
  fovDeg: number;
  /** Pixel pitch (hexagon flat-to-flat), degrees. */
  pixelDeg: number;
  apertureM2: number;
}

export interface FdOptions {
  yieldPerMeV?: number;
  dedxMeV?: number;
  /** Attenuation length, m; Infinity switches the transmission off. */
  attenuationM?: number;
  timeBinNs?: number;
}

export interface FdPixel {
  /** Column index (0 = left edge of the camera). */
  u: number;
  /** Row index (0 = bottom row). */
  v: number;
  /** Pixel centre in camera coordinates, degrees: [right of the pointing, above the pointing]. */
  centre: [number, number];
}

export interface FdTrackPoint {
  /** Arrival time at the telescope, ns (shower clock). */
  t: number;
  /** Emission time on the axis, ns. */
  tEmit: number;
  /** Camera coordinates, degrees (may lie outside the field of view). */
  u: number;
  v: number;
  /** Photons at the aperture from this stretch of the axis. */
  photons: number;
  /** Slant depth of the emission point, g/cm^2. */
  X: number;
  /** Altitude of the emission point, m. */
  z: number;
  /** Distance from the telescope, m. */
  d: number;
  /** Index of the pixel the light falls in, or -1 outside the camera. */
  pixel: number;
}

export interface FdView {
  telescope: Telescope;
  nCols: number;
  nRows: number;
  pixels: FdPixel[];
  /** Photons at the aperture per pixel, integrated over time. */
  photons: Float64Array;
  /** Photons per time bin per pixel: traces[pixel * nBins + bin]. */
  traces: Float32Array;
  timeBinNs: number;
  /** Start of bin 0, ns on the shower clock (arrival time at the telescope). */
  t0: number;
  nBins: number;
  /** The light spot vs arrival time, in emission order (also arrival order, see the tests). */
  track: FdTrackPoint[];
  geometry: {
    distanceToCoreKm: number;
    /** Impact parameter: closest distance of the axis to the telescope. */
    rpKm: number;
    /** Angle of the axis to the ground line in the shower-detector plane. */
    chiDeg: number;
  };
  /** All photons reaching the aperture, inside the field of view or not. */
  totalPhotons: number;
  /** Photons falling on the camera's pixels. */
  cameraPhotons: number;
  /** Energy deposited along the visible profile, eV (a sanity check against E0). */
  depositEV: number;
  /** Time the spot spends on the camera, ns (0 when it never enters). */
  crossingNs: number;
  /** First and last arrival on the camera, ns (NaN when the camera stays dark). */
  tFirst: number;
  tLast: number;
  /** Light-travel time from the brightest point of the axis to the eye, ns. */
  lightDelayNs: number;
}

// ------------------------------------------------------------------ geometry helpers

type V3 = [number, number, number];

function unitAxis(r: ShowerResult): V3 {
  const [ax, ay, az] = r.stats.axis ?? [0, 0, -1];
  const len = Math.hypot(ax, ay, az);
  if (len > 0 && Number.isFinite(len) && az < 0) return [ax / len, ay / len, az / len];
  const th = (r.params.zenithDeg * Math.PI) / 180;
  const ph = (r.params.azimuthDeg * Math.PI) / 180;
  return [-Math.sin(th) * Math.sin(ph), -Math.sin(th) * Math.cos(ph), -Math.cos(th)];
}

function cosZenith(a: V3): number {
  return Math.max(0.05, -a[2]);
}

/** Point on the axis at slant depth X, with its distance s from the core back up the axis. Null below ground. */
function axisPoint(r: ShowerResult, a: V3, X: number): { p: V3; s: number } | null {
  const cosT = cosZenith(a);
  const zg = r.params.groundAltitudeM;
  const z = altitudeAtDepth(Math.max(0, X) * cosT);
  if (!(z >= zg)) return null;
  const s = (z - zg) / cosT;
  return { p: [r.params.coreX - a[0] * s, r.params.coreY - a[1] * s, zg - a[2] * s], s };
}

function azEl(from: V3, to: V3): { az: number; el: number } {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  return { az: (Math.atan2(dx, dy) * 180) / Math.PI, el: (Math.atan2(dz, Math.hypot(dx, dy)) * 180) / Math.PI };
}

/** Slant depth of the brightest part of the profile: the Gaisser-Hillas Xmax, else the peak bin, clipped to the ground. */
export function peakDepth(r: ShowerResult): number {
  const P = r.profile;
  const ground = groundDepth(r);
  const gh = r.stats.gh;
  if (gh && Number.isFinite(gh.xmax) && gh.xmax > 0) return Math.min(gh.xmax, ground);
  let best = -1;
  let bi = -1;
  for (let i = 0; i < P.bins; i++) {
    const v = P.charged[i] ?? 0;
    if ((i + 0.5) * P.step <= ground && v > best) { best = v; bi = i; }
  }
  return bi >= 0 ? (bi + 0.5) * P.step : ground * 0.7;
}

function groundDepth(r: ShowerResult): number {
  const g = r.stats.groundSlantDepth;
  if (Number.isFinite(g) && g > 0) return g;
  return r.profile.bins * r.profile.step;
}

/**
 * Place an eye `distanceM` from the core, on the horizontal line perpendicular to the axis's
 * horizontal direction (so the track sweeps across the camera), at 1700 m, aimed at the axis
 * between Xmax and the ground. When that stretch fits in the field of view, the camera's lower
 * edge sits just below the ground end of the track, as Auger's cameras look from ~1.5 degrees up.
 */
export function placeTelescope(r: ShowerResult, distanceM: number = FD_MODEL.distanceM): Telescope {
  const a = unitAxis(r);
  let hx = a[0];
  let hy = a[1];
  const hl = Math.hypot(hx, hy);
  if (hl < 1e-6) {
    // vertical shower: use the arrival azimuth for a reproducible side
    const ph = (r.params.azimuthDeg * Math.PI) / 180;
    hx = -Math.sin(ph);
    hy = -Math.cos(ph);
  } else {
    hx /= hl;
    hy /= hl;
  }
  // to the left of the direction of motion
  const T: V3 = [r.params.coreX - hy * distanceM, r.params.coreY + hx * distanceM, FD_MODEL.altitudeM];
  const core: V3 = [r.params.coreX, r.params.coreY, r.params.groundAltitudeM];
  const pk = axisPoint(r, a, peakDepth(r))?.p ?? core;
  const lo = azEl(T, core);
  const hi = azEl(T, pk);
  const fov = FD_MODEL.fovDeg;
  const margin = 1.5;
  const el = hi.el - lo.el <= fov - 2 * margin ? lo.el - margin + fov / 2 : (lo.el + hi.el) / 2;
  // azimuth: centre the part of the track inside that elevation band (it is tilted when the
  // shower is inclined), measured relative to the direction of the core
  const wrap = (d: number): number => ((d + 540) % 360) - 180;
  let uMin = 0;
  let uMax = 0;
  const top = Math.max(0, Math.min(r.stats.firstInteractionDepth || 0, groundDepth(r)));
  for (let k = 0; k <= 200; k++) {
    const X = groundDepth(r) - ((groundDepth(r) - top) * k) / 200;
    const q = axisPoint(r, a, X);
    if (!q) continue;
    const ae = azEl(T, q.p);
    if (ae.el > el + fov / 2 - margin) break;
    if (ae.el < el - fov / 2) continue;
    const du = wrap(ae.az - lo.az);
    uMin = Math.min(uMin, du);
    uMax = Math.max(uMax, du);
  }
  // a track wider than the camera (inclined showers): keep the stretch from Xmax to the ground
  if (uMax - uMin > fov - 2 * margin) {
    const uPk = wrap(hi.az - lo.az);
    uMin = Math.min(0, uPk);
    uMax = Math.max(0, uPk);
  }
  const az = lo.az + (uMin + uMax) / 2;
  return {
    x: T[0], y: T[1], z: T[2],
    azimuthDeg: (az + 360) % 360,
    elevationDeg: el,
    fovDeg: fov,
    pixelDeg: FD_MODEL.pixelDeg,
    apertureM2: FD_MODEL.apertureM2,
  };
}

// ------------------------------------------------------------------ camera

export interface Camera {
  nCols: number;
  nRows: number;
  pitchV: number;
  pixels: FdPixel[];
  /** Camera coordinates (degrees) of a unit direction. */
  project(dx: number, dy: number, dz: number): [number, number];
  /** Pixel index at camera coordinates, or -1 outside the camera. */
  pixelAt(u: number, v: number): number;
}

/**
 * A hexagonal camera: rows of pointy-top hexagons `pixelDeg` apart, alternate rows shifted by
 * half a pixel. With 30 degrees and 1.5 degree pixels this is 20 columns x 22 rows = 440 pixels,
 * Auger's layout.
 */
export function makeCamera(tel: Telescope): Camera {
  const pd = tel.pixelDeg;
  const pitchV = (pd * Math.sqrt(3)) / 2;
  const nCols = Math.max(1, Math.round(tel.fovDeg / pd));
  const nRows = Math.max(1, Math.floor((tel.fovDeg - pd / 2) / pitchV));
  const pixels: FdPixel[] = [];
  const colOff = (row: number): number => (row % 2 === 1 ? 0.25 : -0.25);
  for (let row = 0; row < nRows; row++) {
    for (let col = 0; col < nCols; col++) {
      pixels.push({ u: col, v: row, centre: [(col - (nCols - 1) / 2 + colOff(row)) * pd, (row - (nRows - 1) / 2) * pitchV] });
    }
  }
  const az = (tel.azimuthDeg * Math.PI) / 180;
  const el = (tel.elevationDeg * Math.PI) / 180;
  const f: V3 = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  const rt: V3 = [Math.cos(az), -Math.sin(az), 0];
  const up: V3 = [-Math.sin(el) * Math.sin(az), -Math.sin(el) * Math.cos(az), Math.cos(el)];
  const D = 180 / Math.PI;
  const inr = pd / 2;
  return {
    nCols, nRows, pitchV, pixels,
    project(dx, dy, dz) {
      const df = dx * f[0] + dy * f[1] + dz * f[2];
      const dr = dx * rt[0] + dy * rt[1];
      const du = dx * up[0] + dy * up[1] + dz * up[2];
      return [Math.atan2(dr, df) * D, Math.asin(Math.max(-1, Math.min(1, du))) * D];
    },
    pixelAt(u, v) {
      if (!Number.isFinite(u) || !Number.isFinite(v)) return -1;
      const r0 = Math.round(v / pitchV + (nRows - 1) / 2);
      let best = -1;
      let bd = Infinity;
      for (let row = r0 - 1; row <= r0 + 1; row++) {
        if (row < 0 || row >= nRows) continue;
        const c0 = Math.round(u / pd + (nCols - 1) / 2 - colOff(row));
        for (let col = c0 - 1; col <= c0 + 1; col++) {
          if (col < 0 || col >= nCols) continue;
          const [cu, cv] = pixels[row * nCols + col]!.centre;
          const dd = (u - cu) ** 2 + (v - cv) ** 2;
          if (dd < bd) { bd = dd; best = row * nCols + col; }
        }
      }
      if (best < 0) return -1;
      // the nearest centre is the hexagonal cell, except past the camera's outer edge
      const [cu, cv] = pixels[best]!.centre;
      const ax = Math.abs(u - cu);
      const ay = Math.abs(v - cv);
      return ax <= inr * 1.0001 && ax * 0.5 + ay * (Math.sqrt(3) / 2) <= inr * 1.0001 ? best : -1;
    },
  };
}

// ------------------------------------------------------------------ the light

const MAX_BINS = 6000;
/** Sub-steps keep each piece of the track under these limits, so the spot moves smoothly. */
const SUB_DEG = 0.1;
const SUB_NS = 10;
const MAX_SUB = 1024;

export function computeFdView(r: ShowerResult, tel: Telescope, opts: FdOptions = {}): FdView {
  const Y = opts.yieldPerMeV ?? FD_MODEL.yieldPerMeV;
  const dedx = opts.dedxMeV ?? FD_MODEL.dedxMeV;
  const L = opts.attenuationM ?? FD_MODEL.attenuationM;
  const binNs = opts.timeBinNs ?? FD_MODEL.timeBinNs;
  const cam = makeCamera(tel);
  const nPix = cam.pixels.length;
  const a = unitAxis(r);
  const T: V3 = [tel.x, tel.y, tel.z];
  const core: V3 = [r.params.coreX, r.params.coreY, r.params.groundAltitudeM];
  const tCore = Number.isFinite(r.stats.tCore) ? r.stats.tCore : 0;
  const P = r.profile;
  const ground = groundDepth(r);
  const geom = (X: number): { t: number; tEmit: number; u: number; v: number; d: number; z: number } | null => {
    const q = axisPoint(r, a, X);
    if (!q) return null;
    const dx = q.p[0] - T[0];
    const dy = q.p[1] - T[1];
    const dz = q.p[2] - T[2];
    const d = Math.max(1, Math.hypot(dx, dy, dz));
    const [u, v] = cam.project(dx / d, dy / d, dz / d);
    const tEmit = tCore - q.s / C_M_PER_NS;
    return { t: tEmit + d / C_M_PER_NS, tEmit, u, v, d, z: q.p[2] };
  };
  // the profile, linearly interpolated between bin centres (counts are per crossing plane)
  const nAt = (X: number): number => {
    const f = X / P.step - 0.5;
    const i = Math.floor(f);
    const w = f - i;
    const n0 = i >= 0 && i < P.bins ? (P.charged[i] ?? 0) : 0;
    const n1 = i + 1 >= 0 && i + 1 < P.bins ? (P.charged[i + 1] ?? 0) : 0;
    if (i < 0) return n1;
    if (i + 1 >= P.bins) return n0;
    return n0 + (n1 - n0) * w;
  };

  const track: FdTrackPoint[] = [];
  let totalPhotons = 0;
  let depositMeV = 0;
  const xEnd = Math.min(ground, P.bins * P.step);
  for (let i = 0; i < P.bins; i++) {
    const xa = i * P.step;
    if (xa >= xEnd) break;
    const xb = Math.min((i + 1) * P.step, xEnd);
    const ga = geom(xa);
    const gb = geom(xb);
    if (!ga || !gb) continue;
    const ang = Math.hypot(gb.u - ga.u, gb.v - ga.v);
    const dt = Math.abs(gb.t - ga.t);
    const nSub = Math.max(1, Math.min(MAX_SUB, Math.ceil(Math.max(ang / SUB_DEG, dt / SUB_NS))));
    const dX = (xb - xa) / nSub;
    for (let k = 0; k < nSub; k++) {
      const X = xa + (k + 0.5) * dX;
      const g = geom(X);
      if (!g) continue;
      const N = Math.max(0, nAt(X));
      const dE = N * dedx * dX;
      const trans = Number.isFinite(L) ? Math.exp(-g.d / L) : 1;
      const ph = Y * dE * tel.apertureM2 / (4 * Math.PI * g.d * g.d) * trans;
      depositMeV += dE;
      totalPhotons += ph;
      track.push({ t: g.t, tEmit: g.tEmit, u: g.u, v: g.v, photons: ph, X, z: g.z, d: g.d, pixel: cam.pixelAt(g.u, g.v) });
    }
  }

  // the camera's time window
  let tFirst = Infinity;
  let tLast = -Infinity;
  for (const p of track) {
    if (p.pixel < 0) continue;
    if (p.t < tFirst) tFirst = p.t;
    if (p.t > tLast) tLast = p.t;
  }
  const lit = tFirst <= tLast;
  const t0 = lit ? Math.floor(tFirst / binNs) * binNs : 0;
  const nBins = lit ? Math.max(1, Math.min(MAX_BINS, Math.floor((tLast - t0) / binNs) + 1)) : 1;
  const photons = new Float64Array(nPix);
  const traces = new Float32Array(nPix * nBins);
  let cameraPhotons = 0;
  for (const p of track) {
    if (p.pixel < 0) continue;
    photons[p.pixel]! += p.photons;
    cameraPhotons += p.photons;
    const b = Math.max(0, Math.min(nBins - 1, Math.floor((p.t - t0) / binNs)));
    traces[p.pixel * nBins + b]! += p.photons;
  }

  // geometry
  const tc: V3 = [core[0] - T[0], core[1] - T[1], core[2] - T[2]];
  const dCore = Math.hypot(tc[0], tc[1], tc[2]);
  // |(C - T) x a|
  const cx = tc[1] * a[2] - tc[2] * a[1];
  const cy = tc[2] * a[0] - tc[0] * a[2];
  const cz = tc[0] * a[1] - tc[1] * a[0];
  const rp = Math.hypot(cx, cy, cz);
  // chi0: angle between the ground line (eye -> core) and the axis pointing back up to the sky
  const cosChi = dCore > 0 ? -(tc[0] * a[0] + tc[1] * a[1] + tc[2] * a[2]) / dCore : 0;
  const chi = (Math.acos(Math.max(-1, Math.min(1, cosChi))) * 180) / Math.PI;

  const pk = geom(Math.min(peakDepth(r), ground));
  return {
    telescope: tel,
    nCols: cam.nCols,
    nRows: cam.nRows,
    pixels: cam.pixels,
    photons,
    traces,
    timeBinNs: binNs,
    t0,
    nBins,
    track,
    geometry: { distanceToCoreKm: dCore / 1000, rpKm: rp / 1000, chiDeg: chi },
    totalPhotons,
    cameraPhotons,
    depositEV: depositMeV * 1e6,
    crossingNs: lit ? tLast - tFirst : 0,
    tFirst: lit ? tFirst : NaN,
    tLast: lit ? tLast : NaN,
    lightDelayNs: (pk?.d ?? dCore) / C_M_PER_NS,
  };
}

/**
 * Where the spot is at arrival time t (linear interpolation along the track), or null before the
 * first light and after the last.
 */
export function spotAt(view: FdView, t: number): { u: number; v: number } | null {
  const tr = view.track;
  if (tr.length === 0 || !(t >= tr[0]!.t) || t > tr[tr.length - 1]!.t) return null;
  let lo = 0;
  let hi = tr.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (tr[m]!.t <= t) lo = m;
    else hi = m;
  }
  const A = tr[lo]!;
  const B = tr[hi]!;
  const f = B.t > A.t ? (t - A.t) / (B.t - A.t) : 0;
  return { u: A.u + (B.u - A.u) * f, v: A.v + (B.v - A.v) * f };
}
