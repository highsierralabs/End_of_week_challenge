// Compact numeric readout of a finished shower.
import { xmaxNucleusMatthews, xmaxPhoton } from '../physics/analytic';
import { altitudeAtDepth } from '../physics/atmosphere';
import { PRIMARY_MASS_NUMBER, RClass, RCLASS_COUNT, type ShowerResult } from '../physics/types';
import { CLASS_COLORS } from './colors';
import { h } from './dom';
import { compass, energyEV, metres, sci, si } from './format';

const PRIMARY_LABEL: Record<string, string> = {
  proton: 'Proton', helium: 'Helium', nitrogen: 'Nitrogen', iron: 'Iron', gamma: 'Gamma ray',
};

export function renderStats(el: HTMLElement, r: ShowerResult): void {
  el.classList.add('cx-stats');
  const p = r.params;
  const st = r.stats;
  const cosT = Math.max(0.05, Math.cos((p.zenithDeg * Math.PI) / 180));
  const A = PRIMARY_MASS_NUMBER[p.primary];
  const E0 = p.energyEV / 1e9;
  const ref = A > 0 ? xmaxNucleusMatthews(E0, A) : xmaxPhoton(E0);

  const cells: HTMLElement[] = [];
  cells.push(cell('Primary', `${PRIMARY_LABEL[p.primary] ?? p.primary} · ${energyEV(p.energyEV)}`,
    `θ ${p.zenithDeg.toFixed(0)}°, from ${p.azimuthDeg.toFixed(0)}° ${compass(p.azimuthDeg)} · core ${metres(Math.hypot(p.coreX, p.coreY))}`));

  const xf = st.firstInteractionDepth;
  const hFirst = Number.isFinite(xf) && xf >= 0 ? altitudeAtDepth(xf * cosT) : NaN;
  cells.push(cell('X₁ · first int.', Number.isFinite(xf) ? `${xf.toFixed(0)} g/cm²` : '—',
    Number.isFinite(hFirst) ? `${(hFirst / 1000).toFixed(1)} km a.s.l.` : ''));

  const gh = st.gh;
  // A maximum past the ground is an extrapolation of the fit, not a measurement of the profile.
  const beyond = gh && Number.isFinite(gh.xmax) && gh.xmax > r.stats.groundSlantDepth - 15;
  cells.push(cell(beyond ? 'Xmax · past ground' : 'Xmax · fit', gh && Number.isFinite(gh.xmax) ? (beyond ? `> ${r.stats.groundSlantDepth.toFixed(0)} g/cm²` : `${gh.xmax.toFixed(0)} g/cm²`) : 'no fit',
    Number.isFinite(ref) ? `HM ref. ${ref.toFixed(0)}${gh ? ` (${signed(gh.xmax - ref)})` : ''}` : ''));
  cells.push(cell('Nmax', gh && Number.isFinite(gh.nmax) ? si(gh.nmax) : '—', 'charged, at Xmax'));

  // ground counts per class
  const gc = st.groundCounts;
  const counts = h('div', { class: 'cx-st-counts' });
  for (let c = 0; c < RCLASS_COUNT; c++) {
    const col = CLASS_COLORS[c]!;
    const item = h('span', { class: 'cx-st-count', title: `${col.label}s reaching the ground (weighted)` },
      h('span', { class: 'cx-swatch', 'aria-hidden': 'true' }),
      h('span', { class: 'cx-st-sym', text: col.symbol }),
      h('span', { class: 'cx-st-num', text: si(gc[c] ?? 0) }),
    );
    item.style.setProperty('--sw', col.css);
    counts.append(item);
  }

  const ne = (gc[RClass.ELECTRON] ?? 0) + (gc[RClass.POSITRON] ?? 0);
  const nmu = gc[RClass.MUON] ?? 0;
  cells.push(cell('Muons per e±', ne > 0 ? ratio(nmu / ne) : nmu > 0 ? '∞' : '—', `${si(nmu)} μ / ${si(ne)} e±`));
  cells.push(cell('CPU', st.cpuMs >= 1000 ? `${(st.cpuMs / 1000).toFixed(2)} s` : `${st.cpuMs.toFixed(0)} ms`,
    `${si(st.particlesTracked)} tracked · ${si(st.interactions)} int.`));
  cells.push(cell('Thinning', p.thinning > 0 ? `ε = ${sci(p.thinning)}` : 'off',
    p.thinning > 0 ? `below ${energyEV(p.thinning * p.energyEV)}` : 'unweighted'));
  cells.push(cell('Ground', Number.isFinite(st.groundSlantDepth) ? `${st.groundSlantDepth.toFixed(0)} g/cm²` : '—',
    `${p.zenithDeg > 0.5 ? 'slant, ' : ''}${p.groundAltitudeM.toFixed(0)} m a.s.l.`));
  cells.push(h('div', { class: 'cx-st cx-st--wide' }, h('span', { class: 'cx-st-k', text: 'At ground (weighted)' }), counts));

  el.replaceChildren(...cells);
  if (st.truncated) {
    el.append(h('div', { class: 'cx-st-warn', role: 'note',
      text: `Track budget reached (${si(p.maxSegments)} segments): the 3D replay shows a uniform sample of the tracks. The charts and counts still use every particle.` }));
  }
}

/** Placeholder before the first shower. */
export function renderStatsEmpty(el: HTMLElement, msg = 'No shower yet. Choose a primary and press Simulate.'): void {
  el.classList.add('cx-stats');
  el.replaceChildren(h('div', { class: 'cx-st-empty', text: msg }));
}

function cell(k: string, v: string, sub: string): HTMLElement {
  return h('div', { class: 'cx-st' },
    h('span', { class: 'cx-st-k', text: k }),
    h('span', { class: 'cx-st-v', text: v }),
    sub ? h('span', { class: 'cx-st-s', text: sub }) : null,
  );
}

function signed(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`;
}

function ratio(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v >= 100) return v.toFixed(0);
  if (v >= 0.01) return v.toPrecision(2);
  return sci(v, 2);
}
