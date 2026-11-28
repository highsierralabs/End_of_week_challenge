// Pairs of spur gears: contact ratio, clearance and interference over a mesh cycle, and the law
// of gearing itself.

import { describe, expect, it } from 'vitest';
import { matingRotation, spurGear, type SpurGeometry, type SpurSpec } from '../../src/core/gears/involute';
import { checkMesh, contactRatio, effectiveContactRatio, standardCentreDistance, sweepMesh } from '../../src/core/gears/meshcheck';

const ALPHA = (20 * Math.PI) / 180;
/** The frame's centre distance in these tests; each mesh takes the module that fits it. */
const CENTRES = 54;
/** Tooth thinning per gear, mm. */
const BACKLASH = 0.08;

const PAIRS: readonly (readonly [number, number])[] = [
  [10, 60], [12, 88], [14, 40], [20, 20], [17, 23], [110, 10],
  [10, 10], [10, 30], [11, 29], [13, 97], [16, 16], [37, 60], [55, 55], [25, 85], [10, 100], [48, 19],
];

function pairAt(zA: number, zB: number, backlash: number, extra: Partial<SpurSpec> = {}): { a: SpurSpec; b: SpurSpec; module: number } {
  const module = (2 * CENTRES) / (zA + zB);
  return { a: { teeth: zA, module, backlash, ...extra }, b: { teeth: zB, module, backlash, ...extra }, module };
}

describe('pair basics', () => {
  it('standard centre distance', () => {
    expect(standardCentreDistance(20, 40, 2)).toBe(60);
    expect(standardCentreDistance(10, 60, 108 / 70)).toBeCloseTo(54, 12);
  });

  it('mating gears share a base pitch', () => {
    for (const [zA, zB] of PAIRS) {
      const { a, b, module } = pairAt(zA, zB, BACKLASH);
      const ga = spurGear(a);
      const gb = spurGear(b);
      const pitchA = (2 * Math.PI * ga.baseRadius) / zA;
      const pitchB = (2 * Math.PI * gb.baseRadius) / zB;
      expect(pitchA).toBeCloseTo(pitchB, 12);
      expect(pitchA).toBeCloseTo(Math.PI * module * Math.cos(ALPHA), 12);
      expect(ga.pitchRadius + gb.pitchRadius).toBeCloseTo(CENTRES, 12);
    }
  });
});

describe('contact ratio', () => {
  it('matches a case worked by hand', () => {
    // 20 and 40 teeth, module 2, 20 degree full depth, centre distance 60 (worked by hand, not
    // taken from a book):
    //   pitch radii 20 and 40; base radii 20 cos 20 = 18.79385 and 37.58770; tip radii 22 and 42
    //   sqrt(22^2 - 18.79385^2) = 11.43639      sqrt(42^2 - 37.58770^2) = 18.73938
    //   60 sin 20 = 20.52121                    base pitch = 2 pi cos 20 = 5.90426
    //   (11.43639 + 18.73938 - 20.52121) / 5.90426 = 1.63519
    const a = { teeth: 20, module: 2 };
    const b = { teeth: 40, module: 2 };
    expect(contactRatio(a, b, 60)).toBeCloseTo(1.63519, 5);
    expect(contactRatio(b, a, 60)).toBeCloseTo(1.63519, 5);
    // Neither gear is undercut and each tip works above the other's fillet: nothing is lost.
    expect(effectiveContactRatio(a, b, 60)).toBeCloseTo(1.63519, 5);
    // It does not depend on the module, and it falls as the centres are pulled apart.
    expect(contactRatio({ teeth: 20, module: 0.9 }, { teeth: 40, module: 0.9 }, 27)).toBeCloseTo(1.63519, 5);
    expect(contactRatio(a, b, 60.5)).toBeLessThan(1.5);
    expect(checkMesh(a, b, 60).contactRatio).toBeCloseTo(1.63519, 5);
  });

  it('is at least 1.1 for every pair the machine can ask for', () => {
    // Both gears >= 10 teeth, 40 <= z1 + z2 <= 110, at the standard centre distance.
    let smallest = Infinity;
    let smallestPair = '';
    let smallestEffective = Infinity;
    let smallestEffectivePinion = 0;
    let pairs = 0;
    for (let z1 = 10; z1 <= 55; z1++) {
      for (let z2 = z1; z1 + z2 <= 110; z2++) {
        if (z1 + z2 < 40) continue;
        pairs++;
        const { a, b } = pairAt(z1, z2, BACKLASH);
        const ratio = contactRatio(a, b, CENTRES);
        const effective = effectiveContactRatio(a, b, CENTRES);
        expect(ratio).toBeGreaterThanOrEqual(1.1);
        expect(effective).toBeLessThanOrEqual(ratio + 1e-12);
        if (ratio < smallest) {
          smallest = ratio;
          smallestPair = `${z1}:${z2}`;
        }
        if (effective < smallestEffective) {
          smallestEffective = effective;
          smallestEffectivePinion = z1;
        }
        // Undercut is the only thing that takes contact away: no gear of 19 teeth or more has any.
        if (z1 >= 19) expect(Math.abs(effective - ratio)).toBeLessThan(1e-9);
        // With undercut counted, an 11 tooth pinion still keeps 1.15; only 10 teeth dips below 1.1.
        if (z1 >= 11) expect(effective).toBeGreaterThan(1.15);
      }
    }
    expect(pairs).toBe(2006);
    // Smallest textbook value: 10 teeth driving 30.
    expect(smallestPair).toBe('10:30');
    expect(smallest).toBeCloseTo(1.5115, 4);
    // Smallest with undercut counted: any 10 tooth pinion against 46 teeth or more, where the
    // wheel's tip would work below the pinion's form radius. Still above 1, so one pair of teeth
    // always has involute contact.
    expect(smallestEffectivePinion).toBe(10);
    expect(smallestEffective).toBeCloseTo(1.0639, 4);
  });
});

describe('checkMesh', () => {
  for (const [zA, zB] of PAIRS) {
    it(`${zA}:${zB} runs clear with backlash`, () => {
      const { a, b, module } = pairAt(zA, zB, BACKLASH);
      const report = checkMesh(a, b, CENTRES, 32, 1e-3);
      expect(report.centreDistance).toBe(CENTRES);
      expect(report.maxPenetration).toBe(0);
      expect(report.interferes).toBe(false);
      // Each tooth sits centred in its space, so the gap on either flank is half the normal
      // backlash: (0.08 + 0.08) * cos(20 deg) / 2 = 0.0752 mm. The polygons add their chord error.
      expect(report.minFlankClearance).toBeGreaterThan(0.0751);
      expect(report.minFlankClearance).toBeLessThan(0.08);
      expect(report.tipToRootClearance).toBeCloseTo(0.25 * module, 9);
      expect(report.angularBacklashB).toBeCloseTo((2 * BACKLASH) / ((module * zB) / 2), 9);
      // 10:10 and 16:16 are smaller than anything the machine uses (z1 + z2 >= 40) and sit lower.
      expect(report.contactRatio).toBeGreaterThan(zA + zB >= 40 ? 1.5 : 1.36);
      // 10:10 is both ends undercut: 0.76, see the single-flank test below.
      expect(report.effectiveContactRatio).toBeGreaterThan(zA + zB >= 40 ? 1.06 : 0.75);
    });

    it(`${zA}:${zB} touches without penetrating at zero backlash`, () => {
      const { a, b } = pairAt(zA, zB, 0);
      const report = checkMesh(a, b, CENTRES, 32, 1e-3);
      expect(report.maxPenetration).toBeLessThanOrEqual(1e-3);
      expect(report.interferes).toBe(false);
      // "Contact" for inscribed polygons is a gap of their chord error. The worst here is 10:10 at
      // module 5.4, 0.0041 mm; with more flank points it closes up.
      expect(report.minFlankClearance).toBeLessThan(5e-3);
      expect(Math.abs(report.angularBacklashB)).toBeLessThan(1e-12);
      const fine = pairAt(zA, zB, 0, { flankPoints: 80, filletPoints: 24 });
      const fineSweep = sweepMesh(spurGear(fine.a), spurGear(fine.b), CENTRES, 32);
      expect(fineSweep.maxPenetration).toBeLessThanOrEqual(1e-6);
      expect(fineSweep.minClearance).toBeLessThan(1e-4);
    });

    it(`${zA}:${zB} backlash is what the report says`, () => {
      const { a, b, module } = pairAt(zA, zB, BACKLASH);
      const ga = spurGear(a);
      const gb = spurGear(b);
      const play = checkMesh(a, b, CENTRES).angularBacklashB;
      for (const sign of [1, -1]) {
        // Turning B by half the play brings the flanks together...
        const closed = sweepMesh(ga, gb, CENTRES, 32, (sign * play) / 2);
        expect(closed.maxPenetration).toBeLessThanOrEqual(1e-6);
        expect(closed.minClearance).toBeLessThan(5e-3);
        // ...and 0.02 mm more at the pitch circle drives them 0.02 * cos(20 deg) = 0.0188 mm into each other.
        const over = sweepMesh(ga, gb, CENTRES, 32, sign * (play / 2 + 0.02 / ((module * zB) / 2)));
        expect(over.maxPenetration).toBeGreaterThan(0.014);
        expect(over.maxPenetration).toBeLessThan(0.02);
      }
    });

    it(`${zA}:${zB} a wrong pair is caught`, () => {
      const { a, b, module } = pairAt(zA, zB, BACKLASH);
      // Centres 0.3 mm too close: that takes up 2 * 0.3 * tan(20 deg) = 0.218 mm of play and there is only 0.16.
      const close = checkMesh(a, b, CENTRES - 0.3);
      expect(close.interferes).toBe(true);
      expect(close.maxPenetration).toBeGreaterThan(0.02);
      expect(close.minFlankClearance).toBe(0);
      expect(close.angularBacklashB).toBeLessThan(0);
      // A module 4 % out: the base pitches no longer agree.
      const mismatched = checkMesh(a, { ...b, module: module * 1.04 }, CENTRES);
      expect(mismatched.interferes).toBe(true);
      expect(mismatched.maxPenetration).toBeGreaterThan(0.05);
      // Centres 0.3 mm too far is merely loose.
      const loose = checkMesh(a, b, CENTRES + 0.3);
      expect(loose.interferes).toBe(false);
      expect(loose.minFlankClearance).toBeGreaterThan(0.15);
      expect(loose.contactRatio).toBeLessThan(checkMesh(a, b, CENTRES).contactRatio);
    });
  }

  it('effective contact ratio says whether one flank alone keeps contact', () => {
    // Take up the backlash one way, so only one side of the teeth can touch, and look for the
    // position where the teeth are farthest from touching. With an effective contact ratio above 1
    // there is none (the gap is chord error everywhere); below 1 there is a stretch of each pitch
    // where no involute pair is in contact and a real gap opens. The textbook ratio, which is 1.3
    // or more for every pair here, does not tell these apart. Measured gaps in the comments.
    const cases: readonly (readonly [number, number, boolean])[] = [
      [10, 60, true], // effective 1.064, gap 0.00005 mm
      [10, 30, true], // 1.064, 0.00009
      [12, 12, true], // 1.064, 0.00014
      [11, 60, true], // 1.153, 0.00005
      [16, 16, true], // 1.499, 0.00014
      [10, 12, false], // 0.911, 0.0008
      [10, 10, false], // 0.758, 0.0079
      [8, 40, false], // 0.888, 0.0031
      [8, 8, false], // 0.468, 0.064
    ];
    for (const [zA, zB, continuous] of cases) {
      const { a, b } = pairAt(zA, zB, BACKLASH, { flankPoints: 80, filletPoints: 24 });
      const report = checkMesh(a, b, CENTRES);
      expect(report.contactRatio).toBeGreaterThan(1.3);
      expect(report.effectiveContactRatio > 1).toBe(continuous);
      for (const sign of [1, -1]) {
        const sweep = sweepMesh(spurGear(a), spurGear(b), CENTRES, 96, (sign * report.angularBacklashB) / 2);
        expect(sweep.maxPenetration).toBeLessThanOrEqual(1e-6);
        if (continuous) expect(sweep.worstStepClearance).toBeLessThan(2e-4);
        else expect(sweep.worstStepClearance).toBeGreaterThan(5e-4);
      }
    }
  });

  it('B in the wrong phase is caught', () => {
    const { a, b } = pairAt(17, 23, BACKLASH);
    const halfPitchB = Math.PI / 23;
    const wrong = sweepMesh(spurGear(a), spurGear(b), CENTRES, 32, halfPitchB);
    expect(wrong.maxPenetration).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------------------------
// Conjugate action. The law of gearing for involutes: contact happens on the line of action, the
// common tangent of the two base circles through the pitch point. So take points of A's flank
// (they are exact involute points), turn A until each lies on the line of action, turn B to the
// angle the constant ratio demands, and B's flank has to be exactly there. If the ratio wandered
// through the mesh, or the phase were off, it would not be.

/** Distance from a point in B's own frame to B's outline (every edge; slow and simple). */
function outlineDistance(g: SpurGeometry, x: number, y: number): number {
  const ring = g.outline;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const t = Math.min(1, Math.max(0, ((x - p[0]) * ex + (y - p[1]) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(x - p[0] - t * ex, y - p[1] - t * ey));
  }
  return best;
}

describe('conjugate action', () => {
  for (const [zA, zB] of [[20, 37], [12, 40], [10, 60], [60, 17], [25, 25]] as const) {
    it(`${zA}:${zB} contact stays on the line of action at a constant ratio`, () => {
      const module = (2 * CENTRES) / (zA + zB);
      const ga = spurGear({ teeth: zA, module, flankPoints: 240 });
      const gb = spurGear({ teeth: zB, module, flankPoints: 240 });
      const rbA = ga.baseRadius;
      const rbB = gb.baseRadius;
      // Positions along the line of action, measured from A's tangent point: contact is possible
      // where both gears have involute there.
      const span = CENTRES * Math.sin(ALPHA);
      const along = (R: number, rb: number): number => Math.sqrt(Math.max(0, R * R - rb * rb));
      const from = Math.max(along(ga.formRadius, rbA), span - along(gb.tipRadius, rbB));
      const to = Math.min(along(ga.tipRadius, rbA), span - along(gb.formRadius, rbB));
      expect(to - from).toBeGreaterThan(Math.PI * module * Math.cos(ALPHA)); // more than one base pitch

      const first = ga.layout.root + ga.layout.fillet;
      let checked = 0;
      let worst = 0;
      let worstWithSlip = Infinity;
      for (let k = first; k < first + ga.layout.flank; k += 3) {
        for (const side of [1, -1]) {
          // side 1: the clockwise-side flank of tooth 0; side -1: its mirror image.
          const p = ga.outline[side === 1 ? k : ga.pointsPerTooth - k]!;
          const R = Math.hypot(p[0], p[1]);
          const position = along(R, rbA);
          if (position < from + 1e-6 || position > to - 1e-6) continue;
          // Turn A so that the point's base-circle tangent point sits at angle +-alpha: then the
          // point is on the line of action.
          const alphaR = Math.acos(rbA / R);
          const thetaA = side * (ALPHA - alphaR) - Math.atan2(p[1], p[0]);
          const wx = p[0] * Math.cos(thetaA) - p[1] * Math.sin(thetaA);
          const wy = p[0] * Math.sin(thetaA) + p[1] * Math.cos(thetaA);
          // It is on the line: `position` along it from A's tangent point.
          expect(wx).toBeCloseTo(rbA * Math.cos(ALPHA) + position * Math.sin(ALPHA), 9);
          expect(wy).toBeCloseTo(side * (rbA * Math.sin(ALPHA) - position * Math.cos(ALPHA)), 9);

          const thetaB = matingRotation(thetaA, zA, zB, 0);
          const inB = (theta: number): number => {
            const x = wx - CENTRES;
            return outlineDistance(gb, x * Math.cos(theta) + wy * Math.sin(theta), -x * Math.sin(theta) + wy * Math.cos(theta));
          };
          worst = Math.max(worst, inB(thetaB));
          // The same test with B a thousandth of a radian out must fail, or it proves nothing.
          worstWithSlip = Math.min(worstWithSlip, inB(thetaB + 1e-3));
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(60);
      // B's flank is a polygon inscribed in its involute: the distance is its chord error.
      expect(worst).toBeLessThan(2e-5);
      expect(worstWithSlip).toBeGreaterThan(0.005);
    });
  }
});
