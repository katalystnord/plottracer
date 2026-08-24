/**
 * The two category-axis clicks and the count that a bar-family calibration walk
 * requires since v2.4.
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

/** The narrow part of `CalibrationSession` this needs - no generic to thread. */
interface WalkableSession {
  handleCalibrationClick(px: number, py: number): unknown;
  confirmCalibrationValues(values: string[]): unknown;
}

export interface CategoryWalkOptions {
  /** The outer edge of the FIRST category. */
  from?: { x: number; y: number };
  /** The outer edge of the LAST category. */
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
  const { from = { x: 100, y: 500 }, to = { x: 500, y: 500 }, count = 4 } = opts;
  session.handleCalibrationClick(from.x, from.y);
  session.handleCalibrationClick(to.x, to.y);
  session.confirmCalibrationValues([String(count)]);
}
