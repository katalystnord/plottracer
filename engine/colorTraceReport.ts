import type { AxesTypeConfig, CalibratedAxes } from './axesTypeConfigs.js';

/**
 * What an auto-extract by colour REFUSES, and what it reports afterwards.
 *
 * ⚑ WHY THE PROSE IS THE POINT. This tool's design rule is that **a refusal is
 * information, not a failure**: the spider trace deliberately declines every ray
 * whose evidence is ambiguous rather than picking one, and the axes it left
 * empty become the user's worklist. That only works if the report says WHICH
 * ones and WHY - a bare count leaves the reader hunting the table for blanks.
 *
 * So this file is mostly sentences, and every one of them is a promise about
 * what the tool did to the record. None of it was reachable by a test while it
 * lived inside `Workspace.tsx`: the e2e asserts point counts, never prose, which
 * is exactly how the tips bar accumulated three contradictions before anyone
 * noticed (see `engine/guidanceTip.ts`).
 */

/**
 * Only what the REPORT needs from a ray's outcome.
 *
 * ⚑ Structural rather than importing `SpiderReading` from
 * `engine/spiderTraceRun.ts`: that carries `value` and the full `runs`
 * evidence, and a sentence-builder has no business reading either. The real
 * type satisfies this, so the caller passes its readings unchanged.
 */
export interface ReportedReading {
  index: number;
  /** The axis's name. Empty when the figure's was illegible. */
  name: string;
  /** Null where nothing is offered for this ray. */
  point: unknown;
  reason: 'none-found' | 'ambiguous' | 'clipped' | null;
}

export interface RefusalInput {
  /** The axes are built - traced points need a coordinate system. */
  isCalibrated: boolean;
  autoExtractKind: AxesTypeConfig<CalibratedAxes>['autoExtractKind'];
  /** The ACTIVE SERIES is slotted (a box plot / error-bar series). */
  hasSlots: boolean;
  hasImage: boolean;
}

/**
 * Why this trace cannot run, or null to proceed.
 *
 * ⚑ The slot check is about the SERIES, not the graph type: Box Plot is
 * reachable as a toggle on a Bar session, so a bar-shaped type can be carrying a
 * slotted series that auto-extract must not pour ordinary points into. Spider
 * and Bar declare their own slot-aware kinds and are let through.
 */
export function colorTraceRefusal({ isCalibrated, autoExtractKind, hasSlots, hasImage }: RefusalInput): string | null {
  if (!isCalibrated) return 'Calibrate the axes first - traced points need a coordinate system.';
  if (
    (autoExtractKind ?? 'curve') === 'none' ||
    (hasSlots && autoExtractKind !== 'along-axes' && autoExtractKind !== 'bounding-box')
  ) {
    return 'Auto-extract adds ordinary points; it does not apply to a Box Plot / Error Bar series.';
  }
  if (!hasImage) return 'No image loaded.';
  return null;
}

/**
 * Warn on an over-broad match: the colour likely grabbed the grid/axes/text, not
 * just the series. The live preview overlay shows exactly what (ckpt 121), so
 * this only has to say that it happened and what to do about it.
 */
export function overBroadNote(matched: number, width: number, height: number): { pct: number; warn: string } {
  const pct = (matched / (width * height)) * 100;
  const warn =
    pct > 25
      ? ' - that is a lot of the image; if it grabbed the grid/axes, lower the tolerance or run Grid Removal first.'
      : '';
  return { pct, warn };
}

/** The shared tail: how much ink matched, and whether that is suspicious. */
function matchedTail(matched: number, width: number, height: number): string {
  const { pct, warn } = overBroadNote(matched, width, height);
  return `${matched.toLocaleString()} matching pixels (${pct.toFixed(1)}% of the image).${warn}`;
}

/** An axis's own name, or its position when the figure never named it. */
function named(list: readonly ReportedReading[]): string {
  return list.map((r) => r.name || `Axis ${r.index + 1}`).join(', ');
}

export interface SpiderReportInput {
  readings: readonly ReportedReading[];
  /** How many the session actually took - an axis that already had a point keeps it. */
  placed: number;
  matched: number;
  width: number;
  height: number;
}

/**
 * The spider trace's report. Says what was NOT done, BY NAME, because the
 * refusals are the worklist.
 */
export function spiderTraceReport({ readings, placed, matched, width, height }: SpiderReportInput): string {
  const offered = readings.filter((r) => r.point != null).length;
  const ambiguous = readings.filter((r) => r.reason === 'ambiguous');
  const missing = readings.filter((r) => r.reason === 'none-found');
  // ⚑ Clipped is NOT "nothing found" - the colour was still there when the
  // search stopped, so the crossing is beyond the axis's labelled range and the
  // reading would have been the search window's own limit. Say which, and say
  // what to check, because the usual cause is a known point calibrated on an
  // inner ring rather than the axis's end.
  const clipped = readings.filter((r) => r.reason === 'clipped');

  const parts = [`Read ${placed} of ${readings.length} ${readings.length === 1 ? 'axis' : 'axes'}.`];
  if (ambiguous.length)
    parts.push(
      `${named(ambiguous)}: the colour crosses that ray more than once, so nothing was recorded - place ${ambiguous.length === 1 ? 'it' : 'them'} yourself.`
    );
  if (missing.length) parts.push(`Nothing of that colour crosses ${named(missing)}.`);
  if (clipped.length)
    parts.push(
      `${named(clipped)}: the colour runs past the end of that axis, so nothing was recorded - check the axis's known point, or place ${clipped.length === 1 ? 'it' : 'them'} yourself.`
    );
  if (offered > placed)
    parts.push(
      `${offered - placed} ${offered - placed === 1 ? 'axis' : 'axes'} already had a point and ${offered - placed === 1 ? 'was' : 'were'} left alone.`
    );
  parts.push(matchedTail(matched, width, height));
  return parts.join(' ');
}

/** The bounding-box trace (Bar, Histogram): one box per detected shape. */
export function barTraceReport(added: number, noun: string, matched: number, width: number, height: number): string {
  return `Placed ${added} ${noun}${added === 1 ? '' : 's'} (one box per detected ${noun}) from ${matchedTail(matched, width, height)}`;
}

/**
 * What the declared categories say is MISSING after a bar trace (v2.1).
 *
 * ⚑ THIS IS THE REASON THE EXPECTATION REPORT EXISTS. Without it the trace says
 * "Placed 4 bars" and stops -- a table quietly one row short reads exactly like
 * a finished one, which is the failure the whole category-tick feature was built
 * to remove. Naming the categories is the difference between a short answer and
 * a short answer you can see.
 *
 * Empty string when every declared category got a bar, so the caller can append
 * it unconditionally.
 */
export function categoryMissReport(missingNames: readonly string[]): string {
  if (missingNames.length === 0) return '';
  const names = missingNames.join(', ');
  return missingNames.length === 1
    ? ` - no bar found for ${names}.`
    : ` - no bar found for ${missingNames.length} categories: ${names}.`;
}

/** Blob detection: one point per marker. */
export function blobTraceReport(blobs: number, matched: number, width: number, height: number): string {
  return `Placed ${blobs} point${blobs === 1 ? '' : 's'} (one per marker) from ${matchedTail(matched, width, height)}`;
}

/** The ordinary column trace. */
export function curveTraceReport(points: number, matched: number, width: number, height: number): string {
  return `Traced ${points} points from ${matchedTail(matched, width, height)}`;
}

/**
 * What a bar detect found that does not look like a bar.
 *
 * ⚑⚑ A LEGEND SWATCH IS A FILLED RECTANGLE IN EXACTLY THE SERIES INK, so it
 * matches the colour ball at any tolerance and is filed as a bar - a phantom
 * reading that reaches the record and exports. David hit it twice in one day on
 * the bundled grouped-bar figure.
 *
 * ⚑ THE SENTENCE SAYS WHAT WAS MEASURED AND WHAT IT USUALLY MEANS, and stops
 * there. It never says the shape IS a swatch: that is a reading of the figure
 * only the person looking at it can take.
 *
 * ⚑⚑ AND IT SITS BESIDE THE CONTROL THAT UNDOES IT, not in the trace line. The
 * shapes are no longer filed (`partitionSwatchSuspects`), so this is a REFUSAL,
 * and the standing rule for bar techniques permits one only while the thing that
 * takes it back is on screen. Printed into the trace report it would be a
 * paragraph about something already done; printed next to the button it is the
 * offer itself. It was in the trace line for one release, when the shapes were
 * still being filed and the sentence was all the reader got.
 *
 * ⚠️ SAID ONCE. The trace line already reports how many bars were placed, so a
 * second sentence there restating the arithmetic is the heatmap card's
 * "says one thing three times" defect through a new door.
 */
export function swatchHoldBackOffer(held: number): { sentence: string; action: string } | null {
  if (held <= 0) return null;
  // ⚑ ONE FUNCTION FOR BOTH STRINGS so they cannot disagree about the number.
  // Read cold off a screenshot, the first version paired "One shape was held
  // back" with a button saying "Add them anyway" - two halves of one offer
  // counting differently, which is the smallest possible version of the
  // panel-versus-file disagreements this release spent a week removing.
  return held === 1
    ? {
        sentence:
          'One shape was held back: it does not reach the baseline and is much smaller than the bars that do, which is what a legend swatch looks like.',
        action: 'Add it anyway',
      }
    : {
        sentence: `${held} shapes were held back: they do not reach the baseline and are much smaller than the bars that do, which is what legend swatches look like.`,
        action: 'Add them anyway',
      };
}

/**
 * The names of the categories a bar detect found nothing in.
 *
 * ⚑⚑ A BAND IS NOT A CATEGORY. The split reports empty slots by BAND - image
 * order, left to right - while the categories are in the AXIS's order, which
 * runs the other way whenever the axis was marked right-to-left or
 * bottom-to-top. Reporting the band index as though it were the category names
 * a REAL category that was not empty, and nothing about the sentence looks
 * wrong. The mapping is the caller's (`categoryIndexOfBand` knows the axis's
 * direction); what lives here is that it must be applied at all, and what to
 * say when the category has no name.
 *
 * ⚑ An unnamed category is reported BY POSITION, never as a blank: a blank in a
 * list of what is missing reads as nothing being missing there.
 */
export function emptyCategoryNames(
  bands: readonly number[],
  categoryIndexOfBand: (band: number) => number,
  categories: readonly string[]
): string[] {
  return bands.map((band) => {
    const idx = categoryIndexOfBand(band);
    const name = categories[idx];
    return name && name.length > 0 ? name : `Category ${idx + 1}`;
  });
}
