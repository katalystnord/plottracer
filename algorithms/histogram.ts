/**
 * Histogram bin geometry — original work (no upstream reference).
 *
 * A histogram bin is an *interval* plus a magnitude, which is what makes
 * it a different extraction target from both a bar chart (a categorical
 * label plus a magnitude — see core/axes/bar.ts, whose pixelToData
 * returns a single value and whose labels are ['Label','Y']) and a plain
 * XY point (a position, with no extent at all).
 *
 * Capture model (decided with David, 2026-07-15): the user clicks a bar's
 * two top corners. That pair carries everything a bin has — both edges
 * come from the corners' x, and the height from their y — while staying
 * robust to bins that don't tile the axis (gaps, uneven widths) and
 * keeping each bin independent, so a misclick spoils one bin rather than
 * a whole contiguous walk.
 *
 * Notably this is *more* than upstream WPD extracts. WPD's "histogram" is
 * its BarExtractionAlgo run against XY axes (relabelled in the dropdown;
 * XYAxes.getOrientation() exists solely to serve it), and it emits one
 * point per bar at the bar's *centre* — bin edges are never recorded, so
 * widths can only be inferred from centre spacing and only when bins are
 * uniform. Keeping true edges is the point of this module. When that
 * algorithm is ported for the auto-extraction work (CLAUDE.md's v0.3
 * theme), its per-bar pixel-column groups already know their own min/max
 * x, so it can produce real edges and feed HistogramBin directly.
 *
 * Pure and headless per CLAUDE.md's leg (c): no DOM, no engine imports —
 * ui/ and any future batch pipeline are both thin adapters over this.
 */

/** One captured top corner of a bar, in *data* space (already through the
 * axes' pixelToData), not pixels. */
export interface BinCorner {
  x: number;
  y: number;
}

/**
 * One histogram bin: the interval [binStart, binEnd) and its magnitude.
 *
 * `valueErr` is deliberately part of the record while nothing yet writes
 * it. Histograms *do* carry uncertainty in practice — Poisson √N bars on
 * counting histograms, and "mean ± SD per bin" on any distribution
 * averaged over replicates (a mean and spread per bin across several
 * repeated measurements). The error-capture design carries error in the
 * schema *before* anything reads it: adding an error field after data has
 * already been exported and consumed is the expensive, migration-shaped
 * failure. Costing one optional field now beats a schema change later.
 */
export interface HistogramBin {
  binStart: number;
  binEnd: number;
  value: number;
  valueErr?: number;
}

/**
 * Build a bin from a bar's two top corners, in either click order.
 *
 * The corners are ordered by x rather than trusting click order, so
 * clicking right-then-left yields the same bin. The height averages the
 * two corners' y: both mark the same bar top, so they should agree, and
 * averaging halves the hand-click error rather than arbitrarily trusting
 * whichever was clicked first.
 *
 * Assumes a vertically-oriented histogram (bins run along x, magnitude
 * along y), which is what histograms essentially always are. A rotated
 * one would need the axes' orientation threaded through, the way
 * BarAxes.calculateOrientation() does for bar charts — not built, since
 * nothing needs it yet.
 */
export function binFromCorners(a: BinCorner, b: BinCorner): HistogramBin {
  const [left, right] = a.x <= b.x ? [a, b] : [b, a];
  return {
    binStart: left.x,
    binEnd: right.x,
    value: (left.y + right.y) / 2,
  };
}

/**
 * Map captured corner-pairs to bins, preserving input order and length.
 *
 * A tuple whose corners aren't both placed yet yields `null` at its own
 * index rather than being dropped, mirroring how TupleRow keeps `null`
 * for an unfilled group slot: the caller decides whether a half-captured
 * bin shows as a partial table row (it should) or is skipped on export
 * (it is). Order is capture order, not sorted by binStart — so the table
 * and the exported rows always agree, and a re-sort stays the caller's
 * explicit choice.
 */
export function binsFromCorners(
  tuples: readonly (readonly (BinCorner | null)[])[]
): (HistogramBin | null)[] {
  return tuples.map((corners) => {
    const [a, b] = corners;
    if (a == null || b == null) return null;
    return binFromCorners(a, b);
  });
}
