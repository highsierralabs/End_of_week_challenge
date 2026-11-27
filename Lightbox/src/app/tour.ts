// The tour: twelve live scenes, each showing one thing light does, with a suggestion for what
// to change. Any step can be taken into the studio.
import type { Scene } from '../core/scene';
import { cornellBox, gasTubes, gems, newtonPrism, rayBox, stillLife } from '../core/scenes';
import { ballLens, causticScene, depthScene, fresnelScene, sodiumScene, softShadows } from '../core/tourscenes';
import { button, clear, h } from './controls';
import type { Store } from './store';

interface Step { title: string; text: string[]; tryIt: string; scene: () => Scene }

const STEPS: Step[] = [
  {
    title: 'A picture made of chances',
    text: [
      'Nothing here is drawn. For every pixel, the page follows one ray of one colour backwards from the camera, lets it bounce the way light bounces, and notes how much light it found. Then it does that again, and again.',
      'One try is noise. A few hundred are a photograph. Watch the count at the bottom left: the grain you see fading is the error of an average shrinking.',
    ],
    tryIt: 'Drag the background to look around. The picture starts over and settles again.',
    scene: stillLife,
  },
  {
    title: 'Shadows have edges of their own',
    text: [
      'A shadow is sharp only when the lamp is small. From a large lamp, part of the table sees part of the lamp, and the shadow fades out through that half-lit band.',
      'Two lamps here: a small warm one on the left, a large cool one on the right. Each object throws both kinds of shadow, and where one lamp is hidden the other tints the table.',
    ],
    tryIt: 'In the studio, select the large lamp and shrink it. Its shadows harden.',
    scene: softShadows,
  },
  {
    title: 'Walls are lamps too',
    text: [
      'Every lit surface sends light on. The white block takes a red cast on the side facing the red wall, and the floor, the ceiling and the back wall glow red and green toward their edges: light that left the lamp, struck paint, and carried the paint\u2019s colour with it.',
      'This second-hand light is most of what you see in a room. Take it away and shadows turn black.',
    ],
    tryIt: 'In the studio, set Bounces to 2 under Room and watch the box go dark.',
    scene: cornellBox,
  },
  {
    title: 'Glass is a mirror at a glance',
    text: [
      'Looking straight at glass, about one part in twenty-five of the light comes back. Looking along it, nearly all does. That is Fresnel’s law, and it is why a lake mirrors the far shore but shows you the stones at your feet.',
      'The black table is glossy: its reflections are faint below you and strong toward the horizon. The chrome ball reflects at every angle, and the copper one colours what it reflects, because copper returns red light better than blue.',
    ],
    tryIt: 'Orbit low, close to the table, and the reflections strengthen.',
    scene: fresnelScene,
  },
  {
    title: 'Bending',
    text: [
      'Light slows in glass, and a ray that enters at an angle turns. A solid glass ball bends everything passing through it so strongly that it works as a lens and shows the blocks behind it upside down.',
      'The view is inverted because rays from the top of a block cross to the bottom on their way through the ball, and left crosses to right. Under the ball, the light it gathered lands in a bright patch; that is the next step.',
    ],
    tryIt: 'In the studio, change the ball’s glass to diamond or to water and see the view inside change.',
    scene: ballLens,
  },
  {
    title: 'Where the bent light lands',
    text: [
      'The light a glass gathers has to go somewhere. It lands as a bright knot inside the shadow: a caustic.',
      'These are nearly impossible to find by tracing from the camera, so a second tracer works the other way, firing photons from the lamp through the glass and marking where they land. The two share the work so that every path of light is counted exactly once.',
    ],
    tryIt: 'In the studio, open Darkroom and turn off the photon pass. The same caustics return, grain by grain, far more slowly.',
    scene: causticScene,
  },
  {
    title: 'White light, taken apart',
    text: [
      'Glass slows blue light more than red, so it bends blue more. A prism turns that small difference into a spread of colour. This is Newton’s experiment: a slit of white light, a prism, a card.',
      'Nothing in the tracer knows about rainbows. It knows the glass’s measured index at each wavelength, traces one wavelength per ray, and the spectrum appears on the card.',
    ],
    tryIt: 'In the studio, select the prism and use Turn to rotate it a few degrees: the spectrum slides along the card and stretches.',
    scene: newtonPrism,
  },
  {
    title: 'Fire',
    text: [
      'Diamond bends light more than any glass and separates colours strongly. A brilliant cut is shaped so that light entering the top reflects off the back facets and leaves through the top again, split into colour on the way.',
      'Each of the 57 facets is a small prism and a small mirror. The flashes of pure colour are single wavelengths that happened to find your eye.',
    ],
    tryIt: 'Orbit slowly. In the studio, change the diamond to crown glass and the fire goes out.',
    scene: gems,
  },
  {
    title: 'Light with gaps in it',
    text: [
      'A glowing solid emits every colour. A glowing gas emits only the few wavelengths its atoms allow: hydrogen four, sodium essentially one, neon dozens crowded into the red.',
      'Each tube here radiates its element’s lines, at the wavelengths NIST lists. The chrome ball and the white block show what such light does to a scene. The Spectroscope mode takes these lamps apart.',
    ],
    tryIt: 'In the studio, select a tube and change its gas.',
    scene: gasTubes,
  },
  {
    title: 'One wavelength, no colour',
    text: [
      'These six balls are painted red, orange, yellow, green, blue and violet. The lamp above them is low-pressure sodium, which emits nearly all its light at 589 nanometres.',
      'A paint can only reflect or absorb the light it is given. Given one wavelength, every paint is some shade of the same yellow. Colour was never in the paint alone.',
    ],
    tryIt: 'In the studio, select the lamp and change its Light to Daylight. The colours come back.',
    scene: sodiumScene,
  },
  {
    title: 'A lens has a width',
    text: [
      'A pinhole camera is sharp everywhere. A real lens gathers light through a wide opening, and only one distance comes to a point on the film; nearer and farther points spread into discs the shape of the aperture.',
      'This is an 85 mm lens wide open at f/1.4, focused on the green ball. The small lamps far behind have become hexagons: pictures of the six-bladed aperture.',
    ],
    tryIt: 'In the studio, open the Camera tab and turn the aperture ring to f/16. Double-click a ball to focus on it.',
    scene: depthScene,
  },
  {
    title: 'No lens is perfect',
    text: [
      'Seven thin beams of white light skim the table, so each draws its own path. A glass rod standing on end works as a lens: it bends the beams together, they cross just behind it and fan out again.',
      'But they do not cross at one point. The outer beams are bent too much and cross sooner than the inner ones (spherical aberration), and each beam leaves the glass spread into colours, blue bent more than red (chromatic aberration). A camera lens is a stack of several glasses and curves chosen to cancel both.',
    ],
    tryIt: 'In the studio, drag the rod sideways across the beams, or change its glass to crown glass: the crossing point moves away.',
    scene: rayBox,
  },
];

export class Tour {
  /** Called when the visitor takes the current step's scene into the studio. */
  onTry: (() => void | Promise<void>) | null = null;
  private index = 0;

  constructor(private readonly root: HTMLElement, private readonly store: Store) {}

  async enter(): Promise<void> { await this.go(this.index); }

  get step(): number { return this.index; }
  get count(): number { return STEPS.length; }

  async go(i: number): Promise<void> {
    this.index = Math.min(STEPS.length - 1, Math.max(0, i));
    const s = STEPS[this.index]!;
    this.render();
    await this.store.load(s.scene());
  }

  private render(): void {
    const s = STEPS[this.index]!;
    clear(this.root);
    const dots = h('div', { class: 'lb-dots' });
    STEPS.forEach((st, i) => dots.append(h('button', { type: 'button', class: `lb-dot${i === this.index ? ' on' : ''}`, 'aria-label': `Step ${i + 1}: ${st.title}`, onclick: () => { void this.go(i); } })));
    const prev = button('Back', () => { void this.go(this.index - 1); });
    prev.disabled = this.index === 0;
    const next = button(this.index === STEPS.length - 1 ? 'Start over' : 'Next', () => { void this.go(this.index === STEPS.length - 1 ? 0 : this.index + 1); }, 'primary');
    this.root.append(
      h('div', { class: 'lb-step-count', text: `${String(this.index + 1).padStart(2, '0')} / ${STEPS.length}` }),
      h('h2', { text: s.title }),
      ...s.text.map((t) => h('p', { text: t })),
      h('p', { class: 'lb-try', text: s.tryIt }),
      h('div', { class: 'lb-tour-nav' }, prev, next),
      h('div', { class: 'lb-tour-nav' }, button('Open this scene in the studio', () => { void this.onTry?.(); })),
      dots,
    );
  }
}
