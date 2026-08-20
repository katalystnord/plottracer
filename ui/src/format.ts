/**
 * Display formatting - how a number LOOKS, never what it is.
 *
 * ⚑ Kept firmly on the ui/ side of the line `core/measurementValues.ts` draws:
 * *"formatting stays in ui/ - a core/ module that returned "45.0°" would be
 * re-committing the defect"* that once made a rounded display string the only
 * copy of a measurement's value. Nothing here is ever stored; the record keeps
 * the raw double and every value is re-derived from pixels on demand.
 */

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  return String(Number(n.toPrecision(4)));
}

const VALUE_FMT = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6, useGrouping: false });
/** For extreme magnitudes, plain decimal is an unreadable wall of zeros: a point
 * sitting on the calibration origin derives (via pixelToData float arithmetic) to
 * ~2e-15, not exactly 0, and printed as "0.00000000000000222045". Switch to
 * scientific notation only at the extremes, so the normal range -- including small
 * log-axis values like 0.0012 -- stays plain decimal. Pure presentation; the
 * record is untouched (tenet 9), and export rounds to pixel resolution separately. */
const VALUE_FMT_SCI = new Intl.NumberFormat('en-US', { notation: 'scientific', maximumSignificantDigits: 6 });
export function fmtValue(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-4 || a >= 1e9)) return VALUE_FMT_SCI.format(n);
  return VALUE_FMT.format(n);
}

/**
 * What a value editor OPENS WITH, for every number in the app that can be typed
 * over: the whole number, never the displayed rounding of it (F23).
 *
 * ⚑⚑ THE DISPLAY IS A VIEW AND THE EDITOR IS THE VALUE. `fmtValue` above exists
 * to make a number readable, at six significant figures; seeding an editor from
 * that would hand the user a DIFFERENT number to commit than the one they
 * double-clicked, and the commit is what moves the datum.
 *
 * ⚠️ It replaces three implementations of one job, one of which destroyed data:
 * the XY and spider tables seeded `value.toFixed(3)` under a comment claiming
 * they had adopted the heatmap's rule. Measured on the branch before this:
 *
 *     value      shown       seeded    committed
 *     0.00042    0.00042     0.000     0          <- on a log axis, gone
 *     2.5e-7     2.5E-7      0.000     0
 *     0.5001234  0.500123    0.500     0.5
 *
 * The editor commits on blur, so double-clicking a small y and clicking away
 * silently moved the point to zero. Nothing refused it, because a parse of
 * "0.000" is a perfectly good number.
 *
 * ⚑ Paired with the SEED COMPARISON at the commit, which is the heatmap's own
 * invariant and now everyone's: an editor that opens and closes without a
 * keystroke must record nothing at all. The seed is what makes "without a
 * keystroke" a thing the code can ask.
 */
export function editSeed(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '' : String(n);
}

/** [r,g,b] -> "#rrggbb", for the series list's colour swatches + hex field
 * (checkpoint 89; hex is what the field and swatch keys use). Canvas markers
 * don't need this: Konva's fill/stroke accept a plain "rgb(r,g,b)" string
 * directly. */
export function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
