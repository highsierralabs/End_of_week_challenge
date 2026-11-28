// How everything turns. Rates come from tooth counts alone, as exact fractions of the crank's
// rate; nothing in the machine is moved by astronomy. The sky enters once, when the machine is
// set: each arm is turned on its tube to where its body is on the setting date.
import { CHAIN } from './design';
import { type BodyId, type Layout, type Wheel, axisPosition } from './layout';
import { STEP_IDS, TELLURION_IDS } from './spec';
import { add, frac, type Fraction, mul, neg, sub, toNumber } from '../train/rational';

const TAU = Math.PI * 2;

export const ALL_BODIES: readonly BodyId[] = [
  'frame', 'crank', ...CHAIN,
  'cluster0', 'cluster1', 'cluster2', 'cluster3', 'cluster4', 'cluster5',
  'tiltCluster', 'nodeCluster', 'moonCluster', 'earthAxis', 'moonSleeve', 'nodeSleeve', 'moonStalk',
];

/** Bodies whose axis is carried round by the earth arm. */
export const CARRIED: ReadonlySet<BodyId> = new Set<BodyId>(['tiltCluster', 'nodeCluster', 'moonCluster', 'earthAxis', 'moonSleeve', 'nodeSleeve', 'moonStalk']);

export interface Rates {
  /** Turns of each body per turn of the crank, in the room's frame (carried bodies too). */
  exact: Record<BodyId, Fraction>;
  value: Record<BodyId, number>;
}

/** The rate of every body, from the tooth counts. Positive is counter-clockwise seen from above. */
export function solveRates(layout: Layout): Rates {
  const spec = layout.spec;
  const exact = {} as Record<BodyId, Fraction>;
  exact.frame = frac(0);
  exact.crank = frac(1);
  exact.mercury = frac(spec.bevel.crank, spec.bevel.mercury);
  STEP_IDS.forEach((id, i) => {
    const s = spec.steps[id];
    const inner = exact[CHAIN[i]!];
    // An external mesh reverses the sense: the cluster turns backwards, the next tube forwards again.
    exact[`cluster${i}` as BodyId] = neg(mul(inner, frac(s.a, s.b)));
    exact[CHAIN[i + 1]!] = mul(inner, frac(s.a * s.c, s.b * s.d));
  });
  // On the earth arm every axis is carried, so the meshes act on rates relative to the arm.
  const arm = exact.earth;
  const clusters = { tilt: 'tiltCluster', node: 'nodeCluster', moon: 'moonCluster' } as const;
  const outputs = { tilt: 'earthAxis', node: 'nodeSleeve', moon: 'moonSleeve' } as const;
  for (const id of TELLURION_IDS) {
    const s = spec.tellurion[id];
    const first = layout.byId.get(`${id}.a`)!;
    const centre = sub(exact[first.body], arm);
    exact[clusters[id]] = sub(arm, mul(centre, frac(s.a, s.b)));
    exact[outputs[id]] = add(arm, mul(centre, frac(s.a * s.c, s.b * s.d)));
  }
  exact.moonStalk = exact.moonSleeve;
  const value = {} as Record<BodyId, number>;
  for (const b of ALL_BODIES) value[b] = toNumber(exact[b]);
  return { exact, value };
}

/** The angle of every body at crank angle zero: how the machine was set. */
export type Setting = Record<BodyId, number>;

export function zeroSetting(): Setting {
  const s = {} as Setting;
  for (const b of ALL_BODIES) s[b] = 0;
  return s;
}

/** Angle of a body (radians, room frame) after `turns` of the crank. */
export function bodyAngle(rates: Rates, setting: Setting, body: BodyId, turns: number): number {
  return setting[body] + TAU * rates.value[body] * turns;
}

/**
 * Rotation that wheel B needs to mesh with wheel A, both outlines having tooth 0 centred on their
 * own +X at rotation zero, A at rotation thetaA, and B's centre in direction phi from A's.
 * At the pitch point a tooth of A must meet a space of B, and the two pitch circles roll together.
 */
export function matingAngle(thetaA: number, zA: number, zB: number, phi: number): number {
  return phi + Math.PI - Math.PI / zB - (zA / zB) * (thetaA - phi);
}

/**
 * The fixed angle of each wheel on its body that puts every mesh in mesh. A wheel is a friction
 * fit on its tube, as the arms are, so its place on the body is free: wheels a and c sit at zero
 * and their mates take what the mesh asks for.
 */
export function wheelPhases(layout: Layout, setting: Setting): Map<string, number> {
  const out = new Map<string, number>();
  const armAngle = setting.earth;
  for (const w of layout.wheels) {
    if (w.role !== 'a' && w.role !== 'c') continue;
    const mate = layout.byId.get(w.mate)!;
    const carrier = w.tellurion ? armAngle : 0;
    const [wx, wy] = axisPosition(w.axis);
    const [mx, my] = axisPosition(mate.axis);
    const phi = Math.atan2(my - wy, mx - wx);
    const thetaW = setting[w.body] - carrier;
    const thetaM = matingAngle(thetaW, w.teeth, mate.teeth, phi);
    out.set(w.id, 0);
    out.set(mate.id, norm(thetaM - (setting[mate.body] - carrier)));
  }
  return out;
}

function norm(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** Rotation of a wheel about its own axis in the room frame. */
export function wheelAngle(rates: Rates, setting: Setting, phases: Map<string, number>, w: Wheel, turns: number): number {
  return bodyAngle(rates, setting, w.body, turns) + (phases.get(w.id) ?? 0);
}

/**
 * How far out of step a mesh is, as a fraction of a tooth pitch in (-0.5, 0.5]: zero when a tooth
 * of one wheel is centred in a space of the other at the pitch point. Used to prove the kinematics.
 */
export function meshError(layout: Layout, rates: Rates, setting: Setting, phases: Map<string, number>, w: Wheel, turns: number): number {
  const mate = layout.byId.get(w.mate)!;
  const carrier = w.tellurion ? bodyAngle(rates, setting, 'earth', turns) : 0;
  const [wx, wy] = axisPosition(w.axis);
  const [mx, my] = axisPosition(mate.axis);
  const phi = Math.atan2(my - wy, mx - wx);
  const thetaW = wheelAngle(rates, setting, phases, w, turns) - carrier;
  const thetaM = wheelAngle(rates, setting, phases, mate, turns) - carrier;
  const want = matingAngle(thetaW, w.teeth, mate.teeth, phi);
  const pitches = ((thetaM - want) * mate.teeth) / TAU;
  return pitches - Math.round(pitches);
}
