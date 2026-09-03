/**
 * A bar's error cap is constrained to the line its whisker is DRAWN along.
 *
 * ⚑⚑ THE DEFECT. v2.3 moved a bar's whisker to start at the bar's CENTRE, where
 * every real figure draws it, and left the cap's drag CONSTRAINT on the tuple's
 * datum - which for a bar is a CORNER. So the cap sat locked to the corner's
 * vertical while the whisker was drawn from the centre, and every bar error bar
 * leaned by exactly half a bar width. David, 2026-08-29, placing one on a
 * floating bar chart: the whisker ran diagonally across two neighbouring bars.
 *
 * Two halves of one change, and the picture is the half that showed it - pattern
 * 4, the picture lying while the record is fine.
 *
 * ⚑ The second test is the model half David named: *"the floating bars carry
 * meaning on BOTH ends, and therefore the error bars should be pointing out from
 * the centre of the bar on either side."* No second mechanism was added for it -
 * the anchor already picks whichever END lies nearer the cap, so once both
 * callers share that definition a floating bar gets an outward whisker at each
 * end for free.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { OPPOSITE_CORNER_SLOTS } from '../axesTypeConfigs.js';
import { errorSlotNames, slotForRole } from '../../algorithms/errorExtent.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/** Value 0..30 over py 500..100; categories along the foot. */
function barSession() {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  expect(s.handleCalibrationClick(100, 500)).toBe('awaiting-value');
  expect(s.confirmCalibrationValues(['0'])).toBe(true);
  expect(s.handleCalibrationClick(100, 100)).toBe('awaiting-value');
  expect(s.confirmCalibrationValues(['30'])).toBe(true);
  walkCategoryAxis(s);
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** A floating bar between px 200..260, spanning py 400..300, plus a cap. */
function floatingBarWithCap(s: CalibrationSession<BarAxes>, capY: number) {
  const ds = s.getDatasets()[0]!;
  // ⚑ THE BAR'S OWN SLOTS, not the default ['Value']. With the default the
  // dataset is XY-shaped, `isBarIntervalShape` is correctly false, and the test
  // measures a code path bars never take - [[feedback_fixture_blind_by_construction]].
  const slots = errorSlotNames('SD', OPPOSITE_CORNER_SLOTS);
  ds.adoptSlots(slots);
  // The bar's two measured corners: Min low-left, Max high-right.
  const lo = ds.addPixel(200, 400);
  const hi = ds.addPixel(260, 300);
  ds.addTuple(lo);
  ds.addToTupleAt(0, 1, hi);
  const capIndex = ds.addPixel(230, capY);
  return { ds, slots, capIndex };
}

describe("a bar's error cap is constrained to the line its whisker is drawn along", () => {
  it('locks to the bar CENTRE, not to the corner the datum happens to be', () => {
    const s = barSession();
    const { slots, capIndex } = floatingBarWithCap(s, 250);
    s.getDatasets()[0]!.addToTupleAt(0, slotForRole('upper', slots.length), capIndex);

    const line = s.errorCapDragLine(0, capIndex);
    expect(line, 'a recorded cap must be constrained').not.toBeNull();
    // The corners are at x=200 and x=260, so the centre is 230. Anchoring on the
    // datum corner would give 200 and lean the whisker by 30px.
    expect(line!.origin.x).toBeCloseTo(230, 6);
    expect(Math.abs(line!.direction.x), 'vertical: no x component').toBeLessThan(1e-6);
  });

  it('⚑ anchors at the END NEARER THE CAP, so a floating bar points out from both', () => {
    // Upper cap above the high end: anchor at the HIGH end's centre.
    const up = barSession();
    const a = floatingBarWithCap(up, 250);
    up.getDatasets()[0]!.addToTupleAt(0, slotForRole('upper', a.slots.length), a.capIndex);
    const upperLine = up.errorCapDragLine(0, a.capIndex);
    expect(upperLine!.origin.y).toBeCloseTo(300, 6);

    // Lower cap below the low end: anchor at the LOW end's centre.
    const down = barSession();
    const b = floatingBarWithCap(down, 450);
    down.getDatasets()[0]!.addToTupleAt(0, slotForRole('lower', b.slots.length), b.capIndex);
    const lowerLine = down.errorCapDragLine(0, b.capIndex);
    expect(lowerLine!.origin.y).toBeCloseTo(400, 6);

    // Both on the same vertical: the bar's centre.
    expect(upperLine!.origin.x).toBeCloseTo(230, 6);
    expect(lowerLine!.origin.x).toBeCloseTo(230, 6);
  });
});
