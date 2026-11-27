// The air-shower Monte Carlo. One call simulates one shower, particle by
// particle, depth-first from a stack. Pure and deterministic for a given seed.
//
// Physics in brief (detail and sources in docs/physics.md):
//  - hadrons: energy-dependent inelastic cross sections, leading particle with
//    inelasticity K ~ U(0.3, 0.8), pions with UA5-style multiplicity scaled to an air
//    target, Dirichlet energy sharing, exponential-like p_T; nuclei by
//    semi-superposition (wounded nucleons interact, spectators fly on)
//  - decays: pi0 -> 2 gamma at once, pi+- -> mu nu and mu -> e nu nu in flight
//    with exact two-body kinematics and the Michel spectrum
//  - muons: continuous ionisation + radiative loss, Highland scattering
//  - e+-: discrete Bethe-Heitler bremsstrahlung above the photon cut,
//    continuous ionisation, Highland scattering with the correlated lateral step
//  - photons: pair production (complete screening, XCOM-scaled near threshold)
//    and Klein-Nishina Compton scattering
//  - Hillas thinning with separate EM / hadronic weight limits

import { altitudeAtDepth, density, verticalDepth } from './atmosphere';
import {
  B_MU_AIR, C_M_PER_NS, CTAU_MU, CTAU_PI, DEDX_E, DEDX_MU, M_E, M_MU, M_N, M_NUCLEON, M_P, M_PI, M_PI0, X0, massOf,
} from './constants';
import { fitGaisserHillas } from './fit';
import { boostPair, deflect, twoBodyDecay, type Daughter, type Vec3 } from './kinematics';
import { Rng } from './rng';
import {
  PRIMARY_MASS_NUMBER, PType, RClass, RCLASS_COUNT, SEG_STRIDE, GND_STRIDE, renderClass,
  type LongitudinalProfile, type ShowerParams, type ShowerResult,
} from './types';
import {
  bremPerX0, chargedMultiplicity, highlandTheta0, rossiTheta0, lambdaFromSigma, muCompton, muPair, sampleBremFraction,
  sampleCompton, samplePairFraction, sigmaNucleusAir, sigmaPionAir, sigmaProtonAir, TUNE,
} from './xsec';

export const DEFAULT_PARAMS: ShowerParams = {
  primary: 'proton',
  energyEV: 1e15,
  zenithDeg: 20,
  azimuthDeg: 210,
  seed: 1,
  thinning: 1e-5,
  emCutMeV: 1,
  muonCutMeV: 10,
  hadronCutGeV: 0.3,
  trackEm: true,
  maxSegments: 600_000,
  coreX: 40,
  coreY: 25,
  groundAltitudeM: 1539,
  recordTracks: true,
};

const PROFILE_STEP = 10;
export const WEIGHT_FACTOR = 100;
/** Proper time is stored in ns. */
const TAU_PI_NS = CTAU_PI / C_M_PER_NS;
const TAU_MU_NS = CTAU_MU / C_M_PER_NS;
const IMPORTANT_LEVEL = 255;
const MAX_GROUND = 1_500_000;

/** A particle on the stack or in flight. */
interface Particle {
  type: PType;
  /** Total energy, GeV. */
  E: number;
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;
  t: number;
  w: number;
  A: number;
  /** Remaining proper time before decay, ns (NaN = not yet sampled / stable). */
  tau: number;
  /** Track-recording level (uniform particle-level decimation). */
  level: number;
}

function blank(): Particle {
  return { type: PType.PROTON, E: 0, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: -1, t: 0, w: 1, A: 1, tau: NaN, level: 0 };
}

export type ProgressFn = (fraction: number, tracked: number) => void;

export function simulateShower(params: ShowerParams, onProgress?: ProgressFn): ShowerResult {
  return new Cascade(params).run(onProgress);
}

class Cascade {
  readonly p: ShowerParams;
  readonly rng: Rng;
  readonly E0: number;
  readonly zg: number;
  readonly XvGround: number;
  readonly cosAxis: number;
  readonly axis: Vec3;
  readonly eCutE: number;
  readonly eCutG: number;
  readonly muCut: number;
  readonly hadCut: number;
  readonly eThin: number;
  readonly wMaxEm: number;
  readonly wMaxHad: number;
  readonly importantE: number;

  // stack (array of pooled particle objects)
  private stack: Particle[] = [];
  private sp = 0;
  private cur: Particle = blank();

  // segments with per-segment level for decimation
  private seg: Float32Array;
  private segLevel: Uint8Array;
  private segN = 0;
  private curLevel = 0;
  private truncated = false;

  private gnd: Float32Array;
  private gndN = 0;
  readonly groundCounts = new Array<number>(RCLASS_COUNT).fill(0);

  readonly profile: LongitudinalProfile;

  private tracked = 0;
  private interactions = 0;
  private firstDepth = NaN;
  private tFirst = NaN;
  private primaryFirstStep = true;
  private hit = false;
  private escaped = false;
  private tMin = Infinity;
  private tMax = -Infinity;
  private startPoint: [number, number, number] = [0, 0, 0];

  private readonly tmpD: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly d1: Daughter = { E: 0, d: { x: 0, y: 0, z: -1 } };
  private readonly d2: Daughter = { E: 0, d: { x: 0, y: 0, z: -1 } };
  private readonly comptonOut = { cosT: 1 };
  private readonly sA: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly sB: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly sC: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly sD: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly sE: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly sF: Vec3 = { x: 0, y: 0, z: -1 };

  constructor(params: ShowerParams) {
    this.p = params;
    this.rng = new Rng(params.seed);
    this.E0 = params.energyEV * 1e-9;
    this.zg = params.groundAltitudeM;
    this.XvGround = verticalDepth(this.zg);
    const th = (params.zenithDeg * Math.PI) / 180;
    const az = (params.azimuthDeg * Math.PI) / 180;
    this.cosAxis = Math.cos(th);
    // Arrives FROM azimuth az (clockwise from north): it moves toward az + 180.
    this.axis = { x: -Math.sin(th) * Math.sin(az), y: -Math.sin(th) * Math.cos(az), z: -Math.cos(th) };
    this.eCutE = M_E + params.emCutMeV * 1e-3;
    this.eCutG = Math.max(params.emCutMeV * 1e-3, 1e-4);
    this.muCut = M_MU + params.muonCutMeV * 1e-3;
    this.hadCut = params.hadronCutGeV;
    this.eThin = params.thinning > 0 ? params.thinning * this.E0 : 0;
    // Weight limit: CORSIKA's epsilon*E0/GeV leaves ~300/epsilon particles near the
    // ground; a factor WEIGHT_FACTOR above it keeps an interactive particle budget.
    this.wMaxEm = params.thinning > 0 ? Math.max(1, params.thinning * this.E0 * WEIGHT_FACTOR) : 1;
    this.wMaxHad = Math.max(1, this.wMaxEm / 100);
    this.importantE = Math.max(1, 1e-4 * this.E0);
    const cap = params.recordTracks ? Math.max(1000, params.maxSegments) : 0;
    this.seg = new Float32Array(cap * SEG_STRIDE);
    this.segLevel = new Uint8Array(cap);
    this.gnd = new Float32Array(Math.min(MAX_GROUND, 65536) * GND_STRIDE);
    const bins = Math.ceil(this.XvGround / this.cosAxis / PROFILE_STEP) + 1;
    this.profile = {
      step: PROFILE_STEP,
      bins,
      byClass: Array.from({ length: RCLASS_COUNT }, () => new Float64Array(bins)),
      charged: new Float64Array(bins),
    };
  }

  run(onProgress?: ProgressFn): ShowerResult {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this.injectPrimary();
    let nextReport = 20000;
    while (this.sp > 0) {
      this.pop();
      this.tracked++;
      this.track();
      if (onProgress && this.tracked >= nextReport) {
        nextReport += 20000;
        onProgress(this.progress(), this.tracked);
      }
    }
    const cpuMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
    return this.finish(cpuMs);
  }

  private progress(): number {
    let e = 0;
    for (let i = 0; i < this.sp; i++) e += this.stack[i]!.E * this.stack[i]!.w;
    return Math.min(0.999, Math.max(0, 1 - e / this.E0));
  }

  // ------------------------------------------------------------ setup

  private injectPrimary(): void {
    const p = this.p;
    const A = PRIMARY_MASS_NUMBER[p.primary];
    const q = blank();
    // Start at the top of the atmosphere on the axis through the core.
    const zTop = 112000;
    const s = (zTop - this.zg) / -this.axis.z; // distance from core back up the axis
    q.x = p.coreX - this.axis.x * s;
    q.y = p.coreY - this.axis.y * s;
    q.z = zTop;
    q.dx = this.axis.x; q.dy = this.axis.y; q.dz = this.axis.z;
    q.t = 0;
    q.w = 1;
    q.level = IMPORTANT_LEVEL;
    if (p.primary === 'gamma') { q.type = PType.GAMMA; q.E = this.E0; q.A = 0; }
    else if (A === 1) { q.type = PType.PROTON; q.E = this.E0; q.A = 1; }
    else { q.type = PType.NUCLEUS; q.E = this.E0; q.A = A; }
    this.pushCopy(q);
  }

  // ------------------------------------------------------------ stack

  private pushCopy(q: Particle): void {
    let slot = this.stack[this.sp];
    if (!slot) { slot = blank(); this.stack[this.sp] = slot; }
    slot.type = q.type; slot.E = q.E; slot.x = q.x; slot.y = q.y; slot.z = q.z;
    slot.dx = q.dx; slot.dy = q.dy; slot.dz = q.dz; slot.t = q.t; slot.w = q.w; slot.A = q.A;
    slot.tau = q.tau; slot.level = q.level;
    this.sp++;
  }

  private pop(): void {
    this.sp--;
    const s = this.stack[this.sp]!;
    const c = this.cur;
    c.type = s.type; c.E = s.E; c.x = s.x; c.y = s.y; c.z = s.z;
    c.dx = s.dx; c.dy = s.dy; c.dz = s.dz; c.t = s.t; c.w = s.w; c.A = s.A; c.tau = s.tau; c.level = s.level;
  }

  /** Push a secondary created at the current particle's position and time. */
  private emit(type: PType, E: number, d: Vec3, w: number, A = 1): void {
    const c = this.cur;
    let slot = this.stack[this.sp];
    if (!slot) { slot = blank(); this.stack[this.sp] = slot; }
    slot.type = type; slot.E = E; slot.x = c.x; slot.y = c.y; slot.z = c.z;
    slot.dx = d.x; slot.dy = d.y; slot.dz = d.z; slot.t = c.t; slot.w = w; slot.A = A; slot.tau = NaN;
    const rc = renderClass(type);
    slot.level = rc === RClass.MUON || rc === RClass.HADRON || E > this.importantE ? IMPORTANT_LEVEL : this.randomLevel();
    this.sp++;
  }

  private randomLevel(): number {
    // Geometric level: P(level >= k) = 2^-k.
    let l = 0;
    let u = this.rng.u32();
    while ((u & 1) === 1 && l < 30) { l++; u >>>= 1; }
    return l;
  }

  // ------------------------------------------------------------ thinning

  /**
   * Hillas thinning of a set of secondaries (energies es, parent energy ep,
   * parent weight w). Returns the new weight for each secondary, 0 = dropped.
   */
  private thin(ep: number, w: number, es: number[], hadronic: boolean, out: number[]): void {
    out.length = es.length;
    if (this.eThin <= 0) { out.fill(w); return; }
    const wmax = hadronic ? this.wMaxHad : this.wMaxEm;
    let sum = 0;
    for (const e of es) sum += e;
    if (ep < this.eThin && es.length > 1) {
      // All below threshold: keep exactly one, chosen with probability E_i / sum.
      let u = this.rng.uniform() * sum;
      let pick = es.length - 1;
      for (let i = 0; i < es.length; i++) { u -= es[i]!; if (u <= 0) { pick = i; break; } }
      const wn = (w * sum) / es[pick]!;
      if (wn <= wmax) {
        out.fill(0);
        out[pick] = wn;
        return;
      }
    }
    for (let i = 0; i < es.length; i++) {
      const e = es[i]!;
      if (e >= this.eThin) { out[i] = w; continue; }
      const pk = Math.min(1, Math.max(e / this.eThin, w / wmax));
      out[i] = this.rng.uniform() < pk ? w / pk : 0;
    }
  }

  private readonly es: number[] = [];
  private readonly ws: number[] = [];
  private readonly types: PType[] = [];
  private readonly dirs: Vec3[] = [];
  private readonly nucA: number[] = [];

  private clearSecondaries(): void {
    this.es.length = 0; this.types.length = 0; this.nucA.length = 0;
  }

  private addSecondary(type: PType, E: number, d: Vec3, A = 1): void {
    const i = this.es.length;
    this.es.push(E);
    this.types.push(type);
    this.nucA.push(A);
    let v = this.dirs[i];
    if (!v) { v = { x: 0, y: 0, z: -1 }; this.dirs[i] = v; }
    v.x = d.x; v.y = d.y; v.z = d.z;
  }

  private flushSecondaries(ep: number, w: number, hadronic: boolean): void {
    this.thin(ep, w, this.es, hadronic, this.ws);
    for (let i = 0; i < this.es.length; i++) {
      const wn = this.ws[i]!;
      if (wn > 0) this.emit(this.types[i]!, this.es[i]!, this.dirs[i]!, wn, this.nucA[i]!);
    }
    this.clearSecondaries();
  }

  // ------------------------------------------------------------ transport

  /** Advance the current particle by slant depth dX. Returns distance moved (m). Sets hit/escaped. */
  private advanceDepth(dX: number): number {
    const c = this.cur;
    this.hit = false;
    this.escaped = false;
    const cz = -c.dz;
    let L: number;
    if (cz > 1e-3) {
      const Xv0 = verticalDepth(c.z);
      const Xv1 = Xv0 + dX * cz;
      if (Xv1 >= this.XvGround) {
        L = (c.z - this.zg) / cz;
        this.hit = true;
      } else {
        L = (c.z - altitudeAtDepth(Xv1)) / cz;
      }
    } else if (cz < -1e-3) {
      const Xv0 = verticalDepth(c.z);
      const Xv1 = Xv0 + dX * cz;
      if (Xv1 <= 1e-4) { this.escaped = true; L = (112000 - c.z) / -cz; }
      else L = (altitudeAtDepth(Xv1) - c.z) / -cz;
    } else {
      const rho = density(c.z) * 100; // g/cm^2 per metre
      L = dX / Math.max(rho, 1e-12);
      if (L > 400000) { this.escaped = true; L = 400000; }
    }
    if (L < 0) L = 0;
    c.x += c.dx * L; c.y += c.dy * L; c.z += c.dz * L;
    if (this.hit) c.z = this.zg;
    return L;
  }

  /** Advance by distance L (m). Returns the slant depth traversed. Sets hit/escaped. */
  private advanceDistance(L: number): number {
    const c = this.cur;
    this.hit = false;
    this.escaped = false;
    const z1 = c.z + c.dz * L;
    if (z1 <= this.zg && c.dz < 0) {
      const Lg = (c.z - this.zg) / -c.dz;
      const dX = this.depthBetween(c.z, this.zg, -c.dz, Lg);
      c.x += c.dx * Lg; c.y += c.dy * Lg; c.z = this.zg;
      this.hit = true;
      this.lastL = Lg;
      return dX;
    }
    if (z1 >= 112000) this.escaped = true;
    const dX = this.depthBetween(c.z, z1, -c.dz, L);
    c.x += c.dx * L; c.y += c.dy * L; c.z = z1;
    this.lastL = L;
    return dX;
  }
  private lastL = 0;

  private depthBetween(za: number, zb: number, cz: number, L: number): number {
    if (Math.abs(cz) > 1e-3) return Math.abs(verticalDepth(zb) - verticalDepth(za)) / Math.abs(cz);
    return density(0.5 * (za + zb)) * 100 * L;
  }

  private slantOf(z: number): number {
    return verticalDepth(z) / this.cosAxis;
  }

  // ------------------------------------------------------------ recording

  private record(x0: number, y0: number, z0: number, t0: number, rc: RClass, E: number): void {
    const c = this.cur;
    if (t0 < this.tMin) this.tMin = t0;
    if (c.t > this.tMax) this.tMax = c.t;
    // profile: count planes crossed
    if (rc !== RClass.HADRON || c.type !== PType.NEUTRON) {
      const sa = this.slantOf(z0);
      const sb = this.slantOf(c.z);
      const lo = Math.min(sa, sb);
      const hi = Math.max(sa, sb);
      let i = Math.ceil(lo / PROFILE_STEP - 0.5);
      const prof = this.profile;
      const arr = prof.byClass[rc]!;
      const charged = c.type !== PType.GAMMA;
      for (; i < prof.bins; i++) {
        const X = (i + 0.5) * PROFILE_STEP;
        if (X >= hi) break;
        if (X < lo) continue;
        arr[i]! += c.w;
        if (charged) prof.charged[i]! += c.w;
      }
    }
    if (!this.p.recordTracks) return;
    if (c.level < this.curLevel) return;
    let x0r = x0, y0r = y0, z0r = z0, t0r = t0;
    if (this.primaryFirstStep) {
      // Draw only the last 20 km of the primary's approach.
      const len = Math.hypot(c.x - x0, c.y - y0, c.z - z0);
      if (len > 20000) {
        const f = 1 - 20000 / len;
        x0r = x0 + (c.x - x0) * f; y0r = y0 + (c.y - y0) * f; z0r = z0 + (c.z - z0) * f; t0r = t0 + (c.t - t0) * f;
      }
      this.startPoint = [x0r, y0r, z0r];
      this.tMin = t0r;
    }
    if (this.segN >= this.segLevel.length) {
      this.decimate();
      if (c.level < this.curLevel) return;
      if (this.segN >= this.segLevel.length) { this.truncated = true; return; }
    }
    const o = this.segN * SEG_STRIDE;
    const s = this.seg;
    s[o] = x0r; s[o + 1] = y0r; s[o + 2] = z0r; s[o + 3] = t0r;
    s[o + 4] = c.x; s[o + 5] = c.y; s[o + 6] = c.z; s[o + 7] = c.t;
    s[o + 8] = rc; s[o + 9] = Math.log10(Math.max(E, 1e-6)); s[o + 10] = c.w;
    this.segLevel[this.segN] = c.level;
    this.segN++;
  }

  /** Raise the recording level and drop segments below it (uniform particle-level sampling). */
  private decimate(): void {
    if (this.curLevel >= 30) { this.truncated = true; return; }
    this.curLevel++;
    this.truncated = true;
    const s = this.seg;
    let j = 0;
    for (let i = 0; i < this.segN; i++) {
      if (this.segLevel[i]! >= this.curLevel) {
        if (i !== j) {
          s.copyWithin(j * SEG_STRIDE, i * SEG_STRIDE, (i + 1) * SEG_STRIDE);
          this.segLevel[j] = this.segLevel[i]!;
        }
        j++;
      }
    }
    this.segN = j;
  }

  private recordGround(rc: RClass, E: number): void {
    const c = this.cur;
    this.groundCounts[rc]! += c.w;
    if (this.gndN >= MAX_GROUND) return;
    if ((this.gndN + 1) * GND_STRIDE > this.gnd.length) {
      const g = new Float32Array(Math.min(MAX_GROUND * GND_STRIDE, this.gnd.length * 2));
      g.set(this.gnd);
      this.gnd = g;
    }
    const o = this.gndN * GND_STRIDE;
    const g = this.gnd;
    g[o] = c.x; g[o + 1] = c.y; g[o + 2] = c.t; g[o + 3] = rc; g[o + 4] = Math.log10(Math.max(E, 1e-6));
    g[o + 5] = c.w; g[o + 6] = c.dx; g[o + 7] = c.dy; g[o + 8] = c.dz;
    this.gndN++;
  }

  // ------------------------------------------------------------ dispatch

  private track(): void {
    switch (this.cur.type) {
      case PType.GAMMA: this.trackPhoton(); break;
      case PType.ELECTRON:
      case PType.POSITRON: this.trackElectron(); break;
      case PType.MUON_MINUS:
      case PType.MUON_PLUS: this.trackMuon(); break;
      case PType.PION_PLUS:
      case PType.PION_MINUS: this.trackPion(); break;
      default: this.trackHadron(); break;
    }
    this.primaryFirstStep = false;
  }

  private markFirstInteraction(): void {
    if (Number.isNaN(this.firstDepth)) {
      this.firstDepth = this.slantOf(this.cur.z);
      this.tFirst = this.cur.t;
    }
  }

  /** Move with a time update, record the segment. Returns whether the particle is still in the air. */
  private moveDepth(dX: number, beta: number, rc: RClass, E: number): number {
    const c = this.cur;
    const x0 = c.x, y0 = c.y, z0 = c.z, t0 = c.t;
    const L = this.advanceDepth(dX);
    c.t += L / (beta * C_M_PER_NS);
    this.record(x0, y0, z0, t0, rc, E);
    return L;
  }

  // ------------------------------------------------------------ hadrons

  private trackHadron(): void {
    const c = this.cur;
    const m = massOf(c.type, c.A);
    if (c.E - m < this.hadCut && c.type !== PType.NUCLEUS) return;
    const sigma = c.type === PType.NUCLEUS ? sigmaNucleusAir(c.E, c.A) : sigmaProtonAir(c.E);
    const lambda = lambdaFromSigma(sigma);
    const dX = this.rng.exp(lambda);
    const beta = Math.sqrt(Math.max(0, 1 - (m * m) / (c.E * c.E)));
    this.moveDepth(dX, Math.max(beta, 0.05), RClass.HADRON, c.E);
    if (this.escaped) return;
    if (this.hit) { this.recordGround(RClass.HADRON, c.E); return; }
    this.markFirstInteraction();
    this.interactions++;
    if (c.type === PType.NUCLEUS) this.fragmentNucleus();
    else this.collide(c.type, c.E);
  }

  private trackPion(): void {
    const c = this.cur;
    if (c.E - M_PI < 0.01) return;
    if (Number.isNaN(c.tau)) c.tau = this.rng.exp(TAU_PI_NS);
    const lambda = lambdaFromSigma(sigmaPionAir(c.E));
    const dXint = this.rng.exp(lambda);
    const pg = Math.sqrt(c.E * c.E - M_PI * M_PI) / M_PI; // beta*gamma
    const beta = pg / Math.sqrt(1 + pg * pg);
    const Ldecay = c.tau * pg * C_M_PER_NS;
    // Probe the interaction distance without moving: advance a copy.
    const x0 = c.x, y0 = c.y, z0 = c.z, t0 = c.t;
    const Lint = this.advanceDepth(dXint);
    const hitInt = this.hit, escInt = this.escaped;
    if (Ldecay < Lint) {
      // Undo and move only to the decay point.
      c.x = x0; c.y = y0; c.z = z0;
      this.advanceDistance(Ldecay);
      c.t = t0 + this.lastL / (beta * C_M_PER_NS);
      this.record(x0, y0, z0, t0, RClass.HADRON, c.E);
      if (this.hit) { this.recordGround(RClass.HADRON, c.E); return; }
      if (this.escaped) return;
      this.decayPion();
      return;
    }
    c.t = t0 + Lint / (beta * C_M_PER_NS);
    this.record(x0, y0, z0, t0, RClass.HADRON, c.E);
    if (escInt) return;
    if (hitInt) { this.recordGround(RClass.HADRON, c.E); return; }
    this.interactions++;
    this.markFirstInteraction();
    this.collide(c.type, c.E);
  }

  private decayPion(): void {
    const c = this.cur;
    this.tmpD.x = c.dx; this.tmpD.y = c.dy; this.tmpD.z = c.dz;
    twoBodyDecay(this.rng, M_PI, c.E, this.tmpD, M_MU, 0, this.d1, this.d2);
    const muType = c.type === PType.PION_PLUS ? PType.MUON_PLUS : PType.MUON_MINUS;
    if (this.d1.E > this.muCut) {
      this.clearSecondaries();
      this.addSecondary(muType, this.d1.E, this.d1.d);
      this.flushSecondaries(c.E, c.w, true);
    }
  }

  /** Hadron-air collision of a nucleon or charged pion with total energy E. */
  private collide(proj: PType, E: number): void {
    const c = this.cur;
    const rng = this.rng;
    this.clearSecondaries();
    const K = TUNE.kMin + TUNE.kRange * rng.uniform();
    // Leading particle.
    let leadType: PType = proj;
    if (proj === PType.PROTON || proj === PType.NEUTRON) {
      if (rng.uniform() < 0.33) leadType = proj === PType.PROTON ? PType.NEUTRON : PType.PROTON;
    }
    const mLead = massOf(leadType);
    const eLead = Math.max((1 - K) * E, mLead + 1e-3);
    this.tmpD.x = c.dx; this.tmpD.y = c.dy; this.tmpD.z = c.dz;
    const dLead = this.sA;
    this.scatterPt(this.tmpD, eLead, mLead, dLead);
    this.addSecondary(leadType, eLead, dLead);
    // Produced pions.
    const avail = E - eLead;
    const nMean = 1.5 * chargedMultiplicity(E);
    const n = Math.max(1, rng.poisson(nMean));
    const g = this.gbuf;
    g.length = n;
    let sum = 0;
    for (let i = 0; i < n; i++) { g[i] = rng.gamma(TUNE.alpha); sum += g[i]!; }
    const dSec = this.sB;
    for (let i = 0; i < n; i++) {
      const e = (avail * g[i]!) / sum;
      const r = rng.uniform();
      if (r < 1 / 3) {
        if (e <= M_PI0) continue;
        if (!this.p.trackEm) continue;
        this.scatterPt(this.tmpD, e, M_PI0, dSec);
        // pi0 -> 2 gamma immediately.
        twoBodyDecay(rng, M_PI0, e, dSec, 0, 0, this.d1, this.d2);
        if (this.d1.E > this.eCutG) this.addSecondary(PType.GAMMA, this.d1.E, this.d1.d);
        if (this.d2.E > this.eCutG) this.addSecondary(PType.GAMMA, this.d2.E, this.d2.d);
      } else {
        if (e <= M_PI + 0.01) continue;
        this.scatterPt(this.tmpD, e, M_PI, dSec);
        this.addSecondary(r < 2 / 3 ? PType.PION_PLUS : PType.PION_MINUS, e, dSec);
      }
    }
    this.flushMixed(E, c.w);
  }
  private readonly gbuf: number[] = [];

  /** Thin hadronic and EM secondaries of one collision with their own weight limits. */
  private flushMixed(ep: number, w: number): void {
    // Split into two groups preserving order.
    const n = this.es.length;
    const hadE: number[] = [], hadT: PType[] = [], hadD: Vec3[] = [];
    const emE: number[] = [], emD: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      if (this.types[i] === PType.GAMMA) { emE.push(this.es[i]!); emD.push({ ...this.dirs[i]! }); }
      else { hadE.push(this.es[i]!); hadT.push(this.types[i]!); hadD.push({ ...this.dirs[i]! }); }
    }
    this.clearSecondaries();
    const wsH: number[] = [];
    this.thin(ep, w, hadE, true, wsH);
    for (let i = 0; i < hadE.length; i++) if (wsH[i]! > 0) this.emit(hadT[i]!, hadE[i]!, hadD[i]!, wsH[i]!);
    if (emE.length) {
      const wsE: number[] = [];
      this.thin(ep, w, emE, false, wsE);
      for (let i = 0; i < emE.length; i++) if (wsE[i]! > 0) this.emit(PType.GAMMA, emE[i]!, emD[i]!, wsE[i]!);
    }
  }

  /** Give a particle of energy e, mass m a transverse momentum about d. */
  private scatterPt(d: Vec3, e: number, m: number, out: Vec3): void {
    const p = Math.sqrt(Math.max(e * e - m * m, 1e-12));
    const pt = 0.18 * this.rng.gamma(2);
    const sinT = Math.min(pt / p, 0.999);
    deflect(d, Math.sqrt(1 - sinT * sinT), 2 * Math.PI * this.rng.uniform(), out);
  }

  private fragmentNucleus(): void {
    const c = this.cur;
    const A = c.A;
    const rng = this.rng;
    const meanW = 1 + TUNE.wounded * (Math.pow(A, 2 / 3) - 1);
    const nw = Math.min(A, 1 + rng.poisson(meanW - 1));
    const eN = c.E / A;
    const w = c.w;
    const x = c.x, y = c.y, z = c.z, t = c.t, dx = c.dx, dy = c.dy, dz = c.dz;
    // Spectators continue first (pushed first, tracked last).
    const spect = A - nw;
    this.tmpD.x = dx; this.tmpD.y = dy; this.tmpD.z = dz;
    // The excited spectator remnant breaks up: one fragment plus free nucleons.
    const big = Math.floor(spect * Math.pow(rng.uniform(), TUNE.fragPow));
    let free = spect;
    if (big >= 2) { this.emit(PType.NUCLEUS, eN * big, this.tmpD, w, big); free -= big; }
    for (let i = 0; i < free; i++) this.emit(rng.uniform() < 0.5 ? PType.PROTON : PType.NEUTRON, eN, this.tmpD, w);
    // Wounded nucleons interact here and now.
    for (let i = 0; i < nw; i++) {
      c.x = x; c.y = y; c.z = z; c.t = t; c.dx = dx; c.dy = dy; c.dz = dz; c.w = w;
      const type = rng.uniform() < 0.5 ? PType.PROTON : PType.NEUTRON;
      c.type = type;
      c.E = eN;
      this.collide(type, eN);
    }
  }

  // ------------------------------------------------------------ muons

  private trackMuon(): void {
    const c = this.cur;
    const rng = this.rng;
    if (Number.isNaN(c.tau)) c.tau = rng.exp(TAU_MU_NS);
    for (;;) {
      if (c.E < this.muCut) { this.muonDecay(true); return; }
      const ek = c.E - M_MU;
      const loss = DEDX_MU + B_MU_AIR * c.E;
      const dX = Math.min(100, (0.2 * ek) / loss + 0.5);
      const pg = Math.sqrt(c.E * c.E - M_MU * M_MU) / M_MU;
      const beta = pg / Math.sqrt(1 + pg * pg);
      const x0 = c.x, y0 = c.y, z0 = c.z, t0 = c.t, E0 = c.E;
      let L = this.advanceDepth(dX);
      let usedX = dX;
      if (this.hit || this.escaped) usedX = this.depthBetween(z0, c.z, -c.dz, L);
      // Decay within the step?
      const dTau = L / (pg * C_M_PER_NS);
      let decays = false;
      if (dTau > c.tau) {
        const Ld = c.tau * pg * C_M_PER_NS;
        c.x = x0; c.y = y0; c.z = z0;
        usedX = this.advanceDistance(Ld);
        L = Ld;
        decays = !this.hit;
        c.tau = 0;
      } else c.tau -= dTau;
      c.t = t0 + L / (beta * C_M_PER_NS);
      c.E = Math.max(M_MU, c.E - loss * usedX);
      // Multiple scattering.
      const p = Math.sqrt(Math.max(c.E * E0 - M_MU * M_MU, 1e-9));
      this.scatter(highlandTheta0(p * beta, usedX / X0), L);
      this.record(x0, y0, z0, t0, RClass.MUON, E0);
      if (this.escaped) return;
      if (this.hit) { this.recordGround(RClass.MUON, c.E); return; }
      if (decays) { this.muonDecay(false); return; }
    }
  }

  /** mu -> e nu nu with the Michel spectrum, in flight or at rest. */
  private muonDecay(atRest: boolean): void {
    if (!this.p.trackEm) return;
    const c = this.cur;
    const rng = this.rng;
    let x: number;
    do { x = rng.uniform(); } while (rng.uniform() > x * x * (3 - 2 * x));
    const eStar = 0.5 * M_MU * x;
    const cosS = 2 * rng.uniform() - 1;
    this.tmpD.x = c.dx; this.tmpD.y = c.dy; this.tmpD.z = c.dz;
    if (atRest) {
      this.d1.E = eStar;
      deflect(this.tmpD, cosS, 2 * Math.PI * rng.uniform(), this.d1.d);
    } else {
      boostPair(M_MU, c.E, this.tmpD, eStar, cosS, 2 * Math.PI * rng.uniform(), 0, this.d1);
    }
    if (this.d1.E < this.eCutE) return;
    const type = c.type === PType.MUON_PLUS ? PType.POSITRON : PType.ELECTRON;
    this.clearSecondaries();
    this.addSecondary(type, this.d1.E, this.d1.d);
    this.flushSecondaries(c.E, c.w, false);
  }

  /** Apply a Gaussian multiple-scattering deflection and correlated lateral offset over a step L. */
  private scatter(theta0: number, L: number): void {
    if (theta0 <= 0) return;
    const c = this.cur;
    const rng = this.rng;
    const z1 = rng.normal(), z2 = rng.normal(), z3 = rng.normal(), z4 = rng.normal();
    const ta = z2 * theta0, tb = z4 * theta0;
    const ya = L * theta0 * (z1 / Math.sqrt(12) + z2 / 2);
    const yb = L * theta0 * (z3 / Math.sqrt(12) + z4 / 2);
    // Basis perpendicular to d.
    let ux: number, uy: number, uz: number;
    if (Math.abs(c.dz) < 0.9) { ux = c.dy; uy = -c.dx; uz = 0; } else { ux = 0; uy = c.dz; uz = -c.dy; }
    const n = Math.hypot(ux, uy, uz);
    ux /= n; uy /= n; uz /= n;
    const vx = c.dy * uz - c.dz * uy, vy = c.dz * ux - c.dx * uz, vz = c.dx * uy - c.dy * ux;
    if (!this.hit) {
      c.x += ya * ux + yb * vx; c.y += ya * uy + yb * vy;
      const nz = c.z + ya * uz + yb * vz;
      c.z = Math.max(nz, this.zg + 1e-3);
    }
    let dx = c.dx + ta * ux + tb * vx, dy = c.dy + ta * uy + tb * vy, dz = c.dz + ta * uz + tb * vz;
    const m = Math.hypot(dx, dy, dz);
    dx /= m; dy /= m; dz /= m;
    c.dx = dx; c.dy = dy; c.dz = dz;
  }

  // ------------------------------------------------------------ electrons

  private trackElectron(): void {
    const c = this.cur;
    const rng = this.rng;
    const rc = c.type === PType.POSITRON ? RClass.POSITRON : RClass.ELECTRON;
    for (;;) {
      if (c.E < this.eCutE) return;
      const ek = c.E - M_E;
      const vmin = this.eCutG / c.E;
      const nB = bremPerX0(vmin);
      const xB = nB > 0 ? rng.exp(X0 / nB) : Infinity;
      const xIon = (0.25 * ek) / DEDX_E + 0.05;
      const dX = Math.min(xB, xIon, 0.5 * X0);
      const brem = dX === xB;
      const x0 = c.x, y0 = c.y, z0 = c.z, t0 = c.t, E0 = c.E;
      const L = this.advanceDepth(dX);
      const usedX = this.hit || this.escaped ? this.depthBetween(z0, c.z, -c.dz, L) : dX;
      c.t += L / C_M_PER_NS;
      c.E = Math.max(M_E, c.E - DEDX_E * usedX);
      const p = Math.sqrt(Math.max(c.E * E0 - M_E * M_E, 1e-12));
      const beta = Math.min(1, p / Math.max(c.E, 1e-9));
      this.scatter(rossiTheta0(p * beta, usedX / X0), L);
      this.record(x0, y0, z0, t0, rc, E0);
      if (this.escaped) return;
      if (this.hit) { this.recordGround(rc, c.E); return; }
      if (brem && c.E > this.eCutE) {
        const v = sampleBremFraction(rng, Math.min(vmin, 0.999));
        const k = v * c.E;
        if (k < c.E - M_E) {
          this.tmpD.x = c.dx; this.tmpD.y = c.dy; this.tmpD.z = c.dz;
          const d = this.sC;
          const th = (M_E / c.E) * Math.sqrt(-Math.log(rng.uniform()));
          deflect(this.tmpD, Math.cos(th), 2 * Math.PI * rng.uniform(), d);
          // Thinning between the continuing electron and the photon.
          const eAfter = c.E - k;
          this.es.length = 0;
          this.es.push(eAfter, k);
          const wsOut = this.ws;
          this.thin(c.E, c.w, this.es, false, wsOut);
          this.es.length = 0;
          const wE = wsOut[0]!, wG = wsOut[1]!;
          if (wG > 0 && k > this.eCutG) {
            this.emit(PType.GAMMA, k, d, wG);
          }
          if (wE <= 0) return;
          c.E = eAfter;
          c.w = wE;
        }
      }
    }
  }

  // ------------------------------------------------------------ photons

  private trackPhoton(): void {
    const c = this.cur;
    const rng = this.rng;
    for (;;) {
      if (c.E < this.eCutG) return;
      const mp = muPair(c.E);
      const mc = muCompton(c.E);
      const mu = mp + mc;
      const dX = rng.exp(1 / mu);
      this.moveDepth(dX, 1, RClass.GAMMA, c.E);
      if (this.escaped) return;
      if (this.hit) { this.recordGround(RClass.GAMMA, c.E); return; }
      if (this.primaryFirstStep) this.markFirstInteraction();
      this.primaryFirstStep = false;
      this.tmpD.x = c.dx; this.tmpD.y = c.dy; this.tmpD.z = c.dz;
      if (rng.uniform() * mu < mp) {
        // Pair production.
        this.interactions++;
        const x = samplePairFraction(rng, c.E);
        const eM = x * c.E, eP = (1 - x) * c.E;
        this.clearSecondaries();
        const thM = M_E / eM, thP = M_E / eP;
        const dM = this.sD;
        const phi = 2 * Math.PI * rng.uniform();
        deflect(this.tmpD, Math.cos(thM), phi, dM);
        if (eM > this.eCutE) this.addSecondary(PType.ELECTRON, eM, dM);
        deflect(this.tmpD, Math.cos(thP), phi + Math.PI, dM);
        if (eP > this.eCutE) this.addSecondary(PType.POSITRON, eP, dM);
        this.flushSecondaries(c.E, c.w, false);
        return;
      }
      // Compton scattering: the photon continues, an electron is knocked on.
      const eps = sampleCompton(rng, c.E, this.comptonOut);
      const eGamma = eps * c.E;
      const eKin = c.E - eGamma;
      const phi = 2 * Math.PI * rng.uniform();
      const dG = this.sE;
      deflect(this.tmpD, this.comptonOut.cosT, phi, dG);
      // Electron direction from momentum balance.
      const pe = Math.sqrt(eKin * (eKin + 2 * M_E));
      const pgx = c.E * c.dx - eGamma * dG.x, pgy = c.E * c.dy - eGamma * dG.y, pgz = c.E * c.dz - eGamma * dG.z;
      const pn = Math.hypot(pgx, pgy, pgz) || pe || 1;
      const dE = this.sF;
      dE.x = pgx / pn; dE.y = pgy / pn; dE.z = pgz / pn;
      const eTot = eKin + M_E;
      this.es.length = 0;
      this.es.push(eGamma, eTot);
      this.thin(c.E, c.w, this.es, false, this.ws);
      this.es.length = 0;
      const wG = this.ws[0]!, wE = this.ws[1]!;
      if (wE > 0 && eTot > this.eCutE) this.emit(PType.ELECTRON, eTot, dE, wE);
      if (wG <= 0) return;
      c.E = eGamma;
      c.w = wG;
      c.dx = dG.x; c.dy = dG.y; c.dz = dG.z;
    }
  }

  // ------------------------------------------------------------ finish

  private finish(cpuMs: number): ShowerResult {
    // Shift the clock so that t = 0 is the first interaction.
    const tShift = Number.isNaN(this.tFirst) ? 0 : this.tFirst;
    const segments = this.seg.slice(0, this.segN * SEG_STRIDE);
    for (let i = 0; i < this.segN; i++) {
      segments[i * SEG_STRIDE + 3]! -= tShift;
      segments[i * SEG_STRIDE + 7]! -= tShift;
    }
    const ground = this.gnd.slice(0, this.gndN * GND_STRIDE);
    for (let i = 0; i < this.gndN; i++) ground[i * GND_STRIDE + 2]! -= tShift;
    // Plane front reaching the core: the primary travels at ~c along the axis.
    const zStart = 112000;
    const sCore = (zStart - this.zg) / -this.axis.z;
    const tCore = sCore / C_M_PER_NS - tShift;
    const groundSlant = this.XvGround / this.cosAxis;
    const gh = fitGaisserHillas(PROFILE_STEP, this.profile.charged, groundSlant);
    return {
      params: this.p,
      segments,
      segmentCount: this.segN,
      ground,
      groundCount: this.gndN,
      profile: this.profile,
      stats: {
        firstInteractionDepth: this.firstDepth,
        groundSlantDepth: groundSlant,
        gh,
        groundCounts: this.groundCounts.slice(),
        particlesTracked: this.tracked,
        interactions: this.interactions,
        cpuMs,
        truncated: this.truncated,
        tMin: Number.isFinite(this.tMin) ? this.tMin - tShift : 0,
        tMax: Number.isFinite(this.tMax) ? this.tMax - tShift : 0,
        tCore,
        axis: [this.axis.x, this.axis.y, this.axis.z],
        start: this.startPoint,
      },
    };
  }
}

// Re-exported for tests.
export { M_N, M_P, M_NUCLEON };
