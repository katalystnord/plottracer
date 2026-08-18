import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, CATEGORICAL_LINE_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';
import type { BarAxes } from '../../core/axes/bar.js';

/**
 * `getExportRows` - what actually reaches a file.
 *
 * ⚑ WHY THIS FILE EXISTS. A mutation run flagged 34 mutants here, clustered on
 * three things that are all tenet-9 sensitive: the PRECISION mode (whether a
 * value is rounded to the figure's own resolution or emitted in full), the
 * categorical rank (an ordinal DERIVED from pixel order at export time, never
 * stored), and the role that distinguishes an assigned anchor from a
 * spline-derived sample. Spider's own branch is exercised by
 * spiderCapture.test.ts; the rest had almost nothing.
 *
 * All three share a failure mode: the number in the file is wrong, or claims
 * more than it should, while nothing on screen looks wrong.
 */

/** XY: x 0..10 across px 100..400, y 0..10 up px 300..100. */
function calibratedXY(): CalibrationSession<XYAxes> {
  const s = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
  const steps: Array<[number, number, string]> = [
    [100, 300, '0'],
    [400, 300, '10'],
    [100, 300, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, v] of steps) {
    expect(s.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues([v])).toBe(true);
  }
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** Categorical line: the value axis calibrated 0 @ y=500, 10 @ y=100. */
function calibratedCategorical(): CalibrationSession<BarAxes> {
  const s = new CalibrationSession<BarAxes>(CATEGORICAL_LINE_CONFIG);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  expect(s.runCalibration()).toBe(true);
  return s;
}

describe('getExportRows - refusals', () => {
  it('exports nothing before the axes exist', () => {
    const s = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    s.addDataPoint(150, 200);
    expect(s.getExportRows(0)).toEqual([]);
  });

  it('exports nothing for a series that does not exist', () => {
    const s = calibratedXY();
    s.addDataPoint(150, 200);
    expect(s.getExportRows(1)).toEqual([]);
    expect(s.getExportRows(-1)).toEqual([]);
    expect(s.getExportRows(99)).toEqual([]);
  });
});

describe('getExportRows - the precision opt-in', () => {
  it('⚑ rounds to the figure\'s own resolution by default, and does NOT in full mode', () => {
    // The default rounds each value to ~half a pixel, because a digitized
    // reading cannot be more precise than the pixels it came from. Full
    // precision emits every computed digit - which is a DIFFERENT claim, and
    // the reason it is opt-in rather than the default.
    const s = calibratedXY();
    s.addDataPoint(163, 217); // deliberately off any round number
    const auto = s.getExportRows(0, 'auto')[0]!.values;
    const full = s.getExportRows(0, 'full')[0]!.values;
    expect(auto).not.toEqual(full);
    // Same underlying reading, to within the rounding it applied.
    expect(auto[0] as number).toBeCloseTo(full[0] as number, 1);
    expect(auto[1] as number).toBeCloseTo(full[1] as number, 1);
  });

  it('defaults to auto when no mode is given', () => {
    const s = calibratedXY();
    s.addDataPoint(163, 217);
    expect(s.getExportRows(0)).toEqual(s.getExportRows(0, 'auto'));
  });

  it('carries the pixels themselves unrounded, in both modes', () => {
    // The PIXEL is the record; only the derived value is a reading.
    const s = calibratedXY();
    s.addDataPoint(163, 217);
    for (const mode of ['auto', 'full'] as const) {
      const row = s.getExportRows(0, mode)[0]!;
      expect([row.px, row.py]).toEqual([163, 217]);
    }
  });
});

describe('getExportRows - the interpolation role', () => {
  it('is ABSENT for an ordinary point, so an untouched series exports as before', () => {
    const s = calibratedXY();
    s.addDataPoint(150, 200);
    expect('role' in s.getExportRows(0)[0]!).toBe(false);
  });

  it('⚑ distinguishes an assigned ANCHOR from a spline-DERIVED sample', () => {
    // They are not the same claim about the figure, and a file that flattens
    // them hands the reader invented points wearing the record's clothes.
    const s = calibratedXY();
    s.addAnchorPoint(150, 250);
    s.addAnchorPoint(250, 200);
    s.addAnchorPoint(350, 260);
    const roles = s.getExportRows(0).map((r) => r.role);
    expect(roles.filter((r) => r === 'anchor').length).toBe(3);
    expect(roles.filter((r) => r === 'interpolated').length).toBeGreaterThan(0);
    // Nothing else - no third kind, and no undefined masquerading as a role.
    expect(new Set(roles)).toEqual(new Set(['anchor', 'interpolated']));
  });
});

describe('getExportRows - categorical line', () => {
  it('⚑ ranks by LEFT-TO-RIGHT pixel order, whatever order they were captured in', () => {
    // X is an ordinal DERIVED at export time - a view of the recorded pixels,
    // never a stored coordinate. Capturing right-to-left must still rank from
    // the left.
    //
    // ⚑ Asserted against each row's OWN px rather than against a fixed row
    // order: insert-in-place (v1.1 #1) splices a new point into the curve, so
    // the stored order is neither click order nor sorted. The invariant that
    // matters is "rank ascends with x", and stating it that way survives any
    // future change to how points are stored.
    const s = calibratedCategorical();
    s.addDataPoint(350, 200);
    s.addDataPoint(150, 300);
    s.addDataPoint(250, 250);
    const byX = [...s.getExportRows(0)].sort((a, b) => a.px - b.px);
    expect(byX.map((r) => r.px)).toEqual([150, 250, 350]);
    expect(byX.map((r) => r.values[0])).toEqual([1, 2, 3]);
  });

  it('ranks from 1, not 0', () => {
    const s = calibratedCategorical();
    s.addDataPoint(150, 300);
    expect(s.getExportRows(0)[0]!.values[0]).toBe(1);
  });

  it('omits the Category cell entirely while no point is named', () => {
    const s = calibratedCategorical();
    s.addDataPoint(150, 300);
    expect(s.getExportRows(0)[0]!.values).toHaveLength(2); // Position, Value
  });

  it('⚑ exports a BLANK cell for an unnamed point once ANY point is named', () => {
    // So a reader can see which ticks were actually transcribed. The inherited
    // `Bar<i>` fallback that invented names here was removed 2026-07-30.
    const s = calibratedCategorical();
    s.addDataPoint(150, 300);
    s.addDataPoint(250, 250);
    s.setPointLabel(0, 'Flax');
    const rows = s.getExportRows(0);
    expect(rows[0]!.values).toEqual([1, 'Flax', expect.any(Number)]);
    expect(rows[1]!.values[1]).toBe('');
  });

  it('rounds its VALUE with the precision mode but never its rank', () => {
    const s = calibratedCategorical();
    s.addDataPoint(163, 217);
    const auto = s.getExportRows(0, 'auto')[0]!.values;
    const full = s.getExportRows(0, 'full')[0]!.values;
    expect(auto[0]).toBe(1); // rank is exact in both
    expect(full[0]).toBe(1);
    expect(auto[1]).not.toBe(full[1]); // the value is not
  });
});
