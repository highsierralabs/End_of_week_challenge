import { describe, expect, it } from 'vitest';
import { decodeOutline, encodeOutline } from '../../src/app/share';
import { circle } from '../../src/solver/shapes';

describe('share links', () => {
  it('round-trips an outline to the millimetre', () => {
    const p = circle(0.3, 90, 0.05, -0.02);
    const back = decodeOutline(encodeOutline(p))!;
    expect(back.length).toBe(p.length);
    back.forEach((v, i) => expect(Math.abs(v - p[i]!)).toBeLessThanOrEqual(0.0005 + 1e-12));
  });

  it('keeps long outlines short', () => {
    const code = encodeOutline(circle(0.3, 800));
    expect(code.length).toBeLessThan(700);
    expect(decodeOutline(code)!.length).toBe(240);
  });

  it('rejects junk', () => {
    expect(decodeOutline('not base64!')).toBeNull();
    expect(decodeOutline('AAAA')).toBeNull();
  });
});
