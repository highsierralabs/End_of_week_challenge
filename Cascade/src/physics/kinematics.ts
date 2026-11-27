// Direction handling and relativistic two-body decays.
import type { Rng } from './rng';

export interface Vec3 { x: number; y: number; z: number }

/**
 * Rotate the unit vector d by polar angle theta about itself, at azimuth phi,
 * writing the result to out. Standard construction with an orthonormal basis.
 */
export function deflect(d: Vec3, cosT: number, phi: number, out: Vec3): void {
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  // Basis u, v perpendicular to d.
  let ux: number, uy: number, uz: number;
  if (Math.abs(d.z) < 0.9) {
    // u = normalize(d x zhat)
    ux = d.y; uy = -d.x; uz = 0;
  } else {
    // u = normalize(d x xhat)
    ux = 0; uy = d.z; uz = -d.y;
  }
  const n = Math.hypot(ux, uy, uz);
  ux /= n; uy /= n; uz /= n;
  const vx = d.y * uz - d.z * uy;
  const vy = d.z * ux - d.x * uz;
  const vz = d.x * uy - d.y * ux;
  const x = d.x * cosT + sinT * (cp * ux + sp * vx);
  const y = d.y * cosT + sinT * (cp * uy + sp * vy);
  const z = d.z * cosT + sinT * (cp * uz + sp * vz);
  const m = Math.hypot(x, y, z);
  out.x = x / m; out.y = y / m; out.z = z / m;
}

export interface Daughter { E: number; d: Vec3 }

/**
 * Isotropic two-body decay of a parent (mass M, total energy E, direction d)
 * into masses m1, m2, boosted to the lab. Writes energies and directions.
 */
export function twoBodyDecay(
  rng: Rng, M: number, E: number, d: Vec3, m1: number, m2: number, out1: Daughter, out2: Daughter,
): void {
  const pStar = Math.sqrt(Math.max(0, (M * M - (m1 + m2) ** 2) * (M * M - (m1 - m2) ** 2))) / (2 * M);
  const cosS = 2 * rng.uniform() - 1;
  const phi = 2 * Math.PI * rng.uniform();
  boostPair(M, E, d, pStar, cosS, phi, m1, out1);
  boostPair(M, E, d, pStar, -cosS, phi + Math.PI, m2, out2);
}

/**
 * Boost a rest-frame momentum pStar at polar angle acos(cosS) (relative to d)
 * of a daughter with mass m to the lab frame of a parent of mass M, energy E.
 */
export function boostPair(M: number, E: number, d: Vec3, pStar: number, cosS: number, phi: number, m: number, out: Daughter): void {
  const gamma = E / M;
  const betaGamma = Math.sqrt(Math.max(0, gamma * gamma - 1));
  const eStar = Math.sqrt(pStar * pStar + m * m);
  const pl = gamma * pStar * cosS + betaGamma * eStar;
  const pt = pStar * Math.sqrt(Math.max(0, 1 - cosS * cosS));
  const eLab = gamma * eStar + betaGamma * pStar * cosS;
  const p = Math.hypot(pl, pt);
  out.E = Math.max(eLab, m);
  if (!out.d) out.d = { x: 0, y: 0, z: 0 };
  deflect(d, p > 0 ? pl / p : 1, phi, out.d);
}
