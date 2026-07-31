import { describe, expect, it } from 'vitest';
import {
  BAR_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  CalibrationSession,
} from '../calibrationSession.js';
import { Calibration } from '../../core/calibration.js';
import { BarAxes } from '../../core/axes/bar.js';

/**
 * A bar's VALUE — the sign convention — and the file-load door that refuses a
 * calibration which cannot produce one.
 *
 * ⚑ WHY THIS FILE EXISTS. Two of the hottest unnoticed lines in
 * `calibrationSession.ts` live here: `barCalibrationValueCheck` (15 mutants,
 * the most of any single line in the file) and Histogram's own
 * `derivedTupleValue` (10). Both were added or last touched in the v2.0 work,
 * and both decide a NUMBER that reaches the export.
 *
 * `barCalibrationValueCheck` is the mirror of the refusal
 * `BarAxes.calibrate()` performs — declared on the config so a LOADED FILE
 * meets it too, because `plotData.deserialize` calls `calibrate()` directly
 * and never inspects its return value. The axes-level half was pinned when it
 * was written; this is the config-level half, on all three types that share
 * it.
 */

/** A Calibration carrying two bar reference values (both in `dy`). */
function barCal(v1: string, v2: string): Calibration {
  const cal = new Calibration(2);
  cal.addPoint(300, 500, '0', v1);
  cal.addPoint(300, 100, '0', v2);
  return cal;
}

describe('barCalibrationValueCheck — the refusal a LOADED file must also meet', () => {
  // All three types share BarAxes and therefore share this check.
  const sharing = [
    ['Bar', BAR_AXES_CONFIG],
    ['Line (categorical)', CATEGORICAL_LINE_CONFIG],
    ['Box Plot', BOX_PLOT_AXES_CONFIG],
  ] as const;

  for (const [name, config] of sharing) {
    it(`${name}: refuses two reference points with the SAME value`, () => {
      // A zero-scale calibration: every bar afterwards reads back that one
      // constant, whatever its height. Silently plausible, never right.
      const refusal = config.checkValues!(barCal('5', '5'), {}, {});
      expect(refusal).toBeTruthy();
      expect(refusal).toMatch(/same value/i);
    });

    it(`${name}: refuses a non-positive endpoint on a LOG value scale`, () => {
      const zero = config.checkValues!(barCal('0', '100'), { isLog: 'true' }, {});
      expect(zero).toBeTruthy();
      expect(zero).toMatch(/log/i);
      expect(config.checkValues!(barCal('-1', '100'), { isLog: 'true' }, {})).toBeTruthy();
    });

    it(`${name}: ACCEPTS the same non-positive values when the scale is linear`, () => {
      // ⚑ The log guard must be conditional on the option. Mutated to
      // unconditional it would refuse an ordinary bar chart whose baseline is
      // zero -- which is the most natural calibration there is.
      expect(config.checkValues!(barCal('0', '100'), { isLog: 'false' }, {})).toBeNull();
      expect(config.checkValues!(barCal('-50', '50'), {}, {})).toBeNull();
    });

    it(`${name}: accepts an ordinary healthy calibration`, () => {
      expect(config.checkValues!(barCal('0', '10'), {}, {})).toBeNull();
      expect(config.checkValues!(barCal('1', '1000'), { isLog: 'true' }, {})).toBeNull();
    });
  }

  it('stays silent about values it cannot parse, leaving those to the parser', () => {
    // Non-numeric input is BarAxes.calibrate's refusal (routed through
    // InputParser), not this one's -- the `Number.isFinite` gate is what keeps
    // the two from reporting the same fault twice with different words.
    expect(BAR_AXES_CONFIG.checkValues!(barCal('abc', '10'), {}, {})).toBeNull();
  });

  it("Bar's own baseline check still fires alongside the shared one", () => {
    // BAR_AXES_CONFIG composes both; the shared check must not have displaced
    // its own.
    const bad = BAR_AXES_CONFIG.checkValues!(barCal('0', '10'), { hasBaseline: 'true', baselineValue: 'abc' }, {});
    expect(bad).toMatch(/baseline/i);
  });
});

/** A calibrated Bar session: P1=0 @ y=500, P2=10 @ y=100, so 40px == 1 unit. */
function calibratedBar(): CalibrationSession<BarAxes> {
  const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** The derived value of the tuple just captured by a drag from y0 to y1. */
function barValue(s: CalibrationSession<BarAxes>, x: number, y0: number, y1: number): number | null {
  s.addDataPoint(x, y0);
  s.addDataPoint(x, y1);
  const rows = s.getTupleRows();
  return rows[rows.length - 1]!.derived;
}

describe("a bar's value — the sign convention", () => {
  it('measures from the declared BASELINE to the far end, not between the corners', () => {
    // Default: baseline shared at 0. A bar drawn from the baseline up to 5
    // reads 5 whichever end was dragged first.
    const up = calibratedBar();
    expect(barValue(up, 150, 500, 300)).toBeCloseTo(5, 6);

    const down = calibratedBar();
    expect(barValue(down, 150, 300, 500)).toBeCloseTo(5, 6);
  });

  it('⚑ reads a bar BELOW the baseline as negative, from its VALUE not its pixel', () => {
    // The documented trap: a pixel-position rule ("smaller y is the far end")
    // is exactly backwards for a bar below baseline. pixelToData already
    // encodes orientation and log scale, so comparing VALUES needs no
    // reversal -- and that is what these two cases together pin.
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    s.handleCalibrationClick(300, 300); // 0 at the MIDDLE of the image
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(300, 100); // 10 above it
    s.confirmCalibrationValues(['10']);
    expect(s.runCalibration()).toBe(true);

    expect(barValue(s, 150, 300, 200)).toBeCloseTo(5, 6); // above the baseline
    expect(barValue(s, 200, 300, 400)).toBeCloseTo(-5, 6); // below it
  });

  it('measures from a NON-ZERO declared baseline', () => {
    const s = calibratedBar();
    s.setOption('baselineValue', '2');
    // A bar whose far end is at 5, against a baseline of 2, spans 3.
    expect(barValue(s, 150, 500, 300)).toBeCloseTo(3, 6);
  });

  it('⚑ a FLOATING bar (no baseline) takes its direction from the drag order', () => {
    // With no baseline there is no reference to sign against, so the recorded
    // click order carries the meaning -- and reversing the drag reverses the
    // sign. A tornado chart or a temperature range depends on this.
    const up = calibratedBar();
    up.setOption('hasBaseline', 'false');
    expect(barValue(up, 150, 400, 200)).toBeCloseTo(5, 6);

    const down = calibratedBar();
    down.setOption('hasBaseline', 'false');
    expect(barValue(down, 150, 200, 400)).toBeCloseTo(-5, 6);
  });

  it('⚑ a STACKED segment reads as an unsigned SPAN, bypassing the baseline entirely', () => {
    // v2.0 Phase 5: a stacked segment's near end is never the chart's
    // baseline -- not even the bottommost layer -- so its value is its own
    // contribution, and a contribution to a stack is never negative.
    const s = calibratedBar();
    s.setDatasetStackGroup(0, 'A');
    expect(barValue(s, 150, 400, 200)).toBeCloseTo(5, 6);
    expect(barValue(s, 200, 200, 400)).toBeCloseTo(5, 6); // same span, drag reversed
  });

  it('has NO value for a half-dragged bar, rather than guessing one', () => {
    const s = calibratedBar();
    s.addDataPoint(150, 500); // one corner only
    expect(s.getTupleRows()[0]!.derived).toBeNull();
  });
});

describe("a histogram bin's value", () => {
  it('reads the bin HEIGHT, averaging the two top corners', () => {
    // ⚑ Histogram's derivedTupleValue is its OWN (10 unnoticed mutants): a
    // bin's two slots are its TOP corners, so the value is their averaged
    // height -- NOT the opposite-corner extent a bar uses. Feeding it true
    // opposite corners would average the top edge with the baseline and
    // silently halve every reading.
    const s = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    s.handleCalibrationClick(100, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(500, 500);
    s.confirmCalibrationValues(['10']);
    s.handleCalibrationClick(100, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(100, 100);
    s.confirmCalibrationValues(['10']);
    expect(s.runCalibration()).toBe(true);

    // Both corners at y=300 -> exactly halfway up a 0..10 scale.
    s.addDataPoint(150, 300);
    s.addDataPoint(250, 300);
    expect(s.getTupleRows()[0]!.derived).toBeCloseTo(5, 6);
  });

  it('averages two corners at DIFFERENT heights rather than taking either', () => {
    // The average is what halves a hand-click error; taking one corner would
    // pass a same-height fixture and fail here.
    const s = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    s.handleCalibrationClick(100, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(500, 500);
    s.confirmCalibrationValues(['10']);
    s.handleCalibrationClick(100, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(100, 100);
    s.confirmCalibrationValues(['10']);
    expect(s.runCalibration()).toBe(true);

    s.addDataPoint(150, 340); // value 4
    s.addDataPoint(250, 260); // value 6
    expect(s.getTupleRows()[0]!.derived).toBeCloseTo(5, 6);
  });

  it('has no height for a bin with only one corner placed', () => {
    const s = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    s.handleCalibrationClick(100, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(500, 500);
    s.confirmCalibrationValues(['10']);
    s.handleCalibrationClick(100, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(100, 100);
    s.confirmCalibrationValues(['10']);
    expect(s.runCalibration()).toBe(true);
    s.addDataPoint(150, 300);
    expect(s.getTupleRows()[0]!.derived).toBeNull();
  });
});

describe('a log-scale bar reads its value through the log axis', () => {
  it('spans a decade correctly rather than linearly', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    s.setOption('isLog', 'true');
    s.setOption('baselineValue', '1');
    s.handleCalibrationClick(300, 500);
    s.confirmCalibrationValues(['1']);
    s.handleCalibrationClick(300, 100);
    s.confirmCalibrationValues(['1000']);
    expect(s.runCalibration()).toBe(true);

    // Halfway up three decades is 10^1.5; against a baseline of 1 the span is
    // that minus 1. A linear read would give ~500.
    const v = barValue(s, 150, 500, 300)!;
    expect(v).toBeCloseTo(Math.pow(10, 1.5) - 1, 3);
  });
});
