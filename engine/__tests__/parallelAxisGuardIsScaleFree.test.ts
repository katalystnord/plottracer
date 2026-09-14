/**
 * ⚑⚑ "ARE THESE TWO DIRECTIONS PARALLEL" IS A QUESTION ABOUT AN ANGLE, SO THE
 * THRESHOLD MUST NOT CARRY THE SIZE OF THE FIGURE.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-11, reported against ternary. It is not a ternary
 * defect: `parallelAxisGuard` compared the raw cross product against `1e-9`, and
 * `cross = |d1| |d2| sin(theta)`, so the test it actually performed was
 * *"sin(theta) < 1e-9 / (|d1| |d2|)"* - a threshold that tightens as the figure
 * grows. On a 300px frame it fires only at about 1e-14, which is exact
 * degeneracy and nothing else. Every type declaring the guard had the same hole:
 * XY, heatmap, Bar, Box Plot and ternary.
 *
 * ⚑ THE FIX IS THE RULE, NOT THE CASE. Normalising by both lengths asks for
 * `|sin(theta)|` directly, which is what the guard always meant and is unchanged
 * when the same figure is photographed at twice the size.
 *
 * ⚑ WHY 0.01 (about 0.57 degrees), and it is chosen to be the conservative end
 * rather than the interesting one: a reading's sensitivity to a click goes as
 * `1 / sin(theta)`, so at 0.57 degrees one pixel of error on a 300px frame moves
 * a value by tens of units on a 0..100 scale - the reading has stopped meaning
 * anything. A badly distorted photograph sits at tens of degrees and is
 * thousands of times clear of it, which is the margin a guard wants: it refuses
 * only frames that cannot be read, and never argues with a real figure.
 * [[feedback_aid_is_not_calibration]]'s question answered the other way round -
 * a VALUE does depend on this, so precision is exactly the problem.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';

/** An XY walk: x1, x2 along the bottom, y1, y2 up the side. */
function xyWalk(pts: {
  x1: [number, number];
  x2: [number, number];
  y1: [number, number];
  y2: [number, number];
}): CalibrationSession<XYAxes> {
  const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
  session.handleCalibrationClick(...pts.x1);
  session.confirmCalibrationValues(['0']);
  session.handleCalibrationClick(...pts.x2);
  session.confirmCalibrationValues(['10']);
  session.handleCalibrationClick(...pts.y1);
  session.confirmCalibrationValues(['0']);
  session.handleCalibrationClick(...pts.y2);
  session.confirmCalibrationValues(['10']);
  return session;
}

describe('the parallel-axis guard asks about the ANGLE, not about the pixels', () => {
  it('⚠️⚑⚑ refuses X and Y axes ONE PIXEL from parallel', () => {
    // Both directions run 300px to the right; the y axis rises a single pixel
    // over that span. `cross` is 300, which an absolute 1e-9 waves through, and
    // `inv2x2` then divides by it: every reading is amplified 300-fold per pixel
    // of click error while `calibrate()` answers true.
    const session = xyWalk({
      x1: [100, 400],
      x2: [400, 400],
      y1: [100, 300],
      y2: [400, 299],
    });
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/parallel/i);
  });

  it('⚠️ a SKEWED pair still calibrates - the threshold must not over-reach', () => {
    // 10 degrees between the axes is a sheared or photographed figure, ordinary
    // in a scanned paper. It reads fine, so it must not be refused.
    const rise = Math.round(300 * Math.tan((10 * Math.PI) / 180));
    const session = xyWalk({
      x1: [100, 400],
      x2: [400, 400],
      y1: [100, 300],
      y2: [400, 300 - rise],
    });
    expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
  });

  it('⚑ the same figure twice the size gets the same answer - that is the whole point', () => {
    // The old absolute threshold made this pair disagree with itself: scaling a
    // frame up multiplies `cross` by four while the ANGLE, and so the quality of
    // every reading, is untouched.
    const small = xyWalk({ x1: [100, 400], x2: [250, 400], y1: [100, 350], y2: [250, 349] });
    const large = xyWalk({ x1: [200, 800], x2: [500, 800], y1: [200, 700], y2: [500, 698] });
    expect(small.runCalibration()).toBe(false);
    expect(large.runCalibration()).toBe(false);
    expect(large.getCalibrationError()).toBe(small.getCalibrationError());
  });

  it('an ordinary right-angled calibration is untouched', () => {
    const session = xyWalk({ x1: [100, 400], x2: [400, 400], y1: [100, 400], y2: [100, 100] });
    expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
  });
});
