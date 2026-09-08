/**
 * ⚑⚑ A BAR REPORTS ITS VALUE WHATEVER ITS NEAR END DID.
 *
 * ⚠️ `BAR_AXES_CONFIG.compute`'s own doc named a third outcome that no longer
 * exists - *"anything else FLOATS -> ... `null`, and `unreadable` below is what
 * says SO ON SCREEN"* - months after `0d75cc3` made the bar report its value
 * regardless, and after the surface was rebuilt as `advisory` +
 * `offBaselineMessage`. Neither the `null` nor a mechanism called `unreadable`
 * was reachable. Gate 3: a doc naming outcomes the function cannot produce is
 * how a reader concludes the case is handled and stops looking.
 *
 * ⚑ These name the outcomes that DO exist, so the doc cannot drift again
 * without something going red.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG, type CalibratedAxes } from '../calibrationSession.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

function bars(clicks: readonly (readonly [number, number])[]): CalibrationSession<CalibratedAxes> {
  const s = new CalibrationSession<CalibratedAxes>(BAR_AXES_CONFIG as never);
  s.handleCalibrationClick(100, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['8']);
  walkCategoryAxis(s, { from: { x: 100, y: 500 }, to: { x: 400, y: 500 }, count: 3 });
  s.runCalibration();
  for (const [x, y] of clicks) s.addDataPoint(x, y);
  return s;
}

describe('the outcomes a bar’s compute actually has', () => {
  it('a bar standing on the baseline reports the far point’s value', () => {
    const s = bars([
      [120, 500],
      [120, 300],
    ]);
    expect(s.getTupleRows()[0]!.derived).toBeCloseTo(4, 2);
  });

  it('⚑⚑ a bar clear of the baseline STILL reports it - there is no null outcome', () => {
    // ⚠️ The case the stale doc claimed returned `null`. A bar clicked short of
    // the axis reported no value at all, so a steady hand was a precondition
    // for getting a number - which is not a claim the figure ever made.
    const s = bars([
      [120, 450],
      [120, 300],
    ]);
    expect(s.getTupleRows()[0]!.derived, 'a floating bar reports its far end').toBeCloseTo(4, 2);
  });

  it('⚑ and it is REPORTED as off-baseline, which is the surface that replaced it', () => {
    const s = bars([
      [120, 450],
      [120, 300],
    ]);
    const table = s.getBarCategoryTable();
    expect(table.advisory?.length, 'the near end missing the baseline is advised, not refused').toBe(1);
  });

  it('a half-dragged bar has no value yet - the one null that IS reachable', () => {
    const s = bars([[120, 500]]);
    expect(s.getTupleRows()[0]!.derived).toBeNull();
  });
});
