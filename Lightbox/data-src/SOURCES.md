# Sources for the reference data in this directory

Everything here was fetched on 2026-11-27 with plain HTTP GET requests and a generic
User-Agent. No value was typed in from memory. Each section lists the exact URLs, the
licence or terms as the source states them, and every transformation applied.

Licence summary, because this directory mixes terms:

| File | Source | Terms stated by the source |
|---|---|---|
| `cie1931_2deg.json` | CIE dataset | CC BY-SA 4.0 |
| `cie_d65.json` | CIE dataset | CC BY-SA 4.0 |
| `glasses.json` | refractiveindex.info database | CC0 1.0 |
| `metals.json` | refractiveindex.info database | CC0 1.0 |
| `emission_lines_aki.json` | NIST Atomic Spectra Database (SRD 78) | NIST Standard Reference Data; copyright asserted by NIST (see below) |
| `planckian_reference.json` | colour-science project | BSD-3-Clause |

CC BY-SA 4.0 and the NIST SRD statement are not the MIT licence. Whether tables of
standard numbers like these can be redistributed inside an MIT-licensed project, and
with what attribution, is a decision for the project owner; it is not settled here.

---

## cie1931_2deg.json

CIE 1931 2-degree standard observer colour-matching functions, 360-830 nm, 1 nm step,
471 values per function.

- Data: https://files.cie.co.at/Publications-datasets/CIE_xyz_1931_2deg.csv
- Metadata: https://files.cie.co.at/Publications-datasets/CIE_xyz_1931_2deg.csv_metadata.json
- Landing page: https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer
  (reached from https://doi.org/10.25039/CIE.DS.xvudnb9b)
- Cross-check copy: http://www.cvrl.org/database/data/cmfs/ciexyz31_1.csv

Citation, from the metadata: International Commission on Illumination (CIE), "Colour-matching
functions of CIE 1931 standard colorimetric observer", 2019, doi:10.25039/CIE.DS.xvudnb9b;
original source CIE 018:2019, Table 6.

Licence, from the metadata `rightsList`: Creative Commons Attribution-ShareAlike 4.0
International (CC BY-SA 4.0), https://creativecommons.org/licenses/by-sa/4.0/.

Integrity: the downloaded CSV matches the sha256 in the metadata
(`fa663e3535a7e0763a745993a1f0a192eb0275ac46ad2d1befd7626841e713c1`).

Transformation: none to the values. The CSV columns (wavelength, x-bar, y-bar, z-bar) were
split into three arrays; the wavelength column was dropped after checking it runs 360 to 830
in steps of 1 with no gaps. Numbers were parsed as decimal and written back without
trailing zeros.

Cross-check: the CVRL file has the same 471 rows; the largest absolute difference from the
CIE file in any column is 5e-13 (the CIE file carries one more decimal place in y-bar).
CVRL states on http://www.cvrl.org/main.php: "The information and data on this website are
provided free of charge as a service to the vision science community", with a copyright
notice "1995-2026 Color and Vision Research Labs" and no named licence. CVRL also offers a
5 nm file (http://www.cvrl.org/database/data/cmfs/ciexyz31.csv, 95 rows); it was fetched
but not used.

## cie_d65.json

CIE standard illuminant D65 relative spectral power distribution, 360-830 nm, 1 nm step,
471 values, normalised by the source to 100 at 560 nm.

- Data: https://files.cie.co.at/Publications-datasets/CIE_std_illum_D65.csv
- Metadata: https://files.cie.co.at/Publications-datasets/CIE_std_illum_D65.csv_metadata_v2.json
- Landing page: https://cie.co.at/datatable/cie-standard-illuminant-d65
  (reached from https://doi.org/10.25039/CIE.DS.hjfjmt59)
- Cross-check copy: http://www.cvrl.org/database/data/cie/Illuminantd65.csv

Citation, from the metadata: International Commission on Illumination (CIE), "CIE standard
illuminant D65", 2019, doi:10.25039/CIE.DS.hjfjmt59; original source ISO/CIE 11664-2:2022,
Table B.1.

Licence, from the metadata: CC BY-SA 4.0.

Integrity: the CSV matches the sha256 in the metadata
(`e76f210bffff3d552ef7113025da5f325d5dfec200dd4b878b1a2f3a507032cb`).

Transformation: **truncation.** The source table runs 300-830 nm (531 rows). The 60 rows
below 360 nm were dropped so the array lines up index-for-index with
`cie1931_2deg.json`. No interpolation, no rescaling. The CVRL copy is identical over the
full 300-830 nm range (largest difference 0).

## glasses.json

Dispersion formulas for eight materials, from the refractiveindex.info database.

Repository: https://github.com/polyanskiy/refractiveindex.info-database, branch `main` at
commit `e6d15e364f70de1cad8a96a20f75689f2fba8b21`. Files fetched, all under
`https://raw.githubusercontent.com/polyanskiy/refractiveindex.info-database/main/`:

| Key | File | Formula type | Terms | Range (um) | nd / Vd in file |
|---|---|---|---|---|---|
| `N-BK7` | `database/data/specs/schott/optical/N-BK7.yml` | 2 | 3 | 0.3-2.5 | 1.5168 / 64.17 |
| `fused_silica` | `database/data/main/SiO2/nk/Malitson.yml` | 1 | 3 | 0.21-6.7 | none |
| `N-SF11` | `database/data/specs/schott/optical/N-SF11.yml` | 2 | 3 | 0.37-2.5 | 1.78472 / 25.68 |
| `SF10` | `database/data/specs/schott/optical/SF10.yml` | 2 | 3 | 0.38-2.5 | 1.72825 / 28.41 |
| `N-SF10` | `database/data/specs/schott/optical/N-SF10.yml` | 2 | 3 | 0.38-2.5 | 1.72828 / 28.53 |
| `diamond` | `database/data/main/C/nk/Peter.yml` | 1 | 2 | 0.226-0.760 | none |
| `water_20C` | `database/data/main/H2O/nk/Daimon-20.0C.yml` | 2 | 4 | 0.182-1.129 | none |
| `sapphire_o` | `database/data/main/Al2O3/nk/Malitson-o.yml` | 1 | 3 | 0.20-5.0 | none |

Also fetched: `database/doc/Dispersion%20formulas.pdf` (the formula definitions), `LICENSE`
and `README.md`.

Licence: CC0 1.0 Universal. The README says: "The database is in the public domain.
Copyright and related rights were waived by Mikhail Polyanskiy through the CC0 1.0
Universal Public Domain Dedication." It asks, as a courtesy, for the citation
M. N. Polyanskiy, "Refractiveindex.info database of optical constants", Scientific Data 11,
94 (2024), https://doi.org/10.1038/s41597-023-02898-2.

Primary references as each YAML file gives them:

- N-BK7, N-SF11, SF10, N-SF10: SCHOTT Zemax catalog 2017-01-20b (the database's copy of
  Schott's own catalogue). Schott's datasheets were not fetched separately. All four are
  marked `glass_status: standard` and 293 K in the files.
- Fused silica: I. H. Malitson, J. Opt. Soc. Am. 55, 1205-1208 (1965). The file notes that
  the formula was reported for 0.21-3.71 um and that C. Z. Tan (1998) verifies it up to
  6.7 um, which is the range the database lists.
- Diamond: F. Peter, Zeitschrift fuer Physik 15, 358-368 (1923).
- Water: M. Daimon and A. Masumura, Appl. Opt. 46, 3811-3820 (2007), the 20.0 C data set.
- Sapphire, ordinary ray: I. H. Malitson and M. J. Dodge, J. Opt. Soc. Am. 62, 1405 (1972)
  (a conference abstract); the formula itself is from M. J. Dodge in the Handbook of Laser
  Science and Technology, vol. IV part 2 (CRC Press, 1986), p. 30.

**How C enters the formula.** The database uses two Sellmeier forms, defined in its
"Dispersion formulas" document, and the difference is exactly the C versus C-squared trap:

- Formula 1 ("Sellmeier"): `n^2 - 1 = C1 + C2 L^2/(L^2 - C3^2) + C4 L^2/(L^2 - C5^2) + ...`
  The C values are in micrometres and are **squared** in the denominator. Used here by
  fused silica, diamond and sapphire.
- Formula 2 ("Sellmeier-2"): `n^2 - 1 = C1 + C2 L^2/(L^2 - C3) + C4 L^2/(L^2 - C5) + ...`
  The C values are in micrometres squared and are used **as given**. Used here by the four
  Schott glasses and water.

In the JSON, `A` is the database's C1 (0 in every entry), `B` holds C2, C4, ... and `C`
holds C3, C5, ..., with the `formula` string written out literally per entry and
`rii_formula_type` recording which of the two it is. `coefficients_as_in_source` is the
YAML line verbatim.

Transformation: the flat coefficient list was split into `A`, `B`, `C`; nothing was
converted or rounded. `n_at_587p56nm_computed` is **not** a source value: it is computed
here from the recorded formula at L = 0.58756 um as a cross-check.

Checks run: for the four Schott glasses the recorded formula reproduces the catalogue nd to
within 3e-6, and the Abbe number computed from the formula (with the d, F and C line
wavelengths taken from the NIST data below) agrees with the catalogue Vd to within 0.005 (64.165, 25.679,
28.409, 28.532 against 64.17, 25.68, 28.41, 28.53). That confirms the formula-2 reading. The formula-1 entries have no catalogue value
in the files to compare with.

Not resolved: the fetched files do not say whether each formula gives the index relative
to air or to vacuum. That matters at the 3e-4 level and is not settled here.

## metals.json

Tabulated complex refractive index (n, k) for gold, silver, copper and aluminium, source
points within 350-800 nm.

Same repository and commit as above. Files:

| Key | File | Reference | Points in 350-800 nm | Span (nm) |
|---|---|---|---|---|
| `Au` | `database/data/main/Au/nk/Johnson.yml` | Johnson and Christy 1972 | 16 | 354.2-756.0 |
| `Ag` | `database/data/main/Ag/nk/Johnson.yml` | Johnson and Christy 1972 | 16 | 354.2-756.0 |
| `Cu` | `database/data/main/Cu/nk/Johnson.yml` | Johnson and Christy 1972 | 16 | 354.2-756.0 |
| `Al` | `database/data/main/Al/nk/Rakic.yml` | Rakic 1995 | 12 | 364.66-794.78 |
| `Al_McPeak2015` | `database/data/main/Al/nk/McPeak.yml` | McPeak et al. 2015 | 91 | 350-800 |

- P. B. Johnson and R. W. Christy, "Optical constants of the noble metals", Phys. Rev. B 6,
  4370-4379 (1972), doi:10.1103/PhysRevB.6.4370. Room temperature.
- A. D. Rakic, "Algorithm for the determination of intrinsic optical constants of metal
  films: application to aluminum", Appl. Opt. 34, 4755-4767 (1995), doi:10.1364/AO.34.004755.
  This is the 1995 paper. The database also has `Rakic-LD.yml`, a Lorentz-Drude model fit
  from Rakic et al., Appl. Opt. 37, 5271-5283 (1998) (header read, data not used), and
  `Rakic-BB.yml` (not opened).
- K. M. McPeak et al., "Plasmonic films can easily be better: Rules and recipes", ACS
  Photonics 2, 326-333 (2015), doi:10.1021/ph5004237. Thermally evaporated aluminium,
  template stripped. Included as a second aluminium table because the Rakic table has only
  12 points in range; the two are different samples and differ in value.

Licence: CC0 1.0, as above.

Transformation: **unit conversion** of wavelength from micrometres to nanometres (x1000),
and **truncation** to the points with 350 <= nm <= 800. Nothing is resampled or
interpolated; n and k are the source numbers. Because the Johnson and Christy tables stop
at 756 nm inside the window and start at 354.2 nm, the nearest source point outside each end
is stored separately in `nearest_source_point_below_350nm` and
`nearest_source_point_above_800nm`.

## emission_lines.json (first query; file no longer kept)

This first query asked for relative intensities only. Its output file was removed once the
second query (`emission_lines_aki.json`, below) replaced it; the section stays because the
second one refers to its query URL, citation and terms.

Emission lines of H I, He I, Ne I, Na I, Hg I, Ar I, Kr I and Xe I between 380 and 750 nm,
from the NIST Atomic Spectra Database lines query, tab-delimited output.

URL, one request per element, with `XX` replaced by `H`, `He`, `Ne`, `Na`, `Hg`, `Ar`, `Kr`,
`Xe`:

```
https://physics.nist.gov/cgi-bin/ASD/lines1.pl?spectra=XX+I&limits_type=0&low_w=380&upp_w=750&unit=1&submit=Retrieve+Data&de=0&format=3&line_out=0&remove_js=on&en_unit=0&output=0&bibrefs=1&page_size=15&show_obs_wl=1&show_calc_wl=1&unc_out=1&order_out=0&max_low_enrg=&show_av=2&max_upp_enrg=&tsb_value=0&min_str=&A_out=0&intens_out=on&max_str=&allowed_out=1&forbid_out=1&min_accur=&min_intens=&conf_out=on&term_out=on&enrg_out=on&J_out=on
```

Also fetched, for the version and the meaning of the intensity column:
https://www.nist.gov/pml/atomic-spectra-database and
https://physics.nist.gov/PhysRefData/ASD/Html/lineshelp.html.

Citation: NIST Atomic Spectra Database, NIST Standard Reference Database 78. The NIST
landing page gave "Version 5.12, Last Update to Data Content: November 2024" and
DOI https://dx.doi.org/10.18434/T4W30F on the fetch date. The query output itself carries
no version stamp.

Terms: this is NIST Standard Reference Data. NIST's statement
(https://www.nist.gov/open/copyright-fair-use-and-licensing-statements-srd-data-software-and-technical-series-publications)
says the Standard Reference Data Act "empowers the Secretary of Commerce to secure
copyright on behalf of the United States in Standard Reference Data (SRD) prepared by
NIST", and gives the notice for SRD products as "NIST Standard Reference Data (SRD);
Copyright [YEAR] by the U.S. Secretary of Commerce on behalf of the United States of
America. All rights reserved." This is not a public-domain dedication and not an open
licence. The file here is a small extract (301 lines).

Wavelengths: **in air, as NIST gives them.** The query asked for air wavelengths in this
range and the returned columns are headed `obs_wl_air(nm)` and `ritz_wl_air(nm)`. No
vacuum-to-air conversion was done.

Transformations:

- Only rows with an entry in NIST's relative-intensity column were considered. Rows with
  no number there (a bare flag) or with intensity 0 were dropped.
- `nm` is NIST's observed wavelength. Where NIST lists no observed wavelength for a row,
  the Ritz wavelength is used and the entry is marked `"wl":"ritz"`. That happens for 11
  He I entries and for no other element.
- The intensity entry was split into its number (`rel`) and its trailing descriptors
  (`flag`). Flags present in this extract: `*` and `h`.
- NIST lists one row per classified transition, so a single observed line with several
  classifications appears several times with the same observed wavelength and the same
  shared intensity (flag `*`). Those rows were merged into one entry, with `n_class`
  recording how many rows were merged. Rows that have only a Ritz wavelength were not merged.
- `ref` is NIST's line-reference code for the row, kept so that lines from different
  publications can be told apart.
- Per element the list is sorted by `rel` descending (then wavelength) and cut to the 40
  strongest. Counts: H 7 (that is all NIST lists with an intensity in range), He 32 (all),
  Ne 40 of 582, Hg 40 of 106, Ar 40 of 100, Kr 40 of 274, Xe 40 of 353, Na 62 (all; see
  below).

**Relative intensities are source-dependent and not comparable between elements.** NIST's
help page says so directly: "There is no common scale for relative intensities. ... the
relative intensities have meaning only within a given spectrum", they "depend on the light
source used for the excitation", most "are not corrected for spectral sensitivity of the
measuring instruments", and they "should be considered as qualitative values". Do not use
`rel` to set the relative brightness of two different elements, and treat the ratios within
one element as rough.

They are not always comparable within one element either, because NIST merges several
publications per spectrum. Sodium shows it plainly: after the two D lines (588.995 and
589.592 nm, intensities 80000 and 40000) the next 23 strongest entries all come from one
reference (`L6269`) and have a lower configuration with an open 2p5 core; there are 25 such
entries in all, with intensities from 5 to 420. The lines of the ordinary spectrum carry
intensities of 11 or less from other references (568.82 nm has 9). A cut to the 40 strongest would have kept
the first group and dropped most of the second, so for Na every qualifying line is kept and
each has a `core_excited` flag, read from NIST's lower-configuration column. That such
lines would be absent from an ordinary sodium lamp is an inference from the configuration
and was not checked against a lamp spectrum.

NIST's descriptor legend, for the two flags that occur: `*` = "Intensity is shared by
several lines (typically, for multiply classified lines)"; `h` = "Hazy line (same as
diffuse)".

## planckian_reference.json

Published CIE 1931 2-degree (x, y) chromaticities of illuminants A, D65 and D50, for
cross-checking only.

- https://raw.githubusercontent.com/colour-science/colour/develop/colour/colorimetry/datasets/illuminants/chromaticity_coordinates.py
  (branch `develop` at commit `136aa0beccd772355d7abbab17655c93b16a6b9f`)
- Licence file: https://raw.githubusercontent.com/colour-science/colour/develop/LICENSE
  (BSD-3-Clause, "Copyright 2013 Colour Developers")

The file attributes these values to CIE 015:2004 Colorimetry, 3rd edition, and to the
Wikipedia table "White points of standard illuminants". The CIE publication was not
fetched, so this is a secondary source. The file gives D65 and D50 rounded to four decimals
and says in a note that CIE 015:2004 specifies (0.31272, 0.32903) for D65 and
(0.34567, 0.35851) for D50; both forms are recorded. The file does not state the
temperature of illuminant A.

Transformation: none.

Cross-check made with the files in this directory: summing `cie_d65.json` against
`cie1931_2deg.json` at 1 nm over 360-830 nm gives (0.31273, 0.32902).

## emission_lines_aki.json

Transition probabilities and upper-level data for H I, He I, Ne I, Na I, Hg I, Ar I, Kr I and
Xe I between 380 and 750 nm, from a second NIST Atomic Spectra Database lines query made on
2026-11-27. Tab-delimited output, air wavelengths, energies requested in eV, statistical
weights requested.

URL, one request per element, with `XX` replaced by `H`, `He`, `Ne`, `Na`, `Hg`, `Ar`, `Kr`,
`Xe`. It differs from the query for `emission_lines.json` only in `en_unit=1` (eV instead of
cm-1) and the added `g_out=on`:

```
https://physics.nist.gov/cgi-bin/ASD/lines1.pl?spectra=XX+I&limits_type=0&low_w=380&upp_w=750&unit=1&submit=Retrieve+Data&de=0&format=3&line_out=0&remove_js=on&en_unit=1&output=0&bibrefs=1&page_size=15&show_obs_wl=1&show_calc_wl=1&unc_out=1&order_out=0&max_low_enrg=&show_av=2&max_upp_enrg=&tsb_value=0&min_str=&A_out=0&intens_out=on&max_str=&allowed_out=1&forbid_out=1&min_accur=&min_intens=&conf_out=on&term_out=on&enrg_out=on&J_out=on&g_out=on
```

Also fetched, for the meaning of bracketed energies:
https://physics.nist.gov/PhysRefData/ASD/Html/levelshelp.html. The accuracy-grade legend is
from https://physics.nist.gov/PhysRefData/ASD/Html/lineshelp.html.

Citation and terms: the same as for `emission_lines.json` above. NIST Atomic Spectra
Database, NIST Standard Reference Database 78 (landing page: version 5.12, DOI
https://dx.doi.org/10.18434/T4W30F). It is NIST Standard Reference Data, with copyright
asserted by the U.S. Secretary of Commerce ("All rights reserved"); not an open licence.

Fields and where they come from (NIST column in brackets):

- `nm` [`obs_wl_air(nm)`, else `ritz_wl_air(nm)`]: wavelength in standard air as NIST gives
  it. No vacuum conversion. `wl` says which column was used.
- `Aki` [`Aki(s^-1)`]: transition probability in s^-1, as given.
- `Ek_eV` [`Ek(eV)`]: upper level energy. **No unit conversion was done here**; the query
  asked NIST for eV and the column came back headed `Ek(eV)`.
- `gk` [`g_k`]: upper level statistical weight.
- `acc` [`Acc`]: NIST's accuracy grade for `Aki`.
- `rel`, `flag` [`intens`]: relative intensity number and its descriptors, `rel` null where
  NIST gives none.
- `type` [`Type`]: present only for rows NIST marks as other than electric dipole.

Transformations:

- Kept every row that has an `Aki` value; rows without one are left out. No strongest-N cut.
- One entry per NIST row, that is, per classified transition. Rows were **not** merged, so
  several entries can share one observed wavelength (the components of an unresolved line),
  each with its own `Aki`, `Ek_eV` and `gk`. Where such rows share one relative intensity
  NIST flags it `*`; that number belongs to the blend and must not be summed over the rows.
- Sorted by wavelength within each element.
- NIST encloses some level energies in square brackets. Its levels help page says: "Square
  brackets indicate the energies determined by interpolation, extrapolation, or other
  semi-empirical procedure relying on some known experimental values." The brackets were
  stripped and the number kept. This applies to all 76 He I rows and to 36 Na I rows.
- **Hydrogen: only the configuration-averaged rows are kept.** NIST returns 56 H I rows with
  `Aki` in range: 49 fine-structure components and 7 rows averaged over a whole n to n
  transition (lower configuration `2`, upper `3` to `9`, no term, `gk` = 2 n^2 = 18 to 162).
  The 7 averaged rows are in the file; the 49 component rows are left out.
- Sodium: the 25 rows whose lower configuration is not built on the closed 2p6 core carry
  `core_excited: true`. All 25 are grade D. See the note under `emission_lines.json`.

Counts (rows with `Aki` / all rows NIST returned in range):

| Element | With Aki | All rows | Wavelength from Ritz column | Grades |
|---|---|---|---|---|
| H | 7 kept (56 before dropping components) | 91 | 0 | AAA |
| He | 76 | 76 | 34 | AAA 68, AA 8 (7 rows are E2) |
| Ne | 186 | 601 | 2 | B+ 55, C+ 86, C 40, B 3, AA 1, AAA 1 |
| Na | 104 | 141 | 14 | AA 2, A 9, B+ 8, B 40, C+ 6, C 4, C' 10, D 25 (1 row is M1) |
| Hg | 16 | 164 | 0 | B 7, C+ 1, D+ 1, D 6, E 1 |
| Ar | 261 | 261 | 161 | B+ 8, B 19, C+ 7, C 31, D+ 52, D 109, E 34, none 1 |
| Kr | 76 | 294 | 0 | B+ 3, B 4, C+ 16, C 14, D+ 30, D 9 |
| Xe | 70 | 420 | 2 | B+ 18, B 20, C+ 16, C 9, D+ 6, D 1 |

Coverage is poor for mercury (16 of 164 rows), and partial for xenon (70 of 420), krypton
(76 of 294) and neon (186 of 601). For those elements a spectrum built only from this file
is missing every line NIST has no transition probability for, whatever its real strength.

Accuracy grades, from NIST's lines help page: AAA <= 0.3%, AA <= 1%, A+ <= 2%, A <= 3%,
B+ <= 7%, B <= 10%, C+ <= 18%, C <= 25%, D+ <= 40%, D <= 50%, E > 50%. A prime (as in C')
means "a multiplet in the original compilation has been separated into its component lines
and the transition probability was derived from the compiled value assuming pure LS
coupling".

Values worth knowing, as returned by NIST on the fetch date: H-alpha averaged row
656.279 nm, Aki 4.4101e7, gk 18, Ek 12.0875052 eV; Na 588.995095 nm, Aki 6.16e7; Ne
585.24878 nm, Aki 6.15e7, Ek 18.96595369 eV, grade AA; Hg 546.075 nm, Aki 4.9e7, grade B.
The file holds what the database returned; figures quoted elsewhere for the same lines may
differ in the second or third digit.

An emission model that uses this file also needs level populations, which NIST does not
supply; `Aki`, `gk` and `Ek_eV` alone do not fix a lamp's line ratios.
