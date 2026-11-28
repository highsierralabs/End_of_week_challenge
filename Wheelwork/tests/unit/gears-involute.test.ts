// Spur gear outlines: the shape is a valid polygon, the flanks are true involutes, and the whole
// tooth (fillet and undercut included) is what a rack cutter leaves behind.

import { describe, expect, it } from 'vitest';
import { matingRotation, minTeethWithoutUndercut, spurGear, type SpurGeometry } from '../../src/core/gears/involute';
import { type Ring } from '../../src/core/mesh/types';

const TEETH = [6, 8, 10, 12, 14, 17, 20, 37, 60, 110] as const;
const MODULES = [0.8, 1.37, 2.5] as const;
const ALPHA = (20 * Math.PI) / 180;
const inv = (a: number): number => Math.tan(a) - a;

function signedArea(ring: Ring): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    twice += p[0] * q[1] - q[0] * p[1];
  }
  return twice / 2;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Do segments p1-p2 and q1-q2 touch or cross? */
function segmentsMeet(ring: Ring, i: number, j: number): boolean {
  const n = ring.length;
  const p1 = ring[i]!;
  const p2 = ring[(i + 1) % n]!;
  const q1 = ring[j]!;
  const q2 = ring[(j + 1) % n]!;
  const d1 = orient(q1[0], q1[1], q2[0], q2[1], p1[0], p1[1]);
  const d2 = orient(q1[0], q1[1], q2[0], q2[1], p2[0], p2[1]);
  const d3 = orient(p1[0], p1[1], p2[0], p2[1], q1[0], q1[1]);
  const d4 = orient(p1[0], p1[1], p2[0], p2[1], q2[0], q2[1]);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

/**
 * Number of edge pairs that meet without being neighbours. Only tooth 0's edges are tried against
 * every edge: the outline has `teeth`-fold symmetry (tested separately), so any crossing anywhere
 * has an image that involves tooth 0.
 */
function crossings(g: SpurGeometry): number {
  const ring = g.outline;
  const n = ring.length;
  let found = 0;
  for (let i = 0; i < g.pointsPerTooth; i++) {
    for (let j = 0; j < n; j++) {
      const gap = (j - i + n) % n;
      if (gap <= 1 || gap === n - 1) continue;
      if (segmentsMeet(ring, i, j)) found++;
    }
  }
  return found;
}

/** Indices, within one tooth, of the involute points of the clockwise-side flank. */
function flankIndices(g: SpurGeometry): number[] {
  const first = g.layout.root + g.layout.fillet;
  return Array.from({ length: g.layout.flank }, (_, k) => first + k);
}

describe('spur outline is a valid polygon', () => {
  for (const teeth of TEETH) {
    for (const module of MODULES) {
      it(`z=${teeth} m=${module}`, () => {
        const g = spurGear({ teeth, module });
        const ring = g.outline;
        const ppt = g.pointsPerTooth;
        expect(ring.length).toBe(teeth * ppt);
        expect(ppt).toBe(2 * g.layout.half);

        // Counter-clockwise, with an area between the root and tip discs.
        const area = signedArea(ring);
        expect(area).toBeGreaterThan(Math.PI * g.rootRadius ** 2 * 0.95);
        expect(area).toBeLessThan(Math.PI * g.tipRadius ** 2);

        // teeth-fold symmetry: each tooth is the previous one turned by a pitch.
        const c = Math.cos((2 * Math.PI) / teeth);
        const s = Math.sin((2 * Math.PI) / teeth);
        let worst = 0;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i]!;
          const q = ring[(i + ppt) % ring.length]!;
          worst = Math.max(worst, Math.hypot(p[0] * c - p[1] * s - q[0], p[0] * s + p[1] * c - q[1]));
        }
        expect(worst).toBeLessThan(1e-9);

        // Tooth 0 is centred on +X: it is its own mirror image, and its first point is on the
        // root circle half a pitch clockwise.
        for (let k = 1; k < g.layout.half; k++) {
          const p = ring[k]!;
          const q = ring[ppt - k]!;
          expect(Math.abs(p[0] - q[0]) + Math.abs(p[1] + q[1])).toBeLessThan(1e-12);
        }
        expect(ring[g.layout.half]![1]).toBe(0);
        expect(Math.hypot(ring[0]![0], ring[0]![1])).toBeCloseTo(g.rootRadius, 9);
        expect(Math.atan2(ring[0]![1], ring[0]![0])).toBeCloseTo(-Math.PI / teeth, 9);

        // No repeated points and no edge meeting another: a simple polygon.
        let shortest = Infinity;
        for (let i = 0; i < ppt; i++) {
          const p = ring[i]!;
          const q = ring[i + 1 < ring.length ? i + 1 : 0]!;
          shortest = Math.min(shortest, Math.hypot(q[0] - p[0], q[1] - p[1]));
        }
        expect(shortest).toBeGreaterThan(1e-4 * module);
        expect(crossings(g)).toBe(0);

        // Every tooth climbs steadily from root to tip (the bevel face triangulation relies on it).
        for (let k = 1; k <= g.layout.half; k++) expect(ring[k]![0]).toBeGreaterThan(ring[k - 1]![0]);
      });
    }
  }
});

describe('spur tooth dimensions', () => {
  for (const teeth of TEETH) {
    for (const module of MODULES) {
      for (const backlash of [0, 0.08]) {
        it(`z=${teeth} m=${module} backlash=${backlash}`, () => {
          const g = spurGear({ teeth, module, backlash });
          const r = (module * teeth) / 2;
          const rb = r * Math.cos(ALPHA);
          expect(g.pitchRadius).toBeCloseTo(r, 12);
          expect(g.baseRadius).toBeCloseTo(rb, 12);
          expect(g.tipRadius).toBeCloseTo(r + module, 12);
          expect(g.rootRadius).toBeCloseTo(r - 1.25 * module, 12);
          expect(g.toothThicknessAtPitch).toBeCloseTo((Math.PI * module) / 2 - backlash, 12);

          // The outline really reaches those radii and no further.
          let lo = Infinity;
          let hi = 0;
          for (const p of g.outline) {
            const R = Math.hypot(p[0], p[1]);
            lo = Math.min(lo, R);
            hi = Math.max(hi, R);
          }
          expect(Math.abs(lo - g.rootRadius)).toBeLessThan(1e-9);
          expect(Math.abs(hi - g.tipRadius)).toBeLessThan(1e-9);

          // Involute points, by the string-unwinding construction. For the clockwise-side flank
          // of tooth 0 the string leaves the base circle at T, the point of the base circle that
          // is alpha_R ahead of P in angle (cos(alpha_R) = rb / R). P is an involute point when
          // PT is tangent to the base circle and as long as the arc from the involute's origin
          // to T. The origin's angle follows from the tooth thickness the gear should have:
          // -(thickness / 2r + inv(alpha)).
          const thickness = (Math.PI * module) / 2 - backlash;
          const origin = -(thickness / (2 * r) + inv(ALPHA));
          const indices = flankIndices(g);
          expect(indices.length).toBe(10);
          let previous = 0;
          for (const k of indices) {
            for (const mirror of [false, true]) {
              const p = g.outline[mirror ? g.pointsPerTooth - k : k]!;
              const x = p[0];
              const y = mirror ? -p[1] : p[1];
              const R = Math.hypot(x, y);
              expect(R).toBeGreaterThan(rb * (1 - 1e-12));
              const alphaR = Math.acos(Math.min(1, rb / R));
              const angleT = Math.atan2(y, x) + alphaR;
              const tx = rb * Math.cos(angleT);
              const ty = rb * Math.sin(angleT);
              const string = Math.hypot(x - tx, y - ty);
              expect(Math.abs(string - rb * (angleT - origin))).toBeLessThan(1e-9); // length = unwound arc
              expect(Math.abs((x - tx) * tx + (y - ty) * ty) / rb).toBeLessThan(1e-9); // tangent to the base circle
              // Equivalently: the thickness at the pitch circle implied by this point.
              const implied = 2 * r * (-Math.atan2(y, x) + inv(alphaR) - inv(ALPHA));
              expect(Math.abs(implied - thickness)).toBeLessThan(1e-9);
              if (!mirror) {
                expect(R).toBeGreaterThan(previous);
                previous = R;
              }
            }
          }
          // The flank runs from the form radius to the tip.
          const first = g.outline[indices[0]!]!;
          const last = g.outline[indices[indices.length - 1]!]!;
          expect(Math.hypot(first[0], first[1])).toBeCloseTo(g.formRadius, 9);
          expect(Math.hypot(last[0], last[1])).toBeCloseTo(g.tipRadius, 9);
          expect(g.flankTipRadius).toBe(g.tipRadius);
        });
      }
    }
  }
});

describe('undercut', () => {
  it('textbook limit', () => {
    expect(minTeethWithoutUndercut()).toBe(17); // 2 / sin^2(20 deg) = 17.097
    expect(minTeethWithoutUndercut(20, 1)).toBe(17);
    expect(minTeethWithoutUndercut(14.5)).toBe(32); // 31.9
    expect(minTeethWithoutUndercut(20, 0.8)).toBe(14); // stub tooth: 13.68
  });

  it('is reported when the fillet cuts into the involute', () => {
    // Default cutter (tip radius 0.25 m): the straight flank runs to 1.25 - 0.25 * (1 - sin 20) =
    // 1.0855 m below the pitch line, and undercuts when that exceeds (z / 2) * sin^2(20) modules,
    // i.e. for z < 18.56.
    for (let z = 6; z <= 30; z++) {
      const g = spurGear({ teeth: z, module: 1 });
      expect(g.undercut).toBe(z <= 18);
      if (g.undercut) expect(g.formRadius).toBeGreaterThan(g.baseRadius);
    }
    // ISO 53 style cutter (tip radius 0.38 m): straight to 1.0 m, the textbook case, z < 17.097.
    for (let z = 6; z <= 30; z++) {
      expect(spurGear({ teeth: z, module: 1, rackTipRadius: 0.38 }).undercut).toBe(z <= 17);
    }
    // More undercut the fewer the teeth: the form radius climbs away from the base circle.
    let previous = 0;
    for (const z of [18, 16, 14, 12, 10, 8, 6]) {
      const g = spurGear({ teeth: z, module: 1 });
      const lost = g.formRadius - g.baseRadius;
      expect(lost).toBeGreaterThan(previous);
      previous = lost;
    }
  });
});

// ---------------------------------------------------------------------------------------------
// An independent check of the whole tooth: roll the rack cutter past the finished outline and see
// that it never cuts it and that it touches every point that claims to be on the generated curve.
// Nothing here uses the envelope formulas of involute.ts; it only knows the cutter's shape.

interface Rack {
  module: number;
  pitchRadius: number;
  teeth: number;
  depth: number; // tip depth below the pitch line
  halfSpace: number; // half width of the cutter tooth on the pitch line
  rho: number;
  uc: number;
  vc: number;
}

function rackFor(g: SpurGeometry): Rack {
  const m = g.spec.module;
  const depth = g.spec.dedendum * m;
  const rho = g.spec.rackTipRadius * m;
  const halfSpace = (Math.PI * m - g.toothThicknessAtPitch) / 2;
  const uc = depth - rho;
  return { module: m, pitchRadius: g.pitchRadius, teeth: g.spec.teeth, depth, halfSpace, rho, uc, vc: halfSpace - uc * Math.tan(ALPHA) - rho / Math.cos(ALPHA) };
}

/** How deep the cutter reaches at position v along its pitch line (teeth repeat every pitch). */
function cutterDepth(rack: Rack, v: number): number {
  const pitch = Math.PI * rack.module;
  const av = Math.abs(v - pitch * Math.round(v / pitch));
  if (av <= rack.vc) return rack.depth;
  if (av <= rack.vc + rack.rho * Math.cos(ALPHA)) return rack.uc + Math.sqrt(rack.rho ** 2 - (av - rack.vc) ** 2);
  return (rack.halfSpace - av) / Math.tan(ALPHA);
}

/**
 * Gap between a point of the gear (tooth frame) and the cutter when the rack has rolled by s:
 * positive when the point is clear, negative when the cutter would have removed it. Measured
 * along the depth direction.
 */
function cutterGap(rack: Rack, x: number, y: number, s: number): number {
  // The space next to tooth 0 on its clockwise side is centred half a pitch back; turn the gear so
  // that this space faces the cutter tooth at s = 0, then roll.
  const a = Math.PI / rack.teeth + s / rack.pitchRadius;
  const fx = x * Math.cos(a) - y * Math.sin(a);
  const fy = x * Math.sin(a) + y * Math.cos(a);
  return rack.pitchRadius - fx - cutterDepth(rack, fy - s);
}

/**
 * Smallest gap over the whole pass of the cutter. The pass is scanned coarsely and every local
 * minimum of the scan is then refined, because a point near an undercut is approached twice: once
 * by the cutter's flank and once by its corner.
 */
function closestPass(rack: Rack, x: number, y: number): number {
  const pitch = Math.PI * rack.module;
  const steps = 2000;
  const ds = (4 * pitch) / steps;
  const gaps = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) gaps[i] = cutterGap(rack, x, y, -2 * pitch + ds * i);
  let best = Infinity;
  for (let i = 1; i < steps; i++) {
    const here = gaps[i]!;
    if (here > gaps[i - 1]! || here > gaps[i + 1]!) continue;
    let lo = -2 * pitch + ds * (i - 1);
    let hi = -2 * pitch + ds * (i + 1);
    for (let k = 0; k < 80; k++) {
      const a = lo + (hi - lo) / 3;
      const b = hi - (hi - lo) / 3;
      if (cutterGap(rack, x, y, a) < cutterGap(rack, x, y, b)) hi = b;
      else lo = a;
    }
    best = Math.min(best, here, cutterGap(rack, x, y, 0.5 * (lo + hi)));
  }
  return best;
}

describe('the outline is what a rack cutter generates', () => {
  for (const teeth of [6, 8, 10, 12, 14, 17, 20, 37, 60]) {
    it(`z=${teeth}`, () => {
      const module = 1.37;
      const g = spurGear({ teeth, module, backlash: 0.06 });
      const rack = rackFor(g);
      const { root, fillet, flank, half } = g.layout;
      const ppt = g.pointsPerTooth;

      let worstTouch = 0;
      let deepestFilletCorner = 0;
      for (let k = 0; k < ppt; k++) {
        const p = g.outline[k]!;
        const gap = closestPass(rack, p[0], p[1]);
        expect(gap).toBeGreaterThan(-1e-9); // never cut
        const h = k <= half ? k : ppt - k; // position within the half tooth
        const onCurve = h <= root || (h >= root + fillet && h < root + fillet + flank);
        if (onCurve) {
          worstTouch = Math.max(worstTouch, gap);
        } else if (h < root + fillet) {
          deepestFilletCorner = Math.max(deepestFilletCorner, gap);
        }
      }
      // Root, fillet start and every involute point are touched by the cutter.
      expect(worstTouch).toBeLessThan(1e-9); // measured: under 1e-14 mm
      // The other fillet corners are tangent intersections: in the metal, by a chord error only.
      expect(deepestFilletCorner).toBeLessThan(0.06 * module);

      // The edges are never cut either: flank chords lie inside the tooth, fillet edges are tangents.
      for (let k = 0; k < ppt; k++) {
        const p = g.outline[k]!;
        const q = g.outline[k + 1]!;
        for (const t of [0.25, 0.5, 0.75]) {
          expect(closestPass(rack, p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]))).toBeGreaterThan(-1e-9);
        }
      }

      if (g.undercut) {
        // The form radius, found again without the intersection solver: walk down the involute
        // and find where the cutter starts removing it. Above that radius the cutter only touches.
        const r = g.pitchRadius;
        const rb = g.baseRadius;
        const isCut = (R: number): boolean => {
          const angle = -(g.toothThicknessAtPitch / (2 * r) + inv(ALPHA) - inv(Math.acos(rb / R)));
          return closestPass(rack, R * Math.cos(angle), R * Math.sin(angle)) < -1e-9;
        };
        let lo = rb * (1 + 1e-9);
        let hi = g.pitchRadius;
        expect(isCut(lo)).toBe(true);
        expect(isCut(hi)).toBe(false);
        for (let i = 0; i < 40; i++) {
          const mid = 0.5 * (lo + hi);
          if (isCut(mid)) lo = mid;
          else hi = mid;
        }
        expect(Math.abs(hi - g.formRadius)).toBeLessThan(1e-7); // measured: within 8e-9 mm
      }
    });
  }
});

describe('options', () => {
  it('tip relief chamfers the tip corners', () => {
    const plain = spurGear({ teeth: 24, module: 2 });
    const relieved = spurGear({ teeth: 24, module: 2, tipRelief: 0.15 });
    expect(relieved.pointsPerTooth).toBe(plain.pointsPerTooth + 2);
    expect(relieved.layout.relief).toBe(1);
    expect(relieved.tipRadius).toBe(plain.tipRadius);
    expect(relieved.flankTipRadius).toBeCloseTo(plain.tipRadius - 0.15, 12);
    expect(signedArea(relieved.outline)).toBeLessThan(signedArea(plain.outline));
    expect(signedArea(relieved.outline)).toBeGreaterThan(signedArea(plain.outline) * 0.999);
    expect(crossings(relieved)).toBe(0);
    // A relief too big for the tip land is cut down to fit.
    const tiny = spurGear({ teeth: 8, module: 1, tipRelief: 5 });
    expect(crossings(tiny)).toBe(0);
    expect(tiny.flankTipRadius).toBeGreaterThan(tiny.formRadius);
  });

  it('point counts and cutter tip radius', () => {
    const g = spurGear({ teeth: 30, module: 1, flankPoints: 25, filletPoints: 12 });
    expect(g.layout).toEqual({ root: 1, fillet: 12, flank: 25, relief: 0, half: 38 });
    expect(g.pointsPerTooth).toBe(76);
    expect(crossings(g)).toBe(0);
    // A full-radius cutter tip has no flat: the tooth loses its separate root-centre point.
    const full = spurGear({ teeth: 30, module: 1, rackTipRadius: 9 });
    expect(full.spec.rackTipRadius).toBeCloseTo(0.4719, 3);
    expect(full.layout.root).toBe(0);
    expect(full.pointsPerTooth).toBe(2 * (6 + 10));
    expect(crossings(full)).toBe(0);
    // A sharp cutter corner still makes a valid tooth.
    expect(crossings(spurGear({ teeth: 12, module: 1, rackTipRadius: 0 }))).toBe(0);
  });

  it('stays a simple, steadily climbing tooth across pressure angles, cutter tips and backlash', () => {
    let made = 0;
    for (const teeth of [6, 7, 8, 9, 10, 11, 13, 15, 17, 18, 19, 22, 30, 45, 80, 120]) {
      for (const pressureAngleDeg of [14.5, 20, 25]) {
        for (const rackTipRadius of [0, 0.25, 0.38, 0.6]) {
          for (const backlash of [0, 0.1]) {
            const g = spurGear({ teeth, module: 1.3, pressureAngleDeg, rackTipRadius, backlash });
            made++;
            expect(crossings(g)).toBe(0);
            expect(g.tipRadius).toBeCloseTo(g.pitchRadius + 1.3, 9);
            for (let k = 1; k <= g.layout.half; k++) expect(g.outline[k]![0]).toBeGreaterThan(g.outline[k - 1]![0]);
            for (let k = 0; k < g.layout.half; k++) expect(g.outline[k]![1]).toBeLessThan(0);
          }
        }
      }
    }
    expect(made).toBe(384);
  });

  it('rejects impossible gears', () => {
    expect(() => spurGear({ teeth: 5, module: 1 })).toThrow(RangeError);
    expect(() => spurGear({ teeth: 12.5, module: 1 })).toThrow(RangeError);
    expect(() => spurGear({ teeth: 12, module: 0 })).toThrow(RangeError);
    expect(() => spurGear({ teeth: 12, module: 1, backlash: 2 })).toThrow(RangeError);
    expect(() => spurGear({ teeth: 12, module: 1, pressureAngleDeg: 60 })).toThrow(RangeError);
  });

  it('is fast enough to rebuild a whole train on every change', () => {
    const specs = [10, 12, 16, 23, 37, 48, 60, 77, 96, 110].map((teeth) => ({ teeth, module: 108 / (teeth + 40), backlash: 0.08 }));
    for (const spec of specs) spurGear(spec); // warm up
    const rounds = 40;
    const start = performance.now();
    for (let i = 0; i < rounds; i++) for (const spec of specs) spurGear(spec);
    const each = (performance.now() - start) / (rounds * specs.length);
    expect(each).toBeLessThan(0.5); // measured about 0.02 ms; the bound leaves room for a busy machine
  });
});

describe('matingRotation', () => {
  it('puts a space of B opposite a tooth of A', () => {
    for (const [zA, zB] of [[10, 60], [20, 20], [17, 23], [110, 10]] as const) {
      // A's tooth 0 points along +X at B; B's teeth are at thetaB + k * pitchB and must straddle pi.
      const thetaB = matingRotation(0, zA, zB, 0);
      const pitchB = (2 * Math.PI) / zB;
      const phase = (Math.PI - thetaB) / pitchB; // tooth index at the direction of A
      expect(Math.abs(phase - Math.floor(phase) - 0.5)).toBeLessThan(1e-12);
    }
  });

  it('turns B against A at the tooth ratio', () => {
    for (const [zA, zB] of [[10, 60], [37, 12], [20, 20]] as const) {
      const d = matingRotation(0.3, zA, zB, 1.1) - matingRotation(0.1, zA, zB, 1.1);
      expect(d).toBeCloseTo((-0.2 * zA) / zB, 12);
    }
  });

  it('does not care which way the line of centres points', () => {
    // Turning the whole pair by phi must give the same mesh: B's angle relative to the line of
    // centres depends only on A's angle relative to it.
    for (const phi of [0.4, -2.2, Math.PI, 5.5]) {
      for (const thetaA of [0, 0.37, -1.2]) {
        const turned = matingRotation(thetaA, 14, 40, phi) - phi;
        const reference = matingRotation(thetaA - phi, 14, 40, 0);
        expect(turned).toBeCloseTo(reference, 12);
      }
    }
  });
});
