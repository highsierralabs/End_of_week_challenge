// Main-thread wrapper around the simulation worker. A new run cancels the previous
// one by terminating its worker, so a long shower never blocks a new request.
import type { ShowerParams, ShowerResult, WorkerResponse } from '../physics/types';

export type Progress = (fraction: number, tracked: number) => void;

export class SimClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private reject: ((e: Error) => void) | null = null;

  run(params: ShowerParams, onProgress: Progress): Promise<ShowerResult> {
    this.cancel();
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    const id = this.nextId++;
    return new Promise<ShowerResult>((resolve, reject) => {
      this.reject = reject;
      worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const m = ev.data;
        if (m.id !== id) return;
        if (m.kind === 'progress') onProgress(m.fraction, m.tracked);
        else if (m.kind === 'done') { this.finish(); resolve(m.result); }
        else { this.finish(); reject(new Error(m.message)); }
      };
      worker.onerror = (e) => { this.finish(); reject(new Error(e.message || 'worker error')); };
      worker.postMessage({ kind: 'run', id, params });
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
