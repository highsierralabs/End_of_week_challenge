// The About panel: what this is, what it leaves out, and where its numbers come from.
import { type App, type Panel } from './app';
import { h } from './dom';

export class AboutPanel implements Panel {
  el: HTMLElement;

  constructor(_app: App) {
    const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
    this.el = h('section.panel.about', null,
      h('h2', null, 'About'),
      h('p.lede', null, "Wheelwork is a clockwork orrery that exists as its own tooth counts. From them the app works out every wheel's size and place, draws the machine, turns it, measures it against the sky and writes it out for a 3D printer."),
      h('h3', null, 'What is real'),
      h('ul', null,
        h('li', null, 'Every rate is an exact product of tooth counts. The planets are not placed by an ephemeris; only the setting of the arms on one date is.'),
        h('li', null, 'The teeth are involute, generated as a rack cutter generates them, undercut included. The wheels you see are the wheels in the print kit.'),
        h('li', null, "The sky it is compared with is a reference ephemeris: JPL's Keplerian elements for the planets and the series of Meeus for the Moon, checked on the ", link('./validation.html', 'validation page'), ' against JPL Horizons.'),
      ),
      h('h3', null, 'What it leaves out'),
      h('ul', null,
        h('li', null, 'Ellipses. The arms turn evenly in circles, as nearly all orreries do. The Sky panel shows what that costs.'),
        h('li', null, 'Scale. The orbits are spaced so that the arms clear one another, and the balls are sized to be seen.'),
        h('li', null, "The Earth's daily spin, the tilts of the other planets' orbits, and the wobble of the Moon's nodes about their mean motion."),
        h('li', null, "Eclipses are called by a simple rule on the Moon's latitude at new and full Moon. Because the Moon and Earth on the machine are far too large for their distance, the lamp throws a shadow more often than the rule allows."),
        h('li', null, 'A printed and assembled copy. The kit is checked by computation only.'),
      ),
      h('h3', null, 'Sources'),
      h('ul', null,
        h('li', null, 'Planets: E. M. Standish, Keplerian Elements for Approximate Positions of the Major Planets, JPL Solar System Dynamics.'),
        h('li', null, 'Moon: J. Meeus, Astronomical Algorithms, chapter 47, with coefficients as carried in the ERFA library (BSD-3-Clause).'),
        h('li', null, 'Reference positions: JPL Horizons, ephemeris DE441.'),
        h('li', null, "Eclipses: Eclipse Predictions by Fred Espenak, NASA's GSFC."),
        h('li', null, 'Coastlines on the globe: Natural Earth, public domain.'),
        h('li', null, 'Drawn with three.js.'),
      ),
      h('p', null, 'Built by Claude for the ', link('../', 'End of week challenge'), '. ', link('https://github.com/highsierralabs/End_of_week_challenge/tree/main/Wheelwork', 'Source and notes'), '. MIT licence.'),
    );
  }

  update(): void { /* nothing changes */ }
}
