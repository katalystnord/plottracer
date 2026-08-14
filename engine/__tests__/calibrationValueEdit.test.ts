import { describe, expect, it } from 'vitest';
import { CalibrationSession, HEATMAP_AXES_CONFIG, XY_AXES_CONFIG } from '../calibrationSession.js';

/**
 * EDITING A CALIBRATION VALUE AFTER IT IS PLACED.
 *
 * ⚑⚑ THERE WAS NO WAY TO. `updateCalibPointPixel` moves a placed point's
 * GEOMETRY — you can drag a calibration handle on the canvas — but nothing ever
 * set its VALUES. Once confirmed, the number was frozen until Reset
 * calibration threw the whole walk away.
 *
 * David hit it at the worst moment: the app refused his log colour key with
 * *"enter positive values"* while giving him no way to enter them. *"And I
 * don't see how I can edit the points at this point during the calibration
 * even?"* His only route was to discard eight clicks and six numbers and start
 * again.
 *
 * ⚑ NOT a heatmap defect — every type has had it. It bites hardest here because
 * the walk is eight steps rather than four, and because the colour key's two
 * labelled ticks are the easiest numbers in the app to get wrong.
 *
 * ⚑ It is also the inconsistency David named for cells: every other value in
 * the app is editable where it is shown. A data point's value can be edited in
 * the table — and editing it MOVES the point. A category name can be renamed.
 * The calibration value, which everything else is measured against, could not.
 */

/** The eight clicks, with what each step collects. */
const HEATMAP_WALK: Array<[number, number, string[]]> = [
  [100, 300, ['0']], [400, 300, ['10', '5']],
  [100, 300, ['0']], [100, 100, ['20', '4']],
  [120, 420, []], [380, 420, []],
  [150, 420, ['5']], [350, 420, ['95']],
];

function walked(config = HEATMAP_AXES_CONFIG, steps = HEATMAP_WALK) {
  const s = new CalibrationSession(config);
  for (const [px, py, values] of steps) {
    s.handleCalibrationClick(px, py);
    if (values.length > 0) s.confirmCalibrationValues(values);
  }
  return s;
}

describe('a placed calibration value can be corrected', () => {
  it('replaces the value without touching the pixel', () => {
    const s = walked();
    const before = s.getPlacedPoints()['kv1']!;
    expect(s.setCalibrationValues('kv1', ['2'])).toBe(true);
    const after = s.getPlacedPoints()['kv1']!;
    expect(after.values).toEqual(['2']);
    // ⚑ The click stands. Correcting a mistyped number is not a reason to make
    // the user find that tick again.
    expect([after.px, after.py]).toEqual([before.px, before.py]);
  });

  it('unblocks the log colour key that had no way out', () => {
    // David's case exactly: a key value of 0 typed on a linear key, then Log
    // switched on — refused, with no way to enter the positive value it asks
    // for. Correcting the value now makes the same calibration succeed.
    const s = walked();
    s.setOption('isLogValue', 'true');
    s.setCalibrationValues('kv1', ['0']);
    expect(s.runCalibration()).toBe(false);
    expect(s.getCalibrationError()).toMatch(/log colour scale/i);

    expect(s.setCalibrationValues('kv1', ['1'])).toBe(true);
    expect(s.runCalibration()).toBe(true);
  });

  it('REFUSES a value the walk itself would not have accepted', () => {
    // ⚑ The same guard at both entrances. `confirmCalibrationValues` requires a
    // value for every non-optional field; an edit that could bypass that would
    // be a second door into the model with a weaker lock — the shape this
    // project has been bitten by four times.
    const s = walked();
    expect(s.setCalibrationValues('kv1', [''])).toBe(false);
    expect(s.getPlacedPoints()['kv1']!.values).toEqual(['5']);
    // …and the wrong NUMBER of values is refused too.
    expect(s.setCalibrationValues('kv1', ['1', '2'])).toBe(false);
    expect(s.setCalibrationValues('nosuchstep', ['1'])).toBe(false);
  });

  it('re-calibrates live when the axes already exist', () => {
    // ⚑ Same rule `setOption` follows: an option describes how the EXISTING
    // handles are read, so it re-runs rather than waiting to be asked. A
    // corrected value is the same kind of change.
    const s = walked(XY_AXES_CONFIG, [
      [100, 300, ['0']], [400, 300, ['10']],
      [100, 300, ['0']], [100, 100, ['20']],
    ]);
    expect(s.runCalibration()).toBe(true);
    expect(s.getAxes()!.pixelToData(250, 200)).toEqual([5, 10]);

    expect(s.setCalibrationValues('x2', ['20'])).toBe(true);
    // The axes moved with it — no second Calibrate press.
    expect(s.getAxes()!.pixelToData(250, 200)).toEqual([10, 10]);
  });

  it('leaves a live calibration alone when the edit is refused', () => {
    const s = walked(XY_AXES_CONFIG, [
      [100, 300, ['0']], [400, 300, ['10']],
      [100, 300, ['0']], [100, 100, ['20']],
    ]);
    s.runCalibration();
    expect(s.setCalibrationValues('x2', [''])).toBe(false);
    expect(s.getAxes()!.pixelToData(250, 200)).toEqual([5, 10]);
  });
});
