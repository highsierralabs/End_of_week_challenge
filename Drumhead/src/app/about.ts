// The "About" text: the depth behind the toy.

export const ABOUT_HTML = `
<p><strong>Drumhead</strong> turns any shape you draw into a drum. It works out how that shape can vibrate, then lets
you play it. Every drum also comes with a dish of sand that shows where its surface stands still.</p>

<h3>What you are hearing</h3>
<p>A drumhead is a membrane stretched over a rim. It has no single note. It can vibrate in many <em>modes</em>, each with
its own frequency and its own pattern of hills and valleys. A mode's <em>nodal lines</em> are where the membrane does
not move. When you strike the drum, every mode starts at once, each as loudly as the drum moves at the point you
struck. That is why a drum sounds different at the centre and near the rim. Strike exactly on a nodal line and that
mode stays silent.</p>
<p>A string's overtones fall at whole-number multiples of its fundamental, which is why it sounds like one note. A
membrane's overtones do not. For a circle they fall at 1, 1.59, 2.14, 2.30, 2.65 times the fundamental, set by the
zeros of Bessel functions, and the ear hears a thud with a pitch somewhere inside it. The strip along the bottom shows
every mode Drumhead found. Tap a tick to hear that mode alone. The pictures under <em>Modes</em> show their shapes.</p>

<h3>Can one hear the shape of a drum?</h3>
<p>Mark Kac asked this in 1966. If you knew every frequency a drum can make, could you work out its shape? A good deal
can be heard. Weyl's law says that the number of frequencies below a given one grows in proportion to the drum's
<em>area</em>, and the next term of that count gives away the <em>perimeter</em>. The card beside the drum does this
for you: it fits Weyl's law to the frequencies and reports the area and perimeter it hears, next to the true ones.
You can also hear that a drum is <em>not</em> a circle. Of all shapes with the same area, the circle has the lowest
fundamental (the Faber-Krahn inequality), and the card says how far above that floor your drum sits.</p>
<p>But in 1992 Carolyn Gordon, David Webb and Scott Wolpert showed that the answer is <em>no</em>. They found two
different shapes with exactly the same frequencies. Those are the <em>Twins</em>. Each is built from seven copies of
the same right-angled triangle, put together in two different ways. The proof, by "transplantation", takes any
vibration of one drum and rebuilds it, piece by piece, as a vibration of the other at the same frequency.</p>
<p>Drumhead builds both twins from seven identical triangle meshes. Transplantation then holds for the computer's
equations exactly, not just for the ideal drums, so their computed frequencies agree to rounding error. The card shows
the largest difference. The Modes view shows the same frequencies arising from completely different patterns. Play
both drums at the same spot and you will hear different sounds, because the strike point excites the modes
differently. Play the same <em>mode</em> on each and the pitch is identical.</p>

<h3>The sand</h3>
<p>In 1787 Ernst Chladni sprinkled sand on a metal plate and bowed its edge. The sand jumped off the moving parts and
settled along the nodal lines, drawing the mode. In <em>Sand</em> mode the drum is driven at one frequency, from the
point marked with a cross-hair. Each grain is thrown about in proportion to how hard the surface under it is shaking,
so the grains drain into the places that stay still. Sweep the frequency along the strip: off resonance the sand barely
stirs, and as you pass each mode it runs into that mode's figure. Chladni's plates were stiff plates with free edges,
which obey a different equation. Here it is the membrane clamped at its rim, but the idea is the same.</p>

<h3>How it works</h3>
<ol>
<li>The shape is filled with a mesh of a few thousand triangles. Freehand shapes use an equilateral lattice whose
outermost points are snapped onto your line. The presets with straight sides are cut into a few large triangles and
subdivided evenly.</li>
<li>The wave equation on that mesh becomes a matrix problem, <span class="dh-eq">K&nbsp;x = &lambda;&nbsp;M&nbsp;x</span>,
using linear finite elements: K holds the membrane's stiffness and M its mass, with the rim held fixed.</li>
<li>The lowest modes are found with the Lanczos method, applied to K<sup>&minus;1</sup>. The vertices are reordered by
reverse Cuthill-McKee so that K factors cheaply as a band matrix. All of this runs in a Web Worker and takes under a
second.</li>
<li>Sound is <em>modal synthesis</em>: one decaying sine per mode, in an AudioWorklet. A strike excites each mode by
the mode's height at the strike point. A felt or hard mallet (the Sound panel) rolls off the high modes, and a short
click is added for the mallet's contact. Higher modes decay faster.</li>
<li>The picture shows the same vibration, slowed down a hundredfold or more so the eye can follow it. Vermilion is up,
Prussian blue is down, and the black lines are where the membrane is still.</li>
</ol>

<h3>How far to trust it</h3>
<p>The solver is checked against exact answers. For the unit square and the unit disc its frequencies are within 1% of
the true ones. For the twins, every one of the first 25 eigenvalues is within 1% of Tobin Driscoll's 12-digit values
(<em>SIAM Review</em>, 1997), and the ninth mode, which is the triangle's own first mode, is within 0.2% of exactly
5&pi;&sup2;/4. The higher modes are less accurate than the low ones, because fewer triangles span each wave. The
<a href="validation.html">validation page</a> reruns all of these checks in your browser and shows how the error falls as
the mesh is refined.</p>
<p>The drum is an ideal membrane. It has no air loading, no stiffness and no air cavity behind it, so it sounds
cleaner and more bell-like than a real timpani or tom. The losses are a simple model chosen to sound plausible, not
measured from a real drum. <em>Pitch</em> sets the membrane's wave speed, which depends on its tension and weight.
The table is one metre across, so a bigger drawing really is a lower drum.</p>

<p class="dh-fig">Made for the End of week challenge. The source, tests and notes are on GitHub:
<a href="https://github.com/highsierralabs/End_of_week_challenge/tree/main/Drumhead" target="_blank" rel="noopener">End_of_week_challenge/Drumhead</a>.</p>
`;
