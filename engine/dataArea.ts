import type { PlacedDrawing } from '../algorithms/findLines/fromDrawing.js';
import type { Pt } from '../algorithms/findLines/geom.js';
import type { AxesFromLabels } from './labelCalibration.js';

/**
 * The data area (v2.7; David 2026-11-01, docs/v2.7-workflow-walk.md, "The data area, apart from the calibration"):
 * the rectangle the automatic tools search, image pixels. A rectangle of its own because the calibration points sit
 * on labelled ticks, often inside the frame, so the box round them no longer covers the data (until v2.7 Colour
 * trace and Find lines searched that box, ours since 2026-07-22, not WPD's). It never stops a point placed by hand
 * and never cuts the record.
 */
export interface DataArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the automatic tools search, on every graph type (David, 2026-11-02: "yes, every graph type gets the data area
 * first"): the data area. A spider with none (a project from before v2.7) searches the box round its web, as it did;
 * anything else with none searches the whole figure, as before the data area existed.
 */
export function searchArea<R extends DataArea>(dataArea: DataArea | null, spiderWeb: R | null): DataArea | R | null {
  return dataArea ?? spiderWeb;
}

/** A real rectangle: finite, with an area. The same rule the file reader applies. */
export function isDataArea(r: unknown): r is DataArea {
  if (typeof r !== 'object' || r === null) return false;
  const { x, y, width, height } = r as Record<string, unknown>;
  return [x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v)) && (width as number) > 0 && (height as number) > 0;
}

export type Corner = 'tl' | 'tr' | 'br' | 'bl';

/** `r` with one corner moved to (x, y), the opposite corner staying; a corner dragged past the opposite one turns
 * the rectangle round. Null when no area would be left. */
export function withCornerMoved<R extends DataArea>(r: R, corner: Corner, x: number, y: number): R | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const fixedX = corner === 'tl' || corner === 'bl' ? r.x + r.width : r.x;
  const fixedY = corner === 'tl' || corner === 'tr' ? r.y + r.height : r.y;
  const width = Math.abs(x - fixedX);
  const height = Math.abs(y - fixedY);
  if (width === 0 || height === 0) return null;
  return { ...r, x: Math.min(x, fixedX), y: Math.min(y, fixedY), width, height };
}

/** `r` carried through a map of the picture's pixels (a rotate or flip): the box round its mapped corners. */
export function mappedRect<R extends DataArea>(r: R, map: (px: number, py: number) => { x: number; y: number }): R {
  const cs = [map(r.x, r.y), map(r.x + r.width, r.y), map(r.x, r.y + r.height), map(r.x + r.width, r.y + r.height)];
  const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  return { ...r, x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 };
}

/**
 * A drawn figure's frame, for its data area: the smallest rectangle the drawing holds round every labelled tick that
 * was read, either a rectangle drawn as one path (R's box, ggplot2's panel, matplotlib's axes patch) or one made by
 * a horizontal and a vertical line meeting at a corner (matplotlib's spines). Null when no axis was read, since then
 * nothing says which rectangle is the plot, or when no drawn rectangle holds the ticks.
 *
 * ⚑ Measured against each generator's own plot area (labelCalibration.test.ts, "the data area of a drawn figure is
 * its frame"), including frames that run past the last labelled tick, which the calibration box never covered.
 */
export function drawnFrame(d: PlacedDrawing, read: AxesFromLabels): DataArea | null {
  const ticks = [...(read.x.ok ? read.x.pairs : []), ...(read.y.ok ? read.y.pairs : [])].map((p) => p.tick);
  if (ticks.length === 0) return null;
  const k = d.pxPerPt;
  const tol = 1.5 * k;
  const smallest = 10 * k;
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const boxes: Box[] = [];
  const level = (a: Pt, b: Pt) => Math.abs(a[1] - b[1]) <= 0.5;
  const plumb = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) <= 0.5;
  const across: { y: number; x0: number; x1: number }[] = [];
  const upright: { x: number; y0: number; y1: number }[] = [];
  for (const s of d.shapes) {
    for (const sub of s.subs) {
      const pts = sub.length > 1 && sub[0]![0] === sub[sub.length - 1]![0] && sub[0]![1] === sub[sub.length - 1]![1] ? sub.slice(0, -1) : sub;
      if (pts.length === 4 && pts.every((p, i) => { const q = pts[(i + 1) % 4]!; return level(p, q) || plumb(p, q); })) {
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        boxes.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
      } else if (pts.length === 2 && s.stroked) {
        const [a, b] = pts as [Pt, Pt];
        if (level(a, b) && Math.abs(a[0] - b[0]) >= smallest) across.push({ y: a[1], x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]) });
        else if (plumb(a, b) && Math.abs(a[1] - b[1]) >= smallest) upright.push({ x: a[0], y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) });
      }
    }
  }
  // a horizontal and a vertical line meeting at a corner: the rectangle they span
  const near = (p: number, q: number) => Math.abs(p - q) <= tol;
  for (const h of across) {
    for (const v of upright) {
      if ((near(v.x, h.x0) || near(v.x, h.x1)) && (near(h.y, v.y0) || near(h.y, v.y1))) boxes.push({ x0: h.x0, y0: v.y0, x1: h.x1, y1: v.y1 });
    }
  }
  const holds = (b: Box) => b.x1 - b.x0 >= smallest && b.y1 - b.y0 >= smallest
    && ticks.every(([x, y]) => x >= b.x0 - tol && x <= b.x1 + tol && y >= b.y0 - tol && y <= b.y1 + tol);
  const best = boxes.filter(holds).reduce<Box | null>((m, b) => (!m || (b.x1 - b.x0) * (b.y1 - b.y0) < (m.x1 - m.x0) * (m.y1 - m.y0) ? b : m), null);
  return best ? { x: best.x0, y: best.y0, width: best.x1 - best.x0, height: best.y1 - best.y0 } : null;
}

/** The box round some points, or null when they enclose no area. */
export function boxRoundPoints(pts: readonly { px: number; py: number }[]): DataArea | null {
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.px), ys = pts.map((p) => p.py);
  const x = Math.min(...xs), y = Math.min(...ys);
  const width = Math.max(...xs) - x, height = Math.max(...ys) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}
