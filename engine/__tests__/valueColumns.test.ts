import { describe, expect, it } from 'vitest';
import { valueColumnNames, valueCells } from '../valueColumns.js';
import { BAR_AXES_CONFIG, SPAN_AXES_CONFIG, BOX_PLOT_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ A DATUM HAS N NAMED VALUES, AND N BELONGS TO THE TYPE (v2.5).
 *
 * Not our scheme - the generators': `bar(x, height)` takes one number per bar,
 * `broken_barh((xmin, xwidth))` two, `Candlestick(open, high, low, close)` four,
 * and `bxp` five NAMED keys (`med, q1, q3, whislo, whishi`). See
 * `project_bar_family_generator_sweep`.
 *
 * ⚠️ WHAT IT REPLACED, and both shapes were mine from one evening: first the
 * column set was read off the ROWS, so a Span with nothing captured yet headed
 * its column `Value`; then it was a two-column MODE driven by a PAIR - the N=2
 * case wearing the interface, which a box plot's five could not have used.
 * David: *"you had a tendency to make special cases for some groups, and forgot
 * to look at the bigger picture for consistency and coherency."*
 *
 * ▶ THE CHECK THIS FILE EXISTS TO KEEP: if a fifth member of the family arrived
 * tomorrow, nothing here should have to change - only what the TYPE declares.
 */
function calibrated<C extends typeof BAR_AXES_CONFIG>(config: C) {
  const s = new CalibrationSession<BarAxes>(config as never);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s, { count: 2 });
  expect(s.runCalibration()).toBe(true);
  return s;
}

describe('what a datum’s values are called', () => {
  it('a Bar has ONE, under the heading it derives', () => {
    expect(valueColumnNames(BAR_AXES_CONFIG, ['Min', 'Max'])).toEqual(['Value']);
  });

  it('⚑ a Span has TWO, because its record IS the interval', () => {
    expect(valueColumnNames(SPAN_AXES_CONFIG, ['Min', 'Max'])).toEqual(['Min', 'Max']);
  });

  it('⚑⚑ a type that neither derives nor spans falls back to its own SLOTS', () => {
    // ⚑ Which is how a Box Plot's five arrive, and why the slots come from the
    // SESSION: `applyBoxPlotGroups` reshapes them at runtime.
    expect(valueColumnNames(BOX_PLOT_AXES_CONFIG, ['Min', 'Q1', 'Median', 'Q3', 'Max'])).toEqual([
      'Min',
      'Q1',
      'Median',
      'Q3',
      'Max',
    ]);
  });
});

describe('and the readings line up with those names', () => {
  it('⚑⚑ ALIGNED IS THE WHOLE CONTRACT - name[i] answers cell[i]', () => {
    const bar = calibrated(BAR_AXES_CONFIG);
    bar.addDataPoint(150, 500);
    bar.addDataPoint(150, 300);
    const barRow = bar.getTupleRows()[0]!;
    expect(valueCells(BAR_AXES_CONFIG, barRow.points, bar.getAxes()!)).toHaveLength(1);

    const span = calibrated(SPAN_AXES_CONFIG as never);
    span.addDataPoint(150, 400);
    span.addDataPoint(150, 200);
    const spanRow = span.getTupleRows()[0]!;
    const cells = valueCells(SPAN_AXES_CONFIG as never, spanRow.points, span.getAxes()!);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toBeCloseTo(2.5, 6);
    expect(cells[1]).toBeCloseTo(7.5, 6);
  });

  it('⚑ a reading that is missing keeps its PLACE, so no column can shift', () => {
    // A half-dragged span: one end placed. The array must still be two long, or
    // a consumer lines a Max up under a Min.
    const span = calibrated(SPAN_AXES_CONFIG as never);
    span.addDataPoint(150, 400);
    const cells = valueCells(SPAN_AXES_CONFIG as never, span.getTupleRows()[0]!.points, span.getAxes()!);
    expect(cells).toEqual([null, null]);
  });
});
