// Plane polygons: area, perimeter, containment, nearest point, resampling.
// A polygon is a flat array of points [x0, y0, x1, y1, ...], implicitly closed.

export type Poly = number[];

export function polyArea(p: Poly): number {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * i]! * p[2 * j + 1]! - p[2 * j]! * p[2 * i + 1]!;
  }
  return a / 2;
}

export function polyPerimeter(p: Poly): number {
  let s = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += Math.hypot(p[2 * j]! - p[2 * i]!, p[2 * j + 1]! - p[2 * i + 1]!);
  }
  return s;
}

/** Even-odd containment, so a self-crossing freehand loop still has a well-defined inside. */
export function inside(p: Poly, x: number, y: number): boolean {
  let c = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i]!, yi = p[2 * i + 1]!, xj = p[2 * j]!, yj = p[2 * j + 1]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Nearest point on the polygon's boundary to (x, y). */
export function nearestOnBoundary(p: Poly, x: number, y: number): [number, number, number] {
  let best = Infinity, bx = x, by = y;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = p[2 * i]!, ay = p[2 * i + 1]!, dx = p[2 * j]! - ax, dy = p[2 * j + 1]! - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx, qy = ay + t * dy;
    const d = (qx - x) ** 2 + (qy - y) ** 2;
    if (d < best) { best = d; bx = qx; by = qy; }
  }
  return [bx, by, Math.sqrt(best)];
}

export function bbox(p: Poly): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    x0 = Math.min(x0, p[i]!); x1 = Math.max(x1, p[i]!);
    y0 = Math.min(y0, p[i + 1]!); y1 = Math.max(y1, p[i + 1]!);
  }
  return [x0, y0, x1, y1];
}

/** Resample a closed stroke to points spaced `step` apart along its length. */
export function resample(p: Poly, step: number): Poly {
  const n = p.length / 2;
  if (n < 3) return p.slice();
  const out: Poly = [p[0]!, p[1]!];
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = p[2 * i]!, ay = p[2 * i + 1]!, bx = p[2 * j]!, by = p[2 * j + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    let s = step - carry;
    while (s <= len) {
      const t = s / len;
      out.push(ax + t * (bx - ax), ay + t * (by - ay));
      s += step;
    }
    carry = len - (s - step);
  }
  // Drop a closing point that lands on top of the first.
  const m = out.length / 2;
  if (m > 3 && Math.hypot(out[2 * m - 2]! - out[0]!, out[2 * m - 1]! - out[1]!) < step * 0.5) out.length -= 2;
  return out;
}

/** Light smoothing of a resampled freehand loop (keeps the hand-drawn character, removes jitter). */
export function smooth(p: Poly, passes: number): Poly {
  let a = p.slice();
  const n = a.length / 2;
  for (let k = 0; k < passes; k++) {
    const b = a.slice();
    for (let i = 0; i < n; i++) {
      const h = (i + n - 1) % n, j = (i + 1) % n;
      b[2 * i] = 0.25 * a[2 * h]! + 0.5 * a[2 * i]! + 0.25 * a[2 * j]!;
      b[2 * i + 1] = 0.25 * a[2 * h + 1]! + 0.5 * a[2 * i + 1]! + 0.25 * a[2 * j + 1]!;
    }
    a = b;
  }
  return a;
}
