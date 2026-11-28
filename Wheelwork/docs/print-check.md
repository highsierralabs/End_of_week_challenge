# How the print kit is checked

The kit has not been printed. This is what was done instead, and what each check can and cannot show.

## In the app, every time a kit is built

`src/core/machine/kit.ts` regroups the machine's solids into printable pieces: two cluster wheels and their sleeve as
one piece, an arm with its collar and stalk, a ball with a socket for its stalk. Then:

- **Every piece is a closed solid.** Vertices are welded and every edge must be used by exactly two triangles in
  opposite directions (`checkClosed` in `src/core/mesh/kit.ts`). A piece made of several overlapping shells, such as a
  wheel and its hub, passes when each shell is closed; a slicer unites them.
- **Every pair of spur wheels is swept.** For each of the 18 meshing pairs the two tooth outlines, cut with print backlash,
  are turned through one tooth pitch in 24 steps at their real centre distance, and the deepest overlap and the
  smallest gap are measured (`checkMesh` in `src/core/gears/meshcheck.ts`). The contact ratio is computed with undercut
  counted. The table is shown in the Print panel and written into the kit's README.
- **No part is left out or used twice.** The kit builder throws if a part of the machine is not accounted for.

These are checks in the plane of each wheel. They say nothing about parts that pass over or under one another, and
they do not include the crank's bevel pair, which the unit tests check by sampling points in 3D.

## Outside the app: Blender

`tests/unit/assembly-export.test.ts`, run with `WW_EXPORT_DIR` set, writes every part as an STL in its assembled
place at three crank positions. `scripts/blender-interference.py`, run in headless Blender, reads the files with its
own STL reader and:

- counts edges not shared by exactly two faces in each part (after welding its own reading of the vertices);
- for every pair of parts whose boxes overlap and which belong to *different* rigid bodies, asks Blender's BVH tree
  for triangles of one that cross triangles of the other.

```bash
WW_EXPORT_DIR=/tmp/ww npx vitest run tests/unit/assembly-export.test.ts
blender --background --factory-startup --python scripts/blender-interference.py -- /tmp/ww
```

On 27 November 2026, with Blender 5.2 and the machine as designed:

```
pose0: 99 parts, 0 with open edges, 274 neighbouring pairs tested, 0 cut through each other
pose1: 99 parts, 0 with open edges, 289 neighbouring pairs tested, 0 cut through each other
pose2: 99 parts, 0 with open edges, 272 neighbouring pairs tested, 0 cut through each other
interference: none (835 neighbouring pairs tested)
```

With `WW_EXPORT_BREAK=1`, which leaves every wheel at phase zero instead of in mesh, the same script reports crossing
triangles in all 18 meshes. So it does notice teeth that collide.

What this does not cover:

- Parts of one rigid body are not tested against each other. They are meant to touch or overlap: a wheel on its tube,
  a pillar in its plate.
- The Moon's stalk standing on the inclined ring is the one contact between different bodies and is excluded by name.
- Surfaces that cross are found; a small part wholly inside another would not be.
- Three crank positions, not a full sweep. The in-plane sweep above covers the teeth; this covers arms, stalks, tubes
  and plates at three arrangements of the planets.
- It is a check of geometry. It says nothing about printability, strength, tolerance or whether the thing can be put
  together by hand.

## What a first print would have to settle

- Press and running fits for the printer in use. Fixed fits are drawn size for size (hole equal to seat), on the
  expectation that a printed hole comes out a little small; running fits have 0.2 to 0.25 mm on radius.
- Whether nested tubes of 1.25 mm wall printed upright are straight and round enough to turn in each other. Brass tube
  of the same diameters is the obvious substitute, and the notes say so.
- The tellurion at scale 1: wheels 3 mm thick on sleeves of 5.6 and 8.2 mm, on a 3 mm stud. The kit can be scaled.
- Friction. The chain is driven through Mercury and mostly gears down, which is forgiving, but the step from Venus to the month tube
  gears up by about 8.
