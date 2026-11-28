# Third-party notices

The built site contains three.js (in Cascade and in Wheelwork), and in Wheelwork also fflate and earcut. Their licence texts are reproduced below as the libraries ship them. The builds' own licence is in [LICENSE](LICENSE).

Drumhead ships no third-party code, fonts or images. Its reference eigenvalues and the geometry of its isospectral drums are taken, as published facts with citation, from T. A. Driscoll, "Eigenmodes of isospectral drums", SIAM Review 39 (1997) 1-17 (Table 3.1 and Figure 1.1), and its free square plate reference values from R. Porter, "Eigenfrequencies and eigenmodes for a thin rectangular elastic plate with free edges", technical report, University of Bristol (2017), Table 1.

Lightbox ships no third-party code, fonts or images; its four models are built by its own Blender script. It does ship reference data, which stays under its sources' terms and is not covered by this repository's MIT licence:

- **CIE 1931 colour matching functions and illuminant D65** (`Lightbox/data-src/cie1931_2deg.json`, `cie_d65.json`, and the tables derived from them in `Lightbox/src/data/optics.ts`): International Commission on Illumination (CIE), datasets doi:10.25039/CIE.DS.xvudnb9b and doi:10.25039/CIE.DS.hjfjmt59, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). The values are unchanged; they are truncated to 380-750 nm in the derived tables.
- **Atomic line data** (`Lightbox/data-src/emission_lines_aki.json` and the line list derived from it): wavelengths, transition probabilities, level energies and statistical weights from A. Kramida, Yu. Ralchenko, J. Reader and the NIST ASD Team, NIST Atomic Spectra Database (NIST Standard Reference Database 78), National Institute of Standards and Technology, https://physics.nist.gov/asd , retrieved 2026-11-27. NIST Standard Reference Data are copyrighted by the U.S. Secretary of Commerce; the values are reproduced here as cited facts.
- **Glass dispersion formulas and metal optical constants** (`Lightbox/data-src/glasses.json`, `metals.json`): M. N. Polyanskiy, refractiveindex.info database, CC0 1.0, carrying the Schott catalogue (N-BK7, SF10, N-SF11), Malitson 1965 (fused silica), Peter 1923 (diamond), Daimon and Masumura 2007 (water), Malitson and Dodge (sapphire), Johnson and Christy 1972 (gold, silver, copper) and McPeak et al. 2015 (aluminium).
- **Published chromaticities used in tests** (`Lightbox/data-src/planckian_reference.json`): from the colour-science project (BSD-3-Clause), citing CIE 015:2004.

`Lightbox/data-src/SOURCES.md` gives every URL, checksum and transformation.

Wheelwork ships three libraries (three.js, fflate, earcut; licences below) and reference data, which stays under its sources' terms and is not covered by this repository's MIT licence:

- **Planetary elements** (`Wheelwork/data-src/jpl/approx_pos.html` and the table copied from it into `Wheelwork/src/core/astro/planets.ts`): E. M. Standish, "Keplerian Elements for Approximate Positions of the Major Planets", Jet Propulsion Laboratory, Solar System Dynamics, https://ssd.jpl.nasa.gov/planets/approx_pos.html . Reproduced as published facts with citation.
- **Reference positions** (`Wheelwork/data-src/horizons/` and `Wheelwork/src/data/horizons.ts`): JPL Horizons on-line ephemeris system, https://ssd.jpl.nasa.gov/horizons/ , ephemeris DE441, retrieved 2026-11-27. Courtesy NASA/JPL-Caltech.
- **Eclipse catalogue** (`Wheelwork/data-src/eclipses/` and `Wheelwork/src/data/eclipse-catalogue.ts`): Eclipse Predictions by Fred Espenak, NASA's GSFC, from the Five Millennium Catalogs of Solar and Lunar Eclipses, https://eclipse.gsfc.nasa.gov , retrieved 2026-11-27.
- **Lunar series and precession polynomials** (`Wheelwork/data-src/erfa/moon98.c`, `p06e.c`, and the coefficients copied from them into `Wheelwork/src/core/astro/moon.ts`): ERFA, Essential Routines for Fundamental Astronomy, https://github.com/liberfa/erfa , Copyright (C) 2013-2023 NumFOCUS Foundation, derived with permission from the IAU SOFA library; BSD 3-clause, text below. The series is that of J. Meeus, *Astronomical Algorithms*, 2nd ed. (1998), chapter 47.
- **Coastlines** (`Wheelwork/data-src/naturalearth/ne_110m_land.geojson` and the land mask derived from it in `Wheelwork/src/data/land.ts`): Natural Earth 1:110m land, public domain, https://www.naturalearthdata.com .

`Wheelwork/data-src/SOURCES.md` gives every URL and transformation.

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

## fflate 0.8.3

https://github.com/101arrowz/fflate (in Wheelwork, to write the print kit's zip file)

```
MIT License

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## earcut 3.2.4

https://github.com/mapbox/earcut (in Wheelwork, to triangulate the faces of its solids)

```
ISC License

Copyright (c) 2026, Mapbox

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

## ERFA

https://github.com/liberfa/erfa (the lunar series and precession polynomials in Wheelwork's reference astronomy)

```
Copyright (C) 2013-2023, NumFOCUS Foundation.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

1 Redistributions of source code must retain the above copyright
  notice, this list of conditions and the following disclaimer.

2 Redistributions in binary form must reproduce the above copyright
  notice, this list of conditions and the following disclaimer in
  the documentation and/or other materials provided with the
  distribution.

3 Neither the name of the Standards Of Fundamental Astronomy Board,
  the International Astronomical Union nor the names of its
  contributors may be used to endorse or promote products derived
  from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
FOR A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```
