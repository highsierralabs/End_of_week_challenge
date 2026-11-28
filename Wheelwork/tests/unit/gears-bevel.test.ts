// The straight bevel pair: each gear is one closed solid, the pair sits where it says it sits,
// and the two solids do not run into each other as they turn.

import { describe, expect, it } from 'vitest';
import { bevelPair, type BevelPair, type BevelPairSpec } from '../../src/core/gears/bevel';
import { resolveSpurSpec, toothProfile } from '../../src/core/gears/involute';
import { type Mesh } from '../../src/core/mesh/types';

// ---------------------------------------------------------------------------------------------
// Private mesh helpers (the general mesh kit is not this module's to depend on).

interface Topology {
  vertices: number;
  edges: number;
  faces: number;
  /** Directed edges that do not have exactly one partner running the other way. */
  badEdges: number;
  degenerate: number;
  unusedVertices: number;
}

function topology(mesh: Mesh): Topology {
  const vertices = mesh.positions.length / 3;
  const faces = mesh.indices.length / 3;
  const directed = new Map<number, number>();
  const used = new Uint8Array(vertices);
  let degenerate = 0;
  for (let t = 0; t < faces; t++) {
    const a = mesh.indices[3 * t]!;
    const b = mesh.indices[3 * t + 1]!;
    const c = mesh.indices[3 * t + 2]!;
    used[a] = 1;
    used[b] = 1;
    used[c] = 1;
    if (a === b || b === c || c === a || triangleArea(mesh, t) < 1e-12) degenerate++;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const key = u * vertices + v;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  let badEdges = 0;
  for (const [key, count] of directed) {
    const u = Math.floor(key / vertices);
    const v = key % vertices;
    if (count !== 1 || directed.get(v * vertices + u) !== 1) badEdges++;
  }
  let unusedVertices = 0;
  for (let i = 0; i < vertices; i++) if (used[i] === 0) unusedVertices++;
  return { vertices, edges: directed.size / 2, faces, badEdges, degenerate, unusedVertices };
}

function triangleArea(mesh: Mesh, t: number): number {
  const p = mesh.positions;
  const a = 3 * mesh.indices[3 * t]!;
  const b = 3 * mesh.indices[3 * t + 1]!;
  const c = 3 * mesh.indices[3 * t + 2]!;
  const ux = p[b]! - p[a]!;
  const uy = p[b + 1]! - p[a + 1]!;
  const uz = p[b + 2]! - p[a + 2]!;
  const vx = p[c]! - p[a]!;
  const vy = p[c + 1]! - p[a + 1]!;
  const vz = p[c + 2]! - p[a + 2]!;
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

function signedVolume(mesh: Mesh): number {
  const p = mesh.positions;
  let six = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = 3 * mesh.indices[t]!;
    const b = 3 * mesh.indices[t + 1]!;
    const c = 3 * mesh.indices[t + 2]!;
    six +=
      p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!) -
      p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!) +
      p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
  }
  return six / 6;
}

/** A mesh prepared for inside tests and distance queries: triangle corners and bounding boxes. */
interface Solid {
  tri: Float64Array; // 9 numbers per triangle
  box: Float64Array; // 6 numbers per triangle: min xyz, max xyz
  count: number;
}

function solidOf(mesh: Mesh): Solid {
  const count = mesh.indices.length / 3;
  const tri = new Float64Array(9 * count);
  const box = new Float64Array(6 * count);
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 3; k++) {
      const v = 3 * mesh.indices[3 * t + k]!;
      for (let d = 0; d < 3; d++) tri[9 * t + 3 * k + d] = mesh.positions[v + d]!;
    }
    for (let d = 0; d < 3; d++) {
      const a = tri[9 * t + d]!;
      const b = tri[9 * t + 3 + d]!;
      const c = tri[9 * t + 6 + d]!;
      box[6 * t + d] = Math.min(a, b, c);
      box[6 * t + 3 + d] = Math.max(a, b, c);
    }
  }
  return { tri, box, count };
}

/**
 * Parity of the crossings of a ray from the point along the +axis direction (axis 1 = y, 2 = z).
 * Odd means inside. The other two coordinates are (u, v).
 */
function insideAlong(s: Solid, x: number, y: number, z: number, axis: 1 | 2): boolean {
  const u = 0;
  const v = axis === 2 ? 1 : 2;
  const q = [x, y, z] as const;
  const qu = q[u]!;
  const qv = q[v]!;
  const qw = q[axis]!;
  let crossings = 0;
  for (let t = 0; t < s.count; t++) {
    const b = 6 * t;
    if (qu < s.box[b + u]! || qu > s.box[b + 3 + u]! || qv < s.box[b + v]! || qv > s.box[b + 3 + v]! || qw > s.box[b + 3 + axis]!) continue;
    const o = 9 * t;
    const au = s.tri[o + u]! - qu;
    const av = s.tri[o + v]! - qv;
    const bu = s.tri[o + 3 + u]! - qu;
    const bv = s.tri[o + 3 + v]! - qv;
    const cu = s.tri[o + 6 + u]! - qu;
    const cv = s.tri[o + 6 + v]! - qv;
    const w0 = bu * cv - bv * cu;
    const w1 = cu * av - cv * au;
    const w2 = au * bv - av * bu;
    if ((w0 > 0 && w1 > 0 && w2 > 0) || (w0 < 0 && w1 < 0 && w2 < 0)) {
      const sum = w0 + w1 + w2;
      const hit = (w0 * s.tri[o + axis]! + w1 * s.tri[o + 3 + axis]! + w2 * s.tri[o + 6 + axis]!) / sum;
      if (hit > qw) crossings++;
    }
  }
  return (crossings & 1) === 1;
}

/** Distance from a point to the surface of the solid. */
function surfaceDistance(s: Solid, x: number, y: number, z: number): number {
  let best = Infinity;
  for (let t = 0; t < s.count; t++) {
    const b = 6 * t;
    const dx = Math.max(s.box[b]! - x, 0, x - s.box[b + 3]!);
    const dy = Math.max(s.box[b + 1]! - y, 0, y - s.box[b + 4]!);
    const dz = Math.max(s.box[b + 2]! - z, 0, z - s.box[b + 5]!);
    if (dx * dx + dy * dy + dz * dz >= best) continue;
    const d2 = pointTriangle2(s.tri, 9 * t, x, y, z);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

/** Squared distance from a point to a triangle (closest-point regions, after Ericson). */
function pointTriangle2(tri: Float64Array, o: number, px: number, py: number, pz: number): number {
  const ax = tri[o]!, ay = tri[o + 1]!, az = tri[o + 2]!;
  const bx = tri[o + 3]!, by = tri[o + 4]!, bz = tri[o + 5]!;
  const cx = tri[o + 6]!, cy = tri[o + 7]!, cz = tri[o + 8]!;
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  const sq = (x: number, y: number, z: number): number => x * x + y * y + z * z;
  if (d1 <= 0 && d2 <= 0) return sq(apx, apy, apz);
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return sq(apx - v * abx, apy - v * aby, apz - v * abz);
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return sq(apx - w * acx, apy - w * acy, apz - w * acz);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return sq(bpx - w * (cx - bx), bpy - w * (cy - by), bpz - w * (cz - bz));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return sq(apx - v * abx - w * acx, apy - v * aby - w * acy, apz - v * abz - w * acz);
}

// ---------------------------------------------------------------------------------------------

/** Rotate a point about +Z by a, then about +X by b. */
function turnZthenX(x: number, y: number, z: number, a: number, b: number): [number, number, number] {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const x1 = x * ca - y * sa;
  const y1 = x * sa + y * ca;
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  return [x1, y1 * cb - z * sb, y1 * sb + z * cb];
}

/** Rotate a point about +X by b, then about +Z by a. */
function turnXthenZ(x: number, y: number, z: number, b: number, a: number): [number, number, number] {
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const y1 = y * cb - z * sb;
  const z1 = y * sb + z * cb;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return [x * ca - y1 * sa, x * sa + y1 * ca, z1];
}

/** Points of one tooth outline in a bevel mesh: the virtual spur tooth's point count. */
function outlinePointsPerTooth(teeth: number, pitchAngle: number, module: number, backlash: number): number {
  const spec = resolveSpurSpec({ teeth: 20, module, backlash, flankPoints: 8, filletPoints: 4 });
  return toothProfile(teeth / Math.cos(pitchAngle), spec).count;
}

interface Overlap {
  /** mm: deepest any sampled point of one gear gets inside the other over the mesh cycle. */
  deepest: number;
  /** Sampled points found inside at all. */
  inside: number;
  samples: number;
  /** Points where the two ray directions disagreed (a ray grazing an edge); not counted as inside. */
  undecided: number;
  /** mm: smallest distance from an outside sample to the other gear (only when asked for). */
  nearest: number;
}

interface OverlapOptions {
  steps: number;
  /** Extra turn of B, radians. */
  offsetB?: number;
  /** Also measure the nearest approach of the samples that stay outside. */
  gaps?: boolean;
  /** Carry every vertex of both meshes, not just the teeth near the mesh: bodies, hubs, far teeth. */
  everything?: boolean;
}

/**
 * Sample the tooth surfaces of each gear near the mesh (every outline point, at five levels along
 * the face from toe to heel), carry them through one tooth pitch of A with B following at
 * `ratioBperA`, and measure how deep they ever get inside the other gear's mesh.
 */
function overlap(pair: BevelPair, spec: BevelPairSpec, options: OverlapOptions): Overlap {
  const zA = spec.teethA;
  const zB = spec.teethB;
  const solidA = solidOf(pair.gearA);
  const solidB = solidOf(pair.gearB);
  const out: Overlap = { deepest: 0, inside: 0, samples: 0, undecided: 0, nearest: Infinity };
  const levels = [0, 0.25, 0.5, 0.75, 1];

  // The first n vertices are the heel outline and the next n the toe outline, point for point.
  const sample = (mesh: Mesh, n: number, isNearMesh: (x: number, y: number, z: number) => boolean): number[] => {
    const pts: number[] = [];
    const p = mesh.positions;
    for (let i = 0; i < n; i++) {
      const hx = p[3 * i]!, hy = p[3 * i + 1]!, hz = p[3 * i + 2]!;
      if (!options.everything && !isNearMesh(hx, hy, hz)) continue;
      const tx = p[3 * (n + i)]!, ty = p[3 * (n + i) + 1]!, tz = p[3 * (n + i) + 2]!;
      for (const s of levels) pts.push(tx + s * (hx - tx), ty + s * (hy - ty), tz + s * (hz - tz));
    }
    if (options.everything) for (let i = 2 * n * 3; i < p.length; i++) pts.push(p[i]!);
    return pts;
  };
  // Within two and a half teeth of the pitch line, which lies in the y = 0 plane with x, z > 0.
  const nearA = (x: number, y: number): boolean => x > 0 && Math.abs(Math.atan2(y, x)) < (5 * Math.PI) / zA;
  const nearB = (_x: number, y: number, z: number): boolean => z > 0 && Math.abs(Math.atan2(y, z)) < (5 * Math.PI) / zB;
  const backlash = spec.backlash ?? 0;
  const ptsA = sample(pair.gearA, zA * outlinePointsPerTooth(zA, pair.pitchAngleA, spec.module, backlash), nearA);
  const ptsB = sample(pair.gearB, zB * outlinePointsPerTooth(zB, pair.pitchAngleB, spec.module, backlash), nearB);
  expect(ptsA.length).toBeGreaterThan(1000);
  expect(ptsB.length).toBeGreaterThan(1000);

  const probe = (s: Solid, q: [number, number, number]): void => {
    out.samples++;
    const inZ = insideAlong(s, q[0], q[1], q[2], 2);
    const inY = insideAlong(s, q[0], q[1], q[2], 1);
    if (inZ !== inY) {
      out.undecided++;
      return;
    }
    if (!inZ) {
      if (options.gaps) out.nearest = Math.min(out.nearest, surfaceDistance(s, q[0], q[1], q[2]));
      return;
    }
    out.inside++;
    const d = surfaceDistance(s, q[0], q[1], q[2]);
    if (d > out.deepest) out.deepest = d;
  };

  const pitchA = (2 * Math.PI) / zA;
  for (let i = 0; i < options.steps; i++) {
    const a = (pitchA * i) / options.steps;
    const b = pair.ratioBperA * a + (options.offsetB ?? 0);
    // A's points in B's rest frame: turn A forward, then undo B's turn.
    for (let k = 0; k < ptsA.length; k += 3) probe(solidB, turnZthenX(ptsA[k]!, ptsA[k + 1]!, ptsA[k + 2]!, a, -b));
    // B's points in A's rest frame.
    for (let k = 0; k < ptsB.length; k += 3) probe(solidA, turnXthenZ(ptsB[k]!, ptsB[k + 1]!, ptsB[k + 2]!, b, -a));
  }
  return out;
}

interface Case {
  name: string;
  spec: BevelPairSpec;
}

const CASES: readonly Case[] = [
  { name: '16:32 plain', spec: { teethA: 16, teethB: 32, module: 1.5, faceWidth: 8 } },
  { name: '20:20 mitre, bores and hubs', spec: { teethA: 20, teethB: 20, module: 1.25, faceWidth: 5, boreA: 4, boreB: 4, hubLengthA: 6, hubLengthB: 6 } },
  { name: '12:36 bores, one hub', spec: { teethA: 12, teethB: 36, module: 1.5, faceWidth: 9, boreA: 3, boreB: 5, hubLengthB: 8, hubDiameterB: 14 } },
  { name: '15:45 hub without bore', spec: { teethA: 15, teethB: 45, module: 1.2, faceWidth: 8, hubLengthA: 5, hubDiameterA: 9 } },
  { name: '30:18 bores without hubs', spec: { teethA: 30, teethB: 18, module: 1.0, faceWidth: 5, boreA: 5, boreB: 3 } },
];
const BACKLASH = 0.08;

describe('bevel meshes are closed solids', () => {
  for (const { name, spec } of CASES) {
    it(name, () => {
      const pair = bevelPair({ ...spec, backlash: BACKLASH });
      const hubs = (spec.hubLengthA ?? 0) + (spec.hubLengthB ?? 0);
      for (const [mesh, bore, pitchRadius] of [
        [pair.gearA, spec.boreA ?? 0, pair.outerPitchRadiusA],
        [pair.gearB, spec.boreB ?? 0, pair.outerPitchRadiusB],
      ] as const) {
        const t = topology(mesh);
        // Every edge is used by exactly two triangles, once in each direction.
        expect(t.badEdges).toBe(0);
        expect(t.degenerate).toBe(0);
        expect(t.unusedVertices).toBe(0);
        expect(t.faces * 3).toBe(t.edges * 2);
        // One piece without handles (a sphere), or with one hole through it (a torus).
        expect(t.vertices - t.edges + t.faces).toBe(bore > 0 ? 0 : 2);
        // Outward-facing, and of a sensible size: more than a twentieth of, and less than, a
        // cylinder that encloses the whole gear.
        const enclosing = Math.PI * (pitchRadius + 2 * spec.module) ** 2 * (pair.faceWidth + hubs + 3 * spec.module);
        const volume = signedVolume(mesh);
        expect(volume).toBeGreaterThan(enclosing / 20);
        expect(volume).toBeLessThan(enclosing);
        for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
      }
    });
  }
});

describe('bevel pair sits where it says', () => {
  for (const { name, spec } of CASES) {
    it(name, () => {
      const pair = bevelPair({ ...spec, backlash: BACKLASH });
      const m = spec.module;
      const zA = spec.teethA;
      const zB = spec.teethB;
      const RA = (m * zA) / 2;
      const RB = (m * zB) / 2;
      const L = Math.hypot(RA, RB);
      expect(pair.outerPitchRadiusA).toBeCloseTo(RA, 12);
      expect(pair.outerPitchRadiusB).toBeCloseTo(RB, 12);
      expect(pair.coneDistance).toBeCloseTo(L, 12);
      expect(Math.tan(pair.pitchAngleA)).toBeCloseTo(zA / zB, 12);
      expect(pair.pitchAngleA + pair.pitchAngleB).toBeCloseTo(Math.PI / 2, 12);
      expect(pair.ratioBperA).toBeCloseTo(-zA / zB, 12);
      expect(pair.faceWidth).toBe(Math.min(spec.faceWidth, L / 3));
      const sinA = Math.sin(pair.pitchAngleA);
      const cosA = Math.cos(pair.pitchAngleA);
      const toe = (L - pair.faceWidth) / L;

      // Extents along each axis. The nearest point to the apex is a tooth tip at the toe; the
      // farthest is the flat back, 2.25 modules of tooth and rim behind the pitch circle along
      // the back cone, plus the hub.
      const a = pair.gearA.positions;
      const b = pair.gearB.positions;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (let i = 0; i < a.length; i += 3) {
        minA = Math.min(minA, a[i + 2]!);
        maxA = Math.max(maxA, a[i + 2]!);
      }
      for (let i = 0; i < b.length; i += 3) {
        minB = Math.min(minB, b[i]!);
        maxB = Math.max(maxB, b[i]!);
      }
      expect(pair.extentA[0]).toBe(minA);
      expect(pair.extentA[1]).toBe(maxA);
      expect(pair.extentB[0]).toBe(minB);
      expect(pair.extentB[1]).toBe(maxB);
      expect(minA).toBeCloseTo(toe * (RB - m * sinA), 9);
      expect(maxA).toBeCloseTo(RB + 2.25 * m * sinA + (spec.hubLengthA ?? 0), 9);
      expect(minB).toBeCloseTo(toe * (RA - m * cosA), 9);
      expect(maxB).toBeCloseTo(RA + 2.25 * m * cosA + (spec.hubLengthB ?? 0), 9);
      expect(minA).toBeGreaterThan(0);
      expect(minB).toBeGreaterThan(0);

      // Apex at the origin: every tooth edge, produced, passes through it. The heel outline is
      // the first n vertices and the toe outline the next n.
      for (const [positions, teeth, angle] of [
        [a, zA, pair.pitchAngleA],
        [b, zB, pair.pitchAngleB],
      ] as const) {
        const n = teeth * outlinePointsPerTooth(teeth, angle, m, BACKLASH);
        let worst = 0;
        for (let i = 0; i < 3 * n; i++) worst = Math.max(worst, Math.abs(positions[3 * n + i]! - toe * positions[i]!));
        expect(worst).toBeLessThan(1e-9);
      }

      // The pitch point is (RA, 0, RB). At rotation 0 a tooth of A is centred on it: the middle
      // of tooth 0's tip is one module out along the back cone. B has a space there: its first
      // outline point, a root centre, is 1.25 modules along the same line, a quarter module
      // beyond A's tip.
      const pptA = outlinePointsPerTooth(zA, pair.pitchAngleA, m, BACKLASH);
      const tip = 3 * (pptA / 2);
      expect(a[tip]).toBeCloseTo(RA + m * cosA, 9);
      expect(a[tip + 1]).toBeCloseTo(0, 9);
      expect(a[tip + 2]).toBeCloseTo(RB - m * sinA, 9);
      expect(b[0]).toBeCloseTo(RA + 1.25 * m * cosA, 9);
      expect(b[1]).toBeCloseTo(0, 9);
      expect(b[2]).toBeCloseTo(RB - 1.25 * m * sinA, 9);

      // Bores are clear right through, and nothing sticks out past the tips.
      for (const [positions, axis, bore, tipRadius] of [
        [a, 2, spec.boreA ?? 0, RA + m * cosA],
        [b, 0, spec.boreB ?? 0, RB + m * sinA],
      ] as const) {
        let inner = Infinity;
        let outer = 0;
        for (let i = 0; i < positions.length; i += 3) {
          const u = positions[i + ((axis + 1) % 3)]!;
          const v = positions[i + ((axis + 2) % 3)]!;
          inner = Math.min(inner, Math.hypot(u, v));
          outer = Math.max(outer, Math.hypot(u, v));
        }
        if (bore > 0) expect(inner).toBeCloseTo(bore / 2, 9);
        else expect(inner).toBe(0);
        expect(outer).toBeCloseTo(tipRadius, 9);
      }
    });
  }

  it('clamps the face width and rejects impossible gears', () => {
    const pair = bevelPair({ teethA: 16, teethB: 32, module: 1.5, faceWidth: 50 });
    expect(pair.faceWidth).toBeCloseTo(pair.coneDistance / 3, 12);
    expect(topology(pair.gearA).badEdges).toBe(0);
    expect(() => bevelPair({ teethA: 5, teethB: 32, module: 1.5, faceWidth: 8 })).toThrow(RangeError);
    expect(() => bevelPair({ teethA: 16, teethB: 32, module: 1.5, faceWidth: 8, boreA: 30 })).toThrow(RangeError);
    expect(() => bevelPair({ teethA: 16, teethB: 32, module: 0, faceWidth: 8 })).toThrow(RangeError);
  });
});

describe('bevel pair runs without interference', () => {
  // Tolerance. Tredgold's construction is an approximation to the spherical involute, so some
  // overlap was expected and 0.001 mm is the tolerance asserted. None was found: at the sampled
  // points (every outline point of the five teeth nearest the mesh, at five levels along the
  // face, in both directions, through one pitch) neither mesh ever enters the other, even with no
  // backlash at all. The nearest approach without backlash is a fraction of a micrometre to a
  // few micrometres, which is the chord error of the eight-point flanks; the error of the
  // approximation is below that for these sizes and is not resolved by this test.
  const TOLERANCE = 1e-3;

  for (const { name, spec } of CASES) {
    it(`${name}, with backlash`, () => {
      const withBacklash = { ...spec, backlash: BACKLASH };
      const pair = bevelPair(withBacklash);
      const run = overlap(pair, withBacklash, { steps: 16, gaps: true });
      expect(run.deepest).toBeLessThanOrEqual(TOLERANCE);
      expect(run.inside).toBe(0);
      expect(run.undecided).toBeLessThan(run.samples * 1e-3);
      // The thinning is 0.08 mm per gear at the heel, so each flank has (0.08 + 0.08) * cos(20) / 2
      // = 0.075 mm of room there, shrinking in proportion towards the toe.
      const toe = (pair.coneDistance - pair.faceWidth) / pair.coneDistance;
      expect(run.nearest).toBeGreaterThan(0.075 * toe * 0.95);
      expect(run.nearest).toBeLessThan(0.075 * toe * 1.1);
    });

    it(`${name}, bodies and hubs clear`, () => {
      const withBacklash = { ...spec, backlash: BACKLASH };
      const run = overlap(bevelPair(withBacklash), withBacklash, { steps: 3, everything: true });
      expect(run.deepest).toBeLessThanOrEqual(TOLERANCE);
      expect(run.undecided).toBeLessThan(run.samples * 1e-3);
    });

    it(`${name}, no backlash: touching, not overlapping`, () => {
      const pair = bevelPair(spec);
      const run = overlap(pair, spec, { steps: 16, gaps: true });
      expect(run.deepest).toBeLessThanOrEqual(TOLERANCE);
      expect(run.nearest).toBeLessThan(1e-3);
    });

    it(`${name}, the test can fail: B a twentieth of a pitch out`, () => {
      const withBacklash = { ...spec, backlash: BACKLASH };
      const pair = bevelPair(withBacklash);
      for (const sign of [1, -1]) {
        const run = overlap(pair, withBacklash, { steps: 12, offsetB: (sign * 0.05 * 2 * Math.PI) / spec.teethB });
        expect(run.deepest).toBeGreaterThan(0.05);
      }
    });
  }
});
