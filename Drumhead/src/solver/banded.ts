// Sparse symmetric positive-definite solves by reverse Cuthill-McKee reordering
// and a banded Cholesky factorisation. A drumhead mesh of a few thousand vertices
// has a bandwidth of about a hundred after reordering, so the factorisation costs
// n * b^2 flops and each solve 2 * n * b.

import { type System } from './fem';

/** Reverse Cuthill-McKee permutation: perm[newIndex] = oldIndex. */
export function rcm(n: number, rowPtr: Int32Array, col: Int32Array): Int32Array {
  const deg = new Int32Array(n);
  for (let i = 0; i < n; i++) deg[i] = rowPtr[i + 1]! - rowPtr[i]!;
  const seen = new Uint8Array(n);
  const order: number[] = [];
  while (order.length < n) {
    // Start each component from a vertex of minimum degree.
    let start = -1;
    for (let i = 0; i < n; i++) if (!seen[i] && (start < 0 || deg[i]! < deg[start]!)) start = i;
    // Move to a pseudo-peripheral vertex: the last one reached by a breadth-first sweep.
    for (let k = 0; k < 2; k++) {
      const lvl = new Int32Array(n).fill(-1);
      const q = [start];
      lvl[start] = 0;
      let last = start;
      for (let h = 0; h < q.length; h++) {
        const u = q[h]!;
        last = u;
        for (let p = rowPtr[u]!; p < rowPtr[u + 1]!; p++) {
          const w = col[p]!;
          if (lvl[w] === -1 && !seen[w]) { lvl[w] = lvl[u]! + 1; q.push(w); }
        }
      }
      start = last;
    }
    const q = [start];
    seen[start] = 1;
    for (let h = 0; h < q.length; h++) {
      const u = q[h]!;
      order.push(u);
      const nb: number[] = [];
      for (let p = rowPtr[u]!; p < rowPtr[u + 1]!; p++) { const w = col[p]!; if (!seen[w]) { seen[w] = 1; nb.push(w); } }
      nb.sort((a, b) => deg[a]! - deg[b]!);
      for (const w of nb) q.push(w);
    }
  }
  return Int32Array.from(order.reverse());
}

export interface BandFactor {
  n: number;
  /** Half-bandwidth. */
  b: number;
  /** perm[new] = old */
  perm: Int32Array;
  /** L in band storage: L[i][i-k] at data[i*(b+1) + (b-k)], k = 0..b */
  data: Float64Array;
}

/** Factor P K P^T = L L^T. */
export function factor(sys: System): BandFactor {
  const { n, rowPtr, col, val } = sys;
  const perm = rcm(n, rowPtr, col);
  const inv = new Int32Array(n);
  for (let i = 0; i < n; i++) inv[perm[i]!] = i;
  let b = 0;
  for (let i = 0; i < n; i++) for (let p = rowPtr[i]!; p < rowPtr[i + 1]!; p++) b = Math.max(b, Math.abs(inv[i]! - inv[col[p]!]!));
  const w = b + 1;
  const data = new Float64Array(n * w);
  // Scatter the lower triangle of the permuted matrix.
  for (let i = 0; i < n; i++) {
    const I = inv[i]!;
    for (let p = rowPtr[i]!; p < rowPtr[i + 1]!; p++) {
      const J = inv[col[p]!]!;
      if (J <= I) data[I * w + (b - (I - J))] = val[p]!;
    }
  }
  // Row-oriented banded Cholesky.
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - b);
    for (let j = j0; j <= i; j++) {
      let s = data[i * w + (b - (i - j))]!;
      const k0 = Math.max(j0, j - b);
      const io = i * w + b - i, jo = j * w + b - j;
      for (let k = k0; k < j; k++) s -= data[io + k]! * data[jo + k]!;
      if (j === i) {
        if (!(s > 0)) throw new Error('stiffness matrix is not positive definite');
        data[i * w + b] = Math.sqrt(s);
      } else {
        data[i * w + (b - (i - j))] = s / data[j * w + b]!;
      }
    }
  }
  return { n, b, perm, data };
}

/** Solve K x = r in place (r in original ordering). `tmp` is scratch of length n. */
export function solve(f: BandFactor, r: Float64Array, tmp: Float64Array): void {
  const { n, b, perm, data } = f;
  const w = b + 1;
  for (let i = 0; i < n; i++) tmp[i] = r[perm[i]!]!;
  for (let i = 0; i < n; i++) {
    let s = tmp[i]!;
    const io = i * w + b - i;
    for (let k = Math.max(0, i - b); k < i; k++) s -= data[io + k]! * tmp[k]!;
    tmp[i] = s / data[i * w + b]!;
  }
  for (let i = n - 1; i >= 0; i--) {
    const s = tmp[i]! / data[i * w + b]!;
    tmp[i] = s;
    for (let k = Math.max(0, i - b); k < i; k++) tmp[k] = tmp[k]! - data[i * w + b - i + k]! * s;
  }
  for (let i = 0; i < n; i++) r[perm[i]!] = tmp[i]!;
}
