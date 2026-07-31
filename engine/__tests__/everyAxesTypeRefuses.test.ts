import { describe, expect, it } from 'vitest';
import {
  XY_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  BAR_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  POLAR_AXES_CONFIG,
  SPIDER_AXES_CONFIG,
  PIE_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
  MAP_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
  CalibrationSession,
  type AxesTypeConfig,
  type CalibratedAxes,
} from '../calibrationSession.js';
import { Calibration } from '../../core/calibration.js';
import { BarAxes } from '../../core/axes/bar.js';

/**
 * ⚑⚑ EVERY graph type must be ABLE to refuse — the class-wide regression test.
 *
 * The 2026-07-31 pre-launch audit found the same defect in FOUR axes classes at
 * once: `calibrate()` returned `true` on input that made every reading null,
 * NaN or a constant 0. `MAP_AXES_CONFIG` and `TERNARY_AXES_CONFIG` even
 * CARRIED the refusal already — `if (!ok) return { error: ... }` in
 * `buildAxes` — and it could never fire, because the thing it asked could
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
 */

/** Every type the graph-type picker offers, in its own order. */
const ALL_TYPES: Array<[string, AxesTypeConfig<CalibratedAxes>]> = [
  ['XY', XY_AXES_CONFIG],
  ['Histogram', HISTOGRAM_AXES_CONFIG],
  ['Bar', BAR_AXES_CONFIG],
  ['Line (categorical)', CATEGORICAL_LINE_CONFIG],
  ['Box Plot', BOX_PLOT_AXES_CONFIG],
  ['Polar', POLAR_AXES_CONFIG],
  ['Spider / Radar', SPIDER_AXES_CONFIG],
  ['Pie / Donut', PIE_AXES_CONFIG],
  ['Ternary', TERNARY_AXES_CONFIG],
  ['Map', MAP_AXES_CONFIG],
  ['Circular Chart Recorder', CIRCULAR_CHART_RECORDER_AXES_CONFIG],
] as unknown as Array<[string, AxesTypeConfig<CalibratedAxes>]>;

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
  for (const [name, config] of ALL_TYPES) {
    it(`${name} refuses it, rather than reporting success`, () => {
      // Not about the wording — about the answer. A type that says yes here
      // has an axes class that cannot fail, which is the defect this file
      // exists to catch.
      expect(calibrateAllAtOnePoint(config, '1')).toBe(false);
    });
  }
});

/**
 * A NON-DEGENERATE pixel layout for each type — a real L for XY, a real
 * triangle for Ternary, three distinct radii for Polar, and so on.
 *
 * ⚑ WHY THIS TABLE EXISTS. The first version of this file walked every click
 * along one diagonal. For XY that trips `parallelAxisGuard` before any VALUE
 * is read, so the "identical values are refused" case passed without ever
 * testing values — and the property it claimed was false: XY happily accepted
 * two identical X values and read one constant forever. The round-2 audit
 * fleet caught it. A degenerate-input test must be degenerate in exactly ONE
 * way, or it proves nothing about the way it names.
 */
const HEALTHY_PIXELS: Record<string, Array<[number, number]>> = {
  XY: [[100, 400], [500, 400], [100, 400], [100, 100]],
  Histogram: [[100, 400], [500, 400], [100, 400], [100, 100]],
  Bar: [[300, 500], [300, 100]],
  'Line (categorical)': [[300, 500], [300, 100]],
  'Box Plot': [[300, 500], [300, 100]],
  Polar: [[300, 300], [400, 300], [500, 300]],
  'Spider / Radar': [[300, 300], [450, 300], [300, 150], [150, 300]],
  'Pie / Donut': [[450, 300], [300, 450], [150, 300], [300, 150], [406, 406]],
  Ternary: [[100, 400], [400, 400], [250, 150]],
  Map: [[100, 100], [300, 100]],
  'Circular Chart Recorder': [[300, 300], [300, 240], [300, 180], [360, 300], [300, 420]],
};

/** Click `config`'s steps at the healthy pixels, giving every value `value`. */
function calibrateAt(
  name: string,
  config: AxesTypeConfig<CalibratedAxes>,
  value: string
): CalibrationSession<CalibratedAxes> {
  const session = new CalibrationSession(config);
  const pixels = HEALTHY_PIXELS[name]!;
  for (let i = 0; i < 40; i++) {
    const step = session.getCurrentStep();
    if (!step) break;
    const [px, py] = pixels[Math.min(i, pixels.length - 1)]!;
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues(step.valueFields.map(() => value));
  }
  for (const gf of config.globalFields) session.setGlobalFieldValue(gf.key, value);
  return session;
}

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
  const valued = ALL_TYPES.filter(([name]) => !['Ternary', 'Map', 'Pie / Donut'].includes(name));

  for (const [name, config] of valued) {
    it(`${name} refuses identical values on a healthy pixel layout`, () => {
      expect(calibrateAt(name, config, '5').runCalibration()).toBe(false);
    });
  }
});

describe('the healthy calibrations still succeed — the guard must not over-reach', () => {
  // ⚑ EVERY type, not a sample. The first version pinned only four, so a
  // `return false` planted in any of the other seven classes would have passed
  // all of this file's refusal assertions. An anti-vacuity control that covers
  // part of the set leaves the rest of the set unproven.
  const ascending = (name: string, i: number): string => {
    // Distinct, ascending, positive values -- valid for a log scale too, and
    // for a radius. Pie/CCR take their own globals below.
    void name;
    return String((i + 1) * 10);
  };

  for (const [name, config] of ALL_TYPES) {
    it(`${name} calibrates from healthy pixels and distinct values`, () => {
      const session = new CalibrationSession(config);
      const pixels = HEALTHY_PIXELS[name]!;
      let n = 0;
      for (let i = 0; i < 40; i++) {
        const step = session.getCurrentStep();
        if (!step) break;
        const [px, py] = pixels[Math.min(i, pixels.length - 1)]!;
        session.handleCalibrationClick(px, py);
        session.confirmCalibrationValues(step.valueFields.map(() => ascending(name, n++)));
      }
      for (const gf of config.globalFields) session.setGlobalFieldValue(gf.key, '100');
      expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
    });
  }
});

describe('the model refuses on its own, not only through the session', () => {
  it('⚑ BarAxes.calibrate answers false — the file-load door depends on it', () => {
    // `core/plotData.ts` calls calibrate() directly when opening a project and
    // never inspects the session. If the refusal lived only in the session,
    // every one of these would open clean and read a constant.
    const cal = new Calibration(2);
    cal.addPoint(300, 300, '0', '5');
    cal.addPoint(300, 300, '0', '5');
    expect(new BarAxes().calibrate(cal, false, false)).toBe(false);
  });
});
