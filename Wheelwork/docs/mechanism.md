# The mechanism

How the machine is laid out, and the rules a set of tooth counts must meet to be built. The code is
`src/core/machine/`: `design.ts` holds the fixed dimensions, `spec.ts` the tooth counts and the designer, `layout.ts`
the derived wheels and the rules, `kinematics.ts` the rates, `parts.ts` the solids.

Dimensions are millimetres. Heights are measured from the top of the base plate. Ecliptic longitude runs
counter-clockwise from the line that joins the centre to the idler post, seen from above.

## The nest

Nine coaxial members on the central axis, innermost first. Each is 3 mm larger in diameter than the one inside it and
runs on it with 0.25 mm of radial clearance.

| Member | Outside diameter | Turns? | Carries |
|---|---:|---|---|
| Sun post | 5 | fixed in the base plate | the Sun |
| Mercury's tube | 8 | yes | the crank's bevel wheel, wheel A of step 1, Mercury's arm |
| Venus's tube | 11 | yes | wheels D and A, Venus's arm |
| Month tube | 14 | yes, once a sidereal month | wheels D and A, the Moon train's first wheel |
| Fixed tube | 17 | no: pressed into the bridge | the first wheels of the axis and node trains |
| Earth's tube | 20 | yes | wheels D and A, the Earth's arm with the tellurion |
| Mars's tube | 23 | yes | wheels D and A, Mars's arm |
| Jupiter's tube | 26 | yes | wheels D and A, Jupiter's arm |
| Saturn's tube | 29 | yes | wheel D, Saturn's arm |

An inner tube is longer than the one outside it at both ends. Below the deck that puts Mercury's wheels lowest and
Saturn's highest; above it, Saturn's arm is lowest and Mercury's highest, so a long arm sweeps under the shorter ones
and every planet stands on a stalk that brings it up to the common plane, 80 mm above the deck.

The order of the nest is forced by the Earth's arm. The trains on that arm need a wheel that turns with the month and
wheels that do not turn at all, and only the tubes just inside the Earth's are exposed where the arm can reach them.

## The gearbox

One idler post stands 54 mm from the centre and runs from the base plate to the deck. Six clusters turn freely on it,
stacked. Step *i* of the chain joins tube *i* to tube *i* + 1:

- wheel **A** on the inner tube meshes cluster wheel **B** at level 2*i* + 1;
- cluster wheel **C** meshes wheel **D** on the outer tube at level 2*i* + 2.

The period of the outer tube is the inner tube's times (B/A) × (D/C). Each mesh reverses the sense of rotation, so the
clusters turn backwards and every tube turns forwards.

There are twelve levels, 6 mm apart, each wheel 4.5 mm thick with a 0.7 mm hub boss on each face, so that every wheel
stands on the one below. Level 1 starts 34 mm up; under it is the crank's bevel pair (16 and 48 teeth, module 1.25,
on a shaft 14 mm above the base plate). The bridge, 3 mm thick, sits between levels 5 and 6 on the four pillars and
holds the fixed tube (each lower pillar has a pin that passes through the bridge into a socket in the pillar above); the cluster of step 3 passes between its arms. The deck plate closes the top at 114 mm.

Because the centre distance is fixed, the module of a pair is 2 × 54 / (z₁ + z₂). A pair of 20 and 62 teeth has
teeth of module 1.32; a pair of 79 and 22 has 1.07.

## The tellurion

On the Earth's arm a stud stands 41 mm out, midway to the earth post at 82 mm. Three clusters turn on the stud and
three coaxial members on the earth post:

| Train | First wheel (at the centre) | Last wheel (at the earth post) | Ratio wanted | Does |
|---|---|---|---|---|
| Axis | on the fixed tube | the earth's axis shaft, innermost | exactly 1 | keeps the leaning axis pointing one way |
| Moon | on the month tube | the moon's sleeve | exactly 1 | carries the Moon's arm round with the month tube |
| Nodes | on the fixed tube | the node sleeve, outermost | 1 / (1 + year / 18.6 years) | turns the inclined ring backwards |

Every axis here is carried by the arm, so a mesh acts on rates relative to the arm. For a train of ratio
(A/B) × (C/D) = R from a wheel turning at rate *c*, the last wheel turns at *e* + R (*c* − *e*) in the room, where *e*
is the arm's rate. With R = 1 it simply copies *c*: zero for the fixed tube, the month's rate for the month tube. With
R a little over 1 and *c* = 0 it turns slowly backwards.

The six tellurion levels are 3.6 mm apart and their wheels 3 mm thick. From the arm up: the axis shaft's wheel (1),
the axis wheel on the fixed tube (2), the node wheel on the fixed tube (3), the moon sleeve's wheel (4), the moon
wheel on the month tube (5), the node sleeve's wheel (6). At the earth post the innermost member has the lowest wheel,
so the three members come out of the top in the order they are needed: the node sleeve ends first and carries the
inclined ring, the moon's sleeve next with the Moon's arm, the axis shaft last with the globe. The node cluster is
tall, with the moon cluster turning on its sleeve between its two wheels; in the kit its upper wheel is a separate
piece pressed on last.

The Moon's stalk slides in a hole in the Moon's arm and stands on the ring, which is tipped 5.145° about the line of
nodes. The Moon's height above the plane is therefore 18 mm × tan 5.145° × sin(Moon − node).

## Rules a train must meet

`layout.ts` checks every train; the Workbench will not fit one that fails.

- At least 10 teeth and at most 160 on any wheel. Under ten, undercut removes so much of the flank that the mesh
  loses contact between one tooth and the next. (The designer keeps to 12 to 96 unless asked otherwise.)
- Module at least 0.5 mm and at most 3.2 mm (the designer: at least 1.0).
- The root circle of a wheel on a tube leaves 1.6 mm of hub outside the tube. The root circle of a cluster wheel
  clears the cluster's 10 mm hub. Since tip-to-root clearance is a quarter of a module, this also keeps the tips of
  each wheel off the hub of its mate.
- On the earth post, wheels must pass inside Mars's stalk.
- The crank's bevel wheel must clear the idler post.
- Advice, not a bar: the axis and Moon trains should be exactly one to one. The Workbench lets you break this and
  shows what happens.

## Rates and setting

`kinematics.ts` multiplies tooth counts into the rate of every body as an exact fraction of the crank's rate. Saturn's,
for the machine as designed, is 1642674176/602894358255 of a turn per turn of the crank.

A cluster is one rigid piece, so its two wheels have a fixed relation; the wheels on tubes and sleeves are friction
fits, as the arms are, and take whatever angle puts their teeth in mesh. To set the machine for a date, each arm is
turned on its tube to the body's mean longitude, the Moon's arm to the Moon's mean longitude, the inclined ring to the
mean node, and the Earth's axis is leaned towards longitude 90°.

Machine time is counted on the Earth's arm: one turn of it is one sidereal year.

## Teeth

`src/core/gears/involute.ts` generates each wheel as the envelope of a basic rack (pressure angle 20°, addendum 1,
dedendum 1.25, rack tip radius 0.25, all in modules) rolled on the pitch circle: the straight flank gives the
involute, the rounded corner an offset trochoid for the root fillet. Where the rack reaches below the base circle's
interference depth, the trochoid is intersected with the involute and the undercut is real. Backlash is cut as tooth
thinning: 0.06 mm a wheel on screen, 0.12 mm in the print kit.
