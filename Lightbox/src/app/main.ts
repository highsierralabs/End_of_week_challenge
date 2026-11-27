import { studioScene } from '../core/scenes';
import type { Scene } from '../core/scene';
import { View } from './view';

declare global {
  interface Window { lightbox: { view: View; ready: boolean; error: string | null; load: (s: Scene) => void } }
}

const canvas = document.getElementById('view') as HTMLCanvasElement;
const view = new View(canvas);
window.lightbox = { view, ready: false, error: null, load: (s) => view.setScene(s) };
const fit = () => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.resize(Math.round(canvas.clientWidth * dpr), Math.round(canvas.clientHeight * dpr));
};
fit();
window.addEventListener('resize', fit);
const t0 = performance.now();
view.tracer.ready().then(() => {
  console.log(`shaders ready in ${Math.round(performance.now() - t0)} ms`);
  view.setScene(studioScene());
  view.start();
  window.lightbox.ready = true;
}).catch((e: Error) => {
  window.lightbox.error = e.message;
  console.error(e.message);
});
