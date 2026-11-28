import { describe, expect, it } from 'vitest';
import {
  box, checkClosed, circle, cylinder, extrude, lathe, linkOutline, merge, meshStats, parseBinaryStl, polarRing, revolve, ringArea,
  rotationX, sphere, spokeWindow, toBinaryStl, transformed, translation, tube,
} from '../../src/core/mesh/kit';

describe('mesh kit', () => {
  it('extrudes a plate with holes into a closed solid of the right volume', () => {
    const m = extrude({ outer: circle(10, 96), holes: [circle(3, 48), circle(1, 24, 6, 0)] }, 0, 2);
    const s = meshStats(m);
    const area = ringArea(circle(10, 96)) - ringArea(circle(3, 48)) - ringArea(circle(1, 24));
    expect(checkClosed(m).closed).toBe(true);
    expect(s.volume).toBeCloseTo(area * 2, 9);
  });
  it('tapers', () => {
    const m = extrude({ outer: circle(10, 64), holes: [] }, 0, 3, 0.5);
    expect(checkClosed(m).closed).toBe(true);
    const a = ringArea(circle(10, 64));
    expect(meshStats(m).volume).toBeCloseTo((a * 3 * (1 + 0.5 + 0.25)) / 3, 9);
  });
  it('turns closed solids on the lathe', () => {
    for (const m of [cylinder(4, 0, 10, 64), tube(5, 3, 0, 10, 64), sphere(6, 2, 64)]) {
      const r = checkClosed(m);
      expect(r.closed).toBe(true);
      expect(r.degenerateTriangles).toBe(0);
      expect(meshStats(m).volume).toBeGreaterThan(0);
    }
    expect(meshStats(cylinder(4, 0, 10, 256)).volume).toBeCloseTo(Math.PI * 16 * 10, 0);
    expect(meshStats(sphere(6, 0, 128)).volume / ((4 / 3) * Math.PI * 216)).toBeCloseTo(1, 2);
    const ring = lathe([[8, 0], [10, 0], [10, 1], [8, 1]], 32);
    expect(checkClosed(ring).closed).toBe(true);
  });
  it('revolves a half shell with caps', () => {
    const m = revolve([[8, 0], [10, 0], [10, 5], [8, 5]], 0, Math.PI, 64);
    expect(checkClosed(m).closed).toBe(true);
    expect(meshStats(m).volume / ((Math.PI * (100 - 64) * 5) / 2)).toBeCloseTo(1, 2);
  });
  it('keeps shells closed through transforms, merging and STL', () => {
    const a = transformed(box(0, 0, 0, 2, 3, 4), translation(5, 0, 0));
    const b = transformed(cylinder(1, 0, 5, 32), rotationX(0.7));
    const m = merge([a, b]);
    expect(checkClosed(m).closed).toBe(true);
    const back = parseBinaryStl(toBinaryStl(m));
    expect(back.indices.length).toBe(m.indices.length);
    expect(checkClosed(back, 1e-4).closed).toBe(true);
    expect(meshStats(back).volume).toBeCloseTo(meshStats(m).volume, 3);
  });
  it('reports an open mesh', () => {
    const m = box(0, 0, 0, 1, 1, 1);
    const open = { positions: m.positions, indices: m.indices.slice(3) };
    const r = checkClosed(open);
    expect(r.closed).toBe(false);
    expect(r.boundaryEdges).toBe(3);
  });
  it('draws wheel crossings and links as simple counter-clockwise rings', () => {
    const w = spokeWindow(6, 20, 0, Math.PI / 2, 3, 1.5);
    expect(ringArea(w)).toBeGreaterThan(0);
    // Less than the sharp-cornered sector between the spokes.
    expect(ringArea(w)).toBeLessThan((Math.PI / 4) * (400 - 36));
    for (const [x, y] of w) {
      const r = Math.hypot(x, y);
      expect(r).toBeGreaterThan(6 - 0.05);
      expect(r).toBeLessThan(20 + 1e-6);
    }
    const link = linkOutline(6, 3, 40);
    expect(ringArea(link)).toBeGreaterThan(0);
    expect(checkClosed(extrude({ outer: link, holes: [circle(2, 24)] }, 0, 2)).closed).toBe(true);
    const star = polarRing((t) => 10 + 2 * Math.cos(4 * t), 200);
    expect(checkClosed(extrude({ outer: star, holes: [] }, 0, 1)).closed).toBe(true);
  });
});
