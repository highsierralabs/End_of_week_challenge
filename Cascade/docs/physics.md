# Cascade physics model

Cascade follows every particle of an extensive air shower above a set of energy
cuts, from the first interaction to the ground. It is a deterministic Monte Carlo
(seeded xoshiro128**) written in plain TypeScript, so it runs in a browser Web Worker
and in Node unit tests alike. This page lists what is modelled, with which
approximations, and how it was checked. Code: `src/physics/`.

Units: metres, nanoseconds, GeV, g/cm^2. Frame: x east, y north, z altitude above sea level.

## 1 Atmosphere and geometry

- Linsley's five-layer parameterisation of the US Standard Atmosphere (CORSIKA
  atmosphere 1): `X(h) = a_i + b_i exp(-h / c_i)` in four exponential layers and a linear
  top layer that reaches X = 0 at 112.8 km (`atmosphere.ts`).
- The ground is a flat plane at 1539 m. The model gives 860.8 g/cm^2 of vertical depth
  there, the same as the observatory's mean station pressure of 844.1 hPa converts to
  (1 g/cm^2 = 0.980665 hPa).
- Flat-Earth geometry: slant depth is vertical depth divided by the cosine of the
  zenith angle. This is accurate below about 70 degrees, the upper limit of the zenith slider.
- Particles are moved by sampled depth (interactions) or by distance (decays). Times
  advance by path length over beta c.

## 2 Hadrons

A calibrated toy model, not a full hadronic event generator (`xsec.ts`, `cascade.ts`):

- **Cross sections.** Inelastic proton-air is a smooth fit through about 280 mb at 1 TeV,
  390 mb at 1 PeV and 490 mb at 1 EeV; pion-air is 0.78 of that. Nucleus-air scales
  proton-air at the same energy per nucleon by `((A^1/3 + 1.574) / 2.574)^2`, which gives
  iron-air about 4.4 times proton-air. Interaction length is `24 080 / sigma[mb]` g/cm^2.
- **Collisions.** A leading nucleon (or pion) keeps `(1 - K) E`, with inelasticity
  `K ~ U(0.3, 0.8)` and a 33% charge-exchange chance for nucleons. Pions share the
  remaining energy:
  - Their number is Poisson with mean `1.5 n_ch`, where `n_ch` is the UA5-style
    `-4.2 + 4.69 s^0.155` (s in GeV^2) times 0.7.
  - Each pion is pi+, pi- or pi0 with probability 1/3.
  - Energies are split by a Dirichlet(0.6) draw, which favours a few hard pions.
  - Every product gets a transverse momentum from a Gamma(2, 0.18 GeV) distribution,
    with a mean of 0.36 GeV.
- **Nuclei.** Semi-superposition. At each interaction a Poisson number of wounded
  nucleons interacts at once, with mean `1 + 0.45 (A^2/3 - 1)`: about 7 for iron. The
  excited spectator remnant breaks up into one fragment of size `spect * u^1.5` plus free
  nucleons.
- **What is missing.** Kaons, charm, baryon-antibaryon pairs, diffraction, and any
  energy dependence of the inelasticity.
- **Calibration** (2026-11-26) fixed the multiplicity scale (0.7) and the Dirichlet
  concentration (0.6). The targets were the mean proton Xmax at 1 PeV (about 555 g/cm^2)
  and an iron Xmax about 90-100 g/cm^2 shallower, as in accelerator-tuned models. The
  result is mean Xmax of 557 (proton) and 464 (iron) g/cm^2 at 1 PeV. The proton spread is
  about 60 g/cm^2 and iron about 17-21 g/cm^2, close to full simulations.

## 3 Decays

- pi0 -> 2 gamma at the production point, with isotropic two-body kinematics boosted to
  the lab.
- pi+- -> mu nu in flight: the proper decay time is sampled once and consumed along the
  path. pi+- also interact with the pion-air cross section, and whichever comes first wins.
- mu -> e nu nu in flight or at rest. The electron's rest-frame energy follows the
  Michel spectrum `x^2 (3 - 2x)`, with an isotropic direction, then a boost.

## 4 Muons

Muons lose energy continuously, at 2.07 MeV per g/cm^2 plus a radiative term
`b E` with `b = 2.5e-6` per g/cm^2. They are deflected by Highland multiple scattering,
and they decay as above. The kinetic-energy cut is 10 MeV by default; a muon that stops
decays at rest.

## 5 Electromagnetic cascade

- **Bremsstrahlung.** Bethe-Heitler with complete screening:
  `dN/dv ~ (1/v)(4/3 - 4/3 v + v^2)` per radiation length (X0 = 36.62 g/cm^2). Photons
  above the photon cut are emitted as discrete particles, at an angle of about m_e/E.
- **Ionisation.** Continuous loss of 2.22 MeV per g/cm^2 (Rossi's approximation B,
  E_c / X0).
- **Multiple scattering.** Rossi-Greisen Gaussian, with a projected width of
  `(21.2 MeV / sqrt 2) / (p beta) * sqrt(t)` and the correlated lateral displacement
  within each step. This is the convention behind the NKG function and the Moliere radius.
- **Pair production.** Uses the complete-screening limit `7 / (9 X0)` scaled near
  threshold by an interpolation of NIST XCOM's pair attenuation for air. The energy split
  follows `1 - (4/3) x (1 - x)`.
- **Compton scattering.** Klein-Nishina. The total cross section is analytic, and the
  scattering is sampled with the Butcher-Messel method used by EGS and Geant4. The knock-on
  electron is tracked.
- **What is missing.** Photonuclear interactions, the LPM effect (which matters only for
  photons above about 10^19 eV), positron annihilation in flight, Moller and Bhabha
  scattering as discrete processes, and the geomagnetic field.

## 6 Thinning

Hillas thinning at `E_thin = epsilon * E0`, with weight limits. The electromagnetic limit
is 100 times `epsilon * E0 / GeV`, and hadrons and muons get a limit 100 times smaller so
the muon component stays well sampled. The factor of 100 above CORSIKA's usual
recommendation keeps an interactive particle budget: about 0.4 million particles and
3-5 s for a 1 PeV shower on a desktop CPU. Every ground particle carries a weight, and
the charts use weighted counts. Thinning trades fluctuations for speed: densities far
from the core are noisy.

## 7 Outputs

- Track segments with start and end positions and times, class, energy and weight. When
  `maxSegments` is reached, the recorder decimates whole particles uniformly at random
  (geometric levels), so the replay stays an unbiased sample. Hadrons, muons and
  high-energy particles are always kept.
- Ground particles with position, time, class, energy, weight and direction.
- The longitudinal profile: weighted particles crossing horizontal planes, labelled by
  slant depth, with a Gaisser-Hillas fit (Nelder-Mead in log space).

## 8 Rate mode (`rate.ts`)

The steady flux of muons at the site, and what a 1 cm^3 crystal in a lead castle counts
from it.

- **Primaries.** The PDG nucleon intensity `I(E) = 1.8e4 E^-2.7` m^-2 s^-1 sr^-1 GeV^-1,
  with energy per nucleon from 4.5 GeV (a stand-in for the roughly 4-5 GV geomagnetic
  cutoff at 39 N) to 200 TeV. Directions are isotropic, weighted by cos(theta) for flux
  through a horizontal plane, up to 85 degrees.
- **Muon flux.** In a horizontally uniform atmosphere, the muon flux through a
  horizontal surface equals the primary rate per unit area times the mean number of muons
  per primary crossing that surface. Hadrons and muons are simulated without thinning; the
  EM component is switched off.
- **Observation planes.** Muons are recorded crossing three planes at the site depth and
  +-10.2 g/cm^2 (+-10 hPa). Because the same showers cross all three, the barometric
  coefficient comes from one correlated sample.
- **The crystal.** Each muon's contribution is its effective area for that direction
  (projected area times the fraction of chords of at least 2.78 MeV / 5.6 MeV/cm =
  0.50 cm, tabulated by Monte Carlo) divided by cos(theta). It counts only if its kinetic
  energy covers the lead path: the 40 mm lid or the 30 mm wall the direction meets, at
  12.7 MeV/cm.
- **Normalisation.** The raw model over-predicts the PDG sea-level vertical muon
  intensity (70 m^-2 s^-1 sr^-1 above 1 GeV). Rather than tune the toy model to that one
  number, the site prediction is anchored to it: it is multiplied by
  `70 / I_v,sea(model)`, and the factor is shown alongside the result. This is a
  differential use of the model, in which the altitude dependence and the barometric
  slope come from the simulation and the absolute scale from measurement.
- **Not modelled:** the electromagnetic and hadronic components reaching the castle,
  secondaries made in the lead, neutron capture gamma rays, the CsI response, solar
  modulation, and temperature effects.

## 9 Validation

- **Unit tests** (`tests/unit/physics.test.ts`):
  - the atmosphere, its inversion, and integration of density;
  - Compton attenuation against NIST XCOM;
  - conservation in two-body decays;
  - normalisation of the NKG function;
  - recovery of known parameters by the Gaisser-Hillas fit;
  - the Greisen size of a 100 TeV photon shower;
  - the proton Xmax band at 1 PeV, iron shallower than proton and fluctuating less;
  - determinism;
  - photon showers being muon-poor.
- **Validation page** (`validation.html`): Xmax, its spread, Nmax and the muon number
  against the Heitler-Matthews scalings and an approximate band of published full-model
  values, by energy and primary.

## References

- T. K. Gaisser, R. Engel, E. Resconi, *Cosmic Rays and Particle Physics*, 2nd ed. (2016).
- J. Matthews, Astropart. Phys. 22 (2005) 387.
- K.-H. Kampert, M. Unger, Astropart. Phys. 35 (2012) 660.
- Particle Data Group, *Review of Particle Physics*: "Cosmic rays"; "Passage of particles through matter".
- D. Heck et al., CORSIKA, FZKA 6019 (1998).
- W. R. Nelson, H. Hirayama, D. W. O. Rogers, *The EGS4 code system*, SLAC-265 (1985).
- A. M. Hillas, Nucl. Phys. B (Proc. Suppl.) 52B (1997) 29 (thinning).
- V. L. Highland, Nucl. Instrum. Methods 129 (1975) 497.
