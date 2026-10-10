/**
 * Run Find lines in a worker (see findLinesWorker.ts) - inlined into the page
 * as a blob, which the app's Content-Security-Policy allows (worker-src blob:),
 * so the packaged app needs no extra file on disk.
 *
 * ⚑ Bounded, like every await on a third-party worker in this project: a
 * worker that never answers must become a refusal, not a card that says
 * "Finding lines..." for ever.
 */
import FindLinesWorker from './findLinesWorker.ts?worker&inline';
import type { FindLinesOptions, FindLinesResult } from '../../algorithms/findLines/lines.js';
import type { Box, RGB } from '../../algorithms/findLines/ink.js';

const TIMEOUT_MS = 120000;

export function findLinesInWorker(data: Uint8ClampedArray, width: number, height: number, colour: RGB, box: Box, opts: FindLinesOptions): Promise<FindLinesResult | { error: string }> {
  return new Promise((resolve) => {
    const worker = new FindLinesWorker();
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ error: 'Find lines did not finish within two minutes, so it was stopped. Try a smaller plot box, or crop the figure first.' });
    }, TIMEOUT_MS);
    worker.onmessage = (e: MessageEvent<{ ok?: FindLinesResult; error?: string }>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data.ok ?? { error: `Find lines failed: ${e.data.error ?? 'unknown error'}` });
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ error: `Find lines failed: ${e.message || 'the worker stopped'}` });
    };
    // a copy, so the canvas keeps its own pixels
    worker.postMessage({ data: new Uint8ClampedArray(data), width, height, colour, box, opts });
  });
}
