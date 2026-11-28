// The Workbench: change a wheel, see what it does to the sky, ask the solver for better.
import { CHAIN, type ChainMember } from '../../core/machine/design';
import { buildLayout } from '../../core/machine/layout';
import { trainName } from '../../core/machine/parts';
import {
  cloneSpec, DEFAULT_LIMITS, designMachine, driftPerCentury, encodeSpec, getTrain, type Limits, machineNodeDays, machinePeriods,
  nodeDriftPerCentury, nodeTargetRatio, setTrain, STEP_IDS, type Step, type StepId, stepMembers, stepTarget, TRAIN_IDS, type TrainId, trainRule,
} from '../../core/machine/spec';
import { bestPair, convergents } from '../../core/train/rational';
import { type Candidate, moduleFor, solveStep } from '../../core/train/solver';
import { DESIGN } from '../../core/machine/design';
import { DEFAULT_DRIFT_BUDGET, PHYSICAL_LIMITS } from '../model';
import { type App, type Panel, periodText } from './app';
import { clear, fmt, h, signed, svg } from './dom';

const MEMBER_NAMES: Record<ChainMember, string> = { mercury: 'Mercury', venus: 'Venus', month: 'the Moon', earth: 'the Earth', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn' };
const ROLES = ['a', 'b', 'c', 'd'] as const;

const BLURB: Record<TrainId, string> = {
  'mercury-venus': "Wheel A is on Mercury's tube, wheel D on Venus's. The cluster B-C turns freely on the idler post between them.",
  'venus-month': "From Venus's tube up to the month tube, which turns once a sidereal month and carries the Moon round the Earth. This train gears up.",
  'month-earth': "From the month tube down to the Earth's tube. Its ratio is the number of sidereal months in a year.",
  'earth-mars': "From the Earth's tube to Mars's.",
  'mars-jupiter': "From Mars's tube to Jupiter's: the largest step in the planets' chain.",
  'jupiter-saturn': "From Jupiter's tube to Saturn's.",
  tilt: "On the Earth's arm. Wheel A is fixed and does not turn; the train must be exactly one to one, so that the Earth's axis keeps pointing the same way as the arm carries it round the Sun.",
  node: "On the Earth's arm. Wheel A is fixed; a ratio a little off one to one makes the inclined ring creep backwards, once round in 18.6 years, as the Moon's nodes do.",
  moon: "On the Earth's arm. Wheel A is on the month tube; a one to one train hands its turning to the Moon's arm out at the Earth.",
};

export class WorkbenchPanel implements Panel {
  el: HTMLElement;
  private list: HTMLElement;
  private detail: HTMLElement;
  private summary: HTMLElement;
  private limits: Limits = { ...DEFAULT_LIMITS };
  private budget = DEFAULT_DRIFT_BUDGET;
  /** A train being edited that does not fit yet, kept here until it does. */
  private draft: { id: TrainId; step: Step } | null = null;
  private candidates: { id: TrainId; list: Candidate[] } | null = null;
  private lastKey = '';

  constructor(private app: App) {
    this.list = h('div.trainlist');
    this.detail = h('div.traindetail');
    this.summary = h('div.summary');
    this.el = h('section.panel.workbench', null,
      h('h2', null, 'Workbench'),
      h('p.lede', null, 'Nine trains of four wheels drive everything. Pick one here, or click any wheel on the machine, and change its teeth.'),
      this.list,
      this.detail,
      h('h3', null, 'What the whole machine does'),
      this.summary,
      this.designer(),
    );
  }

  private designer(): HTMLElement {
    const maxTeeth = h('input', { type: 'range', min: 30, max: 140, step: 2, value: this.limits.maxTeeth, 'aria-label': 'Most teeth on a wheel' });
    const maxOut = h('output', null, String(this.limits.maxTeeth));
    const minModule = h('input', { type: 'range', min: 0.6, max: 1.8, step: 0.05, value: this.limits.minModule, 'aria-label': 'Finest teeth (module, mm)' });
    const modOut = h('output', null, `${fmt(this.limits.minModule, 2)} mm`);
    const budget = h('select', { 'aria-label': 'Drift allowed' },
      [0, 0.1, 0.25, 0.5, 1, 2, 5, 20].map((v) => h('option', { value: v, selected: v === this.budget }, v === 0 ? 'as exact as possible' : `${v}° a century`)));
    const status = h('p.status', { role: 'status' });
    maxTeeth.addEventListener('input', () => { this.limits.maxTeeth = Number(maxTeeth.value); maxOut.textContent = maxTeeth.value; this.candidates = null; });
    minModule.addEventListener('input', () => { this.limits.minModule = Number(minModule.value); modOut.textContent = `${fmt(this.limits.minModule, 2)} mm`; this.candidates = null; });
    budget.addEventListener('change', () => { this.budget = Number(budget.value); });
    const redesign = h('button', { type: 'button', onclick: () => {
      try {
        const spec = designMachine(this.app.model.targets, { limits: this.limits, driftBudget: this.budget });
        this.draft = null;
        this.candidates = null;
        this.app.model.setSpec(spec);
        status.textContent = 'A new machine, designed to these limits.';
      } catch (e) {
        status.textContent = `No machine fits these limits: ${(e as Error).message}.`;
      }
      this.update(true);
    } }, 'Design a machine to these limits');
    const restore = h('button', { type: 'button', onclick: () => {
      this.draft = null;
      this.candidates = null;
      this.app.model.setSpec(this.app.model.original);
      status.textContent = 'The original machine is back.';
      this.update(true);
    } }, 'Restore the original');
    const link = h('button', { type: 'button', onclick: () => {
      const url = new URL(location.href);
      url.search = `?m=${encodeSpec(this.app.model.spec)}`;
      url.hash = '';
      void navigator.clipboard?.writeText(url.toString()).then(() => { status.textContent = 'Link copied.'; }, () => { status.textContent = url.toString(); });
      history.replaceState(null, '', url);
    } }, 'Copy a link to this machine');
    return h('div.designer', null,
      h('h3', null, 'Have the solver design one'),
      h('p', null, 'The designer settles the trains outwards from the Earth, which is the calendar, and for each one takes the coarsest teeth that hold the drift you allow. Coarse teeth are easier to cut, and to print.'),
      h('label', null, h('span', null, 'Most teeth on a wheel'), maxTeeth, maxOut),
      h('label', null, h('span', null, 'Finest teeth (module)'), minModule, modOut),
      h('label', null, h('span', null, 'Drift allowed'), budget),
      h('div.buttons', null, redesign, restore, link),
      status,
    );
  }

  update(force = false): void {
    const model = this.app.model;
    const selected = this.app.selectedTrain;
    // The panel does not depend on the date: rebuild only when the machine or the selection changes.
    const key = `${encodeSpec(model.spec)}|${selected}|${JSON.stringify(this.draft)}|${this.candidates?.id}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;

    clear(this.list);
    for (const id of TRAIN_IDS) {
      const s = getTrain(model.spec, id);
      this.list.append(h('button', { type: 'button', 'aria-pressed': String(id === selected), onclick: () => { this.draft = null; this.app.selectTrain(id === selected ? null : id); } },
        h('span.name', null, trainName(id)), h('span.teeth', null, `${s.a}:${s.b} × ${s.c}:${s.d}`)));
    }

    clear(this.detail);
    if (selected) this.detail.append(this.trainEditor(selected));
    else this.detail.append(h('p.hint', null, 'No train selected.'));

    clear(this.summary);
    const periods = machinePeriods(model.spec, model.targets);
    const t = h('table.readings');
    t.append(h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Machine'), h('th', null, 'Sky'), h('th', null, 'Drift'))));
    const tb = h('tbody');
    for (const m of CHAIN) {
      const drift = driftPerCentury(model.spec, model.targets, m);
      tb.append(h('tr', null, h('th', { scope: 'row' }, m === 'month' ? 'Moon (sidereal month)' : `${MEMBER_NAMES[m].replace('the ', '')} (year)`),
        h('td', null, periodDays(periods[m])), h('td', null, periodDays(model.targets.period[m])),
        h('td', { class: driftClass(drift) }, m === 'earth' ? 'the calendar' : `${signed(drift, 3)}° a century`)));
    }
    const nd = nodeDriftPerCentury(model.spec, model.targets);
    const nodeDays = machineNodeDays(model.spec, model.targets);
    tb.append(h('tr', null, h('th', { scope: 'row' }, "Moon's nodes (circuit)"),
      h('td', null, Number.isFinite(nodeDays) && nodeDays > 0 ? periodText(nodeDays) : 'not regressing'), h('td', null, periodText(model.targets.nodeDays)),
      h('td', { class: driftClass(nd) }, `${signed(nd, 3)}° a century`)));
    t.append(tb);
    this.summary.append(t);
    if (!model.layout.ok) this.summary.append(h('p.fault', null, 'This machine breaks its own rules: ', model.layout.rules.filter((r) => !r.ok).map((r) => r.text).join(' ')));
  }

  private wanted(id: TrainId): number {
    const model = this.app.model;
    if ((STEP_IDS as readonly string[]).includes(id)) return stepTarget(id as StepId, model.spec, model.targets);
    return id === 'node' ? nodeTargetRatio(model.targets) : 1;
  }

  private apply(id: TrainId, step: Step): void {
    const model = this.app.model;
    const spec = cloneSpec(model.spec);
    setTrain(spec, id, step);
    const layout = buildLayout(spec, PHYSICAL_LIMITS);
    const faults = layout.rules.filter((r) => !r.ok && r.train === id && !r.id.endsWith('.unit'));
    if (faults.length) {
      // Keep it on the bench until it fits; the machine stays as it was.
      this.draft = { id, step };
    } else {
      this.draft = null;
      model.setSpec(spec);
      this.app.selectTrain(id, false);
    }
    this.update(true);
  }

  private trainEditor(id: TrainId): HTMLElement {
    const model = this.app.model;
    const fitted = getTrain(model.spec, id);
    const step = this.draft?.id === id ? this.draft.step : fitted;
    const pending = this.draft?.id === id;
    const wanted = this.wanted(id);
    const ratio = (step.b / step.a) * (step.d / step.c);
    const error = ratio / wanted - 1;
    const isStep = (STEP_IDS as readonly string[]).includes(id);
    const rule = trainRule(id, this.limits);
    const cd1 = rule.first.centreDistance;
    const cd2 = rule.second.centreDistance;

    const inputs = h('div.teeth');
    for (const role of ROLES) {
      const input = h('input', { type: 'number', min: 6, max: 200, value: step[role], 'aria-label': `Teeth of wheel ${role.toUpperCase()}` });
      const set = (v: number) => {
        if (!Number.isFinite(v)) return;
        this.apply(id, { ...step, [role]: Math.max(6, Math.min(200, Math.round(v))) });
      };
      input.addEventListener('change', () => set(Number(input.value)));
      inputs.append(h('label', null, h('span', null, role.toUpperCase()),
        h('button', { type: 'button', 'aria-label': `One tooth fewer on ${role.toUpperCase()}`, onclick: () => set(step[role] - 1) }, '−'),
        input,
        h('button', { type: 'button', 'aria-label': `One tooth more on ${role.toUpperCase()}`, onclick: () => set(step[role] + 1) }, '+')));
    }

    // What the ratio means for the sky.
    const meaning: (string | HTMLElement)[] = [];
    if (isStep) {
      const { inner, outer, index } = stepMembers(id as StepId);
      const settled = index < CHAIN.indexOf('earth') ? inner : outer;
      const test = cloneSpec(model.spec);
      setTrain(test, id, step);
      const period = machinePeriods(test, model.targets)[settled];
      const drift = driftPerCentury(test, model.targets, settled);
      meaning.push(`${cap(MEMBER_NAMES[settled])} goes round in ${periodDays(period)}; the sky says ${periodDays(model.targets.period[settled])}. `,
        h('strong', { class: driftClass(drift) }, `Drift ${signed(drift, 3)}° a century.`),
        ' The wanted ratio already allows for the error of the trains between this one and the Earth.');
    } else if (id === 'node') {
      const test = cloneSpec(model.spec);
      setTrain(test, id, step);
      const days = machineNodeDays(test, model.targets);
      const drift = nodeDriftPerCentury(test, model.targets);
      meaning.push(days > 0 && Number.isFinite(days) ? `The nodes go backwards round the sky in ${periodText(days)}; the sky says ${periodText(model.targets.nodeDays)}. ` : 'With this ratio the nodes do not regress. ',
        h('strong', { class: driftClass(drift) }, `Drift ${signed(drift, 3)}° a century.`));
    } else {
      meaning.push(step.a * step.c === step.b * step.d ? 'Exactly one to one, as it must be.' : h('strong.bad', null, id === 'tilt' ? "Not one to one: the Earth's axis will wander round." : 'Not one to one: the Moon will not keep pace with the month tube.'));
    }

    const faults = buildLayoutFaults(model.spec, id, step);
    const m1 = moduleFor(cd1, step.a, step.b);
    const m2 = moduleFor(cd2, step.c, step.d);

    const box = h('div.editor', null,
      h('h3', null, trainName(id)),
      h('p', null, BLURB[id]),
      this.diagram(step, cd1, cd2),
      inputs,
      h('p.ratio', null, h('span', null, `(${step.b}/${step.a}) × (${step.d}/${step.c}) = `), h('strong', null, fmt(ratio, 7)),
        h('span', null, `, wanted ${fmt(wanted, 7)}: `), h('strong', null, errorText(error))),
      h('p', null, meaning),
      h('p.modules', null, `Tooth size: module ${fmt(m1, 2)} mm for A and B, ${fmt(m2, 2)} mm for C and D. The axes are ${fmt(cd1, 0)} mm apart, so more teeth means finer teeth.`),
      faults.length ? h('p.fault', null, pending ? 'Not fitted to the machine yet. ' : '', faults.join(' ')) : null,
    );

    // The solver's answers.
    const solveButton = h('button', { type: 'button', onclick: () => {
      this.candidates = { id, list: solveStep(this.wanted(id), trainRule(id, this.limits), 8) };
      this.update(true);
    } }, 'Find the closest trains');
    box.append(h('div.buttons', null, solveButton));
    if (this.candidates?.id === id) {
      const list = h('ol.candidates');
      for (const c of this.candidates.list) {
        list.append(h('li', null, h('button', { type: 'button', onclick: () => this.apply(id, { a: c.a, b: c.b, c: c.c, d: c.d }) },
          h('span', null, `${c.a}:${c.b} × ${c.c}:${c.d}`), h('span', null, errorText(c.error)), h('span', null, `module ${fmt(Math.min(c.moduleFirst, c.moduleSecond), 2)}`))));
      }
      box.append(this.candidates.list.length ? list : h('p.fault', null, 'Nothing fits the limits below.'));
    }

    // One pair instead of two: what continued fractions offer.
    if (id !== 'tilt' && id !== 'moon') {
      const conv = convergents(wanted, 9).filter((c) => c.q > 1 && c.p > 1 && c.q <= 2000 && c.p <= 2000).slice(0, 5);
      const single = bestPair(wanted, 8, Math.max(this.limits.maxTeeth, 20));
      box.append(h('details', null,
        h('summary', null, 'Why two pairs of wheels and not one?'),
        h('p', null, 'One pair can only make a ratio of two tooth counts. The best such fractions are the convergents of the continued fraction, which is how Huygens chose 206 and 7 teeth for Saturn in 1682:'),
        h('ul.convergents', null, conv.map((c) => h('li', null, `${c.p}/${c.q}: ${errorText(c.error / wanted)}`))),
        h('p', null, `With no wheel over ${Math.max(this.limits.maxTeeth, 20)} teeth, the best single pair is ${single.p}/${single.q}, ${errorText(single.error / wanted)}. Two pairs multiply, and reach ratios whose tooth counts would otherwise be far too large to cut.`)));
    }
    return box;
  }

  /** The two meshes drawn to scale, side by side. */
  private diagram(step: Step, cd1: number, cd2: number): SVGElement {
    const g = svg('svg', { viewBox: '0 0 320 120', class: 'traindiagram', role: 'img', 'aria-label': 'The two pairs of wheels, to scale' });
    const scale = 62 / Math.max(cd1, cd2);
    const pair = (x0: number, z1: number, z2: number, cd: number, n1: string, n2: string) => {
      const m = moduleFor(cd, z1, z2);
      const r1 = (m * z1) / 2 * scale;
      const r2 = (m * z2) / 2 * scale;
      const y = 60;
      g.append(svg('circle', { cx: x0, cy: y, r: Math.max(1, r1), class: 'wheel' }), svg('circle', { cx: x0 + cd * scale, cy: y, r: Math.max(1, r2), class: 'wheel' }));
      g.append(svg('circle', { cx: x0, cy: y, r: 1.6, class: 'axis' }), svg('circle', { cx: x0 + cd * scale, cy: y, r: 1.6, class: 'axis' }));
      const t1 = svg('text', { x: x0, y: y - 6, class: 'label' }); t1.textContent = `${n1} ${z1}`;
      const t2 = svg('text', { x: x0 + cd * scale, y: y - 6, class: 'label' }); t2.textContent = `${n2} ${z2}`;
      g.append(t1, t2);
    };
    pair(50, step.a, step.b, cd1, 'A', 'B');
    pair(208, step.d, step.c, cd2, 'D', 'C');
    const cap1 = svg('text', { x: 81, y: 116, class: 'caption' }); cap1.textContent = 'first pair';
    const cap2 = svg('text', { x: 239, y: 116, class: 'caption' }); cap2.textContent = 'second pair';
    g.append(cap1, cap2);
    return g;
  }
}

function buildLayoutFaults(spec: Parameters<typeof cloneSpec>[0], id: TrainId, step: Step): string[] {
  const test = cloneSpec(spec);
  setTrain(test, id, step);
  return buildLayout(test, PHYSICAL_LIMITS).rules.filter((r) => !r.ok && r.train === id && !r.id.endsWith('.unit')).map((r) => r.text);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function periodDays(days: number): string {
  return `${fmt(days, days < 1000 ? 4 : 2)} days`;
}

/** A relative error in plain words. */
export function errorText(rel: number): string {
  const a = Math.abs(rel);
  if (a === 0) return 'exact';
  const sign = rel > 0 ? 'high' : 'low';
  if (a >= 1e-2) return `${fmt(a * 100, 1)}% ${sign}`;
  if (a >= 1e-6) return `${fmt(a * 1e6, a >= 1e-4 ? 0 : 1)} parts in a million ${sign}`;
  return `${fmt(a * 1e9, a >= 1e-7 ? 0 : 1)} parts in a billion ${sign}`;
}

function driftClass(perCentury: number): string {
  const a = Math.abs(perCentury);
  return a > 5 ? 'bad' : a > 1 ? 'warn' : 'good';
}

void DESIGN;
