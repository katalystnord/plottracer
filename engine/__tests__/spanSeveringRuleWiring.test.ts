import { describe, expect, it } from 'vitest';
import { SPAN_AXES_CONFIG, BAR_AXES_CONFIG, CalibrationSession } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import truth from '../../samples/bar-floating-temperature.truth.json';

/**
 * ⚑⚑ THE APP HAS TO AIM THE JOIN AT THE RULE, and nothing checked that (v2.5).
 *
 * `barDetectBaselineJoin.test.ts` proves the mechanism: hand the detector the
 * zero rule and a severed span comes back whole. It hands it that number BY
 * HAND. So when the bar origin stopped being a typed `0` this morning and became
 * the measured CATEGORY AXIS, the app began handing the detector a line 198px
 * away - and every one of those tests stayed green while
 * `samples/bar-floating-temperature` went back to seventeen readings for twelve
 * months. David found it in the built app within the hour.
 *
 * ▶ CLAUDE.md's fourth gate, in the engine: a test that proves the mechanism and
 * conceals the wiring is the one that lets a regression through. David's moral
 * for the day: *"Change is good. Checking is better."*
 */
const p1 = truth.calibration.anchors.p1;
const p2 = truth.calibration.anchors.p2;
const c1 = truth.calibration.anchors.c1;
const c2 = truth.calibration.anchors.c2;

/** The figure exactly as its truth file describes it: the category axis sits at
 *  -15, nowhere near the zero rule that severs five of its bars. */
function floatingTemperature(config: typeof SPAN_AXES_CONFIG) {
  const s = new CalibrationSession<BarAxes>(config as never);
  s.handleCalibrationClick(p1.px, p1.py);
  expect(s.confirmCalibrationValues([String(p1.value)])).toBe(true);
  s.handleCalibrationClick(p2.px, p2.py);
  expect(s.confirmCalibrationValues([String(p2.value)])).toBe(true);
  s.handleCalibrationClick(c1.px, c1.py);
  s.handleCalibrationClick(c2.px, c2.py);
  expect(s.confirmCalibrationValues([String(c2.value)])).toBe(true);
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** Where value 0 actually sits on this calibration. */
const zeroPy =
  p1.py + ((0 - p1.value) * (p2.py - p1.py)) / (p2.value - p1.value);

describe('what the app hands the detector', () => {
  it('⚑⚑ a SPAN is severed at the ZERO RULE, not at its category axis', () => {
    const s = floatingTemperature(SPAN_AXES_CONFIG);
    const rule = s.severingRulePixelForDetect();
    expect(rule, 'a span can straddle a rule, so it must name one').not.toBeNull();
    expect(rule!.atPixel).toBeCloseTo(zeroPy, 1);
  });

  it('⚠️ and that is NOT its origin - the two were one number for a morning', () => {
    const s = floatingTemperature(SPAN_AXES_CONFIG);
    // The category axis of this figure is at -15, which is the whole point: a
    // join aimed there finds nothing to join.
    expect(s.getAxes()!.getBaselineValue()).toBeCloseTo(-15, 1);
    // ⚑ And a span offers NO baseline at all now: that line answers the swatch
    // question - *"a bar is anchored at the baseline and a swatch floats"* - and
    // a span floats by definition, so there is nothing there to discriminate.
    expect(s.baselinePixelForDetect()).toBeNull();
  });

  it('⚑⚑ a BAR names no severing rule at all - it STANDS on its origin', () => {
    // David: *"I do not think it should be in bars at all."* A bar's near end is
    // ON the line, so the line abuts it and cannot cut it in two. Two
    // same-coloured bars either side of the origin - a diverging chart - would
    // otherwise have been joined into a reading that never existed.
    const s = floatingTemperature(BAR_AXES_CONFIG as never);
    expect(s.severingRulePixelForDetect()).toBeNull();
  });
});
