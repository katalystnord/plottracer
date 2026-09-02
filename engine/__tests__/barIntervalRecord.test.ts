import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CalibrationSession, BAR_AXES_CONFIG, SPAN_AXES_CONFIG } from '../calibrationSession.js';
import { buildExportSections, buildExportJson } from '../exportAssembly.js';
import type { ExportAssemblyInput } from '../exportAssembly.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ A BAR'S TWO ENDS, IN THE FILE - `Min` and `Max`, smallest first (v2.3).
 *
 * David, driving the built app on `samples/bar-floating-temperature`: the panel's
 * `Value` column reported -7.95 for January (-8..2) and 15 for April (3..15).
 * A MINIMUM on some rows and a MAXIMUM on others, under one heading, decided by
 * which side of zero the bar happened to sit. Someone averaging that column gets
 * a number that means nothing.
 *
 * Two changes, and the second is what makes the first honest:
 *   1. the discriminator is MEASURED - does this bar's near end SIT on the
 *      baseline - rather than "was a baseline declared";
 *   2. the two end columns are called `Min` and `Max` and actually hold the
 *      smaller and the larger reading. `Bar start`/`Bar end` imply an ordering
 *      the record has deliberately discarded since 2026-08-03, so renaming
 *      without sorting would be a label over an unchanged column.
 *
 * ⚑ The SLOT names stay `Bar start`/`Bar end`: those are about the GESTURE, and
 * the tips bar uses them to say which corner is next. A bar is dragged corner to
 * corner in whichever direction the hand goes.
 */

/** Value axis: 0 at py 500, 10 at py 100 - so 40 px per unit. */
function barSession() {
  const s = new CalibrationSession(BAR_AXES_CONFIG);
  s.handleCalibrationClick(100, 500);
  expect(s.confirmCalibrationValues(['0'])).toBe(true);
  s.handleCalibrationClick(100, 100);
  expect(s.confirmCalibrationValues(['10'])).toBe(true);
  walkCategoryAxis(s);
  expect(s.runCalibration()).toBe(true);
  return s;
}

/**
 * ⚑⚑ THE INTERVAL RECORD MOVED TYPES IN v2.5, AND SO DO THE TESTS THAT PROVE IT.
 *
 * Everything below about `Min`/`Max` describes a SPAN, not a bar: two measured
 * ends, neither of them a baseline. Bar kept only what its name says. The record
 * itself did not change by one field, which is why these tests needed a
 * different session and not different expectations - the cleanest evidence that
 * this was a REGROUPING rather than a rebuild.
 */
function spanSession() {
  const s = new CalibrationSession(SPAN_AXES_CONFIG);
  s.handleCalibrationClick(100, 500);
  expect(s.confirmCalibrationValues(['0'])).toBe(true);
  s.handleCalibrationClick(100, 100);
  expect(s.confirmCalibrationValues(['10'])).toBe(true);
  walkCategoryAxis(s);
  expect(s.runCalibration()).toBe(true);
  return s;
}

const sectionsFor = (s: ReturnType<typeof barSession>) =>
  buildExportSections({
    session: s,
    axes: s.getAxes()!,
    configId: 'bar',
    scope: 'active',
    measures: [],
    precision: 'auto',
  } as unknown as ExportAssemblyInput);

const jsonFor = (s: ReturnType<typeof barSession>) =>
  JSON.parse(
    buildExportJson({
      session: s,
      axes: s.getAxes()!,
      configId: 'bar',
      scope: 'active',
      measures: [],
      precision: 'auto',
    } as unknown as ExportAssemblyInput)
  );

describe('the two ends of a bar reach the file as Min and Max', () => {
  it('⚑⚑ the columns are named for the INTERVAL, not for the hand', () => {
    const s = barSession();
    s.addDataPoint(150, 500);
    s.addDataPoint(200, 300);
    const [data] = sectionsFor(s);
    expect(data!.header).toContain('Min');
    expect(data!.header).toContain('Max');
    expect(data!.header).not.toContain('Bar start');
    expect(data!.header).not.toContain('Bar end');
  });

  it('⚑⚑ and the SMALLER reading is in Min, whichever corner was dragged first', () => {
    // The whole point of the rename: two people capturing the identical bar must
    // produce the identical file.
    const forwards = spanSession();
    forwards.addDataPoint(150, 420); // value 2
    forwards.addDataPoint(200, 300); // value 5

    const backwards = spanSession();
    backwards.addDataPoint(150, 300); // value 5, the same bar the other way
    backwards.addDataPoint(200, 420); // value 2

    const row = (s: ReturnType<typeof barSession>) => {
      const [data] = sectionsFor(s);
      const at = (name: string) => data!.rows[0]![data!.header.indexOf(name)];
      return { min: at('Min'), max: at('Max') };
    };
    expect(row(forwards).min).toBeCloseTo(2, 6);
    expect(row(forwards).max).toBeCloseTo(5, 6);
    expect(row(backwards)).toEqual(row(forwards));
  });

  it('⚑ the JSON says the same words in the same order', () => {
    // A reader who switches format must not meet a different model.
    const s = spanSession();
    s.addDataPoint(150, 300); // value 5 first
    s.addDataPoint(200, 420); // value 2
    const tuple = jsonFor(s).series[0].tuples[0];
    expect(tuple.Min).toBeCloseTo(2, 6);
    expect(tuple.Max).toBeCloseTo(5, 6);
    expect(tuple).not.toHaveProperty('Bar start');
  });

  it('⚑ a bar that sits on the baseline still carries its Value beside them', () => {
    const s = barSession();
    s.addDataPoint(150, 500); // value 0 - on the baseline
    s.addDataPoint(200, 300); // value 5
    const [data] = sectionsFor(s);
    const at = (name: string) => data!.rows[0]![data!.header.indexOf(name)];
    expect(at('Min')).toBeCloseTo(0, 6);
    expect(at('Max')).toBeCloseTo(5, 6);
    expect(at('Value')).toBeCloseTo(5, 6);
  });

  it('⚑⚑ a FLOATING bar carries no Value column at all', () => {
    // Adaptive columns are the house rule (`getErrorColumns` does the same): a
    // column of blanks asserts an emptiness nobody looked for, and David refused
    // the alternative outright - a column of zeros "will look like a fault to
    // the users".
    const s = barSession();
    s.addDataPoint(150, 420); // value 2
    s.addDataPoint(200, 300); // value 5 - neither end is the baseline
    const [data] = sectionsFor(s);
    expect(data!.header).not.toContain('Value');
    const at = (name: string) => data!.rows[0]![data!.header.indexOf(name)];
    expect(at('Min')).toBeCloseTo(2, 6);
    expect(at('Max')).toBeCloseTo(5, 6);
  });

  it('⚑ a half-dragged bar is not sorted into a Min it does not have', () => {
    // One corner placed. Moving the single reading into `Min` would assert which
    // end of a bar nobody has finished drawing it is.
    const s = barSession();
    s.addDataPoint(150, 300); // value 5, one corner only
    const [data] = sectionsFor(s);
    const at = (name: string) => data!.rows[0]![data!.header.indexOf(name)];
    expect(at('Min')).toBeCloseTo(5, 6);
    expect(at('Max')).toBe('');
  });
});


describe("⚑⚑ the figure David measured it on - samples/bar-floating-temperature", () => {
  /**
   * ⚑ DRIVEN FROM THE COMMITTED GROUND TRUTH, not from geometry this test
   * invented: `.truth.json` is the instrument, and its own note already says
   * what the record has to be - *"each bar's two measured ends (low/high),
   * never a single baseline-relative value."* The old panel disagreed with that
   * sentence on every row of the figure it was written for.
   */
  const truth = JSON.parse(
    readFileSync(new URL('../../samples/bar-floating-temperature.truth.json', import.meta.url), 'utf8')
  ) as {
    calibration: { anchors: { p1: { px: number; py: number; value: number }; p2: { px: number; py: number; value: number } } };
    series: { points: { category: string; start: number; end: number }[] }[];
  };

  const { p1, p2 } = truth.calibration.anchors;
  /** The pixel row a temperature sits on, from the truth file's own anchors. */
  const pyOf = (value: number) =>
    p1.py + ((value - p1.value) * (p2.py - p1.py)) / (p2.value - p1.value);

  function calibratedFromTruth() {
    // ⚑ `samples/bar-floating-temperature` is a SPAN chart as of v2.5 - every
    // bar floats, which is the whole reason the type exists. Its committed
    // .truth.json is unchanged.
    const s = new CalibrationSession(SPAN_AXES_CONFIG);
    s.handleCalibrationClick(p1.px, p1.py);
    expect(s.confirmCalibrationValues([String(p1.value)])).toBe(true);
    s.handleCalibrationClick(p2.px, p2.py);
    expect(s.confirmCalibrationValues([String(p2.value)])).toBe(true);
    walkCategoryAxis(s);
    expect(s.runCalibration()).toBe(true);
    return s;
  }

  it('every bar reports BOTH ends, and none of them reports a Value', () => {
    // The two rows David read off the screen: January runs -8..2 and reported
    // -7.95, its LOW end; April runs 3..15 and reported 15, its HIGH end. One
    // heading, two different quantities, decided by which side of zero the bar
    // sat on.
    const s = calibratedFromTruth();
    const points = truth.series[0]!.points;
    for (const [i, bar] of points.entries()) {
      const x = 150 + i * 40;
      s.addDataPoint(x, pyOf(bar.start));
      s.addDataPoint(x + 20, pyOf(bar.end));
    }
    const rows = s.getTupleRows();
    expect(rows).toHaveLength(points.length);
    for (const [i, bar] of points.entries()) {
      const row = rows[i]!;
      expect(row.derived, bar.category).toBeNull();
      expect(row.interval!.min, bar.category).toBeCloseTo(Math.min(bar.start, bar.end), 6);
      expect(row.interval!.max, bar.category).toBeCloseTo(Math.max(bar.start, bar.end), 6);
    }
  });

  it('⚑ and the baseline IS declared throughout - that was never the question', () => {
    const s = calibratedFromTruth();
    expect(s.getAxes()!.hasDeclaredBaseline()).toBe(true);
    expect(s.getAxes()!.getBaselineValue()).toBe(0);
  });
});
