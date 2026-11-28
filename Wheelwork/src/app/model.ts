// The state of the app: one machine (its tooth counts), how it was set, and how far the crank has
// been turned. Everything shown is derived from these.
import { jdFromCalendar } from '../core/astro/time';
import { type Rates, type Setting, solveRates, wheelPhases } from '../core/machine/kinematics';
import { buildLayout, type Layout } from '../core/machine/layout';
import { type MachinePose, poseMachine } from '../core/machine/pose';
import { daysPerTurn, readMachine, type Reading, settingFor, skyTargets } from '../core/machine/sky';
import { cloneSpec, DEFAULT_LIMITS, designMachine, type Limits, type MachineSpec, type Targets } from '../core/machine/spec';

export type ModelEvent = 'spec' | 'setting' | 'time';

export const DEFAULT_DRIFT_BUDGET = 0.5;

/**
 * What the frame can physically take, as opposed to what the designer is asked to keep to: a
 * visitor may fit any train inside these. Under ten teeth a pinion is undercut so far that the
 * mesh loses contact between teeth.
 */
export const PHYSICAL_LIMITS: Limits = { minTeeth: 10, maxTeeth: 160, minModule: 0.5 };

export class Model {
  readonly targets: Targets = skyTargets();
  /** The machine as its designer made it, for "restore". */
  readonly original: MachineSpec;
  spec: MachineSpec;
  layout!: Layout;
  rates!: Rates;
  /** The date the machine was set on (JD) and the angles it was set to. */
  setJd: number;
  setting!: Setting;
  phases!: Map<string, number>;
  /** Turns of the crank since the machine was set. */
  turns = 0;
  /** Turns of the crank per second while running; 0 when stopped. */
  speed = 0;
  private listeners = new Map<ModelEvent, Set<() => void>>();
  private cachedPose: MachinePose | null = null;
  private cachedReading: Reading | null = null;

  constructor(todayJd: number) {
    this.original = designMachine(this.targets, { limits: DEFAULT_LIMITS, driftBudget: DEFAULT_DRIFT_BUDGET });
    this.spec = cloneSpec(this.original);
    this.setJd = todayJd;
    this.derive();
  }

  static todayJd(): number {
    const now = new Date();
    // The visitor's own calendar date, at 0h.
    return jdFromCalendar(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  on(event: ModelEvent, fn: () => void): void {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(fn);
  }

  private emit(event: ModelEvent): void {
    this.cachedPose = null;
    this.cachedReading = null;
    for (const fn of this.listeners.get(event) ?? []) fn();
  }

  private derive(): void {
    this.layout = buildLayout(this.spec, PHYSICAL_LIMITS);
    this.rates = solveRates(this.layout);
    this.setting = settingFor(this.setJd);
    this.phases = wheelPhases(this.layout, this.setting);
  }

  /** Replace the tooth counts. The machine keeps showing the same date. */
  setSpec(spec: MachineSpec): void {
    const jd = this.jd;
    this.spec = cloneSpec(spec);
    this.derive();
    this.turns = (Math.max(Model.MIN_JD, Math.min(Model.MAX_JD, jd)) - this.setJd) / this.daysPerTurn;
    this.emit('spec');
  }

  /** Set the machine afresh on a date: every arm goes to its mean place and the crank count to zero. */
  resetTo(jd: number): void {
    this.setJd = Math.max(Model.MIN_JD, Math.min(Model.MAX_JD, jd));
    jd = this.setJd;
    this.turns = 0;
    this.setting = settingFor(jd);
    this.phases = wheelPhases(this.layout, this.setting);
    this.emit('setting');
  }

  get daysPerTurn(): number {
    return daysPerTurn(this.rates, this.targets);
  }

  /** The date the machine shows. */
  get jd(): number {
    return this.setJd + this.turns * this.daysPerTurn;
  }

  /** The reference astronomy covers 3000 BC to AD 3000; the machine is not run outside it. */
  static readonly MIN_JD = jdFromCalendar(-2999, 1, 1);
  static readonly MAX_JD = jdFromCalendar(3000, 12, 31);

  /** True when the machine stands at either end of the span it may be run over. */
  get atLimit(): boolean {
    return this.jd <= Model.MIN_JD || this.jd >= Model.MAX_JD;
  }

  setTurns(turns: number): void {
    const lo = (Model.MIN_JD - this.setJd) / this.daysPerTurn;
    const hi = (Model.MAX_JD - this.setJd) / this.daysPerTurn;
    const clamped = Math.max(lo, Math.min(hi, turns));
    if (clamped === this.turns) return;
    this.turns = clamped;
    this.emit('time');
  }

  /** Turn the crank until the machine shows this date. */
  goTo(jd: number): void {
    this.setTurns((jd - this.setJd) / this.daysPerTurn);
  }

  pose(): MachinePose {
    this.cachedPose ??= poseMachine(this.spec, this.rates, this.setting, this.turns);
    return this.cachedPose;
  }

  reading(): Reading {
    this.cachedReading ??= readMachine(this.pose(), this.setJd, this.rates, this.targets);
    return this.cachedReading;
  }
}
