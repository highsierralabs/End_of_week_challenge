// The spectroscope: a gas discharge tube seen through a grating or a prism held in front of
// the camera, so that each emission line makes its own image of the tube. A chart shows the
// lines the tube emits, and a quiz asks the visitor to name a lamp from its spectrum alone.
import type { GasName } from '../core/scene';
import { CMF, LAM0, LAM1, NS, glassIndex, lamAt, xyzToLinearRgb } from '../core/spectrum';
import { prismDeviation } from '../core/scenes';
import { GRATING_LINES, SPECTRO_GRATING, SPECTRO_HALF, SPECTRO_TUBE, spectroCamera, spectroscopeScene } from '../core/tourscenes';
import { objectTransform } from '../core/pack';
import { hitPolytope, shapePlanes } from '../core/shapes';
import { type Vec3, add, dot, invertAffine, mul, norm, sub, xformDir, xformPoint } from '../core/vec';
import { LINES } from '../data/optics';
import { button, clear, h } from './controls';
import type { Store } from './store';

const GASES: [GasName, string][] = [['H', 'Hydrogen'], ['He', 'Helium'], ['Ne', 'Neon'], ['Na', 'Sodium'], ['Ar', 'Argon'], ['Kr', 'Krypton'], ['Xe', 'Xenon'], ['Hg', 'Mercury']];

/** Display colour of a single wavelength, as CSS. */
export function wavelengthColour(nm: number, gain = 1): string {
  const i = Math.min(NS - 1, Math.max(0, Math.round(((nm - LAM0) / (LAM1 - LAM0)) * (NS - 1))));
  const xyz: [number, number, number] = [CMF[0][i]!, CMF[1][i]!, CMF[2][i]!];
  let rgb = xyzToLinearRgb(xyz);
  // Pull out-of-gamut colours toward grey of the same luminance, then normalise.
  const y = Math.max(1e-6, 0.2126729 * rgb[0] + 0.7151522 * rgb[1] + 0.072175 * rgb[2]);
  const lo = Math.min(...rgb);
  if (lo < 0) rgb = rgb.map((c) => y + (c - y) * (y / (y - lo))) as [number, number, number];
  const peak = Math.max(...rgb, 1e-6);
  const k = (gain * Math.min(1, 0.35 + 3 * (xyz[0] + xyz[1] + xyz[2]))) / peak;
  const enc = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c * k)) ** (1 / 2.2));
  return `rgb(${enc(rgb[0])},${enc(rgb[1])},${enc(rgb[2])})`;
}

export class Spectroscope {
  gas: GasName = 'Ne';
  disperser: 'grating' | 'prism' = 'grating';
  private mystery: GasName | null = null;
  private verdict = '';
  private verdictGood = false;
  private score = { right: 0, asked: 0 };
  private guessed = false;
  private timer = 0;
  private active = false;

  /** Picture position of a world point; set by the app. */
  project: ((p: Vec3) => { x: number; y: number } | null) | null = null;

  constructor(private readonly root: HTMLElement, private readonly store: Store) {}

  async enter(): Promise<void> {
    this.active = true;
    await this.reload();
  }

  /** The visitor left the mode: stop anything still pending. */
  leave(): void {
    this.active = false;
    clearTimeout(this.timer);
    this.verdictGood = false;
  }

  private aspect(): number {
    const t = this.store.view.tracer;
    return t.width / Math.max(1, t.height);
  }

  /** The picture changed shape: refit the lens so the whole spectrum stays in it. */
  fit(): void {
    if (!this.active || !this.store.scene) return;
    Object.assign(this.store.scene.camera, spectroCamera(this.disperser, this.aspect()));
    this.store.cameraChanged();
  }

  /**
   * A world point in the direction where the tube's lower end appears in light of one
   * wavelength. Both dispersers leave the direction's vertical component unchanged.
   */
  private imagePoint(nm: number): Vec3 | null {
    const cam = this.store.scene.camera.pos;
    const dy = -SPECTRO_HALF / Math.hypot(SPECTRO_TUBE, SPECTRO_HALF);
    if (this.disperser === 'grating') {
      // The grating equation, corrected for the grating standing a little in front of the lens.
      const s = (nm * GRATING_LINES) / 1e6;
      let dx = s;
      for (let i = 0; i < 6; i++) dx = s - (SPECTRO_GRATING * dx) / Math.sqrt(Math.max(1e-6, 1 - dx * dx)) / (SPECTRO_TUBE - SPECTRO_GRATING);
      return [cam[0] + dx, cam[1] + dy, cam[2] - Math.sqrt(Math.max(1e-6, 1 - dx * dx - dy * dy))];
    }
    return this.prismImage(nm, [-SPECTRO_TUBE, cam[1] - SPECTRO_HALF, 0]);
  }

  /**
   * The direction in which the camera sees a point through the prism in light of one
   * wavelength, found by tracing rays from the lens through the prism and adjusting the aim
   * (Newton's method) until the ray passes through the point. Returns a world point one metre
   * along that direction, or null if no such ray exists.
   */
  private prismImage(nm: number, target: Vec3): Vec3 | null {
    const prism = this.store.scene.objects.find((o) => o.shape.kind === 'prism');
    if (!prism || prism.material.kind !== 'glass') return null;
    const planes = shapePlanes(prism.shape)!;
    const fwd = objectTransform(prism);
    const inv = invertAffine(fwd);
    const n = glassIndex(prism.material.glass, nm);
    const cam = this.store.scene.camera.pos;
    const refract = (d: Vec3, nrm: Vec3, eta: number): Vec3 | null => {
      const ci = -dot(d, nrm);
      const s2 = eta * eta * (1 - ci * ci);
      if (s2 >= 1) return null;
      return norm(add(mul(d, eta), mul(nrm, eta * ci - Math.sqrt(1 - s2))));
    };
    // Miss vector at the target for a ray leaving the lens along d.
    const miss = (d: Vec3): Vec3 | null => {
      const o = xformPoint(inv, cam);
      const dl = norm(xformDir(inv, d));
      const h1 = hitPolytope(planes, o, dl, 1e-9);
      if (!h1) return null;
      const d1 = refract(dl, h1.n, 1 / n);
      if (!d1) return null;
      const p1 = add(o, mul(dl, h1.t));
      const h2 = hitPolytope(planes, p1, d1, 1e-7);
      if (!h2) return null;
      const d2 = refract(d1, mul(h2.n, -1), n);
      if (!d2) return null;
      const p2 = xformPoint(fwd, add(p1, mul(d1, h2.t)));
      const dw = norm(xformDir(fwd, d2));
      const to = sub(target, p2);
      return sub(add(p2, mul(dw, dot(to, dw))), target);
    };
    const dev = prismDeviation(nm);
    let d: Vec3 = norm([-Math.cos(dev), 0, Math.sin(dev)]);
    const side: Vec3 = norm([d[2], 0, -d[0]]);
    const up: Vec3 = [0, 1, 0];
    let a = 0;
    let b = -SPECTRO_HALF / SPECTRO_TUBE;
    const aim = (x: number, y: number): Vec3 => norm(add(d, add(mul(side, x), mul(up, y))));
    const base = d;
    d = base;
    for (let it = 0; it < 12; it++) {
      const e0 = miss(aim(a, b));
      const ea = miss(aim(a + 1e-4, b));
      const eb = miss(aim(a, b + 1e-4));
      if (!e0 || !ea || !eb) return null;
      // Two components of the miss: vertical, and horizontal across the line of sight.
      const f = (e: Vec3): [number, number] => [e[1], dot(e, side)];
      const [f0, fa, fb] = [f(e0), f(ea), f(eb)];
      const j = [(fa[0] - f0[0]) / 1e-4, (fb[0] - f0[0]) / 1e-4, (fa[1] - f0[1]) / 1e-4, (fb[1] - f0[1]) / 1e-4];
      const det = j[0]! * j[3]! - j[1]! * j[2]!;
      if (Math.abs(det) < 1e-12) return null;
      a -= (j[3]! * f0[0] - j[1]! * f0[1]) / det;
      b -= (-j[2]! * f0[0] + j[0]! * f0[1]) / det;
      if (Math.hypot(f0[0], f0[1]) < 1e-7) break;
    }
    return add(cam, aim(a, b));
  }

  /** Draw the wavelength scale under the spectrum. */
  ruler = (g: CanvasRenderingContext2D): void => {
    if (!this.project) return;
    g.save();
    g.strokeStyle = 'rgba(236,233,226,0.8)';
    g.fillStyle = 'rgba(236,233,226,0.85)';
    g.lineWidth = 1;
    g.font = '11px ui-monospace, Menlo, Consolas, monospace';
    g.textAlign = 'center';
    let lastLabel = -1e9;
    for (let nm = 400; nm <= 720; nm += 10) {
      const q = this.imagePoint(nm);
      const p = q && this.project(q);
      if (!p) continue;
      const major = nm % 50 === 0;
      const y = p.y + 6;
      g.beginPath();
      g.moveTo(Math.round(p.x) + 0.5, y);
      g.lineTo(Math.round(p.x) + 0.5, y + (major ? 9 : 4));
      g.stroke();
      // Where the scale is cramped (the prism's red end on a narrow screen) skip labels.
      if (major && Math.abs(p.x - lastLabel) >= 30) { g.fillText(String(nm), p.x, y + 22); lastLabel = p.x; }
    }
    const endPoint = this.imagePoint(this.disperser === 'grating' ? 715 : 450);
    const end = endPoint && this.project(endPoint);
    if (end) { g.textAlign = this.disperser === 'grating' ? 'left' : 'right'; g.fillStyle = 'rgba(154,150,140,0.9)'; g.fillText(this.disperser === 'grating' ? '  nm' : 'nm  ', end.x + (this.disperser === 'grating' ? 8 : -8), end.y + 36); }
    g.restore();
  };

  private async reload(): Promise<void> {
    this.render();
    await this.store.load(spectroscopeScene(this.mystery ?? this.gas, this.disperser, this.aspect()));
  }

  private chart(gas: GasName): HTMLCanvasElement {
    const c = h('canvas', { class: 'lb-chart', width: 600, height: 300, role: 'img', 'aria-label': `Emission lines of ${gas}` });
    const g = c.getContext('2d')!;
    const x = (nm: number) => 20 + ((nm - 380) / 370) * 560;
    g.fillStyle = '#050506';
    g.fillRect(0, 0, 600, 300);
    // A faint continuous spectrum along the bottom as the wavelength scale.
    for (let i = 0; i < NS; i += 2) { g.fillStyle = wavelengthColour(lamAt(i), 0.75); g.fillRect(x(lamAt(i)), 262, 1.4, 10); }
    g.fillStyle = '#9a968c';
    g.font = '18px ui-monospace, Menlo, Consolas, monospace';
    g.textAlign = 'center';
    for (let nm = 400; nm <= 700; nm += 50) { g.fillRect(x(nm), 272, 1, 6); g.fillText(String(nm), x(nm), 296); }
    const lines = LINES[gas] ?? [];
    const max = Math.max(...lines.map((l) => l[1]));
    for (const [nm, p] of lines) {
      // Height on a compressed scale so weak lines stay visible.
      const hgt = 240 * Math.pow(p / max, 0.35);
      g.fillStyle = wavelengthColour(nm, 1);
      g.fillRect(x(nm) - 1.5, 256 - hgt, 3, hgt);
    }
    return c;
  }

  private gasButtons(onPick: (g: GasName) => void, current: GasName | null): HTMLElement {
    const grid = h('div', { class: 'lb-gases' });
    for (const [g, name] of GASES) {
      grid.append(h('button', { type: 'button', class: `lb-gas${g === current ? ' on' : ''}`, 'data-gas': g, onclick: () => onPick(g) }, h('b', { text: g }), h('span', { text: name })));
    }
    return grid;
  }

  private render(): void {
    clear(this.root);
    const quizzing = this.mystery !== null;
    this.root.append(h('h2', { text: 'Spectroscope' }));
    if (!quizzing) {
      // The strongest lines on the scale, with close pairs (the sodium doublet) shown once.
      const lines: [number, number][] = [];
      for (const l of (LINES[this.gas] ?? []).filter((x) => x[0] >= 400 && x[0] <= 700).sort((a, b) => b[1] - a[1])) {
        if (lines.length < 6 && !lines.some((k) => Math.abs(k[0] - l[0]) < 1)) lines.push(l);
      }
      lines.sort((a, b) => a[0] - b[0]);
      this.root.append(
        h('p', { text: this.disperser === 'grating'
          ? 'A thin tube of glowing gas, seen through a grating of 1,200 lines per millimetre held in front of the lens. The grating turns each wavelength through its own angle, so every emission line makes a separate image of the tube.'
          : 'A thin tube of glowing gas, seen through a 60\u00b0 prism of dense flint glass. Blue is bent more than red, so every emission line makes a separate image of the tube. A prism spreads the blue end more than the red, and the faint extra images are reflections inside it, as in a real one.' }),
        this.gasButtons((g) => { this.gas = g; void this.reload(); }, this.gas),
        this.chart(this.gas),
        h('p', { class: 'lb-lines', text: `Strongest lines: ${lines.map((l) => `${l[0].toFixed(1)}`).join(', ')} nm` }),
        h('div', { class: 'lb-tour-nav' },
          button(this.disperser === 'grating' ? 'Use a prism instead' : 'Use a grating instead', () => { this.disperser = this.disperser === 'grating' ? 'prism' : 'grating'; void this.reload(); }),
          button('Mystery lamp', () => { this.pickMystery(); }, 'primary')),
        h('p', { class: 'lb-note', text: 'Line positions are NIST’s measured wavelengths. Line strengths come from NIST transition probabilities and a single assumed excitation temperature, so they are approximate, most of all for krypton and xenon. The scale in the picture is computed, from the grating equation or by tracing rays through the prism.' }),
      );
    } else {
      this.root.append(
        h('p', { text: 'A lamp filled with one of the eight gases. Its spectrum is all you get. Which gas is it?' }),
        h('div', { class: 'lb-quiz' },
          this.gasButtons((g) => this.answer(g), null),
          h('p', { class: `lb-verdict ${this.verdict ? (this.verdictGood ? 'good' : 'bad') : ''}`, text: this.verdict || ' ' })),
        h('p', { class: 'lb-lines', text: this.score.asked ? `${this.score.right} of ${this.score.asked} lamps named at the first guess` : 'Hint: hydrogen has a few well-separated lines; sodium is nearly all one yellow line; neon crowds the red.' }),
        h('div', { class: 'lb-tour-nav' }, button('Back to the lamps', () => { this.mystery = null; this.verdict = ''; void this.reload(); })),
      );
    }
  }

  private pickMystery(): void {
    const pool = GASES.map((g) => g[0]).filter((g) => g !== this.mystery);
    this.mystery = pool[Math.floor(Math.random() * pool.length)]!;
    this.guessed = false;
    this.verdict = '';
    void this.reload();
  }

  private answer(g: GasName): void {
    if (!this.mystery || this.verdictGood) return;
    // A lamp counts once: right only if the first guess was.
    const name = (x: GasName) => GASES.find((p) => p[0] === x)![1].toLowerCase();
    if (!this.guessed) { this.score.asked++; if (g === this.mystery) this.score.right++; }
    this.guessed = true;
    if (g === this.mystery) {
      this.verdict = `Yes: ${name(g)}.`;
      this.verdictGood = true;
      this.render();
      this.gas = g;
      this.timer = window.setTimeout(() => { this.verdictGood = false; if (this.active && this.mystery !== null) this.pickMystery(); }, 1600);
    } else {
      this.verdict = `Not ${name(g)}. Look again.`;
      this.verdictGood = false;
      this.render();
    }
  }
}
