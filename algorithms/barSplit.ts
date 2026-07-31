/**
 * Clearing the calibrated axis line from a colour mask, so bars that touch
 * only THROUGH it stop being one flood-filled region (v2.0).
 *
 * ⚑ WHY, with a number. Bars of the same colour that touch flood into one blob
 * and read as one oversized bar — `barDetectRun.ts`'s own header flagged it and
 * deferred it to the Phase 9 survey. That survey ran on 2026-07-31 against all
 * 192 bar figures of the ICPR 2022 CHART-Infographics benchmark (3,234 real
 * bars) and priced it: 98.1% recall where bars do not touch, 81.6% where they
 * do.
 *
 * Splitting merged blobs by their silhouette was built and MEASURED against
 * that corpus, and it does not pay — see the note at the bottom of this file.
 * What does pay is not letting the bars merge in the first place: in a bar
 * chart the bars stand ON the value axis, and on a greyscale or dark-inked
 * figure that axis line matches the bars' own ink, so every bar connects to
 * every other through it and the flood returns ONE blob spanning the plot.
 *
 * Clearing the calibrated baseline row is not a guess about where the axis is.
 * The user has already told us, by calibrating the value axis; this uses that
 * measurement and nothing else.
 */

export function clearBand(
  mask: Uint8Array,
  width: number,
  height: number,
  band: { orientation: 'row' | 'column'; at: number; halfWidth?: number }
): void {
  const half = Math.max(0, Math.floor(band.halfWidth ?? 1));
  const centre = Math.round(band.at);
  if (band.orientation === 'row') {
    for (let y = centre - half; y <= centre + half; y++) {
      if (y < 0 || y >= height) continue;
      mask.fill(0, y * width, y * width + width);
    }
  } else {
    for (let x = centre - half; x <= centre + half; x++) {
      if (x < 0 || x >= width) continue;
      for (let y = 0; y < height; y++) mask[y * width + x] = 0;
    }
  }
}

/*
 * ⚑ THE SILHOUETTE SPLITTER — BUILT, MEASURED, AND NOT SHIPPED (2026-07-31).
 *
 * The idea was sound on paper: a bar is a rectangle on a shared baseline, so
 * inside a merged blob every column runs from that baseline to its own bar's
 * end, and a maximal run of columns with the same far edge IS one bar. It
 * worked on drawn fixtures and on 169 of 1,064 real blobs.
 *
 * Over the full corpus it was NET NEGATIVE:
 *
 *     control                      76.9% all / 83.9% colour
 *     + silhouette split           76.6% all / 82.5% colour
 *     + baseline exclusion         80.8% all / 83.6% colour
 *     + both                       78.7% all / 81.8% colour
 *
 * It fragments more single bars than it recovers merges. Gating it to blobs
 * wider than 1.5x/2x/3x the run's median blob width only walked the result
 * back toward "never split" (80.1 / 80.3 / 80.9 with the baseline fix on),
 * i.e. its best case is doing nothing.
 *
 * The reason is in the survey's own breakdown: of the 550 merge-caused misses,
 * only 142 were CLEAN merges of a few adjacent bars; 408 were floods in which
 * bars, axes and frame are one region. The splitter addresses the small half,
 * and the axis exclusion above dissolves much of the large half.
 *
 * Do not rebuild it without new evidence. If it is revisited, the thing to
 * attack is the 172 bars no detection covers at all, not the merges.
 */
