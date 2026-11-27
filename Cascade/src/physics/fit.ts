// Gaisser-Hillas fit of a longitudinal profile by Nelder-Mead in log space.
import { gaisserHillas } from './analytic';
import type { GaisserHillasFit } from './types';

export function fitGaisserHillas(step: number, counts: Float64Array, maxDepth: number): GaisserHillasFit | null {
  let peak = 0;
  let peakI = -1;
  for (let i = 0; i < counts.length; i++) {
    if ((i + 0.5) * step > maxDepth) break;
    if (counts[i]! > peak) { peak = counts[i]!; peakI = i; }
  }
  if (peakI < 0 || peak < 3) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < counts.length; i++) {
    const X = (i + 0.5) * step;
    if (X > maxDepth) break;
    const c = counts[i]!;
    if (c > peak * 0.01 && c > 0.5) { xs.push(X); ys.push(Math.log(c)); }
  }
  if (xs.length < 4) return null;
  const x0Max = xs[0]! - 1;
  const objective = (p: number[]): number => {
    const [lnN, xmax, x0, lambda] = p as [number, number, number, number];
    if (lambda < 10 || lambda > 200 || x0 >= xmax - 5 || x0 > x0Max || x0 < -400) return 1e12;
    let s = 0;
    for (let i = 0; i < xs.length; i++) {
      const g = gaisserHillas(xs[i]!, 1, xmax, x0, lambda);
      if (g <= 0) return 1e12;
      const r = lnN + Math.log(g) - ys[i]!;
      s += r * r;
    }
    return s;
  };
  const xPeak = (peakI + 0.5) * step;
  const start = [Math.log(peak), xPeak, Math.min(x0Max, Math.max(-100, xPeak - 600)), 70];
  let best = nelderMead(objective, start, [0.3, 40, 60, 15], 1500);
  best = nelderMead(objective, best.x, [0.05, 8, 15, 4], 1500);
  const [lnN, xmax, x0, lambda] = best.x as [number, number, number, number];
  if (!Number.isFinite(best.f) || best.f >= 1e11) return null;
  return { nmax: Math.exp(lnN), xmax, x0, lambda, residual: best.f / Math.max(1, xs.length - 4) };
}

export function nelderMead(f: (p: number[]) => number, x0: number[], scale: number[], maxIter: number): { x: number[]; f: number } {
  const n = x0.length;
  let simplex: number[][] = [x0.slice()];
  for (let i = 0; i < n; i++) {
    const p = x0.slice();
    p[i] = p[i]! + scale[i]!;
    simplex.push(p);
  }
  let values = simplex.map(f);
  for (let iter = 0; iter < maxIter; iter++) {
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    simplex = order.map(([, i]) => simplex[i]!);
    values = order.map(([v]) => v);
    if (Math.abs(values[n]! - values[0]!) < 1e-10 * (Math.abs(values[0]!) + 1e-12)) break;
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j]! += simplex[i]![j]! / n;
    const worst = simplex[n]!;
    const at = (t: number): number[] => centroid.map((c, j) => c + t * (worst[j]! - c));
    const xr = at(-1);
    const fr = f(xr);
    if (fr < values[0]!) {
      const xe = at(-2);
      const fe = f(xe);
      if (fe < fr) { simplex[n] = xe; values[n] = fe; } else { simplex[n] = xr; values[n] = fr; }
    } else if (fr < values[n - 1]!) {
      simplex[n] = xr; values[n] = fr;
    } else {
      const xc = fr < values[n]! ? at(-0.5) : at(0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, values[n]!)) { simplex[n] = xc; values[n] = fc; } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i]!.map((v, j) => simplex[0]![j]! + 0.5 * (v - simplex[0]![j]!));
          values[i] = f(simplex[i]!);
        }
      }
    }
  }
  let bi = 0;
  for (let i = 1; i <= n; i++) if (values[i]! < values[bi]!) bi = i;
  return { x: simplex[bi]!, f: values[bi]! };
}
