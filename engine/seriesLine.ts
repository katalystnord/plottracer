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

/** The INDICES of each contiguous run, or [] for a sparse/scatter series. The
 *  single definition of what a run is; `polylineRuns` and `runCoverage` are
 *  both expressed in terms of it, so a caller asking "is this point on a line?"
 *  and a caller drawing the line can never disagree. Each run has at least 2
 *  points -- a lone point is not a line, which is precisely why a caller must be
 *  able to ask which points were left out. */
export function polylineRunIndices(pts: readonly XY[]): number[][] {
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
  const runs: number[][] = [];
  let cur: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    if (gaps[i - 1]! > brk) {
      if (cur.length >= 2) runs.push(cur);
      cur = [i];
    } else {
      cur.push(i);
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/** Split a series' points into contiguous runs to draw as connecting lines, or
 *  return [] if the series is sparse/scatter (leave it as dots). Each run has at
 *  least 2 points. Order is preserved; points are never moved. */
export function polylineRuns(pts: readonly XY[]): XY[][] {
  return polylineRunIndices(pts).map((run) => run.map((i) => ({ x: pts[i]!.x, y: pts[i]!.y })));
}

/**
 * ⚑⚑ Both answers a caller needs about a series, from ONE pass.
 *
 * `dense` is "draw this as a connecting line"; `strays` is the indices no run
 * covers, which the caller must still draw itself. They come from one call so
 * they cannot disagree, and so a hot path (this runs per render, per series)
 * does not compute the runs twice.
 *
 * A dense series' per-point dots are dropped on the grounds that "the LINE
 * carries the shape". The line carries the shape only where there IS a line: a
 * fragment shorter than two points is not a run, so a stray point is covered by
 * nothing, and dropping its dot as well draws a reading the record HAS with
 * nothing at all. `canvasOverlays.ts` already ruled on this class for two
 * anchors sharing one pixel - "JOINED, not dropped ... a real reading invisible
 * rather than merely unreadable". Unreadable is acceptable; invisible is not.
 *
 * For a scatter: `dense` false, `strays` empty (the caller draws every dot, as
 * it always did). For a uniformly dense curve: `dense` true, `strays` empty (no
 * dots, as it always did). Only a MIXED series returns a non-empty `strays`.
 */
export function runCoverage(pts: readonly XY[]): { dense: boolean; strays: Set<number> } {
  const runs = polylineRunIndices(pts);
  if (runs.length === 0) return { dense: false, strays: new Set() };
  const covered = new Set<number>();
  for (const run of runs) for (const i of run) covered.add(i);
  const strays = new Set<number>();
  for (let i = 0; i < pts.length; i++) if (!covered.has(i)) strays.add(i);
  return { dense: true, strays };
}
