import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG } from '../calibrationSession.js';
import { buildExportSections } from '../exportAssembly.js';
import type { ExportAssemblyInput } from '../exportAssembly.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ EVERY MEASURED COLUMN AT THE FIGURE'S OWN RESOLUTION, and two were not.
 *
 * `exportPrecision` exists so the file reports what the pixels can support, and
 * so the panel and the file agree. `Position min`/`Position max` and the derived
 * `Value` were written straight from the model instead:
 *
 *   · a bar's category extent reached the file as `2.0999999999999996` -
 *     sixteen significant digits claimed from a pixel measurement;
 *
 * ⚠️ ONE HALF OF THAT IS FIXED HERE AND THE OTHER IS NOT. `Position min`/`max`
 * were plainly missing the rounder and now use it. The derived `Value` is a
 * different matter: on a baseline-anchored bar it IS `Max`, and the two can
 * still disagree in adjacent columns - `Max 3.273` beside `Value 3.2725` - but
 * `derived` is emitted as-is ON PURPOSE, because `compute` has already rounded
 * to the TYPE's own precision and re-rounding needs `axes.dataToPixel`, a stub
 * for non-invertible axes. The disagreement is between two rounding RULES, and
 * choosing which wins is a record decision, not a line to patch.
 *
 * Found auditing the record before a stable tag, which is the right time: a
 * column's precision is part of what every consumer downstream inherits.
 */
/**
 * ⚑⚑ THE FIGURE HAS TO PRODUCE THE NOISE, or the test proves nothing. A first
 * version used a 0..7 axis whose extents came out as 0.73 and 1.17 - already
 * clean, so removing the rounder left it green and the test was VACUOUS. This
 * geometry is the one that put `2.0999999999999996` in a CSV.
 */
function barWithAwkwardNumbers() {
  const s = new CalibrationSession(BAR_AXES_CONFIG);
  s.handleCalibrationClick(100, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s, { from: { x: 100, y: 500 }, to: { x: 400, y: 500 }, count: 3 });
  s.runCalibration();
  s.addDataPoint(120, 500);
  s.addDataPoint(160, 300);
  s.addDataPoint(220, 400);
  s.addDataPoint(260, 300);
  return s;
}

const rowOf = (s: CalibrationSession<never>, which = 0) => {
  const [data] = buildExportSections({
    session: s, axes: s.getAxes()!, configId: 'bar',
    scope: 'active', measures: [], precision: 'auto',
  } as unknown as ExportAssemblyInput);
  return { header: data!.header, row: data!.rows[which]! };
};

/** How many digits after the point this cell actually carries. */
const dp = (v: unknown): number => {
  const t = String(v);
  return t.includes('.') ? t.split('.')[1]!.length : 0;
};

describe('the bar export reports every measured column at one resolution', () => {
  it('⚑ the category extent is rounded too, not handed over raw', () => {
    const { header, row } = rowOf(barWithAwkwardNumbers() as never, 1);
    const lo = row[header.indexOf('Position min')];
    const hi = row[header.indexOf('Position max')];
    // The precise digits depend on the figure; what must be true is that these
    // carry no more than the readings beside them.
    const readings = [row[header.indexOf('Min')], row[header.indexOf('Max')]];
    const most = Math.max(...readings.map(dp));
    expect(dp(lo)).toBeLessThanOrEqual(most);
    expect(dp(hi)).toBeLessThanOrEqual(most);
  });

  it('⚑ no column carries float noise - nothing reaches the file at 16 digits', () => {
    const { row } = rowOf(barWithAwkwardNumbers() as never, 1);
    for (const cell of row) expect(dp(cell)).toBeLessThan(10);
  });
});
