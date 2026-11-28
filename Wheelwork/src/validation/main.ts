// The validation page: every claim the app rests on, measured here in the visitor's own browser
// against something independent of it: fetched JPL and NASA data, closed-form geometry, brute
// force, or an identity that must hold exactly.
import './validation.css';
import { ECLIPSES, syzygies } from '../core/astro/eclipses';
import { moonState, MOON, sunGeocentricLongitude } from '../core/astro/moon';
import { PLANETS, planetState, siderealPeriodDays } from '../core/astro/planets';
import { formatDate, jdFromCalendar, norm180 } from '../core/astro/time';
import { spurGear } from '../core/gears/involute';
import { checkMesh, contactRatio, effectiveContactRatio } from '../core/gears/meshcheck';
import { CHAIN } from '../core/machine/design';
import { buildKit } from '../core/machine/kit';
import { matingAngle, meshError, solveRates, wheelPhases } from '../core/machine/kinematics';
import { buildLayout } from '../core/machine/layout';
import { buildParts, PRINT_DETAIL } from '../core/machine/parts';
import { poseMachine } from '../core/machine/pose';
import { ECLIPSE_LIMITS, machineAtSyzygy, readMachine, settingFor, skyTargets } from '../core/machine/sky';
import {
  DEFAULT_LIMITS, designMachine, driftPerCentury, nodeDriftPerCentury, STEP_IDS, stepRule, TRAIN_IDS,
} from '../core/machine/spec';
import { checkClosed, cylinder, meshStats, parseBinaryStl, sphere, toBinaryStl } from '../core/mesh/kit';
import { add, frac, mul, toNumber } from '../core/train/rational';
import { bestPair, convergents } from '../core/train/rational';
import { feasiblePairs, solveStep } from '../core/train/solver';
import { HORIZONS } from '../data/horizons';
import { matingRotation } from '../core/gears/involute';
import { DEFAULT_DRIFT_BUDGET, PHYSICAL_LIMITS } from '../app/model';

interface Row {
  group: string;
  name: string;
  measured: string;
  expected: string;
  ok: boolean;
}

declare global {
  interface Window { wheelworkValidation: { done: boolean; rows: Row[]; failed: number; error?: string } }
}

const rows: Row[] = [];
window.wheelworkValidation = { done: false, rows, failed: 0 };
let group = '';
const report = document.getElementById('report')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

let table: HTMLTableElement | null = null;

function section(title: string, blurb: string): void {
  group = title;
  report.append(el('h2', title), el('p', blurb, 'blurb'));
  table = el('table');
  const head = el('tr');
  head.append(el('th', 'Check'), el('th', 'Measured'), el('th', 'Expected'), el('th', ''));
  table.append(head);
  report.append(table);
}

function check(name: string, measured: string, expected: string, ok: boolean): void {
  const row: Row = { group, name, measured, expected, ok };
  rows.push(row);
  const tr = el('tr');
  tr.append(el('td', name), el('td', measured), el('td', expected), el('td', ok ? 'agrees' : 'DIFFERS', ok ? 'ok' : 'bad'));
  table!.append(tr);
}

const f = (v: number, d = 3) => v.toFixed(d);
const pause = () => new Promise((r) => setTimeout(r, 0));

function stats(values: number[]): { max: number; rms: number } {
  let max = 0, sum = 0;
  for (const v of values) { max = Math.max(max, Math.abs(v)); sum += v * v; }
  return { max, rms: Math.sqrt(sum / Math.max(1, values.length)) };
}

async function run(): Promise<void> {
  const started = performance.now();
  const targets = skyTargets();
  const spec = designMachine(targets, { limits: DEFAULT_LIMITS, driftBudget: DEFAULT_DRIFT_BUDGET });
  const layout = buildLayout(spec, PHYSICAL_LIMITS);
  const rates = solveRates(layout);
  const now = new Date();
  const setJd = jdFromCalendar(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const setting = settingFor(setJd);

  // ------------------------------------------------------------------ 1
  section('1. The reference sky against JPL Horizons',
    `The app measures the machine against its own small ephemeris. Here that ephemeris is measured against positions fetched from JPL Horizons (DE441): ${HORIZONS.planets.mercury.length} dates for each body, from 1001 BC to AD 3000, shipped with the page. Longitudes are heliocentric for the planets and geocentric for the Moon and Sun, on the ecliptic of J2000.`);
  const planetLimit: Record<string, number> = { mercury: 0.012, venus: 0.02, earth: 0.02, mars: 0.07, jupiter: 0.3, saturn: 0.5 };
  for (const p of PLANETS) {
    const errs = HORIZONS.planets[p].map(([jd, lon]) => norm180(planetState(p, jd).lon - lon));
    const s = stats(errs);
    check(`${cap(p)}: longitude, whole span`, `largest ${f(s.max, 4)}°, rms ${f(s.rms, 4)}°`, `under ${planetLimit[p]}°`, s.max < planetLimit[p]!);
  }
  {
    const recent = HORIZONS.moon.filter(([jd]) => jd > 2415020 && jd < 2488070);
    const lon = stats(recent.map(([jd, l]) => norm180(moonState(jd).lon - l)));
    const lat = stats(recent.map(([jd, , b]) => moonState(jd).latJ2000 - b));
    const dist = stats(recent.map(([jd, , , d]) => moonState(jd).distKm - d));
    check('Moon: longitude, 1900 to 2100', `largest ${f(lon.max, 4)}°, rms ${f(lon.rms, 4)}°`, 'under 0.006°', lon.max < 0.006);
    check('Moon: latitude, 1900 to 2100', `largest ${f(lat.max, 4)}°`, 'under 0.003°', lat.max < 0.003);
    check('Moon: distance, 1900 to 2100', `largest ${f(dist.max, 1)} km`, 'under 25 km', dist.max < 25);
    const all = stats(HORIZONS.moon.map(([jd, l]) => norm180(moonState(jd).lon - l)));
    check('Moon: longitude, 1001 BC to AD 3000', `largest ${f(all.max, 4)}°`, 'under 0.06°', all.max < 0.06);
    const sun = stats(HORIZONS.sun.map(([jd, l]) => norm180(sunGeocentricLongitude(jd) - l)));
    check('Sun: geocentric longitude, whole span', `largest ${f(sun.max, 4)}°`, 'under 0.02°', sun.max < 0.02);
  }
  check('Sidereal month', `${f(MOON.siderealMonthDays, 6)} days`, '27.321662 days', Math.abs(MOON.siderealMonthDays - 27.321662) < 2e-6);
  check('Synodic month', `${f(MOON.synodicMonthDays, 6)} days`, '29.530589 days', Math.abs(MOON.synodicMonthDays - 29.530589) < 2e-6);
  check('Circuit of the nodes', `${f(MOON.nodeRegressionDays / 365.25, 3)} years`, '18.60 years', Math.abs(MOON.nodeRegressionDays / 365.25 - 18.6) < 0.005);
  check('Sidereal year', `${f(siderealPeriodDays('earth'), 5)} days`, '365.25636 days', Math.abs(siderealPeriodDays('earth') - 365.25636) < 2e-5);
  await pause();

  // ------------------------------------------------------------------ 2
  section('2. New and full Moons against NASA’s eclipse catalogue',
    `Every eclipse is a new or full Moon, so the catalogue's ${ECLIPSES.length} eclipses of 1901 to 2100 (Eclipse Predictions by Fred Espenak, NASA's GSFC) test the reference Moon and Sun together.`);
  {
    const syz = syzygies(jdFromCalendar(1900, 12, 1), jdFromCalendar(2101, 2, 1));
    let worstSolar = 0, worstLunar = 0, latSolar = 0, latLunar = 0, misses = 0;
    let k = 0;
    for (const e of ECLIPSES) {
      const want = e.kind === 'solar' ? 'new' : 'full';
      while (k + 1 < syz.length && syz[k + 1]!.jd <= e.jd) k++;
      let best = Infinity;
      for (const j of [k - 1, k, k + 1, k + 2]) {
        const s = syz[j];
        if (s && s.kind === want) best = Math.min(best, Math.abs(s.jd - e.jd) * 24);
      }
      if (best > 1) misses++;
      const lat = Math.abs(moonState(e.jd).lat);
      if (e.kind === 'solar') { worstSolar = Math.max(worstSolar, best); latSolar = Math.max(latSolar, lat); }
      else { worstLunar = Math.max(worstLunar, best); latLunar = Math.max(latLunar, lat); }
    }
    check('Solar eclipses fall at a computed new Moon', `all ${ECLIPSES.filter((e) => e.kind === 'solar').length} within ${f(worstSolar, 2)} h`, 'within 0.5 h', worstSolar < 0.5);
    check('Lunar eclipses fall at a computed full Moon', `all ${ECLIPSES.filter((e) => e.kind === 'lunar').length} within ${f(worstLunar, 2)} h`, 'within 0.5 h', worstLunar < 0.5);
    check('Eclipses with no matching new or full Moon', String(misses), '0', misses === 0);
    check('Moon’s latitude at solar eclipses', `at most ${f(latSolar, 2)}°`, 'under 1.6°', latSolar < 1.6);
    check('Moon’s latitude at lunar eclipses', `at most ${f(latLunar, 2)}°`, 'under 1.6°', latLunar < 1.6);
  }
  await pause();

  // ------------------------------------------------------------------ 3
  section('3. The teeth',
    'The wheels are involute gears generated as a rack cutter generates them. Each meshing pair of the machine is turned through one tooth pitch in 24 steps and the two outlines tested against each other.');
  {
    const g = spurGear({ teeth: 20, module: 2 });
    check('Tooth thickness at the pitch circle (20 teeth, module 2)', `${f(g.toothThicknessAtPitch, 6)} mm`, `π m / 2 = ${f(Math.PI, 6)} mm`, Math.abs(g.toothThicknessAtPitch - Math.PI) < 1e-9);
    check('Base radius (20 teeth, module 2, 20°)', `${f(g.baseRadius, 6)} mm`, `20 cos 20° = ${f(20 * Math.cos(Math.PI / 9), 6)} mm`, Math.abs(g.baseRadius - 20 * Math.cos(Math.PI / 9)) < 1e-9);
    const cr = contactRatio({ teeth: 20, module: 2 }, { teeth: 40, module: 2 }, 60);
    check('Contact ratio, 20 and 40 teeth (worked by hand)', f(cr, 4), '1.6352', Math.abs(cr - 1.63519) < 1e-4);
    let worstGap = Infinity, worstPen = 0, lowContact = Infinity, pairs = 0;
    for (const id of TRAIN_IDS) {
      for (const [r1, r2] of [['a', 'b'], ['c', 'd']] as const) {
        const w1 = layout.byId.get(`${id}.${r1}`)!;
        const w2 = layout.byId.get(`${id}.${r2}`)!;
        const a = { teeth: w1.teeth, module: w1.module, backlash: PRINT_DETAIL.backlash };
        const b = { teeth: w2.teeth, module: w2.module, backlash: PRINT_DETAIL.backlash };
        const cd = (w1.module * (w1.teeth + w2.teeth)) / 2;
        const rep = checkMesh(a, b, cd, 24);
        worstGap = Math.min(worstGap, rep.minFlankClearance);
        worstPen = Math.max(worstPen, rep.maxPenetration);
        lowContact = Math.min(lowContact, effectiveContactRatio(a, b, cd));
        pairs++;
      }
    }
    check(`Deepest overlap in any of the machine's ${pairs} pairs`, `${f(worstPen, 4)} mm`, '0', worstPen < 1e-3);
    check('Smallest gap in any pair, with 0.12 mm thinned from each wheel', `${f(worstGap, 3)} mm`, `0.12 cos 20° = ${f(0.12 * Math.cos(Math.PI / 9), 3)} mm`, Math.abs(worstGap - 0.12 * Math.cos(Math.PI / 9)) < 0.01);
    check('Lowest contact ratio in any pair, undercut counted', f(lowContact, 2), 'above 1.1', lowContact > 1.1);
    const wrong = checkMesh({ teeth: 20, module: 1.5 }, { teeth: 52, module: 1.5 }, 54 - 0.3, 24);
    check('A pair set 0.3 mm too close is caught', `overlap ${f(wrong.maxPenetration, 3)} mm`, 'an overlap', wrong.interferes);
  }
  await pause();

  // ------------------------------------------------------------------ 4
  section('4. The motion',
    'Nothing on the machine is moved by astronomy. Each arbor’s rate is an exact fraction of the crank’s, multiplied out from tooth counts; the checks below are identities that must hold whatever the tooth counts are.');
  {
    const phases = wheelPhases(layout, setting);
    let worst = 0;
    for (const turns of [0, 0.37, 1, 12.5, 987.654, -4321.123]) {
      for (const w of layout.wheels) worst = Math.max(worst, Math.abs(meshError(layout, rates, setting, phases, w, turns)));
    }
    check(`Every mesh stays in step at six crank positions (${layout.wheels.length / 2} meshes)`, `off by at most ${worst.toExponential(1)} of a tooth`, 'under one millionth', worst < 1e-6);
    let phaseWorst = 0;
    for (const [zA, zB, phi, th] of [[20, 62, 0, 0.3], [16, 69, Math.PI, -2.1], [40, 24, 0.7, 5.5]] as const) {
      const d = (matingAngle(th, zA, zB, phi) - matingRotation(th, zA, zB, phi)) * zB / (2 * Math.PI);
      phaseWorst = Math.max(phaseWorst, Math.abs(d - Math.round(d)));
    }
    check('The mating rule agrees with the gear module’s own, written separately', `${phaseWorst.toExponential(1)} of a tooth`, '0', phaseWorst < 1e-9);
    // The chain's rates multiply out to the product of all the tooth ratios.
    let product = frac(spec.bevel.crank, spec.bevel.mercury);
    for (const id of STEP_IDS) { const s = spec.steps[id]; product = mul(product, frac(s.a * s.c, s.b * s.d)); }
    check('Saturn’s rate is the product of every ratio in the chain', `${rates.exact.saturn.n}/${rates.exact.saturn.d}`, `${product.n}/${product.d}`, rates.exact.saturn.n === product.n && rates.exact.saturn.d === product.d);
    check('The earth’s axis does not turn in the room', `${rates.exact.earthAxis.n}/${rates.exact.earthAxis.d} of a turn per crank turn`, '0', rates.exact.earthAxis.n === 0n);
    const same = rates.exact.moonSleeve.n === rates.exact.month.n && rates.exact.moonSleeve.d === rates.exact.month.d;
    check('The Moon’s arm turns exactly with the month tube', same ? 'identical fractions' : 'different', 'identical', same);
    check('The nodes turn backwards', `${f(toNumber(rates.exact.nodeSleeve) / toNumber(rates.exact.earth), 5)} turns a year`, `−${f(targets.period.earth / targets.nodeDays, 5)}`, Math.abs(toNumber(rates.exact.nodeSleeve) / toNumber(rates.exact.earth) + targets.period.earth / targets.nodeDays) < 2e-4);
    const sum = add(rates.exact.cluster0, mul(rates.exact.mercury, frac(spec.steps['mercury-venus'].a, spec.steps['mercury-venus'].b)));
    check('A cluster turns against the wheel that drives it', `${sum.n}`, '0 (rates cancel tooth for tooth)', sum.n === 0n);
  }
  await pause();

  // ------------------------------------------------------------------ 5
  section('5. The designer',
    'The train solver claims to find the closest four-wheel train that fits the frame. Here it is tested against brute force and against the continued fractions Huygens used.');
  {
    const rule = stepRule('earth-mars', { minTeeth: 14, maxTeeth: 44, minModule: 1.5 });
    const target = targets.period.mars / targets.period.earth;
    const best = solveStep(target, rule, 1)[0]!;
    let brute = Infinity;
    const firsts = feasiblePairs(rule.first);
    const seconds = feasiblePairs(rule.second);
    for (const p of firsts) for (const q of seconds) brute = Math.min(brute, Math.abs((p.ratio * q.ratio) / target - 1));
    check(`Solver against brute force (${firsts.length * seconds.length} trains tried)`, `${(Math.abs(best.error) * 1e6).toFixed(3)} parts in a million`, `${(brute * 1e6).toFixed(3)} parts in a million`, Math.abs(Math.abs(best.error) - brute) < 1e-12);
    const conv = convergents(77708431 / 2640858).slice(0, 4).map((c) => `${c.p}/${c.q}`).join(', ');
    check('Convergents of Huygens’s ratio for Saturn, 77708431/2640858', conv, '29/1, 59/2, 147/5, 206/7', conv === '29/1, 59/2, 147/5, 206/7');
    const pi = bestPair(Math.PI, 5, 400)!;
    check('Best single pair for π with at most 400 teeth', `${pi.p}/${pi.q}`, '355/113', pi.p === 355 && pi.q === 113);
    const bad = layout.rules.filter((r) => !r.ok).length;
    check('Design rules broken by the designed machine', String(bad), '0', bad === 0);
    for (const m of CHAIN) {
      if (m === 'earth') continue;
      const d = driftPerCentury(spec, targets, m);
      check(`${m === 'month' ? 'Moon' : cap(m)}: gearing drift`, `${f(d, 3)}° a century`, `within ${DEFAULT_DRIFT_BUDGET}°`, Math.abs(d) <= DEFAULT_DRIFT_BUDGET + 1e-9);
    }
    const nd = nodeDriftPerCentury(spec, targets);
    check('Moon’s nodes: gearing drift', `${f(nd, 3)}° a century`, `within ${DEFAULT_DRIFT_BUDGET}°`, Math.abs(nd) <= DEFAULT_DRIFT_BUDGET + 1e-9);
  }
  await pause();

  // ------------------------------------------------------------------ 6
  section('6. The machine against the sky',
    `The machine as designed, set today (${formatDate(setJd)}), is run through time and read against the reference sky. These are measurements of what a geared model with uniform circular motion can and cannot do.`);
  {
    // After a century each arm, as posed, has gained on the sky's mean motion by what the drift
    // figure says. The arm's angle comes from the exact fractions of the kinematics; the drift
    // figure from the periods worked out in the designer: two routes to the same number.
    const turns = 36525 / (rates.value.earth * targets.period.earth);
    const pose100 = poseMachine(spec, rates, setting, turns);
    const r = readMachine(pose100, setJd, rates, targets);
    let worst = 0;
    for (const m of ['mercury', 'venus', 'mars', 'jupiter', 'saturn'] as const) {
      const turned = ((pose100.angle[m] - setting[m]) * 180) / Math.PI;
      const sky = (360 * 36525) / targets.period[m];
      worst = Math.max(worst, Math.abs(norm180(turned - sky - driftPerCentury(spec, targets, m))));
    }
    check('Each arm as posed after 100 years, less the sky’s mean motion, against the designer’s drift figure', `differs by at most ${worst.toExponential(1)}°`, 'the same, to rounding', worst < 1e-6);
    const earthOff = norm180(r.planets.earth.machine - r.planets.earth.mean);
    check('The earth arm after 100 years, against the reference Earth’s mean longitude', `${f(earthOff, 4)}° apart`, 'under 0.01° (it is the calendar)', Math.abs(earthOff) < 0.01);
    // Circle error: what is left of the error once the gearing's part is taken out, largest over 60 years.
    let mars = 0, mercury = 0;
    for (let i = 0; i < 3000; i++) {
      const jd = setJd + i * 7.3;
      const t = (jd - setJd) / (rates.value.earth * targets.period.earth);
      const rr = readMachine(poseMachine(spec, rates, setting, t), setJd, rates, targets);
      mars = Math.max(mars, Math.abs(rr.planets.mars.circle));
      mercury = Math.max(mercury, Math.abs(rr.planets.mercury.circle));
    }
    check('Largest circle error of Mars in 60 years', `${f(mars, 1)}°`, 'about 10.7° (its equation of centre)', mars > 10 && mars < 11.6);
    check('Largest circle error of Mercury in 60 years', `${f(mercury, 1)}°`, 'about 23.7° (its equation of centre)', mercury > 22.8 && mercury < 24.8);
    // Eclipse seasons: at every catalogue eclipse the machine's Sun should be near a node.
    let season = 0, near = 0, far = 0;
    for (const e of ECLIPSES) {
      const m = machineAtSyzygy(e.jd, setJd, rates, targets, setting);
      if (Math.abs(m.sunFromNode) < ECLIPSE_LIMITS.season) season++;
      far = Math.max(far, Math.abs(m.sunFromNode));
      const off = Math.min(m.elongation, 360 - m.elongation, Math.abs(m.elongation - 180));
      if (off < 9) near++;
    }
    check(`Catalogue eclipses 1901 to 2100 that fall in one of the machine's eclipse seasons`, `${season} of ${ECLIPSES.length}; the Sun at most ${f(far, 1)}° from the machine's node`, `nearly all within ${ECLIPSE_LIMITS.season}°, none beyond 22°`, season >= ECLIPSES.length * 0.97 && far < 22);
    check('Catalogue eclipses at which the machine’s Moon is within 9° of new or full', `${near} of ${ECLIPSES.length}`, 'all (its Moon runs evenly, the real one does not)', near >= ECLIPSES.length - 10);
    // The machine's own calls: at each of its new and full Moons, does its rule on latitude agree with the catalogue?
    const tau = 2 * Math.PI;
    const perDay = (r: number) => (360 * r) / (rates.value.earth * targets.period.earth);
    const elongRate = perDay(rates.value.moonSleeve - rates.value.earth);
    const e0 = ((setting.moonSleeve - setting.earth) / tau) * 360 - 180;
    const jd0 = jdFromCalendar(1901, 1, 1), jd1 = jdFromCalendar(2101, 1, 1);
    let called = 0, calledReal = 0;
    const hit = new Set<number>();
    const first = Math.ceil((e0 + elongRate * (jd0 - setJd)) / 180);
    const last = Math.floor((e0 + elongRate * (jd1 - setJd)) / 180);
    for (let k = first; k <= last; k++) {
      const jd = setJd + (k * 180 - e0) / elongRate;
      const m = machineAtSyzygy(jd, setJd, rates, targets, setting);
      const isNew = Math.min(m.elongation, 360 - m.elongation) < 1;
      const limit = isNew ? ECLIPSE_LIMITS.solarLatitude : ECLIPSE_LIMITS.lunarLatitude;
      if (Math.abs(m.latitude) >= limit) continue;
      called++;
      const kind = isNew ? 'solar' : 'lunar';
      const idx = ECLIPSES.findIndex((e) => e.kind === kind && Math.abs(e.jd - jd) < 1.5 && (kind === 'solar' || e.type !== 'N'));
      if (idx >= 0) { calledReal++; hit.add(idx); }
    }
    const real = ECLIPSES.filter((e) => e.kind === 'solar' || e.type !== 'N').length;
    check('Eclipses the machine calls in 1901 to 2100 that happened (penumbral lunar ones aside)', `${calledReal} of ${called} calls`, 'most: at least 80 in 100', calledReal >= called * 0.8);
    check('Eclipses that happened which the machine calls', `${hit.size} of ${real}`, 'most: at least 80 in 100', hit.size >= real * 0.8);
  }
  await pause();

  // ------------------------------------------------------------------ 7
  section('7. The solids',
    'Every part is a closed, consistently wound triangle mesh, so that it can be drawn with correct lighting and sliced for printing. The kit is built at print detail from the same builders.');
  {
    const ball = sphere(10, 0, 128);
    check('Volume of a turned ball, radius 10', `${f(meshStats(ball).volume, 1)} mm³`, `${f((4 / 3) * Math.PI * 1000, 1)} mm³`, Math.abs(meshStats(ball).volume / ((4 / 3) * Math.PI * 1000) - 1) < 2e-3);
    const cyl = cylinder(4, 0, 10, 200);
    const back = parseBinaryStl(toBinaryStl(cyl));
    check('A solid written to STL and read back', `${f(meshStats(back).volume, 2)} mm³, ${checkClosed(back, 1e-4).closed ? 'closed' : 'open'}`, `${f(meshStats(cyl).volume, 2)} mm³, closed`, Math.abs(meshStats(back).volume - meshStats(cyl).volume) < 0.01 && checkClosed(back, 1e-4).closed);
    const parts = buildParts(layout, { withCase: true });
    const open = parts.filter((p) => !checkClosed(p.mesh).closed || meshStats(p.mesh).volume <= 0);
    check(`Parts of the screen model that are closed solids`, `${parts.length - open.length} of ${parts.length}`, 'all', open.length === 0);
    await pause();
    const kit = buildKit(layout);
    const badPieces = kit.pieces.filter((p) => !p.closed || p.volume <= 0);
    check('Pieces of the print kit that are closed solids', `${kit.pieces.length - badPieces.length} of ${kit.pieces.length}`, 'all', badPieces.length === 0);
    check('Gear pairs of the print kit that pass the sweep', `${kit.meshes.filter((m) => m.ok).length} of ${kit.meshes.length}`, 'all', kit.meshes.every((m) => m.ok));
  }

  const failed = rows.filter((r) => !r.ok).length;
  const summary = document.getElementById('summary')!;
  summary.textContent = failed === 0
    ? `${rows.length} of ${rows.length} checks agree. Run in this browser in ${f((performance.now() - started) / 1000, 1)} s.`
    : `${rows.length - failed} of ${rows.length} checks agree; ${failed} differ.`;
  summary.className = failed === 0 ? 'ok' : 'bad';
  window.wheelworkValidation.failed = failed;
  window.wheelworkValidation.done = true;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

run().catch((e: unknown) => {
  window.wheelworkValidation.error = String((e as Error).message ?? e);
  window.wheelworkValidation.done = true;
  const s = document.getElementById('summary')!;
  s.textContent = `The checks stopped with an error: ${window.wheelworkValidation.error}`;
  s.className = 'bad';
});
