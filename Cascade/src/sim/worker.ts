// Simulation worker: runs one shower per request and transfers the typed arrays back.
import { simulateShower } from '../physics/cascade';
import { simulateSky } from '../physics/sky';
import type { WorkerRequest, WorkerResponse } from '../physics/types';

const post = (msg: WorkerResponse, transfer: Transferable[] = []): void => {
  (self as unknown as Worker).postMessage(msg, transfer);
};

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  if (req.kind === 'sky') {
    try {
      const { result, brightest, info } = simulateSky(req.options, (fraction, tracked) => post({ kind: 'progress', id: req.id, fraction, tracked }));
      post({ kind: 'sky-done', id: req.id, result, brightest, info }, [result.segments.buffer, result.ground.buffer]);
    } catch (e) {
      post({ kind: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  try {
    const result = simulateShower(req.params, (fraction, tracked) => post({ kind: 'progress', id: req.id, fraction, tracked }));
    const transfer: Transferable[] = [result.segments.buffer, result.ground.buffer, result.profile.charged.buffer];
    for (const a of result.profile.byClass) transfer.push(a.buffer);
    post({ kind: 'done', id: req.id, result }, transfer);
  } catch (e) {
    post({ kind: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) });
  }
};
