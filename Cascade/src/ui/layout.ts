// Page skeleton: a full-window 3D viewport behind translucent instrument panels.
//
// Desktop (> 760 px): controls column left, charts column right, stats strip top
// centre, timeline bottom centre. Each panel collapses from its header.
// Phone (<= 760 px): the panels become bottom drawers, one at a time, opened from a
// tab bar; the timeline stays docked above the tab bar and the 3D view stays visible.
//
// Stacking: .cx-viewport z 0, .cx-hud z 10, .cx-overlay z 40 (tour card, modal host),
// .cx-toasts z 50. Native <dialog> modals (About) render in the browser top layer.
import { h, icon, ICONS } from './dom';

export type PanelId = 'controls' | 'charts' | 'stats';

export interface Layout {
  /** Full-window container; put the renderer's canvas in here. */
  viewport: HTMLElement;
  controls: HTMLElement;
  charts: HTMLElement;
  stats: HTMLElement;
  timeline: HTMLElement;
  /** Pointer-transparent layer above the panels for the tour card and modals. */
  overlay: HTMLElement;
  toast(msg: string): void;
  /** Phone: open one drawer (null closes). Desktop: expands the panel if collapsed. */
  showPanel(id: PanelId | null): void;
}

interface PanelParts { section: HTMLElement; body: HTMLElement }

const PHONE_QUERY = '(max-width: 760px)';

export function buildLayout(root: HTMLElement): Layout {
  root.classList.add('cx-root');
  root.dataset.drawer = '';

  const viewport = h('div', { class: 'cx-viewport', 'aria-label': '3D shower view' });
  const hud = h('div', { class: 'cx-hud' });
  const overlay = h('div', { class: 'cx-overlay' });
  const toasts = h('div', { class: 'cx-toasts', role: 'status', 'aria-live': 'polite' });

  const panels: Record<PanelId, PanelParts> = {
    controls: makePanel('controls', 'Shower', 'Simulation inputs and display options'),
    charts: makePanel('charts', 'Charts', 'Shower diagnostics'),
    stats: makePanel('stats', 'Readout', 'Shower summary'),
  };

  const brand = h('div', { class: 'cx-brand' },
    h('span', { class: 'cx-brand-mark', 'aria-hidden': 'true' }),
    h('span', { class: 'cx-brand-name', text: 'Cascade' }),
    h('span', { class: 'cx-brand-sub', text: 'air-shower Monte Carlo' }),
  );

  const timelineWrap = h('section', { class: 'cx-panel cx-panel--timeline', 'aria-label': 'Replay timeline' });
  const timeline = h('div', { class: 'cx-panel-body cx-timeline-body' });
  timelineWrap.append(timeline);

  const leftCol = h('div', { class: 'cx-col cx-col--left' }, brand, panels.controls.section);
  const rightCol = h('div', { class: 'cx-col cx-col--right' }, panels.charts.section);
  const topCentre = h('div', { class: 'cx-col cx-col--top' }, panels.stats.section);
  const bottomCentre = h('div', { class: 'cx-col cx-col--bottom' }, timelineWrap);

  const tabbar = h('nav', { class: 'cx-tabbar', 'aria-label': 'Panels' });
  const tabDefs: { id: PanelId; label: string; icon: string }[] = [
    { id: 'controls', label: 'Shower', icon: ICONS.sliders },
    { id: 'charts', label: 'Charts', icon: ICONS.chart },
    { id: 'stats', label: 'Readout', icon: ICONS.gauge },
  ];
  const tabButtons = new Map<PanelId, HTMLButtonElement>();
  for (const t of tabDefs) {
    const b = h('button', { type: 'button', class: 'cx-tab', 'aria-pressed': 'false', 'aria-controls': panels[t.id].section.id });
    b.append(icon(t.icon), h('span', { text: t.label }));
    b.addEventListener('click', () => showPanel(root.dataset.drawer === t.id ? null : t.id));
    tabButtons.set(t.id, b);
    tabbar.append(b);
  }
  const viewTab = h('button', { type: 'button', class: 'cx-tab', 'aria-pressed': 'true' });
  viewTab.append(icon(ICONS.cube), h('span', { text: '3D view' }));
  viewTab.addEventListener('click', () => showPanel(null));
  tabbar.append(viewTab);

  hud.append(leftCol, topCentre, rightCol, bottomCentre, tabbar);
  root.append(viewport, hud, overlay, toasts);

  const phone = window.matchMedia(PHONE_QUERY);

  function showPanel(id: PanelId | null): void {
    if (!phone.matches) {
      if (id) panels[id].section.classList.remove('is-collapsed');
      syncCollapse();
      return;
    }
    root.dataset.drawer = id ?? '';
    for (const [pid, b] of tabButtons) b.setAttribute('aria-pressed', String(pid === id));
    viewTab.setAttribute('aria-pressed', String(id === null));
    for (const [pid, p] of Object.entries(panels) as [PanelId, PanelParts][]) {
      p.section.toggleAttribute('data-open', pid === id);
    }
  }

  function syncCollapse(): void {
    for (const p of Object.values(panels)) {
      const btn = p.section.querySelector<HTMLButtonElement>('.cx-panel-toggle');
      if (btn) btn.setAttribute('aria-expanded', String(!p.section.classList.contains('is-collapsed')));
    }
  }

  for (const p of Object.values(panels)) {
    const btn = p.section.querySelector<HTMLButtonElement>('.cx-panel-toggle')!;
    btn.addEventListener('click', () => {
      if (phone.matches) showPanel(null);
      else {
        p.section.classList.toggle('is-collapsed');
        syncCollapse();
      }
    });
  }

  phone.addEventListener('change', () => {
    if (!phone.matches) {
      root.dataset.drawer = '';
      for (const p of Object.values(panels)) p.section.removeAttribute('data-open');
    }
  });

  // Escape closes an open phone drawer (modals and the tour handle their own Escape).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && phone.matches && root.dataset.drawer) showPanel(null);
  });

  // The tour announces itself with a bubbling 'cx:tour' event: on a phone an open drawer would hide
  // the 3D changes the tour is pointing at, so opening the tour closes it.
  root.addEventListener('cx:tour', (e) => {
    const open = (e as CustomEvent<{ open: boolean }>).detail?.open === true;
    root.toggleAttribute('data-tour', open);
    if (open && phone.matches) showPanel(null);
  });

  // Measured geometry for overlay placement (tour card, toasts): left column width, timeline
  // height, and the bottom edge of the top-centre Readout panel.
  const measure = (): void => {
    const rr = root.getBoundingClientRect();
    root.style.setProperty('--cx-left-w', `${Math.round(leftCol.getBoundingClientRect().width)}px`);
    root.style.setProperty('--cx-right-w', `${Math.round(rightCol.getBoundingClientRect().width)}px`);
    root.style.setProperty('--cx-tl-h', `${Math.round(timelineWrap.getBoundingClientRect().height)}px`);
    const sb = panels.stats.section.getBoundingClientRect();
    root.style.setProperty('--cx-top-h', `${Math.max(0, Math.round(sb.bottom - rr.top - 12))}px`);
  };
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(measure);
    for (const t of [leftCol, rightCol, timelineWrap, panels.stats.section, root]) ro.observe(t);
  }
  requestAnimationFrame(measure);

  function toast(msg: string): void {
    const t = h('div', { class: 'cx-toast', text: msg });
    toasts.append(t);
    while (toasts.children.length > 2) toasts.firstElementChild?.remove();
    requestAnimationFrame(() => t.classList.add('is-in'));
    window.setTimeout(() => {
      t.classList.remove('is-in');
      window.setTimeout(() => t.remove(), 300);
    }, 4200);
  }

  return {
    viewport,
    controls: panels.controls.body,
    charts: panels.charts.body,
    stats: panels.stats.body,
    timeline,
    overlay,
    toast,
    showPanel,
  };
}

function makePanel(id: PanelId, title: string, label: string): PanelParts {
  const section = h('section', { class: `cx-panel cx-panel--${id}`, id: `cx-panel-${id}`, 'aria-label': label });
  const toggle = h('button', { type: 'button', class: 'cx-panel-toggle', 'aria-expanded': 'true', 'aria-label': `Collapse ${title}` });
  toggle.append(icon(ICONS.chevron));
  const header = h('header', { class: 'cx-panel-head' }, h('h2', { class: 'cx-panel-title', text: title }), h('div', { class: 'cx-panel-actions' }), toggle);
  const body = h('div', { class: 'cx-panel-body' });
  section.append(header, body);
  return { section, body };
}

/** True when the phone layout is active. */
export function isPhoneLayout(): boolean {
  return window.matchMedia(PHONE_QUERY).matches;
}
