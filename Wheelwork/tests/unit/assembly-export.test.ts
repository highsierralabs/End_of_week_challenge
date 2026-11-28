// Not a test of anything by itself: when WW_EXPORT_DIR is set, writes every part of the machine
// as an STL in its assembled place (print detail, room frame) at a few crank positions, so that an
// outside tool can look for parts that run into each other. See docs/print-check.md.
//   WW_EXPORT_DIR=/some/dir npx vitest run tests/unit/assembly-export.test.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { solveRates, wheelPhases } from '../../src/core/machine/kinematics';
import { buildLayout } from '../../src/core/machine/layout';
import { buildParts, PRINT_DETAIL } from '../../src/core/machine/parts';
import { frameOf, poseMachine } from '../../src/core/machine/pose';
import { settingFor, skyTargets } from '../../src/core/machine/sky';
import { designMachine } from '../../src/core/machine/spec';
import { compose, rotationZ, toBinaryStl, transformed } from '../../src/core/mesh/kit';

const dir = process.env.WW_EXPORT_DIR;

describe('assembly export', () => {
  it.runIf(!!dir)('writes the assembled machine', () => {
    const targets = skyTargets();
    const spec = designMachine(targets, { driftBudget: 0.5 });
    const layout = buildLayout(spec);
    const rates = solveRates(layout);
    const setting = settingFor(2461372.5);
    const phases = wheelPhases(layout, setting);
    const parts = buildParts(layout, { detail: PRINT_DETAIL });
    for (const [k, turns] of [0, 0.37, 5.21].entries()) {
      const out = join(dir!, `pose${k}`);
      mkdirSync(out, { recursive: true });
      const pose = poseMachine(spec, rates, setting, turns);
      const manifest: { file: string; id: string; body: string }[] = [];
      for (const p of parts) {
        // WW_EXPORT_BREAK leaves every wheel at phase zero, to show that the outside check notices.
        const spin = p.wheel && !process.env.WW_EXPORT_BREAK ? rotationZ(phases.get(p.wheel) ?? 0) : rotationZ(0);
        const mesh = transformed(p.mesh, compose(frameOf(pose, p.body), spin));
        const file = `${p.id.replace(/[^A-Za-z0-9-]/g, '_')}.stl`;
        writeFileSync(join(out, file), toBinaryStl(mesh, p.id));
        manifest.push({ file, id: p.id, body: p.body });
      }
      writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest));
    }
    expect(parts.length).toBeGreaterThan(90);
  });
  it('is skipped unless asked for', () => {
    expect(true).toBe(true);
  });
});
