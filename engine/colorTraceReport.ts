import type { AxesTypeConfig, CalibratedAxes } from './axesTypeConfigs.js';

/**
 * What an auto-extract by colour REFUSES, and what it reports afterwards.
 *
 * ⚑ WHY THE PROSE IS THE POINT. This tool's design rule is that **a refusal is
 * information, not a failure**: the spider trace deliberately declines every ray
 * whose evidence is ambiguous rather than picking one, and the axes it left
 * empty become the user's worklist. That only works if the report says WHICH
 * ones and WHY — a bare count leaves the reader hunting the table for blanks.
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
  /** The axes are built — traced points need a coordinate system. */
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
  if (!isCalibrated) return 'Calibrate the axes first — traced points need a coordinate system.';
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
      ? ' — that is a lot of the image; if it grabbed the grid/axes, lower the tolerance or run Grid Removal first.'
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
  /** How many the session actually took — an axis that already had a point keeps it. */
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
  // ⚑ Clipped is NOT "nothing found" — the colour was still there when the
  // search stopped, so the crossing is beyond the axis's labelled range and the
  // reading would have been the search window's own limit. Say which, and say
  // what to check, because the usual cause is a known point calibrated on an
  // inner ring rather than the axis's end.
  const clipped = readings.filter((r) => r.reason === 'clipped');

  const parts = [`Read ${placed} of ${readings.length} ${readings.length === 1 ? 'axis' : 'axes'}.`];
  if (ambiguous.length)
    parts.push(
      `${named(ambiguous)}: the colour crosses that ray more than once, so nothing was recorded — place ${ambiguous.length === 1 ? 'it' : 'them'} yourself.`
    );
  if (missing.length) parts.push(`Nothing of that colour crosses ${named(missing)}.`);
  if (clipped.length)
    parts.push(
      `${named(clipped)}: the colour runs past the end of that axis, so nothing was recorded — check the axis's known point, or place ${clipped.length === 1 ? 'it' : 'them'} yourself.`
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

/** Blob detection: one point per marker. */
export function blobTraceReport(blobs: number, matched: number, width: number, height: number): string {
  return `Placed ${blobs} point${blobs === 1 ? '' : 's'} (one per marker) from ${matchedTail(matched, width, height)}`;
}

/** The ordinary column trace. */
export function curveTraceReport(points: number, matched: number, width: number, height: number): string {
  return `Traced ${points} points from ${matchedTail(matched, width, height)}`;
}
