# Lightbox: the model, its approximations and its limits

This note says what Lightbox computes, where each number comes from, and what it leaves out. The code references
are to `src/`.

## Units and conventions

- Lengths are metres; the table top is y = 0.
- Light is photometric. A lamp is specified by its luminous flux in lumens, and every emission spectrum is stored
  normalised so that its integral against the CIE ȳ function is 1. With that convention the Y the tracer
  accumulates is luminance in cd/m² directly (the constant 683 lm/W never appears), and the camera's exposure can be
  set in real photographic units.
- Wavelengths run from 380 to 750 nm. Every spectrum is a row of 1,024 samples, linear in wavelength
  (0.36 nm apart), and the shader interpolates linearly between samples.

## One wavelength per path

Each path carries a single wavelength λ. Everything spectral (a lamp's output, a paint's reflectance, a glass's index
and absorption, a metal's complex index) is looked up at λ, so all radiometric quantities in the shaders are scalars.
A pixel's colour is the Monte Carlo estimate of

    XYZ = ∫ L(λ) · (x̄, ȳ, z̄)(λ) dλ

with the CIE 1931 2° colour matching functions (the CIE's own 1 nm table). Dispersion needs no special case: a ray of
450 nm light and a ray of 650 nm light meet the same prism with different indices and leave in different directions.

**Which wavelengths.** Each sweep over the image uses eight wavelengths. They are drawn from a density proportional
to the scene's emission spectra times the eye's response x̄+ȳ+z̄ (half the weight follows each distinct spectrum's
share of the luminous flux, half is split evenly between the spectra, and a tenth of the total is the bare response
so that no visible wavelength has zero density). The eight are stratified across that distribution and shifted by
the golden ratio from sweep to sweep. Camera paths pick one of the eight at random per pixel; photons take them in
turn. Sharing wavelengths is what allows the photon map (below) to be spectrally exact.

**Line spectra.** A gas tube's spectrum is a set of lines, each deposited into the two nearest samples so that its
centroid is kept. The sampler's inverse CDF has 2,048 entries, so narrow lines receive samples in proportion to
their power.

## Where the numbers come from

| Quantity | Source |
|---|---|
| Colour matching functions, D65 | CIE datasets (1 nm) |
| Glass dispersion (N-BK7, fused silica, SF10, N-SF11, diamond, water, sapphire) | Sellmeier formulas from the refractiveindex.info database |
| Metals (gold, silver, copper: Johnson and Christy 1972; aluminium: McPeak 2015) | complex index n + ik from the refractiveindex.info database, linear between the source's points |
| Gas line wavelengths, transition probabilities, level energies | NIST Atomic Spectra Database |

`data-src/SOURCES.md` lists every URL, the retrieval date, the licence and each transformation.
`scripts/build-data.mjs` turns those files into `src/data/optics.ts`. The unit tests check the glass formulas against
the catalogue index and Abbe number of the Schott glasses, and the tables against published chromaticities.

### Gas line strengths are modelled, not measured

NIST's catalogue of relative intensities mixes light sources and does not give a lamp's colour (with those numbers
neon comes out blue). Lightbox instead gives each line the power

    P ∝ g_k · A_ki / λ · exp(−E_k / kT),   kT = 0.6 eV

with NIST's statistical weight g_k, transition probability A_ki and upper-level energy E_k: a Boltzmann population at
one excitation temperature. A real discharge is not in equilibrium, so the **wavelengths are exact and the relative
strengths are approximate**. The model gets the familiar colours (neon red-orange with 640.2 nm strongest, sodium's D
lines, hydrogen's Balmer decrement, mercury's violet, green and yellow lines). It is least reliable for krypton and
xenon, where NIST lists transition probabilities for only some of the lines, and it has no ionised lines, which
contribute to a real argon tube's lilac.

### Colours picked on screen

A matte colour is chosen as sRGB. Its reflectance spectrum is r·R(λ) + g·G(λ) + b·B(λ), where R, G and B are three
smooth spectra that are non-negative, sum to 1 at every wavelength, and have the colours of the sRGB primaries under
D65 (the construction of Mallett and Yuksel 2019, solved here as a small quadratic programme in
`scripts/build-data.mjs`). Any sRGB colour is therefore a physically valid reflectance, exact under D65. It is one of
infinitely many spectra with that colour; real pigments differ, which matters under line-spectrum lamps.

## Geometry

Every shape is intersected exactly in its own space (`gpu/shaders/common.ts`, mirrored on the CPU in
`core/shapes.ts` for picking and tests):

- sphere, box, capped cylinder, rectangle, disc;
- **prisms and cut gems** as intersections of half-spaces. The round brilliant has its 57 facets (table, 8 stars,
  8 kites, 16 upper girdle, 16 lower girdle, 8 pavilion mains) plus a 16-sided girdle, with standard proportions
  (table 56%, crown 34.5°, pavilion 40.8°). A unit test checks that it is convex and that every facet touches its
  junctions;
- **lenses** as a cylinder cut by two spheres or planes: each candidate surface crossing is kept only if it lies on
  the lens;
- **triangle meshes** behind a binned-SAH bounding volume hierarchy, traversed in the shader with a 32-entry stack.
  Smooth meshes use interpolated normals for shading and the face normal to decide inside from outside.

Rays start 20 µm off the surface they leave. Sphere and cylinder intersections use the perpendicular-distance form of
the quadratic, which stays accurate for a small sphere far from the ray's origin.

## Materials

- **Matte:** Lambertian.
- **Glass:** smooth dielectric with the unpolarised Fresnel equations, Snell refraction at the wavelength's index,
  total internal reflection, and Beer-Lambert absorption for tinted glass (the tint's absorption coefficient is set
  so that the chosen colour is reached after a chosen depth).
- **Metal:** the exact conductor Fresnel reflectance from n(λ) and k(λ); polished, or rough with a GGX microfacet
  distribution sampled by visible normals.
- **Glossy (plastic, lacquer):** a matte base under a clear coat of index 1.5. The base term includes the Fresnel
  transmission in and out and the internal reflections, so the model is reciprocal and conserves energy; the coat is
  a mirror reflection or a GGX lobe.
- **Mirror:** an ideal reflector.
- **Grating:** an idealised thin transmission grating. The ray's direction cosine across the grooves shifts by
  mλ/d; orders 0 and ±1 carry fixed shares (40%, 30%, 30%). The angles are right; the efficiencies are not those of
  any real grating.
- **Lamps** emit diffusely from their surface (rectangles and discs from one face). **Beams** emit only within a
  cone about the normal: a spotlight, a collimated beam, a laser.

## Three ways of finding light

**Path tracing.** Paths start at the camera. At each matte or rough surface one lamp is chosen in proportion to its
emission at the path's wavelength, a point on it is sampled (spheres by solid angle, the others by area, beams by
their cone), and a shadow ray is traced; the result is combined with the chance of the scattered ray itself hitting
the lamp by the power heuristic. Paths end by Russian roulette. The shader traces one ray per loop iteration, shadow
rays included, so the intersection code is compiled once.

**Photon splatting.** Light that reaches a matte surface *through* glass or *off* a mirror (a caustic) is almost
never found from the camera. A second pass traces photons from the lamps, aimed at the specular objects, through
their specular bounces to the first non-specular surface, and connects that point to the lens. Each photon is drawn
as a point on the pixel it lands on.

**Photon gathering.** The same light arriving at a surface the camera sees only through glass or in a mirror cannot
be connected to the lens. For those, each sweep's photons are also stored in a hashed grid (one random survivor per
cell, weighted by the number that fell there: the stochastic hashing of Hachisuka and Jensen), and a camera path
that reaches its first matte surface by way of a specular chain gathers the photons within a radius r. This is a
density estimate, so it is **blurred by r, not exact**; r starts at 0.6% of the subject distance and shrinks so that
r² falls as (sweep)^−0.3 (progressive photon mapping), which makes the blur vanish in the limit.

**No path is counted twice.** The class "lamp → one or more specular bounces → the first matte surface on the camera
path" belongs to the splats when the camera sees that surface directly and to the gather when it sees it through a
specular chain; the path tracer gives that class zero weight and counts everything else. The validation page checks
both halves: the total light with the photon techniques on equals the path tracer's own answer with them off.

## Camera and darkroom

A thin lens with a round or polygonal aperture: focal length on a 36 × 24 mm frame, f-number, focus distance.
Exposure is either metered (the geometric mean luminance is placed at middle grey) or manual, where the saturation
luminance is 1.2 · 2^EV₁₀₀ cd/m² with EV₁₀₀ = log₂(N²/t) − log₂(ISO/100), so that stopping down darkens the picture
as on a real camera. Development: von Kries white balance in the Bradford space to a chosen colour temperature, a
film curve (or none), a glare pass, and an sRGB encode with dither. Colours outside the sRGB gamut, which every
spectral line is, have their negative components dropped and their luminance restored: hue is kept, saturation is
lost.

## What is left out

- **No participating media.** There is no fog or dust, so beams are invisible in the air; you see them where they
  land.
- **No polarisation, interference or diffraction** (apart from the idealised grating). Fresnel reflection uses the
  unpolarised average, which is slightly wrong for light that reflects from glass more than once.
- **No nested media.** Glass may not overlap glass (no water in a glass); a path knows only whether it is inside the
  object it last entered.
- **No fluorescence**; every interaction keeps its wavelength.
- Glass is perfectly smooth; there is no frosted glass.
- Rough metal and the rough coat use single-scattering GGX, which loses some energy at high roughness.
- Mesh emitters, gem-shaped lamps and lens-shaped lamps glow but are not sampled as lights, so they illuminate a scene
  noisily.
- Caustics from a beam that are seen in a mirror or through glass are gathered from the photon map and share its
  blur.
- Smooth meshes use shading normals, which is not exactly energy-conserving for photons; the validation page uses
  exact shapes for everything quantitative.
