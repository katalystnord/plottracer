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

describe('a calibration whose values are all IDENTICAL is refused', () => {
  // A zero-length scale: every reading afterwards is the same constant
  // whatever the pixel, which is the "plausible wrong number" failure rather
  // than a visible one. Types whose calibration carries no typed value at all
  // (Ternary's three corners, Map's origin) are covered by the pixel case
  // above instead.
  const valued = ALL_TYPES.filter(([name]) => !['Ternary', 'Map'].includes(name));

  for (const [name, config] of valued) {
    it(`${name} refuses identical values on distinct pixels`, () => {
      const session = new CalibrationSession(config);
      let px = 100;
      for (let guard = 0; guard < 40; guard++) {
        const step = session.getCurrentStep();
        if (!step) break;
        px += 40;
        session.handleCalibrationClick(px, 100 + px);
        session.confirmCalibrationValues(step.valueFields.map(() => '5'));
      }
      for (const gf of config.globalFields) session.setGlobalFieldValue(gf.key, '5');
      expect(session.runCalibration()).toBe(false);
    });
  }
});

describe('a refused calibration leaves nothing usable behind', () => {
  for (const [name, config] of ALL_TYPES) {
    it(`${name} reports no axes and an error a user can read`, () => {
      const session = new CalibrationSession(config);
      expect(calibrateAllAtOnePoint(config, '1')).toBe(false);
      // Rebuilt because calibrateAllAtOnePoint uses its own session.
      const s2 = new CalibrationSession(config);
      for (let guard = 0; guard < 40; guard++) {
        const step = s2.getCurrentStep();
        if (!step) break;
        s2.handleCalibrationClick(300, 300);
        s2.confirmCalibrationValues(step.valueFields.map(() => '1'));
      }
      for (const gf of config.globalFields) s2.setGlobalFieldValue(gf.key, '1');
      s2.runCalibration();
      expect(s2.getAxes()).toBeNull();
      const err = s2.getCalibrationError();
      expect(err).toBeTruthy();
      // A refusal the user cannot act on is a defect of its own (tenet 7).
      expect(err!.length).toBeGreaterThan(20);
      void session;
    });
  }
});

describe('the healthy calibrations still succeed — the guard must not over-reach', () => {
  // Without these, every assertion above could be satisfied by an axes class
  // that refuses EVERYTHING.
  it('XY calibrates from a proper L', () => {
    const s = new CalibrationSession(XY_AXES_CONFIG);
    for (const [px, py, v] of [
      [100, 250, '0'],
      [400, 250, '10'],
      [100, 250, '0'],
      [100, 100, '10'],
    ] as Array<[number, number, string]>) {
      s.handleCalibrationClick(px, py);
      s.confirmCalibrationValues([v]);
    }
    expect(s.runCalibration()).toBe(true);
  });

  it('Bar calibrates from two distinct values', () => {
    const s = new CalibrationSession(BAR_AXES_CONFIG);
    s.handleCalibrationClick(300, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(300, 100);
    s.confirmCalibrationValues(['10']);
    expect(s.runCalibration()).toBe(true);
  });

  it('Map calibrates from a real reference length', () => {
    const s = new CalibrationSession(MAP_AXES_CONFIG);
    s.handleCalibrationClick(100, 100);
    s.confirmCalibrationValues([]);
    s.handleCalibrationClick(300, 100);
    s.confirmCalibrationValues(['10']);
    expect(s.runCalibration()).toBe(true);
  });

  it('Ternary calibrates from three distinct corners', () => {
    const s = new CalibrationSession(TERNARY_AXES_CONFIG);
    for (const [px, py] of [
      [100, 400],
      [400, 400],
      [250, 150],
    ] as Array<[number, number]>) {
      s.handleCalibrationClick(px, py);
      s.confirmCalibrationValues([]);
    }
    expect(s.runCalibration()).toBe(true);
  });
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
