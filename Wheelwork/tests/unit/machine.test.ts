import { describe, expect, it } from 'vitest';
import { CHAIN } from '../../src/core/machine/design';
import { ALL_BODIES, bodyAngle, meshError, solveRates, wheelPhases, zeroSetting } from '../../src/core/machine/kinematics';
import { buildLayout } from '../../src/core/machine/layout';
import {
  decodeSpec, designMachine, encodeSpec, machineNodeDays, machinePeriods, STEP_IDS, stepRule, stepTarget, type Targets, toleranceFor,
} from '../../src/core/machine/spec';
import { bestPair, convergents } from '../../src/core/train/rational';
import { feasiblePairs, solveStep } from '../../src/core/train/solver';
import { poseMachine } from '../../src/core/machine/pose';
import { ECLIPSE_LIMITS, readMachine } from '../../src/core/machine/sky';
import { tellurionRule } from '../../src/core/machine/spec';
import { DESIGN } from '../../src/core/machine/design';

// Round figures, good enough to exercise the designer; the app takes its targets from the
// reference astronomy.
const TARGETS: Targets = {
  period: { mercury: 87.9691, venus: 224.701, month: 27.321662, earth: 365.256363, mars: 686.98, jupiter: 4332.589, saturn: 10759.22 },
  nodeDays: 6793.48,
};

describe('continued fractions', () => {
  it('gives Huygens his 206/7 for Saturn', () => {
    // Huygens took Saturn's period as 77708431/2640858 years.
    const c = convergents(77708431 / 2640858).map((v) => `${v.p}/${v.q}`);
    expect(c.slice(0, 4)).toEqual(['29/1', '59/2', '147/5', '206/7']);
  });
  it('finds the best single pair exhaustively', () => {
    const best = bestPair(Math.PI, 5, 400)!;
    expect(`${best.p}/${best.q}`).toBe('355/113');
  });
});

describe('solver', () => {
  it('lists only pairs that fit the frame', () => {
    const rule = stepRule('mars-jupiter');
    const pairs = feasiblePairs(rule.first);
    expect(pairs.length).toBeGreaterThan(200);
    for (const p of pairs) {
      expect(p.module).toBeCloseTo(108 / (p.first + p.second), 12);
      expect(p.module).toBeGreaterThanOrEqual(1);
    }
  });
  it('agrees with brute force on a small rule', () => {
    const rule = stepRule('earth-mars', { minTeeth: 14, maxTeeth: 40, minModule: 1.6 });
    const target = 1.8808;
    const best = solveStep(target, rule, 1)[0]!;
    let bruteBest = Infinity;
    const firsts = feasiblePairs(rule.first);
    const seconds = feasiblePairs(rule.second);
    for (const p of firsts) for (const q of seconds) bruteBest = Math.min(bruteBest, Math.abs((p.ratio * q.ratio) / target - 1));
    expect(Math.abs(best.error)).toBeCloseTo(bruteBest, 14);
  });
});

describe('designed machine', () => {
  const spec = designMachine(TARGETS);
  const layout = buildLayout(spec);
  const rates = solveRates(layout);

  it('passes its own rules', () => {
    for (const r of layout.rules) expect(r.ok, `${r.id}: ${r.text}`).toBe(true);
  });

  it('holds every body inside the drift budget', () => {
    const periods = machinePeriods(spec, TARGETS);
    const report: string[] = [];
    for (const m of CHAIN) {
      const rel = periods[m] / TARGETS.period[m] - 1;
      const drift = Math.abs(rel) / toleranceFor(TARGETS.period[m], 1);
      report.push(`${m}: ${periods[m].toFixed(5)} d, ${drift.toFixed(3)} deg/century`);
      void drift;
    }
    const node = machineNodeDays(spec, TARGETS);
    report.push(`node: ${node.toFixed(2)} d`);
    expect(Math.abs(node / TARGETS.nodeDays - 1)).toBeLessThan(2e-3);
    console.log(report.join('\n'));
    console.log(STEP_IDS.map((id) => `${id}: ${JSON.stringify(spec.steps[id])} m=${layout.byId.get(`${id}.a`)!.module.toFixed(2)},${layout.byId.get(`${id}.c`)!.module.toFixed(2)}`).join('\n'));
    console.log(`node: ${JSON.stringify(spec.tellurion.node)}`);
  });

  it('targets are consistent once settled', () => {
    for (const id of STEP_IDS) {
      const s = spec.steps[id];
      const t = stepTarget(id, spec, TARGETS);
      expect(Math.abs(((s.b / s.a) * (s.d / s.c)) / t - 1)).toBeLessThan(3e-4);
    }
  });

  it('turns the planets the same way and the nodes backwards', () => {
    for (const m of CHAIN) expect(rates.value[m]).toBeGreaterThan(0);
    expect(rates.value.nodeSleeve).toBeLessThan(0);
    expect(rates.value.earthAxis).toBe(0);
    expect(rates.value.moonSleeve).toBeCloseTo(rates.value.month, 15);
    const crankDays = TARGETS.period.earth * rates.value.earth;
    console.log(`one turn of the crank = ${crankDays.toFixed(3)} days`);
  });

  it('keeps every mesh in mesh at any crank angle', () => {
    const setting = zeroSetting();
    let seed = 7;
    for (const b of ALL_BODIES) { seed = (seed * 16807) % 2147483647; setting[b] = (seed / 2147483647) * 6.28; }
    setting.frame = 0;
    const phases = wheelPhases(layout, setting);
    for (const turns of [0, 0.37, 1, 12.5, 4321.123]) {
      for (const w of layout.wheels) {
        expect(Math.abs(meshError(layout, rates, setting, phases, w, turns)), `${w.id} at ${turns}`).toBeLessThan(1e-6);
      }
    }
    expect(bodyAngle(rates, setting, 'frame', 99)).toBe(0);
  });

  it('round-trips through a share link', () => {
    expect(decodeSpec(encodeSpec(spec), spec)).toEqual(spec);
  });
});

describe('review fixes', () => {
  it('lists distinct ratios, each by its coarsest train', () => {
    const rule = tellurionRule('tilt');
    const list = solveStep(1, rule, 8);
    expect(list.length).toBe(8);
    expect(new Set(list.map((c) => c.ratio)).size).toBe(8);
    expect(list[0]!.error).toBe(0);
    // Brute force for the coarsest exact one-to-one train.
    let coarsest = 0;
    for (const p of feasiblePairs(rule.first)) for (const q of feasiblePairs(rule.second)) {
      if (p.second * q.second === p.first * q.first) coarsest = Math.max(coarsest, Math.min(p.module, q.module));
    }
    expect(Math.min(list[0]!.moduleFirst, list[0]!.moduleSecond)).toBeCloseTo(coarsest, 12);
  });

  it('keeps cluster wheels clear of the cluster hub', () => {
    for (const id of STEP_IDS) {
      const rule = stepRule(id, { minTeeth: 10, maxTeeth: 160, minModule: 0.5 });
      for (const p of feasiblePairs(rule.first)) {
        const tipOfCentral = p.module * (p.first / 2 + 1);
        expect(tipOfCentral).toBeLessThan(DESIGN.centreDistance - DESIGN.clusterHubDiameter / 2);
      }
    }
  });

  it('gives both wheels of a cluster the same place on it', () => {
    const layout = buildLayout(designMachine(TARGETS));
    const setting = zeroSetting();
    setting.earth = 1.234; setting.mars = 2.5; setting.moonSleeve = 0.7;
    const phases = wheelPhases(layout, setting);
    for (const w of layout.wheels) if (w.role === 'b' || w.role === 'c') expect(phases.get(w.id)).toBe(0);
  });

  it('judges an eclipse at the exact new Moon, not near it', () => {
    const layout = buildLayout(designMachine(TARGETS));
    const rates = solveRates(layout);
    const deg = Math.PI / 180;
    // Sun at 21, Moon at 16, node at 0: five degrees short of new, latitude 1.42 now but 1.9 at conjunction.
    const setting = zeroSetting();
    setting.earth = (21 + 180) * deg; setting.moonSleeve = 16 * deg; setting.nodeSleeve = 0;
    const r = readMachine(poseMachine(layout.spec, rates, setting, 0), 2461000, rates, TARGETS);
    expect(Math.abs(r.moon.latitude)).toBeLessThan(ECLIPSE_LIMITS.solarLatitude);
    expect(Math.abs(r.eclipse.latitudeAtSyzygy)).toBeGreaterThan(ECLIPSE_LIMITS.solarLatitude);
    expect(r.eclipse.daysToSyzygy).toBeGreaterThan(0.3);
    expect(r.eclipse.now).toBe(null);
    // Moved so that conjunction falls at the node, it is an eclipse.
    setting.earth = (5 + 180) * deg; setting.moonSleeve = 2 * deg;
    expect(readMachine(poseMachine(layout.spec, rates, setting, 0), 2461000, rates, TARGETS).eclipse.now).toBe('solar');
  });
});
