/**
 * Changing an axis between Values and Categories gives back the values that were
 * typed for the OLD fields, rather than re-reading them positionally.
 *
 * ⚑⚑ THE DEFECT, measured by the 2026-08-29 pre-tag audit. `runCalibration`
 * walks `step.valueFields` and takes `point.values[fi]` IN ORDER, so a step whose
 * field list is reshaped after it was placed hands its old values to the new
 * fields. On a heatmap, `Cn × R1` holds the X coordinate and the COLUMN COUNT.
 * Switch X to Categories and its fields become just the count, so an X of 120 is
 * read as 120 columns. `countProblem` accepts that happily, the card prints the
 * values as bare unlabelled chips, and the figure calibrates with nothing on
 * screen wrong. The reverse direction leaves the count empty and the grid
 * silently absent.
 *
 * ⚑ THE PIXEL IS KEPT AND ONLY THE VALUES ARE GIVEN BACK. Reshaping mid-walk is
 * legitimate - the user is telling us what the figure is - so the click is not
 * thrown away, and the walk returns to the step with its pixel pending. A value
 * typed for one question is not an answer to a different question, however well
 * the digits fit.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, HEATMAP_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';

function heatmapAtX2() {
  const s = new CalibrationSession<XYAxes>(HEATMAP_AXES_CONFIG);
  // C1 x R1 - the shared corner, X value only.
  expect(s.handleCalibrationClick(100, 400)).toBe('awaiting-value');
  expect(s.confirmCalibrationValues(['0'])).toBe(true);
  // Cn x R1 - X value AND the column count.
  expect(s.handleCalibrationClick(500, 400)).toBe('awaiting-value');
  expect(s.confirmCalibrationValues(['120', '8'])).toBe(true);
  return s;
}

describe('changing an axis to categories gives back the values that were typed for the old fields', () => {
  it('un-places the reshaped step and keeps its pixel', () => {
    const s = heatmapAtX2();
    expect(s.getPlacedPoints()['x2']?.values).toEqual(['120', '8']);

    // The user now says the X axis is categorical. `Cn x R1` loses its X field.
    s.setOption('xIsCategory', 'true');

    // The two values typed for [X, Columns] are NOT re-read against the new
    // field list - 120 must never become the column count.
    expect(s.getPlacedPoints()['x2'], 'the reshaped step is given back').toBeUndefined();
    expect(s.getCurrentStep()?.key, 'and the walk returns to it').toBe('x2');
    // The click survives: the pixel is pending, so only the answer is retyped.
    expect(s.getPendingPixel()).toEqual({ px: 500, py: 400 });
  });

  it('⚑ leaves a step alone when the option does not reshape it', () => {
    // The companion assertion: a guard that fires when it should not is the same
    // defect wearing the other face. `C1 x R1` carries one X value under either
    // axis kind on this config, so nothing about it changed.
    const s = heatmapAtX2();
    const before = s.getPlacedPoints()['x1'];
    s.setOption('yIsCategory', 'true');
    expect(s.getPlacedPoints()['x1']).toEqual(before);
  });
});
