// Where every body is, for a given number of turns of the crank.
import { type Affine, compose, IDENTITY, rotationX, rotationZ, translation } from '../mesh/kit';
import { DESIGN } from './design';
import { type Rates, type Setting, ALL_BODIES, bodyAngle, CARRIED } from './kinematics';
import { type BodyId, axisPosition } from './layout';
import { bevelSeat, type PartBody } from './parts';
import { type MachineSpec } from './spec';

export interface MachinePose {
  turns: number;
  /** Angle of every body about its own axis, room frame, radians. */
  angle: Record<BodyId, number>;
  /** Pose of every body: its frame in the room. */
  frame: Record<BodyId, Affine>;
  /** Height of the Moon above the ecliptic plane, millimetres. */
  moonLift: number;
  /** Rotation of the crank about its own shaft. */
  crankAngle: number;
}

const AXIS_OF: Partial<Record<BodyId, 'idler' | 'stud' | 'earthPost'>> = {
  cluster0: 'idler', cluster1: 'idler', cluster2: 'idler', cluster3: 'idler', cluster4: 'idler', cluster5: 'idler',
  tiltCluster: 'stud', nodeCluster: 'stud', moonCluster: 'stud',
  earthAxis: 'earthPost', moonSleeve: 'earthPost', nodeSleeve: 'earthPost', moonStalk: 'earthPost',
};

export function poseMachine(spec: MachineSpec, rates: Rates, setting: Setting, turns: number): MachinePose {
  const angle = {} as Record<BodyId, number>;
  for (const b of ALL_BODIES) angle[b] = bodyAngle(rates, setting, b, turns);
  const frame = {} as Record<BodyId, Affine>;
  const arm = angle.earth;
  const ca = Math.cos(arm);
  const sa = Math.sin(arm);
  const moonLift = DESIGN.moonOrbitRadius * Math.tan((DESIGN.moonInclination * Math.PI) / 180) * Math.sin(angle.moonSleeve - angle.nodeSleeve);
  const bevel = bevelSeat(spec.bevel.crank, spec.bevel.mercury);
  const crankAngle = bevel.ratio * (angle.mercury - DESIGN.crankAngle);
  for (const b of ALL_BODIES) {
    if (b === 'frame') { frame[b] = IDENTITY; continue; }
    if (b === 'crank') {
      frame[b] = compose(translation(0, 0, DESIGN.crankAxisZ), compose(rotationZ(DESIGN.crankAngle), rotationX(crankAngle)));
      continue;
    }
    const axis = AXIS_OF[b];
    if (!axis) { frame[b] = rotationZ(angle[b]); continue; }
    const [x, y] = axisPosition(axis);
    if (CARRIED.has(b)) {
      frame[b] = compose(translation(x * ca - y * sa, x * sa + y * ca, b === 'moonStalk' ? moonLift : 0), rotationZ(angle[b]));
    } else {
      frame[b] = compose(translation(x, y, 0), rotationZ(angle[b]));
    }
  }
  return { turns, angle, frame, moonLift, crankAngle };
}

/** The frame of a part's body, the case halves included (they do not move with the mechanism). */
export function frameOf(pose: MachinePose, body: PartBody): Affine {
  return body === 'caseNear' || body === 'caseFar' ? IDENTITY : pose.frame[body];
}
