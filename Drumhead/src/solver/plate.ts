// Free-edged plates (Kirchhoff), for true Chladni figures and metal-plate sound.
//
// D lap^2 w = rho_s omega^2 w, with every edge free. A Ritz method: w is a combination of
// products of Legendre polynomials L_i(xi) L_j(eta), i + j <= N, over the shape's bounding square.
// The bending energy and the kinetic energy are integrated over the shape itself with a degree-5
// rule on each triangle of a mesh, so any outline works. Free edges are the natural boundary
// condition of the energy, so nothing is imposed. The eigenproblem K c = lambda M c is solved
// densely; directions in which M is numerically singular (a high-degree polynomial nearly zero on
// the shape) are dropped first.

import { type Mesh } from './mesh';

/** Jacobi eigen-decomposition of a dense symmetric matrix (row-major n x n). Returns ascending. */
export function jacobiEig(Ain: Float64Array, n: number): { values: Float64Array; vectors: Float64Array } {
  const A = Ain.slice();
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0, diag = 0;
    for (let i = 0; i < n; i++) {
      diag += A[i * n + i]! ** 2;
      for (let j = i + 1; j < n; j++) off += A[i * n + j]! ** 2;
    }
    if (off <= 1e-30 * diag) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p * n + p]!, aqq = A[q * n + q]!;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p]!, akq = A[k * n + q]!;
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k]!, aqk = A[q * n + k]!;
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p]!, vkq = V[k * n + q]!;
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => A[a * n + a]! - A[b * n + b]!);
  const values = new Float64Array(n);
  const vectors = new Float64Array(n * n); // column r = eigenvector r, stored vectors[k * n + r]
  order.forEach((o, r) => {
    values[r] = A[o * n + o]!;
    for (let k = 0; k < n; k++) vectors[k * n + r] = V[k * n + o]!;
  });
  return { values, vectors };
}

/** Legendre P_0..P_N and their first two derivatives at x. */
function legendre(x: number, N: number, p: Float64Array, d1: Float64Array, d2: Float64Array): void {
  p[0] = 1; d1[0] = 0; d2[0] = 0;
  if (N === 0) return;
  p[1] = x; d1[1] = 1; d2[1] = 0;
  for (let n = 1; n < N; n++) {
    p[n + 1] = ((2 * n + 1) * x * p[n]! - n * p[n - 1]!) / (n + 1);
    d1[n + 1] = d1[n - 1]! + (2 * n + 1) * p[n]!;
    d2[n + 1] = d2[n - 1]! + (2 * n + 1) * d1[n]!;
  }
}

/** Degree-5, 7-point rule on a triangle (Dunavant): barycentric points and weights. */
const QP: [number, number, number, number][] = (() => {
  const a1 = 0.0597158717, b1 = 0.4701420641, w1 = 0.1323941527;
  const a2 = 0.7974269853, b2 = 0.1012865073, w2 = 0.1259391805;
  return [
    [1 / 3, 1 / 3, 1 / 3, 0.225],
    [a1, b1, b1, w1], [b1, a1, b1, w1], [b1, b1, a1, w1],
    [a2, b2, b2, w2], [b2, a2, b2, w2], [b2, b2, a2, w2],
  ];
})();

export interface PlateModes {
  /** Nonzero eigenvalues lambda = rho_s omega^2 / D, in 1/m^4, ascending (rigid-body modes removed). */
  lambda: Float64Array;
  /** Mass-normalised shapes on the render mesh's vertices: shape[k * nv + v]. */
  shape: Float32Array;
  count: number;
}

/**
 * Lowest flexural modes of the free plate occupying `quad`'s triangles; shapes are evaluated at the
 * vertices of `render` (which may be the same mesh). `degree` is the Legendre total degree N.
 */
export function solvePlate(quad: Mesh, render: Mesh, degree: number, nu: number, want: number): PlateModes {
  // Bounding square of the shape.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < quad.xy.length; i += 2) {
    x0 = Math.min(x0, quad.xy[i]!); x1 = Math.max(x1, quad.xy[i]!);
    y0 = Math.min(y0, quad.xy[i + 1]!); y1 = Math.max(y1, quad.xy[i + 1]!);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, s = Math.max(x1 - x0, y1 - y0) / 2 * 1.0001;
  const N = degree;
  const idx: [number, number][] = [];
  for (let t = 0; t <= N; t++) for (let i = 0; i <= t; i++) idx.push([i, t - i]);
  const n = idx.length;
  const px = new Float64Array(N + 1), dx1 = new Float64Array(N + 1), dx2 = new Float64Array(N + 1);
  const py = new Float64Array(N + 1), dy1 = new Float64Array(N + 1), dy2 = new Float64Array(N + 1);

  const K = new Float64Array(n * n), M = new Float64Array(n * n);
  const bv = new Float64Array(n), bxx = new Float64Array(n), byy = new Float64Array(n), bxy = new Float64Array(n);
  const inv = 1 / s, inv2 = inv * inv;
  const { xy, tri } = quad;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t]!, b = tri[t + 1]!, c = tri[t + 2]!;
    const ax = xy[2 * a]!, ay = xy[2 * a + 1]!, bx = xy[2 * b]!, by = xy[2 * b + 1]!, ccx = xy[2 * c]!, ccy = xy[2 * c + 1]!;
    const area = Math.abs(0.5 * ((bx - ax) * (ccy - ay) - (ccx - ax) * (by - ay)));
    for (const [l1, l2, l3, w] of QP) {
      const x = l1 * ax + l2 * bx + l3 * ccx, y = l1 * ay + l2 * by + l3 * ccy;
      legendre((x - cx) * inv, N, px, dx1, dx2);
      legendre((y - cy) * inv, N, py, dy1, dy2);
      for (let r = 0; r < n; r++) {
        const [i, j] = idx[r]!;
        bv[r] = px[i]! * py[j]!;
        bxx[r] = dx2[i]! * py[j]! * inv2;
        byy[r] = px[i]! * dy2[j]! * inv2;
        bxy[r] = dx1[i]! * dy1[j]! * inv2;
      }
      const W = w * area;
      for (let r = 0; r < n; r++) {
        const vr = bv[r]! * W, xr = bxx[r]! * W, yr = byy[r]! * W, zr = bxy[r]! * W;
        const ro = r * n;
        for (let q = r; q < n; q++) {
          M[ro + q] = M[ro + q]! + vr * bv[q]!;
          K[ro + q] = K[ro + q]! + xr * bxx[q]! + yr * byy[q]! + nu * (xr * byy[q]! + yr * bxx[q]!) + 2 * (1 - nu) * zr * bxy[q]!;
        }
      }
    }
  }
  for (let r = 0; r < n; r++) for (let q = 0; q < r; q++) { M[r * n + q] = M[q * n + r]!; K[r * n + q] = K[q * n + r]!; }

  // Orthonormalise against M, dropping near-null directions.
  const me = jacobiEig(M, n);
  const mmax = me.values[n - 1]!;
  const keep: number[] = [];
  for (let r = 0; r < n; r++) if (me.values[r]! > 1e-11 * mmax) keep.push(r);
  const k = keep.length;
  const T = new Float64Array(n * k); // n x k
  keep.forEach((r, c) => { const sc = 1 / Math.sqrt(me.values[r]!); for (let i = 0; i < n; i++) T[i * k + c] = me.vectors[i * n + r]! * sc; });
  // K' = T^T K T
  const KT = new Float64Array(n * k);
  for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) { let sum = 0; for (let j = 0; j < n; j++) sum += K[i * n + j]! * T[j * k + c]!; KT[i * k + c] = sum; }
  const Kp = new Float64Array(k * k);
  for (let a2 = 0; a2 < k; a2++) for (let b2 = a2; b2 < k; b2++) { let sum = 0; for (let i = 0; i < n; i++) sum += T[i * k + a2]! * KT[i * k + b2]!; Kp[a2 * k + b2] = sum; Kp[b2 * k + a2] = sum; }
  const ke = jacobiEig(Kp, k);

  // Skip the three rigid-body modes (zero energy): anything far below the first bending mode.
  const top = ke.values[k - 1]!;
  let first = 0;
  while (first < k && ke.values[first]! < 1e-7 * top) first++;
  const count = Math.min(want, k - first);
  const lambda = new Float64Array(count);
  const coef = new Float64Array(n * count); // coefficients in the Legendre basis
  for (let m = 0; m < count; m++) {
    lambda[m] = ke.values[first + m]!;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let c = 0; c < k; c++) sum += T[i * k + c]! * ke.vectors[c * k + first + m]!;
      coef[i * count + m] = sum;
    }
  }
  // Evaluate the shapes on the render mesh.
  const nv = render.xy.length / 2;
  const shape = new Float32Array(count * nv);
  const basis = new Float64Array(n);
  for (let v = 0; v < nv; v++) {
    legendre((render.xy[2 * v]! - cx) * inv, N, px, dx1, dx2);
    legendre((render.xy[2 * v + 1]! - cy) * inv, N, py, dy1, dy2);
    for (let r = 0; r < n; r++) basis[r] = px[idx[r]![0]]! * py[idx[r]![1]]!;
    for (let m = 0; m < count; m++) {
      let sum = 0;
      for (let r = 0; r < n; r++) sum += basis[r]! * coef[r * count + m]!;
      shape[m * nv + v] = sum;
    }
  }
  // Sign convention: largest lobe positive.
  for (let m = 0; m < count; m++) {
    let big = 0;
    for (let v = 0; v < nv; v++) if (Math.abs(shape[m * nv + v]!) > Math.abs(big)) big = shape[m * nv + v]!;
    if (big < 0) for (let v = 0; v < nv; v++) shape[m * nv + v] = -shape[m * nv + v]!;
  }
  return { lambda, shape, count };
}
