# What Cascade says about the RHACO crystal

*A note for the observatory, 2026-11-26. All simulation numbers come from Cascade's toy Monte Carlo
(`docs/physics.md`). All measured numbers come from the aggregate snapshot (`docs/rhaco_snapshot.md`), covering the
post-2026-05-20 sealed-castle era. Status labels follow the observatory's convention: **measured**, **simulated**,
**inferred**.*

## 1 The overflow channel is not mostly muons (inferred, two independent ways)

| Quantity | Value | Status |
|---|---|---|
| Overflow rate (deposits > 2.78 MeV), 180 settled days | 0.0698 +- 0.0001 counts/s | measured |
| Muons through the crystal that clear 30-40 mm of lead and cross >= 0.50 cm of CsI | 0.0245 +- 0.0007 counts/s | simulated, anchored |
| Same, raw toy model before anchoring | 0.0509 counts/s | simulated |

The anchor: the raw model over-predicts the PDG sea-level vertical muon intensity by a factor of 2.07, so the site
prediction is scaled by 1/2.07. Its altitude dependence (site/sea level = 1.29 in vertical intensity) comes from the
simulation.

- **Rate-based estimate.** The non-muon share is 1 - 0.0245/0.0698 = **65 %**. This leans on the absolute scale.
  - What carries it: the primary spectrum (a PDG power law with no solar modulation), the geomagnetic cutoff (a 4.5
    GeV nucleon threshold), the anchor, and the toy hadronic model.
  - Treat it as uncertain by tens of percent.
- **Pressure-based estimate.** The measured barometric coefficient is **-0.363 +- 0.032 %/hPa** (174 days,
  pressure-only weighted fit). The muon-only simulation gives **-0.188 +- 0.006 %/hPa** at the site depth. If the
  remainder responds like a neutron monitor (about -0.72 %/hPa), the non-muon share is
  (-0.363 + 0.188) / (-0.72 + 0.188) = **33 +- 6 %**.

**What the two estimates show together.**

- Both point to a substantial non-muon component: at least a third of the channel, possibly two thirds.
- They disagree with each other by more than their statistical errors. The pressure-based estimate needs no absolute
  normalisation, so it is probably the sturdier of the two.
- **Candidate soft components.** None is modelled:
  - Neutrons captured in the lead. Capture on Pb-207 gives 7.37 MeV gamma rays, above 2.78 MeV.
  - Electromagnetic punch-through.
  - Hadrons and their secondaries in the castle.
- **Tests that would discriminate:**
  - a borated-polyethylene or cadmium layer around the castle, since thermal neutrons respond and muons do not;
  - the shape of the deposit spectrum above 2.78 MeV, where muons peak near 5.6 MeV per cm of path and capture
    gamma rays have lines;
  - a coincidence with a second detector stacked above, since muons coincide and neutron captures do not.

**The documented coefficient.** The site value of -0.25 %/hPa sits between the muon-only simulation and the measured
value. The snapshot regression differs from it by about 3.5 sigma. That may reflect a different selection or era, and
it is worth re-deriving under the current configuration.

## 2 The EAS categories are not shower cores (simulated, order of magnitude)

For two or more particles from one shower to cross the crystal at once, the local charged density must be around
1 per cm^2 (10^4 per m^2). Cascade's estimate of how often a shower core that dense lands on a given point:

- simulated proton showers from 10^14 to 10^18 eV;
- near-core densities measured against core distance;
- fitted with a record-weighted power law over 0.3-30 m;
- folded with the all-particle flux (normalisation good to about x2).

| Local density | Showers per year at one point |
|---|---|
| >= 1 per cm^2 (two or so particles through the crystal) | about 11 (0.03 per day) |
| >= 3 per cm^2 (about four particles) | about 1.4 |

The classifier's EAS + SUPER-EAS categories fire **2.2 per live day** (measured). If those labels required several
particles to cross the crystal at once, they would fire about 80 to 600 times more often than shower cores can supply.
This holds for a bare crystal, and the lead only lowers the shower side.

**Inference.** The EAS categories mark count-rate patterns produced by something other than multi-particle shower
cores. Candidates:

- single large deposits;
- how the firmware turns counts into a rate (the D(t) averaging window);
- electronics.

This is consistent with Measurement Philosophy principle 5, that measurement defines category. It adds a quantitative
bound on genuine multi-particle core passages among the EAS-labelled events: about 1 % at the
1 per cm^2 level, and well under a percent at 3 per cm^2.

## 3 What a single shower delivers (simulated)

Cascade's readout now prints the detector exposure for every simulated shower. Example: a 1 PeV proton whose core
lands 45 m from the crystal gives about 4 e+- per m^2 at the detector, which agrees with NKG to about 10%. That
works out to an expected 6 x 10^-4 charged particles through a bare 1 cm^3 crystal. Typical showers leave the
crystal untouched. The muon rate the crystal does see, one or two a minute, comes from the steady rain of small,
distant showers. Sky mode shows that rain directly.

## Limits that apply to all of the above

- **Hadronic model.** A toy, calibrated to the mean Xmax at 1 PeV. The validation page lists where it departs from
  full simulations.
- **Absent physics.** No geomagnetic field, solar modulation or temperature effects.
- **The crystal.** Treated as an ideal 1 cm cube: a deposit above 2.78 MeV for a chord of at least 0.50 cm, at the
  minimum-ionising dE/dx. There are no Landau fluctuations and no light-yield or firmware response.
- **Precompute.** The rate-mode runs used 240,000 primaries each at the site and at sea level. Statistical errors are
  quoted; systematic errors are not, and they dominate.
