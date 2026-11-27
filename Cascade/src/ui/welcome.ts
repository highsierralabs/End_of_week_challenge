// First-visit card: what this is, and three ways in. Shown once (remembered in localStorage).
import { h } from './dom';

export interface WelcomeHandlers { onTour(): void; onSky(): void; onExplore(): void }

const KEY = 'cascade.welcomed.v1';

export function maybeShowWelcome(el: HTMLElement, hd: WelcomeHandlers, force = false): void {
  try {
    if (!force && localStorage.getItem(KEY)) return;
  } catch { /* storage blocked: show it */ }
  const close = (): void => {
    card.classList.add('cx-welcome--out');
    setTimeout(() => card.remove(), 250);
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
  };
  const btn = (label: string, cls: string, f: () => void): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: `cx-btn ${cls}`, text: label });
    b.addEventListener('click', () => { close(); f(); });
    return b;
  };
  const card = h('section', { class: 'cx-welcome', role: 'dialog', 'aria-label': 'Welcome to Cascade' },
    h('div', { class: 'cx-welcome-kicker', text: 'Cascade' }),
    h('h2', { class: 'cx-welcome-title', text: 'A cosmic ray just hit the atmosphere over Nevada.' }),
    h('p', { class: 'cx-welcome-text', html:
      'Your browser simulated it particle by particle (hundreds of thousands of them) and is replaying it ' +
      '<b>hundreds of thousands of times slower than light</b>. The orange streak is the incoming proton; the glow is its ' +
      'cascade of photons, electrons and muons sweeping down to the high desert near Reno. ' +
      'The blue beacon marks a detector modelled on a real citizen observatory’s (its place here is illustrative).' }),
    h('div', { class: 'cx-welcome-actions' },
      btn('Take the 2-minute tour', 'cx-btn--primary', hd.onTour),
      btn('Watch the sky for 100 µs', '', hd.onSky),
      btn('Just explore', 'cx-btn--ghost', hd.onExplore),
    ),
    h('p', { class: 'cx-welcome-keys', html: '<kbd>Space</kbd> play/pause · <kbd>H</kbd> hide interface · <kbd>S</kbd> sound · drag to orbit, scroll to zoom' }),
  );
  el.append(card);
}
