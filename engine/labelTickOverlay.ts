/**
 * The tick marks read with an axis's labels (labelCalibration.ts), DRAWN with the app's own tick mark
 * graphics: `categoryAidGlyphs`, the marks the bar categories and the heatmap grid already use.
 *
 * ⚑⚑ David, 2026-10-18: "Why are you not using the same tick mark graphics that we had developed
 * before?" The offer drew each pair as a line from its tick mark to its label, in the measurement
 * layer and the calibration colours: a third look for a tick mark beside the two the app had. In the
 * automatic path the calibration card's second acceptance is the tick marks (XY) or the categories
 * (Bar, Histogram), so they must look the same because they are the same thing.
 *
 * ⚑ No grip: a read tick mark is not a handle yet (adjusting one belongs to the tick marks
 * acceptance, not designed yet), and `AidGlyph` draws a grip only on a mark that is one. A refused
 * axis draws nothing: it is not offered.
 */
import type { AxesFromLabels, AxisFromLabels } from './labelCalibration.js';
import { categoryAidGlyphs, type AidGlyph } from './categoryTickOverlay.js';

type P = { x: number; y: number };

/** The axis's two ends, ordered so `outwardNormal` points away from the plot, toward the labels:
 * an axis along the bottom runs left to right (marks stand down), the top right to left (up), the
 * left top to bottom (left), the right bottom to top (right). */
function edgesFor(a: AxisFromLabels & { ok: true }): [P, P] | null {
  const pts = a.pairs.map((p) => ({ x: p.tick[0], y: p.tick[1] }));
  if (pts.length < 2) return null;
  const along = a.axis === 'x' ? (p: P) => p.x : (p: P) => p.y;
  const sorted = [...pts].sort((p, q) => along(p) - along(q));
  const lo = sorted[0]!, hi = sorted[sorted.length - 1]!;
  return a.side === 'bottom' || a.side === 'left' ? [lo, hi] : [hi, lo];
}

export function labelTickGlyphs(read: AxesFromLabels): AidGlyph[] {
  const out: AidGlyph[] = [];
  for (const a of [read.x, read.y]) {
    if (!a.ok) continue;
    const edges = edgesFor(a);
    if (!edges) continue;
    const tickPoints = a.pairs.map((p) => ({ x: p.tick[0], y: p.tick[1] }));
    for (const g of categoryAidGlyphs({ edges, tickPoints, tickId: (i) => `labelTick-${a.axis}-${i}` })) {
      out.push({ ...g, markerId: null, grip: null });
    }
  }
  return out;
}
