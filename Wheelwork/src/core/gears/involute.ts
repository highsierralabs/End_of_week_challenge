// Spur gear tooth outlines, generated the way a rack cutter generates them.
//
// The cutter is the basic rack: straight flanks at the pressure angle, a flat tip, and a rounded
// corner between them. Rolling its pitch line on the gear's pitch circle and taking the envelope
// gives the whole tooth:
//   - the straight flank generates the involute;
//   - the flat tip generates the root circle;
//   - the rounded corner generates the root fillet, an offset trochoid.
// When the straight flank reaches deeper than the interference point (depth r*sin^2(alpha) below
// the pitch line) the corner's trochoid sweeps back through the involute near the base circle.
// That is undercut. It is handled by intersecting the trochoid with the involute and keeping the
// fillet below the intersection and the involute above it, which is what the cutter leaves.
//
// Lengths are millimetres. Nothing here knows about the DOM, clocks or random numbers.

import { type Ring, type Vec2 } from '../mesh/types';

const DEG = Math.PI / 180;

export interface SpurSpec {
  /** Number of teeth, an integer >= 6. */
  teeth: number;
  /** Module in mm (pitch diameter / teeth). Any positive real number. */
  module: number;
  /** Default 20. */
  pressureAngleDeg?: number;
  /** In modules, default 1.0. */
  addendum?: number;
  /** In modules, default 1.25. */
  dedendum?: number;
  /**
   * Radius of the rounded cutter tip corner in modules, default 0.25. It sets the root fillet. It is
   * clamped to the largest radius that fits the rack tooth (about 0.47 for the default proportions).
   */
  rackTipRadius?: number;
  /** mm of circular tooth thinning at the pitch circle, total for this gear, default 0. */
  backlash?: number;
  /** mm: size of a tip corner chamfer (the corner is cut back by this much on both faces), default 0. */
  tipRelief?: number;
  /** Points per involute flank, default 10 (minimum 2). */
  flankPoints?: number;
  /** Points per root fillet, default 6 (minimum 2). */
  filletPoints?: number;
}

/**
 * How one tooth's points are arranged. A tooth has `2 * half` points, counter-clockwise:
 * `root` root-centre points (0 or 1), `fillet` fillet points, `flank` involute points from the
 * form radius to the tip, `relief` chamfer points (0 or 1), one tip-centre point, and then the
 * mirror image of the first `half` points in reverse order, without the very first one (that
 * point is the first point of the next tooth). `half = root + fillet + flank + relief`.
 * The mirror of point `k` of a tooth (1 <= k < half) is point `2 * half - k`.
 */
export interface ToothLayout {
  root: number;
  fillet: number;
  flank: number;
  relief: number;
  half: number;
}

export interface SpurGeometry {
  spec: Required<SpurSpec>;
  /** Counter-clockwise, centred on the origin, tooth 0 centred on the +X axis. */
  outline: Ring;
  pitchRadius: number;
  baseRadius: number;
  /** Outside radius. Equal to pitchRadius + addendum * module unless the tooth would be pointed. */
  tipRadius: number;
  rootRadius: number;
  /** Arc length at the pitch circle, after backlash. */
  toothThicknessAtPitch: number;
  /** True when the generated fillet removes involute above the base circle. */
  undercut: boolean;
  /** outline.length / teeth. Tooth i owns outline[i * pointsPerTooth .. (i + 1) * pointsPerTooth). */
  pointsPerTooth: number;
  /** Radius where the involute begins (the top of the fillet). Above the base radius when undercut. */
  formRadius: number;
  /** Radius where the involute ends: tipRadius, or a little less when there is tip relief. */
  flankTipRadius: number;
  layout: ToothLayout;
}

/**
 * One tooth in its own frame: the gear centre is the origin and the tooth is centred on +X. The
 * first point sits on the root circle exactly half a pitch clockwise of the tooth centre; the
 * matching point half a pitch counter-clockwise belongs to the next tooth and is not included.
 */
export interface ToothProfile {
  /** x0, y0, x1, y1, ... for `count` points. */
  xy: Float64Array;
  count: number;
  layout: ToothLayout;
  pitchRadius: number;
  baseRadius: number;
  tipRadius: number;
  rootRadius: number;
  formRadius: number;
  flankTipRadius: number;
  toothThicknessAtPitch: number;
  undercut: boolean;
  /** The cutter tip radius actually used, in modules (after clamping). */
  rackTipRadius: number;
}

/** Fill in the defaults. Throws RangeError on values no gear can have. */
export function resolveSpurSpec(spec: SpurSpec): Required<SpurSpec> {
  const out: Required<SpurSpec> = {
    teeth: spec.teeth,
    module: spec.module,
    pressureAngleDeg: spec.pressureAngleDeg ?? 20,
    addendum: spec.addendum ?? 1.0,
    dedendum: spec.dedendum ?? 1.25,
    rackTipRadius: spec.rackTipRadius ?? 0.25,
    backlash: spec.backlash ?? 0,
    tipRelief: spec.tipRelief ?? 0,
    flankPoints: Math.max(2, Math.round(spec.flankPoints ?? 10)),
    filletPoints: Math.max(2, Math.round(spec.filletPoints ?? 6)),
  };
  if (!(out.module > 0) || !Number.isFinite(out.module)) throw new RangeError('gear module must be positive');
  if (!(out.pressureAngleDeg >= 10 && out.pressureAngleDeg <= 35)) {
    throw new RangeError('pressure angle must be between 10 and 35 degrees');
  }
  if (!(out.addendum > 0) || !(out.dedendum > 0)) throw new RangeError('addendum and dedendum must be positive');
  if (!(out.backlash >= 0) || !(out.tipRelief >= 0) || !(out.rackTipRadius >= 0)) {
    throw new RangeError('backlash, tipRelief and rackTipRadius must not be negative');
  }
  return out;
}

/**
 * Generate one tooth. `teeth` may be any real number >= 6 here: a bevel gear's back-cone tooth is
 * the tooth of a virtual spur gear with a fractional tooth count. `s.teeth` is ignored.
 */
export function toothProfile(teeth: number, s: Required<SpurSpec>): ToothProfile {
  if (!(teeth >= 6) || !Number.isFinite(teeth)) throw new RangeError('a gear needs at least 6 teeth');
  const m = s.module;
  const alpha = s.pressureAngleDeg * DEG;
  const sa = Math.sin(alpha);
  const ca = Math.cos(alpha);
  const ta = sa / ca;
  const r = (m * teeth) / 2;
  const rb = r * ca;
  const b = s.dedendum * m;
  const rootRadius = r - b;
  if (!(rootRadius > 0)) throw new RangeError('dedendum reaches the gear centre');

  const thickness = (Math.PI * m) / 2 - s.backlash;
  if (!(thickness > 0.2 * m)) throw new RangeError('backlash leaves no tooth');
  // The cutter tooth fills the gear's tooth space, so its half width at the pitch line is half the space.
  const halfSpace = (Math.PI * m - thickness) / 2;

  // Cutter coordinates: u is depth below the pitch line (towards the gear centre), v runs along it,
  // with the cutter tooth centred on v = 0. The flank is v = halfSpace - u * tan(alpha).
  const rhoMax = (halfSpace - b * ta) / (1 / ca - ta);
  if (!(rhoMax >= 0)) throw new RangeError('dedendum is deeper than the rack tooth is long');
  const rho = Math.min(s.rackTipRadius * m, rhoMax);
  const uc = b - rho; // corner circle centre
  if (!(uc > 0)) throw new RangeError('rack tip radius is larger than the dedendum');
  const vc = Math.max(0, halfSpace - uc * ta - rho / ca);
  const ut = uc + rho * sa; // depth where the straight flank ends
  const uCusp = r * sa * sa; // depth of the interference point: its image is the involute's start on the base circle
  const undercut = ut > uCusp + 1e-12 * m;

  const invAlpha = ta - alpha;
  const halfSpaceAngle = halfSpace / r;
  // Everything below is in the "space frame": the gear centre is the origin and the centre of a
  // tooth space lies on +X; the flank generated here bounds the tooth on its counter-clockwise side.
  /** Polar angle of the involute at radius R >= rb. */
  const flankAngle = (R: number): number => {
    const t = Math.sqrt(Math.max(0, R * R - rb * rb)) / rb;
    return halfSpaceAngle + (t - Math.atan(t)) - invAlpha;
  };
  /** Cutter depth whose straight-flank point generates the involute at radius R. */
  const depthAt = (R: number): number => sa * (r * sa - Math.sqrt(Math.max(0, R * R - rb * rb)));

  // Envelope points. With the rack shifted by s along its pitch line the gear has turned s / r. A
  // cutter point is on the envelope when its normal passes through the pitch point.
  let px = 0;
  let py = 0;
  /** Involute point generated by the straight flank at depth u. */
  const flankPoint = (u: number): void => {
    const theta = (u / (sa * ca) - halfSpace) / r;
    const X = r - u;
    const Y = u / ta;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    px = X * c + Y * sn;
    py = -X * sn + Y * c;
  };
  let nx = 0;
  let ny = 0;
  /**
   * Fillet point generated by the corner circle where its outward normal makes angle beta with the
   * depth axis, and the curve's unit normal there (the cutter's normal, carried into the gear).
   */
  const filletPoint = (beta: number): void => {
    const tb = Math.tan(beta);
    const cb = Math.cos(beta);
    const sb = Math.sin(beta);
    const theta = (uc * tb - vc) / r;
    const X = r - uc - rho * cb;
    const Y = uc * tb + rho * sb;
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    px = X * c + Y * sn;
    py = -X * sn + Y * c;
    nx = -cb * c + sb * sn;
    ny = cb * sn + sb * c;
  };

  // Where the fillet hands over to the involute.
  const betaEnd = Math.PI / 2 - alpha;
  let betaJoin = betaEnd;
  let formRadius: number;
  if (!undercut) {
    // Tangent join at the end of the straight flank.
    formRadius = Math.hypot(r - ut, ut / ta);
  } else {
    // side(beta) > 0 while the fillet is the tooth boundary: below the base circle, or deeper into
    // the tooth than the involute at the same radius. At betaEnd the trochoid has left the tooth
    // again (it joins the flank's second, discarded branch), so side < 0 there.
    const side = (beta: number): number => {
      filletPoint(beta);
      const R = Math.hypot(px, py);
      if (R <= rb) return 1;
      return Math.atan2(py, px) - flankAngle(R);
    };
    let lo = 0;
    let hi = betaEnd;
    const scan = 24;
    for (let k = scan - 1; k >= 0; k--) {
      const beta = (betaEnd * k) / scan;
      if (side(beta) > 0) {
        lo = beta;
        hi = (betaEnd * (k + 1)) / scan;
        break;
      }
    }
    for (let i = 0; i < 48; i++) {
      const mid = 0.5 * (lo + hi);
      if (side(mid) > 0) lo = mid;
      else hi = mid;
    }
    betaJoin = lo;
    filletPoint(betaJoin);
    formRadius = Math.max(rb, Math.hypot(px, py));
  }

  // Tip. A tooth with too many addenda for its tooth count comes to a point below the nominal
  // outside radius; keep a small land instead.
  const halfPitchAngle = Math.PI / teeth;
  let tipRadius = r + s.addendum * m;
  const minLand = (0.025 * m) / tipRadius; // half the smallest tip land, as an angle
  if (flankAngle(tipRadius) > halfPitchAngle - minLand) {
    if (flankAngle(formRadius) > halfPitchAngle - minLand) throw new RangeError('tooth has no flank');
    let lo = formRadius;
    let hi = tipRadius;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (flankAngle(mid) > halfPitchAngle - minLand) hi = mid;
      else lo = mid;
    }
    tipRadius = lo;
  }
  if (!(tipRadius > formRadius)) throw new RangeError('tooth has no flank');
  const halfLand = (halfPitchAngle - flankAngle(tipRadius)) * tipRadius;
  const relief = Math.min(s.tipRelief, 0.5 * halfLand, 0.5 * (tipRadius - formRadius));
  const hasRelief = relief > 1e-9 * m;
  const flankTipRadius = hasRelief ? tipRadius - relief : tipRadius;

  const hasRootPoint = vc > 1e-9 * m;
  const nRoot = hasRootPoint ? 1 : 0;
  const nFillet = s.filletPoints;
  const nFlank = s.flankPoints;
  const nRelief = hasRelief ? 1 : 0;
  const half = nRoot + nFillet + nFlank + nRelief;
  const count = 2 * half;
  const xy = new Float64Array(2 * count);

  // Rotate from the space frame into the tooth frame: the tooth centre is half a pitch ahead.
  const c0 = Math.cos(halfPitchAngle);
  const s0 = Math.sin(halfPitchAngle);
  let n = 0;
  const put = (x: number, y: number): void => {
    xy[2 * n] = x * c0 + y * s0;
    xy[2 * n + 1] = -x * s0 + y * c0;
    n++;
  };

  if (hasRootPoint) put(rootRadius, 0);
  // The fillet is hollow, so a polygon through points of the curve would bulge into the tooth
  // space, exactly where the mating tip passes closest to an undercut flank. Its corners are
  // therefore the intersections of consecutive tangents: the polygon touches the true fillet and
  // otherwise lies on the metal side of it, never in the space. The tangents are taken at equal
  // steps of the curve's direction, which turns by beta + (uc / r) * tan(beta).
  const turn = (beta: number): number => beta + (uc / r) * Math.tan(beta);
  const turnJoin = turn(betaJoin);
  let beta = 0;
  filletPoint(0);
  if (hasRootPoint) put(px, py);
  else put(rootRadius, 0); // the fillet starts on the centre line of the space
  for (let k = 1; k < nFillet; k++) {
    const x1 = px;
    const y1 = py;
    const n1x = nx;
    const n1y = ny;
    // Solve turn(beta) = target by Newton from the right, which converges monotonically.
    const target = (turnJoin * k) / (nFillet - 1);
    beta = k === nFillet - 1 ? betaJoin : Math.min(target, betaJoin);
    if (k < nFillet - 1) {
      for (let i = 0; i < 8; i++) {
        const cb = Math.cos(beta);
        const step = (turn(beta) - target) / (1 + uc / (r * cb * cb));
        beta -= step;
        if (Math.abs(step) < 1e-13) break;
      }
    }
    filletPoint(beta);
    const d1 = n1x * x1 + n1y * y1;
    const d2 = nx * px + ny * py;
    const det = n1x * ny - n1y * nx;
    let vx = 0.5 * (x1 + px);
    let vy = 0.5 * (y1 + py);
    if (Math.abs(det) > 1e-9) {
      const ix = (d1 * ny - d2 * n1y) / det;
      const iy = (n1x * d2 - nx * d1) / det;
      const ex = px - x1;
      const ey = py - y1;
      const along = ((ix - x1) * ex + (iy - y1) * ey) / (ex * ex + ey * ey);
      if (along > 0 && along < 1) {
        vx = ix;
        vy = iy;
      }
    }
    put(vx, vy);
  }
  const uStart = depthAt(formRadius);
  const uEnd = depthAt(flankTipRadius);
  for (let j = 0; j < nFlank; j++) {
    // Uniform in depth is uniform in involute roll angle, which puts more points where it curves most.
    flankPoint(uStart + ((uEnd - uStart) * j) / (nFlank - 1));
    put(px, py);
  }
  if (hasRelief) {
    const a = flankAngle(tipRadius) + relief / tipRadius;
    put(tipRadius * Math.cos(a), tipRadius * Math.sin(a));
  }
  // Tip centre, then the mirror image.
  xy[2 * n] = tipRadius;
  xy[2 * n + 1] = 0;
  n++;
  for (let k = half - 1; k >= 1; k--) {
    xy[2 * n] = xy[2 * k]!;
    xy[2 * n + 1] = -xy[2 * k + 1]!;
    n++;
  }

  return {
    xy,
    count,
    layout: { root: nRoot, fillet: nFillet, flank: nFlank, relief: nRelief, half },
    pitchRadius: r,
    baseRadius: rb,
    tipRadius,
    rootRadius,
    formRadius,
    flankTipRadius,
    toothThicknessAtPitch: thickness,
    undercut,
    rackTipRadius: rho / m,
  };
}

/** A complete spur gear outline. */
export function spurGear(spec: SpurSpec): SpurGeometry {
  const s = resolveSpurSpec(spec);
  if (!Number.isInteger(s.teeth) || s.teeth < 6) throw new RangeError('teeth must be an integer >= 6');
  const z = s.teeth;
  const tooth = toothProfile(z, s);
  s.rackTipRadius = tooth.rackTipRadius;
  const ppt = tooth.count;
  const xy = tooth.xy;
  const outline: Vec2[] = new Array<Vec2>(z * ppt);
  let n = 0;
  for (let i = 0; i < z; i++) {
    const a = (2 * Math.PI * i) / z;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    for (let k = 0; k < ppt; k++) {
      const x = xy[2 * k]!;
      const y = xy[2 * k + 1]!;
      outline[n++] = [x * c - y * sn, x * sn + y * c];
    }
  }
  return {
    spec: s,
    outline,
    pitchRadius: tooth.pitchRadius,
    baseRadius: tooth.baseRadius,
    tipRadius: tooth.tipRadius,
    rootRadius: tooth.rootRadius,
    toothThicknessAtPitch: tooth.toothThicknessAtPitch,
    undercut: tooth.undercut,
    pointsPerTooth: ppt,
    formRadius: tooth.formRadius,
    flankTipRadius: tooth.flankTipRadius,
    layout: tooth.layout,
  };
}

/**
 * The textbook limit `2 * addendum / sin^2(alpha)`, rounded to the nearest whole tooth as the
 * textbooks do: 17 for a 20 degree full-depth tooth. It assumes the cutter's straight flank stops
 * one addendum below the pitch line. The cutter here is straight a little deeper than that when
 * `rackTipRadius` is small (1.0855 modules for the default 0.25), so `SpurGeometry.undercut`,
 * which reports what the generated profile actually does, can be true for one or two more teeth.
 */
export function minTeethWithoutUndercut(pressureAngleDeg = 20, addendum = 1): number {
  const s = Math.sin(pressureAngleDeg * DEG);
  return Math.round((2 * addendum) / (s * s));
}

/**
 * Rotation (radians, about +Z) that gear B must have so that it meshes with gear A.
 * A is centred at the origin with rotation thetaA; B is centred in direction `phi` (radians) from
 * A, at whatever centre distance. Both outlines have tooth 0 centred on their own +X axis at
 * rotation 0. B turns against A at the tooth ratio, so calling this for any thetaA keeps the pair
 * in mesh, with each tooth centred in its space (backlash split evenly between the two flanks).
 */
export function matingRotation(thetaA: number, zA: number, zB: number, phi: number): number {
  // With thetaA = 0 and phi = 0 a tooth of A points at B, so B needs a space pointing back at A:
  // its tooth 0 half a pitch away from the direction pi. Turning the line of centres by phi rolls
  // B around A, which turns B by phi * (zA + zB) / zB.
  return Math.PI - Math.PI / zB + (phi * (zA + zB) - thetaA * zA) / zB;
}
