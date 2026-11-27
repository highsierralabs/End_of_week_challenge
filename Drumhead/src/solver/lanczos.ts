// The lowest modes of K x = lambda M x (M diagonal) by shift-invert Lanczos.
//
// With y = M^(1/2) x the problem becomes the symmetric one  Op y = mu y,
// Op = M^(1/2) K^-1 M^(1/2), mu = 1/lambda. The lowest drum modes become the largest
// and best separated eigenvalues of Op, which Lanczos finds first. Full
// reorthogonalisation keeps the basis clean, and each Ritz pair is accepted only once
// its residual bound |beta_m s_m| is small.

import { factor, solve } from './banded';
import { type System } from './fem';

/** Eigen-decomposition of a symmetric tridiagonal matrix (implicit QL, Numerical Recipes tqli). */
export function tridiagEig(alpha: Float64Array, beta: Float64Array): { values: Float64Array; vectors: Float64Array } {
  const m = alpha.length;
  const d = alpha.slice();
  const e = new Float64Array(m);
  for (let i = 0; i < m - 1; i++) e[i] = beta[i]!;
  const z = new Float64Array(m * m); // column-major: z[k*m + i] = component i of vector k
  for (let i = 0; i < m; i++) z[i * m + i] = 1;
  for (let l = 0; l < m; l++) {
    let iter = 0;
    let mm: number;
    do {
      for (mm = l; mm < m - 1; mm++) {
        const dd = Math.abs(d[mm]!) + Math.abs(d[mm + 1]!);
        if (Math.abs(e[mm]!) <= Number.EPSILON * dd) break;
      }
      if (mm !== l) {
        if (iter++ === 60) throw new Error('tridiagonal eigensolver did not converge');
        let g = (d[l + 1]! - d[l]!) / (2 * e[l]!);
        let r = Math.hypot(g, 1);
        g = d[mm]! - d[l]! + e[l]! / (g + (g >= 0 ? Math.abs(r) : -Math.abs(r)));
        let s = 1, c = 1, p = 0;
        let i: number;
        for (i = mm - 1; i >= l; i--) {
          let f = s * e[i]!;
          const b = c * e[i]!;
          r = Math.hypot(f, g);
          e[i + 1] = r;
          if (r === 0) { d[i + 1] = d[i + 1]! - p; e[mm] = 0; break; }
          s = f / r; c = g / r;
          g = d[i + 1]! - p;
          r = (d[i]! - g) * s + 2 * c * b;
          p = s * r;
          d[i + 1] = g + p;
          g = c * r - b;
          for (let k = 0; k < m; k++) {
            f = z[(i + 1) * m + k]!;
            z[(i + 1) * m + k] = s * z[i * m + k]! + c * f;
            z[i * m + k] = c * z[i * m + k]! - s * f;
          }
        }
        if (r === 0 && i >= l) continue;
        d[l] = d[l]! - p; e[l] = g; e[mm] = 0;
      }
    } while (mm !== l);
  }
  return { values: d, vectors: z };
}

export interface Modes {
  /** Eigenvalues lambda (1/m^2), ascending. */
  lambda: Float64Array;
  /** Mode shapes on the free vertices, M-orthonormal: vec[k*n + i]. */
  vec: Float64Array;
  n: number;
  count: number;
}

/** Deterministic start vector: smooth and positive, so it overlaps the fundamental. */
function startVector(n: number): Float64Array {
  const v = new Float64Array(n);
  let s = 0x9e3779b9;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    v[i] = 1 + 0.5 * (s / 4294967296 - 0.5);
  }
  return v;
}

/** A deterministic vector orthogonal to the first `count` basis vectors, or null if none is left. */
function restartVector(n: number, count: number, V: Float64Array): Float64Array | null {
  let s = (0x2545f491 + count * 7919) >>> 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const v = new Float64Array(n);
    for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; v[i] = s / 4294967296 - 0.5; }
    for (let pass = 0; pass < 2; pass++) {
      for (let q = 0; q < count; q++) {
        let dot = 0;
        const o = q * n;
        for (let i = 0; i < n; i++) dot += V[o + i]! * v[i]!;
        for (let i = 0; i < n; i++) v[i] = v[i]! - dot * V[o + i]!;
      }
    }
    const nrm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    if (nrm > 1e-8) { for (let i = 0; i < n; i++) v[i] = v[i]! / nrm; return v; }
  }
  return null;
}

export function lowestModes(sys: System, want: number, onProgress?: (f: number) => void): Modes {
  const n = sys.n;
  const k = Math.min(want, n);
  const fac = factor(sys);
  const sq = new Float64Array(n);
  for (let i = 0; i < n; i++) sq[i] = Math.sqrt(sys.mass[i]!);
  const tmp = new Float64Array(n);
  const op = (y: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) out[i] = sq[i]! * y[i]!;
    solve(fac, out, tmp);
    for (let i = 0; i < n; i++) out[i] = sq[i]! * out[i]!;
  };

  let m = Math.min(n, Math.max(k + 20, Math.ceil(2.2 * k) + 10));
  for (;;) {
    const V = new Float64Array(m * n);
    const alpha = new Float64Array(m);
    const beta = new Float64Array(m);
    let v = startVector(n);
    let nrm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    for (let i = 0; i < n; i++) v[i] = v[i]! / nrm;
    const w = new Float64Array(n);
    let steps = m;
    for (let j = 0; j < m; j++) {
      V.set(v, j * n);
      op(v, w);
      // Full reorthogonalisation, twice (classical Gram-Schmidt, "twice is enough").
      for (let pass = 0; pass < 2; pass++) {
        for (let q = 0; q <= j; q++) {
          let dot = 0;
          const o = q * n;
          for (let i = 0; i < n; i++) dot += V[o + i]! * w[i]!;
          if (pass === 0 && q === j) alpha[j] = dot; else if (q === j) alpha[j] = alpha[j]! + dot;
          for (let i = 0; i < n; i++) w[i] = w[i]! - dot * V[o + i]!;
        }
      }
      nrm = Math.sqrt(w.reduce((a, x) => a + x * x, 0));
      beta[j] = nrm;
      if (j + 1 < m) {
        if (nrm < 1e-12 * Math.abs(alpha[j]!)) {
          // Invariant subspace found. Restart with a fresh vector orthogonal to the basis so far;
          // T becomes block diagonal (beta = 0), and repeated eigenvalues get their other copies.
          beta[j] = 0;
          const r = restartVector(n, j + 1, V);
          if (!r) { steps = j + 1; break; }
          v = r;
        } else {
          v = new Float64Array(n);
          for (let i = 0; i < n; i++) v[i] = w[i]! / nrm;
        }
      }
      if (onProgress && (j & 7) === 0) onProgress(j / m);
    }
    const { values, vectors } = tridiagEig(alpha.subarray(0, steps), beta.subarray(0, steps));
    // Largest mu first.
    const order = Array.from(values.keys()).sort((a, b) => values[b]! - values[a]!);
    const top = order.slice(0, Math.min(k, steps));
    // Residual bound for each Ritz pair: |beta_last * s_last| relative to mu.
    const lastBeta = beta[steps - 1]!;
    let converged = 0;
    for (const t of top) {
      const res = Math.abs(lastBeta * vectors[t * steps + steps - 1]!);
      if (res <= 1e-9 * Math.abs(values[t]!) || steps === n) converged++; else break;
    }
    if (converged >= top.length || m >= n) {
      const count = top.length;
      const lambda = new Float64Array(count);
      const vec = new Float64Array(count * n);
      top.forEach((t, r) => {
        lambda[r] = 1 / values[t]!;
        const o = r * n;
        for (let q = 0; q < steps; q++) {
          const s = vectors[t * steps + q]!;
          if (s === 0) continue;
          const qo = q * n;
          for (let i = 0; i < n; i++) vec[o + i] = vec[o + i]! + s * V[qo + i]!;
        }
        // x = M^(-1/2) y, and fix the sign so the largest lobe is positive.
        let big = 0;
        for (let i = 0; i < n; i++) { vec[o + i] = vec[o + i]! / sq[i]!; if (Math.abs(vec[o + i]!) > Math.abs(big)) big = vec[o + i]!; }
        if (big < 0) for (let i = 0; i < n; i++) vec[o + i] = -vec[o + i]!;
      });
      onProgress?.(1);
      return { lambda, vec, n, count };
    }
    m = Math.min(n, Math.ceil(m * 1.5));
  }
}
