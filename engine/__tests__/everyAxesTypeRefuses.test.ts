import { describe, expect, it } from 'vitest';
import {
  ALL_AXES_TYPE_CONFIGS,
  CalibrationSession,
  type AxesTypeConfig,
  type CalibratedAxes,
} from '../calibrationSession.js';
import { Calibration } from '../../core/calibration.js';
import { BarAxes } from '../../core/axes/bar.js';
import { ALL_TYPES, labelOf, clickHealthy, calibratedHealthy } from './fixtures/anyType.js';

/**
 * ⚑⚑ EVERY graph type must be ABLE to refuse - the class-wide regression test.
 *
 * The 2026-07-31 pre-launch audit found the same defect in FOUR axes classes at
 * once: `calibrate()` returned `true` on input that made every reading null,
 * NaN or a constant 0. `MAP_AXES_CONFIG` and `TERNARY_AXES_CONFIG` even
 * CARRIED the refusal already - `if (!ok) return { error: ... }` in
 * `buildAxes` - and it could never fire, because the thing it asked could
 * never answer no. A check that did not run looks exactly like a check that
 * passed.
 *
 * Each class was fixed and pinned individually. This file is the guard against
 * the SHAPE coming back: it walks every type the picker offers and asserts
 * that a degenerate calibration is refused. A future axes class that forgets
 * to validate fails here on the day it is added, rather than in a survey
 * months later.
 *
 * ⚑ It is deliberately about the ANSWER, not the words: each type phrases its
 * refusal differently and should. What must never happen is `true` on input
 * that cannot produce a reading.
 *
 * ⚠️⚠️ THIS FILE SAID "EVERY" AND MEANT ELEVEN (found 2026-08-17, v2.2 audit
 * pass 4). The list above was hand-written, so the HEATMAP - the largest type
 * this project has built - was never asked whether it can refuse anything, for
 * the whole of v2.2, green throughout. That is A6 (`axesConfigTable.test.ts`
 * listing eleven of twelve) arriving in a SECOND file: pass 1 fixed the
 * instance and nobody swept for the shape, which is precisely what
 * "a found bug is a search query, not a ticket closed" warns about.
 * ⚑ A hand-maintained list does not grow when you add a type. So this now
 * iterates `ALL_AXES_TYPE_CONFIGS` (via `fixtures/anyType.ts`), and a type with
 * no declared pixel layout FAILS rather than being skipped.
 */

/**
 * Click every calibration step of `config` at ONE pixel, giving every value
 * field the same text.
 *
 * One pixel for every point is the most degenerate input a calibration can
 * have: no axis has a direction, no circle has a radius, no scale has a
 * length. Whatever a type measures, it cannot measure it from this.
 */
function calibrateAllAtOnePoint(config: AxesTypeConfig<CalibratedAxes>, value: string): boolean {
  const session = new CalibrationSession(config);
  for (let guard = 0; guard < 40; guard++) {
    const step = session.getCurrentStep();
    if (!step) break;
    session.handleCalibrationClick(300, 300);
    session.confirmCalibrationValues(step.valueFields.map(() => value));
  }
  for (const gf of config.globalFields) session.setGlobalFieldValue(gf.key, value);
  return session.runCalibration();
}

describe('a calibration with every point on ONE pixel is refused', () => {
  for (const [id, config] of ALL_TYPES) {
    const name = labelOf(id);
    it(`${name} refuses it, rather than reporting success`, () => {
      // Not about the wording - about the answer. A type that says yes here
      // has an axes class that cannot fail, which is the defect this file
      // exists to catch.
      expect(calibrateAllAtOnePoint(config, '1')).toBe(false);
    });
  }
});

/** Click `config`'s steps at the healthy pixels, giving every value `value`. */
const calibrateAt = (
  id: string,
  config: AxesTypeConfig<CalibratedAxes>,
  value: string
): CalibrationSession<CalibratedAxes> => clickHealthy(id, config, () => value, value);

describe('a calibration whose values are all IDENTICAL is refused', () => {
  // A zero-length scale: every reading afterwards is the same constant whatever
  // the pixel, which is the "plausible wrong number" failure rather than a
  // visible one. The PIXELS here are healthy, so only the values are wrong --
  // that is what makes this a test about values.
  //
  // Ternary, Map and Pie carry no typed value on their calibration CLICKS at
  // all -- three corners; an origin and a length; a ring of outline points
  // whose total and sweep are separate global fields. "Identical values" has
  // no meaning for them, so the all-on-one-pixel case above is their test.
  const VALUELESS_CLICKS = ['ternary', 'map', 'pie'];
  const valued = ALL_TYPES.filter(([id]) => !VALUELESS_CLICKS.includes(id));

  it('is not vacuous - the exclusions above name types that EXIST', () => {
    // ⚑ An exclusion list keyed by a string nobody checks is how a filter goes
    // quiet: rename a type's id and the exclusion silently stops matching (or,
    // worse, keeps matching nothing while reading as deliberate).
    const ids = ALL_AXES_TYPE_CONFIGS.map((c) => c.id);
    for (const id of VALUELESS_CLICKS) expect(ids).toContain(id);
    expect(valued.length).toBe(ALL_TYPES.length - VALUELESS_CLICKS.length);
  });

  for (const [id, config] of valued) {
    it(`${labelOf(id)} refuses identical values on a healthy pixel layout`, () => {
      expect(calibrateAt(id, config, '5').runCalibration()).toBe(false);
    });
  }
});

describe('the healthy calibrations still succeed - the guard must not over-reach', () => {
  // ⚑ EVERY type, not a sample. The first version pinned only four, so a
  // `return false` planted in any of the other seven classes would have passed
  // all of this file's refusal assertions. An anti-vacuity control that covers
  // part of the set leaves the rest of the set unproven.
  for (const [id, config] of ALL_TYPES) {
    it(`${labelOf(id)} calibrates from healthy pixels and distinct values`, () => {
      // ⚑ `calibratedHealthy` asserts the success itself - distinct ascending
      // values (10, 20, 30…), valid on a log scale and as a radius - and reports
      // the type's own refusal message if it says no.
      calibratedHealthy(id, config);
    });
  }
});

describe('the model refuses on its own, not only through the session', () => {
  it('⚑ BarAxes.calibrate answers false - the file-load door depends on it', () => {
    // `core/plotData.ts` calls calibrate() directly when opening a project and
    // never inspects the session. If the refusal lived only in the session,
    // every one of these would open clean and read a constant.
    const cal = new Calibration(2);
    cal.addPoint(300, 300, '0', '5');
    cal.addPoint(300, 300, '0', '5');
    expect(new BarAxes().calibrate(cal, false, false)).toBe(false);
  });
});
