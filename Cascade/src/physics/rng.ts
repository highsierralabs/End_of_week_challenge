// Deterministic random numbers: xoshiro128** seeded through splitmix32.
// Doubles carry 53 bits so that -ln(u) never sees u = 0.

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spareNormal: number | null = null;

  constructor(seed: number) {
    let s = seed >>> 0;
    const next = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  /** Next 32-bit unsigned integer. */
  u32(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.b << 9) >>> 0;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    return result;
  }

  /** Uniform double in (0, 1): never exactly 0 or 1. */
  uniform(): number {
    const hi = this.u32() >>> 5; // 27 bits
    const lo = this.u32() >>> 6; // 26 bits
    return (hi * 67108864 + lo + 0.5) / 9007199254740992;
  }

  /** Exponential deviate with the given mean. */
  exp(mean: number): number {
    return -mean * Math.log(this.uniform());
  }

  /** Standard normal deviate (Marsaglia polar). */
  normal(): number {
    if (this.spareNormal !== null) {
      const v = this.spareNormal;
      this.spareNormal = null;
      return v;
    }
    let u: number, v: number, s: number;
    do {
      u = 2 * this.uniform() - 1;
      v = 2 * this.uniform() - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    this.spareNormal = v * m;
    return u * m;
  }

  /** Gamma(shape k, scale 1) deviate (Marsaglia-Tsang; boosts k < 1). */
  gamma(k: number): number {
    if (k < 1) return this.gamma(k + 1) * Math.pow(this.uniform(), 1 / k);
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.uniform();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /** Poisson deviate (Knuth for small means, normal approximation above 60). */
  poisson(mean: number): number {
    if (mean <= 0) return 0;
    if (mean > 60) return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.normal()));
    const L = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.uniform();
    } while (p > L);
    return k - 1;
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}
