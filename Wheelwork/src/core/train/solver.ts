// The gear-train solver. Every train in the machine is the same thing: two axes a fixed distance
// apart, joined by a cluster of two wheels on the second axis, so that the train's ratio is
// (b/a) * (d/c) with wheel a meshing b and wheel c meshing d. The solver lists every pair of wheels
// that fits the frame and the rules, then finds the two pairs whose product comes closest to the
// ratio wanted. The search is exhaustive over the allowed tooth counts.

/** What one meshing pair must satisfy. The module follows from the centre distance: m = 2C / (z1 + z2). */
export interface PairRule {
  centreDistance: number;
  minTeeth: number;
  maxTeeth: number;
  minModule: number;
  maxModule: number;
  /** Smallest allowed root radius of the first wheel (so that it fits on its tube or sleeve). */
  minRootFirst: number;
  /** Smallest allowed root radius of the second wheel. */
  minRootSecond: number;
  /** Largest allowed tip radius of the first and second wheel (0 for none). */
  maxTipFirst?: number;
  maxTipSecond?: number;
}

export interface Pair {
  first: number;
  second: number;
  /** second / first. */
  ratio: number;
  module: number;
}

export const DEDENDUM = 1.25;
export const ADDENDUM = 1;

export function moduleFor(centreDistance: number, z1: number, z2: number): number {
  return (2 * centreDistance) / (z1 + z2);
}

export function rootRadius(module: number, teeth: number): number {
  return module * (teeth / 2 - DEDENDUM);
}

export function tipRadius(module: number, teeth: number): number {
  return module * (teeth / 2 + ADDENDUM);
}

/** Why a pair breaks its rule, or null when it fits. */
export function pairFault(rule: PairRule, first: number, second: number): string | null {
  if (!Number.isInteger(first) || !Number.isInteger(second)) return 'tooth counts are whole numbers';
  if (first < rule.minTeeth || second < rule.minTeeth) return `fewer than ${rule.minTeeth} teeth`;
  if (first > rule.maxTeeth || second > rule.maxTeeth) return `more than ${rule.maxTeeth} teeth`;
  const m = moduleFor(rule.centreDistance, first, second);
  if (m < rule.minModule - 1e-12) return `teeth too fine (module ${m.toFixed(2)} mm, under ${rule.minModule})`;
  if (m > rule.maxModule + 1e-12) return `teeth too coarse (module ${m.toFixed(2)} mm, over ${rule.maxModule})`;
  if (rootRadius(m, first) < rule.minRootFirst - 1e-12) return 'first wheel too small for what it is fixed on';
  if (rootRadius(m, second) < rule.minRootSecond - 1e-12) return 'second wheel too small for what it is fixed on';
  if (rule.maxTipFirst && tipRadius(m, first) > rule.maxTipFirst + 1e-12) return 'first wheel too large for the space';
  if (rule.maxTipSecond && tipRadius(m, second) > rule.maxTipSecond + 1e-12) return 'second wheel too large for the space';
  return null;
}

/** Every pair of tooth counts that fits the rule, sorted by ratio. */
export function feasiblePairs(rule: PairRule): Pair[] {
  const out: Pair[] = [];
  const sMin = Math.ceil((2 * rule.centreDistance) / rule.maxModule - 1e-9);
  const sMax = Math.floor((2 * rule.centreDistance) / rule.minModule + 1e-9);
  for (let sum = Math.max(sMin, 2 * rule.minTeeth); sum <= Math.min(sMax, 2 * rule.maxTeeth); sum++) {
    for (let first = rule.minTeeth; first <= Math.min(rule.maxTeeth, sum - rule.minTeeth); first++) {
      const second = sum - first;
      if (second > rule.maxTeeth) continue;
      if (pairFault(rule, first, second)) continue;
      out.push({ first, second, ratio: second / first, module: moduleFor(rule.centreDistance, first, second) });
    }
  }
  out.sort((p, q) => p.ratio - q.ratio);
  return out;
}

export interface StepRule {
  /** Wheel a (on the first axis) meshing wheel b (on the cluster). */
  first: PairRule;
  /** Wheel c (on the cluster) meshing wheel d (on the second axis, or back on the first). */
  second: PairRule;
}

export interface Candidate {
  a: number;
  b: number;
  c: number;
  d: number;
  /** (b/a) * (d/c). */
  ratio: number;
  /** ratio / target - 1. */
  error: number;
  moduleFirst: number;
  moduleSecond: number;
  teeth: number;
}

function candidate(p: Pair, q: Pair, target: number): Candidate {
  const ratio = (p.second * q.second) / (p.first * q.first);
  return {
    a: p.first, b: p.second, c: q.first, d: q.second,
    ratio, error: ratio / target - 1,
    moduleFirst: p.module, moduleSecond: q.module,
    teeth: p.first + p.second + q.first + q.second,
  };
}

/**
 * The `keep` trains closest to `target`, best first. Trains with the same ratio are listed once,
 * the one with the coarsest teeth standing for all.
 */
function gcdInt(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) { [x, y] = [y, x % y]; }
  return x;
}

/** A train's ratio as a reduced fraction, so that trains with the same ratio are recognised exactly. */
function ratioKey(c: Candidate): string {
  const n = c.b * c.d;
  const d = c.a * c.c;
  const g = gcdInt(n, d);
  return `${n / g}/${d / g}`;
}

const finest = (c: Candidate): number => Math.min(c.moduleFirst, c.moduleSecond);

export function solveStep(target: number, rule: StepRule, keep = 12): Candidate[] {
  const firsts = feasiblePairs(rule.first);
  const seconds = feasiblePairs(rule.second);
  if (!firsts.length || !seconds.length) return [];
  // One entry for each distinct ratio: the train with the coarsest teeth that makes it.
  let found = new Map<string, Candidate>();
  let worst = Infinity;
  const ratios = seconds.map((s) => s.ratio);
  const byError = (x: Candidate, y: Candidate) => Math.abs(x.error) - Math.abs(y.error) || finest(y) - finest(x);
  for (const p of firsts) {
    const want = target / p.ratio;
    // Binary search for the first second-pair with ratio >= want, then look both ways.
    let lo = 0;
    let hi = ratios.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ratios[mid]! < want) lo = mid + 1; else hi = mid;
    }
    for (const dir of [-1, 1]) {
      for (let k = dir < 0 ? lo - 1 : lo; k >= 0 && k < seconds.length; k += dir) {
        const c = candidate(p, seconds[k]!, target);
        // Errors only grow walking away from the nearest pair, so the first one outside the kept set ends the walk.
        if (Math.abs(c.error) > worst) break;
        const key = ratioKey(c);
        const had = found.get(key);
        if (!had || finest(c) > finest(had)) found.set(key, c);
        if (found.size > keep * 12) {
          const kept = [...found.values()].sort(byError).slice(0, keep * 6);
          worst = Math.abs(kept[kept.length - 1]!.error);
          found = new Map(kept.map((v) => [ratioKey(v), v]));
        }
      }
    }
  }
  return [...found.values()].sort(byError).slice(0, keep);
}

/**
 * Among the trains within `tolerance` (relative) of the target, the one with the coarsest teeth:
 * the easiest to cut, or to print. Falls back to the most accurate when none is that close.
 */
export function coarsestWithin(target: number, rule: StepRule, tolerance: number): Candidate | null {
  const firsts = feasiblePairs(rule.first);
  const seconds = feasiblePairs(rule.second);
  if (!firsts.length || !seconds.length) return null;
  const ratios = seconds.map((s) => s.ratio);
  let best: Candidate | null = null;
  let bestScore = -Infinity;
  for (const p of firsts) {
    const lowWant = (target * (1 - tolerance)) / p.ratio;
    const highWant = (target * (1 + tolerance)) / p.ratio;
    let lo = 0;
    let hi = ratios.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ratios[mid]! < lowWant) lo = mid + 1; else hi = mid;
    }
    for (let k = lo; k < seconds.length && ratios[k]! <= highWant; k++) {
      const c = candidate(p, seconds[k]!, target);
      // Coarsest finest-mesh first, then the smaller error.
      const score = Math.min(c.moduleFirst, c.moduleSecond) - Math.abs(c.error) / tolerance * 1e-3;
      if (score > bestScore) { bestScore = score; best = c; }
    }
  }
  return best ?? solveStep(target, rule, 1)[0] ?? null;
}
