// The mesh kit: every solid in the machine is made here, once, and the same triangles are drawn
// on screen and written to STL. Solids are closed and consistently oriented (outward normals).
import earcut from 'earcut';
import { type Mesh, type Region, type Ring, type Vec2, type Vec3 } from './types';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- rings

/** Signed area of a ring: positive when counter-clockwise. */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function reversed(ring: Ring): Ring {
  return ring.slice().reverse();
}

/** The ring wound counter-clockwise. */
export function ccw(ring: Ring): Ring {
  return ringArea(ring) < 0 ? reversed(ring) : ring;
}

/** A regular polygon approximating a circle, counter-clockwise, first point on +X rotated by `phase`. */
export function circle(radius: number, segments: number, cx = 0, cy = 0, phase = 0): Ring {
  const out: Ring = [];
  for (let i = 0; i < segments; i++) {
    const a = phase + (i / segments) * TAU;
    out.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return out;
}

/** Number of segments that keeps a circle's chord error under `tol` mm, within [min, max], a multiple of 4. */
export function segmentsFor(radius: number, tol = 0.02, min = 16, max = 160): number {
  if (radius <= tol) return min;
  const n = Math.ceil(Math.PI / Math.acos(Math.max(-1, Math.min(1, 1 - tol / radius))));
  return Math.max(min, Math.min(max, Math.ceil(n / 4) * 4));
}

/** A rectangle with rounded corners, counter-clockwise, centred on (cx, cy). */
export function roundedRect(w: number, h: number, r: number, cx = 0, cy = 0, cornerSegments = 6): Ring {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const out: Ring = [];
  const corners: [number, number, number][] = [
    [cx + w / 2 - rr, cy + h / 2 - rr, 0],
    [cx - w / 2 + rr, cy + h / 2 - rr, Math.PI / 2],
    [cx - w / 2 + rr, cy - h / 2 + rr, Math.PI],
    [cx + w / 2 - rr, cy - h / 2 + rr, (3 * Math.PI) / 2],
  ];
  for (const [x, y, a0] of corners) {
    if (rr === 0) { out.push([x, y]); continue; }
    for (let i = 0; i <= cornerSegments; i++) {
      const a = a0 + (i / cornerSegments) * (Math.PI / 2);
      out.push([x + rr * Math.cos(a), y + rr * Math.sin(a)]);
    }
  }
  return out;
}

/** Trim `d` of arc length from the start of a polyline. */
function trimStart(line: Vec2[], d: number): Vec2[] {
  let left = d;
  for (let i = 0; i + 1 < line.length; i++) {
    const p = line[i]!;
    const q = line[i + 1]!;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len > left) {
      const t = left / len;
      return [[p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], ...line.slice(i + 1)];
    }
    left -= len;
  }
  return [line[line.length - 1]!];
}

function polylineLength(line: Vec2[]): number {
  let s = 0;
  for (let i = 0; i + 1 < line.length; i++) s += Math.hypot(line[i + 1]![0] - line[i]![0], line[i + 1]![1] - line[i]![1]);
  return s;
}

/**
 * Join open polylines end to start into one ring, rounding each junction: `d` of length is cut
 * from both sides of the corner and replaced by a curve that is tangent to both.
 */
export function joinRounded(sides: Vec2[][], d: number, cornerPoints = 6): Ring {
  const n = sides.length;
  const lengths = sides.map(polylineLength);
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const prev = (i + n - 1) % n;
    const next = (i + 1) % n;
    const dIn = Math.min(d, 0.45 * lengths[i]!, 0.45 * lengths[prev]!);
    const dOut = Math.min(d, 0.45 * lengths[i]!, 0.45 * lengths[next]!);
    let line = sides[i]!;
    if (dIn > 0) line = trimStart(line, dIn);
    if (dOut > 0) line = trimStart(line.slice().reverse(), dOut).reverse();
    out.push(...line);
    if (dOut > 0) {
      const corner = sides[i]![sides[i]!.length - 1]!;
      const from = line[line.length - 1]!;
      const to = trimStart(sides[next]!, dOut)[0]!;
      for (let k = 1; k < cornerPoints; k++) {
        const t = k / cornerPoints;
        const u = 1 - t;
        out.push([
          u * u * from[0] + 2 * u * t * corner[0] + t * t * to[0],
          u * u * from[1] + 2 * u * t * corner[1] + t * t * to[1],
        ]);
      }
    }
  }
  return dedupe(out);
}

function arcPoints(r: number, from: number, to: number, tol: number): Vec2[] {
  const step = 2 * Math.acos(Math.max(0, 1 - tol / Math.max(r, tol * 2)));
  const n = Math.max(2, Math.ceil(Math.abs(to - from) / step));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

/**
 * The window between two spokes of a crossed-out wheel: bounded by circles r0 and r1 and by the
 * flanks of straight spokes of width `spokeWidth` centred on angles a0 and a1 (a1 > a0), with
 * rounded corners. Counter-clockwise.
 */
export function spokeWindow(r0: number, r1: number, a0: number, a1: number, spokeWidth: number, corner: number, arcTol = 0.03): Ring {
  const h = spokeWidth / 2;
  // Angle at which a line parallel to a spoke, offset by h, crosses the circle of radius r.
  const off = (r: number) => Math.asin(Math.min(1, h / r));
  const outer = arcPoints(r1, a0 + off(r1), a1 - off(r1), arcTol);
  const inner = arcPoints(r0, a1 - off(r0), a0 + off(r0), arcTol);
  const sideA: Vec2[] = [outer[outer.length - 1]!, inner[0]!];
  const sideB: Vec2[] = [inner[inner.length - 1]!, outer[0]!];
  return joinRounded([outer, sideA, inner, sideB], corner);
}

function dedupe(ring: Ring, eps = 1e-7): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p);
  }
  const f = out[0];
  const l = out[out.length - 1];
  if (f && l && out.length > 1 && Math.hypot(f[0] - l[0], f[1] - l[1]) <= eps) out.pop();
  return out;
}

/** The ring without points that lie on the straight line between their neighbours. */
export function withoutCollinear(ring: Ring, eps = 1e-9): Ring {
  let pts = ring;
  for (let pass = 0; pass < 4; pass++) {
    const out: Ring = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = out.length ? out[out.length - 1]! : pts[(i + n - 1) % n]!;
      const p = pts[i]!;
      const b = pts[(i + 1) % n]!;
      const cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]);
      if (Math.abs(cross) > eps) out.push(p);
    }
    if (out.length === pts.length || out.length < 3) break;
    pts = out;
  }
  return pts;
}

export function translateRing(ring: Ring, dx: number, dy: number): Ring {
  return ring.map(([x, y]) => [x + dx, y + dy] as Vec2);
}

export function rotateRing(ring: Ring, angle: number): Ring {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return ring.map(([x, y]) => [x * c - y * s, x * s + y * c] as Vec2);
}

// ---------------------------------------------------------------- mesh building

class Builder {
  pos: number[] = [];
  idx: number[] = [];
  v(x: number, y: number, z: number): number {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }
  mesh(): Mesh {
    return { positions: Float64Array.from(this.pos), indices: Uint32Array.from(this.idx) };
  }
}

export function emptyMesh(): Mesh {
  return { positions: new Float64Array(0), indices: new Uint32Array(0) };
}

/**
 * A prism: the region swept from z0 to z1. `scale1` scales the top ring about `about` (a taper);
 * both caps share the bottom's triangulation, so the solid stays closed.
 */
export function extrude(region: Region, z0: number, z1: number, scale1 = 1, about: Vec2 = [0, 0]): Mesh {
  // The triangulator drops points that lie on a straight line between their neighbours; the walls
  // must be built from the same points as the caps or the solid would not close.
  const outer = withoutCollinear(ccw(region.outer));
  const holes = region.holes.map((h) => reversed(withoutCollinear(ccw(h))));
  const rings = [outer, ...holes];
  const flat: number[] = [];
  const holeStarts: number[] = [];
  for (let i = 0; i < rings.length; i++) {
    if (i > 0) holeStarts.push(flat.length / 2);
    for (const p of rings[i]!) flat.push(p[0], p[1]);
  }
  const n = flat.length / 2;
  const tris = earcut(flat, holeStarts, 2);
  const b = new Builder();
  for (let i = 0; i < n; i++) b.v(flat[2 * i]!, flat[2 * i + 1]!, z0);
  for (let i = 0; i < n; i++) {
    b.v(about[0] + (flat[2 * i]! - about[0]) * scale1, about[1] + (flat[2 * i + 1]! - about[1]) * scale1, z1);
  }
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]!;
    const c = tris[t + 1]!;
    const d = tris[t + 2]!;
    // earcut returns triangles wound like the outer ring (counter-clockwise): the top faces +Z.
    b.tri(a + n, c + n, d + n);
    b.tri(a, d, c);
  }
  let start = 0;
  for (const ring of rings) {
    const m = ring.length;
    for (let i = 0; i < m; i++) {
      const a = start + i;
      const c = start + ((i + 1) % m);
      b.quad(a, c, c + n, a + n);
    }
    start += m;
  }
  return b.mesh();
}

/**
 * A solid of revolution about Z. `profile` is a closed loop of (r, z) points, counter-clockwise in
 * the (r, z) half-plane (r to the right, z up). Points with r = 0 collapse to a single vertex.
 */
export function lathe(profile: Vec2[], segments: number): Mesh {
  const loop = ringArea(profile) < 0 ? profile.slice().reverse() : profile;
  const b = new Builder();
  const m = loop.length;
  const first: number[] = [];
  const onAxis: boolean[] = [];
  for (const [r, z] of loop) {
    const axis = Math.abs(r) < 1e-9;
    onAxis.push(axis);
    if (axis) {
      first.push(b.v(0, 0, z));
    } else {
      first.push(b.pos.length / 3);
      for (let s = 0; s < segments; s++) {
        const a = (s / segments) * TAU;
        b.v(r * Math.cos(a), r * Math.sin(a), z);
      }
    }
  }
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const ai = onAxis[i]!;
    const aj = onAxis[j]!;
    if (ai && aj) continue;
    for (let s = 0; s < segments; s++) {
      const t = (s + 1) % segments;
      if (ai) b.tri(first[i]!, first[j]! + t, first[j]! + s);
      else if (aj) b.tri(first[i]! + s, first[i]! + t, first[j]!);
      else b.quad(first[i]! + s, first[i]! + t, first[j]! + t, first[j]! + s);
    }
  }
  return b.mesh();
}

/** A solid cylinder on the Z axis. */
export function cylinder(radius: number, z0: number, z1: number, segments = segmentsFor(radius)): Mesh {
  return lathe([[0, z0], [radius, z0], [radius, z1], [0, z1]], segments);
}

/** A tube on the Z axis. */
export function tube(rOuter: number, rInner: number, z0: number, z1: number, segments = segmentsFor(rOuter)): Mesh {
  if (rInner <= 0) return cylinder(rOuter, z0, z1, segments);
  return lathe([[rInner, z0], [rOuter, z0], [rOuter, z1], [rInner, z1]], segments);
}

/** A sphere centred on (0, 0, cz). */
export function sphere(radius: number, cz = 0, segments = segmentsFor(radius, 0.01, 24, 64)): Mesh {
  const rings = Math.max(6, Math.round(segments / 2));
  const profile: Vec2[] = [];
  for (let i = 0; i <= rings; i++) {
    const a = -Math.PI / 2 + (i / rings) * Math.PI;
    profile.push([i === 0 || i === rings ? 0 : radius * Math.cos(a), cz + radius * Math.sin(a)]);
  }
  return lathe(profile, segments);
}

/** An axis-aligned box. */
export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Mesh {
  return extrude({ outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] }, z0, z1);
}

// ---------------------------------------------------------------- transforms

/** Row-major 3x4 affine transform. */
export type Affine = readonly [number, number, number, number, number, number, number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

export function translation(x: number, y: number, z: number): Affine {
  return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
}

export function rotationZ(a: number): Affine {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0];
}

export function rotationX(a: number): Affine {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0];
}

export function rotationY(a: number): Affine {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0];
}

/** The transform that applies `b` first, then `a`. */
export function compose(a: Affine, b: Affine): Affine {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      let v = c === 3 ? a[r * 4 + 3]! : 0;
      for (let k = 0; k < 3; k++) v += a[r * 4 + k]! * b[k * 4 + c]!;
      out.push(v);
    }
  }
  return out as unknown as Affine;
}

export function applyPoint(m: Affine, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

/** A transformed copy. The transform must be a rotation and translation (no mirroring). */
export function transformed(mesh: Mesh, m: Affine): Mesh {
  const src = mesh.positions;
  const pos = new Float64Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i]!;
    const y = src[i + 1]!;
    const z = src[i + 2]!;
    pos[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
    pos[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    pos[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return { positions: pos, indices: mesh.indices };
}

/** Several solids as one mesh. The shells stay separate: they may overlap, which slicers unite. */
export function merge(meshes: readonly Mesh[]): Mesh {
  let np = 0;
  let ni = 0;
  for (const m of meshes) { np += m.positions.length; ni += m.indices.length; }
  const positions = new Float64Array(np);
  const indices = new Uint32Array(ni);
  let po = 0;
  let io = 0;
  for (const m of meshes) {
    positions.set(m.positions, po);
    const base = po / 3;
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i]! + base;
    po += m.positions.length;
    io += m.indices.length;
  }
  return { positions, indices };
}

// ---------------------------------------------------------------- measures and checks

export interface MeshStats {
  triangles: number;
  volume: number;
  area: number;
  min: Vec3;
  max: Vec3;
}

export function meshStats(mesh: Mesh): MeshStats {
  const p = mesh.positions;
  const ix = mesh.indices;
  let vol = 0;
  let area = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t]! * 3;
    const b = ix[t + 1]! * 3;
    const c = ix[t + 2]! * 3;
    const ax = p[a]!, ay = p[a + 1]!, az = p[a + 2]!;
    const bx = p[b]!, by = p[b + 1]!, bz = p[b + 2]!;
    const cx = p[c]!, cy = p[c + 1]!, cz = p[c + 2]!;
    vol += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k]!;
      if (v < min[k]!) min[k] = v;
      if (v > max[k]!) max[k] = v;
    }
  }
  return { triangles: ix.length / 3, volume: vol / 6, area, min, max };
}

export interface ClosedReport {
  /** Every edge is used by exactly two triangles, in opposite directions. */
  closed: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  /** Edges whose two triangles traverse them the same way (inconsistent winding). */
  flippedEdges: number;
  degenerateTriangles: number;
  weldedVertices: number;
}

/** Weld vertices closer than `tol` and test the result for being a closed, oriented surface. */
export function checkClosed(mesh: Mesh, tol = 1e-6): ClosedReport {
  const p = mesh.positions;
  const ids = new Uint32Array(p.length / 3);
  const map = new Map<string, number>();
  let welded = 0;
  for (let i = 0; i < ids.length; i++) {
    const key = `${Math.round(p[3 * i]! / tol)},${Math.round(p[3 * i + 1]! / tol)},${Math.round(p[3 * i + 2]! / tol)}`;
    let id = map.get(key);
    if (id === undefined) { id = welded++; map.set(key, id); }
    ids[i] = id;
  }
  const edges = new Map<number, number[]>();
  let degenerate = 0;
  const ix = mesh.indices;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ids[ix[t]!]!;
    const b = ids[ix[t + 1]!]!;
    const c = ids[ix[t + 2]!]!;
    if (a === b || b === c || a === c) { degenerate++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const lo = Math.min(u, v);
      const hi = Math.max(u, v);
      const key = lo * welded + hi;
      const e = edges.get(key);
      const dir = u < v ? 1 : -1;
      if (e) e.push(dir); else edges.set(key, [dir]);
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  let flipped = 0;
  for (const e of edges.values()) {
    if (e.length === 1) boundary++;
    else if (e.length > 2) {
      // An even fan with balanced directions is two shells touching along an edge: tolerate it.
      const sum = e.reduce((s, d) => s + d, 0);
      if (e.length % 2 !== 0 || sum !== 0) nonManifold++;
    } else if (e[0]! + e[1]! !== 0) flipped++;
  }
  return {
    closed: boundary === 0 && nonManifold === 0 && flipped === 0,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    flippedEdges: flipped,
    degenerateTriangles: degenerate,
    weldedVertices: welded,
  };
}

// ---------------------------------------------------------------- STL

/** Binary STL of the mesh, in millimetres. */
export function toBinaryStl(mesh: Mesh, name = 'wheelwork'): Uint8Array {
  const tris = mesh.indices.length / 3;
  const out = new Uint8Array(84 + tris * 50);
  const view = new DataView(out.buffer);
  for (let i = 0; i < Math.min(79, name.length); i++) out[i] = name.charCodeAt(i) & 0x7f;
  view.setUint32(80, tris, true);
  const p = mesh.positions;
  let o = 84;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t]! * 3;
    const b = mesh.indices[t + 1]! * 3;
    const c = mesh.indices[t + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const k of [a, b, c]) {
      view.setFloat32(o, p[k]!, true); view.setFloat32(o + 4, p[k + 1]!, true); view.setFloat32(o + 8, p[k + 2]!, true);
      o += 12;
    }
    o += 2;
  }
  return out;
}

/** Read a binary STL back (vertices are not shared in the result). */
export function parseBinaryStl(bytes: Uint8Array): Mesh {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tris = view.getUint32(80, true);
  const positions = new Float64Array(tris * 9);
  const indices = new Uint32Array(tris * 3);
  let o = 84;
  for (let t = 0; t < tris; t++) {
    o += 12;
    for (let k = 0; k < 9; k++) { positions[t * 9 + k] = view.getFloat32(o, true); o += 4; }
    o += 2;
    indices[t * 3] = t * 3; indices[t * 3 + 1] = t * 3 + 1; indices[t * 3 + 2] = t * 3 + 2;
  }
  return { positions, indices };
}

/**
 * A partial solid of revolution about Z: the closed (r, z) profile swept from angle a0 to a1, with
 * flat caps at both ends. The profile must not touch the axis.
 */
export function revolve(profile: Vec2[], a0: number, a1: number, segments: number): Mesh {
  const loop = ringArea(profile) < 0 ? profile.slice().reverse() : profile;
  const m = loop.length;
  const b = new Builder();
  for (let s = 0; s <= segments; s++) {
    const a = a0 + ((a1 - a0) * s) / segments;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    for (const [r, z] of loop) b.v(r * c, r * sn, z);
  }
  for (let s = 0; s < segments; s++) {
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const p = s * m + i;
      const q = s * m + j;
      b.quad(p, p + m, q + m, q);
    }
  }
  const flat: number[] = [];
  for (const [r, z] of loop) flat.push(r, z);
  const tris = earcut(flat, [], 2);
  const last = segments * m;
  for (let t = 0; t < tris.length; t += 3) {
    const i = tris[t]!;
    const j = tris[t + 1]!;
    const k = tris[t + 2]!;
    // The profile is counter-clockwise in (r, z); seen from the start cap's outside it runs the other way.
    b.tri(i, j, k);
    b.tri(last + i, last + k, last + j);
  }
  return b.mesh();
}

/** An outline given in polar form r(theta), sampled into a counter-clockwise ring. */
export function polarRing(radius: (theta: number) => number, samples: number): Ring {
  const out: Ring = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * TAU;
    const r = radius(a);
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return dedupe(out);
}

/** The outline of a flat link: a round end of radius r0 at the origin joined by straight flanks to one of radius r1 at (length, 0). */
export function linkOutline(r0: number, r1: number, length: number, arcTol = 0.03): Ring {
  // Angle of the tangent points: the flanks are the outer tangents of the two circles.
  const beta = Math.acos(Math.max(-1, Math.min(1, (r0 - r1) / length)));
  const out: Ring = [];
  out.push(...arcPoints(r0, beta, TAU - beta, arcTol));
  out.push(...arcPoints(r1, -beta, beta, arcTol).map(([x, y]) => [x + length, y] as Vec2));
  return dedupe(out);
}

/**
 * The outline of an arm: a round hub at the origin, a straight bar of half-width `half` along +X,
 * and a round boss of radius `bossRadius` at (length, 0). Counter-clockwise.
 */
export function armOutline(hubRadius: number, half: number, bossRadius: number, length: number, arcTol = 0.03): Ring {
  const h = Math.min(half, hubRadius - 1e-3, bossRadius - 1e-3);
  const alpha = Math.asin(h / hubRadius);
  const beta = Math.asin(h / bossRadius);
  const out: Ring = [];
  out.push(...arcPoints(hubRadius, alpha, TAU - alpha, arcTol));
  out.push(...arcPoints(bossRadius, -(Math.PI - beta), Math.PI - beta, arcTol).map(([x, y]) => [x + length, y] as Vec2));
  return dedupe(out);
}
