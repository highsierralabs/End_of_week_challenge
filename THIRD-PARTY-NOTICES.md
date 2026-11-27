# Third-party notices

The built site contains three.js (in Cascade). Its licence text is reproduced below as the library ships it. The builds' own licence is in [LICENSE](LICENSE).

Drumhead ships no third-party code, fonts or images. Its reference eigenvalues and the geometry of its isospectral drums are taken, as published facts with citation, from T. A. Driscoll, "Eigenmodes of isospectral drums", SIAM Review 39 (1997) 1-17 (Table 3.1 and Figure 1.1), and its free square plate reference values from R. Porter, "Eigenfrequencies and eigenmodes for a thin rectangular elastic plate with free edges", technical report, University of Bristol (2017), Table 1.

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
