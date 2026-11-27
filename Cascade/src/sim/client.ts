// Main-thread wrapper around the simulation worker. A new run cancels the previous
// one by terminating its worker, so a long shower never blocks a new request.
import type { ShowerParams, ShowerResult, WorkerRequest, WorkerResponse } from '../physics/types';
import type { SkyInfo, SkyOptions } from '../physics/sky';

export interface SkyRun { result: ShowerResult; brightest: ShowerResult; info: SkyInfo }

export type Progress = (fraction: number, tracked: number) => void;

export class SimClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private reject: ((e: Error) => void) | null = null;

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
