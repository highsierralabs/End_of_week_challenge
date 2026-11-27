// Replay timeline: shower clock, scrubber, play/pause, slow-motion factor.
// The physics clock has t = 0 at the first interaction (src/physics/cascade.ts).
import { h, icon, ICONS } from './dom';
import { clamp, metres, timeNs } from './format';

export interface TimelineMarker { tNs: number; label: string }

export interface TimelineState {
  playing: boolean;
  tNs: number;
  tMinNs: number;
  tMaxNs: number;
  nsPerSecond: number;
  /** Optional ticks on the scrubber, e.g. { tNs: stats.tCore, label: 'core reaches ground' }. */
  markers?: TimelineMarker[];
}

export interface TimelineHandlers {
  onPlayPause(): void;
  onSeek(fraction: number): void;
  onSpeed(nsPerSecond: number): void;
}

export interface Timeline {
  setState(s: TimelineState): void;
  /** Removes the global keyboard listener. */
  destroy(): void;
}

/** Slow-motion presets, shower nanoseconds per real second. */
export const SPEEDS_NS_PER_S = [200, 1000, 5000, 20000, 100000] as const;
const C_M_PER_NS = 0.299792458;
const SCRUB_STEPS = 10000;

export function createTimeline(el: HTMLElement, hd: TimelineHandlers): Timeline {
  el.classList.add('cx-timeline');

  const playBtn = h('button', { type: 'button', class: 'cx-play', 'aria-label': 'Play (space)', title: 'Play / pause (space)' });
  const playIcon = icon(ICONS.play);
  const pauseIcon = icon(ICONS.pause);
  playBtn.append(playIcon);
  playBtn.addEventListener('click', () => hd.onPlayPause());

  const clock = h('div', { class: 'cx-clock' },
    h('span', { class: 'cx-clock-t' }),
    h('span', { class: 'cx-clock-sub' }),
  );
  const clockT = clock.firstElementChild as HTMLElement;
  const clockSub = clock.lastElementChild as HTMLElement;

  const scrub = h('input', { type: 'range', min: 0, max: SCRUB_STEPS, step: 1, value: 0, class: 'cx-range cx-scrub', 'aria-label': 'Replay time' });
  const markerLayer = h('div', { class: 'cx-scrub-markers', 'aria-hidden': 'true' });
  const scrubWrap = h('div', { class: 'cx-scrub-wrap' }, markerLayer, scrub);
  const span = h('div', { class: 'cx-span' }, h('span'), h('span'));
  const spanLo = span.firstElementChild as HTMLElement;
  const spanHi = span.lastElementChild as HTMLElement;

  let dragging = false;
  scrub.addEventListener('pointerdown', () => { dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });
  scrub.addEventListener('input', () => hd.onSeek(Number(scrub.value) / SCRUB_STEPS));
  scrub.addEventListener('change', () => { dragging = false; });

  const speedSel = h('select', { class: 'cx-select cx-speed', 'aria-label': 'Slow-motion factor' });
  for (const s of SPEEDS_NS_PER_S) speedSel.append(h('option', { value: String(s), text: speedLabel(s) }));
  speedSel.addEventListener('change', () => hd.onSpeed(Number(speedSel.value)));
  const speedHint = h('span', { class: 'cx-speed-hint' });
  const speed = h('div', { class: 'cx-speed-wrap' }, speedSel, speedHint);

  el.append(
    h('div', { class: 'cx-tl-row' }, playBtn, clock, speed),
    h('div', { class: 'cx-tl-row cx-tl-row--scrub' }, scrubWrap, span),
  );

  let last: TimelineState | null = null;
  let markerKey = '';

  function setState(s: TimelineState): void {
    const range = s.tMaxNs - s.tMinNs;
    if (!last || last.playing !== s.playing) {
      playBtn.replaceChildren(s.playing ? pauseIcon : playIcon);
      playBtn.setAttribute('aria-label', s.playing ? 'Pause (space)' : 'Play (space)');
      playBtn.classList.toggle('is-playing', s.playing);
    }
    const t = s.tNs;
    clockT.textContent = `t = ${timeNs(Math.abs(t))}`;
    clockSub.textContent = !Number.isFinite(t) ? 'no replay loaded' : t < 0 ? 'before first interaction' : 'after first interaction';
    if (!dragging && range > 0 && Number.isFinite(t)) scrub.value = String(Math.round(clamp((t - s.tMinNs) / range, 0, 1) * SCRUB_STEPS));
    scrub.disabled = !(range > 0);
    scrub.setAttribute('aria-valuetext', `${t < 0 ? 'minus ' : ''}${timeNs(Math.abs(t))}`);
    if (!last || last.tMinNs !== s.tMinNs || last.tMaxNs !== s.tMaxNs) {
      spanLo.textContent = fmtSigned(s.tMinNs);
      spanHi.textContent = fmtSigned(s.tMaxNs);
    }
    if (!last || last.nsPerSecond !== s.nsPerSecond) {
      const known = SPEEDS_NS_PER_S.some((v) => v === s.nsPerSecond);
      if (!known) {
        let opt = speedSel.querySelector<HTMLOptionElement>('option[data-custom]');
        if (!opt) { opt = h('option', { 'data-custom': '' }); speedSel.append(opt); }
        opt.value = String(s.nsPerSecond);
        opt.textContent = speedLabel(s.nsPerSecond);
      }
      speedSel.value = String(s.nsPerSecond);
      speedHint.textContent = `light moves ${metres(s.nsPerSecond * C_M_PER_NS)} per real second`;
    }
    const key = JSON.stringify([s.markers ?? [], s.tMinNs, s.tMaxNs]);
    if (key !== markerKey) {
      markerKey = key;
      markerLayer.replaceChildren();
      for (const m of s.markers ?? []) {
        if (!(range > 0) || !Number.isFinite(m.tNs) || m.tNs < s.tMinNs || m.tNs > s.tMaxNs) continue;
        const tick = h('span', { class: 'cx-scrub-tick', title: `${m.label} (t = ${fmtSigned(m.tNs)})` });
        const frac = (m.tNs - s.tMinNs) / range;
        tick.style.left = `${frac * 100}%`;
        if (frac > 0.8) tick.classList.add('is-right');
        else if (frac < 0.2) tick.classList.add('is-left');
        tick.append(h('span', { class: 'cx-scrub-tick-label', text: m.label }));
        markerLayer.append(tick);
      }
    }
    last = { ...s };
  }

  function onKey(e: KeyboardEvent): void {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY|A)$/.test(t.tagName))) {
      // Range sliders have no native space action, so let space play/pause there too.
      if (!(t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'range')) return;
    }
    if (t?.closest('dialog[open]')) return;
    e.preventDefault();
    hd.onPlayPause();
  }
  window.addEventListener('keydown', onKey);

  return { setState, destroy: () => window.removeEventListener('keydown', onKey) };
}

function speedLabel(ns: number): string {
  return `${timeNs(ns, 2).replace(/\.0(?= )/, '')}/s`;
}

function fmtSigned(ns: number): string {
  return `${ns < 0 ? '−' : ''}${timeNs(Math.abs(ns))}`;
}
