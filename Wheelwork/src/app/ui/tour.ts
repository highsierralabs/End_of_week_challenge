// The Tour: thirteen stops round the machine. Each stop arranges the stage and says one thing;
// the figures in the text are read from the machine as it stands, not written in.
import { formatDate } from '../../core/astro/time';
import { CHAIN } from '../../core/machine/design';
import { readMachine } from '../../core/machine/sky';
import { poseMachine } from '../../core/machine/pose';
import { driftPerCentury, getTrain } from '../../core/machine/spec';
import { convergents } from '../../core/train/rational';
import { type App, type Panel, periodText } from './app';
import { type Child, clear, degrees, fmt, h, signed } from './dom';
import { errorText } from './workbench';

interface Stop {
  title: string;
  enter: (app: App) => void;
  body: (app: App) => Child[];
  /** Text that changes as the machine runs. */
  live?: (app: App) => Child[];
}

const p = (...c: Child[]) => h('p', null, ...c);

const STOPS: Stop[] = [
  {
    title: 'An orrery',
    enter: (app) => { app.stop(); app.setLamp(false); app.selectTrain(null, false); app.setView('whole'); },
    body: (app) => [
      p('An orrery is a model of the solar system worked by gears. Turn its crank and the planets go round the Sun, each at its own pace, as they have been made to do on desks since about 1704.'),
      p(`This one has ${app.model.layout.wheels.length + 2} toothed wheels. Nothing on screen is animated by astronomy: the picture is drawn from the tooth counts, and every motion you see is one wheel pushing another.`),
      p(h('strong', null, 'Drag the crank'), ' on the side of the case, or press Run below. Drag anywhere else to walk round the machine; scroll to come closer.'),
    ],
  },
  {
    title: 'One turn of the crank',
    enter: (app) => { app.setLamp(false); app.selectTrain(null, false); app.setView('crank'); app.play(1, 1); },
    body: (app) => {
      const m = app.model;
      return [
        p(`One turn of the crank is ${fmt(m.daysPerTurn, 2)} days: about a month. In that turn the Moon goes ${fmt(Math.abs(m.rates.value.moonSleeve), 2)} times round the Earth against the stars, and Mercury covers ${fmt(m.rates.value.mercury, 2)} of its orbit.`),
        p(`Saturn needs ${fmt(1 / m.rates.value.saturn, 0)} turns to go round once. The Earth takes ${fmt(1 / m.rates.value.earth, 2)}: the Earth's arm is this machine's calendar, and the inner ring engraved on the deck is read against it.`),
        p('The crank drives a bevel pinion, which turns a bevel wheel on the bottom of Mercury\'s tube. Everything else takes its motion from there.'),
      ];
    },
  },
  {
    title: 'Inside the case',
    enter: (app) => { app.setLamp(false); app.selectTrain(null, false); app.setView('train'); app.play(2, 1); },
    body: () => [
      p('The planets are carried on arms, and the arms on a nest of tubes one inside another, Mercury\'s the innermost. Below the deck each tube carries wheels.'),
      p('Beside the nest stands one post. On it turn six ', h('em', null, 'clusters'), ', each a pair of wheels made as one piece. A wheel on one tube drives a cluster, and the cluster drives the next tube. So the motion climbs the chain: Mercury, Venus, the month tube, Earth, Mars, Jupiter, Saturn.'),
      p('Two axes, a fixed distance apart, and every train the same shape. That is the whole gearbox.'),
    ],
  },
  {
    title: 'Counting teeth',
    enter: (app) => { app.setLamp(false); app.setView('train'); app.selectTrain('earth-mars', false); app.play(2, 1); },
    body: (app) => {
      const s = getTrain(app.model.spec, 'earth-mars');
      const ratio = (s.b / s.a) * (s.d / s.c);
      const wanted = app.model.targets.period.mars / app.model.targets.period.earth;
      return [
        p('The four wheels lit in blue join the Earth\'s tube to Mars\'s. Mars takes 1.8808 of our years to go round the Sun, so that is the ratio this train must make.'),
        p(`Wheel A on the Earth's tube has ${s.a} teeth and drives wheel B, ${s.b} teeth, on the cluster. Wheel C, ${s.c} teeth, on the same cluster drives wheel D, ${s.d} teeth, on Mars's tube.`),
        p(h('strong', null, `(${s.b}/${s.a}) × (${s.d}/${s.c}) = ${fmt(ratio, 6)}`), `. The sky asks for ${fmt(wanted, 6)}. The train is ${errorText(ratio / wanted - 1)}.`),
        p('Teeth come in whole numbers, so no train is ever exactly right. The craft is in getting close with wheels that can be made.'),
      ];
    },
  },
  {
    title: "Huygens's fractions",
    enter: (app) => { app.setLamp(false); app.setView('train'); app.selectTrain('jupiter-saturn', false); app.play(3, 1); },
    body: (app) => {
      const wanted = app.model.targets.period.saturn / app.model.targets.period.earth;
      const conv = convergents(wanted, 6).slice(0, 5);
      return [
        p('In 1682 Christiaan Huygens was designing a planetarium and needed Saturn to go round once in 29.43 years with one pair of wheels. He invented a method for it: write the ratio as a continued fraction and stop early. Each stopping point gives the best fraction there is for teeth that few.'),
        p(`For the value used here, ${fmt(wanted, 4)}, the fractions run: `, conv.map((c, i) => [i ? ', ' : '', h('strong', null, `${c.p}/${c.q}`)]), '. Huygens cut 206 teeth and 7.'),
        p('This machine uses two pairs in each train instead of one. The products of two fractions fall much more thickly along the number line than single fractions do, so a train of four modest wheels gets closer than one pair of enormous ones. The Workbench will find them for you.'),
      ];
    },
  },
  {
    title: 'A century of drift',
    enter: (app) => { app.setLamp(false); app.selectTrain(null, false); app.setView('above'); app.glideTo(app.model.setJd + 36525, 9); },
    body: (app) => {
      const m = app.model;
      const worst = CHAIN.filter((c) => c !== 'earth').map((c) => ({ c, d: driftPerCentury(m.spec, m.targets, c) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0]!;
      return [
        p(`The machine was set on ${formatDate(m.setJd)}, every arm turned to its planet's mean place. Now it is running forward a hundred years: ${fmt(36525 / m.daysPerTurn, 0)} turns of the crank.`),
        p(`Because each train is a hair off, each planet slowly gains or loses. The worst here is ${worst.c === 'month' ? 'the Moon' : cap(worst.c)}, which drifts ${degrees(Math.abs(worst.d), 2)} in the century. A real brass orrery would wear out first.`),
      ];
    },
    live: (app) => {
      const r = app.model.reading();
      return [p(h('strong', null, formatDate(r.jd)), '. Gearing error so far: Mercury ', `${signed(r.planets.mercury.gearing, 2)}°, Venus ${signed(r.planets.venus.gearing, 2)}°, Mars ${signed(r.planets.mars.gearing, 2)}°, Jupiter ${signed(r.planets.jupiter.gearing, 2)}°, Saturn ${signed(r.planets.saturn.gearing, 2)}°, Moon ${signed(r.moon.gearing, 2)}°.`)];
    },
  },
  {
    title: 'What circles cost',
    enter: (app) => { app.setLamp(false); app.selectTrain(null, false); app.setView('above'); app.play(3, 1); },
    body: () => [
      p('The gearing is not this machine\'s real fault. Its arms turn at a steady rate in perfect circles, and planets do neither. Kepler found in 1609 that they move on ellipses, faster when nearer the Sun.'),
      p('So even a perfectly geared orrery is wrong most of the time, by an amount that swings back and forth every orbit: up to 23.7° for Mercury and 10.7° for Mars, under 2° for the Earth and under 1° for Venus. The Sky tab shows both errors side by side.'),
      p('Some makers added eccentric wheels or slotted cranks to mimic this. This one does not; it shows you the size of the omission instead.'),
    ],
    live: (app) => {
      const r = app.model.reading();
      return [p(h('strong', null, formatDate(r.jd)), `. Mercury is ${degrees(Math.abs(r.planets.mercury.circle), 1)} ${r.planets.mercury.circle > 0 ? 'ahead of' : 'behind'} where it really is on account of its circle; Mars ${degrees(Math.abs(r.planets.mars.circle), 1)} ${r.planets.mars.circle > 0 ? 'ahead' : 'behind'}.`)];
    },
  },
  {
    title: 'The Earth and Moon',
    enter: (app) => { app.setLamp(false); app.selectTrain(null, false); app.setView('tellurion'); app.play(1, 1); },
    body: () => [
      p('The Earth\'s arm carries a small machine of its own, called a tellurion. Three trains run along the arm from the centre to the Earth.'),
      p('The first comes from the month tube and carries the Moon round the Earth once a sidereal month. The other two start from wheels on a tube that ', h('em', null, 'does not turn'), ', held by a bridge inside the case. Rolling round a still wheel is how the arm gets motions that are fixed, or nearly fixed, against the stars.'),
      p('One of those keeps the Earth\'s tilted axis pointing the same way all year. The other turns the inclined ring under the Moon, slowly backwards.'),
    ],
  },
  {
    title: 'Phases',
    enter: (app) => { app.selectTrain(null, false); app.setLamp(true); app.setView('tellurion'); app.play(0, 1); },
    body: () => [
      p('Put out the room lights and light the Sun. Now the only light on the Earth and Moon comes from the middle of the machine, and each is half lit, as they are.'),
      p('Seen from the Earth, how much of the Moon\'s lit half faces us depends on where the Moon is in its round. That is all a phase is. Walk round to stand behind the Earth and look at the Moon past it.'),
    ],
    live: (app) => {
      const r = app.model.reading();
      return [p(h('strong', null, r.moon.phase), `, ${fmt(r.moon.lit * 100, 0)}% lit, on ${formatDate(r.jd)}. In the sky it is ${fmt(((1 - Math.cos((r.moon.elongationTruth * Math.PI) / 180)) / 2) * 100, 0)}% lit.`)];
    },
  },
  {
    title: 'Eclipse seasons',
    enter: (app) => { app.selectTrain(null, false); app.setLamp(true); app.setView('tellurion'); app.play(1, 1); },
    body: (app) => [
      p('If the Moon went round in the same plane as the Earth, there would be an eclipse of the Sun at every new Moon and of the Moon at every full. Its orbit is tipped by 5.1°, so most months it passes above or below.'),
      p('The Moon\'s stalk rides on the inclined ring, which lifts and lowers it. Where the ring crosses the level of the Sun are the nodes; the gilt bead marks the rising one. Eclipses happen only when a new or full Moon falls near a node, which the Sun passes about every 173 days.'),
      p(`The ring creeps backwards, once round in ${periodText(app.model.daysPerTurn / Math.abs(app.model.rates.value.nodeSleeve))}, so the eclipse seasons come a little earlier each year.`),
      h('div.buttons', null, h('button', { type: 'button', onclick: () => nextEclipse(app) }, 'Run to the next eclipse the machine shows')),
    ],
    live: (app) => {
      const r = app.model.reading();
      const e = r.eclipse;
      return [p(h('strong', null, formatDate(r.jd)), `. The Sun is ${degrees(Math.abs(e.sunFromNode), 1)} from a node. `,
        e.now === 'solar' ? h('strong.now', null, 'New Moon at the node: an eclipse of the Sun.') : e.now === 'lunar' ? h('strong.now', null, 'Full Moon at the node: an eclipse of the Moon.') : e.season ? 'It is an eclipse season.' : 'No eclipse is possible this month.')];
    },
  },
  {
    title: 'Seasons',
    enter: (app) => { app.selectTrain('tilt', false); app.setLamp(true); app.setView('tellurion'); app.play(2, 1); },
    body: () => [
      p('The Earth\'s axis leans 23.4° from upright, and it keeps leaning the same way as the Earth goes round. In June the north pole leans towards the Sun; in December, away. That, and not distance, makes the seasons.'),
      p('The train lit in blue does it. Its first wheel is fixed; its ratio is exactly one to one. As the arm carries the train round the still wheel, the last wheel is turned back by exactly as much as the arm has turned forward, and the axis on it keeps its direction in the room.'),
      p('What this machine leaves out: the Earth does not spin. A daily turn would need a further train of 365 to 1.'),
    ],
  },
  {
    title: 'The workbench',
    enter: (app) => { app.stop(); app.setLamp(false); app.selectTrain('mercury-venus', false); app.setView('train'); },
    body: (app) => [
      p('Every tooth count can be changed. Click any wheel, or open the Workbench, and add or take away teeth: the machine is rebuilt at once, with the size of the teeth following from the fixed distance between the axes.'),
      p('The solver lists the trains nearest to any ratio, within limits you set on the number and fineness of teeth. Or have it design the whole machine: ask for wheels of at most 40 teeth and see what a century does to it.'),
      h('div.buttons', null, h('button', { type: 'button', onclick: () => app.showTab('workbench') }, 'Open the Workbench')),
    ],
  },
  {
    title: 'Take it off the screen',
    enter: (app) => { app.stop(); app.setLamp(false); app.selectTrain(null, false); app.setView('exploded'); },
    body: (app) => [
      p('The wheels on screen are true involute gears, generated the way a cutter generates them, and the same solids can be saved as files for a 3D printer: the wheels, tubes, arms, plates and pillars of the machine as it stands on the workbench.'),
      p('The kit is checked by computation. It has not been printed.'),
      h('div.buttons', null, h('button', { type: 'button', onclick: () => app.showTab('print') }, 'Open the Print panel'), h('button', { type: 'button', onclick: () => app.showTab('sky') }, 'Open the Sky panel')),
    ],
  },
];

/** Run forward to the next new or full Moon at which the machine itself shows an eclipse. */
function nextEclipse(app: App): void {
  const m = app.model;
  const step = 0.2 / m.daysPerTurn;
  let turns = m.turns + 3 / m.daysPerTurn;
  for (let i = 0; i < 12000; i++, turns += step) {
    const r = readMachine(poseMachine(m.spec, m.rates, m.setting, turns), m.setJd, m.rates, m.targets);
    if (!r.eclipse.now) continue;
    // Walk on to the middle of the eclipse: where the elongation is nearest exact new or full.
    let best = turns;
    let bestOff = Infinity;
    for (let k = 0; k < 120; k++) {
      const t = turns + k * step * 0.25;
      const rr = readMachine(poseMachine(m.spec, m.rates, m.setting, t), m.setJd, m.rates, m.targets);
      const e = rr.moon.elongation;
      const off = Math.min(e, 360 - e, Math.abs(e - 180));
      if (off < bestOff) { bestOff = off; best = t; }
    }
    app.glideTo(m.setJd + best * m.daysPerTurn, 5);
    return;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class TourPanel implements Panel {
  el: HTMLElement;
  index = 0;
  private title: HTMLElement;
  private body: HTMLElement;
  private live: HTMLElement;
  private count: HTMLElement;
  private prev: HTMLButtonElement;
  private next: HTMLButtonElement;
  private shownFor = '';
  private started = false;

  constructor(private app: App) {
    this.title = h('h2');
    this.body = h('div.stopbody');
    this.live = h('div.live', { 'aria-live': 'off' });
    this.count = h('span.count');
    this.prev = h('button', { type: 'button', onclick: () => this.go(this.index - 1) }, 'Back');
    this.next = h('button.primary', { type: 'button', onclick: () => this.go(this.index + 1) }, 'Next');
    this.el = h('section.panel.tour', null, this.title, this.body, this.live, h('div.tournav', null, this.prev, this.count, this.next));
  }

  get length(): number {
    return STOPS.length;
  }

  go(index: number): void {
    this.index = Math.max(0, Math.min(STOPS.length - 1, index));
    this.started = true;
    STOPS[this.index]!.enter(this.app);
    this.shownFor = '';
    this.update();
  }

  update(): void {
    const stop = STOPS[this.index]!;
    // The body is rebuilt when the stop or the machine changes; the live line every time.
    const key = `${this.index}|${JSON.stringify(this.app.model.spec)}|${this.app.model.setJd}`;
    if (key !== this.shownFor) {
      this.shownFor = key;
      this.title.textContent = stop.title;
      clear(this.body);
      this.body.append(...flatten(stop.body(this.app)));
      this.count.textContent = `${this.index + 1} of ${STOPS.length}`;
      this.prev.disabled = this.index === 0;
      this.next.disabled = this.index === STOPS.length - 1;
      this.next.textContent = this.index === 0 && !this.started ? 'Begin the tour' : 'Next';
    }
    clear(this.live);
    if (stop.live) this.live.append(...flatten(stop.live(this.app)));
  }
}

function flatten(children: Child[]): (Node | string)[] {
  const out: (Node | string)[] = [];
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) out.push(...flatten(c));
    else out.push(c instanceof Node ? c : String(c));
  }
  return out;
}
