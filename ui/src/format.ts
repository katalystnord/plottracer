/**
 * Display formatting — how a number LOOKS, never what it is.
 *
 * ⚑ Kept firmly on the ui/ side of the line `core/measurementValues.ts` draws:
 * *"formatting stays in ui/ — a core/ module that returned "45.0°" would be
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
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-4 || a >= 1e9)) return VALUE_FMT_SCI.format(n);
  return VALUE_FMT.format(n);
}
