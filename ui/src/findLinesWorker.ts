/**
 * Find lines off the UI thread (v2.6 audit B7). Every stage of the search is
 * per-pixel; on a large scan whose plot fills the page it took seconds, and on
 * the UI thread the whole window froze with it. Here it runs in a worker and
 * the card keeps saying what it is doing.
 */
import { findLines, type FindLinesOptions } from '../../algorithms/findLines/lines.js';
import type { Box, RGB } from '../../algorithms/findLines/ink.js';

interface Job {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colour: RGB;
  box: Box;
  opts: FindLinesOptions;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { data, width, height, colour, box, opts } = e.data;
  try {
    (self as unknown as Worker).postMessage({ ok: findLines(data, width, height, colour, box, opts) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
