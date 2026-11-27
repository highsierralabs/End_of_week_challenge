// Geometry of the exact shapes: the plane sets of prisms and cut gems, each shape's scale,
// bounds and surface area, and a CPU ray intersection that mirrors the shader's (used for
// picking, focusing and unit tests).
import type { GemCut, Shape } from './scene';
import { type Vec3, cross, dot, norm, sub } from './vec';

/** A half-space n.p <= d with unit n, as [nx, ny, nz, d]. */
export type Plane = [number, number, number, number];

const RAD = Math.PI / 180;

function planeFrom(a: Vec3, b: Vec3, c: Vec3): Plane {
  let n = norm(cross(sub(b, a), sub(c, a)));
  let d = dot(n, a);
  if (d < 0) { n = [-n[0], -n[1], -n[2]]; d = -d; }
  return [n[0], n[1], n[2], d];
}

const polar = (azDeg: number, rho: number, y: number): Vec3 => [rho * Math.cos(azDeg * RAD), y, rho * Math.sin(azDeg * RAD)];

/** Proportions of the round brilliant, in units of the girdle radius. */
export const BRILLIANT = {
  table: 0.56,
  crownAngle: 34.5,
  pavilionAngle: 40.8,
  girdleHalf: 0.03,
  starLength: 0.5,
  lowerHalfLength: 0.77,
} as const;

/**
 * The standard round brilliant as a convex polytope: table, 8 stars, 8 kites, 16 upper girdle
 * facets, a 16-sided girdle, 16 lower girdle facets and 8 pavilion mains (73 planes), girdle
 * radius 1 at the facet junctions. Also returns the facet junctions, for tests.
 */
export function brilliantCut(): { planes: Plane[]; vertices: Vec3[] } {
  const B = BRILLIANT;
  const tb = Math.tan(B.crownAngle * RAD);
  const tg = Math.tan(B.pavilionAngle * RAD);
  const gh = B.girdleHalf;
  const D = 22.5;
  const cD = Math.cos(D * RAD);
  const yT = gh + (1 - B.table) * tb;
  const planes: Plane[] = [[0, 1, 0, yT]];
  const vertices: Vec3[] = [];
  const rhoTip = B.table * cD + B.starLength * (1 - B.table * cD);
  const yTip = gh + (1 - rhoTip * cD) * tb;
  const rhoP = 1 - B.lowerHalfLength;
  const yP = -gh - tg * (1 - rhoP * cD);
  vertices.push([0, -(tg + gh), 0]);
  for (let k = 0; k < 8; k++) {
    const a = k * 45;
    const sb = Math.sin(B.crownAngle * RAD);
    const cb = Math.cos(B.crownAngle * RAD);
    // Kite (bezel) facet.
    planes.push([sb * Math.cos(a * RAD), cb, sb * Math.sin(a * RAD), sb + cb * gh]);
    const v0 = polar(a, B.table, yT);
    const v1 = polar(a + 45, B.table, yT);
    const tip = polar(a + D, rhoTip, yTip);
    const g0 = polar(a, 1, gh);
    const gm = polar(a + D, 1, gh);
    const g1 = polar(a + 45, 1, gh);
    planes.push(planeFrom(v0, v1, tip)); // star
    planes.push(planeFrom(tip, g0, gm), planeFrom(tip, g1, gm)); // upper girdle pair
    // Pavilion main.
    const sg = Math.sin(B.pavilionAngle * RAD);
    const cg = Math.cos(B.pavilionAngle * RAD);
    planes.push([sg * Math.cos(a * RAD), -cg, sg * Math.sin(a * RAD), sg + cg * gh]);
    const p = polar(a + D, rhoP, yP);
    const b0 = polar(a, 1, -gh);
    const bm = polar(a + D, 1, -gh);
    const b1 = polar(a + 45, 1, -gh);
    planes.push(planeFrom(p, b0, bm), planeFrom(p, b1, bm)); // lower girdle pair
    vertices.push(v0, tip, g0, gm, p, b0, bm);
  }
  const c = Math.cos((D / 2) * RAD);
  for (let j = 0; j < 16; j++) {
    const a = (j + 0.5) * D;
    planes.push([Math.cos(a * RAD), 0, Math.sin(a * RAD), c]);
  }
  return { planes, vertices };
}

/** A step ("emerald") cut: an octagonal outline with three crown and three pavilion tiers. */
export function stepCut(): Plane[] {
  const a = 1;
  const b = 0.72;
  const corner = 0.28;
  const gh = 0.035;
  const s = Math.SQRT1_2;
  const outline: [number, number, number][] = [
    [1, 0, a], [-1, 0, a], [0, 1, b], [0, -1, b],
    [s, s, (a + b - corner) * s], [s, -s, (a + b - corner) * s], [-s, s, (a + b - corner) * s], [-s, -s, (a + b - corner) * s],
  ];
  const planes: Plane[] = [];
  const tiers = (angles: number[], heights: number[], sign: 1 | -1) => {
    let inset = 0;
    let y = gh;
    for (let i = 0; i < angles.length; i++) {
      const sa = Math.sin(angles[i]! * RAD);
      const ca = Math.cos(angles[i]! * RAD);
      for (const [nx, nz, d] of outline) planes.push([sa * nx, sign * ca, sa * nz, sa * (d - inset) + ca * y]);
      inset += heights[i]! / Math.tan(angles[i]! * RAD);
      y += heights[i]!;
    }
    return y;
  };
  const top = tiers([52, 40, 28], [0.1, 0.09, 0.07], 1);
  planes.push([0, 1, 0, top]);
  tiers([62, 50, 40], [0.22, 0.2, 0.6], -1);
  for (const [nx, nz, d] of outline) planes.push([nx, 0, nz, d]);
  return planes;
}

export function octahedron(): Plane[] {
  const s = 1 / Math.sqrt(3);
  const planes: Plane[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) planes.push([x * s, y * s, z * s, s]);
  return planes;
}

function gemPlanes(cut: GemCut): Plane[] {
  if (cut === 'brilliant') return brilliantCut().planes;
  if (cut === 'step') return stepCut();
  return octahedron();
}

/** Planes of a prism in object space (metres). */
export function prismPlanes(sides: number, apexDeg: number, size: number, h: number): Plane[] {
  const planes: Plane[] = [[0, 0, 1, h], [0, 0, -1, h]];
  if (sides <= 3) {
    const half = (apexDeg / 2) * RAD;
    const d = Math.sin(half) * (2 * size) / 3;
    planes.push([0, -1, 0, size / 3], [Math.cos(half), Math.sin(half), 0, d], [-Math.cos(half), Math.sin(half), 0, d]);
  } else {
    const inr = size * Math.cos(Math.PI / sides);
    for (let k = 0; k < sides; k++) {
      // A face down, so the prism rests on the table.
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / sides;
      planes.push([Math.cos(a), Math.sin(a), 0, inr]);
    }
  }
  return planes;
}

/** Plane set of a polytope shape in object space, or null for other shapes. */
export function shapePlanes(shape: Shape): Plane[] | null {
  if (shape.kind === 'prism') return prismPlanes(shape.sides, shape.apex, shape.size, shape.h);
  if (shape.kind === 'gem') return gemPlanes(shape.cut).map((p) => [p[0], p[1], p[2], p[3] * shape.r] as Plane);
  return null;
}

/** Per-axis scale from the canonical shape to object space. */
export function shapeScale(shape: Shape): Vec3 {
  switch (shape.kind) {
    case 'sphere': return [shape.r, shape.r, shape.r];
    case 'box': return [shape.half[0], shape.half[1], shape.half[2]];
    case 'cylinder': return [shape.r, shape.h, shape.r];
    case 'quad': return [shape.half[0], 1, shape.half[1]];
    case 'disc': return [shape.r, 1, shape.r];
    case 'mesh': return [shape.size, shape.size, shape.size];
    default: return [1, 1, 1];
  }
}

/** Sag of a spherical cap of curvature radius R over an aperture of radius r. */
export function lensSag(R: number, r: number): number {
  if (R === 0) return 0;
  const a = Math.abs(R);
  const s = a - Math.sqrt(Math.max(0, a * a - r * r));
  return R > 0 ? s : -s;
}

/** Radius of a sphere about the object's origin that contains it. */
export function boundRadius(shape: Shape): number {
  switch (shape.kind) {
    case 'sphere': return shape.r;
    case 'box': return Math.hypot(shape.half[0], shape.half[1], shape.half[2]);
    case 'cylinder': return Math.hypot(shape.r, shape.h);
    case 'quad': return Math.hypot(shape.half[0], shape.half[1]);
    case 'disc': return shape.r;
    case 'prism': {
      const r = shape.sides <= 3 ? Math.max((2 * shape.size) / 3, Math.hypot(shape.size / 3, shape.size * Math.tan((shape.apex / 2) * RAD))) : shape.size;
      return Math.hypot(r, shape.h);
    }
    case 'gem': return shape.r * (shape.cut === 'step' ? 1.45 : 1.1);
    case 'lens': {
      // Concave faces make the edge thicker than the centre.
      const edge = shape.t / 2 + Math.max(0, -lensSag(shape.r1, shape.r), -lensSag(shape.r2, shape.r));
      return Math.hypot(shape.r, Math.max(edge, shape.t / 2));
    }
    case 'mesh': return shape.size * 0.8661; // half diagonal of a unit cube, just over
  }
}

/** Lowest point of the shape below its origin when unrotated: how high to put it to rest on y = 0. */
export function restHeight(shape: Shape): number {
  switch (shape.kind) {
    case 'sphere': return shape.r;
    case 'box': return shape.half[1];
    case 'cylinder': return shape.h;
    case 'quad': case 'disc': return 0;
    case 'prism': return shape.sides <= 3 ? shape.size / 3 : shape.size * Math.cos(Math.PI / shape.sides);
    case 'gem': return shape.r * (shape.cut === 'brilliant' ? Math.tan(BRILLIANT.pavilionAngle * RAD) + BRILLIANT.girdleHalf : shape.cut === 'step' ? 1.055 : 1);
    case 'lens': return shape.t / 2 + Math.max(0, -lensSag(shape.r2, shape.r));
    case 'mesh': return 0;
  }
}

/** World surface area of a shape that can be an emitter the tracer samples, else 0. */
export function emitterArea(shape: Shape): number {
  switch (shape.kind) {
    case 'sphere': return 4 * Math.PI * shape.r * shape.r;
    case 'quad': return 4 * shape.half[0] * shape.half[1];
    case 'disc': return Math.PI * shape.r * shape.r;
    case 'cylinder': return 4 * Math.PI * shape.r * shape.h + 2 * Math.PI * shape.r * shape.r;
    case 'box': return 8 * (shape.half[0] * shape.half[1] + shape.half[1] * shape.half[2] + shape.half[0] * shape.half[2]);
    default: return 0;
  }
}

export interface Hit {
  t: number;
  /** Outward geometric normal in object space (not normalised under non-uniform scale). */
  n: Vec3;
}

const EPS = 1e-9;

/** Nearest boundary crossing of a convex polytope along the ray with t > tmin. */
export function hitPolytope(planes: Plane[], o: Vec3, d: Vec3, tmin: number): Hit | null {
  let t0 = -Infinity;
  let t1 = Infinity;
  let n0: Vec3 = [0, 0, 0];
  let n1: Vec3 = [0, 0, 0];
  for (const p of planes) {
    const n: Vec3 = [p[0], p[1], p[2]];
    const dn = dot(n, d);
    const dist = p[3] - dot(n, o);
    if (Math.abs(dn) < EPS) {
      if (dist < 0) return null;
      continue;
    }
    const t = dist / dn;
    if (dn < 0) { if (t > t0) { t0 = t; n0 = n; } } else if (t < t1) { t1 = t; n1 = n; }
  }
  if (t0 > t1) return null;
  if (t0 > tmin) return { t: t0, n: n0 };
  if (t1 > tmin && t1 < Infinity) return { t: t1, n: n1 };
  return null;
}

/**
 * Lens on the y axis: aperture radius ra, centre thickness tc, top face curvature R1, bottom R2
 * (positive convex, negative concave, 0 flat). Each candidate surface crossing is kept only if
 * it lies on the lens boundary; the nearest with t > tmin wins.
 */
export function hitLens(ra: number, tc: number, R1: number, R2: number, o: Vec3, d: Vec3, tmin: number): Hit | null {
  const c1 = tc / 2 - R1;
  const c2 = -tc / 2 + R2;
  const within = (p: Vec3, skip: number): boolean => {
    if (skip !== 0 && p[0] * p[0] + p[2] * p[2] > ra * ra * (1 + 1e-9)) return false;
    if (skip !== 1) {
      if (R1 === 0) { if (p[1] > tc / 2) return false; } else {
        const q = p[0] * p[0] + (p[1] - c1) * (p[1] - c1) + p[2] * p[2] - R1 * R1;
        if (R1 > 0 ? q > 0 : q < 0 || p[1] > c1) return false;
      }
    }
    if (skip !== 2) {
      if (R2 === 0) { if (p[1] < -tc / 2) return false; } else {
        const q = p[0] * p[0] + (p[1] - c2) * (p[1] - c2) + p[2] * p[2] - R2 * R2;
        if (R2 > 0 ? q > 0 : q < 0 || p[1] < c2) return false;
      }
    }
    return true;
  };
  let best: Hit | null = null;
  const consider = (t: number, which: number) => {
    if (!(t > tmin) || (best && t >= best.t)) return;
    const p: Vec3 = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
    if (which === 1 && R1 !== 0 && (p[1] - c1) * R1 < 0) return; // wrong cap of the sphere
    if (which === 2 && R2 !== 0 && (p[1] - c2) * R2 > 0) return;
    if (!within(p, which)) return;
    let n: Vec3;
    if (which === 0) n = [p[0], 0, p[2]];
    else if (which === 1) n = R1 === 0 ? [0, 1, 0] : [p[0] / R1, (p[1] - c1) / R1, p[2] / R1];
    else n = R2 === 0 ? [0, -1, 0] : [p[0] / R2, (p[1] - c2) / R2, p[2] / R2];
    best = { t, n };
  };
  // Side cylinder.
  {
    const a = d[0] * d[0] + d[2] * d[2];
    if (a > EPS) {
      const b = o[0] * d[0] + o[2] * d[2];
      const c = o[0] * o[0] + o[2] * o[2] - ra * ra;
      const disc = b * b - a * c;
      if (disc >= 0) { const s = Math.sqrt(disc); consider((-b - s) / a, 0); consider((-b + s) / a, 0); }
    }
  }
  const sphere = (cy: number, R: number, which: number) => {
    const oc: Vec3 = [o[0], o[1] - cy, o[2]];
    const a = dot(d, d);
    const b = dot(oc, d);
    const c = dot(oc, oc) - R * R;
    const disc = b * b - a * c;
    if (disc < 0) return;
    const s = Math.sqrt(disc);
    consider((-b - s) / a, which);
    consider((-b + s) / a, which);
  };
  if (R1 === 0) { if (Math.abs(d[1]) > EPS) consider((tc / 2 - o[1]) / d[1], 1); } else sphere(c1, R1, 1);
  if (R2 === 0) { if (Math.abs(d[1]) > EPS) consider((-tc / 2 - o[1]) / d[1], 2); } else sphere(c2, R2, 2);
  return best;
}

/** Ray against the canonical shape in object space (the ray already transformed). */
export function hitCanonical(shape: Shape, planes: Plane[] | null, o: Vec3, d: Vec3, tmin: number): Hit | null {
  switch (shape.kind) {
    case 'sphere': {
      const a = dot(d, d);
      const b = dot(o, d);
      const c = dot(o, o) - 1;
      const disc = b * b - a * c;
      if (disc < 0) return null;
      const s = Math.sqrt(disc);
      let t = (-b - s) / a;
      if (t <= tmin) t = (-b + s) / a;
      if (t <= tmin) return null;
      return { t, n: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] };
    }
    case 'box': {
      let t0 = -Infinity;
      let t1 = Infinity;
      let a0 = 0;
      let a1 = 0;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(d[k]!) < EPS) { if (Math.abs(o[k]!) > 1) return null; continue; }
        let ta = (-1 - o[k]!) / d[k]!;
        let tb = (1 - o[k]!) / d[k]!;
        if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) { t0 = ta; a0 = k; }
        if (tb < t1) { t1 = tb; a1 = k; }
      }
      if (t0 > t1) return null;
      const pick = (t: number, axis: number): Hit => {
        const n: Vec3 = [0, 0, 0];
        n[axis] = Math.sign(o[axis]! + d[axis]! * t);
        return { t, n };
      };
      if (t0 > tmin) return pick(t0, a0);
      if (t1 > tmin && t1 < Infinity) return pick(t1, a1);
      return null;
    }
    case 'cylinder': {
      let best: Hit | null = null;
      const a = d[0] * d[0] + d[2] * d[2];
      if (a > EPS) {
        const b = o[0] * d[0] + o[2] * d[2];
        const c = o[0] * o[0] + o[2] * o[2] - 1;
        const disc = b * b - a * c;
        if (disc >= 0) {
          const s = Math.sqrt(disc);
          for (const t of [(-b - s) / a, (-b + s) / a]) {
            const y = o[1] + d[1] * t;
            if (t > tmin && Math.abs(y) <= 1 && (!best || t < best.t)) best = { t, n: [o[0] + d[0] * t, 0, o[2] + d[2] * t] };
          }
        }
      }
      if (Math.abs(d[1]) > EPS) {
        for (const sgn of [-1, 1]) {
          const t = (sgn - o[1]) / d[1];
          const x = o[0] + d[0] * t;
          const z = o[2] + d[2] * t;
          if (t > tmin && x * x + z * z <= 1 && (!best || t < best.t)) best = { t, n: [0, sgn, 0] };
        }
      }
      return best;
    }
    case 'quad': case 'disc': {
      if (Math.abs(d[1]) < EPS) return null;
      const t = -o[1] / d[1];
      if (t <= tmin) return null;
      const x = o[0] + d[0] * t;
      const z = o[2] + d[2] * t;
      if (shape.kind === 'quad' ? Math.abs(x) > 1 || Math.abs(z) > 1 : x * x + z * z > 1) return null;
      return { t, n: [0, 1, 0] };
    }
    case 'prism': case 'gem': return hitPolytope(planes ?? [], o, d, tmin);
    case 'lens': return hitLens(shape.r, shape.t, shape.r1, shape.r2, o, d, tmin);
    case 'mesh': return null; // meshes are intersected through their BVH (see bvh.ts)
  }
}
