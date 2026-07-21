/**
 * Connecting-polyline geometry for a data series (checkpoint 131).
 *
 * The fix for a dense auto-trace rendering as a furry band of overlapping dots:
 * draw the series as a thin connected line instead. But not every series is a
 * curve -- a scatter (Blob Detector) must stay discrete points. Rather than
 * invent a per-series curve/scatter flag in the record (tenet 10: least
 * modeling), we key off the very condition that produces the furry band: points
 * dense enough that their markers overlap. A curve traced one point per pixel
 * column has a ~1px median gap; a scatter's markers sit many px apart. So:
 *
 *   - median consecutive gap <= SERIES_LINE_GAP  -> a curve: return its runs.
 *   - median gap larger                          -> sparse/scatter: return [].
 *
 * Within a connected series the line is still BROKEN wherever a single gap is
 * much larger than typical, so a curve with a genuine discontinuity (a dashed
 * segment, a masked-out region) is not bridged by one spurious straight segment.
 *
 * Pure and framework-free (image-pixel space in, image-pixel space out) so it is
 * unit-testable and could serve a headless caller; the Konva rendering lives in
 * ui/ImageCanvas.tsx.
 */

export interface XY {
  x: number;
  y: number;
}

/** Median consecutive gap (image px) at/below which a series is treated as a
 *  connected curve. ~1px is a per-column trace; a scatter is far above this. */
export const SERIES_LINE_GAP = 4;

/** Split a series' points into contiguous runs to draw as connecting lines, or
 *  return [] if the series is sparse/scatter (leave it as dots). Each run has at
 *  least 2 points. Order is preserved; points are never moved. */
export function polylineRuns(pts: readonly XY[]): XY[][] {
  if (pts.length < 2) return [];
  const gaps: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    gaps.push(Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  }
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
  if (median > SERIES_LINE_GAP) return [];
  // Break a run where a gap is much larger than typical (but never below the
  // absolute gap floor, so a near-uniform curve with median ~0 doesn't shatter).
  const brk = Math.max(SERIES_LINE_GAP, median * 4);
  const runs: XY[][] = [];
  let cur: XY[] = [{ x: pts[0]!.x, y: pts[0]!.y }];
  for (let i = 1; i < pts.length; i++) {
    if (gaps[i - 1]! > brk) {
      if (cur.length >= 2) runs.push(cur);
      cur = [{ x: pts[i]!.x, y: pts[i]!.y }];
    } else {
      cur.push({ x: pts[i]!.x, y: pts[i]!.y });
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}
