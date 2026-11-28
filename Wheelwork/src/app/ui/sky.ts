// The Sky panel: what the machine shows beside where the bodies really are.
import { moonMeanLongitudeUnwrapped, moonState } from '../../core/astro/moon';
import { meanLongitudeUnwrapped, planetState, siderealPeriodDays } from '../../core/astro/planets';
import { formatDate, J2000, norm180 } from '../../core/astro/time';
import { BODIES, type Body } from '../../core/machine/design';
import { ECLIPSE_LIMITS, type BodyReading, WANDERERS, type Wanderer } from '../../core/machine/sky';
import { driftPerCentury, nodeDriftPerCentury } from '../../core/machine/spec';
import { type App, type Panel } from './app';
import { clear, degrees, fmt, h, signed, svg } from './dom';

export const BODY_COLOURS: Record<Body | 'moon' | 'sun', string> = {
  sun: '#ffd47e', mercury: '#b3aca2', venus: '#ead9aa', earth: '#69a6d8', mars: '#d86e50', jupiter: '#dcb891', saturn: '#dfca92', moon: '#e8e2d2',
};
const NAMES: Record<Body, string> = { mercury: 'Mercury', venus: 'Venus', earth: 'Earth', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn' };
const SIGN_NAMES = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const SIGN_SHORT = ['Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir', 'Lib', 'Sco', 'Sgr', 'Cap', 'Aqr', 'Psc'];
const DEG = Math.PI / 180;

/** A longitude as a place in the zodiac: "12.3 Leo". */
export function zodiac(lon: number): string {
  const l = ((lon % 360) + 360) % 360;
  return `${fmt(l % 30, 1)}° ${SIGN_SHORT[Math.floor(l / 30) % 12]}`;
}

export class SkyPanel implements Panel {
  el: HTMLElement;
  private plan: SVGElement;
  private table: HTMLElement;
  private moonBox: HTMLElement;
  private heading: HTMLElement;
  private drift: HTMLElement;
  private fromEarth: HTMLElement;

  /** Largest difference between mean and true longitude, sampled over an orbit (planets) or twenty years (Moon) from J2000. */
  private circleMax: Record<string, string> = {};

  constructor(private app: App) {
    for (const b of BODIES) {
      const period = siderealPeriodDays(b);
      let max = 0;
      for (let i = 0; i < 720; i++) {
        const jd = J2000 + (i / 720) * period;
        max = Math.max(max, Math.abs(norm180(meanLongitudeUnwrapped(b, jd) - planetState(b, jd).lon)));
      }
      this.circleMax[b] = degrees(max, 1);
    }
    let moonMax = 0;
    for (let i = 0; i < 7300; i++) {
      const jd = J2000 + i;
      moonMax = Math.max(moonMax, Math.abs(norm180(moonMeanLongitudeUnwrapped(jd) - moonState(jd).lon)));
    }
    this.circleMax.moon = degrees(moonMax, 1);
    this.plan = svg('svg', { viewBox: '-150 -150 300 300', class: 'plan', role: 'img', 'aria-label': 'Plan of the machine against the sky' });
    this.heading = h('h2');
    this.table = h('table.readings');
    this.moonBox = h('div.moonbox');
    this.drift = h('div.drift');
    this.fromEarth = h('div.fromearth');
    this.el = h('section.panel.sky', null,
      this.heading,
      h('p.lede', null, 'Filled dots are where the machine puts each body; open rings are where it really is, from a reference ephemeris checked against JPL Horizons.'),
      this.plan,
      this.table,
      this.moonBox,
      h('h3', null, 'Two kinds of error'),
      h('p', null, 'The gearing error grows steadily: a train of whole-number teeth never has exactly the right ratio. The circle error comes and goes each orbit: the arms turn evenly, but planets speed up near the Sun and slow down far from it. For Jupiter and Saturn it also holds a slow swing of over nine centuries, from their pull on each other.'),
      this.drift,
      h('h3', null, 'As seen from the Earth'),
      h('p', null, 'An orrery shows the planets from outside. Looked at from its own Earth, small errors round the Sun become large ones in our sky for the planets that come close to us, and each planet in turn appears to stop and go backwards. The machine has no true distances, its arms being spaced for clearance, so each planet is taken at its real mean distance in the direction its arm shows.'),
      this.fromEarth,
    );
  }

  update(): void {
    const model = this.app.model;
    const r = model.reading();
    this.heading.textContent = `The sky on ${formatDate(r.jd)}`;

    // ---- the plan
    clear(this.plan);
    const g = this.plan;
    const radius = (i: number) => 26 + i * 19;
    g.append(svg('circle', { r: 141, class: 'rim' }));
    for (let s = 0; s < 12; s++) {
      const a = s * 30 * DEG;
      g.append(svg('line', { x1: 133 * Math.cos(a), y1: -133 * Math.sin(a), x2: 141 * Math.cos(a), y2: -141 * Math.sin(a), class: 'tick' }));
      const m = (s * 30 + 15) * DEG;
      const t = svg('text', { x: 124 * Math.cos(m), y: -124 * Math.sin(m) + 2.5, class: 'sign' });
      t.textContent = SIGN_NAMES[s]!.slice(0, 3);
      g.append(t);
    }
    g.append(svg('circle', { r: 7, fill: BODY_COLOURS.sun }));
    BODIES.forEach((b, i) => {
      const rr = radius(i);
      const p = r.planets[b];
      g.append(svg('circle', { r: rr, class: 'orbit' }));
      const mx = rr * Math.cos(p.machine * DEG), my = -rr * Math.sin(p.machine * DEG);
      const tx = rr * Math.cos(p.truth * DEG), ty = -rr * Math.sin(p.truth * DEG);
      if (Math.abs(p.error) > 0.8) {
        const large = Math.abs(p.error) > 180 ? 1 : 0;
        g.append(svg('path', { d: `M ${mx} ${my} A ${rr} ${rr} 0 ${large} ${p.error > 0 ? 1 : 0} ${tx} ${ty}`, class: 'miss', stroke: BODY_COLOURS[b] }));
      }
      g.append(svg('circle', { cx: tx, cy: ty, r: 5, class: 'truth', stroke: BODY_COLOURS[b] }));
      g.append(svg('circle', { cx: mx, cy: my, r: 3.2, fill: BODY_COLOURS[b] }));
      if (b === 'earth') {
        // The Moon, drawn about the machine's Earth.
        const mm = r.moon;
        g.append(svg('circle', { cx: mx, cy: my, r: 9, class: 'orbit' }));
        g.append(svg('circle', { cx: mx + 9 * Math.cos(mm.truth * DEG), cy: my - 9 * Math.sin(mm.truth * DEG), r: 2.6, class: 'truth', stroke: BODY_COLOURS.moon }));
        g.append(svg('circle', { cx: mx + 9 * Math.cos(mm.machine * DEG), cy: my - 9 * Math.sin(mm.machine * DEG), r: 1.7, fill: BODY_COLOURS.moon }));
      }
    });

    // ---- the table
    clear(this.table);
    this.table.append(h('thead', null, h('tr', null,
      h('th', null, ''), h('th', { title: 'Heliocentric longitude shown by the machine' }, 'Machine'), h('th', { title: 'True heliocentric longitude' }, 'Sky'),
      h('th', { title: 'Machine minus sky' }, 'Error'), h('th', { title: 'Lost or gained by the gearing since the machine was set' }, 'Gearing'), h('th', { title: 'What steady circular motion cannot follow, at this moment' }, 'Circle'))));
    const row = (name: string, colour: string, p: BodyReading) => h('tr', null,
      h('th', { scope: 'row' }, h('i.dot', { style: `background:${colour}` }), name),
      h('td', null, zodiac(p.machine)), h('td', null, zodiac(p.truth)),
      h('td.err', { class: Math.abs(p.error) > 5 ? 'err bad' : Math.abs(p.error) > 1 ? 'err warn' : 'err' }, `${signed(p.error, 2)}°`),
      h('td', null, `${signed(p.gearing, 2)}°`), h('td', null, `${signed(p.circle, 2)}°`));
    const body = h('tbody');
    for (const b of BODIES) body.append(row(NAMES[b], BODY_COLOURS[b], r.planets[b]));
    body.append(row('Moon', BODY_COLOURS.moon, r.moon));
    this.table.append(body);

    // ---- the moon and eclipses
    clear(this.moonBox);
    const e = r.eclipse;
    const verdict = e.now === 'solar' ? 'New Moon at a node: the machine shows a solar eclipse.'
      : e.now === 'lunar' ? 'Full Moon at a node: the machine shows a lunar eclipse.'
        : e.season ? `Eclipse season: the Sun is ${degrees(Math.abs(e.sunFromNode), 1)} from a node, inside ${ECLIPSE_LIMITS.season}°. The next new or full Moon may be eclipsed.`
          : `No eclipse season: the Sun is ${degrees(Math.abs(e.sunFromNode), 1)} from the nearer node.`;
    this.moonBox.append(
      h('h3', null, 'Moon'),
      h('p', null, h('strong', null, r.moon.phase), `, ${fmt(r.moon.lit * 100, 0)}% lit. `,
        `It stands ${degrees(Math.abs(r.moon.latitude), 2)} ${r.moon.latitude >= 0 ? 'north' : 'south'} of the ecliptic on the machine and ${degrees(Math.abs(r.moon.latitudeTruth), 2)} ${r.moon.latitudeTruth >= 0 ? 'north' : 'south'} in the sky. `,
        `Ascending node at ${zodiac(r.moon.node)} (sky: ${zodiac(r.moon.nodeTruth)}).`),
      h('p', { class: e.now ? 'eclipse now' : e.season ? 'eclipse season' : 'eclipse' }, verdict),
    );

    // ---- drift
    clear(this.drift);
    const t = h('table.readings.drift');
    t.append(h('thead', null, h('tr', null, h('th', null, ''), h('th', { title: 'How fast the gearing error grows' }, 'Gearing drift'), h('th', { title: 'How long the gearing takes to be one degree out' }, 'One degree out after'), h('th', { title: 'Largest circle error in an orbit' }, 'Circle error, at most'))));
    const tb = h('tbody');
    const circleMax = this.circleMax;
    const driftRow = (name: string, colour: string, perCentury: number, max: string) => tb.append(h('tr', null,
      h('th', { scope: 'row' }, h('i.dot', { style: `background:${colour}` }), name),
      h('td', null, perCentury === 0 ? 'none: it is the calendar' : `${signed(perCentury, 3)}° a century`),
      h('td', null, perCentury === 0 ? '' : `${fmt(100 / Math.abs(perCentury), 0)} years`),
      h('td', null, max)));
    for (const b of BODIES) driftRow(NAMES[b], BODY_COLOURS[b], driftPerCentury(model.spec, model.targets, b), circleMax[b]!);
    driftRow('Moon', BODY_COLOURS.moon, driftPerCentury(model.spec, model.targets, 'month'), circleMax.moon!);
    driftRow("Moon's nodes", BODY_COLOURS.moon, nodeDriftPerCentury(model.spec, model.targets), '');
    t.append(tb);
    this.drift.append(t);

    // ---- from the Earth
    clear(this.fromEarth);
    const geo = model.geocentric();
    const names: Record<Wanderer, string> = { sun: 'Sun', moon: 'Moon', mercury: 'Mercury', venus: 'Venus', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn' };
    const strip = svg('svg', { viewBox: '0 0 300 58', class: 'strip', role: 'img', 'aria-label': 'The zodiac as seen from the Earth: machine above, sky below' });
    // The zodiac runs right to left, as it does for a northern observer facing south.
    const xOf = (lon: number) => 296 - (lon / 360) * 292;
    for (let sgn = 0; sgn < 12; sgn++) {
      strip.append(svg('line', { x1: xOf(sgn * 30), y1: 12, x2: xOf(sgn * 30), y2: 46, class: 'tick' }));
      const t2 = svg('text', { x: xOf(sgn * 30 + 15), y: 9, class: 'sign' });
      t2.textContent = SIGN_NAMES[sgn]!.slice(0, 3);
      strip.append(t2);
    }
    strip.append(svg('line', { x1: 4, y1: 22, x2: 296, y2: 22, class: 'orbit' }), svg('line', { x1: 4, y1: 38, x2: 296, y2: 38, class: 'orbit' }));
    const lab1 = svg('text', { x: 4, y: 55, class: 'sign', style: 'text-anchor:start' });
    lab1.textContent = 'top: machine';
    const lab2 = svg('text', { x: 296, y: 55, class: 'sign', style: 'text-anchor:end' });
    lab2.textContent = 'bottom: sky';
    strip.append(lab1, lab2);
    for (const w of WANDERERS) {
      const g2 = geo[w];
      const colour = BODY_COLOURS[w];
      strip.append(svg('line', { x1: xOf(g2.machine), y1: 22, x2: xOf(g2.truth), y2: 38, stroke: colour, 'stroke-width': 0.6, opacity: Math.abs(xOf(g2.machine) - xOf(g2.truth)) > 100 ? 0 : 0.6 }));
      strip.append(svg('circle', { cx: xOf(g2.machine), cy: 22, r: w === 'sun' ? 4 : 2.8, fill: colour }));
      strip.append(svg('circle', { cx: xOf(g2.truth), cy: 38, r: w === 'sun' ? 4 : 2.8, class: 'truth', stroke: colour }));
    }
    const gt = h('table.readings');
    gt.append(h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Machine'), h('th', null, 'Sky'), h('th', null, 'Error'), h('th', { title: 'Direct: moving forwards through the zodiac. Retrograde: backwards.' }, 'Motion'))));
    const gb = h('tbody');
    for (const w of WANDERERS) {
      const g2 = geo[w];
      const word = (r: boolean) => (r ? 'retrograde' : 'direct');
      const motion = w === 'sun' || w === 'moon' ? '' : g2.retrograde === g2.retrogradeTruth ? word(g2.retrograde) : `${word(g2.retrograde)}; sky ${word(g2.retrogradeTruth)}`;
      gb.append(h('tr', null, h('th', { scope: 'row' }, h('i.dot', { style: `background:${BODY_COLOURS[w]}` }), names[w]),
        h('td', null, zodiac(g2.machine)), h('td', null, zodiac(g2.truth)),
        h('td', { class: Math.abs(g2.error) > 5 ? 'err bad' : Math.abs(g2.error) > 1 ? 'err warn' : 'err' }, `${signed(g2.error, 2)}\u00b0`),
        h('td', { class: g2.retrograde ? 'warn' : '' }, motion)));
    }
    gt.append(gb);
    this.fromEarth.append(strip, gt);
  }
}
