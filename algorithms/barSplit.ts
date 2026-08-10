/**
 * Splitting a merged run of bars at declared category dividers (v2.1).
 *
 * Touching bars of the same colour flood into ONE blob and read as one oversized
 * bar — the #1 fixable limit measured against the full corpus, costing ~11 points
 * of real-figure recall (82.2% separated against 71.1% touching, 384 figures).
 * Three image-analysis approaches are spent. This is the fourth thing to try, and
 * it is not image analysis at all: the user declares where the categories divide,
 * and a run is cut there.
 *
 * ⚑ WHAT MAKES THIS DIFFERENT FROM WPD'S OWN SPLITTER. Upstream already separates
 * touching bars (`barExtraction.js`: group columns while |Δx| ≤ 30px and both ends
 * are within ΔVal = 10px). That is a BLIND tolerance — it has no idea how many
 * bars should be there, so it returns whatever the threshold yields, and it keys
 * the split on the very quantity being measured, which fails exactly when
 * neighbouring bars are similar heights. Declared dividers know nothing about
 * heights, so they do not care.
 *
 * ⚑⚑ THE DISCIPLINE, or this becomes approach C again. Approach C won on the
 * metric (+3.9) and was reverted because it ERASED SHORT BARS — a visible failure
 * traded for an invisible one. Knowing how many bars to expect is precisely the
 * condition under which a threshold gets quietly lowered until the answer appears.
 * So the expected count governs **when to stop and when to report a miss**, never
 * **how far to relax until the count is satisfied**. Nothing here invents a bar to
 * fill a band: a band with no ink comes back empty and says so.
 */

/** Ink found in one column across the run, in the direction the VALUE is
 * measured. `at` is the position along the CATEGORY axis. */
export interface RunColumn {
  at: number;
  /** Nearest edge of the ink in the value direction (smallest coordinate). */
  min: number;
  /** Farthest edge of the ink in the value direction (largest coordinate). */
  max: number;
}

export interface SplitPiece {
  /** The band this piece fills, along the category axis. */
  from: number;
  to: number;
  /** The INK's own extent along the category axis, within that band.
   *
   * ⚑ NOT the same as `from`/`to`, and conflating them was a real defect the
   * corpus run caught: a bar is normally NARROWER than its band (that is what
   * the gaps between bars are), so a piece boxed at the band edges is far wider
   * than the bar it describes and misses the ground truth outright. The band
   * says where to CUT; the ink says how wide the bar IS. */
  atFrom: number;
  atTo: number;
  /** The piece's own extent in the value direction, robustly estimated. */
  min: number;
  max: number;
  /** How many ink columns it was measured from — a thin piece is worth doubting,
   * and the caller can see it rather than being told a bar was found. */
  columns: number;
}

export interface SplitReport {
  pieces: SplitPiece[];
  /** Bands, by index, that held no ink. Reported, never filled. */
  emptyBands: number[];
}

/** The median of a non-empty list. Even lengths take the LOWER middle rather
 * than averaging: an average of two column readings is a value no column
 * actually had, and this module exists to stop inventing numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

export interface SplitOptions {
  /** Ink columns a band needs before it counts as a bar. Two, because a single
   * column is as likely to be an antialiased edge bleeding across a divider as
   * it is to be a bar — and a band that thin is exactly what a slightly
   * misplaced divider produces. */
  minColumns?: number;
}

/**
 * Cut a run of columns at `dividers` and measure each piece on its own.
 *
 * ⚑⚑ EACH PIECE IS MEASURED BY THE MEDIAN OF ITS COLUMNS, NEVER THE EXTREME, and
 * this is the single most important line in the file. Two touching bars of
 * different heights form a step. If a piece's value were the maximum column
 * extent inside its band, a divider a few pixels into the taller neighbour would
 * drag the shorter bar's reading up to its neighbour's — a silently wrong NUMBER
 * caused by a small placement error, in exactly the case this feature exists to
 * serve. The median ignores a contaminated edge column entirely, which is what
 * lets the design promise that tick placement is an aid and not a measurement.
 *
 * `dividers` must be ascending; `columns` need not be sorted. Bands are
 * half-open [from, to) so a column landing exactly on a divider belongs to the
 * band that divider opens — the same rule `bandIndexForParam` uses, so a bar
 * cannot be assigned to one category and split into another.
 */
export function splitRunAtDividers(
  columns: readonly RunColumn[],
  dividers: readonly number[],
  options: SplitOptions = {}
): SplitReport {
  const minColumns = options.minColumns ?? 2;
  const pieces: SplitPiece[] = [];
  const emptyBands: number[] = [];
  if (dividers.length < 2) return { pieces, emptyBands };

  for (let band = 0; band < dividers.length - 1; band++) {
    const from = dividers[band]!;
    const to = dividers[band + 1]!;
    // Half-open, except for the LAST band, which has to include its closing
    // divider or the run's final column falls out of every band.
    const last = band === dividers.length - 2;
    const inBand = columns.filter((c) => c.at >= from && (last ? c.at <= to : c.at < to));
    if (inBand.length < minColumns) {
      emptyBands.push(band);
      continue;
    }
    const ats = inBand.map((c) => c.at);
    pieces.push({
      from,
      to,
      atFrom: Math.min(...ats),
      atTo: Math.max(...ats),
      min: median(inBand.map((c) => c.min)),
      max: median(inBand.map((c) => c.max)),
      columns: inBand.length,
    });
  }
  return { pieces, emptyBands };
}

export interface ExpectationReport {
  expected: number;
  found: number;
  /** True when the figure produced exactly what was declared. */
  complete: boolean;
  /** Bands that came back empty, so a caller can name them rather than hand
   * back a short table that looks complete. */
  emptyBands: number[];
}

/**
 * Check a split against what the declared structure says should be there.
 *
 * ⚑ This REPORTS. It does not retry, relax anything, or fill a gap. The count is
 * here so a short answer can be named — "no bar found for category 3" — instead
 * of a table that is quietly missing a row and looks finished. Anything that
 * used this number to widen a tolerance until it matched would be reintroducing
 * approach C with extra steps.
 */
export function reconcileWithExpected(
  // Structurally minimal on purpose: this needs a COUNT of what was found and
  // the bands that came back empty, nothing else. Demanding a full SplitReport
  // pushed one caller into fabricating placeholder pieces to satisfy the type,
  // which is the exact habit this module exists to break.
  report: { pieces: readonly unknown[]; emptyBands: readonly number[] },
  expected: number
): ExpectationReport {
  const found = report.pieces.length;
  return {
    expected,
    found,
    complete: found === expected,
    emptyBands: [...report.emptyBands],
  };
}

/**
 * Read the per-column ink extents of a run out of a colour-filter mask.
 *
 * The pixel-scanning half, kept beside the decision half rather than inside it,
 * so `splitRunAtDividers` stays a pure function over numbers and can be tested
 * without inventing an image.
 *
 * `categoryAxis` says which way the categories run: `'x'` for an upright bar
 * chart (bars side by side across the image), `'y'` once "Horizontal bars" is
 * on. The value is then measured along the other one, which is why the returned
 * `min`/`max` are just "the two ends" and never "top" and "bottom" — a bar below
 * its baseline has them the other way round, and the caller measures both ends
 * exactly as it does for a hand-dragged box.
 *
 * Scans only within `bbox`, so it costs the run's own area rather than the
 * image's.
 */
export function runColumnsFromMask(
  mask: Uint8Array,
  width: number,
  height: number,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  categoryAxis: 'x' | 'y'
): RunColumn[] {
  const x0 = Math.max(0, Math.floor(bbox.minX));
  const y0 = Math.max(0, Math.floor(bbox.minY));
  const x1 = Math.min(width - 1, Math.ceil(bbox.maxX));
  const y1 = Math.min(height - 1, Math.ceil(bbox.maxY));
  const columns: RunColumn[] = [];
  const alongX = categoryAxis === 'x';
  const outerFrom = alongX ? x0 : y0;
  const outerTo = alongX ? x1 : y1;
  const innerFrom = alongX ? y0 : x0;
  const innerTo = alongX ? y1 : x1;

  for (let outer = outerFrom; outer <= outerTo; outer++) {
    let min = Infinity;
    let max = -Infinity;
    for (let inner = innerFrom; inner <= innerTo; inner++) {
      const idx = alongX ? inner * width + outer : outer * width + inner;
      if (mask[idx]) {
        if (inner < min) min = inner;
        if (inner > max) max = inner;
      }
    }
    // A column with no ink is not a column of zero height -- it is not part of
    // the run at all, and recording it as one would put a zero-value bar into
    // the median of whichever band it landed in.
    if (min !== Infinity) columns.push({ at: outer, min, max });
  }
  return columns;
}
