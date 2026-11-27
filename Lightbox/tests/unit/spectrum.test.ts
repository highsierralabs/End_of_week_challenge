import { describe, expect, it } from 'vitest';
import { GLASSES, LINES } from '../../src/data/optics';
import type { GlassName } from '../../src/core/scene';
import { CMF, DLAM, LAM0, LAM1, NL, NS, abbe, blackbodyXYZ, cameraMatrix, gasSpectrum, glassIndex, integrate, lamAt, lightSpectrum, metalReflectance, reflectance, srgbToLinear, toXYZ, wavelengthTable, xyzToLinearRgb } from '../../src/core/spectrum';

const xy = (v: [number, number, number]) => [v[0] / (v[0] + v[1] + v[2]), v[1] / (v[0] + v[1] + v[2])];

describe('colour matching functions', () => {
  it('y-bar peaks at 1 near 555 nm', () => {
    let best = 0;
    for (let i = 0; i < NS; i++) if (CMF[1][i]! > CMF[1][best]!) best = i;
    expect(CMF[1][best]).toBeCloseTo(1, 3);
    expect(Math.abs(lamAt(best) - 555)).toBeLessThan(1);
  });
  it('gives the published chromaticity of D65', () => {
    const [x, y] = xy(toXYZ(lightSpectrum({ kind: 'd65' })));
    expect(x).toBeCloseTo(0.3127, 3);
    expect(y).toBeCloseTo(0.329, 3);
  });
  it('gives the published chromaticity of illuminant A from a 2856 K blackbody', () => {
    const [x, y] = xy(blackbodyXYZ(2856));
    expect(x).toBeCloseTo(0.44758, 3);
    expect(y).toBeCloseTo(0.40745, 3);
  });
});

describe('light spectra', () => {
  it('are normalised to unit luminance', () => {
    for (const d of [{ kind: 'blackbody', kelvin: 3000 }, { kind: 'gas', gas: 'Ne' }, { kind: 'laser', nm: 632.8 }, { kind: 'led', nm: 460, width: 25 }] as const) {
      expect(integrate(lightSpectrum(d), CMF[1])).toBeCloseTo(1, 4);
    }
  });
  it('keep a gas line at its wavelength', () => {
    const s = gasSpectrum('Na');
    let best = 0;
    for (let i = 0; i < NS; i++) if (s[i]! > s[best]!) best = i;
    expect(Math.abs(lamAt(best) - 589.0)).toBeLessThan(0.4);
    let mean = 0;
    let total = 0;
    for (let i = 0; i < NS; i++) { mean += s[i]! * lamAt(i); total += s[i]!; }
    const lines = LINES.Na!;
    const expected = lines.reduce((a, l) => a + l[0] * l[1], 0) / lines.reduce((a, l) => a + l[1], 0);
    expect(mean / total).toBeCloseTo(expected, 2);
  });
  it('colours the gases as they look: neon red-orange, sodium yellow, mercury blue-white, hydrogen pink', () => {
    const rgb = (g: 'Ne' | 'Na' | 'Hg' | 'H') => xyzToLinearRgb(toXYZ(lightSpectrum({ kind: 'gas', gas: g })));
    const ne = rgb('Ne');
    expect(ne[0]).toBeGreaterThan(ne[1]);
    expect(ne[0]).toBeGreaterThan(3 * Math.abs(ne[2]));
    const na = rgb('Na');
    expect(na[0]).toBeGreaterThan(na[2]);
    expect(na[1]).toBeGreaterThan(na[2]);
    const hg = rgb('Hg');
    expect(hg[2]).toBeGreaterThan(hg[0]);
    const h = rgb('H');
    expect(h[0]).toBeGreaterThan(h[1]);
    expect(h[2]).toBeGreaterThan(h[1]);
  });
});

describe('glass dispersion', () => {
  it('matches the catalogue index and Abbe number of the Schott glasses', () => {
    for (const g of ['bk7', 'sf10', 'sf11'] as const) {
      const d = GLASSES[g]!;
      expect(glassIndex(g, 587.5618)).toBeCloseTo(d.nd!, 4);
      expect(Math.abs(abbe(g) - d.vd!)).toBeLessThan(0.05);
    }
  });
  it('gives textbook indices for silica, diamond, water and sapphire', () => {
    expect(glassIndex('silica', 587.56)).toBeCloseTo(1.4585, 3);
    expect(glassIndex('diamond', 589.3)).toBeCloseTo(2.417, 2);
    expect(glassIndex('water', 589.3)).toBeCloseTo(1.333, 3);
    expect(glassIndex('sapphire', 589.3)).toBeCloseTo(1.768, 2);
  });
  it('has normal dispersion everywhere in range', () => {
    for (const g of Object.keys(GLASSES) as GlassName[]) {
      for (let l = LAM0; l < LAM1; l += 10) expect(glassIndex(g, l)).toBeGreaterThan(glassIndex(g, l + 10));
    }
  });
});

describe('metals', () => {
  it('gold and copper reflect red more than blue, silver and aluminium are bright', () => {
    expect(metalReflectance('gold', 650)).toBeGreaterThan(0.9);
    expect(metalReflectance('gold', 450)).toBeLessThan(0.5);
    expect(metalReflectance('copper', 650)).toBeGreaterThan(0.9);
    expect(metalReflectance('copper', 500)).toBeLessThan(0.7);
    expect(metalReflectance('silver', 550)).toBeGreaterThan(0.95);
    expect(metalReflectance('aluminium', 550)).toBeGreaterThan(0.85);
  });
});

describe('sRGB reflectance', () => {
  it('stays within [0, 1] and reproduces the colour under D65', () => {
    const d65 = lightSpectrum({ kind: 'd65' });
    for (const c of [[1, 1, 1], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.8, 0.5, 0.2], [0.2, 0.6, 0.9], [0.5, 0.5, 0.5]] as [number, number, number][]) {
      const r = reflectance(c);
      const lit = new Float32Array(NS);
      for (let i = 0; i < NS; i++) {
        expect(r[i]).toBeGreaterThanOrEqual(-1e-5);
        expect(r[i]).toBeLessThanOrEqual(1 + 1e-5);
        lit[i] = r[i]! * d65[i]!;
      }
      const rgb = xyzToLinearRgb(toXYZ(lit));
      for (let k = 0; k < 3; k++) expect(rgb[k]).toBeCloseTo(srgbToLinear(c[k]!), 2);
    }
  });
});

describe('wavelength sampler', () => {
  it('is monotonic and spans the range', () => {
    for (const d of [{ kind: 'blackbody', kelvin: 2700 }, { kind: 'gas', gas: 'Hg' }, { kind: 'laser', nm: 532 }] as const) {
      const t = wavelengthTable(lightSpectrum(d));
      expect(t.length).toBe(NL + 1);
      expect(t[0]).toBe(LAM0);
      expect(t[NL]).toBe(LAM1);
      for (let k = 1; k <= NL; k++) expect(t[k]!).toBeGreaterThan(t[k - 1]!);
    }
  });
  it('puts most samples on the line of a laser', () => {
    const t = wavelengthTable(lightSpectrum({ kind: 'laser', nm: 532 }));
    let near = 0;
    for (let k = 0; k < NL; k++) if (Math.abs(0.5 * (t[k]! + t[k + 1]!) - 532) < 1) near++;
    expect(near / NL).toBeGreaterThan(0.8);
  });
  it('gives an unbiased estimate of the XYZ of a line spectrum', () => {
    const s = lightSpectrum({ kind: 'gas', gas: 'He' });
    const t = wavelengthTable(s);
    const at = (sp: Float32Array, lam: number) => {
      const x = (lam - LAM0) / DLAM;
      const i = Math.min(NS - 2, Math.floor(x));
      return sp[i]! * (1 - (x - i)) + sp[i + 1]! * (x - i);
    };
    const est = [0, 0, 0];
    const M = 400000;
    for (let j = 0; j < M; j++) {
      const x = ((j + 0.5) / M) * NL;
      const k = Math.floor(x);
      const lam = t[k]! + (t[k + 1]! - t[k]!) * (x - k);
      const inv = NL * (t[k + 1]! - t[k]!);
      for (let c = 0; c < 3; c++) est[c]! += (at(s, lam) * at(CMF[c]!, lam) * inv) / M;
    }
    const exact = toXYZ(s);
    for (let c = 0; c < 3; c++) expect(est[c]! / exact[c]!).toBeCloseTo(1, 2);
  });
});

describe('white balance', () => {
  it('renders a blackbody at the set temperature as neutral', () => {
    for (const k of [2700, 5000, 6500]) {
      const m = cameraMatrix(k);
      const w = blackbodyXYZ(k);
      const rgb = [0, 1, 2].map((r) => m[r * 3]! * w[0] + m[r * 3 + 1]! * w[1] + m[r * 3 + 2]! * w[2]);
      expect(rgb[0]! / rgb[1]!).toBeCloseTo(1, 3);
      expect(rgb[2]! / rgb[1]!).toBeCloseTo(1, 3);
    }
  });
});
