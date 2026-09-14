/**
 * ⚑⚑ A POLAR FIGURE DECLARED TILTED IS READ THROUGH A FRAME IT MEASURES, AND
 * EVERY REFUSAL ON THAT PATH HAS TO ASK A QUESTION THE FRAME ACTUALLY ANSWERS.
 *
 * Three cases carried out of the 2026-09-11/12 audit into v2.5.1. They are named
 * for the CASE, not for the function, because a config and a model both answer
 * here and which one does is an implementation detail to the person walking it.
 *
 * ⚑ The walk and a REOPENED project are two entrances, and both are exercised:
 * `runCalibration` and `loadCalibrated` each consult `checkGuards`, while an
 * importer reaches `PolarAxes.calibrate` with neither - so the model carries its
 * own copy of the frame refusals and that copy is tested through the class.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, POLAR_AXES_CONFIG } from '../calibrationSession.js';
import { PolarAxes } from '../../core/axes/polar.js';
import { Calibration } from '../../core/calibration.js';
import { Dataset } from '../../core/dataset.js';

const O = { x: 300, y: 300 };

/** The tilted walk: centre value, then P1 (r, θ), then P2 (r, θ). */
function tiltedWalk(
  centre: string,
  p1: [number, number],
  v1: [string, string],
  p2: [number, number],
  v2: [string, string],
  { log = false } = {}
): CalibrationSession<PolarAxes> {
  const session = new CalibrationSession(POLAR_AXES_CONFIG);
  session.setOption('isCircular', 'false');
  if (log) session.setOption('isLogR', 'true');
  session.handleCalibrationClick(O.x, O.y);
  session.confirmCalibrationValues([centre]);
  session.handleCalibrationClick(p1[0], p1[1]);
  session.confirmCalibrationValues(v1);
  session.handleCalibrationClick(p2[0], p2[1]);
  session.confirmCalibrationValues(v2);
  return session;
}

/** A point `deg` round from due east of the origin, `px` pixels out. */
function onRay(deg: number, px: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [O.x + px * Math.cos(rad), O.y - px * Math.sin(rad)];
}

/** The load entrance: the axes built the way `plotData.deserialize` builds it,
 *  handed to a session without a single click. */
function reopened(points: Array<[number, number, string, string]>, { log = false } = {}) {
  const cal = new Calibration(2);
  for (const [px, py, dx, dy] of points) cal.addPoint(px, py, dx, dy);
  const axes = new PolarAxes();
  const calibrated = axes.calibrate(cal, true, false, log, false);
  const session = new CalibrationSession(POLAR_AXES_CONFIG);
  session.loadCalibrated(axes, [new Dataset(2)]);
  return { calibrated, error: session.getCalibrationError() };
}

describe('a tilted figure whose two clicks land at the same distance from the centre', () => {
  /**
   * ⚑ THIS ONE DID NOT REPRODUCE (measured 2026-09-15), and the guarantee is
   * pinned rather than "fixed". `radialDistinctGuard.skipWhen` already answers
   * `!isCircular`; what had never been pinned is that the OTHER entrance reaches
   * the same answer, which it does only because `extractOptions` carries
   * `isCircular` back off the axes object. Drop that one line and a reopened
   * project is refused while the walk that produced it was accepted.
   */
  it('⚑⚑ is accepted when the project is REOPENED, not only when it is clicked', () => {
    // A 2:1 squash: r=50 at 0° lands 100px east, r=100 at 90° lands 100px south.
    const { calibrated, error } = reopened([
      [O.x, O.y, '0', ''],
      [O.x + 100, O.y, '50', '0'],
      [O.x, O.y + 100, '100', '90'],
    ]);
    expect(calibrated).toBe(true);
    expect(error).toBeNull();
  });
});

describe('a tilted figure on a log radial axis', () => {
  /**
   * ⚠️ MEASURED 2026-09-15: the walk instructed the one value that cannot work.
   * The origin step showed the linear prompt, "enter the radial value there
   * (usually 0)", and a centre of 0 on a log radial axis has no logarithm - so
   * the frame could not be built and the user was told "Calibration failed -
   * check the entered data values are valid numbers" about values that were all
   * perfectly good numbers. A prompt that leads the user into a refusal is a UX
   * defect, and tenet 7 says a UX defect is a defect.
   */
  it('⚠️⚑⚑ does not suggest 0 at the centre - a log radial axis never reaches it', () => {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    session.setOption('isCircular', 'false');
    session.setOption('isLogR', 'true');
    const origin = session.getSteps().find((st) => st.key === 'origin')!;
    expect(origin.prompt).not.toMatch(/usually 0/i);
    expect(origin.prompt).toMatch(/greater than zero/i);
  });

  it('⚠️ still suggests 0 when the radial axis is LINEAR - the prompt must not lose the ordinary case', () => {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    session.setOption('isCircular', 'false');
    const origin = session.getSteps().find((st) => st.key === 'origin')!;
    expect(origin.prompt).toMatch(/usually 0/i);
  });

  it('⚠️⚑⚑ refuses a centre of 0 in words about the log radial axis', () => {
    const session = tiltedWalk('0', onRay(0, 100), ['10', '0'], onRay(90, 100), ['100', '90'], { log: true });
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/log radial/i);
    expect(session.getCalibrationError()).not.toMatch(/valid numbers/i);
  });

  it('refuses a BLANK centre for the same reason, in the same words - blank means 0', () => {
    // ⚑ Through the LOAD entrance, because that is the only one that can carry a
    // blank: the walk's "r at centre" is a required field, so a click-path
    // fixture with an empty value never completes the step at all. A file
    // written before the Log radial box was ticked carries exactly this.
    const { error } = reopened(
      [
        [O.x, O.y, '', ''],
        [O.x + 100, O.y, '10', '0'],
        [O.x, O.y + 100, '100', '90'],
      ],
      { log: true }
    );
    expect(error).toMatch(/log radial/i);
  });

  it('⚑ the same refusal meets a REOPENED project', () => {
    const { error } = reopened(
      [
        [O.x, O.y, '0', ''],
        [O.x + 100, O.y, '10', '0'],
        [O.x, O.y + 100, '100', '90'],
      ],
      { log: true }
    );
    expect(error).toMatch(/log radial/i);
  });

  it('⚠️ a POSITIVE centre still calibrates and reads its own points back', () => {
    const session = tiltedWalk('1', onRay(0, 100), ['10', '0'], onRay(90, 100), ['100', '90'], { log: true });
    expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
    const axes = session.getAxes()!;
    expect(axes.pixelToData(O.x + 100, O.y)[0]).toBeCloseTo(10, 6);
    expect(axes.pixelToData(O.x, O.y + 100)[0]).toBeCloseTo(100, 6);
  });

  it('⚠️ a BLANK centre is still fine on a LINEAR radial axis - it means 0 there', () => {
    // The over-reach case for the refusal above: the same blank, read off the
    // same entrance, on a radial axis that can reach 0.
    const { calibrated, error } = reopened([
      [O.x, O.y, '', ''],
      [O.x + 100, O.y, '50', '0'],
      [O.x, O.y + 100, '100', '90'],
    ]);
    expect(calibrated).toBe(true);
    expect(error).toBeNull();
  });
});

describe('a tilted figure whose two angles are nearly the same angle', () => {
  /**
   * ⚠️ MEASURED 2026-09-15, and the numbers are the finding: with the two
   * declared angles a hundredth of a degree apart, a figure whose own radii are
   * 50 and 100 read 143,264 at a mid-figure pixel, and `calibrate()` reported
   * success. At a ten-thousandth of a degree it read 14 million.
   *
   * ⚑ The check existed and could not fire. It compared `|sin(θ2 - θ1)|` - the
   * right, scale-free quantity - against 1e-9, which is 5.7e-8 degrees: exact
   * degeneracy and nothing else. Same shape as `parallelAxisGuard`'s absolute
   * epsilon, and fixed with the same threshold and the same reasoning, since
   * sensitivity to a click goes as 1/sin and at 0.57 degrees one pixel is
   * already worth tens of units on a 0..100 scale.
   */
  it('⚠️⚑⚑ refuses two angles a hundredth of a degree apart', () => {
    const session = tiltedWalk('0', onRay(0, 100), ['50', '0'], onRay(0.01, 100), ['100', '0.01']);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/same line through the centre/i);
  });

  it('⚠️ and refuses a full degree apart, where the reading is still nonsense', () => {
    const session = tiltedWalk('0', onRay(0, 100), ['50', '0'], onRay(0.4, 100), ['100', '0.4']);
    expect(session.runCalibration()).toBe(false);
  });

  it('⚠️ a 30-degree spread still calibrates - the guard must not over-reach', () => {
    const session = tiltedWalk('0', onRay(0, 100), ['50', '0'], onRay(30, 120), ['100', '30']);
    expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
  });

  it('⚑ the MODEL refuses it too, which is the entrance an importer uses', () => {
    // Importers build a `Calibration` and call `calibrate` directly; they never
    // run `checkGuards`, so a refusal that lives only on the config is no
    // refusal at all for a foreign file.
    const cal = new Calibration(2);
    cal.addPoint(O.x, O.y, '0', '');
    const [p1x, p1y] = onRay(0, 100);
    cal.addPoint(p1x, p1y, '50', '0');
    const [p2x, p2y] = onRay(0.01, 100);
    cal.addPoint(p2x, p2y, '100', '0.01');
    expect(new PolarAxes().calibrate(cal, true, false, false, false)).toBe(false);
  });
});

describe('a tilted figure whose measured frame has collapsed onto a line', () => {
  /**
   * ⚑ THE OTHER WAY THE SAME QUESTION ARRIVES. The two declared angles can be a
   * clean 90 degrees apart while the two CLICKS sit almost on one line through
   * the centre - a figure drawn edge-on. The frame those clicks measure then
   * maps the whole plane onto a line, and `det === 0` catches only the exactly
   * edge-on case while everything beside it calibrates and reads amplified
   * nonsense. Normalising the determinant by its own column lengths asks for the
   * angle between the frame's two directions, which is the scale-free form of
   * the question `det === 0` was reaching for.
   */
  it('⚠️⚑⚑ is refused, though the two ANGLES are a clean quarter turn apart', () => {
    const session = tiltedWalk('0', [O.x + 100, O.y], ['50', '0'], [O.x + 200, O.y + 0.5], ['100', '90']);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toBeTruthy();
  });

  it('⚠️ a strongly squashed but readable figure still calibrates', () => {
    // A 4:1 squash, which is an ordinary tilted or photographed polar plot: the
    // frame's two directions are still square to each other, so nothing here is
    // near-singular and the guard must keep its hands off.
    const session = tiltedWalk('0', [O.x + 200, O.y], ['50', '0'], [O.x, O.y + 50], ['100', '90']);
    expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
  });
});
