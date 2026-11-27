# Third-party notices

The built site contains three.js (in Cascade). Its licence text is reproduced below as the library ships it. The builds' own licence is in [LICENSE](LICENSE).

Drumhead ships no third-party code, fonts or images. Its reference eigenvalues and the geometry of its isospectral drums are taken, as published facts with citation, from T. A. Driscoll, "Eigenmodes of isospectral drums", SIAM Review 39 (1997) 1-17 (Table 3.1 and Figure 1.1), and its free square plate reference values from R. Porter, "Eigenfrequencies and eigenmodes for a thin rectangular elastic plate with free edges", technical report, University of Bristol (2017), Table 1.

Lightbox ships no third-party code, fonts or images; its four models are built by its own Blender script. It does ship reference data, which stays under its sources' terms and is not covered by this repository's MIT licence:

- **CIE 1931 colour matching functions and illuminant D65** (`Lightbox/data-src/cie1931_2deg.json`, `cie_d65.json`, and the tables derived from them in `Lightbox/src/data/optics.ts`): International Commission on Illumination (CIE), datasets doi:10.25039/CIE.DS.xvudnb9b and doi:10.25039/CIE.DS.hjfjmt59, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). The values are unchanged; they are truncated to 380-750 nm in the derived tables.
- **Atomic line data** (`Lightbox/data-src/emission_lines_aki.json` and the line list derived from it): wavelengths, transition probabilities, level energies and statistical weights from A. Kramida, Yu. Ralchenko, J. Reader and the NIST ASD Team, NIST Atomic Spectra Database (NIST Standard Reference Database 78), National Institute of Standards and Technology, https://physics.nist.gov/asd , retrieved 2026-11-27. NIST Standard Reference Data are copyrighted by the U.S. Secretary of Commerce; the values are reproduced here as cited facts.
- **Glass dispersion formulas and metal optical constants** (`Lightbox/data-src/glasses.json`, `metals.json`): M. N. Polyanskiy, refractiveindex.info database, CC0 1.0, carrying the Schott catalogue (N-BK7, SF10, N-SF11), Malitson 1965 (fused silica), Peter 1923 (diamond), Daimon and Masumura 2007 (water), Malitson and Dodge (sapphire), Johnson and Christy 1972 (gold, silver, copper) and McPeak et al. 2015 (aluminium).
- **Published chromaticities used in tests** (`Lightbox/data-src/planckian_reference.json`): from the colour-science project (BSD-3-Clause), citing CIE 015:2004.

`Lightbox/data-src/SOURCES.md` gives every URL, checksum and transformation.

## three.js 0.187.0

https://threejs.org

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Terrain data

The terrain height map (`Cascade/public/dem/stead_60km.png`) is derived from Terrain Tiles (Mapzen / Linux Foundation) on the AWS Open Data Registry, https://registry.opendata.aws/terrain-tiles/ . It contains data from USGS 3DEP (3D Elevation Program, public domain) and other sources credited at https://github.com/tilezen/joerd/blob/master/docs/attribution.md .

## RHACO data

`Cascade/src/data/rhaco_snapshot.json` holds daily aggregates from the RHACO citizen cosmic-ray observatory, included at its operator's request. See `Cascade/docs/rhaco_snapshot.md`.
