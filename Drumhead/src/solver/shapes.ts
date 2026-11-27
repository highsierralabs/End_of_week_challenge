// Preset drumheads. Lengths are in metres; the drawing table is a 1 m square centred on the origin.

import { type Poly } from './geometry';
import { latticeMesh, refineTriangles, type Mesh } from './mesh';

/**
 * The Gordon-Webb-Wolpert isospectral drums, as drawn in Driscoll, "Eigenmodes of isospectral
 * drums", SIAM Review 39 (1997), Figure 1.1. Each is seven right isosceles triangles with legs
 * of length 2 (in the paper's units), glued by reflection across shared edges.
 */
export const GWW = {
  left: {
    outline: [-3, 1, -1, -1, 1, -1, 1, -3, 3, -1, 3, 1, -1, 1, -1, 3],
    pieces: [
      [-3, 1, -1, 1, -1, 3], [-3, 1, -1, -1, -1, 1], [-1, -1, 1, 1, -1, 1], [-1, -1, 1, -1, 1, 1],
      [1, -1, 3, -1, 1, 1], [3, -1, 3, 1, 1, 1], [1, -3, 3, -1, 1, -1],
    ],
  },
  right: {
    outline: [-3, 3, -3, 1, 1, -3, 1, -1, 3, -1, 1, 1, -1, 1, -1, 3],
    pieces: [
      [1, -1, 3, -1, 1, 1], [1, -3, 1, -1, -1, -1], [-3, 1, -1, -1, -1, 1], [-3, 1, -1, 1, -1, 3],
      [-3, 1, -1, 3, -3, 3], [-1, -1, 1, 1, -1, 1], [-1, -1, 1, -1, 1, 1],
    ],
  },
} as const;

export function scalePoly(p: readonly number[], s: number, dx = 0, dy = 0): Poly {
  return p.map((v, i) => v * s + (i % 2 ? dy : dx));
}

/** GWW drum mesh. `scale` metres per paper unit, `levels` uniform refinements. */
export function gwwMesh(which: 'left' | 'right', scale: number, levels: number): Mesh {
  const g = GWW[which];
  return refineTriangles(g.pieces.map((t) => scalePoly(t, scale)), levels, scalePoly(g.outline, scale));
}

export function circle(r: number, n = 160, cx = 0, cy = 0): Poly {
  const p: Poly = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; p.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  return p;
}

function stadium(r: number, half: number, n = 64): Poly {
  const p: Poly = [];
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (Math.PI * i) / n; p.push(half + r * Math.cos(a), r * Math.sin(a)); }
  for (let i = 0; i <= n; i++) { const a = Math.PI / 2 + (Math.PI * i) / n; p.push(-half + r * Math.cos(a), r * Math.sin(a)); }
  return p;
}

function star(points: number, rOut: number, rIn: number): Poly {
  const p: Poly = [];
  for (let i = 0; i < 2 * points; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / points;
    const r = i % 2 ? rIn : rOut;
    p.push(r * Math.cos(a), r * Math.sin(a));
  }
  return p;
}

function guitar(n = 220): Poly {
  // Two overlapping lobes with a waist, traced as one smooth outline (polar sum of bumps).
  const p: Poly = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const y = 0.36 * Math.sin(t);
    const lobe = 0.5 + 0.5 * Math.sin(t); // 0 at the bottom, 1 at the top
    const waist = 1 - 0.22 * Math.exp(-((Math.sin(t) - 0.12) ** 2) / 0.04);
    const w = (0.27 - 0.06 * lobe) * waist;
    p.push(w * Math.cos(t), y);
  }
  return p;
}

function heart(n = 200): Poly {
  const p: Poly = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    p.push(x * 0.021, y * 0.021 + 0.04);
  }
  return p;
}

/** Metres per paper unit for the playable twins: area 14 * s^2, about a timpani head's. */
export const GWW_SCALE = 0.155;

export interface Preset {
  id: string;
  name: string;
  note: string;
  /** The outline, for icons. */
  outline: Poly;
  mesh: (detail: number) => Mesh;
}

/** Vertex budget to refinement levels for a coarse triangulation of `pieces` triangles. */
function levelsFor(pieces: number, detail: number): number {
  // Uniform refinement: about pieces * 4^L / 2 vertices.
  return Math.max(2, Math.round(Math.log(Math.max(1, (2 * detail) / pieces)) / Math.log(4)));
}

const lattice = (p: Poly) => ({ outline: p, mesh: (detail: number) => latticeMesh(p, detail)! });
const SQ = 0.28;
const TRI = (() => { const r = 0.38; return [0, r, -r * Math.sin(Math.PI / 3), -r / 2, r * Math.sin(Math.PI / 3), -r / 2].map((v, i) => (i % 2 ? v - 0.04 : v)); })();
const ELL = 0.21;

export const PRESETS: Preset[] = [
  { id: 'circle', name: 'Circle', note: 'A timpani head, 66 cm across.', ...lattice(circle(0.33)) },
  {
    id: 'square', name: 'Square', note: 'Its modes come in pairs that share a pitch: (m, n) and (n, m).',
    outline: [-SQ, -SQ, SQ, -SQ, SQ, SQ, -SQ, SQ],
    mesh: (d) => refineTriangles([[-SQ, -SQ, SQ, -SQ, SQ, SQ], [-SQ, -SQ, SQ, SQ, -SQ, SQ]], levelsFor(2, d), [-SQ, -SQ, SQ, -SQ, SQ, SQ, -SQ, SQ]),
  },
  {
    id: 'triangle', name: 'Triangle', note: 'The equilateral triangle: one of the few shapes whose modes are known exactly.',
    outline: TRI,
    mesh: (d) => refineTriangles([TRI], levelsFor(1, d), TRI),
  },
  {
    id: 'ell', name: 'L-shape', note: 'A re-entrant corner bends every mode around it.',
    outline: [-ELL, -ELL, ELL, -ELL, ELL, 0, 0, 0, 0, ELL, -ELL, ELL],
    mesh: (d) => {
      const a = ELL;
      const sq = (x: number, y: number) => [[x, y, x + a, y, x + a, y + a], [x, y, x + a, y + a, x, y + a]];
      return refineTriangles([...sq(-a, -a), ...sq(0, -a), ...sq(-a, 0)], levelsFor(6, d), [-a, -a, a, -a, a, 0, 0, 0, 0, a, -a, a]);
    },
  },
  { id: 'stadium', name: 'Stadium', note: 'The Bunimovich stadium, whose waves wander chaotically.', ...lattice(stadium(0.2, 0.17)) },
  { id: 'guitar', name: 'Guitar', note: 'A guitar-like body with a waist.', ...lattice(guitar()) },
  { id: 'star', name: 'Star', note: 'Five points and five deep corners.', ...lattice(star(5, 0.42, 0.19)) },
  { id: 'heart', name: 'Heart', note: 'A heart, because why not.', ...lattice(heart()) },
  {
    id: 'gww-left', name: 'Twin A', note: 'One of the Gordon-Webb-Wolpert drums.',
    outline: scalePoly(GWW.left.outline, GWW_SCALE), mesh: (d) => gwwMesh('left', GWW_SCALE, levelsFor(7, d)),
  },
  {
    id: 'gww-right', name: 'Twin B', note: 'The other Gordon-Webb-Wolpert drum.',
    outline: scalePoly(GWW.right.outline, GWW_SCALE), mesh: (d) => gwwMesh('right', GWW_SCALE, levelsFor(7, d)),
  },
];
