# Cascade - architecture

Cascade is a static site: an interactive Monte Carlo of cosmic-ray extensive air
showers arriving over Lemmon Valley / Stead, Nevada (1539 m, ~861 g/cm^2), the
site of the RHACO citizen observatory. A shower is simulated particle by particle
in a Web Worker, then replayed in 3D at a chosen slow-motion factor, with live
charts of the longitudinal profile, lateral distribution, ground footprint and
arrival times, and a comparison against a small aggregate snapshot of RHACO data.

## 1 Stack

- TypeScript 6, Vite 8, three.js 0.187 **WebGPURenderer** (`import * as THREE from 'three/webgpu'`,
  shaders in TSL from `'three/tsl'`). WebGPURenderer runs on WebGPU where available
  and falls back to its WebGL2 backend automatically; nothing in the code may assume
  one backend. Never import from plain `'three'` in render code (it pulls the
  WebGL1/2 classic renderer and duplicates the library); `three/webgpu` re-exports the core.
- No GLSL strings: all custom shading is TSL node materials, so both backends work.
- vitest for unit tests (physics), eslint, `npm run check` = typecheck + lint + test.

## 2 Layout (Cascade/)

| Path | Owner | What |
|---|---|---|
| `src/physics/**` | lead | Pure, deterministic Monte Carlo. No three, no DOM, no Math.random, no Date.now. `types.ts` is the contract. |
| `src/sim/**` | lead | Worker entry; main-thread client with a worker pool (single showers, split showers, sky mode). |
| `src/audio/**` | lead | Web Audio sonification of the replay. |
| `src/render/stage.ts`, `src/render/tracks.ts`, `src/render/detector.ts` | lead | Renderer, bloom and camera rig (stage), track replay, detector castle. |
| `src/render/terrain.ts`, `src/render/sky.ts`, `scripts/fetch-dem.mjs`, `public/dem/**` | terrain agent | Real DEM terrain of the Reno-Stead area, night sky with stars. |
| `src/ui/**`, `src/styles.css` | ui agent | Control panel, charts (canvas 2D), explanations / guided tour text, layout. |
| `src/data/rhaco_snapshot.json`, `scripts/rhaco_snapshot.py`, `docs/rhaco_snapshot.md` | data agent | Aggregate, operator-safe RHACO snapshot + its provenance. |
| `src/app/main.ts`, `index.html` | lead | Integration. |
| `validation.html`, `src/app/validation.*`, `scripts/precompute-validation.ts` | validation agent | The validation page and its precomputed ensemble. |
| `src/ui/observatory.ts`, `src/physics/rate.ts`, `scripts/precompute-rate.ts`, `scripts/precompute-corehits.ts` | lead | The RHACO comparison: rate mode, shower-core rates, the Data panel. |

## 3 Frames and units

- Physics frame: metres; x east, y north, z up as altitude above sea level. Detector
  at (0, 0, 1539). Time in ns, energy in GeV, depth in g/cm^2.
- Render frame (three.js, Y up): `X = x`, `Y = z - 1539` (ground at the detector is Y = 0),
  `Z = -y`. 1 unit = 1 m. Helper: `src/render/frame.ts` `toRender(x, y, z)`.
- The physics ground is a flat plane at 1539 m. The terrain renderer flattens the real
  DEM to exactly Y = 0 inside a 2.5 km radius of the origin and blends to the true
  relief by 6 km, so tracks that end on the physics plane end on visible ground.
- Scene extent: a 60 km x 60 km terrain patch centred on the origin. Showers start up to
  ~30 km above ground. Camera far plane ~200 km.

## 4 Privacy

The repository becomes public. The scene origin is an *illustrative* valley-floor point
(39.6600 N, 119.8650 W), not the observatory's actual location, and the docs say so. No
user-home paths, host names, device serials, MAC addresses, or API keys anywhere in
tracked files. RHACO data enters only as the aggregate snapshot.

## 5 Physics model (summary; detail in `docs/physics.md`)

Linsley 5-layer US-standard atmosphere; hadronic interactions by a calibrated
toy model (energy-dependent p-air / pi-air cross sections, multiplicity from a
UA5-style fit scaled to an air target, leading-particle inelasticity, exponential
p_T); nuclei by semi-superposition; exact two-body decays (pi0 -> 2 gamma, pi -> mu nu);
muons with continuous loss, decay, multiple scattering; electromagnetic cascade with
Bethe-Heitler bremsstrahlung and pair production (complete screening), Klein-Nishina
Compton, continuous ionisation and Highland multiple scattering; Hillas thinning
with a weight limit. Validated against Heitler-Matthews scalings and published
Xmax / muon-number figures in `tests/unit/` and `validation.html`.
