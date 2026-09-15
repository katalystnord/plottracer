/**
 * ⚑⚑ WE DO NOT SUPPORT LAYERED GRAPHS YET, AND WE SAY SO. THAT IS ALL.
 *
 * David, 2026-09-15: *"Remove the code and the offer card that was created to
 * handle layered graphs. And we will just point blank say that we do not yet
 * support layered graphs. And that is it."*
 *
 * ⚠️ WHAT WAS HERE, AND WHY IT WENT. A file can carry series of different kinds
 * on one graph (a WPD project where one dataset has point groups and another
 * does not). That is a LAYERED graph, which is v3.0 work. This module briefly
 * grew an offer to split such a project into one figure per kind, a split that
 * inferred each figure's type from its slots, and a panel button to run it
 * later. David, seeing what a small correctness fix had turned into: *"We are
 * creating mayhem to something that should have been a simple small point
 * release."* He is right, and none of it was asked for.
 *
 * ⚑ WHAT SURVIVES IS THE ANSWER TO ONE QUESTION: does this figure hold series of
 * more than one shape? The app says so and does nothing else. Reading each
 * series under its OWN shape is a separate, genuine correctness fix and lives in
 * `getBarCategoryTable`, not here.
 */
import { ownSlotNames } from '../algorithms/errorExtent.js';

/** One series, as this module needs to see it. */
export interface SeriesShape {
  name: string;
  /** The series' own slot names, in capture order. */
  slots: readonly string[];
}

/**
 * ⚑⚑ THE ERROR TAIL IS NOT PART OF THE SHAPE, and `ownSlotNames` is the app's
 * answer to that question everywhere else.
 *
 * ⚠️ Without this, capturing ONE error cap - which calls `adoptSlots` on that
 * series ALONE - made a plain bar and its error-carrying sibling answer two
 * different shapes, so an ORDINARY chart was declared layered. Enforced by
 * `errorBarsAreNotASecondKind.test.ts`, which is red without this line.
 */
function shapeKey(slots: readonly string[]): string {
  // Case- and space-insensitive: a file writing `min` where we write `Min` is
  // the same shape, not a second one.
  return JSON.stringify(ownSlotNames([...slots]).map((s) => s.trim().toLowerCase()));
}

/** Does this figure hold series of more than one shape? */
export function isLayered(series: readonly SeriesShape[]): boolean {
  return new Set(series.map((s) => shapeKey(s.slots))).size > 1;
}

/**
 * ⚑ What the user is told, or null when there is nothing to tell. A statement,
 * not an offer: there is nothing to press and nothing to decide.
 */
export const LAYERED_NOT_SUPPORTED =
  'This project holds series of different kinds on one graph. PlotTracer does not support ' +
  'layered graphs yet, so the series are shown and read separately, each under its own columns.';

export function layeredNotice(series: readonly SeriesShape[]): string | null {
  return isLayered(series) ? LAYERED_NOT_SUPPORTED : null;
}
