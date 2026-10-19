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
 * ⚑⚑ AND THEY ARE THE ADJUSTABLE TICK MARKERS, not just their look (David, 2026-10-19: "You have still
 * not used the adjustable tick markers that we have developed before?"): each mark carries its grip,
 * and `labelTickMarkers` gives it the same draggable handle, bound on screen to its axis, that
 * `categoryTickMarkers` gives a category tick. A drop moves the tick by the category ticks' rules
 * (`moveLabelTick`): projected onto the axis line, and never across a neighbour.
 * A refused axis draws nothing: it is not offered.
 */
import type { AxesFromLabels, AxisFromLabels } from './labelCalibration.js';
import { categoryAidGlyphs, categoryTickMarkers, type AidGlyph } from './categoryTickOverlay.js';
import type { CanvasMarker } from './canvasOverlays.js';
import { paramAtPoint, pointAtParam } from '../core/bandedAxis.js';

type P = { x: number; y: number };

/** The axis's two ends, ordered so `outwardNormal` points away from the plot, toward the labels:
 * an axis along the bottom runs left to right (marks stand down), the top right to left (up), the
 * left top to bottom (left), the right bottom to top (right). */
function edgesFor(a: AxisFromLabels & { ok: true }, corners: AxesFromLabels['points']): [P, P] | null {
  const pts = a.pairs.map((p) => ({ x: p.tick[0], y: p.tick[1] }));
  // the whole axis, corner to corner, where the read placed the points on the data area's corners (David,
  // 2026-10-19: "the x axis stopped at the 14 tick mark, but it needs to run to the end of the line")
  if (corners) {
    const [origin, xEnd, , yTop] = corners;
    if (a.axis === 'x' && origin && xEnd) pts.push({ x: origin.px, y: origin.py }, { x: xEnd.px, y: xEnd.py });
    if (a.axis === 'y' && origin && yTop) pts.push({ x: origin.px, y: origin.py }, { x: yTop.px, y: yTop.py });
  }
  if (pts.length < 2) return null;
  const along = a.axis === 'x' ? (p: P) => p.x : (p: P) => p.y;
  const sorted = [...pts].sort((p, q) => along(p) - along(q));
  const lo = sorted[0]!, hi = sorted[sorted.length - 1]!;
  return a.side === 'bottom' || a.side === 'left' ? [lo, hi] : [hi, lo];
}

const tickId = (axis: 'x' | 'y') => (i: number) => `labelTick:${axis}:${i}`;

/** The overlay input of each read axis: its ends, and one tick point per pair, in the pairs' order. */
function overlays(read: AxesFromLabels) {
  const out: { axis: 'x' | 'y'; edges: [P, P]; tickPoints: P[] }[] = [];
  for (const a of [read.x, read.y]) {
    if (!a.ok) continue;
    const edges = edgesFor(a, read.points);
    if (!edges) continue;
    out.push({ axis: a.axis, edges, tickPoints: a.pairs.map((p) => ({ x: p.tick[0], y: p.tick[1] })) });
  }
  return out;
}

/** The marks, each with its grip: `categoryAidGlyphs`, unchanged. */
export function labelTickGlyphs(read: AxesFromLabels): AidGlyph[] {
  return overlays(read).flatMap((o) => categoryAidGlyphs({ edges: o.edges, tickPoints: o.tickPoints, tickId: tickId(o.axis) }));
}

/** Their draggable handles: `categoryTickMarkers`, unchanged, so each is bound to its axis on screen. */
export function labelTickMarkers(read: AxesFromLabels): CanvasMarker[] {
  return overlays(read).flatMap((o) => categoryTickMarkers({ edges: o.edges, tickPoints: o.tickPoints, tickId: tickId(o.axis) }));
}

/** Which read tick a handle id names, or null for any other handle. */
export function labelTickFromId(id: string): { axis: 'x' | 'y'; index: number } | null {
  const m = /^labelTick:([xy]):(\d+)$/.exec(id);
  return m ? { axis: m[1] as 'x' | 'y', index: Number(m[2]) } : null;
}

/** The read with one tick moved to where its handle was dropped, by the category ticks' rules: the drop
 * projected onto the axis line (the grip stands square off it), and kept strictly between the tick's
 * neighbours along the axis. Null when the id is not a read tick. */
export function moveLabelTick(read: AxesFromLabels, id: string, drop: P): AxesFromLabels | null {
  const which = labelTickFromId(id);
  if (!which) return null;
  const a = read[which.axis];
  if (!a.ok) return null;
  const edges = edgesFor(a, read.points);
  const pair = a.pairs[which.index];
  if (!edges || !pair) return null;
  let t = paramAtPoint(edges, drop);
  if (!Number.isFinite(t)) return null;
  const own = paramAtPoint(edges, { x: pair.tick[0], y: pair.tick[1] });
  const params = a.pairs.map((p, i) => (i === which.index ? null : paramAtPoint(edges, { x: p.tick[0], y: p.tick[1] })));
  const below = params.filter((v): v is number => v !== null && v < own);
  const above = params.filter((v): v is number => v !== null && v > own);
  const EPS = 1e-3;
  if (below.length) t = Math.max(t, Math.max(...below) + EPS);
  if (above.length) t = Math.min(t, Math.min(...above) - EPS);
  const p = pointAtParam(edges, t);
  const pairs = a.pairs.map((q, i) => (i === which.index ? { ...q, tick: [p.x, p.y] as [number, number] } : q));
  return { ...read, [which.axis]: { ...a, pairs } };
}
