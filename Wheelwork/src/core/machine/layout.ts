// From tooth counts to a machine: every wheel's module, size, place and mate, and the list of
// design rules with a verdict on each.
import {
  type ChainMember, DESIGN, levelZ, nestOuterDiameter, tellurionLevelZ,
} from './design';
import {
  DEFAULT_LIMITS, earthPostMaxTip, type Limits, type MachineSpec, STEP_IDS, type Step, type StepId, stepLevels, stepMembers,
  TELLURION_IDS, TELLURION_LEVELS, TELLURION_SEATS, type TellurionId, tellurionRule, type TrainId, stepRule,
} from './spec';
import { ADDENDUM, DEDENDUM, moduleFor, pairFault } from '../train/solver';

/** The axes wheels turn on. 'stud' and 'earthPost' are carried round by the earth arm. */
export type Axis = 'centre' | 'idler' | 'stud' | 'earthPost';

/** The rigid bodies of the machine: things that turn as one piece. */
export type BodyId =
  | 'frame' | 'crank'
  | ChainMember
  | `cluster${0 | 1 | 2 | 3 | 4 | 5}`
  | 'tiltCluster' | 'nodeCluster' | 'moonCluster'
  | 'earthAxis' | 'moonSleeve' | 'nodeSleeve' | 'moonStalk';

export type Role = 'a' | 'b' | 'c' | 'd';

export interface Wheel {
  id: string;
  train: TrainId;
  role: Role;
  teeth: number;
  module: number;
  pitchRadius: number;
  tipRadius: number;
  rootRadius: number;
  axis: Axis;
  body: BodyId;
  /** Bottom face and thickness. Heights are in the machine frame. */
  z: number;
  face: number;
  /** The level it sits on: gearbox levels 1..12, tellurion levels 1..6. */
  level: number;
  tellurion: boolean;
  /** Id of the wheel it meshes with. */
  mate: string;
  /** Radius of the tube, sleeve or post it is fixed on or turns on. */
  seatRadius: number;
}

export interface RuleResult {
  id: string;
  ok: boolean;
  train?: TrainId;
  text: string;
}

export interface Layout {
  spec: MachineSpec;
  wheels: Wheel[];
  byId: Map<string, Wheel>;
  rules: RuleResult[];
  ok: boolean;
}

export function wheelId(train: TrainId, role: Role): string {
  return `${train}.${role}`;
}

const CLUSTER_SEAT = DESIGN.idlerPostDiameter / 2 + DESIGN.postClearance;

function makeWheel(train: TrainId, role: Role, teeth: number, mateTeeth: number, centreDistance: number, rest: Omit<Wheel, 'id' | 'train' | 'role' | 'teeth' | 'module' | 'pitchRadius' | 'tipRadius' | 'rootRadius' | 'mate'>): Wheel {
  const module = moduleFor(centreDistance, teeth, mateTeeth);
  const mateRole: Role = role === 'a' ? 'b' : role === 'b' ? 'a' : role === 'c' ? 'd' : 'c';
  return {
    id: wheelId(train, role), train, role, teeth, module,
    pitchRadius: (module * teeth) / 2,
    tipRadius: module * (teeth / 2 + ADDENDUM),
    rootRadius: module * (teeth / 2 - DEDENDUM),
    mate: wheelId(train, mateRole),
    ...rest,
  };
}

function stepWheels(id: StepId, s: Step): Wheel[] {
  const { inner, outer, index } = stepMembers(id);
  const lv = stepLevels(id);
  const C = DESIGN.centreDistance;
  const cluster = `cluster${index}` as BodyId;
  const common = { face: DESIGN.faceWidth, tellurion: false };
  return [
    makeWheel(id, 'a', s.a, s.b, C, { ...common, axis: 'centre', body: inner, z: levelZ(lv.first), level: lv.first, seatRadius: nestOuterDiameter(inner) / 2 }),
    makeWheel(id, 'b', s.b, s.a, C, { ...common, axis: 'idler', body: cluster, z: levelZ(lv.first), level: lv.first, seatRadius: CLUSTER_SEAT }),
    makeWheel(id, 'c', s.c, s.d, C, { ...common, axis: 'idler', body: cluster, z: levelZ(lv.second), level: lv.second, seatRadius: CLUSTER_SEAT }),
    makeWheel(id, 'd', s.d, s.c, C, { ...common, axis: 'centre', body: outer, z: levelZ(lv.second), level: lv.second, seatRadius: nestOuterDiameter(outer) / 2 }),
  ];
}

const TELLURION_BODIES: Record<TellurionId, { a: BodyId; cluster: BodyId; d: BodyId }> = {
  tilt: { a: 'frame', cluster: 'tiltCluster', d: 'earthAxis' },
  node: { a: 'frame', cluster: 'nodeCluster', d: 'nodeSleeve' },
  moon: { a: 'month', cluster: 'moonCluster', d: 'moonSleeve' },
};

function tellurionWheels(id: TellurionId, s: Step): Wheel[] {
  const lv = TELLURION_LEVELS[id];
  const bodies = TELLURION_BODIES[id];
  const seat = TELLURION_SEATS[id];
  const d1 = DESIGN.studDistance;
  const d2 = DESIGN.armLength.earth - DESIGN.studDistance;
  const common = { face: DESIGN.tellurionFace, tellurion: true };
  return [
    makeWheel(id, 'a', s.a, s.b, d1, { ...common, axis: 'centre', body: bodies.a, z: tellurionLevelZ(lv.first), level: lv.first, seatRadius: seat.a }),
    makeWheel(id, 'b', s.b, s.a, d1, { ...common, axis: 'stud', body: bodies.cluster, z: tellurionLevelZ(lv.first), level: lv.first, seatRadius: seat.b }),
    makeWheel(id, 'c', s.c, s.d, d2, { ...common, axis: 'stud', body: bodies.cluster, z: tellurionLevelZ(lv.second), level: lv.second, seatRadius: seat.c }),
    makeWheel(id, 'd', s.d, s.c, d2, { ...common, axis: 'earthPost', body: bodies.d, z: tellurionLevelZ(lv.second), level: lv.second, seatRadius: seat.d }),
  ];
}

/** Position of an axis in the plan of the machine, with the earth arm along +X when carried. */
export function axisPosition(axis: Axis): readonly [number, number] {
  switch (axis) {
    case 'centre': return [0, 0];
    case 'idler': return [DESIGN.centreDistance * Math.cos(DESIGN.idlerAngle), DESIGN.centreDistance * Math.sin(DESIGN.idlerAngle)];
    case 'stud': return [DESIGN.studDistance, 0];
    case 'earthPost': return [DESIGN.armLength.earth, 0];
  }
}

export function buildLayout(spec: MachineSpec, limits: Limits = DEFAULT_LIMITS): Layout {
  const wheels: Wheel[] = [];
  const rules: RuleResult[] = [];
  for (const id of STEP_IDS) {
    const s = spec.steps[id];
    wheels.push(...stepWheels(id, s));
    const rule = stepRule(id, limits);
    const f1 = pairFault(rule.first, s.a, s.b);
    const f2 = pairFault(rule.second, s.c, s.d);
    rules.push({ id: `${id}.first`, train: id, ok: !f1, text: f1 ? `Wheels a and b: ${f1}.` : 'Wheels a and b fit.' });
    rules.push({ id: `${id}.second`, train: id, ok: !f2, text: f2 ? `Wheels c and d: ${f2}.` : 'Wheels c and d fit.' });
  }
  for (const id of TELLURION_IDS) {
    const s = spec.tellurion[id];
    wheels.push(...tellurionWheels(id, s));
    const rule = tellurionRule(id);
    const f1 = pairFault(rule.first, s.a, s.b);
    const f2 = pairFault(rule.second, s.c, s.d);
    rules.push({ id: `${id}.first`, train: id, ok: !f1, text: f1 ? `Wheels a and b: ${f1}.` : 'Wheels a and b fit.' });
    rules.push({ id: `${id}.second`, train: id, ok: !f2, text: f2 ? `Wheels c and d: ${f2}.` : 'Wheels c and d fit.' });
  }
  const byId = new Map(wheels.map((w) => [w.id, w]));

  // The tilt and moon trains must be exactly 1:1, or the earth's axis would wander and the Moon
  // would not follow the month tube.
  for (const id of ['tilt', 'moon'] as const) {
    const s = spec.tellurion[id];
    const unit = s.a * s.c === s.b * s.d;
    rules.push({ id: `${id}.unit`, train: id, ok: unit, text: unit ? 'Ratio is exactly one.' : 'Ratio must be exactly one (a x c = b x d).' });
  }
  // Wheels on the earth post must pass inside Mars's stalk.
  for (const w of wheels) {
    if (w.axis !== 'earthPost') continue;
    const ok = w.tipRadius <= earthPostMaxTip() + 1e-9;
    if (!ok) rules.push({ id: `${w.id}.reach`, train: w.train, ok, text: `Wheel ${w.role} would strike Mars's stalk.` });
  }
  // The crank's bevel wheel sits under level 1 and must clear the idler post.
  const bevelTip = (DESIGN.bevelModule * spec.bevel.mercury) / 2 + DESIGN.bevelModule;
  const bevelOk = bevelTip < DESIGN.centreDistance - DESIGN.clusterHubDiameter / 2 - 1;
  rules.push({ id: 'bevel.reach', ok: bevelOk, text: bevelOk ? 'The crank wheel clears the idler post.' : 'The crank wheel would strike the idler post.' });

  return { spec, wheels, byId, rules, ok: rules.every((r) => r.ok) };
}

/** The wheels fixed on one body, lowest first. */
export function wheelsOf(layout: Layout, body: BodyId): Wheel[] {
  return layout.wheels.filter((w) => w.body === body).sort((p, q) => p.z - q.z);
}
