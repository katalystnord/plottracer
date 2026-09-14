/**
 * ⚑⚑ WHAT 0.01 COSTS AND WHAT IT BUYS, MEASURED RATHER THAN ASSERTED.
 *
 * `8df7137` changed `parallelAxisGuard` from an absolute cross product against
 * `1e-9` to `|sin(theta)| < 0.01`, and that is the one change in the four
 * commits that can NEWLY REFUSE a calibration a user had working. It reaches
 * every type declaring the guard: XY, Histogram (borrowed), Heatmap, Bar, Box
 * Plot, Candlestick, Stacked, Span (borrowed), categorical Line and Ternary.
 *
 * ⚑ The commit justifies the number in a COMMENT - *"one pixel moves a reading
 * by tens of units on a 0..100 scale"* and *"a badly distorted photograph sits
 * at tens of degrees"*. Both are checkable, so they are checked here instead of
 * being taken on trust (gate 3: a comment may not assert what nothing enforces).
 *
 * ⚑ AND THE LOAD DOOR IS THE ONE THAT MATTERS FOR A CHANGE OF THRESHOLD. A
 * project saved before today whose frame lands in the newly refused band must
 * still OPEN, with its points on screen and the reason beside them -
 * `loadCalibrated`'s standing decision, *"Visible and recoverable beats silent
 * and pristine"*. Refusing to open would strand a user's work over a rule that
 * changed under them.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';
import { Dataset } from '../../core/dataset.js';

/** An XY walk: x1, x2 along the bottom, y1, y2 up the side, 0..100 on both. */
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
  session.confirmCalibrationValues(['100']);
  session.handleCalibrationClick(...pts.y1);
  session.confirmCalibrationValues(['0']);
  session.handleCalibrationClick(...pts.y2);
  session.confirmCalibrationValues(['100']);
  return session;
}

/** A frame 300px wide whose Y axis leans `degrees` away from the X axis. */
function frameAt(degrees: number, nudgeY2 = 0) {
  const rise = 300 * Math.tan((degrees * Math.PI) / 180);
  return xyWalk({
    x1: [100, 400],
    x2: [400, 400],
    y1: [100, 300],
    y2: [400, 300 - rise + nudgeY2],
  });
}

/** What one pixel of click error on Y2 is worth, in data units, at `degrees`. */
function unitsPerPixelOfClickError(degrees: number): number {
  const clean = frameAt(degrees);
  const nudged = frameAt(degrees, 1);
  expect(clean.runCalibration(), clean.getCalibrationError() ?? 'no error').toBe(true);
  expect(nudged.runCalibration(), nudged.getCalibrationError() ?? 'no error').toBe(true);
  const at = (s: CalibrationSession<XYAxes>) => s.getAxes()!.pixelToData(250, 250);
  const a = at(clean);
  const b = at(nudged);
  return Math.max(Math.abs(a[0]! - b[0]!), Math.abs(a[1]! - b[1]!));
}

describe('the parallel-axis threshold, measured', () => {
  it('⚑⚑ just INSIDE the band a reading is worthless - tens of units per pixel', () => {
    // 1.2 degrees between the two axes is sin ~ 0.021 - TWICE the refusal, so
    // both the clean frame and the one-pixel-off one still calibrate and the
    // cost can be measured on the permitted side of the line. This is the
    // number the commit's comment claims, measured where the guard allows it.
    const cost = unitsPerPixelOfClickError(1.2);
    expect(cost, `one pixel is worth ${cost.toFixed(1)} units of a 0..100 scale`).toBeGreaterThan(10);
  });

  it('⚑⚑ a badly distorted photograph is thousands of times clear of it', () => {
    // 20 degrees off square is a sheared scan or a photograph taken at an angle.
    const cost = unitsPerPixelOfClickError(70);
    expect(cost, `one pixel is worth ${cost.toFixed(3)} units at 20 degrees`).toBeLessThan(1);
    // And it calibrates, which is the half that says the guard does not
    // over-reach into figures people really have.
    expect(frameAt(70).runCalibration()).toBe(true);
  });

  it('⚑ every plausible frame from square to 45 degrees of shear calibrates', () => {
    // The sweep the "find a real geometry it now refuses" question asks for. A
    // pair of axes within half a degree of each other is not a figure anyone
    // digitizes; everything from there to 45 degrees of shear must pass.
    for (let off = 1; off <= 45; off += 1) {
      const s = frameAt(90 - off);
      expect(s.runCalibration(), `${off} degrees off square: ${s.getCalibrationError()}`).toBe(true);
    }
  });

  it('⚠️⚑⚑ a project saved before the change still OPENS, with the reason beside it', () => {
    // The door a changed threshold actually threatens. The file carries a BUILT
    // axes, so it is built the way the load path does - `calibrate()` directly,
    // never through the click walk, which is the entrance `loadGuards` covers.
    const cal = new Calibration(2);
    for (const [px, py, dx, dy] of [
      [100, 400, '0', '0'],
      [400, 400, '100', '0'],
      [100, 300, '0', '0'],
      [400, 299, '0', '100'],
    ] as Array<[number, number, string, string]>) {
      cal.addPoint(px, py, dx, dy);
    }
    const axes = new XYAxes();
    // The premise the guards exist for: the axes class is perfectly happy.
    expect(axes.calibrate(cal, false, false, false)).toBe(true);

    // And the click path refuses the identical frame today, which is what makes
    // this a project that opened yesterday and would not be built now.
    const walked = xyWalk({ x1: [100, 400], x2: [400, 400], y1: [100, 300], y2: [400, 299] });
    expect(walked.runCalibration(), 'the fixture is not in the refused band').toBe(false);

    const reopened = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    const ds = new Dataset(2);
    ds.addPixel(250, 250);
    reopened.loadCalibrated(axes, [ds]);
    expect(reopened.getAxes(), 'the axes were refused at the load door').not.toBeNull();
    expect(reopened.getDataPoints(), 'the user\'s points were stranded').toHaveLength(1);
    expect(reopened.getCalibrationError(), 'and it opened with no reason on screen').toMatch(/parallel/i);
  });
});
