import { describe, expect, it } from 'vitest';
import { checkClosed, meshStats } from '../../src/core/mesh/kit';
import { buildLayout } from '../../src/core/machine/layout';
import { bevelSeat, buildParts, PRINT_DETAIL } from '../../src/core/machine/parts';
import { designMachine, type Targets } from '../../src/core/machine/spec';
import { levelZ } from '../../src/core/machine/design';

const TARGETS: Targets = {
  period: { mercury: 87.9691, venus: 224.701, month: 27.321662, earth: 365.256363, mars: 686.98, jupiter: 4332.589, saturn: 10759.22 },
  nodeDays: 6793.48,
};

describe('parts', () => {
  const layout = buildLayout(designMachine(TARGETS));
  it('are closed solids with positive volume, on screen and for print', () => {
    for (const detail of [undefined, PRINT_DETAIL]) {
      const parts = buildParts(layout, { detail, withCase: true });
      expect(parts.length).toBeGreaterThan(80);
      let tris = 0;
      for (const p of parts) {
        const r = checkClosed(p.mesh, 1e-6);
        expect(r.closed, `${p.id}: ${JSON.stringify(r)}`).toBe(true);
        expect(meshStats(p.mesh).volume, p.id).toBeGreaterThan(0);
        tris += p.mesh.indices.length / 3;
      }
      console.log(`${parts.length} parts, ${tris} triangles`);
    }
  });
  it('seats the crank wheel under level 1', () => {
    const seat = bevelSeat();
    console.log(`bevel: wheelTop ${seat.wheelTop.toFixed(2)}, pinionOuterX ${seat.pinionOuterX.toFixed(2)}, ratio ${seat.ratio}`);
    expect(seat.wheelTop).toBeLessThan(levelZ(1) - 1);
    expect(Math.abs(seat.ratio)).toBeCloseTo(3, 9);
  });
});

import { buildKit } from '../../src/core/machine/kit';

describe('print kit', () => {
  it('uses every part, closes every solid and passes every mesh', () => {
    const layout = buildLayout(designMachine(TARGETS));
    const kit = buildKit(layout);
    for (const p of kit.pieces) {
      expect(p.closed, p.file).toBe(true);
      expect(p.volume, p.file).toBeGreaterThan(0);
    }
    for (const m of kit.meshes) expect(m.ok, `${m.train} ${m.pair}`).toBe(true);
    expect(kit.ok).toBe(true);
    console.log(kit.readme);
  });
});

describe('fits in the print kit', () => {
  const layout = buildLayout(designMachine(TARGETS));
  const kit = buildKit(layout);
  const piece = (re: RegExp) => kit.pieces.find((p) => re.test(p.name))!;
  it('stands every ball and pillar on a flat face', () => {
    for (const name of [/^Sun$/, /^Mercury$/, /^Venus$/, /^Mars$/, /^Jupiter$/, /^Saturn$/, /^Moon$/, /^Pillar, lower$/, /^Pillar, upper$/, /^Saturn's ring$/, /^Base plate$/]) {
      const p = piece(name);
      let onBed = 0;
      for (let i = 2; i < p.mesh.positions.length; i += 3) if (p.mesh.positions[i]! < 1e-6) onBed++;
      expect(onBed, p.name).toBeGreaterThan(8);
    }
  });
  it('draws fixed fits size for size', () => {
    // Mercury's wheel A is bored to the tube's outside radius, 4 mm: the innermost ring of the piece.
    const wheel = piece(/^Mercury to Venus wheel A/);
    const pos = wheel.mesh.positions;
    const ring: [number, number][] = [];
    // The piece is centred on the bed by its bounding box, which need not be its axis: fit the ring's own centre.
    for (let i = 0; i < pos.length; i += 3) if (Math.hypot(pos[i]!, pos[i + 1]!) < 4.3) ring.push([pos[i]!, pos[i + 1]!]);
    const cx = ring.reduce((t, q) => t + q[0], 0) / ring.length;
    const cy = ring.reduce((t, q) => t + q[1], 0) / ring.length;
    const radius = ring.reduce((t, q) => t + Math.hypot(q[0] - cx, q[1] - cy), 0) / ring.length;
    expect(ring.length).toBeGreaterThan(16);
    expect(radius).toBeCloseTo(4, 3);
  });
});
