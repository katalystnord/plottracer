/**
 * Whether a log axis's two calibration endpoints can actually be logged.
 *
 * ⚑ WHY THIS MODULE EXISTS. `Math.log(0)` is `-Infinity` and
 * `Math.log(negative)` is `NaN`, and every axes class that supports a log
 * scale feeds its endpoints straight into `Math.log`. Unguarded, the poisoned
 * value is baked into the transform and `calibrate()` returns true anyway:
 * `isCalibrated()` says yes while every reading comes back NaN or null. That
 * is tenet 1's worst shape — nothing on screen looks wrong.
 *
 * The rule is NOT the same for every axis, which is exactly why it lives here
 * rather than being written out four times and drifting:
 *
 *  - An **XY** axis may run through the negative decades (WPD supports a
 *    calibration of, say, −100 to −1, and reflects it). So its endpoints must
 *    merely avoid zero and avoid MIXING signs.
 *  - A **radius** or a **bar/spider value** has no negative branch in its
 *    class at all, so both endpoints must be strictly positive.
 *
 * The interactive path refuses these cases with a sentence the user can act on
 * (`calibrationSession.ts`'s `logScaleGuards`). These functions are the
 * MODEL's own refusal, which is what the other entrances need: `plotData.ts`
 * calls `calibrate()` when loading a project and never inspects the result,
 * and the importers call it directly.
 */

/**
 * XY's rule: neither endpoint is zero, and the two share a sign.
 *
 * An all-negative pair is legitimate — that is a negative-decade axis, which
 * the caller reflects before taking the logarithm. Writing this as "both must
 * be positive" would refuse a real figure.
 */
export function logEndpointsUsable(a: number | null | undefined, b: number | null | undefined): boolean {
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  if (a === 0 || b === 0) return false;
  return a > 0 === b > 0;
}

/**
 * The rule for a scale with no negative branch — a polar radius, a bar's
 * value, a spider spoke: both endpoints strictly positive.
 */
export function logPositiveEndpointsUsable(
  a: number | null | undefined,
  b: number | null | undefined
): boolean {
  return typeof a === 'number' && typeof b === 'number' && a > 0 && b > 0;
}
