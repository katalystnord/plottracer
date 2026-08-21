import { describe, expect, it } from 'vitest';
import { CalibrationSession } from '../calibrationSession.js';
import { BAR_AXES_CONFIG, PIE_AXES_CONFIG } from '../axesTypeConfigs.js';
import type { BarAxes } from '../../core/axes/bar.js';
import type { PieAxes } from '../../core/axes/pie.js';

/**
 * ⚑⚑ A TUPLE ROW CAN NAME ITS PIXEL, AND A PIXEL CAN NAME ITS ROW (v2.3
 * re-audit, F30).
 *
 * Four of the seven output panels - Bar, Box Plot, Pie and the histogram's bins
 * - could not answer *"which one on the figure is this row?"*, while the XY
 * spreadsheet, the spider table and the heatmap matrix all could. The reason was
 * structural rather than cosmetic: every selection in this app addresses a
 * PIXEL, and those four panels' rows are TUPLES, so there was nothing to select
 * with.
 *
 * ⚑ Asked of the MODEL rather than unpacked in each panel. Three panels each
 * learning what a tuple's pixels are is the parallel-mechanism smell the reuse
 * rule exists for - and it would have been three chances to disagree about a
 * half-captured tuple.
 */
function calibratedBar(): CalibrationSession<BarAxes> {
  const s = new CalibrationSession(BAR_AXES_CONFIG);
  s.handleCalibrationClick(100, 250);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['10']);
  s.runCalibration();
  return s;
}

describe('a tuple row and its pixel find each other', () => {
  it('names the tuple a pixel belongs to, and the pixel a tuple starts at', () => {
    const s = calibratedBar();
    s.addDataPoint(150, 200); // bar 0, corner 1
    s.addDataPoint(170, 200); // bar 0, corner 2
    s.addDataPoint(200, 180); // bar 1, corner 1
    s.addDataPoint(220, 180); // bar 1, corner 2
    const firstOfBarOne = s.firstPixelOfTuple(1);
    expect(firstOfBarOne).not.toBeNull();
    // The round trip is the whole mechanism: selecting a row rings a pixel, and
    // the pixel that is ringed highlights its row.
    expect(s.tupleIndexOfPixel(firstOfBarOne)).toBe(1);
    expect(s.tupleIndexOfPixel(s.firstPixelOfTuple(0))).toBe(0);
  });

  it('⚑ a HALF-captured tuple is still selectable - it is a row you can see', () => {
    const s = calibratedBar();
    s.addDataPoint(150, 200);
    s.addDataPoint(170, 200);
    s.addDataPoint(200, 180); // bar 1: one corner only
    expect(s.getDataset().getTuple(1)).toContain(null);
    const pixel = s.firstPixelOfTuple(1);
    expect(pixel, 'a bar with one corner down must still be selectable').not.toBeNull();
    expect(s.tupleIndexOfPixel(pixel)).toBe(1);
  });

  it('an empty selection, and a tuple that does not exist, are null - never row 0', () => {
    const s = calibratedBar();
    s.addDataPoint(150, 200);
    // ⚑ Null, not 0. A "no selection" that reported row 0 would highlight the
    // first row of every table the moment nothing was picked.
    expect(s.tupleIndexOfPixel(null)).toBeNull();
    expect(s.firstPixelOfTuple(9)).toBeNull();
    expect(s.tupleIndexOfPixel(999)).toBeNull();
  });

  it('works on a pie, whose row is a SECTOR rather than a bar', () => {
    const at = (deg: number): [number, number] => [
      300 + 120 * Math.cos((deg * Math.PI) / 180),
      200 + 120 * Math.sin((deg * Math.PI) / 180),
    ];
    const s = new CalibrationSession<PieAxes>(PIE_AXES_CONFIG);
    for (const a of [90, 210, 330]) s.handleCalibrationClick(...at(a));
    s.setGlobalFieldValue('total', '100');
    expect(s.runCalibration()).toBe(true);
    s.addDataPoint(...at(-90));
    s.addDataPoint(...at(0));
    expect(s.getDataset().getTupleCount()).toBeGreaterThan(0);
    const pixel = s.firstPixelOfTuple(0);
    expect(pixel).not.toBeNull();
    expect(s.tupleIndexOfPixel(pixel)).toBe(0);
  });
});
