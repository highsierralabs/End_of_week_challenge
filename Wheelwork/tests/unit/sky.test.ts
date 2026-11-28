import { describe, expect, it } from 'vitest';
import { jdFromCalendar, norm180 } from '../../src/core/astro/time';
import { solveRates } from '../../src/core/machine/kinematics';
import { buildLayout } from '../../src/core/machine/layout';
import { poseMachine } from '../../src/core/machine/pose';
import { daysPerTurn, geocentricReading, readMachine, settingFor, skyTargets } from '../../src/core/machine/sky';
import { designMachine, driftPerCentury } from '../../src/core/machine/spec';

describe('the machine against the sky', () => {
  const targets = skyTargets();
  const spec = designMachine(targets, { driftBudget: 0.5 });
  const layout = buildLayout(spec);
  const rates = solveRates(layout);
  const setJd = jdFromCalendar(2026, 11, 27);
  const setting = settingFor(setJd);
  const dpt = daysPerTurn(rates, targets);
  const at = (days: number) => poseMachine(spec, rates, setting, days / dpt);

  it('splits each error into gearing and the rest, exactly', () => {
    for (const days of [0, 123.4, 36525, -80000]) {
      const r = readMachine(at(days), setJd, rates, targets);
      for (const b of ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn'] as const) {
        const p = r.planets[b];
        expect(norm180(p.error - p.gearing - p.circle)).toBeCloseTo(0, 9);
        expect(norm180(p.machine - p.truth - p.error)).toBeCloseTo(0, 9);
      }
      expect(norm180(r.moon.error - r.moon.gearing - r.moon.circle)).toBeCloseTo(0, 9);
    }
  });

  it('has no gearing error on the day it is set and the drift figure a century on', () => {
    const r0 = readMachine(at(0), setJd, rates, targets);
    expect(r0.planets.saturn.gearing).toBe(0);
    const r100 = readMachine(at(36525), setJd, rates, targets);
    for (const b of ['mercury', 'venus', 'mars', 'jupiter', 'saturn'] as const) {
      expect(r100.planets[b].gearing).toBeCloseTo(driftPerCentury(spec, targets, b), 6);
    }
    expect(r100.planets.earth.gearing).toBeCloseTo(0, 9);
  });

  it('sees the Sun from the Earth where the sky has it, to within the Earth\'s own unevenness', () => {
    for (const days of [0, 91, 182, 273]) {
      const g = geocentricReading(at(days), setJd, rates, targets);
      expect(Math.abs(g.sun.error)).toBeLessThan(2.2);
      expect(g.sun.retrograde).toBe(false);
      expect(g.sun.retrogradeTruth).toBe(false);
    }
  });

  it('shows Mars going backwards at opposition, on the machine and in the sky', () => {
    // Find each one's own opposition in the next 800 days: Mars opposite the Sun.
    let bestMachine = { off: 999, days: 0 };
    let bestTruth = { off: 999, days: 0 };
    for (let days = 0; days < 800; days += 0.5) {
      const g = geocentricReading(at(days), setJd, rates, targets);
      const m = Math.abs(norm180(g.mars.machine - g.sun.machine - 180));
      const t = Math.abs(norm180(g.mars.truth - g.sun.truth - 180));
      if (m < bestMachine.off) bestMachine = { off: m, days };
      if (t < bestTruth.off) bestTruth = { off: t, days };
    }
    expect(bestMachine.off).toBeLessThan(1);
    expect(bestTruth.off).toBeLessThan(1);
    expect(geocentricReading(at(bestMachine.days), setJd, rates, targets).mars.retrograde).toBe(true);
    expect(geocentricReading(at(bestTruth.days), setJd, rates, targets).mars.retrogradeTruth).toBe(true);
    // The two oppositions are days apart, not months: the machine's Mars is within its circle error.
    expect(Math.abs(bestMachine.days - bestTruth.days)).toBeLessThan(25);
    // Away from opposition, at conjunction with the Sun, Mars runs direct.
    const far = geocentricReading(at(bestTruth.days + 390), setJd, rates, targets);
    expect(far.mars.retrogradeTruth).toBe(false);
  });
});
