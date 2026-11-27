// Guided tour: air-shower physics taught through the simulator.
// Numbers are standard textbook values (Gaisser, Engel & Resconi, "Cosmic Rays and
// Particle Physics", 2nd ed., 2016; Matthews, Astropart. Phys. 22 (2005) 387; PDG
// Review of Particle Physics, "Cosmic rays" and "Passage of particles through
// matter"); where values depend on energy or model they are given as ranges.
import { moliereRadiusM, verticalDepth } from '../physics/atmosphere';
import { type ShowerParams } from '../physics/types';
import { type ChartTab } from './charts';
import { type CameraPreset } from './controls';
import { h, icon, ICONS } from './dom';

export interface TourStep {
  id: string;
  title: string;
  /** HTML. */
  body: string;
  params?: Partial<ShowerParams>;
  camera?: CameraPreset;
  play?: boolean;
  /** Chart tab worth looking at during this step (ChartsPanel.showTab). */
  chart?: ChartTab;
}

const SITE_ALT_M = 1539;
const SITE_DEPTH = Math.round(verticalDepth(SITE_ALT_M));
const SITE_RM = Math.round(moliereRadiusM(SITE_ALT_M) / 5) * 5;

export const TOUR: TourStep[] = [
  {
    id: 'cosmic-ray',
    title: 'A particle from deep space',
    body: `<p>A cosmic ray is an atomic nucleus moving at almost the speed of light. At GeV energies roughly 90% are protons,
      about 9% helium nuclei and around 1% heavier nuclei, with a small admixture of electrons.</p>
      <p>Their spectrum falls steeply, close to <i>E</i><sup>−2.7</sup>, up to the <em>knee</em> at a few PeV
      (1 PeV = 10<sup>15</sup> eV). Above the knee only about one particle per square metre per year arrives, so
      such cosmic rays are studied through the air showers they make. This shower: a 1 PeV proton.</p>`,
    params: { primary: 'proton', energyEV: 1e15, zenithDeg: 20 },
    camera: 'overview',
    chart: 'profile',
  },
  {
    id: 'first-interaction',
    title: 'The first collision, 15–25 km up',
    body: `<p>The primary flies on until it hits a nitrogen, oxygen or argon nucleus in the air. For a proton the mean
      free path (the <em>interaction length</em>) is roughly 45–90 g/cm² of air, shrinking slowly as energy rises
      and the cross section grows.</p>
      <p>The depth of that first collision is random, distributed exponentially, so it usually happens somewhere
      around 15–25 km above sea level. The readout shows it as <b>X₁</b>; the replay clock starts there.</p>`,
    camera: 'follow',
    play: true,
    chart: 'profile',
  },
  {
    id: 'hadronic-core',
    title: 'The hadronic core',
    body: `<p>Each high-energy collision makes tens to hundreds of new particles, mostly pions. A leading particle
      typically keeps a large share of the energy (very roughly half) and goes on to collide again.</p>
      <p>Their sideways momentum is only a few hundred MeV/c, tiny next to energies of TeV, so the hadrons stay in a
      narrow core along the axis. Cascade uses a calibrated toy model here, not a full hadronic event generator.</p>`,
    camera: 'side',
    play: true,
    chart: 'profile',
  },
  {
    id: 'em-cascade',
    title: 'Neutral pions start the electromagnetic cascade',
    body: `<p>About a third of the pions are neutral. A π⁰ lives only about 10<sup>−16</sup> s before decaying into two
      photons, which start an electromagnetic cascade: photons convert to e⁺e⁻ pairs, electrons radiate
      photons by bremsstrahlung, and so on.</p>
      <p>Heitler's cartoon makes it simple: every splitting length <i>X</i>₀ ln 2 the number of particles doubles
      and their energy halves, where the radiation length of air is <i>X</i>₀ ≈ 36.6 g/cm². Splitting stops at the
      <em>critical energy</em>, about 85 MeV in air, where ionisation losses take over. So
      <i>N</i><sub>max</sub> ≈ <i>E</i>₀/ξ<sub>c</sub> and <i>X</i><sub>max</sub> ≈ <i>X</i>₀ ln(<i>E</i>₀/ξ<sub>c</sub>).
      The cartoon gets the particle counts wrong (it predicts too many electrons per photon), but those scalings
      hold up well.</p>`,
    camera: 'side',
    play: true,
    chart: 'profile',
  },
  {
    id: 'xmax',
    title: 'Shower maximum and the elongation rate',
    body: `<p>The particle count rises, peaks at the depth of shower maximum <b>X<sub>max</sub></b>, then falls as
      particles drop below the critical energy and are absorbed. The profile chart shows it, with a
      Gaisser–Hillas curve fitted through it.</p>
      <p>The number of splittings grows like the logarithm of the energy, so X<sub>max</sub> moves deeper by a fixed
      amount per factor of ten in energy, the <em>elongation rate</em>: about 85 g/cm² per decade for a pure
      electromagnetic shower (<i>X</i>₀ ln 10), and roughly 55–65 g/cm² per decade for hadron-initiated showers.
      This step runs a shower ten times more energetic: watch X<sub>max</sub> move to the right.</p>`,
    params: { energyEV: 1e16 },
    camera: 'side',
    play: true,
    chart: 'profile',
  },
  {
    id: 'muons',
    title: 'Charged pions decay to muons',
    body: `<p>A charged pion lives 26 ns at rest (<i>c</i>τ ≈ 7.8 m). At high energy, time dilation stretches that
      enough that it usually hits another nucleus first. Only once its energy has fallen to a level of order tens of
      GeV (about 20 GeV in Matthews' model) does decay win: π → μ ν.</p>
      <p>Muons rarely interact. Their 2.2 μs lifetime (<i>c</i>τ ≈ 659 m) becomes tens of kilometres at a few GeV,
      and they lose only about 2 MeV per g/cm² of air, so most reach the ground. Their number grows a little slower
      than the energy, roughly as <i>E</i><sup>0.85–0.93</sup>.</p>`,
    params: { energyEV: 1e15 },
    camera: 'ground',
    play: true,
    chart: 'lateral',
  },
  {
    id: 'arrival',
    title: 'Muons arrive first',
    body: `<p>Muons are born high up and barely scatter, so they fly almost straight. Electrons and photons are
      scattered again and again by Coulomb fields and the cascade's own branching; their paths are longer and they
      fall behind.</p>
      <p>The timing chart measures each ground particle's delay behind an ideal flat front moving at <i>c</i>,
      for particles in a ring at a chosen distance from the core. Near the core everything arrives within a few ns.
      At a few hundred metres the muons arrive tens of ns ahead of the electrons and photons, which trail with a
      long tail, and the spread keeps growing with distance. Compare rings, not the pooled total: muons spread
      farther out, where the curved front lags more, so pooling all distances makes them look later.</p>`,
    camera: 'ground',
    play: true,
    chart: 'timing',
  },
  {
    id: 'front',
    title: 'A thin, curved front moving at the speed of light',
    body: `<p>All the particles ride together in a thin disc moving at almost <i>c</i>. Near the axis it is only
      metres thick (a few ns), thickening to tens or hundreds of ns at hundreds of metres out. The disc is slightly
      curved, because particles far from the axis come from higher up along longer paths.</p>
      <p>Its width is set by the <em>Molière radius</em>, about 9 g/cm² of air: roughly ${SITE_RM} m at this altitude.
      The lateral chart compares the simulated densities with the classic NKG function.</p>`,
    camera: 'side',
    play: true,
    chart: 'lateral',
  },
  {
    id: 'iron',
    title: 'Proton versus iron',
    body: `<p>Treat an iron nucleus of energy <i>E</i> as 56 nucleons, each with <i>E</i>/56: the <em>superposition</em>
      picture. Each sub-shower has less energy, so the whole shower peaks higher in the atmosphere. Elongation rate ×
      log<sub>10</sub>56 puts X<sub>max</sub> roughly 80–100 g/cm² shallower than for a proton.</p>
      <p>The many lower-energy pion cascades also put more energy into muons: about 1.4–1.8 times as many as a
      proton shower. Iron showers also fluctuate less from one to the next. Observatories use X<sub>max</sub> and
      muon counts together to infer the mass of cosmic rays statistically.</p>`,
    params: { primary: 'iron', energyEV: 1e15 },
    camera: 'side',
    play: true,
    chart: 'profile',
  },
  {
    id: 'gamma',
    title: 'Gamma-ray showers are muon-poor',
    body: `<p>A primary photon starts a nearly pure electromagnetic cascade. Muons come only from rare photonuclear
      interactions and muon-pair production, so a gamma-ray shower typically has several to ten or more times fewer
      muons than a proton shower of the same energy, and it reaches maximum deeper.</p>
      <p>That shortage of muons is how ground-based gamma-ray observatories pick out the rare photon showers from
      the far more numerous showers made by cosmic-ray nuclei.</p>`,
    params: { primary: 'gamma', energyEV: 1e15 },
    camera: 'side',
    play: true,
    chart: 'lateral',
  },
  {
    id: 'detector',
    title: 'What a small crystal in a lead castle sees',
    body: `<p>At ${SITE_ALT_M} m there are about ${SITE_DEPTH} g/cm² of air overhead (about 1030 at sea level). Most
      showers are small and peaked far above, so their electrons and photons have largely died out before reaching
      the ground. Thirty millimetres of lead is about 5.3 radiation lengths (<i>X</i>₀ = 5.6 mm in lead), which stops
      most of the remaining soft electromagnetic particles and blocks much of the local gamma background.</p>
      <p>A muon crosses that lead losing only about 40 MeV and leaves a few MeV in a centimetre of crystal. At sea
      level about one muon per cm² per minute crosses a horizontal surface, and about a third more at this altitude, so a
      crystal of about 1 cm³ sees one or two muons a minute (the <b>Data</b> panel has Cascade's estimate next to the
      observatory's measured rate). Almost every one is a lone muon from a small shower
      whose other particles landed far away. Even a big shower with 10 particles per m² puts only about 10<sup>−3</sup>
      of a particle on each cm². Neutrons and secondaries made in the lead also contribute; Cascade does not model
      them.</p>`,
    params: { primary: 'proton', energyEV: 1e15 },
    camera: 'detector',
    chart: 'footprint',
  },
  {
    id: 'your-turn',
    title: 'Over to you',
    body: `<p>Some things to try:</p>
      <ul>
        <li>Run one shower several times with different seeds and see how much X₁ and X<sub>max</sub> move.</li>
        <li>Tilt the shower to 60°: there is more air on the way to the ground, so the shower arrives older and richer
          in muons.</li>
        <li>Move the core a few hundred metres away and see what the detector gets.</li>
        <li>Set the thinning to "off" at 10 TeV to see the unweighted cascade.</li>
      </ul>
      <p>The About panel lists what the model leaves out.</p>`,
    camera: 'overview',
  },
];

export interface TourHandlers {
  onStep(step: TourStep): void;
  onClose(): void;
}

export interface Tour {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

export function createTour(el: HTMLElement, hd: TourHandlers, steps: TourStep[] = TOUR): Tour {
  let index = 0;
  let isOpen = false;
  let returnFocus: HTMLElement | null = null;

  const title = h('h2', { class: 'cx-tour-title', id: 'cx-tour-title' });
  const counter = h('span', { class: 'cx-tour-count' });
  const body = h('div', { class: 'cx-tour-body' });
  const dots = h('div', { class: 'cx-tour-dots', 'aria-hidden': 'true' });
  for (let i = 0; i < steps.length; i++) dots.append(h('span', { class: 'cx-tour-dot' }));
  const back = h('button', { type: 'button', class: 'cx-btn', text: 'Back' });
  const next = h('button', { type: 'button', class: 'cx-btn cx-btn--primary', text: 'Next' });
  const closeBtn = h('button', { type: 'button', class: 'cx-btn cx-btn--icon cx-tour-close', 'aria-label': 'Close tour', title: 'Close tour (Esc)' });
  closeBtn.append(icon(ICONS.close));
  const card = h('section', { class: 'cx-tour', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'cx-tour-title', hidden: true },
    h('header', { class: 'cx-tour-head' }, h('span', { class: 'cx-tour-kicker', text: 'Guided tour' }), counter, closeBtn),
    title,
    body,
    h('footer', { class: 'cx-tour-foot' }, dots, h('div', { class: 'cx-tour-nav' }, back, next)),
  );
  el.append(card);

  back.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => (index >= steps.length - 1 ? close() : go(index + 1)));
  closeBtn.addEventListener('click', () => close());
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowRight' && !(e.target instanceof HTMLInputElement)) go(index + 1);
    else if (e.key === 'ArrowLeft' && !(e.target instanceof HTMLInputElement)) go(index - 1);
  });
  window.addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape' && !document.querySelector('dialog[open]')) close();
  });

  function render(): void {
    const s = steps[index]!;
    title.textContent = s.title;
    body.innerHTML = s.body;
    counter.textContent = `${index + 1} / ${steps.length}`;
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
    dots.querySelectorAll('.cx-tour-dot').forEach((d, i) => d.classList.toggle('is-on', i === index));
    body.scrollTop = 0;
  }

  function go(i: number): void {
    if (i < 0 || i >= steps.length || i === index) return;
    index = i;
    render();
    hd.onStep(steps[index]!);
  }

  function open(): void {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    index = 0;
    isOpen = true;
    card.hidden = false;
    // buildLayout listens for this: it closes an open phone drawer and marks the root.
    el.dispatchEvent(new CustomEvent('cx:tour', { bubbles: true, detail: { open: true } }));
    render();
    requestAnimationFrame(() => card.classList.add('is-in'));
    next.focus({ preventScroll: true });
    hd.onStep(steps[0]!);
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    card.classList.remove('is-in');
    card.hidden = true;
    el.dispatchEvent(new CustomEvent('cx:tour', { bubbles: true, detail: { open: false } }));
    returnFocus?.focus({ preventScroll: true });
    hd.onClose();
  }

  return {
    open,
    close,
    get isOpen() { return isOpen; },
  };
}
