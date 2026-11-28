// Checks on a pair of spur gears: does the pair actually mesh, with how much room.
//
// The numeric part works on the outlines themselves, the same polygons that are drawn and
// printed: gear A is swept through one tooth pitch, gear B follows at the tooth ratio, and at
// every position each outline's points near the mesh are tested against the other outline.

import { matingRotation, spurGear, type SpurGeometry, type SpurSpec } from './involute';

export interface MeshReport {
  centreDistance: number;
  /** Analytic, from tip and base radii at this centre distance (the textbook formula). */
  contactRatio: number;
  /**
   * The same path of contact, cut down to where both gears really have involute: it stops at the
   * form radius of each gear, so it accounts for undercut. Equal to contactRatio when the mating
   * tips work above both form radii. Not in the brief; added because the two differ for pinions
   * under about 17 teeth.
   */
  effectiveContactRatio: number;
  /** mm: deepest overlap of the two outlines found over the sweep (0 when they never overlap). */
  maxPenetration: number;
  /** mm: smallest gap between the two outlines anywhere, over the sweep (0 when they overlap). */
  minFlankClearance: number;
  /** Radians B can turn with A held, from the tooth thinning and the centre distance. */
  angularBacklashB: number;
  /** mm: tip of one to root of the other at the line of centres (smaller of the two). */
  tipToRootClearance: number;
  /** maxPenetration > tolerance. */
  interferes: boolean;
}

export interface SweepResult {
  /** mm, 0 when the outlines never overlap. */
  maxPenetration: number;
  /** mm, 0 when they overlap somewhere in the sweep. */
  minClearance: number;
  /**
   * mm: the smallest gap at each position, and of those the largest. For a pair run without
   * backlash it says how far out of contact the teeth get at their worst position: about 0 means
   * some pair of flanks is touching all the way through the pitch.
   */
  worstStepClearance: number;
}

/** One gear prepared for point queries: the chain of one tooth, from root centre to root centre. */
interface Probe {
  chain: Float64Array; // (ppt + 1) points, tooth 0
  segments: number;
  pitch: number;
  sinHalf: number;
  cosHalf: number;
  tipRadius: number;
  rootRadius: number;
  /** Anything closer to the centre than this is inside whatever the angle. */
  solidRadius: number;
}

function makeProbe(g: SpurGeometry): Probe {
  const ppt = g.pointsPerTooth;
  const n = g.outline.length;
  const chain = new Float64Array(2 * (ppt + 1));
  for (let k = 0; k <= ppt; k++) {
    const p = g.outline[k % n]!;
    chain[2 * k] = p[0];
    chain[2 * k + 1] = p[1];
  }
  const halfPitch = Math.PI / g.spec.teeth;
  return {
    chain,
    segments: ppt,
    pitch: 2 * halfPitch,
    sinHalf: Math.sin(halfPitch),
    cosHalf: Math.cos(halfPitch),
    tipRadius: g.tipRadius,
    rootRadius: g.rootRadius,
    solidRadius: g.rootRadius * Math.cos(halfPitch) * (1 - 1e-9),
  };
}

/** Distance from (x, y) to the tooth chain. */
function chainDistance(p: Probe, x: number, y: number): number {
  const c = p.chain;
  let best = Infinity;
  let ax = c[0]!;
  let ay = c[1]!;
  for (let k = 1; k <= p.segments; k++) {
    const bx = c[2 * k]!;
    const by = c[2 * k + 1]!;
    const ex = bx - ax;
    const ey = by - ay;
    const wx = x - ax;
    const wy = y - ay;
    const len2 = ex * ex + ey * ey;
    let t = len2 > 0 ? (wx * ex + wy * ey) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const dx = wx - t * ex;
    const dy = wy - t * ey;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
    ax = bx;
    ay = by;
  }
  return Math.sqrt(best);
}

/** Is (x, y), known to lie in tooth 0's angular sector, inside the polygon origin + tooth chain? */
function insideSector(p: Probe, x: number, y: number): boolean {
  const c = p.chain;
  let inside = false;
  let ax = 0;
  let ay = 0;
  const count = p.segments + 2; // origin, then the chain
  for (let k = 1; k <= count; k++) {
    let bx = 0;
    let by = 0;
    if (k < count) {
      bx = c[2 * (k - 1)]!;
      by = c[2 * (k - 1) + 1]!;
    }
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) inside = !inside;
    ax = bx;
    ay = by;
  }
  return inside;
}

/**
 * Signed distance from a point in the gear's own frame to its outline: positive outside, negative
 * inside. Points farther than `bound` outside the tip circle return a lower bound of their
 * distance instead of the exact value, which is all a search for the minimum needs.
 */
function signedDistance(p: Probe, x: number, y: number, bound: number): number {
  const R = Math.hypot(x, y);
  if (R - p.tipRadius >= bound) return R - p.tipRadius;
  if (R < p.solidRadius) return R - p.rootRadius;
  // Turn the point into the sector of the nearest tooth.
  const k = Math.round(Math.atan2(y, x) / p.pitch);
  const c = Math.cos(k * p.pitch);
  const s = Math.sin(k * p.pitch);
  const cx = x * c + y * s;
  const cy = -x * s + y * c;
  let d = chainDistance(p, cx, cy);
  // A neighbouring tooth can only be nearer if the sector boundary is.
  const toBoundary = Math.abs(cx * p.sinHalf - Math.abs(cy) * p.cosHalf);
  if (d > toBoundary) {
    const cp = Math.cos(p.pitch);
    const sp = cy >= 0 ? Math.sin(p.pitch) : -Math.sin(p.pitch);
    d = Math.min(d, chainDistance(p, cx * cp + cy * sp, -cx * sp + cy * cp));
  }
  return insideSector(p, cx, cy) ? -d : d;
}

/** How many teeth either side of the line of centres can reach the other gear. */
function reach(own: SpurGeometry, other: SpurGeometry, centreDistance: number): number {
  const ra = own.tipRadius;
  const cosHalf = (centreDistance * centreDistance + ra * ra - other.tipRadius * other.tipRadius) / (2 * centreDistance * ra);
  const halfAngle = Math.acos(Math.min(1, Math.max(-1, cosHalf)));
  return Math.ceil((halfAngle * own.spec.teeth) / (2 * Math.PI)) + 1;
}

/**
 * The numeric sweep on its own, for callers that already hold the geometry. A is at the origin and
 * B at (centreDistance, 0). A turns through one tooth pitch in `steps` positions; B follows by
 * `matingRotation`, plus `offsetB` radians (use it to take up the backlash one way or the other).
 */
export function sweepMesh(a: SpurGeometry, b: SpurGeometry, centreDistance: number, steps = 32, offsetB = 0): SweepResult {
  const zA = a.spec.teeth;
  const zB = b.spec.teeth;
  const probeA = makeProbe(a);
  const probeB = makeProbe(b);
  const pptA = a.pointsPerTooth;
  const pptB = b.pointsPerTooth;
  const reachA = Math.min(reach(a, b, centreDistance), Math.floor(zA / 2));
  const reachB = Math.min(reach(b, a, centreDistance), Math.floor(zB / 2));
  const pitchA = (2 * Math.PI) / zA;
  const pitchB = (2 * Math.PI) / zB;
  let maxPenetration = 0;
  let minClearance = Infinity;
  let worstStepClearance = 0;
  let stepClearance = Infinity;

  const note = (d: number): void => {
    if (d < 0) {
      if (-d > maxPenetration) maxPenetration = -d;
      stepClearance = 0;
    } else if (d < stepClearance) {
      stepClearance = d;
    }
  };

  const count = Math.max(1, Math.round(steps));
  for (let i = 0; i < count; i++) {
    stepClearance = Infinity;
    const thetaA = (pitchA * i) / count;
    const thetaB = matingRotation(thetaA, zA, zB, 0) + offsetB;
    const cA = Math.cos(thetaA);
    const sA = Math.sin(thetaA);
    const cB = Math.cos(thetaB);
    const sB = Math.sin(thetaB);

    // A's teeth near the direction of B, tested against B.
    const nearA = Math.round(-thetaA / pitchA);
    for (let t = nearA - reachA; t <= nearA + reachA; t++) {
      const base = (((t % zA) + zA) % zA) * pptA;
      for (let k = 0; k < pptA; k++) {
        const p = a.outline[base + k]!;
        const wx = p[0] * cA - p[1] * sA - centreDistance;
        const wy = p[0] * sA + p[1] * cA;
        note(signedDistance(probeB, wx * cB + wy * sB, -wx * sB + wy * cB, stepClearance));
      }
    }
    // B's teeth near the direction of A, tested against A.
    const nearB = Math.round((Math.PI - thetaB) / pitchB);
    for (let t = nearB - reachB; t <= nearB + reachB; t++) {
      const base = (((t % zB) + zB) % zB) * pptB;
      for (let k = 0; k < pptB; k++) {
        const p = b.outline[base + k]!;
        const wx = p[0] * cB - p[1] * sB + centreDistance;
        const wy = p[0] * sB + p[1] * cB;
        note(signedDistance(probeA, wx * cA + wy * sA, -wx * sA + wy * cA, stepClearance));
      }
    }
    if (stepClearance < minClearance) minClearance = stepClearance;
    if (stepClearance > worstStepClearance) worstStepClearance = stepClearance;
  }
  return { maxPenetration, minClearance, worstStepClearance };
}

interface PathOfContact {
  textbook: number;
  effective: number;
  /** Operating pressure angle, radians. */
  alphaW: number;
}

function pathOfContact(a: SpurGeometry, b: SpurGeometry, centreDistance: number): PathOfContact {
  const rbA = a.baseRadius;
  const rbB = b.baseRadius;
  const cosW = Math.min(1, (rbA + rbB) / centreDistance);
  const alphaW = Math.acos(cosW);
  const basePitch = (2 * Math.PI * rbA) / a.spec.teeth;
  // Positions along the line of action, measured from A's base-circle tangent point towards B's.
  const span = centreDistance * Math.sin(alphaW);
  const along = (R: number, rb: number): number => Math.sqrt(Math.max(0, R * R - rb * rb));
  const tipA = along(a.flankTipRadius, rbA);
  const tipB = along(b.flankTipRadius, rbB);
  const textbook = (tipA + tipB - span) / basePitch;
  const lo = Math.max(along(a.formRadius, rbA), span - tipB);
  const hi = Math.min(tipA, span - along(b.formRadius, rbB));
  return { textbook, effective: Math.max(0, hi - lo) / basePitch, alphaW };
}

/**
 * Textbook contact ratio: (sqrt(raA^2 - rbA^2) + sqrt(raB^2 - rbB^2) - C * sin(alphaW)) / base pitch,
 * with alphaW the operating pressure angle at this centre distance.
 */
export function contactRatio(a: SpurSpec, b: SpurSpec, centreDistance: number): number {
  return pathOfContact(spurGear(a), spurGear(b), centreDistance).textbook;
}

/** Contact ratio counting only the part of the path where both flanks are involute (see MeshReport). */
export function effectiveContactRatio(a: SpurSpec, b: SpurSpec, centreDistance: number): number {
  return pathOfContact(spurGear(a), spurGear(b), centreDistance).effective;
}

export function standardCentreDistance(zA: number, zB: number, module: number): number {
  return (module * (zA + zB)) / 2;
}

const involuteFn = (angle: number): number => Math.tan(angle) - angle;

/** Tooth thickness (arc) of g at radius R, from its thickness at the pitch circle. */
function thicknessAt(g: SpurGeometry, R: number, alphaAtR: number): number {
  const alpha = (g.spec.pressureAngleDeg * Math.PI) / 180;
  return 2 * R * (g.toothThicknessAtPitch / (2 * g.pitchRadius) + involuteFn(alpha) - involuteFn(alphaAtR));
}

/**
 * Sweep A through one tooth pitch in `steps` positions with B following by `matingRotation`, and
 * test the outlines. The outlines are the ones the specs describe, at their own point counts, so
 * the figures are true of what is drawn and printed: a flank is a polygon inscribed in the
 * involute, and at zero backlash the reported clearance is that polygon's chord error, not 0.
 */
export function checkMesh(a: SpurSpec, b: SpurSpec, centreDistance: number, steps = 32, tolerance = 1e-3): MeshReport {
  const ga = spurGear(a);
  const gb = spurGear(b);
  const path = pathOfContact(ga, gb, centreDistance);
  const sweep = sweepMesh(ga, gb, centreDistance, steps, 0);

  // Backlash on the operating pitch circles: one pitch less the two tooth thicknesses there.
  const cosW = Math.cos(path.alphaW);
  const rwA = ga.baseRadius / cosW;
  const rwB = gb.baseRadius / cosW;
  const pitchW = (2 * Math.PI * rwA) / ga.spec.teeth;
  const circular = pitchW - thicknessAt(ga, rwA, path.alphaW) - thicknessAt(gb, rwB, path.alphaW);

  return {
    centreDistance,
    contactRatio: path.textbook,
    effectiveContactRatio: path.effective,
    maxPenetration: sweep.maxPenetration,
    minFlankClearance: sweep.minClearance,
    angularBacklashB: circular / rwB,
    tipToRootClearance: Math.min(centreDistance - ga.tipRadius - gb.rootRadius, centreDistance - gb.tipRadius - ga.rootRadius),
    interferes: sweep.maxPenetration > tolerance,
  };
}
