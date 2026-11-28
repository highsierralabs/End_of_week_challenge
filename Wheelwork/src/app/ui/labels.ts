// Tooth counts written beside the gearbox wheels when the case is open: the machine is its tooth
// counts, so they should be readable off it.
import { DESIGN } from '../../core/machine/design';
import { type Wheel } from '../../core/machine/layout';
import { type App } from './app';
import { h } from './dom';

interface Tag {
  el: HTMLElement;
  wheel: Wheel;
  x: number;
  y: number;
  shown: boolean;
}

export class ToothLabels {
  readonly el: HTMLElement;
  private tags: Tag[] = [];
  private builtFor = '';
  on = true;

  constructor(private app: App) {
    this.el = h('div.toothlabels', { 'aria-hidden': 'true' });
  }

  private rebuild(): void {
    this.el.replaceChildren();
    this.tags = [];
    for (const w of this.app.model.layout.wheels) {
      if (w.tellurion) continue;
      const el = h('span', null, h('b', null, w.role.toUpperCase()), String(w.teeth));
      el.style.display = 'none';
      this.el.append(el);
      this.tags.push({ el, wheel: w, x: -1, y: -1, shown: false });
    }
  }

  frame(): void {
    const { stage, model } = this.app;
    let visible = this.on && stage.caseOpen > 0.7 && stage.lamp < 0.5;
    const key = model.layout.wheels.map((w) => w.teeth).join(',');
    if (key !== this.builtFor) { this.builtFor = key; this.rebuild(); }
    const width = stage.canvas.clientWidth;
    const height = stage.canvas.clientHeight;
    const selected = this.app.selectedTrain;
    const [rx, ry] = stage.screenRight();
    const [ix, iy] = [DESIGN.centreDistance * Math.cos(DESIGN.idlerAngle), DESIGN.centreDistance * Math.sin(DESIGN.idlerAngle)];
    if (visible) {
      // On each side there is one tag to a level. Where the levels stand closer on screen than a tag
      // is tall (a small window, a distant camera) the tags would lie on each other: show none.
      const low = this.tags.find((t) => t.wheel.level === 1);
      const high = this.tags.find((t) => t.wheel.level === 2);
      const a = low && stage.project(0, 0, low.wheel.z + stage.liftOf(low.wheel.id));
      const b = high && stage.project(0, 0, high.wheel.z + stage.liftOf(high.wheel.id));
      if (!a || !b || Math.abs(a.y - b.y) < 15) visible = false;
    }
    for (const t of this.tags) {
      let p: { x: number; y: number } | null = null;
      if (visible) {
        const w = t.wheel;
        // Each wheel is tagged at its edge as the viewer sees it: central wheels on the left, cluster wheels on the right.
        const out = w.tipRadius + 2;
        const z = w.z + w.face / 2 + stage.liftOf(w.id);
        p = w.axis === 'centre' ? stage.project(-rx * out, -ry * out, z) : stage.project(ix + rx * out, iy + ry * out, z);
        if (p && (p.x < 4 || p.y < 4 || p.x > width - 4 || p.y > height - 4)) p = null;
      }
      if (!p) {
        if (t.shown) { t.el.style.display = 'none'; t.shown = false; }
        continue;
      }
      if (!t.shown) { t.el.style.display = ''; t.shown = true; }
      if (Math.abs(p.x - t.x) > 0.4 || Math.abs(p.y - t.y) > 0.4) {
        t.x = p.x;
        t.y = p.y;
        t.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(${t.wheel.axis === 'centre' ? '-100%' : '0'}, -50%)`;
      }
      t.el.classList.toggle('sel', t.wheel.train === selected);
    }
  }
}
