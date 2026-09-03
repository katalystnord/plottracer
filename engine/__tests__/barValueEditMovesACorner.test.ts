import { describe, expect, it } from 'vitest';
import { BAR_AXES_CONFIG, SPAN_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ EDITING A BAR'S VALUE MOVES A CORNER - IT NEVER OVERWRITES A NUMBER (v2.5).
 *
 * The rule every other table here already follows, and the bar table was the
 * last one without an editor. The blocker was the MODEL, not the widget: while a
 * bar's value depended on BOTH corners, typing 7 had no single answer - move the
 * top, the bottom, or both? With the origin owned by the figure there is exactly
 * one, and `valuePointIndexFor` is what says which.
 *
 * ▶ Rule 3 of this family's panel framework: one column, one editable thing.
 */
function calibratedBar(options: Record<string, string> = {}) {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  for (const [k, v] of Object.entries(options)) s.setOption(k, v);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s, { count: 2 });
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** The two captured pixels of tuple 0, in capture order. */
function corners(s: CalibrationSession<BarAxes>) {
  const ds = s.getDataset();
  return ds.getAllTuples()[0]!.map((i) => (i == null ? null : { ...ds.getPixel(i) }));
}

describe('a Bar', () => {
  it('⚑⚑ moves the corner AWAY from the origin, and leaves the other one alone', () => {
    const s = calibratedBar();
    s.addDataPoint(150, 500); // the near corner, on the origin
    s.addDataPoint(190, 300); // the far corner, worth 5
    const before = corners(s);
    const at = s.valuePointIndexFor(0, 0);
    expect(at).not.toBeNull();
    expect(s.setDataPointValue(at!, 0, 7)).toBe(true);

    const table = s.getBarCategoryTable();
    expect(table.columns[0]!.cells[0]![0]).toBeCloseTo(7, 6);
    const after = corners(s);
    // ⚑ The NEAR corner is untouched: the bar still stands on the origin, and
    // its width - both corners' category coordinates - is unchanged.
    expect(after[0]).toEqual(before[0]);
    expect(after[1]!.y).not.toBeCloseTo(before[1]!.y, 3);
    expect(after[1]!.x).toBeCloseTo(before[1]!.x, 6);
  });

  it('⚑ and the reading is marked as the USER\\u2019s, through the same model', () => {
    const s = calibratedBar();
    s.addDataPoint(150, 500);
    s.addDataPoint(190, 300);
    expect(s.getBarCategoryTable().columns[0]!.supplied[0]![0]).toBe(false);
    s.setDataPointValue(s.valuePointIndexFor(0, 0)!, 0, 7);
    expect(s.getBarCategoryTable().columns[0]!.supplied[0]![0]).toBe(true);
  });
});

describe('a STACKED figure names two points, and each column moves its own', () => {
  it('⚑⚑ `Base` moves the near corner, `Value` the far one', () => {
    const s = calibratedBar({ isStacked: 'true' });
    s.addDataPoint(150, 420); // stands on 2
    s.addDataPoint(190, 300); // reaches 5: a contribution of 3
    expect(s.getBarCategoryTable().valueColumns).toEqual(['Base', 'Value']);
    const base = s.valuePointIndexFor(0, 0);
    const value = s.valuePointIndexFor(0, 1);
    expect(base).not.toBe(value);

    const before = corners(s);
    expect(s.setDataPointValue(base!, 0, 1)).toBe(true); // drop its foot to 1
    const after = corners(s);
    // The FAR corner has not moved, so the segment grew rather than slid.
    expect(after[1]).toEqual(before[1]);
    const cells = s.getBarCategoryTable().columns[0]!.cells[0]!;
    expect(cells[0]).toBeCloseTo(1, 6); // Base
    expect(cells[1]).toBeCloseTo(4, 6); // Value: 5 - 1
  });
});

describe('a SPAN names its two ends by VALUE, not by the hand', () => {
  it('⚑ `Min` moves the lower end whichever corner was dragged first', () => {
    const s = new CalibrationSession<BarAxes>(SPAN_AXES_CONFIG);
    s.handleCalibrationClick(300, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(300, 100);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s, { count: 2 });
    expect(s.runCalibration()).toBe(true);
    // Dragged from the TOP down, so capture order is high then low.
    s.addDataPoint(150, 200); // 7.5
    s.addDataPoint(190, 400); // 2.5
    const min = s.valuePointIndexFor(0, 0);
    expect(s.setDataPointValue(min!, 0, 1)).toBe(true);
    const cells = s.getBarCategoryTable().columns[0]!.cells[0]!;
    expect(cells[0]).toBeCloseTo(1, 6); // Min moved
    expect(cells[1]).toBeCloseTo(7.5, 6); // Max stayed
  });
});
