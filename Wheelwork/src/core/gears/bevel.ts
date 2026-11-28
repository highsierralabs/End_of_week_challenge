// One 90 degree straight bevel pair, as two closed solids.
//
// Tooth form: Tredgold's approximation. The back cone of each gear (the cone square to the pitch
// cone at the large end) is developed flat; on that plane the teeth are those of a virtual spur
// gear with z / cos(pitch angle) teeth and the same module, generated exactly as in involute.ts.
// The profile is wrapped back onto the back cone and every point is joined to the apex by a
// straight line, so the tooth tapers linearly and all its surfaces are ruled through the apex.
// This is not a spherical involute: the two differ by an amount that grows with tooth height over
// cone distance. The unit tests measure the consequence (how far the two meshes ever overlap).
//
// Where the gears sit. Both pitch-cone apexes are at the origin. Each gear lies on the positive
// side of its own axis with its teeth facing back towards the apex:
//   - gear A turns about +Z and occupies extentA[0] <= z <= extentA[1]; its teeth face -Z (down),
//     its flat back and hub are on the +Z side;
//   - gear B turns about +X and occupies extentB[0] <= x <= extentB[1]; its teeth face -X, its
//     flat back and hub are on the +X side.
// The teeth meet around the pitch line, which runs from the apex into the quadrant x > 0, z > 0
// of the y = 0 plane. To have A below the shaft of B with its teeth facing up instead, turn the
// whole pair half a turn about the X axis: that is a rigid motion, so the meshes stay valid, B
// keeps its axis, A's axis becomes -Z, and the sign of ratioBperA flips for rotations still
// measured about +Z.

import { type Mesh } from '../mesh/types';
import { resolveSpurSpec, toothProfile } from './involute';

export interface BevelPairSpec {
  teethA: number;
  teethB: number;
  /** Module at the outer (large-end) pitch circle, mm. */
  module: number;
  /** mm along the cone. Clamped to a third of the cone distance. */
  faceWidth: number;
  /** Default 20. */
  pressureAngleDeg?: number;
  /** mm of circular tooth thinning at the outer pitch circle, applied to each gear, default 0. */
  backlash?: number;
  /** Bore diameters in mm, 0 (the default) for none. */
  boreA?: number;
  boreB?: number;
  /** A cylindrical hub behind each gear. Length 0 (the default) for none. */
  hubLengthA?: number;
  hubLengthB?: number;
  /** Clamped to fit between the bore and the back face. Default: a little over half the back face. */
  hubDiameterA?: number;
  hubDiameterB?: number;
  /** Points per tooth flank and per root fillet, defaults 8 and 4. */
  flankPoints?: number;
  filletPoints?: number;
}

export interface BevelPair {
  /**
   * Gear A's axis is +Z, gear B's axis is +X; both pitch-cone apexes are at the origin; the teeth
   * of the two meshes interleave when rotations are a = 0, b = 0.
   */
  gearA: Mesh;
  gearB: Mesh;
  /** Radians. */
  pitchAngleA: number;
  pitchAngleB: number;
  coneDistance: number;
  outerPitchRadiusA: number;
  outerPitchRadiusB: number;
  /** The face width used, after clamping. */
  faceWidth: number;
  /** Axial extent of each gear along its own axis, measured from the apex: [nearest, farthest], hub included. */
  extentA: readonly [number, number];
  extentB: readonly [number, number];
  /** Rotating A by thetaA about +Z requires rotating B by this about +X: thetaB = ratioBperA * thetaA. */
  ratioBperA: number;
}

/** Thickness of the body under the tooth roots, in modules, measured along the back cone. */
const RIM = 1.0;
/** Target number of facets around the round surfaces. */
const ROUND_SEGMENTS = 64;

interface GearParams {
  teeth: number;
  pitchAngle: number;
  module: number;
  coneDistance: number;
  faceWidth: number;
  pressureAngleDeg: number;
  backlash: number;
  bore: number;
  hubLength: number;
  hubDiameter: number | undefined;
  /** Azimuth of tooth 0's centre. */
  phase: number;
  flankPoints: number;
  filletPoints: number;
}

interface Built {
  positions: Float64Array;
  indices: Uint32Array;
  near: number;
  far: number;
}

/** Build a gear about +Z with its pitch cone opening upwards from the origin. */
function buildGear(p: GearParams): Built {
  const z = p.teeth;
  const m = p.module;
  const cg = Math.cos(p.pitchAngle);
  const sg = Math.sin(p.pitchAngle);
  const virtualTeeth = z / cg;
  const prof = toothProfile(
    virtualTeeth,
    resolveSpurSpec({
      teeth: Math.round(virtualTeeth),
      module: m,
      pressureAngleDeg: p.pressureAngleDeg,
      backlash: p.backlash,
      flankPoints: p.flankPoints,
      filletPoints: p.filletPoints,
    }),
  );
  const ppt = prof.count;
  const half = prof.layout.half;
  const n = z * ppt;
  const pitch = (2 * Math.PI) / z;
  const apexHeight = p.coneDistance / cg; // the back cone's apex, on the axis
  const toeScale = (p.coneDistance - p.faceWidth) / p.coneDistance;

  // The tooth outline must climb steadily away from the axis for the face triangulation below.
  for (let k = 1; k <= half; k++) {
    if (!(prof.xy[2 * k]! > prof.xy[2 * (k - 1)]!)) throw new RangeError('bevel tooth profile folds back on itself');
  }

  const pos: number[] = [];
  const idx: number[] = [];

  // A point of the developed back cone at distance rho from its apex and angle psi from the tooth
  // centre lands at radius rho * cos(gamma), height apexHeight - rho * sin(gamma), azimuth psi / cos(gamma).
  const rho = new Float64Array(ppt);
  const azimuth = new Float64Array(ppt);
  for (let k = 0; k < ppt; k++) {
    const x = prof.xy[2 * k]!;
    const y = prof.xy[2 * k + 1]!;
    rho[k] = Math.hypot(x, y);
    azimuth[k] = Math.atan2(y, x) / cg;
  }
  // Heel outline (the large end) is vertices 0 .. n-1, toe outline n .. 2n-1.
  for (const scale of [1, toeScale]) {
    for (let i = 0; i < z; i++) {
      for (let k = 0; k < ppt; k++) {
        const a = azimuth[k]! + i * pitch + p.phase;
        const radius = rho[k]! * cg * scale;
        pos.push(radius * Math.cos(a), radius * Math.sin(a), (apexHeight - rho[k]! * sg) * scale);
      }
    }
  }

  // Body. Under the roots the back cone continues inwards for RIM modules; from there the back is
  // flat, then come the hub, the bore, the flat front and the front cone up to the toe roots.
  const rimRho = prof.rootRadius - RIM * m;
  if (!(rimRho > 0)) throw new RangeError('bevel gear is too small for its module');
  const heelRimRadius = rimRho * cg;
  const heelRimHeight = apexHeight - rimRho * sg;
  const toeRimRadius = heelRimRadius * toeScale;
  const toeRimHeight = heelRimHeight * toeScale;
  const boreRadius = Math.max(0, p.bore / 2);
  if (boreRadius > 0 && !(boreRadius < toeRimRadius - 0.3 * m)) throw new RangeError('bevel bore is too large for the gear');
  const hubLength = Math.max(0, p.hubLength);
  const hubWanted = p.hubDiameter !== undefined ? p.hubDiameter / 2 : Math.max(boreRadius + 2 * m, 0.55 * heelRimRadius);
  const hubRadius = Math.min(heelRimRadius, Math.max(hubWanted, boreRadius + 0.5 * m));
  const backHeight = heelRimHeight + hubLength;

  const per = Math.max(2, Math.ceil(ROUND_SEGMENTS / z)); // ring points per tooth
  const ringCount = z * per;
  const addRing = (radius: number, height: number): number => {
    const start = pos.length / 3;
    for (let j = 0; j < ringCount; j++) {
      const a = (j / per - 0.5) * pitch + p.phase;
      pos.push(radius * Math.cos(a), radius * Math.sin(a), height);
    }
    return start;
  };
  // Rings are joined in the order met going counter-clockwise round the (radius, height) section,
  // which makes every quad counter-clockwise seen from outside.
  const strip = (from: number, to: number): void => {
    for (let j = 0; j < ringCount; j++) {
      const j1 = (j + 1) % ringCount;
      idx.push(from + j, from + j1, to + j1, from + j, to + j1, to + j);
    }
  };

  const heelRim = addRing(heelRimRadius, heelRimHeight);
  let last = heelRim;
  if (hubLength > 0) {
    if (hubRadius < heelRimRadius - 1e-6 * m) {
      const hubBase = addRing(hubRadius, heelRimHeight);
      strip(last, hubBase);
      last = hubBase;
    }
    const hubEnd = addRing(hubRadius, backHeight);
    strip(last, hubEnd);
    last = hubEnd;
  }
  const toeRim = addRing(toeRimRadius, toeRimHeight);
  if (boreRadius > 0) {
    const boreBack = addRing(boreRadius, backHeight);
    strip(last, boreBack);
    const boreFront = addRing(boreRadius, toeRimHeight);
    strip(boreBack, boreFront);
    strip(boreFront, toeRim);
  } else {
    const backCentre = pos.length / 3;
    pos.push(0, 0, backHeight);
    const frontCentre = backCentre + 1;
    pos.push(0, 0, toeRimHeight);
    for (let j = 0; j < ringCount; j++) {
      const j1 = (j + 1) % ringCount;
      idx.push(last + j, last + j1, backCentre, frontCentre, toeRim + j1, toeRim + j);
    }
  }

  // Tooth surfaces: every outline edge swept from toe to heel.
  for (let e = 0; e < n; e++) {
    const e1 = (e + 1) % n;
    idx.push(n + e, n + e1, e1, n + e, e1, e);
  }

  // End faces. Each tooth is a ladder of quads between mirror-image points, capped by a triangle
  // at the tip, and sits on a fan that joins its base (root centre to root centre) to the rim ring.
  const tri = (a: number, b: number, c: number, flip: boolean): void => {
    if (flip) idx.push(a, c, b);
    else idx.push(a, b, c);
  };
  const face = (outline: number, rim: number, flip: boolean): void => {
    const midRing = per >> 1;
    for (let i = 0; i < z; i++) {
      const c = (k: number): number => outline + ((i * ppt + k) % n);
      const q = (s: number): number => rim + ((i * per + s) % ringCount);
      for (let k = 0; k <= half - 2; k++) {
        tri(c(k), c(k + 1), c(ppt - k - 1), flip);
        tri(c(k), c(ppt - k - 1), c(ppt - k), flip);
      }
      tri(c(half - 1), c(half), c(half + 1), flip);
      for (let s = 0; s < midRing; s++) tri(c(0), q(s + 1), q(s), flip);
      tri(c(0), c(ppt), q(midRing), flip);
      for (let s = midRing; s < per; s++) tri(c(ppt), q(s + 1), q(s), flip);
    }
  };
  face(0, heelRim, false);
  face(n, toeRim, true);

  let near = Infinity;
  let far = -Infinity;
  for (let i = 2; i < pos.length; i += 3) {
    const h = pos[i]!;
    if (h < near) near = h;
    if (h > far) far = h;
  }
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx), near, far };
}

export function bevelPair(spec: BevelPairSpec): BevelPair {
  const zA = spec.teethA;
  const zB = spec.teethB;
  if (!Number.isInteger(zA) || !Number.isInteger(zB) || zA < 6 || zB < 6) throw new RangeError('bevel teeth must be integers >= 6');
  const m = spec.module;
  if (!(m > 0) || !Number.isFinite(m)) throw new RangeError('bevel module must be positive');
  const outerPitchRadiusA = (m * zA) / 2;
  const outerPitchRadiusB = (m * zB) / 2;
  const coneDistance = Math.hypot(outerPitchRadiusA, outerPitchRadiusB);
  const pitchAngleA = Math.atan2(zA, zB);
  const pitchAngleB = Math.PI / 2 - pitchAngleA;
  if (!(spec.faceWidth > 0)) throw new RangeError('bevel face width must be positive');
  const faceWidth = Math.min(spec.faceWidth, coneDistance / 3);

  const common = {
    module: m,
    coneDistance,
    faceWidth,
    pressureAngleDeg: spec.pressureAngleDeg ?? 20,
    backlash: spec.backlash ?? 0,
    flankPoints: spec.flankPoints ?? 8,
    filletPoints: spec.filletPoints ?? 4,
  };
  // A: a tooth centred on the pitch line (azimuth 0).
  const a = buildGear({
    ...common,
    teeth: zA,
    pitchAngle: pitchAngleA,
    bore: spec.boreA ?? 0,
    hubLength: spec.hubLengthA ?? 0,
    hubDiameter: spec.hubDiameterA,
    phase: 0,
  });
  // B: a tooth space centred on the pitch line, so the teeth interleave.
  const b = buildGear({
    ...common,
    teeth: zB,
    pitchAngle: pitchAngleB,
    bore: spec.boreB ?? 0,
    hubLength: spec.hubLengthB ?? 0,
    hubDiameter: spec.hubDiameterB,
    phase: Math.PI / zB,
  });
  // Lay B over: its own axis becomes +X and its azimuth 0 becomes +Z. (x, y, z) -> (z, -y, x) is
  // a rotation, so the triangles keep their orientation.
  const pb = b.positions;
  for (let i = 0; i < pb.length; i += 3) {
    const x = pb[i]!;
    const y = pb[i + 1]!;
    const h = pb[i + 2]!;
    pb[i] = h;
    pb[i + 1] = -y;
    pb[i + 2] = x;
  }

  return {
    gearA: { positions: a.positions, indices: a.indices },
    gearB: { positions: pb, indices: b.indices },
    pitchAngleA,
    pitchAngleB,
    coneDistance,
    outerPitchRadiusA,
    outerPitchRadiusB,
    faceWidth,
    extentA: [a.near, a.far],
    extentB: [b.near, b.far],
    // At the pitch point A's surface moves along +Y for a positive turn about +Z, and B's moves
    // along -Y for a positive turn about +X, so the two turn in opposite senses.
    ratioBperA: -zA / zB,
  };
}
