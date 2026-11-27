// Main-thread wrapper around the simulation worker. A new run cancels the previous
// one by terminating its worker, so a long shower never blocks a new request.
import type { ShowerParams, ShowerResult, WorkerRequest, WorkerResponse } from '../physics/types';
import { mergeSky, planSky, type SkyInfo, type SkyOptions } from '../physics/sky';

export interface SkyRun { result: ShowerResult; brightest: ShowerResult; info: SkyInfo }

export type Progress = (fraction: number, tracked: number) => void;

export class SimClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private reject: ((e: Error) => void) | null = null;
  private pool: Worker[] = [];

  /**
   * Sky mode on a pool of workers: the plan (arrivals, energies, directions) is drawn here,
   * the showers run in parallel, and the merge happens on this thread.
   */
  async skyParallel(options: SkyOptions, onProgress: Progress): Promise<SkyRun> {
    this.cancel();
    const plan = planSky(options);
    const total = plan.params.length;
    const n = Math.max(1, Math.min(total, (navigator.hardwareConcurrency || 4) - 1, 8));
    const results: ShowerResult[] = new Array<ShowerResult>(total);
    let next = 0, done = 0, tracked = 0;
    const workers: Worker[] = [];
    this.pool = workers;
    try {
      await new Promise<void>((resolve, reject) => {
        this.reject = reject;
        const feed = (w: Worker): void => {
          if (next >= total) return;
          const k = next++;
          w.postMessage({ kind: 'run', id: k + 1, params: plan.params[k]! } satisfies WorkerRequest);
        };
        for (let i = 0; i < n; i++) {
          const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
          workers.push(w);
          w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
            const m = ev.data;
            if (m.kind === 'done') {
              results[m.id - 1] = m.result;
              done++;
              tracked += m.result.stats.particlesTracked;
              onProgress(done / total, tracked);
              if (done === total) resolve(); else feed(w);
            } else if (m.kind === 'error') reject(new Error(m.message));
          };
          w.onerror = (e) => reject(new Error(e.message || 'worker error'));
          feed(w);
        }
      });
    } finally {
      for (const w of workers) w.terminate();
      if (this.pool === workers) this.pool = [];
      this.reject = null;
    }
    return mergeSky(plan, results);
  }

  run(params: ShowerParams, onProgress: Progress): Promise<ShowerResult> {
    return this.request({ kind: 'run', id: 0, params }, onProgress) as Promise<ShowerResult>;
  }

  sky(options: SkyOptions, onProgress: Progress): Promise<SkyRun> {
    return this.request({ kind: 'sky', id: 0, options }, onProgress) as Promise<SkyRun>;
  }

  private request(req: WorkerRequest, onProgress: Progress): Promise<ShowerResult | SkyRun> {
    this.cancel();
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const id = this.nextId++;
    return new Promise<ShowerResult | SkyRun>((resolve, reject) => {
      this.reject = reject;
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const m = ev.data;
        if (m.id !== id) return;
        if (m.kind === 'progress') onProgress(m.fraction, m.tracked);
        else if (m.kind === 'done') { this.finish(); resolve(m.result); }
        else if (m.kind === 'sky-done') { this.finish(); resolve({ result: m.result, brightest: m.brightest, info: m.info }); }
        else { this.finish(); reject(new Error(m.message)); }
      };
      worker.onerror = (e) => { this.finish(); reject(new Error(e.message || 'worker error')); };
      worker.postMessage({ ...req, id });
    });
  }

  cancel(): void {
    if (this.pool.length) {
      for (const w of this.pool) w.terminate();
      this.pool = [];
      this.reject?.(new Error('cancelled'));
      this.reject = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.reject?.(new Error('cancelled'));
      this.reject = null;
    }
  }

  private finish(): void {
    this.worker?.terminate();
    this.worker = null;
    this.reject = null;
  }
}
