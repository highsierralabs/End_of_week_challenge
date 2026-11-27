// Main-thread wrapper around the simulation workers. A new request cancels the
// previous one by terminating its workers, so a long run never blocks a new one.
//  - small showers run whole in one worker;
//  - big showers are split after their first interactions into SPLIT_PARTS parts that
//    run on a pool of workers and are merged here (same result on any machine);
//  - sky mode plans its showers here, runs them on the pool and merges them.
import { beginShower, mergeShower, SPLIT_PARTS } from '../physics/cascade';
import { mergeSky, planSky, type SkyInfo, type SkyOptions } from '../physics/sky';
import type { ShowerParams, ShowerResult, WorkerRequest, WorkerResponse } from '../physics/types';

export interface SkyRun { result: ShowerResult; brightest: ShowerResult; info: SkyInfo }
export type Progress = (fraction: number, tracked: number) => void;

/** Showers at or above this energy (eV) are split across the pool. */
export const SPLIT_ABOVE_EV = 3e15;

export class SimClient {
  private workers: Worker[] = [];
  private reject: ((e: Error) => void) | null = null;

  /** Number of workers the pool uses on this machine. */
  readonly poolSize = Math.max(1, Math.min((typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) - 1, 8));

  async run(params: ShowerParams, onProgress: Progress): Promise<ShowerResult> {
    if (params.energyEV < SPLIT_ABOVE_EV || this.poolSize < 2) {
      const [r] = await this.pool([{ kind: 'run', id: 1, params }], onProgress, 1);
      return r!;
    }
    this.cancel();
    const t0 = performance.now();
    const h = beginShower(params, SPLIT_PARTS);
    const tasks: WorkerRequest[] = h.parts.map((seeds, i) => ({ kind: 'part', id: i + 1, params: h.partParams[i]!, cont: h.cont, seeds }));
    const parts = await this.pool(tasks, onProgress);
    const merged = mergeShower(params, h.head, parts);
    // Report wall time, which is what the user waited for.
    merged.stats.cpuMs = performance.now() - t0;
    return merged;
  }

  async skyParallel(options: SkyOptions, onProgress: Progress): Promise<SkyRun> {
    const plan = planSky(options);
    const tasks: WorkerRequest[] = plan.params.map((params, i) => ({ kind: 'run', id: i + 1, params }));
    const showers = await this.pool(tasks, onProgress);
    return mergeSky(plan, showers);
  }

  /** Run tasks on a fresh pool; results come back in task order. */
  private pool(tasks: WorkerRequest[], onProgress: Progress, size = this.poolSize): Promise<ShowerResult[]> {
    this.cancel();
    const total = tasks.length;
    const n = Math.max(1, Math.min(total, size));
    const results = new Array<ShowerResult>(total);
    const frac = new Float64Array(total);
    const trackedBy = new Float64Array(total);
    let next = 0, done = 0;
    const workers: Worker[] = [];
    this.workers = workers;
    const report = (): void => {
      let f = 0, t = 0;
      for (let i = 0; i < total; i++) { f += frac[i]!; t += trackedBy[i]!; }
      onProgress(f / total, t);
    };
    return new Promise<ShowerResult[]>((resolve, reject) => {
      this.reject = reject;
      const finish = (): void => {
        for (const w of workers) w.terminate();
        if (this.workers === workers) { this.workers = []; this.reject = null; }
      };
      const fail = (e: Error): void => { finish(); reject(e); };
      const feed = (w: Worker): void => {
        if (next >= total) return;
        w.postMessage(tasks[next++]!);
      };
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        workers.push(w);
        w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
          const m = ev.data;
          const k = m.id - 1;
          if (m.kind === 'progress') { frac[k] = m.fraction; trackedBy[k] = m.tracked; report(); }
          else if (m.kind === 'done') {
            results[k] = m.result;
            frac[k] = 1;
            trackedBy[k] = m.result.stats.particlesTracked;
            report();
            if (++done === total) { finish(); resolve(results); } else feed(w);
          } else if (m.kind === 'error') fail(new Error(m.message));
        };
        w.onerror = (e) => fail(new Error(e.message || 'worker error'));
        feed(w);
      }
    });
  }

  cancel(): void {
    if (!this.workers.length) return;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.reject?.(new Error('cancelled'));
    this.reject = null;
  }
}
