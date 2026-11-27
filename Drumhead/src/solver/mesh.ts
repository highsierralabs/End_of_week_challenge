// Triangle meshes for drumheads.
//
// Two builders:
//  - refineTriangles: a coarse triangulation refined uniformly (each triangle into 4 by its edge
//    midpoints). Used for polygonal presets, and above all for the isospectral pair: uniform
//    refinement commutes with every isometry of a piece, so the transplantation proof carries
//    over to the discrete problem and the two meshes have identical spectra to rounding.
//  - latticeMesh: any region (freehand loops, smooth presets). An equilateral lattice is clipped
//    to the region and its boundary vertices are snapped onto the outline.

import { bbox, inside, nearestOnBoundary, polyArea, type Poly } from './geometry';

export interface Mesh {
  /** Vertex positions, [x0, y0, x1, y1, ...], in metres. */
  xy: Float64Array;
  /** Triangles, three vertex indices each, counter-clockwise. */
  tri: Uint32Array;
  /** 1 on the clamped rim (Dirichlet), 0 inside. */
  rim: Uint8Array;
  /** Outline used for drawing the rim (the source polygon). */
  outline: Poly;
}

export function vertexCount(m: Mesh): number { return m.xy.length / 2; }

function triArea(xy: ArrayLike<number>, a: number, b: number, c: number): number {
  return 0.5 * ((xy[2 * b]! - xy[2 * a]!) * (xy[2 * c + 1]! - xy[2 * a + 1]!) - (xy[2 * c]! - xy[2 * a]!) * (xy[2 * b + 1]! - xy[2 * a + 1]!));
}

/** Mark vertices on edges that belong to exactly one triangle. */
function markRim(nv: number, tri: ArrayLike<number>): Uint8Array {
  const count = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  for (let t = 0; t < tri.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const k = key(tri[t + e]!, tri[t + ((e + 1) % 3)]!);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const rim = new Uint8Array(nv);
  for (const [k, c] of count) {
    if (c === 1) { rim[Math.floor(k / nv)] = 1; rim[k % nv] = 1; }
  }
  return rim;
}

/** Coarse triangles [[x,y,x,y,x,y], ...] refined `levels` times. */
export function refineTriangles(coarse: number[][], levels: number, outline: Poly): Mesh {
  let tris = coarse.map((t) => t.slice());
  for (let l = 0; l < levels; l++) {
    const next: number[][] = [];
    for (const [ax, ay, bx, by, cx, cy] of tris as [number, number, number, number, number, number][]) {
      const abx = (ax + bx) / 2, aby = (ay + by) / 2, bcx = (bx + cx) / 2, bcy = (by + cy) / 2, cax = (cx + ax) / 2, cay = (cy + ay) / 2;
      next.push([ax, ay, abx, aby, cax, cay], [abx, aby, bx, by, bcx, bcy], [cax, cay, bcx, bcy, cx, cy], [abx, aby, bcx, bcy, cax, cay]);
    }
    tris = next;
  }
  // Weld vertices. Coordinates are dyadic fractions of the coarse ones, so rounding is exact enough.
  const ids = new Map<string, number>();
  const xy: number[] = [];
  const tri: number[] = [];
  const id = (x: number, y: number) => {
    const k = `${Math.round(x * 1e9)},${Math.round(y * 1e9)}`;
    let i = ids.get(k);
    if (i === undefined) { i = xy.length / 2; ids.set(k, i); xy.push(x, y); }
    return i;
  };
  for (const t of tris) {
    const a = id(t[0]!, t[1]!), b = id(t[2]!, t[3]!), c = id(t[4]!, t[5]!);
    if (triArea(xy, a, b, c) < 0) tri.push(a, c, b); else tri.push(a, b, c);
  }
  return { xy: Float64Array.from(xy), tri: Uint32Array.from(tri), rim: markRim(xy.length / 2, tri), outline };
}

/**
 * Mesh the inside of `poly` with an equilateral lattice of about `targetVerts` vertices.
 * Only the largest connected piece is kept. Returns null if the region is too thin to mesh.
 */
export function latticeMesh(poly: Poly, targetVerts: number): Mesh | null {
  const area = Math.abs(polyArea(poly));
  if (!(area > 0)) return null;
  // An equilateral lattice of spacing h has one vertex per (sqrt(3)/2) h^2 of area.
  const h = Math.sqrt(area / (targetVerts * (Math.sqrt(3) / 2)));
  const [x0, y0, x1, y1] = bbox(poly);
  const rowH = (h * Math.sqrt(3)) / 2;
  const rows = Math.ceil((y1 - y0) / rowH) + 3;
  const cols = Math.ceil((x1 - x0) / h) + 3;
  const ox = x0 - h, oy = y0 - rowH;
  const px = (r: number, c: number) => ox + c * h + (r & 1 ? h / 2 : 0);
  const py = (r: number) => oy + r * rowH;
  const ins = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ins[r * cols + c] = inside(poly, px(r, c), py(r)) ? 1 : 0;

  // Lattice triangles between rows r and r+1, kept when all three corners are inside.
  const raw: number[] = [];
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const a = r * cols + c, b = r * cols + c + 1;
      // Odd rows are shifted right by h/2.
      const u = (r + 1) * cols + c, v = (r + 1) * cols + c + 1;
      const t1 = r & 1 ? [a, b, v] : [a, b, u];
      const t2 = r & 1 ? [a, v, u] : [b, v, u];
      for (const t of [t1, t2]) if (ins[t[0]!] && ins[t[1]!] && ins[t[2]!]) raw.push(t[0]!, t[1]!, t[2]!);
    }
  }
  if (raw.length === 0) return null;

  // Largest edge-connected component of triangles.
  const nt = raw.length / 3;
  const edgeOwner = new Map<number, number>();
  const parent = new Int32Array(nt).map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  const NV = rows * cols;
  for (let t = 0; t < nt; t++) {
    for (let e = 0; e < 3; e++) {
      const p = raw[3 * t + e]!, q = raw[3 * t + ((e + 1) % 3)]!;
      const k = p < q ? p * NV + q : q * NV + p;
      const o = edgeOwner.get(k);
      if (o === undefined) edgeOwner.set(k, t); else parent[find(o)] = find(t);
    }
  }
  const size = new Map<number, number>();
  for (let t = 0; t < nt; t++) { const r = find(t); size.set(r, (size.get(r) ?? 0) + 1); }
  let bestRoot = -1, bestSize = 0;
  for (const [r, s] of size) if (s > bestSize) { bestSize = s; bestRoot = r; }
  if (bestSize < 12) return null;

  const remap = new Int32Array(NV).fill(-1);
  const xy: number[] = [];
  const tri: number[] = [];
  for (let t = 0; t < nt; t++) {
    if (find(t) !== bestRoot) continue;
    const ids: number[] = [];
    for (let e = 0; e < 3; e++) {
      const g = raw[3 * t + e]!;
      if (remap[g] === -1) { remap[g] = xy.length / 2; const r = Math.floor(g / cols); xy.push(px(r, g % cols), py(r)); }
      ids.push(remap[g]!);
    }
    tri.push(ids[0]!, ids[1]!, ids[2]!);
  }
  const pos = Float64Array.from(xy);
  for (let t = 0; t < tri.length; t += 3) {
    if (triArea(pos, tri[t]!, tri[t + 1]!, tri[t + 2]!) < 0) { const s = tri[t + 1]!; tri[t + 1] = tri[t + 2]!; tri[t + 2] = s; }
  }
  const rim = markRim(pos.length / 2, tri);

  // Snap rim vertices onto the outline, then undo any snap that folds or squashes a triangle.
  const orig = pos.slice();
  const nvx = pos.length / 2;
  for (let i = 0; i < nvx; i++) {
    if (!rim[i]) continue;
    const [bx, by, d] = nearestOnBoundary(poly, pos[2 * i]!, pos[2 * i + 1]!);
    if (d < h) { pos[2 * i] = bx; pos[2 * i + 1] = by; }
  }
  const minArea = 0.12 * (Math.sqrt(3) / 4) * h * h;
  for (let pass = 0; pass < 6; pass++) {
    let bad = 0;
    for (let t = 0; t < tri.length; t += 3) {
      if (triArea(pos, tri[t]!, tri[t + 1]!, tri[t + 2]!) >= minArea) continue;
      bad++;
      for (let e = 0; e < 3; e++) {
        const v = tri[t + e]!;
        if (rim[v]) { pos[2 * v] = orig[2 * v]!; pos[2 * v + 1] = orig[2 * v + 1]!; }
      }
    }
    if (!bad) break;
  }
  // Drop any triangle that is still degenerate (all its corners unsnapped, so it is a lattice one; cannot happen,
  // but a mesh must never carry a zero-area element into the solver).
  const keep: number[] = [];
  for (let t = 0; t < tri.length; t += 3) if (triArea(pos, tri[t]!, tri[t + 1]!, tri[t + 2]!) > 1e-14) keep.push(tri[t]!, tri[t + 1]!, tri[t + 2]!);
  return { xy: pos, tri: Uint32Array.from(keep), rim: markRim(nvx, keep), outline: poly };
}
