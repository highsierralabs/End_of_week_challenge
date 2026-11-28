// The app's controller and its chrome: the header with the date, the view buttons, the transport
// with the crank, the drawer of panels, and the pointer's dealings with the machine itself.
import { calendarFromJd, formatDate, jdFromCalendar } from '../../core/astro/time';
import { type Wheel } from '../../core/machine/layout';
import { bevelSeat, type Part, trainName } from '../../core/machine/parts';
import { type TrainId } from '../../core/machine/spec';
import { type Model } from '../model';
import { type Stage, type ViewName } from '../view/stage';
import { clear, fmt, h } from './dom';
import { AboutPanel } from './about';
import { PrintPanel } from './print';
import { SkyPanel } from './sky';
import { TourPanel } from './tour';
import { WorkbenchPanel } from './workbench';

export type TabName = 'tour' | 'sky' | 'workbench' | 'print' | 'about';

export interface Panel {
  el: HTMLElement;
  /** Called when the panel is shown and whenever what it shows may have changed. */
  update(): void;
}

const SPEEDS: { label: string; days: number }[] = [
  { label: 'a day a second', days: 1 },
  { label: 'a week a second', days: 7 },
  { label: 'a month a second', days: 30.4375 },
  { label: 'a year a second', days: 365.25 },
  { label: 'ten years a second', days: 3652.5 },
  { label: 'a century a second', days: 36525 },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const VIEWS: { id: ViewName; label: string; title: string }[] = [
  { id: 'whole', label: 'Whole', title: 'The whole instrument' },
  { id: 'train', label: 'Wheelwork', title: 'Open the case and look at the gear train' },
  { id: 'exploded', label: 'Exploded', title: 'Lift every level apart' },
  { id: 'tellurion', label: 'Earth and Moon', title: 'Follow the Earth and Moon' },
  { id: 'above', label: 'From above', title: 'Look down on the calendar' },
];

export class App {
  selectedTrain: TrainId | null = null;
  /** Machine days per second while running (signed); 0 when stopped. */
  rate = 0;
  speedIndex = 2;
  direction = 1;
  private glide: { from: number; to: number; t: number; duration: number } | null = null;
  private tabs = new Map<TabName, Panel>();
  tab: TabName = 'tour';
  private drawer!: HTMLElement;
  private drawerBody!: HTMLElement;
  private tabButtons = new Map<TabName, HTMLButtonElement>();
  private viewButtons = new Map<ViewName, HTMLButtonElement>();
  private dateEl!: HTMLElement;
  private sinceEl!: HTMLElement;
  private playButton!: HTMLButtonElement;
  private lampButton!: HTMLButtonElement;
  private caseButton!: HTMLButtonElement;
  private speedSelect!: HTMLSelectElement;
  private crankDial!: SVGElement | HTMLElement;
  private tooltip!: HTMLElement;
  private lastRefresh = 0;
  private dirty = true;
  private drag: { kind: 'crank3d' | 'dial'; lastAngle: number; cx: number; cy: number; sign: number } | null = null;
  readonly tour: TourPanel;

  constructor(readonly root: HTMLElement, readonly model: Model, readonly stage: Stage) {
    this.build();
    this.tour = new TourPanel(this);
    this.tabs.set('tour', this.tour);
    this.tabs.set('sky', new SkyPanel(this));
    this.tabs.set('workbench', new WorkbenchPanel(this));
    this.tabs.set('print', new PrintPanel(this));
    this.tabs.set('about', new AboutPanel(this));
    model.on('spec', () => { this.dirty = true; });
    model.on('setting', () => { this.dirty = true; });
    model.on('time', () => { this.dirty = true; });
    this.bindCanvas();
    this.bindKeys();
    this.showTab('tour');
  }

  // ---------------------------------------------------------------- chrome

  private build(): void {
    const brand = h('header.brand', null,
      h('h1', null, 'Wheelwork'),
      h('p.tagline', null, 'A clockwork orrery. Every motion is counted in teeth.'),
      this.dateEl = h('div.date', { 'aria-live': 'off' }),
      this.sinceEl = h('div.since'),
    );

    const views = h('nav.views', { 'aria-label': 'Views' });
    for (const v of VIEWS) {
      const b = h('button', { type: 'button', title: v.title, onclick: () => this.setView(v.id) }, v.label);
      this.viewButtons.set(v.id, b);
      views.append(b);
    }
    views.append(h('span.sep'));
    this.caseButton = h('button', { type: 'button', title: 'Open or close the walnut case', 'aria-pressed': 'false', onclick: () => this.setCase(this.stage.caseTarget < 0.5) }, 'Case');
    this.lampButton = h('button', { type: 'button', title: 'Put out the room lights and light the Sun', 'aria-pressed': 'false', onclick: () => this.setLamp(this.stage.lampTarget < 0.5) }, 'Sun lamp');
    views.append(this.caseButton, this.lampButton);

    // Transport.
    this.playButton = h('button.play', { type: 'button', title: 'Run or stop the machine (space)', onclick: () => this.toggle() });
    this.speedSelect = h('select', { title: 'How fast the machine runs', 'aria-label': 'Speed', onchange: () => { this.speedIndex = this.speedSelect.selectedIndex; if (this.rate !== 0) this.play(); } },
      SPEEDS.map((s, i) => h('option', { value: i, selected: i === this.speedIndex }, s.label)));
    const back = h('button', { type: 'button', title: 'Run backwards', 'aria-pressed': 'false', onclick: () => { this.direction = -this.direction; back.setAttribute('aria-pressed', String(this.direction < 0)); if (this.rate !== 0) this.play(); } }, 'Backwards');
    const day = h('input', { type: 'number', min: 1, max: 31, 'aria-label': 'Day', class: 'day' });
    const month = h('select', { 'aria-label': 'Month' }, MONTHS.map((m, i) => h('option', { value: i + 1 }, m)));
    const year = h('input', { type: 'number', min: -2999, max: 3000, 'aria-label': 'Year (negative for BC)', class: 'year', title: 'Year; 0 is 1 BC, -43 is 44 BC' });
    const fillDate = () => {
      const c = calendarFromJd(this.model.jd);
      day.value = String(c.day); month.value = String(c.month); year.value = String(c.year);
    };
    fillDate();
    const go = () => {
      const y = Math.max(-2999, Math.min(3000, Math.round(Number(year.value) || 0)));
      const jd = jdFromCalendar(y, Number(month.value), Math.max(1, Math.min(31, Number(day.value) || 1)));
      this.glideTo(jd);
    };
    const goForm = h('form.goto', { onsubmit: (e: Event) => { e.preventDefault(); go(); } },
      h('span.label', null, 'Turn to'), day, month, year, h('button', { type: 'submit', title: 'Turn the crank until the machine shows this date' }, 'Go'));
    const today = h('button', { type: 'button', title: 'Turn back to the date the machine was set on', onclick: () => this.glideTo(this.model.setJd) }, 'Set date');
    const reset = h('button', { type: 'button', title: 'Set every arm afresh to its place in the sky on the date shown', onclick: () => { this.stop(); this.model.resetTo(this.model.jd); fillDate(); } }, 'Re-set here');
    this.crankDial = this.buildDial();
    const transport = h('footer.transport', null,
      h('div.row', null, this.crankDial, this.playButton, this.speedSelect, back),
      h('div.row', null, goForm, today, reset),
    );
    this.fillDate = fillDate;

    // Drawer.
    const tabBar = h('div.tabs', { role: 'tablist' });
    const names: [TabName, string][] = [['tour', 'Tour'], ['sky', 'Sky'], ['workbench', 'Workbench'], ['print', 'Print'], ['about', 'About']];
    for (const [id, label] of names) {
      const b = h('button', { type: 'button', role: 'tab', onclick: () => this.showTab(id) }, label);
      this.tabButtons.set(id, b);
      tabBar.append(b);
    }
    const collapse = h('button.collapse', { type: 'button', title: 'Hide or show this panel', 'aria-expanded': 'true', onclick: () => {
      const closed = this.drawer.classList.toggle('closed');
      collapse.setAttribute('aria-expanded', String(!closed));
      collapse.textContent = closed ? 'Show' : 'Hide';
      this.layout();
    } }, 'Hide');
    this.drawerBody = h('div.body', { role: 'tabpanel' });
    this.drawer = h('aside.drawer', null, h('div.bar', null, tabBar, collapse), this.drawerBody);

    this.tooltip = h('div.tooltip', { role: 'status' });
    this.root.append(brand, views, transport, this.drawer, this.tooltip);
    this.syncPlay();
    this.syncButtons();
  }

  private fillDate: () => void = () => {};

  private buildDial(): HTMLElement {
    const dial = h('div.dial', { title: 'The crank: drag it round', role: 'slider', 'aria-label': 'Crank', tabindex: 0 }, h('div.arm', null, h('div.knob')));
    const angleOf = (e: PointerEvent) => {
      const r = dial.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    dial.addEventListener('pointerdown', (e) => {
      dial.setPointerCapture(e.pointerId);
      this.stop();
      this.drag = { kind: 'dial', lastAngle: angleOf(e), cx: 0, cy: 0, sign: 1 };
      e.preventDefault();
    });
    dial.addEventListener('pointermove', (e) => {
      if (this.drag?.kind !== 'dial') return;
      const a = angleOf(e);
      let d = a - this.drag.lastAngle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      this.drag.lastAngle = a;
      // Clockwise on the dial (increasing screen angle) runs the machine forwards.
      this.model.setTurns(this.model.turns + d / (2 * Math.PI));
    });
    const end = () => { if (this.drag?.kind === 'dial') this.drag = null; };
    dial.addEventListener('pointerup', end);
    dial.addEventListener('pointercancel', end);
    dial.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { this.nudge(1 / 12); e.preventDefault(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { this.nudge(-1 / 12); e.preventDefault(); }
    });
    return dial;
  }

  // ---------------------------------------------------------------- actions

  showTab(name: TabName): void {
    this.tab = name;
    for (const [id, b] of this.tabButtons) b.setAttribute('aria-selected', String(id === name));
    clear(this.drawerBody);
    const panel = this.tabs.get(name)!;
    this.drawerBody.append(panel.el);
    this.drawerBody.scrollTop = 0;
    panel.update();
    if (this.drawer.classList.contains('closed')) {
      this.drawer.classList.remove('closed');
      const c = this.drawer.querySelector('.collapse');
      if (c) { c.textContent = 'Hide'; c.setAttribute('aria-expanded', 'true'); }
      this.layout();
    }
  }

  /** Tell the stage how much of the window the drawer covers, so the machine sits in what is left. */
  layout(): void {
    const closed = this.drawer.classList.contains('closed');
    document.body.classList.toggle('sheet-closed', closed);
    const sheet = matchMedia('(max-width: 820px)').matches;
    const r = this.drawer.getBoundingClientRect();
    if (sheet) this.stage.setInset(0, closed ? 42 : r.height);
    else this.stage.setInset(closed ? 0 : r.width, 0);
  }

  setView(name: ViewName, seconds?: number): void {
    this.stage.setView(name, seconds);
    this.syncButtons();
  }

  setCase(open: boolean): void {
    this.stage.caseTarget = open ? 1 : 0;
    this.syncButtons();
  }

  setLamp(on: boolean): void {
    this.stage.lampTarget = on ? 1 : 0;
    this.syncButtons();
  }

  private syncButtons(): void {
    for (const [id, b] of this.viewButtons) b.setAttribute('aria-pressed', String(id === this.stage.view));
    this.caseButton.setAttribute('aria-pressed', String(this.stage.caseTarget > 0.5));
    this.lampButton.setAttribute('aria-pressed', String(this.stage.lampTarget > 0.5));
  }

  play(index: number = this.speedIndex, direction: number = this.direction): void {
    this.speedIndex = index;
    this.direction = direction;
    this.speedSelect.selectedIndex = index;
    this.rate = SPEEDS[index]!.days * direction;
    this.glide = null;
    this.syncPlay();
  }

  stop(): void {
    this.rate = 0;
    this.glide = null;
    this.syncPlay();
  }

  toggle(): void {
    if (this.rate !== 0 || this.glide) this.stop(); else this.play();
  }

  private syncPlay(): void {
    const running = this.rate !== 0;
    this.playButton.textContent = running ? 'Stop' : 'Run';
    this.playButton.setAttribute('aria-pressed', String(running));
  }

  /** Turn the crank by a fraction of a turn. */
  nudge(turns: number): void {
    this.stop();
    this.model.setTurns(this.model.turns + turns);
  }

  /** Run the machine smoothly to a date. */
  glideTo(jd: number, seconds = 2.6): void {
    this.rate = 0;
    this.syncPlay();
    const to = (jd - this.model.setJd) / this.model.daysPerTurn;
    this.glide = { from: this.model.turns, to, t: 0, duration: seconds };
  }

  selectTrain(id: TrainId | null, open = true): void {
    this.selectedTrain = id;
    this.stage.setSelected(id ? this.model.layout.wheels.filter((w) => w.train === id).map((w) => w.id) : []);
    if (open && id) this.showTab('workbench');
    else this.tabs.get(this.tab)!.update();
  }

  // ---------------------------------------------------------------- the frame

  frame(dt: number, now: number): void {
    if (this.glide) {
      const g = this.glide;
      g.t = Math.min(1, g.t + dt / g.duration);
      const s = g.t * g.t * g.t * (g.t * (g.t * 6 - 15) + 10);
      this.model.setTurns(g.from + (g.to - g.from) * s);
      if (g.t >= 1) this.glide = null;
    } else if (this.rate !== 0) {
      this.model.setTurns(this.model.turns + (this.rate / this.model.daysPerTurn) * dt);
      // Stay inside the span the reference astronomy covers.
      const c = calendarFromJd(this.model.jd);
      if (c.year < -2999 || c.year > 3000) this.stop();
    }
    this.stage.frame(dt);
    if (this.dirty && now - this.lastRefresh > 90) {
      this.lastRefresh = now;
      this.dirty = false;
      this.refresh();
    }
  }

  private refresh(): void {
    const m = this.model;
    this.dateEl.textContent = formatDate(m.jd);
    const turns = m.turns;
    const days = m.jd - m.setJd;
    const years = Math.abs(days) / 365.25;
    const span = years >= 2 ? `${fmt(years, years >= 100 ? 0 : 1)} years` : `${fmt(Math.abs(days), 0)} days`;
    this.sinceEl.textContent = Math.abs(turns) < 1e-9
      ? `Set on this date. One turn of the crank is ${fmt(m.daysPerTurn, 2)} days.`
      : `${span} ${days >= 0 ? 'after' : 'before'} it was set on ${formatDate(m.setJd)}: ${fmt(Math.abs(turns), Math.abs(turns) < 100 ? 1 : 0)} turns of the crank.`;
    const crank = this.model.pose().crankAngle;
    (this.crankDial.firstElementChild as HTMLElement).style.transform = `rotate(${(-crank * 180) / Math.PI}deg)`;
    if (this.rate === 0 && !this.glide && document.activeElement?.closest?.('.goto') === null) this.fillDate();
    if (!this.drawer.classList.contains('closed')) this.tabs.get(this.tab)!.update();
  }

  // ---------------------------------------------------------------- pointer and keys

  /** What the tooltip says about a part. */
  describe(part: Part): string {
    const w = part.wheel ? this.model.layout.byId.get(part.wheel) : undefined;
    if (w) return `${part.name}. ${this.wheelNote(w)}`;
    const notes: Record<string, string> = {
      sun: 'Sun. It stands still; the lamp inside can be lit.',
      moonBall: `Moon. ${this.model.reading().moon.phase}.`,
      nodeRing: "Inclined ring. The Moon's stalk rides on it, lifting the Moon above and below the ecliptic. The ring turns slowly backwards.",
      deck: 'Deck plate. The inner ring is the calendar, read against the Earth; the outer ring is the zodiac.',
      crankHandle: 'Crank. Drag it round.', crankArm: 'Crank. Drag it round.',
      bevelWheel: `Crank wheel. ${this.model.spec.bevel.mercury} teeth, on Mercury's tube.`,
      bevelPinion: `Crank pinion. ${this.model.spec.bevel.crank} teeth.`,
      fixedTube: "Fixed tube. It does not turn: the wheels on it give the Earth's axis and the Moon's nodes something still to work against.",
      bridge: 'Bridge. It holds the fixed tube.',
    };
    return notes[part.id] ?? `${part.name}.`;
  }

  private wheelNote(w: Wheel): string {
    const rate = this.model.rates.value[w.body];
    const mate = this.model.layout.byId.get(w.mate)!;
    const period = rate === 0 ? 'It does not turn.' : `It turns once in ${periodText(this.model.daysPerTurn / Math.abs(rate))}${rate < 0 ? ', backwards' : ''}.`;
    return `Module ${fmt(w.module, 2)} mm, meshing with ${mate.teeth} teeth in the ${trainName(w.train)} train. ${period}`;
  }

  private bindCanvas(): void {
    const canvas = this.stage.canvas;
    let down: { x: number; y: number; part: Part | null } | null = null;
    let lastPick = 0;
    const isCrank = (p: Part | null) => !!p && (p.id === 'crankHandle' || p.id === 'crankArm' || p.id === 'crankCollar');

    canvas.addEventListener('pointerdown', (e) => {
      const part = this.stage.pick(e.clientX, e.clientY);
      down = { x: e.clientX, y: e.clientY, part };
      if (isCrank(part)) {
        // Turn the crank about its shaft as it appears on screen.
        const end = this.crankEndOnScreen();
        if (end) {
          this.stop();
          this.stage.controls.enabled = false;
          canvas.setPointerCapture(e.pointerId);
          this.drag = { kind: 'crank3d', lastAngle: Math.atan2(e.clientY - end.y, e.clientX - end.x), cx: end.x, cy: end.y, sign: end.sign };
          e.stopPropagation();
        }
      }
    }, { capture: true });

    canvas.addEventListener('pointermove', (e) => {
      if (this.drag?.kind === 'crank3d') {
        const a = Math.atan2(e.clientY - this.drag.cy, e.clientX - this.drag.cx);
        let d = a - this.drag.lastAngle;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        this.drag.lastAngle = a;
        this.model.setTurns(this.model.turns + (this.drag.sign * d) / (2 * Math.PI));
        return;
      }
      if (e.buttons !== 0 || e.pointerType === 'touch') { this.hideTooltip(); return; }
      const now = performance.now();
      if (now - lastPick < 40) return;
      lastPick = now;
      const part = this.stage.pick(e.clientX, e.clientY);
      this.stage.setHover(part ? part.id : null);
      canvas.style.cursor = isCrank(part) ? 'grab' : part?.wheel ? 'pointer' : '';
      if (part) this.showTooltip(this.describe(part), e.clientX, e.clientY); else this.hideTooltip();
    });

    const up = (e: PointerEvent) => {
      if (this.drag?.kind === 'crank3d') {
        this.drag = null;
        this.stage.controls.enabled = true;
        down = null;
        return;
      }
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const part = down.part;
        const w = part?.wheel ? this.model.layout.byId.get(part.wheel) : undefined;
        if (w) this.selectTrain(w.train);
        else if (part && e.pointerType === 'touch') this.showTooltip(this.describe(part), e.clientX, e.clientY);
        else if (!part) this.selectTrain(null, false);
      }
      down = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { this.drag = null; this.stage.controls.enabled = true; down = null; });
    canvas.addEventListener('pointerleave', () => { this.stage.setHover(null); this.hideTooltip(); });
  }

  /** The crank shaft's outer end on screen, and which way a clockwise drag turns the machine. */
  private crankEndOnScreen(): { x: number; y: number; sign: number } | null {
    const f = this.model.pose().frame.crank;
    const at = (x: number): [number, number, number] => [f[0] * x + f[3], f[4] * x + f[7], f[8] * x + f[11]];
    const end = at(150);
    const p = this.stage.project(...end);
    if (!p) return null;
    const rect = this.stage.canvas.getBoundingClientRect();
    // Seen from outside (the shaft pointing at the viewer), the pose turns the crank by crankAngle
    // counter-clockwise; on screen, with y downwards, that is a decreasing angle.
    const cam = this.stage.camera.position;
    const axis: [number, number, number] = [f[0], f[4], f[8]];
    const towards = (cam.x - end[0]) * axis[0] + (cam.y - end[1]) * axis[1] + (cam.z - end[2]) * axis[2];
    const perTurn = bevelSeat(this.model.spec.bevel.crank, this.model.spec.bevel.mercury).ratio * this.model.rates.value.mercury;
    const sign = (towards >= 0 ? -1 : 1) * Math.sign(perTurn);
    return { x: rect.left + p.x, y: rect.top + p.y, sign };
  }

  private showTooltip(text: string, x: number, y: number): void {
    this.tooltip.textContent = text;
    this.tooltip.classList.add('on');
    const w = this.tooltip.offsetWidth;
    const hh = this.tooltip.offsetHeight;
    this.tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x + 16))}px`;
    this.tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - hh - 8, y + 18))}px`;
  }

  private hideTooltip(): void {
    this.tooltip.classList.remove('on');
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.classList.contains('dial'))) return;
      if (e.key === ' ') { this.toggle(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { this.nudge(e.shiftKey ? 1 : 1 / 12); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { this.nudge(e.shiftKey ? -1 : -1 / 12); e.preventDefault(); }
      else if (e.key === 'Escape') this.selectTrain(null, false);
    });
  }
}

/** A period in days, said the way a person would. */
export function periodText(days: number): string {
  if (days < 2) return `${fmt(days * 24, 1)} hours`;
  if (days < 800) return `${fmt(days, days < 100 ? 2 : 1)} days`;
  const years = days / 365.25;
  return `${fmt(years, years < 100 ? 2 : 0)} years`;
}
