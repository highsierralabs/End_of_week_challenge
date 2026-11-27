// About modal: what Cascade is, the model and its limits, references, credits.
import { h, icon, ICONS } from './dom';

const ABOUT_HTML = `
<p class="cx-about-lede">Cascade simulates a cosmic-ray air shower particle by particle in your browser, then
replays it in 3D over the high desert north of Reno, Nevada, at a slow-motion factor you choose.</p>

<h3>The physics model, briefly</h3>
<ul>
  <li><b>Atmosphere:</b> Linsley's five-layer parameterisation of the US Standard Atmosphere (as in CORSIKA).
    The ground is a flat plane at 1539 m, about 861 g/cm² of vertical depth.</li>
  <li><b>Hadrons:</b> a calibrated toy model with energy-dependent proton–air and pion–air cross sections,
    multiplicity from a UA5-style fit scaled to an air target, leading-particle inelasticity and exponential
    transverse momentum. Nuclei by semi-superposition.</li>
  <li><b>Decays:</b> exact two-body kinematics for π⁰ → γγ and π → μν.</li>
  <li><b>Muons:</b> continuous energy loss, decay in flight, multiple scattering.</li>
  <li><b>Electromagnetic cascade:</b> Bethe–Heitler bremsstrahlung and pair production (complete screening),
    Klein–Nishina Compton scattering, continuous ionisation, Highland multiple scattering.</li>
  <li><b>Thinning:</b> Hillas thinning with a weight limit; every ground particle carries a weight.</li>
  <li><b>Checks:</b> results are compared with Heitler–Matthews scalings and published X<sub>max</sub> and
    muon-number figures in the unit tests and the validation page.</li>
</ul>

<h3>Honest limitations</h3>
<ul>
  <li>The hadronic model is a toy. It is not QGSJET, EPOS or SIBYLL, and absolute muon numbers and
    X<sub>max</sub> carry model uncertainty well beyond the statistical spread.</li>
  <li>No kaons, charm, baryon–antibaryon production or diffraction.</li>
  <li>Flat atmosphere and flat ground; no curvature of the Earth, which matters only near the horizon.</li>
  <li>No geomagnetic field, so positive and negative particles are not pulled apart (this matters most for muons in inclined showers).</li>
  <li>No Landau–Pomeranchuk–Migdal suppression, which matters for photon showers above about 10<sup>19</sup> eV.</li>
  <li>Thinning trades fluctuations for speed: weighted densities far from the core are noisy.</li>
  <li>The 3D terrain is real, but the physics ground is flat; the detector and its lead castle are drawn,
    not simulated.</li>
</ul>

<h3>References</h3>
<ul class="cx-refs">
  <li>T. K. Gaisser, R. Engel, E. Resconi, <i>Cosmic Rays and Particle Physics</i>, 2nd ed., Cambridge University Press (2016).</li>
  <li>J. Matthews, "A Heitler model of extensive air showers", <i>Astropart. Phys.</i> 22 (2005) 387.</li>
  <li>Particle Data Group, <i>Review of Particle Physics</i>: "Cosmic rays" and "Passage of particles through matter".</li>
  <li>D. Heck et al., "CORSIKA: A Monte Carlo code to simulate extensive air showers", report FZKA 6019 (1998).</li>
  <li>K. Kamata, J. Nishimura, <i>Prog. Theor. Phys. Suppl.</i> 6 (1958) 93; K. Greisen, <i>Ann. Rev. Nucl. Sci.</i> 10 (1960) 63 (the NKG function).</li>
  <li>T. K. Gaisser, A. M. Hillas, Proc. 15th ICRC, Plovdiv (1977) (the Gaisser–Hillas profile).</li>
  <li>V. L. Highland, <i>Nucl. Instrum. Methods</i> 129 (1975) 497 (multiple scattering).</li>
</ul>

<h3>Credits</h3>
<ul>
  <li>Inspired by the RHACO citizen cosmic-ray observatory in Stead, Nevada. The scene origin is an illustrative
    point on the valley floor, not the observatory's location.</li>
  <li>Terrain: Terrain Tiles on AWS Open Data (Mapzen/Linux Foundation), sourced from USGS 3DEP and others.</li>
  <li>Rendering: three.js (WebGPU, with a WebGL2 fallback).</li>
  <li>Built with Claude Code (Claude Opus 5.5).</li>
</ul>
<p class="cx-about-foot">The simulation runs entirely in your browser, in a Web Worker.</p>
`;

export interface About {
  open(): void;
  close(): void;
}

export function createAbout(el: HTMLElement): About {
  const closeBtn = h('button', { type: 'button', class: 'cx-btn cx-btn--icon cx-about-close', 'aria-label': 'Close', title: 'Close (Esc)' });
  closeBtn.append(icon(ICONS.close));
  const content = h('div', { class: 'cx-about-body', html: ABOUT_HTML });
  const dlg = h('dialog', { class: 'cx-about', 'aria-labelledby': 'cx-about-title' },
    h('header', { class: 'cx-about-head' },
      h('div', null,
        h('div', { class: 'cx-about-kicker', text: 'About' }),
        h('h2', { id: 'cx-about-title', class: 'cx-about-title', text: 'Cascade' }),
      ),
      closeBtn,
    ),
    content,
  );
  el.append(dlg);
  closeBtn.addEventListener('click', () => close());
  // Click on the backdrop (outside the dialog box) closes it.
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) close();
  });

  function open(): void {
    if (dlg.open) return;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    content.scrollTop = 0;
    closeBtn.focus();
  }

  function close(): void {
    if (!dlg.open) return;
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }

  return { open, close };
}
