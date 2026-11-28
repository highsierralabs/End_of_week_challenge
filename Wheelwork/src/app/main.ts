// Entry point: one model, one stage, one set of controls, one frame loop.
import './style.css';
import { buildLayout } from '../core/machine/layout';
import { decodeSpec } from '../core/machine/spec';
import { Model, PHYSICAL_LIMITS } from './model';
import { App } from './ui/app';
import { h } from './ui/dom';
import { Stage, type ViewName } from './view/stage';

declare global {
  interface Window {
    wheelwork: { ready: boolean; error?: string; model?: Model; stage?: Stage; app?: App };
  }
}

window.wheelwork = { ready: false };

function fatal(message: string): void {
  window.wheelwork.error = message;
  document.getElementById('ui')!.append(h('div.fatal', null, h('div', null,
    h('h1', null, 'Wheelwork'),
    h('p', null, message),
    h('p', null, 'It needs a browser with WebGL2: a current Chrome, Edge, Firefox or Safari.'))));
}

function start(): void {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const params = new URLSearchParams(location.search);
  const model = new Model(Model.todayJd());

  // A machine carried in the link.
  const carried = params.get('m');
  if (carried) {
    const spec = decodeSpec(carried, model.original);
    if (spec && buildLayout(spec, PHYSICAL_LIMITS).ok) model.setSpec(spec);
  }

  const small = Math.min(window.innerWidth, window.innerHeight) < 600 || (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820);
  const quality = params.get('q') === 'low' || (small && params.get('q') !== 'high') ? 'low' : 'high';
  let stage: Stage;
  try {
    stage = new Stage(canvas, model, { quality });
  } catch (e) {
    fatal(`The 3D view could not start (${(e as Error).message}).`);
    return;
  }
  const app = new App(document.getElementById('ui')!, model, stage);
  Object.assign(window.wheelwork, { model, stage, app });

  model.on('spec', () => stage.rebuild());
  model.on('setting', () => stage.applyPhases());
  const resize = () => { app.layout(); stage.resize(); };
  window.addEventListener('resize', resize);
  resize();

  // Deep links, mostly for screenshots and tests.
  const view = params.get('view') as ViewName | null;
  if (view) app.setView(view, 0);
  if (params.get('still')) stage.controls.autoRotate = false;
  if (params.get('lamp')) { app.setLamp(true); stage.lamp = 1; }
  if (params.get('turns')) model.setTurns(Number(params.get('turns')));
  const tab = params.get('tab');
  if (tab === 'tour' || tab === 'sky' || tab === 'workbench' || tab === 'print' || tab === 'about') app.showTab(tab);
  if (params.get('stop')) app.tour.go(Number(params.get('stop')) - 1);
  if (params.get('ui') === '0') { document.getElementById('ui')!.style.display = 'none'; app.layout(); }

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fatal('The graphics context was lost. Reload the page to carry on.'); });

  let last = performance.now();
  const tick = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    app.frame(dt, now);
    if (stage.frames === 3) window.wheelwork.ready = true;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

try {
  start();
} catch (e) {
  fatal(`Something went wrong while starting (${(e as Error).message}).`);
}
