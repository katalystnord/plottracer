/**
 * The two category-axis clicks and the count that a bar-family calibration walk
 * requires since v2.3.
 *
 * ⚑⚑ WHY EVERY BAR FIXTURE NEEDED TOUCHING. Bar, Box Plot and categorical Line
 * used to calibrate in TWO clicks on the value axis; the category axis was a
 * fold-out offered afterwards, seeded from P1. David made it a requirement -
 * *"shall we then make it not an offer but a requirement?"* - so the walk is
 * four steps and a fixture that stops at two is describing a state the app can
 * no longer be in. [[feedback_fixture_blind_by_construction]]: the point is not
 * that the tests broke, it is that they were all silently exercising a
 * half-calibrated session and would have gone on doing so.
 *
 * ⚑ ONE PLACE, so the walk's shape is stated once. When a fifth step arrives,
 * thirty-two files do not have to be found again.
 */

import { edgesFromClicks } from '../../../core/bandedAxis.js';

/** The narrow part of `CalibrationSession` this needs - no generic to thread. */
interface WalkableSession {
  handleCalibrationClick(px: number, py: number): unknown;
  confirmCalibrationValues(values: string[]): unknown;
}

export interface CategoryWalkOptions {
  /** The FIRST category's tick mark (v2.7; the outer edge before). */
  from?: { x: number; y: number };
  /** The LAST category's tick mark (v2.7; the outer edge before). */
  to?: { x: number; y: number };
  /** How many categories the figure has - typed on the second click. */
  count?: number;
}

/**
 * Place the category axis the way a user does: two clicks, then the count.
 *
 * ⚑ The defaults describe an ordinary upright chart whose categories run along
 * the foot of the plot, wide enough that a test capturing bars between x=100 and
 * x=500 lands inside it. A test that cares where the bands fall passes its own.
 */
export function walkCategoryAxis(session: WalkableSession, opts: CategoryWalkOptions = {}): void {
  const count = opts.count ?? 4;
  // v2.7: the default axis still runs from x = 100 to 500; the clicks are its first and last tick marks
  const ticks = tickMarksWithin({ x: 100, y: 500 }, { x: 500, y: 500 }, count);
  const { from = ticks.from, to = ticks.to } = opts;
  session.handleCalibrationClick(from.x, from.y);
  session.handleCalibrationClick(to.x, to.y);
  session.confirmCalibrationValues([String(count)]);
}

type Anchor = { px: number; py: number; value?: number };

/**
 * The category axis's two outer edges, from a truth file's `c1`/`c2` anchors (v2.7: the first and last category's
 * tick marks, `c2` carrying the count), worked out by the app's own rule. For a test that cuts bands or locates
 * category centres itself; a test that walks the calibration clicks the anchors as they are.
 */
export function truthCategoryEdges(anchors: Record<string, Anchor>): [Anchor, Anchor] {
  const c1 = anchors['c1']!, c2 = anchors['c2']!;
  const [a, b] = edgesFromClicks({ x: c1.px, y: c1.py }, { x: c2.px, y: c2.py }, c2.value!, 'centred', 'ticks');
  return [{ px: a.x, py: a.y }, { px: b.x, py: b.y, value: c2.value! }];
}

/**
 * The first and last category's tick marks (ticks at centres) on an axis whose outer edges are `from` and `to`: what
 * the Cat 1 and Cat n prompts ask a user to click on such a figure (v2.7). For a fixture that describes its axis by
 * its edges.
 */
export function tickMarksWithin(
  from: { x: number; y: number },
  to: { x: number; y: number },
  count: number
): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const k = 1 / (2 * count);
  const dx = to.x - from.x, dy = to.y - from.y;
  return { from: { x: from.x + dx * k, y: from.y + dy * k }, to: { x: to.x - dx * k, y: to.y - dy * k } };
}
