// Exact fractions (the rate of every arbor is a product of tooth counts) and continued fractions
// (how a clockmaker finds small tooth counts for an awkward ratio).

export interface Fraction {
  n: bigint;
  d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) { [x, y] = [y, x % y]; }
  return x;
}

export function frac(n: number | bigint, d: number | bigint = 1): Fraction {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new Error('zero denominator');
  if (dd < 0n) { nn = -nn; dd = -dd; }
  const g = gcd(nn, dd) || 1n;
  return { n: nn / g, d: dd / g };
}

export function mul(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.n, a.d * b.d);
}

export function div(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d, a.d * b.n);
}

export function add(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function sub(a: Fraction, b: Fraction): Fraction {
  return frac(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function neg(a: Fraction): Fraction {
  return { n: -a.n, d: a.d };
}

export function toNumber(a: Fraction): number {
  // Tooth-count products stay far below 2^1023, so the two conversions are safe; dividing the
  // doubles keeps about 15 significant digits.
  return Number(a.n) / Number(a.d);
}

export function fractionText(a: Fraction): string {
  return a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`;
}

/** Partial quotients of x, stopping after `max` terms or when the remainder vanishes. */
export function continuedFraction(x: number, max = 12): number[] {
  const out: number[] = [];
  let v = x;
  for (let i = 0; i < max; i++) {
    const a = Math.floor(v);
    out.push(a);
    const f = v - a;
    if (f < 1e-10) break;
    v = 1 / f;
    if (!Number.isFinite(v) || v > 1e9) break;
  }
  return out;
}

export interface Convergent {
  p: number;
  q: number;
  /** p/q - x. */
  error: number;
}

/** The convergents of x: each is the best approximation by any fraction with a denominator that small. */
export function convergents(x: number, max = 12): Convergent[] {
  const cf = continuedFraction(x, max);
  const out: Convergent[] = [];
  let p0 = 1, q0 = 0, p1 = cf[0]!, q1 = 1;
  out.push({ p: p1, q: q1, error: p1 / q1 - x });
  for (let i = 1; i < cf.length; i++) {
    const a = cf[i]!;
    const p2 = a * p1 + p0;
    const q2 = a * q1 + q0;
    if (p2 > 1e12 || q2 > 1e12) break;
    out.push({ p: p2, q: q2, error: p2 / q2 - x });
    p0 = p1; q0 = q1; p1 = p2; q1 = q2;
  }
  return out;
}

/**
 * The best fraction p/q to x with both p and q in [min, max]: the answer to "one pair of wheels,
 * no more than `max` teeth each". Exhaustive, so there is nothing to prove about it.
 */
export function bestPair(x: number, min: number, max: number): Convergent {
  let best: Convergent = { p: min, q: min, error: Infinity };
  for (let q = min; q <= max; q++) {
    const centre = Math.round(x * q);
    for (const p of [centre - 1, centre, centre + 1]) {
      if (p < min || p > max) continue;
      const error = p / q - x;
      if (Math.abs(error) < Math.abs(best.error)) best = { p, q, error };
    }
  }
  return best;
}
