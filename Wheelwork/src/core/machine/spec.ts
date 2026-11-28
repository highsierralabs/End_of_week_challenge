// The variable part of the machine: its tooth counts. Everything else follows from them.
import { CHAIN, type ChainMember, DESIGN, nestOuterDiameter } from './design';
import { type Candidate, coarsestWithin, type PairRule, solveStep, type StepRule } from '../train/solver';

/**
 * One train: wheel `a` on the first axis meshes wheel `b` on a cluster, whose other wheel `c`
 * meshes wheel `d`. Its ratio is (b/a) * (d/c).
 */
export interface Step {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** The six gearbox steps, each joining one member of the chain to the next. */
export const STEP_IDS = ['mercury-venus', 'venus-month', 'month-earth', 'earth-mars', 'mars-jupiter', 'jupiter-saturn'] as const;
export type StepId = (typeof STEP_IDS)[number];

/** The three trains on the earth arm. */
export const TELLURION_IDS = ['tilt', 'node', 'moon'] as const;
export type TellurionId = (typeof TELLURION_IDS)[number];

export type TrainId = StepId | TellurionId;
export const TRAIN_IDS: readonly TrainId[] = [...STEP_IDS, ...TELLURION_IDS];

export interface MachineSpec {
  steps: Record<StepId, Step>;
  tellurion: Record<TellurionId, Step>;
  /** Teeth of the crank's bevel pinion and of the bevel wheel on Mercury's tube. */
  bevel: { crank: number; mercury: number };
}

export function stepMembers(id: StepId): { inner: ChainMember; outer: ChainMember; index: number } {
  const index = STEP_IDS.indexOf(id);
  return { inner: CHAIN[index]!, outer: CHAIN[index + 1]!, index };
}

/** The gearbox levels of a step's two meshes (1-based from the bottom). */
export function stepLevels(id: StepId): { first: number; second: number } {
  const i = STEP_IDS.indexOf(id);
  return { first: 2 * i + 1, second: 2 * i + 2 };
}

/** Tellurion levels (1-based from the earth arm up) of each train's two meshes. */
export const TELLURION_LEVELS: Record<TellurionId, { first: number; second: number }> = {
  // The fixed tube carries the tilt wheel (level 2) and the node wheel (level 3); the month tube,
  // which comes up inside it, carries the moon wheel (level 5). At the earth post the innermost
  // shaft takes the lowest wheel: earth's axis (1), the moon's sleeve (4), the node sleeve (6).
  tilt: { first: 2, second: 1 },
  node: { first: 3, second: 6 },
  moon: { first: 5, second: 4 },
};

// ---------------------------------------------------------------- rules

/** The limits a visitor can move. */
export interface Limits {
  minTeeth: number;
  maxTeeth: number;
  /** Finest teeth allowed, as a module in millimetres. */
  minModule: number;
}

export const DEFAULT_LIMITS: Limits = { minTeeth: 12, maxTeeth: 96, minModule: 1.0 };
export const MAX_MODULE = 3.2;

// A cluster wheel's root circle must stand clear of the cluster's hub, which is also what keeps
// the tips of the wheel it meshes with off that hub (tip to root clearance is a quarter module).
const clusterRoot = DESIGN.clusterHubDiameter / 2 + 0.3;

export function stepRule(id: StepId, limits: Limits = DEFAULT_LIMITS): StepRule {
  const { inner, outer } = stepMembers(id);
  const base = {
    centreDistance: DESIGN.centreDistance,
    minTeeth: limits.minTeeth,
    maxTeeth: limits.maxTeeth,
    minModule: limits.minModule,
    maxModule: MAX_MODULE,
  };
  const first: PairRule = { ...base, minRootFirst: nestOuterDiameter(inner) / 2 + DESIGN.hubWall, minRootSecond: clusterRoot };
  const second: PairRule = { ...base, minRootFirst: clusterRoot, minRootSecond: nestOuterDiameter(outer) / 2 + DESIGN.hubWall };
  return { first, second };
}

/** Radius of the tube, sleeve or stud that each tellurion wheel is fixed on (a, d) or turns on (b, c). */
export const TELLURION_SEATS: Record<TellurionId, { a: number; b: number; c: number; d: number }> = {
  tilt: { a: nestOuterDiameter('fixed') / 2, b: DESIGN.studDiameter / 2 + 0.2, c: DESIGN.studDiameter / 2 + 0.2, d: DESIGN.earthAxisDiameter / 2 },
  node: { a: nestOuterDiameter('fixed') / 2, b: DESIGN.studDiameter / 2 + 0.2, c: DESIGN.studDiameter / 2 + 0.2, d: DESIGN.nodeSleeveDiameter / 2 },
  // The moon cluster turns on the node cluster's sleeve, so its wheels need a larger middle.
  moon: { a: nestOuterDiameter('month') / 2, b: DESIGN.nodeClusterSleeveDiameter / 2 + 0.2, c: DESIGN.nodeClusterSleeveDiameter / 2 + 0.2, d: DESIGN.moonSleeveDiameter / 2 },
};

/** A tellurion wheel's root circle must leave its hub and a little more. */
export const TELLURION_WALL = DESIGN.tellurionHubWall + 0.6;
export const TELLURION_LIMITS: Limits = { minTeeth: 14, maxTeeth: 80, minModule: 0.8 };

/** Largest tip radius of a wheel on the earth post: it must pass inside Mars's stalk. */
export function earthPostMaxTip(): number {
  return DESIGN.armLength.mars - DESIGN.armLength.earth - DESIGN.stalkDiameter / 2 - 2;
}

export function tellurionRule(id: TellurionId, limits: Limits = TELLURION_LIMITS): StepRule {
  const seat = TELLURION_SEATS[id];
  const base = {
    minTeeth: limits.minTeeth,
    maxTeeth: limits.maxTeeth,
    minModule: limits.minModule,
    maxModule: 2.4,
  };
  return {
    first: { ...base, centreDistance: DESIGN.studDistance, minRootFirst: seat.a + TELLURION_WALL, minRootSecond: seat.b + TELLURION_WALL },
    second: {
      ...base, centreDistance: DESIGN.armLength.earth - DESIGN.studDistance,
      minRootFirst: seat.c + TELLURION_WALL, minRootSecond: seat.d + TELLURION_WALL, maxTipSecond: earthPostMaxTip(),
    },
  };
}

export function trainRule(id: TrainId, limits?: Limits): StepRule {
  return (STEP_IDS as readonly string[]).includes(id) ? stepRule(id as StepId, limits) : tellurionRule(id as TellurionId);
}

// ---------------------------------------------------------------- targets

/** What the sky asks for, in days. */
export interface Targets {
  /** Sidereal periods of the chain members: the planets' years and the sidereal month. */
  period: Record<ChainMember, number>;
  /** Sidereal period of the regression of the Moon's nodes. */
  nodeDays: number;
}

/** Period of a chain member in the machine, taking the earth arm as the calendar (one turn is one sidereal year). */
export function machinePeriods(spec: MachineSpec, targets: Targets): Record<ChainMember, number> {
  const rel: number[] = [1];
  for (let i = 0; i < STEP_IDS.length; i++) {
    const s = spec.steps[STEP_IDS[i]!];
    rel.push(rel[i]! * (s.b / s.a) * (s.d / s.c));
  }
  const earth = rel[CHAIN.indexOf('earth')]!;
  const out = {} as Record<ChainMember, number>;
  CHAIN.forEach((m, i) => { out[m] = (targets.period.earth * rel[i]!) / earth; });
  return out;
}

/** The ratio (b/a)(d/c) the node train should have: the node sleeve turns backwards once per nodeDays. */
export function nodeTargetRatio(targets: Targets): number {
  return 1 / (1 + targets.period.earth / targets.nodeDays);
}

/** Period of the nodes' regression in the machine, in days (positive). */
export function machineNodeDays(spec: MachineSpec, targets: Targets): number {
  const s = spec.tellurion.node;
  const r = (s.a / s.b) * (s.c / s.d);
  return targets.period.earth / (r - 1);
}

/**
 * The ratio each gearbox step should have, given the steps already chosen. The earth arm is the
 * calendar, so the steps are settled outwards from it and each one's target absorbs the error of
 * the steps between it and the earth.
 */
export function stepTarget(id: StepId, spec: MachineSpec, targets: Targets): number {
  const periods = machinePeriods(spec, targets);
  const { inner, outer, index } = stepMembers(id);
  const earthIndex = CHAIN.indexOf('earth');
  // Below the earth in the chain the outer member is already settled; above it, the inner one.
  return index < earthIndex ? periods[outer] / targets.period[inner] : targets.period[outer] / periods[inner];
}

/** The order in which steps are settled: outwards from the earth. */
export const SOLVE_ORDER: readonly StepId[] = ['month-earth', 'venus-month', 'mercury-venus', 'earth-mars', 'mars-jupiter', 'jupiter-saturn'];

export const UNIT_STEP: Step = { a: 24, b: 40, c: 40, d: 24 };

function toStep(c: Candidate): Step {
  return { a: c.a, b: c.b, c: c.c, d: c.d };
}

export interface DesignOptions {
  limits?: Limits;
  /**
   * How far each body may drift from its mean place, in degrees per century. The designer takes the
   * coarsest teeth that hold it; 0 asks for the most accurate train whatever its teeth.
   */
  driftBudget?: number;
}

/** Relative error in a period that makes a body drift by `degrees` in a century. */
export function toleranceFor(periodDays: number, degrees: number): number {
  const turnsPerCentury = 36525 / periodDays;
  return degrees / (360 * turnsPerCentury);
}

/** Drift of a chain member from its mean place, in degrees per century (signed). */
export function driftPerCentury(spec: MachineSpec, targets: Targets, member: ChainMember): number {
  const period = machinePeriods(spec, targets)[member];
  // Turns made in a century by the machine, less the turns the sky makes.
  return 360 * (36525 / period - 36525 / targets.period[member]);
}

/** Drift of the node line, in degrees per century (signed, positive when the machine's nodes regress too fast). */
export function nodeDriftPerCentury(spec: MachineSpec, targets: Targets): number {
  return 360 * (36525 / machineNodeDays(spec, targets) - 36525 / targets.nodeDays);
}

function finestModule(spec: MachineSpec, ids: readonly StepId[]): number {
  let m = Infinity;
  for (const id of ids) {
    const s = spec.steps[id];
    m = Math.min(m, (2 * DESIGN.centreDistance) / (s.a + s.b), (2 * DESIGN.centreDistance) / (s.c + s.d));
  }
  return m;
}

/**
 * Settle a run of steps leading away from the earth. A step's error is passed on to the steps
 * beyond it, so the best train for one step is not always the best for the run: a small beam of
 * alternatives is carried along and the run is judged as a whole.
 */
function designRun(spec: MachineSpec, order: readonly StepId[], targets: Targets, limits: Limits, budget: number): void {
  const earthIndex = CHAIN.indexOf('earth');
  interface Partial { spec: MachineSpec; worst: number }
  let beam: Partial[] = [{ spec: cloneSpec(spec), worst: 0 }];
  for (const id of order) {
    const rule = stepRule(id, limits);
    const { inner, outer, index } = stepMembers(id);
    const settled = index < earthIndex ? inner : outer;
    const next: Partial[] = [];
    for (const partial of beam) {
      const target = stepTarget(id, partial.spec, targets);
      const options = solveStep(target, rule, 10);
      if (budget > 0) {
        const coarse = coarsestWithin(target, rule, toleranceFor(targets.period[settled], budget));
        if (coarse) options.push(coarse);
      }
      for (const c of options) {
        const s = cloneSpec(partial.spec);
        s.steps[id] = toStep(c);
        next.push({ spec: s, worst: Math.max(partial.worst, Math.abs(driftPerCentury(s, targets, settled))) });
      }
    }
    if (!next.length) throw new Error(`no train fits ${id} within the limits`);
    // Inside the budget, coarser teeth win; outside it, accuracy does.
    const score = (p: Partial) => (budget > 0 && p.worst <= budget ? -finestModule(p.spec, order) : 1000 + p.worst);
    next.sort((p, q) => score(p) - score(q));
    beam = next.slice(0, 8);
  }
  const best = beam[0]!;
  for (const id of order) spec.steps[id] = best.spec.steps[id];
}

/** Design a whole machine for the given sky and limits. */
export function designMachine(targets: Targets, options: DesignOptions = {}): MachineSpec {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const budget = options.driftBudget ?? 0.25;
  const spec: MachineSpec = {
    steps: Object.fromEntries(STEP_IDS.map((id) => [id, { a: 30, b: 30, c: 30, d: 30 }])) as Record<StepId, Step>,
    tellurion: { tilt: { ...UNIT_STEP }, node: { ...UNIT_STEP }, moon: { ...UNIT_STEP } },
    bevel: { crank: DESIGN.bevelTeethCrank, mercury: DESIGN.bevelTeethMercury },
  };
  designRun(spec, ['month-earth', 'venus-month', 'mercury-venus'], targets, limits, budget);
  designRun(spec, ['earth-mars', 'mars-jupiter', 'jupiter-saturn'], targets, limits, budget);
  const nodeRule = tellurionRule('node');
  const nodeTarget = nodeTargetRatio(targets);
  // The node sleeve's rate is the small difference of two nearly equal rates, so the ratio must be
  // about (node period / year) times more exact than the drift it is allowed.
  const nodeTol = toleranceFor(targets.nodeDays, Math.max(budget, 0.05)) * (targets.period.earth / targets.nodeDays);
  const node = budget > 0 ? coarsestWithin(nodeTarget, nodeRule, nodeTol) : solveStep(nodeTarget, nodeRule, 1)[0] ?? null;
  if (!node) throw new Error('no train fits the node sleeve within the limits');
  spec.tellurion.node = toStep(node);
  return spec;
}

export function cloneSpec(spec: MachineSpec): MachineSpec {
  return JSON.parse(JSON.stringify(spec)) as MachineSpec;
}

export function getTrain(spec: MachineSpec, id: TrainId): Step {
  return (STEP_IDS as readonly string[]).includes(id) ? spec.steps[id as StepId] : spec.tellurion[id as TellurionId];
}

export function setTrain(spec: MachineSpec, id: TrainId, step: Step): void {
  if ((STEP_IDS as readonly string[]).includes(id)) spec.steps[id as StepId] = { ...step };
  else spec.tellurion[id as TellurionId] = { ...step };
}

/** Compact text form of a spec, for share links: tooth counts in train order. */
export function encodeSpec(spec: MachineSpec): string {
  return TRAIN_IDS.map((id) => { const s = getTrain(spec, id); return `${s.a}.${s.b}.${s.c}.${s.d}`; }).join('-');
}

export function decodeSpec(text: string, base: MachineSpec): MachineSpec | null {
  const parts = text.split('-');
  if (parts.length !== TRAIN_IDS.length) return null;
  const spec = cloneSpec(base);
  for (let i = 0; i < parts.length; i++) {
    const n = parts[i]!.split('.').map((v) => Number.parseInt(v, 10));
    if (n.length !== 4 || n.some((v) => !Number.isInteger(v) || v < 6 || v > 200)) return null;
    setTrain(spec, TRAIN_IDS[i]!, { a: n[0]!, b: n[1]!, c: n[2]!, d: n[3]! });
  }
  return spec;
}
