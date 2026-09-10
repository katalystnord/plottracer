/**
 * ⚑⚑ THREE CORNERS ON ONE LINE ARE NOT A TRIANGLE - refused in the user's own
 * words, at the click that makes it true.
 *
 * ⚑ THE COMPANION TO USING THE THIRD CORNER (2026-09-10). While the maths read
 * only A and B, a collinear C was harmless because it was ignored; now the
 * reading is the pixel's barycentric coordinate in the clicked triangle, so a
 * triangle with no area has no reading at all and `TernaryAxes.calibrate`
 * refuses it. A model refusal alone would reach the user as *"Calibration
 * failed - check the entered data values are valid numbers"*, from
 * `buildAxes` - and a ternary calibration has NO entered values, so that
 * sentence sends them to look at fields that do not exist (tenet 7).
 *
 * ⚑⚑ NO NEW MECHANISM. `parallelAxisGuard` already asks exactly this question -
 * *are these two pixel directions parallel* - for XY, the heatmap and the bar
 * chart. A→B against A→C is the same cross product, so ternary DECLARES it and
 * supplies the one sentence that differs. The guard runs in `checkGuards`, which
 * BOTH doors consult.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, TERNARY_AXES_CONFIG } from '../calibrationSession.js';

const REFUSAL =
  'The three corners are on one line - a ternary diagram needs a triangle with area, or no pixel has a composition.';

function walk(corners: Array<[number, number]>): CalibrationSession<never> {
  const session = new CalibrationSession(TERNARY_AXES_CONFIG) as never as CalibrationSession<never>;
  const s = session as unknown as {
    handleCalibrationClick(x: number, y: number): void;
    confirmCalibrationValues(v: string[]): void;
  };
  for (const [px, py] of corners) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([]);
  }
  return session;
}

describe('a ternary diagram needs a triangle', () => {
  it('⚑⚑ refuses three corners on one line, in words about corners', () => {
    const session = walk([[100, 400], [400, 400], [250, 400]]);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toBe(REFUSAL);
  });

  it('⚠️ the refusal arrives at CALIBRATE, because a valueless walk is never checked', () => {
    // ⚠️⚑⚑ A GAP, PINNED HONESTLY RATHER THAN ASSERTED AS RIGHT (found
    // 2026-09-10). `confirmCalibrationValues` asks `problemWith` the moment the
    // walk completes - its own comment argues at length that this is the
    // earliest honest point, because David met a colour-key refusal eight steps
    // after the click that caused it. But a step with NOTHING TO TYPE never
    // reaches that path: `completeValuelessStep` places the pixel and advances,
    // with no check at all. A ternary's three corners are all valueless, so the
    // whole walk is guard-free until the button is pressed.
    // ▶ That is pattern 5 of the v2.2 list ("do refusals fire AT the gesture?")
    // and it is not ternary's to fix - it belongs to every type with a valueless
    // step. Recorded for David; this case will go red when it is fixed, which is
    // the right moment to delete it.
    const session = walk([[100, 400], [400, 400], [250, 400]]);
    expect(session.getCalibrationError()).toBeNull();
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toBe(REFUSAL);
  });

  it('⚠️ a real triangle still calibrates - the guard must not over-reach', () => {
    const session = walk([[100, 400], [400, 400], [250, 150]]);
    expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
  });

  it('a right-angled triangle is a real triangle, and reads its own corner', () => {
    // The shape the old maths could not describe is ordinary to the guard: it
    // has area, so it calibrates, and corner C reads as pure C.
    const session = walk([[100, 300], [100, 100], [300, 300]]);
    expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
    const axes = (session as unknown as { getAxes(): { pixelToData(x: number, y: number): number[] } }).getAxes();
    const [a, b, c] = axes.pixelToData(300, 300);
    expect(a).toBeCloseTo(0, 9);
    expect(b).toBeCloseTo(0, 9);
    expect(c).toBeCloseTo(100, 9);
  });
});
