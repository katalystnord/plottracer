/**
 * Read the CATEGORY AXIS off a figure's own fragments (v2.5).
 *
 * ⚑⚑ WHAT THIS UNBLOCKS. `joinAcrossHatch` puts a hatched bar back together,
 * and it needs to know which way the categories run. Until now that could only
 * be DECLARED, which meant a whole population never got the join at all:
 * a HISTOGRAM has no category ticks in its axes type, so nothing can declare one
 * for it, and hatched histograms are ordinary in published papers. Same for any
 * bar chart auto-extracted before its calibration walk is finished.
 *
 * ⚑⚑ THE RULE IS A FACT ABOUT HATCHES, NOT A HEURISTIC. A hatch cuts one bar
 * into slabs, and every slab is A SLICE OF THE SAME RECTANGLE - so all of them
 * carry that bar's two edges across the bar, exactly. Read the axes the wrong
 * way round and the "shared" extent becomes each slab's own band, which differs
 * for every slab. So the correct axis is the one with FEWER DISTINCT
 * PERPENDICULAR EXTENTS, and the ratio between the two counts is the confidence.
 *
 * ⛔⛔ THE OBVIOUS RULE WAS TRIED FIRST AND IS REFUTED. Bars stand on a shared
 * baseline, so the tightest edge mode should name it - and it does, on WHOLE
 * bars (95.5% on unfragmented figures, 93.7% on real published ones). On
 * shredded bars it collapses to 29.8%, because a hatch does not hide the
 * baseline, it OUT-VOTES it: thirty slabs carry the bar's sides and exactly one
 * touches the baseline. That is backwards from what the join needs, since being
 * shredded is the whole precondition for wanting it. See
 * `harness/orientation-probe.mjs` in the benchmarks repo for both measurements.
 *
 * ⛔ IT REFUSES RATHER THAN GUESSING, and the threshold is not a taste. On 6,494
 * real published bars a DEFAULTED axis cost 24, and `PMC6603941___5` fell from
 * 21 of 21 to 9. That figure measures 1.91, so the gate sits well above it.
 *
 * ⚑ WHY A WRONG READING IS SURVIVABLE AT ALL, which is the finding under the
 * finding: a wrong axis is INERT when there are no fragments to join. The damage
 * needs something to merge, and whole bars offer nothing - which is why a rule
 * that is often wrong on unhatched figures still costs almost nothing there.
 *
 * ⚑⚑ MEASURED THROUGH THIS CODE PATH, at the gate below:
 *
 *   corpus                              bars        change
 *   Adobe CHART-Synthetic (hatched)   36.7% -> 45.5%   +593
 *   UB-UNITEC PMC split 4                 76.6%          -1
 *   UB-UNITEC PMC split 5 (held out)      76.3%          +1
 *
 * ⚠️ THE GATE WAS CHOSEN ON SPLIT 4 AND CONFIRMED ON SPLIT 5, which share no
 * images. At 2.0 the same code gains +1,113 on Adobe and loses 39 real bars,
 * which is why the gate is 3.0 and not the value that looks best on the hatched
 * corpus alone.
 *
 * ⛔⛔ AND A DIAGONAL HATCH IS OFTEN REFUSED, including on this project's own
 * `samples/bar-hatched-extraction-yield.png`, which reads 1.375. A diagonal
 * strip clipped to a bar leaves CORNER TRIANGLES, and each triangle has its own
 * extent across the bar - 64 distinct where a horizontal hatch gives 6. The
 * reading still points the right way there; it is simply not decisive enough to
 * act on, so nothing happens. Rejoining that figure still needs the declared
 * axis the calibration walk supplies.
 */

/** A detected fragment's bounding box, in image pixels. */
export interface FragmentBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * How decisive the reading must be before it is used at all.
 *
 * ⛔⛔ CHOSEN AGAINST THE REAL-FIGURE CONTROL, not against the corpus it helps.
 * Lower gates read more hatched figures and cost real published bars:
 *
 *   gate   Adobe bars   PMC split 4
 *   2.0      +1,113        -27
 *   2.5        +785         -8
 *   3.0        +593         -1     <- here, and +1 on the held-out split 5
 *   4.0        +319          0
 *
 * ⛔ It also has to clear 1.91, which is `PMC6603941___5` - the figure a
 * DEFAULTED axis took from 21 bars of 21 down to 9. Any threshold at or below
 * its ratio brings that collapse back, and the test file pins this by that
 * figure's own number rather than by a constant nobody can trace.
 */
export const MIN_EXTENT_RATIO = 3.0;

/** Fewer fragments than this cannot show a repeat, so they are not evidence. */
export const MIN_FRAGMENTS = 4;

/**
 * How far apart two fragment edges may sit and still be the same edge.
 *
 * ⚑ SCALED TO THE FIGURE, not a fixed pixel count: the same chart published at
 * two resolutions must read the same way. Half a percent of the smaller
 * dimension, with a floor of 2px because antialiasing wobbles an edge by about
 * a pixel whatever the figure's size.
 */
export function fragmentEdgeTolerancePx(width: number, height: number): number {
  return Math.max(2, Math.round(0.005 * Math.min(width, height)));
}

/**
 * How many distinct extents the fragments have across `axis`.
 *
 * ⚑ Greedy first-match clustering rather than a sort: the question is only how
 * many DIFFERENT extents there are, and two fragments agree or they do not.
 */
function distinctExtents(boxes: readonly FragmentBox[], axis: 'x' | 'y', tolPx: number): number {
  const lo = (b: FragmentBox) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: FragmentBox) => (axis === 'x' ? b.maxX : b.maxY);
  const seen: [number, number][] = [];
  for (const b of boxes) {
    const l = lo(b);
    const h = hi(b);
    if (!seen.some(([sl, sh]) => Math.abs(sl - l) <= tolPx && Math.abs(sh - h) <= tolPx)) {
      seen.push([l, h]);
    }
  }
  return seen.length;
}

export interface MeasuredCategoryAxis {
  /** Which way the categories run: `x` upright, `y` for a horizontal chart. */
  categoryAxis: 'x' | 'y';
  /** How decisive the reading was: the larger count over the smaller. */
  ratio: number;
  /** Distinct extents across the axis that was chosen. */
  distinctAlongCategory: number;
  /** Distinct extents across the other one, which is the losing reading. */
  distinctAcross: number;
}

/**
 * Read which way the categories run, or refuse.
 *
 * `tolPx` is how far apart two edges may sit and still be the same edge; scale
 * it with the figure the way every other threshold here does.
 *
 * Returns `null` when the fragments do not say - too few of them, or neither
 * reading decisive enough - and a refusal must be treated as "do nothing",
 * never as a default.
 */
export function measureCategoryAxisFromFragments(
  boxes: readonly FragmentBox[],
  tolPx: number
): MeasuredCategoryAxis | null {
  if (boxes.length < MIN_FRAGMENTS) return null;
  const asX = distinctExtents(boxes, 'x', tolPx);
  const asY = distinctExtents(boxes, 'y', tolPx);
  if (asX === 0 || asY === 0) return null;
  const ratio = Math.max(asX, asY) / Math.min(asX, asY);
  if (ratio < MIN_EXTENT_RATIO) return null;
  // Categories run along the axis whose extent the fragments SHARE, which is
  // the one with fewer distinct values.
  const categoryAxis: 'x' | 'y' = asX <= asY ? 'x' : 'y';
  return {
    categoryAxis,
    ratio,
    distinctAlongCategory: Math.min(asX, asY),
    distinctAcross: Math.max(asX, asY),
  };
}
