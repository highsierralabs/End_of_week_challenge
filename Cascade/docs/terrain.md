# Terrain and sky

Cascade draws the showers over the real relief of the Reno-Stead area, at night.

## Origin

The scene origin is an **illustrative** valley-floor point, 39.6600 N, 119.8650 W, in
Lemmon Valley north of Reno, Nevada. It is not the location of the observatory or of
any building (architecture.md section 4).

## Elevation data

`public/dem/stead_60km.png` is a 2048 x 2048 heightmap covering 60 km x 60 km centred
on the origin (29.3 m per pixel). `public/dem/stead_60km.json` holds its metadata.

- Encoding: Terrarium RGB, `elevation_m = R*256 + G + B/256 - 32768`, quantised to
  1/4 m. Alpha is 255.
- Layout: row 0 is the north edge and column 0 the west edge. Pixel (i, j) is centred at
  `east = -30000 + (i + 0.5) * 60000/2048`, `north = 30000 - (j + 0.5) * 60000/2048`.
- Projection: local equirectangular about the origin (east = dlon x metres per degree
  of longitude at 39.66 N, north = dlat x metres per degree of latitude). This is accurate
  enough at 30 km from the origin for a visualisation.
- Range: 1157.7 m (the Pyramid Lake shore, north-east corner) to 3015.9 m (the
  Carson Range north of Mount Rose, south edge); 1526.6 m at the origin.

### Regenerating

```
node scripts/fetch-dem.mjs            # defaults: --pixels 2048 --zoom 12 --quant 4
```

The script uses Node builtins only. It downloads 81 zoom-12 tiles from
`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, caches them
in the OS temp directory (`--cache <dir>` to change), mosaics and bilinearly resamples
them onto the local grid, and writes the PNG (about 3.6 MB) and the JSON.

### Attribution

> Elevation: Terrain Tiles (Mapzen / Linux Foundation) via the AWS Open Data Registry,
> https://registry.opendata.aws/terrain-tiles/ . Contains data from USGS 3DEP (3D
> Elevation Program, public domain) and other sources credited at
> https://github.com/tilezen/joerd/blob/master/docs/attribution.md

The same string is in `stead_60km.json` under `attribution`; show it in the app's
credits.

## Frames

`src/render/frame.ts`: physics (x east, y north, z altitude) to render
(X = x, Y = z - 1539, Z = -y), via `toRender(x, y, z)` or the allocation-free
`toRenderInto(v, x, y, z)`. `GROUND_ALT_M = 1539`.

## Terrain (`src/render/terrain.ts`)

```ts
const terrain = await createTerrain({ url: 'dem/stead_60km.png', metaUrl: 'dem/stead_60km.json' });
scene.add(terrain.object);            // untransformed
terrain.heightAt(xEast, yNorth);      // render-frame Y of the drawn surface
terrain.elevationAt(xEast, yNorth);   // true DEM elevation above sea level
terrain.moonDirection.value.set(...); // unit vector toward the moon (render frame)
terrain.dispose();
```

- The PNG is decoded in the browser with `createImageBitmap` (no premultiplication, no
  colour-space conversion) and canvas `getImageData`, so the bytes are exact.
- The mesh is a 512 x 512 segment grid (option `segments`), heights box-filtered from
  the DEM. Within 2.5 km of the origin the ground is exactly Y = 0 (the physics plane);
  the relief is blended back in with a smoothstep by 6 km. `heightAt` interpolates
  the same triangles the GPU draws, so objects placed with it sit on the visible ground.
- Shading is unlit TSL and ignores scene lights: a faint moonlight term from the
  west-south-west, a sky ambient term, slope and elevation tint, 100 m and 500 m
  contour lines (not drawn on the flattened disc), a faint 1 km grid near the site,
  and haze that is concentrated in the lowest couple of kilometres and fades into
  exactly the sky's horizon colour at the patch edge.
- Town lights: about 12,000 hashed points (no `Math.random`) on flat valley floors
  between 1200 m and 1720 m, at least 3.2 km from the origin, densest over
  Reno-Sparks to the south-south-east. They are instanced `Sprite`s with a
  `PointsNodeMaterial`, additive, with HDR colours meant to feed the bloom pass. Each is
  slid 1% of its distance toward the camera along its view ray, which leaves its
  screen position unchanged but keeps it in front of the terrain at ranges where the
  depth buffer is coarse.

## Sky (`src/render/sky.ts`)

`createSky()` returns a mesh to add to the scene root, untransformed. Its vertices are
placed in clip space directly (direction rotated by the view matrix, then projected,
with z = 0.5 w), so it is never clipped by any near or far plane on either backend; it
has `depthTest` and `depthWrite` off and `renderOrder` -1000, so it draws first and
cannot hide anything. The colour is a blue-black gradient to a faintly lighter horizon,
a weak sodium glow from the city to the south-south-east, three layers of hashed stars
of varied brightness and colour, and a mottled Milky Way band with a dark rift.
`skyGradient(dir)` is exported so other materials can fade into the same colours.

## Caveats

- With near 0.5 m and far 200 km a 24-bit depth buffer resolves only tens of metres at
  20 km. Terrain itself does not suffer from this, but anything drawn close to the
  ground far away may. `logarithmicDepthBuffer: true` (or a reversed depth buffer) on
  `WebGPURenderer` fixes it if it shows up.
- Beyond the 60 km patch there is no ground, only the haze colour.
