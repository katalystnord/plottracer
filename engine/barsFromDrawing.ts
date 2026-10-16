/**
 * v2.7 V18 - bars read from a drawn figure's own RECTANGLES, for By colour ▸
 * Bars on a figure that is drawn (or partly a picture).
 *
 * In the drawing a bar is the rectangle its library drew (matplotlib's
 * `Rectangle` patch, R's `rect`), so its edges are the author's own numbers:
 * the record is the bar's HEIGHT (David, 2026-10-12: "All they need is the
 * height, and be reasonably sure they are reaching a common bottom"). This
 * returns what the pixel detector returns (`runBarDetect`), so the caller files
 * it through the same path: the legend swatches held back
 * (`partitionSwatchSuspects`), the boxes filed as a drag-box files them
 * (`addBarDetectBoxes`), and a bar that misses the baseline told by the bar
 * table's own off-baseline note.
 *
 *   - a rectangle is a closed subpath of four axis-aligned sides (5 points with
 *     the closing one), filled or outlined in the colour;
 *   - its box is the rectangle's own edge: the stroke's width is not part of a
 *     bar's height;
 *   - one painted twice (a fill and an outline, a redraw) is one bar;
 *   - a rectangle covering most of the region (the plot's background or frame)
 *     is not a bar, and nor is one wholly inside a masked area.
 */
import type { PlacedDrawing } from '../algorithms/findLines/fromDrawing.js';
import { swatchSuspectsIn, type BarDetectBaseline, type BarDetectSuccess, type DetectedBarBox } from './barDetectRun.js';

type RGB = readonly [number, number, number];
type Box = { x0: number; y0: number; x1: number; y1: number };
type Pt = [number, number];

const near = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 40;

/** The axis-aligned box of a subpath that is a rectangle, or null. The
 * outline is tidied first, as generators write it more than one way: a corner
 * repeated (LibreOffice closes twice), the closing point, and points lying on a
 * straight side (LibreOffice starts a legend swatch half way along an edge). */
function rectangleOf(sp: readonly Pt[], tol: number): Box | null {
  const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  let pts: Pt[] = [];
  for (const p of sp) if (!pts.length || !same(pts[pts.length - 1]!, p)) pts.push(p);
  while (pts.length > 1 && same(pts[0]!, pts[pts.length - 1]!)) pts.pop();
  // drop a point that lies on the straight side through its neighbours
  for (let changed = true; changed && pts.length > 4;) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]!, p = pts[i]!, b = pts[(i + 1) % pts.length]!;
      if ((Math.abs(a[0] - p[0]) <= tol && Math.abs(p[0] - b[0]) <= tol) || (Math.abs(a[1] - p[1]) <= tol && Math.abs(p[1] - b[1]) <= tol)) {
        pts = [...pts.slice(0, i), ...pts.slice(i + 1)];
        changed = true;
        break;
      }
    }
  }
  if (pts.length !== 4) return null;
  for (let i = 0; i < 4; i++) {
    const a = pts[i]!, b = pts[(i + 1) % 4]!;
    if (Math.abs(a[0] - b[0]) > tol && Math.abs(a[1] - b[1]) > tol) return null; // a side that is not upright or level
  }
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const b = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  return b.x1 - b.x0 > tol && b.y1 - b.y0 > tol ? b : null;
}

export function barsFromDrawing(
  d: PlacedDrawing,
  colour: RGB,
  region: Box,
  opts: { categoryAxis: 'x' | 'y'; baseline?: BarDetectBaseline; masks?: readonly Box[] },
): BarDetectSuccess {
  const tol = 0.05 * d.pxPerPt;
  const masks = opts.masks ?? [];
  const area = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const inside = (b: Box, r: Box) => b.x0 >= r.x0 - tol && b.y0 >= r.y0 - tol && b.x1 <= r.x1 + tol && b.y1 <= r.y1 + tol;
  const boxes: DetectedBarBox[] = [];
  for (const s of d.shapes) {
    const ink = (s.filled && near(s.fill, colour)) || (s.stroked && near(s.stroke, colour));
    if (!ink) continue;
    for (const sp of s.subs) {
      const b = rectangleOf(sp, tol);
      if (!b || !inside(b, region)) continue;
      if (area(b) >= 0.5 * area(region)) continue; // a background or a frame
      if (masks.some((m) => inside(b, m))) continue;
      // one painted twice (a fill, then an outline) is one bar
      if (boxes.some((q) => Math.abs(q.start.x - b.x0) <= tol && Math.abs(q.start.y - b.y0) <= tol && Math.abs(q.end.x - b.x1) <= tol && Math.abs(q.end.y - b.y1) <= tol)) continue;
      boxes.push({ start: { x: b.x0, y: b.y0 }, end: { x: b.x1, y: b.y1 } });
    }
  }
  return {
    boxes,
    matched: 0,
    blobs: boxes.length,
    ...(opts.baseline ? { swatchSuspects: swatchSuspectsIn(boxes, opts.categoryAxis, opts.baseline) } : {}),
  };
}
