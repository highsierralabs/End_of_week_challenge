// Observatory dialog: the RHACO aggregate snapshot next to Cascade's rate-mode
// prediction for a 1 cm^3 crystal in a lead castle at the same depth.
//
// Honest-scope rules followed here (after the observatory's own Measurement
// Philosophy): measured and simulated numbers are labelled as such; the
// overflow channel is "deposits above 2.78 MeV", never "muons"; classifier
// event classes are categories, not particle identifications; the
// two-component split is an inference with its assumptions spelled out.
import snapshot from '../data/rhaco_snapshot.json';
import rateSite from '../data/rate_site.json';
import rateSea from '../data/rate_sea.json';
import corehits from '../data/corehits.json';
import { h, icon, ICONS } from './dom';
import { Axis, INK, MONO, SANS, Surface, drawAxes, drawSeries, haloText, type Rect } from './plot';

/** PDG: vertical muon intensity above 1 GeV/c at sea level, m^-2 s^-1 sr^-1. */
const PDG_IV_SEA = 70;
/** Typical NM64 neutron-monitor barometric coefficient, percent per hPa (range ~ -0.65 to -0.75). */
const BETA_NEUTRON = -0.72;

interface Daily { date: string[]; [k: string]: unknown[] }

export interface Comparison {
  measured: { rate: number; err: number; days: number; beta: number; betaErr: number; betaDoc: number };
  sim: {
    rawRate: number; rawErr: number; anchor: number; rate: number; rateErr: number; bare: number;
    beta: number; betaErr: number; ivSite: number; ivSea: number; fluxSite: number; primaries: number;
  };
  inference: { fRate: number; fRateErr: number; fBaro: number; fBaroErr: number };
}

/** Derive the comparison numbers (exported for tests). */
export function compare(): Comparison {
  const ov = snapshot.overflow_summary;
  const br = snapshot.barometric_regression;
  const site = rateSite.planes[1]!;
  const seaIv = rateSea.planes[1]!.verticalIntensity1GeV * 1e4;
  const anchor = PDG_IV_SEA / seaIv;
  const rate = site.crystalShielded * anchor;
  // The anchor carries the sea-level statistical error too (vertical muons are a small subset).
  const seaRel = 1 / Math.sqrt(Math.max(1, rateSea.planes[1]!.muons * 0.05));
  const rateErr = rate * Math.hypot(site.crystalShieldedRelErr, seaRel);
  const meas = ov.post_settling_rate_cps;
  const bMeas = br.pressure_only.coeff_pct_per_hpa;
  const bMeasErr = br.pressure_only.se_scaled_pct_per_hpa;
  const bSim = rateSite.barometricPctPerHPa;
  const bSimErr = rateSite.barometricErr;
  const fRate = 1 - rate / meas;
  const fRateErr = rateErr / meas;
  const fBaro = (bMeas - bSim) / (BETA_NEUTRON - bSim);
  const fBaroErr = Math.hypot(bMeasErr, bSimErr) / Math.abs(BETA_NEUTRON - bSim);
  return {
    measured: { rate: meas, err: ov.post_settling_rate_err_cps, days: ov.post_settling_days, beta: bMeas, betaErr: bMeasErr, betaDoc: br.documented_coeff_pct_per_hpa },
    sim: {
      rawRate: site.crystalShielded, rawErr: site.crystalShielded * site.crystalShieldedRelErr, anchor, rate, rateErr,
      bare: site.crystalBare * anchor, beta: bSim, betaErr: bSimErr, ivSite: site.verticalIntensity1GeV * 1e4, ivSea: seaIv,
      fluxSite: site.horizontalFlux * anchor, primaries: rateSite.options.primaries,
    },
    inference: { fRate, fRateErr, fBaro, fBaroErr },
  };
}

const f = (v: number, d = 3): string => v.toFixed(d);
/** Round to one significant figure, for order-of-magnitude statements. */
const round1 = (v: number): string => { const p = 10 ** Math.floor(Math.log10(Math.abs(v) || 1)); return String(Math.round(v / p) * p); };

/** Plain-language comparison of the two estimates of the non-muon share. */
function verdict(c: Comparison): string {
  const a = c.inference.fRate * 100, b = c.inference.fBaro * 100;
  const err = Math.hypot(c.inference.fRateErr, c.inference.fBaroErr) * 100;
  const head = `Here the two estimates are ${a.toFixed(0)} % and ${b.toFixed(0)} %.`;
  if (Math.abs(a - b) <= 2 * err) {
    return `  ${head} They agree within their statistical errors, so the &ldquo;muons plus a soft component&rdquo; picture is worth testing.`;
  }
  return `  ${head} They differ by more than their statistical errors. The rate-based estimate rests on the absolute scale, and the raw model
    was off by a factor of about ${(1 / c.sim.anchor).toFixed(1)} before anchoring, so the pressure-based estimate is probably the sturdier of the two.
    The gap means the muon prediction is off, or the soft component does not respond to pressure like a neutron monitor, or both.`;
}
const pm = (v: number, e: number, d = 3): string => `${v.toFixed(d)} &plusmn; ${e.toFixed(d)}`;

export interface Observatory { open(): void; close(): void }

export function createObservatory(el: HTMLElement): Observatory {
  const c = compare();
  const closeBtn = h('button', { type: 'button', class: 'cx-btn cx-btn--icon cx-about-close', 'aria-label': 'Close', title: 'Close (Esc)' });
  closeBtn.append(icon(ICONS.close));
  const prov = snapshot.provenance;
  const cards = `
  <div class="cx-obs-cards">
    <div class="cx-obs-card cx-obs-card--meas">
      <div class="cx-obs-k">Measured &middot; overflow channel</div>
      <div class="cx-obs-v">${pm(c.measured.rate, c.measured.err, 4)} <span>counts/s</span></div>
      <div class="cx-obs-n">Deposits above 2.78 MeV in the shielded crystal, ${c.measured.days} settled days.
        Any particle that deposits that much counts, not only muons.</div>
    </div>
    <div class="cx-obs-card cx-obs-card--sim">
      <div class="cx-obs-k">Simulated &middot; muons only</div>
      <div class="cx-obs-v">${pm(c.sim.rate, c.sim.rateErr, 4)} <span>counts/s</span></div>
      <div class="cx-obs-n">Muons that get through the lead and cross at least ${f(2.78 / 5.6, 2)} cm of crystal.
        Toy model anchored to the PDG sea-level muon intensity (scale factor ${f(c.sim.anchor, 2)}; raw model ${f(c.sim.rawRate, 4)}).</div>
    </div>
    <div class="cx-obs-card">
      <div class="cx-obs-k">Barometric coefficient</div>
      <div class="cx-obs-v">${pm(c.measured.beta, c.measured.betaErr, 2)} <span>%/hPa measured</span></div>
      <div class="cx-obs-n">Simulated muons: ${pm(c.sim.beta, c.sim.betaErr, 2)} %/hPa &middot; documented site value ${f(c.measured.betaDoc, 2)} &middot;
        typical neutron monitor about ${f(BETA_NEUTRON, 2)}.</div>
    </div>
  </div>`;

  const reading = `
  <h3>A two-component reading <span class="cx-obs-tag">inference, not a measurement</span></h3>
  <p>Suppose the overflow channel is a sum of two components: muons, as simulated, and a "soft" component whose pressure
  response looks like a neutron monitor's (around ${f(BETA_NEUTRON, 2)} %/hPa). Examples are neutrons captured in the lead,
  which emit gamma rays of several MeV, and electromagnetic or hadronic secondaries made in the castle. These two
  measurements give two independent estimates of the non-muon share:</p>
  <ul>
    <li><b>From the rate:</b> 1 &minus; simulated/measured = <b>${pm(c.inference.fRate * 100, c.inference.fRateErr * 100, 0)} %</b>.
      This leans on the absolute normalisation: the primary spectrum (PDG power law, no solar modulation), the
      geomagnetic cutoff (taken as a 4.5 GeV nucleon threshold) and the toy hadronic model. Its systematic error is
      larger than the statistical one shown.</li>
    <li><b>From the pressure slope:</b> (&beta;<sub>meas</sub> &minus; &beta;<sub>&mu;</sub>) / (&beta;<sub>n</sub> &minus; &beta;<sub>&mu;</sub>) =
      <b>${pm(c.inference.fBaro * 100, c.inference.fBaroErr * 100, 0)} %</b>. This needs no absolute normalisation, but it
      assumes the soft component responds like a neutron monitor, and it ignores temperature effects on the muon rate.</li>
  </ul>
  <p>${verdict(c)} Either way, the instrument defines the category: the overflow channel measures deposits,
  and this split is an interpretation layered on top of it. Ways to test it include a coincidence measurement against
  a second detector, extra polyethylene or borated shielding around the castle, and the spectrum shape above 2.78 MeV.</p>`;

  const easDay = (snapshot.event_class_totals.EAS.per_live_day + snapshot.event_class_totals['SUPER-EAS'].per_live_day);
  const ch = corehits as { ratePerDay: number[]; ratePerYear: number[]; thresholdsPerCm2: number[] };
  const cores = `
  <h3>Could the EAS categories be shower cores? <span class="cx-obs-tag">simulation estimate</span></h3>
  <p>A crystal with about 1.3 cm&sup2; of effective area catches two or more particles from one shower only where the
  shower's local density is around one charged particle per cm&sup2; (10<sup>4</sup> per m&sup2;). That happens only within a few metres of the
  core of a shower above about 10<sup>16.5</sup> eV. Cascade estimates how often such a core lands on a given point:
  it simulates proton showers from 10<sup>14</sup> to 10<sup>18</sup> eV, measures their ground density against core
  distance, and folds the area above each threshold with the all-particle cosmic-ray flux.</p>
  <ul>
    <li>&ge; 1 charged particle per cm&sup2; (two or so through the crystal): about <b>${ch.ratePerYear[1]!.toFixed(0)} per year</b> (${ch.ratePerDay[1]!.toFixed(2)} per day).</li>
    <li>&ge; 3 per cm&sup2; (about four through the crystal): about <b>${ch.ratePerYear[2]!.toFixed(1)} per year</b>.</li>
    <li>The classifier's EAS and SUPER-EAS categories together: <b>${easDay.toFixed(1)} per live day</b>.</li>
  </ul>
  <p>Suppose an 8&times; or larger ratio needed several particles to cross the crystal at once. Then these categories
  would fire about ${round1(easDay / ch.ratePerDay[1]!)} to ${round1(easDay / ch.ratePerDay[2]!)} times more often than shower cores can supply. That holds for a bare crystal,
  and the lead would lower the shower side further. The estimate is rough: proton showers only, near-core densities
  from thinned showers, and a flux normalisation good to about a factor of two. Even a factor of a few either way leaves a gap. The reading consistent with the observatory's own rule, that measurement defines category, is that
  the EAS label marks a count-rate pattern. Whether those patterns come from single large deposits, from how the
  firmware turns counts into a rate, or from rare multi-particle hits is a question for the instrument, not one this
  simulation can settle.</p>`;
  const scope = `
  <h3>Honest scope</h3>
  <ul class="cx-obs-scope">
    <li><b>Detector:</b> ${prov.detector}; <b>shielding:</b> ${prov.shielding}; <b>configuration:</b> ${prov.configuration_era}.</li>
    <li><b>Window:</b> ${prov.window_utc.start.slice(0, 10)} to ${prov.window_utc.last_complete_day} (UTC days). <b>Classifier versions in window:</b>
      ${prov.classifier_versions_in_window.join(', ')}. <b>Baselines:</b> gamma ${prov.baselines.gamma_cps} cps, overflow ${prov.baselines.overflow_cps} &plusmn; ${prov.baselines.overflow_err_cps} cps.</li>
    <li>The measured overflow rate (${f(c.measured.rate, 5)} cps) sits slightly below the locked reference (${prov.baselines.overflow_cps} cps).
      The snapshot does not settle why; it is reported, not interpreted.</li>
    <li>The simulation does not model: electromagnetic punch-through, neutron production or capture in lead,
      hadrons, knock-on electrons, the CsI light yield, the firmware's filtering, solar modulation or temperature effects.
      Its muon flux at the site is ${f(c.sim.fluxSite * 60, 2)} per cm&sup2; per minute through a horizontal surface (anchored).</li>
    <li>The event categories in the charts above are the logger classifier's categories, defined by ratios of firmware-filtered count rates.
      They are not particle identifications. In particular, "EAS" below 15&times; is what is left after RADON events are taken out.</li>
    <li>Data: aggregate snapshot from the RHACO citizen observatory, generated ${prov.generated_utc.slice(0, 10)}. No per-event records are included.</li>
  </ul>`;

  const charts = h('div', { class: 'cx-obs-charts' });
  const mk = (title: string, note: string): HTMLCanvasElement => {
    const cv = h('canvas', { class: 'cx-obs-canvas' });
    charts.append(h('figure', { class: 'cx-obs-fig' }, h('figcaption', { text: title }), cv, h('p', { class: 'cx-obs-note', text: note })));
    return cv;
  };
  const cvSeries = mk('Daily overflow rate and station pressure', 'Points: daily rate with Poisson errors (settling days and days below 90% coverage are greyed). Line: daily mean pressure, axis inverted, to show the anti-correlation.');
  const cvScatter = mk('Rate against pressure', 'Lines through the mean: measured weighted fit (solid), the simulated muon-only slope (dashed) and the documented site coefficient (dotted).');
  const cvClasses = mk('Classifier event categories per live day', 'Logger categories over the window. These are classifier labels, not physics.');
  const cvHist = mk('EAS and SUPER-EAS classification ratios', 'Trigger count rate divided by the 5-minute rolling median, in log-spaced bins.');

  const body = h('div', { class: 'cx-about-body cx-obs-body' });
  body.insertAdjacentHTML('beforeend', `<p class="cx-about-lede">Cascade's site is modelled on a real citizen observatory:
    a 1 cm&sup3; CsI(Tl) crystal in a lead castle at 1539 m, recording since spring 2026. This page sets the simulated muon rain
    beside that instrument's own daily aggregates.</p>${cards}`);
  body.append(charts);
  body.insertAdjacentHTML('beforeend', reading + cores + scope);

  const dlg = h('dialog', { class: 'cx-about cx-obs', 'aria-labelledby': 'cx-obs-title' },
    h('header', { class: 'cx-about-head' },
      h('div', null,
        h('div', { class: 'cx-about-kicker', text: 'Observatory' }),
        h('h2', { id: 'cx-obs-title', class: 'cx-about-title', text: 'RHACO data and the simulation' }),
      ),
      closeBtn,
    ),
    body,
  );
  el.append(dlg);
  closeBtn.addEventListener('click', () => close());
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
  });

  const draw = (): void => {
    drawSeriesChart(cvSeries);
    drawScatter(cvScatter, c);
    drawClasses(cvClasses);
    drawHist(cvHist);
  };
  const ro = new ResizeObserver(() => { if (dlg.open) draw(); });
  ro.observe(charts);

  function open(): void {
    if (dlg.open) return;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    body.scrollTop = 0;
    requestAnimationFrame(draw);
  }
  function close(): void {
    if (!dlg.open) return;
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }
  return { open, close };
}

// ---------------------------------------------------------------- charts

function surfaceOf(cv: HTMLCanvasElement): { s: Surface; frame: Rect } | null {
  const s = new Surface(cv);
  const r = cv.getBoundingClientRect();
  if (!s.fit(r.width, r.height)) return null;
  return { s, frame: { x: 52, y: 12, w: s.w - 52 - 52, h: s.h - 12 - 36 } };
}

function dayIndex(d: string): number {
  return Date.parse(`${d}T12:00:00Z`) / 86400000;
}

function drawSeriesChart(cv: HTMLCanvasElement): void {
  const o = snapshot.overflow_daily as unknown as Daily;
  const p = snapshot.pressure_daily as unknown as Daily;
  const g = surfaceOf(cv);
  if (!g) return;
  const { s, frame } = g;
  const days = o.date.map(dayIndex);
  const rate = o.rate_cps as (number | null)[];
  const err = o.rate_err_cps as (number | null)[];
  const cov = o.coverage as (number | null)[];
  const settling = o.settling as boolean[];
  const finite = rate.filter((v, i) => v !== null && !settling[i] && (cov[i] ?? 0) >= 0.9) as number[];
  const lo = Math.min(...finite) * 0.985, hi = Math.max(...finite) * 1.015;
  const x = new Axis(days[0]!, days[days.length - 1]!, false, frame.x, frame.x + frame.w);
  const y = new Axis(lo, hi, false, frame.y + frame.h, frame.y);
  const monthTicks: number[] = [];
  for (let d = new Date(`${o.date[0]}T00:00:00Z`); d.getTime() / 86400000 <= days[days.length - 1]!; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
    const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 86400000;
    if (t >= days[0]!) monthTicks.push(t);
  }
  drawAxes(s, {
    frame, x, y, xLabel: 'UTC date (2026)', yLabel: 'overflow rate (counts/s)', xTicks: monthTicks,
    xFmt: (v) => new Date(v * 86400000).toLocaleString('en', { month: 'short', timeZone: 'UTC' }), yFmt: (v) => v.toFixed(4),
  });
  // Pressure on an inverted right axis.
  const pr = p.pressure_hpa as (number | null)[];
  const pf = pr.filter((v): v is number => v !== null);
  // Inverted: low pressure at the top, so the trace mirrors the rate.
  const yp = new Axis(Math.min(...pf) - 1, Math.max(...pf) + 1, false, frame.y, frame.y + frame.h);
  const pd = p.date.map(dayIndex);
  drawSeries(s, x, yp, pd, pr.map((v) => v ?? NaN), { color: '#a7b6ff', width: 1.2, alpha: 0.75 });
  const ctx = s.ctx;
  ctx.save();
  ctx.font = `10px ${MONO}`;
  ctx.fillStyle = '#a7b6ff';
  ctx.textAlign = 'left';
  for (const v of [Math.round(Math.min(...pf)), Math.round((Math.min(...pf) + Math.max(...pf)) / 2), Math.round(Math.max(...pf))]) {
    ctx.fillText(`${v}`, frame.x + frame.w + 6, yp.map(v) + 3);
  }
  ctx.translate(s.w - 8, frame.y + frame.h / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.font = `10.5px ${SANS}`;
  ctx.fillText('pressure (hPa, inverted)', 0, 0);
  ctx.restore();
  // Rate points.
  for (let i = 0; i < days.length; i++) {
    const v = rate[i];
    if (v === null || v === undefined) continue;
    const good = !settling[i] && (cov[i] ?? 0) >= 0.9;
    const px = x.map(days[i]!);
    const e = err[i] ?? 0;
    ctx.strokeStyle = good ? 'rgba(125,255,122,0.45)' : 'rgba(140,150,170,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, y.map(v - e));
    ctx.lineTo(px, y.map(v + e));
    ctx.stroke();
    ctx.fillStyle = good ? '#7dff7a' : '#68707f';
    ctx.beginPath();
    ctx.arc(px, y.map(v), 1.8, 0, 2 * Math.PI);
    ctx.fill();
  }
  haloText(ctx, 'overflow rate', frame.x + 8, frame.y + 14, '#7dff7a');
  haloText(ctx, 'pressure', frame.x + 8, frame.y + 28, '#a7b6ff');
}

function drawScatter(cv: HTMLCanvasElement, c: Comparison): void {
  const o = snapshot.overflow_daily as unknown as Daily;
  const p = snapshot.pressure_daily as unknown as Daily;
  const g = surfaceOf(cv);
  if (!g) return;
  const { s, frame } = g;
  frame.w = s.w - frame.x - 14;
  const pts: [number, number, number][] = [];
  const pmap = new Map<string, number>();
  p.date.forEach((d, i) => { const v = (p.pressure_hpa as (number | null)[])[i]; if (v !== null && v !== undefined) pmap.set(d, v); });
  o.date.forEach((d, i) => {
    const r = (o.rate_cps as (number | null)[])[i];
    const e = (o.rate_err_cps as (number | null)[])[i];
    const ok = !(o.settling as boolean[])[i] && ((o.coverage as (number | null)[])[i] ?? 0) >= 0.9;
    const pv = pmap.get(d);
    if (r !== null && r !== undefined && e !== null && e !== undefined && ok && pv !== undefined) pts.push([pv, r, e]);
  });
  if (pts.length < 3) return;
  const px = pts.map((q) => q[0]);
  const ry = pts.map((q) => q[1]);
  const x = new Axis(Math.min(...px) - 1, Math.max(...px) + 1, false, frame.x, frame.x + frame.w);
  const y = new Axis(Math.min(...ry) * 0.99, Math.max(...ry) * 1.01, false, frame.y + frame.h, frame.y);
  drawAxes(s, { frame, x, y, xLabel: 'daily mean pressure (hPa)', yLabel: 'overflow rate (counts/s)', yFmt: (v) => v.toFixed(4) });
  const ctx = s.ctx;
  for (const [pv, r, e] of pts) {
    ctx.strokeStyle = 'rgba(125,255,122,0.35)';
    ctx.beginPath();
    ctx.moveTo(x.map(pv), y.map(r - e));
    ctx.lineTo(x.map(pv), y.map(r + e));
    ctx.stroke();
    ctx.fillStyle = '#7dff7a';
    ctx.beginPath();
    ctx.arc(x.map(pv), y.map(r), 2, 0, 2 * Math.PI);
    ctx.fill();
  }
  const br = snapshot.barometric_regression;
  const P0 = br.mean_pressure_hpa;
  const R0 = br.pressure_only.rate_at_mean_pressure_cps;
  const line = (beta: number, style: { color: string; dash?: number[] }): void => {
    const xs = [x.min, x.max];
    drawSeries(s, x, y, xs, xs.map((pv) => R0 * (1 + (beta / 100) * (pv - P0))), { ...style, width: 1.6 });
  };
  line(c.measured.beta, { color: '#e8edf7' });
  line(c.sim.beta, { color: '#ffcf5a', dash: [6, 4] });
  line(c.measured.betaDoc, { color: '#a7b6ff', dash: [1.5, 3.5] });
  haloText(ctx, `measured ${c.measured.beta.toFixed(2)} %/hPa`, frame.x + frame.w - 8, frame.y + 14, '#e8edf7', undefined, 'right');
  haloText(ctx, `simulated muons ${c.sim.beta.toFixed(2)}`, frame.x + frame.w - 8, frame.y + 28, '#ffcf5a', undefined, 'right');
  haloText(ctx, `documented ${c.measured.betaDoc.toFixed(2)}`, frame.x + frame.w - 8, frame.y + 42, '#a7b6ff', undefined, 'right');
}

function drawClasses(cv: HTMLCanvasElement): void {
  const g = surfaceOf(cv);
  if (!g) return;
  const { s } = g;
  const t = snapshot.event_class_totals as unknown as Record<string, { per_live_day: number; per_live_day_poisson_err: number; total: number }>;
  const names = ['MUON_SUB', 'RADON', 'MUON', 'EAS', 'SUPER-EAS', 'INCLINED-EAS'];
  const colors = ['#4fd8ff', '#ff7a3d', '#7dff7a', '#ffcf5a', '#ff5fd2', '#a7b6ff'];
  const frame = { x: 104, y: 10, w: s.w - 104 - 64, h: s.h - 10 - 36 };
  const max = Math.max(...names.map((n) => t[n]?.per_live_day ?? 0)) * 1.15;
  const x = new Axis(0.1, max, true, frame.x, frame.x + frame.w);
  const yAxis = new Axis(0, names.length, false, frame.y, frame.y + frame.h);
  drawAxes(s, { frame, x, y: yAxis, xLabel: 'events per live day (log)', yLabel: '', yTicks: [] });
  const ctx = s.ctx;
  const bh = (frame.h / names.length) * 0.62;
  names.forEach((n, i) => {
    const v = t[n];
    if (!v) return;
    const yc = yAxis.map(i + 0.5);
    ctx.fillStyle = colors[i]!;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(frame.x, yc - bh / 2, x.map(Math.max(v.per_live_day, 0.1)) - frame.x, bh);
    ctx.globalAlpha = 1;
    ctx.font = `10.5px ${MONO}`;
    ctx.fillStyle = INK.text;
    ctx.textAlign = 'right';
    ctx.fillText(n, frame.x - 6, yc + 3.5);
    ctx.textAlign = 'left';
    ctx.fillText(`${v.per_live_day.toFixed(2)}`, x.map(v.per_live_day) + 5, yc + 3.5);
  });
}

function drawHist(cv: HTMLCanvasElement): void {
  const g = surfaceOf(cv);
  if (!g) return;
  const { s, frame } = g;
  frame.w = s.w - frame.x - 14;
  const hst = snapshot.eas_ratio_histogram;
  const edges = hst.bin_edges;
  const eas = hst.EAS;
  const sup = hst['SUPER-EAS'];
  const max = Math.max(...eas.map((v, i) => v + (sup[i] ?? 0))) * 1.15;
  const x = new Axis(edges[0]!, edges[edges.length - 1]!, true, frame.x, frame.x + frame.w);
  const y = new Axis(0, max, false, frame.y + frame.h, frame.y);
  drawAxes(s, { frame, x, y, xLabel: 'classification ratio (x baseline)', yLabel: 'events', xTicks: [8, 15, 30, 50, 100, 300], xFmt: (v) => `${v}` });
  const ctx = s.ctx;
  for (let i = 0; i < edges.length - 1; i++) {
    const x0 = x.map(edges[i]!) + 1, x1 = x.map(edges[i + 1]!) - 1;
    const a = eas[i] ?? 0, b = sup[i] ?? 0;
    ctx.fillStyle = '#ffcf5a';
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x0, y.map(a), x1 - x0, y.map(0) - y.map(a));
    ctx.fillStyle = '#ff5fd2';
    ctx.fillRect(x0, y.map(a + b), x1 - x0, y.map(a) - y.map(a + b));
    ctx.globalAlpha = 1;
  }
  haloText(ctx, `EAS (${hst.EAS.reduce((p, v) => p + v, 0)})`, frame.x + frame.w - 8, frame.y + 14, '#ffcf5a', undefined, 'right');
  haloText(ctx, `SUPER-EAS (${hst['SUPER-EAS'].reduce((p, v) => p + v, 0)})`, frame.x + frame.w - 8, frame.y + 28, '#ff5fd2', undefined, 'right');
  haloText(ctx, `median ${hst.median_ratio.toFixed(1)}x`, frame.x + frame.w - 8, frame.y + 42, INK.muted, undefined, 'right');
}
