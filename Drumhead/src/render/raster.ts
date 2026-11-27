// A pixel grid over a drum: for each cell, the triangle under its centre and the barycentric
// weights there. Lets the sand, the strike point and the mode thumbnails sample any per-vertex
// field in constant time.

export interface Raster {
  size: number;
  x0: number;
  y0: number;
  /** World size of one cell. */
  cell: number;
  /** Vertex indices (3 per cell, -1 when outside the drum). */
  v: Int32Array;
  /** Barycentric weights (3 per cell). */
  w: Float32Array;
}

export function buildRaster(xy: Float64Array, tri: Uint32Array, size: number): Raster {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < xy.length; i += 2) {
    x0 = Math.min(x0, xy[i]!); x1 = Math.max(x1, xy[i]!);
    y0 = Math.min(y0, xy[i + 1]!); y1 = Math.max(y1, xy[i + 1]!);
  }
  const span = Math.max(x1 - x0, y1 - y0) * 1.0001;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const r: Raster = { size, x0: cx - span / 2, y0: cy - span / 2, cell: span / size, v: new Int32Array(size * size * 3).fill(-1), w: new Float32Array(size * size * 3) };
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t]!, b = tri[t + 1]!, c = tri[t + 2]!;
    const ax = xy[2 * a]!, ay = xy[2 * a + 1]!, bx = xy[2 * b]!, by = xy[2 * b + 1]!, cx2 = xy[2 * c]!, cy2 = xy[2 * c + 1]!;
    const det = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
    if (det === 0) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx2) - r.x0) / r.cell));
    const i1 = Math.min(size - 1, Math.floor((Math.max(ax, bx, cx2) - r.x0) / r.cell));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy2) - r.y0) / r.cell));
    const j1 = Math.min(size - 1, Math.floor((Math.max(ay, by, cy2) - r.y0) / r.cell));
    for (let j = j0; j <= j1; j++) {
      const py = r.y0 + (j + 0.5) * r.cell;
      for (let i = i0; i <= i1; i++) {
        const px = r.x0 + (i + 0.5) * r.cell;
        const l1 = ((by - cy2) * (px - cx2) + (cx2 - bx) * (py - cy2)) / det;
        const l2 = ((cy2 - ay) * (px - cx2) + (ax - cx2) * (py - cy2)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const o = 3 * (j * size + i);
        r.v[o] = a; r.v[o + 1] = b; r.v[o + 2] = c;
        r.w[o] = l1; r.w[o + 1] = l2; r.w[o + 2] = l3;
      }
    }
  }
  return r;
}

/** Cell index under a world point, or -1. */
export function cellAt(r: Raster, x: number, y: number): number {
  const i = Math.floor((x - r.x0) / r.cell), j = Math.floor((y - r.y0) / r.cell);
  if (i < 0 || j < 0 || i >= r.size || j >= r.size) return -1;
  const c = j * r.size + i;
  return r.v[3 * c]! < 0 ? -1 : c;
}

/** Interpolate a per-vertex field at cell c (which must be inside). `stride`/`offset` select a mode. */
export function sampleCell(r: Raster, c: number, field: ArrayLike<number>, offset = 0): number {
  const o = 3 * c;
  return r.w[o]! * field[offset + r.v[o]!]! + r.w[o + 1]! * field[offset + r.v[o + 1]!]! + r.w[o + 2]! * field[offset + r.v[o + 2]!]!;
}
