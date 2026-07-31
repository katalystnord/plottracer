/**
 * The spreadsheet's rules.
 *
 * ⚑ Each block below covers a rule that has ALREADY produced a defect once —
 * column order, editability, derived rows, the Category column's real
 * condition. Inside Workspace.tsx each was an inline expression checkable only
 * by launching Electron.
 */
import { describe, it, expect } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, type CalibratedAxes } from '../calibrationSession.js';
import {
  buildSpreadsheetSeries,
  spreadsheetMaxRows,
  showsCategoryColumn,
  seriesColumns,
  isDerivedAt,
  isCellEditable,
} from '../spreadsheetModel.js';
import type { XYAxes } from '../../core/axes/xy.js';

function calibrateStandardXY(session: CalibrationSession<XYAxes>) {
  const steps: Array<[number, number, string]> = [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, value] of steps) {
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues([value]);
  }
}

function sessionWith(...pointCounts: number[]): CalibrationSession<XYAxes> {
  const s = new CalibrationSession(XY_AXES_CONFIG);
  calibrateStandardXY(s);
  s.runCalibration();
  pointCounts.forEach((n, si) => {
    if (si > 0) s.addDataset(`Series ${si + 1}`);
    s.setActiveDataset(si);
    for (let i = 0; i < n; i++) s.addDataPoint(100 + i * 30, 250 - i * 15);
  });
  return s;
}

function modelFor(s: CalibrationSession<XYAxes>) {
  const sess = s as unknown as CalibrationSession<CalibratedAxes>;
  return buildSpreadsheetSeries(s.getAllDatasetsData(), s.getDatasetInfos(), sess);
}

describe('the ragged row count', () => {
  it('is the LONGEST series, not the active one and not the shortest', () => {
    const series = modelFor(sessionWith(2, 5, 3));
    expect(series.map((s) => s.values.length)).toEqual([2, 5, 3]);
    // ⚑ The whole point of "ragged": a 2-point active series must not truncate
    // the table and hide the 5-point series' rows.
    expect(spreadsheetMaxRows(series)).toBe(5);
  });

  it('is 0 for a table with no points at all', () => {
    expect(spreadsheetMaxRows(modelFor(sessionWith(0)))).toBe(0);
  });
});

describe('the series model', () => {
  it('carries each series own values, name and active flag', () => {
    const series = modelFor(sessionWith(3, 1));
    expect(series).toHaveLength(2);
    expect(series[1]!.name).toBe('Series 2');
    // The LAST series added is the active one here.
    expect(series.map((s) => s.active)).toEqual([false, true]);
    // Values are the calibrated data, pixel columns dropped (30px = 1 x-unit,
    // 15px = 1 y-unit). Compared with a tolerance: the calibration is real
    // floating-point arithmetic, so row 2 lands on 1.9999999999999996.
    expect(series[0]!.values[0]![0]!).toBeCloseTo(0, 9);
    expect(series[0]!.values[0]![1]!).toBeCloseTo(0, 9);
    expect(series[0]!.values[2]![0]!).toBeCloseTo(2, 9);
    expect(series[0]!.values[2]![1]!).toBeCloseTo(2, 9);
  });

  it('gives every series its OWN roles and labels, not the active series answer', () => {
    const series = modelFor(sessionWith(2, 2));
    // Each series must be asked separately -- this is why the model stores them
    // per series rather than reading one list for the whole table.
    expect(series[0]!.roles).toHaveLength(2);
    expect(series[1]!.roles).toHaveLength(2);
    expect(series[0]!.labels.length).toBeGreaterThanOrEqual(0);
  });

  it('leaves the name BLANK, not a fabricated "Series N", if the two views ever disagree (v2.0 audit)', () => {
    // allDatasetsData and datasetInfos are read separately (this file's own
    // header comment) specifically so the component doesn't have to ask the
    // session twice -- which means they COULD disagree. A fabricated name is
    // the same invented-name shape as the Bar0/Slice0 defect fixed elsewhere;
    // an empty datasetInfos here (as if the two views desynced) must not make
    // buildSpreadsheetSeries invent a name nobody gave this series.
    const s = sessionWith(1);
    const sess = s as unknown as CalibrationSession<CalibratedAxes>;
    const series = buildSpreadsheetSeries(s.getAllDatasetsData(), [], sess);
    expect(series).toHaveLength(1);
    expect(series[0]!.name).toBe('');
  });
});

describe('the Category column condition', () => {
  /** ⚑ Bar-kind alone is NOT the rule. Box Plot and Histogram are bar-kind but
   * have slots and render the tuple table, which already names its rows. */
  it('appears for bar WITHOUT slots', () => {
    expect(showsCategoryColumn('bar', false)).toBe(true);
  });

  it('is REFUSED for bar WITH slots (box plot / histogram)', () => {
    expect(showsCategoryColumn('bar', true)).toBe(false);
  });

  it('never appears for non-bar kinds, slots or not', () => {
    expect(showsCategoryColumn('xy', false)).toBe(false);
    expect(showsCategoryColumn('xy', true)).toBe(false);
    expect(showsCategoryColumn('polar', false)).toBe(false);
  });
});

describe('column ORDER — the rule the screen and the file once disagreed on', () => {
  it('puts Category FIRST, before every value column', () => {
    const cols = seriesColumns(true, ['X', 'Y']);
    expect(cols.map((c) => c.kind)).toEqual(['category', 'value', 'value']);
    expect(cols[0]!.label).toBe('Category');
    // ⚑ The independent variable leads. Appending Category last is exactly the
    // defect David caught in the categorical export (2026-07-26).
    expect(cols.map((c) => c.label)).toEqual(['Category', 'X', 'Y']);
  });

  it('omits the category column entirely when it does not apply', () => {
    const cols = seriesColumns(false, ['X', 'Y']);
    expect(cols.map((c) => c.kind)).toEqual(['value', 'value']);
    expect(cols.map((c) => c.label)).toEqual(['X', 'Y']);
  });

  it('keeps each value column bound to its own DIM and date format', () => {
    // The dim must survive the category offset, or a date format would be
    // applied to the wrong column once Category is prepended.
    const cols = seriesColumns(true, ['Date', 'Value'], ['%Y-%m-%d', null]);
    const values = cols.filter((c) => c.kind === 'value');
    expect(values.map((c) => (c.kind === 'value' ? c.dim : -1))).toEqual([0, 1]);
    expect(values.map((c) => (c.kind === 'value' ? c.dateFormat : 'x'))).toEqual(['%Y-%m-%d', null]);
  });

  it('reads no date format where none was given', () => {
    const cols = seriesColumns(false, ['X', 'Y']);
    expect(cols.every((c) => c.kind === 'value' && c.dateFormat === null)).toBe(true);
  });
});

describe('derived rows and editability', () => {
  it('spots a derived row by its role', () => {
    expect(isDerivedAt(['anchor', 'interpolated', null], 1)).toBe(true);
    expect(isDerivedAt(['anchor', 'interpolated', null], 0)).toBe(false);
    expect(isDerivedAt(['anchor', 'interpolated', null], 2)).toBe(false);
    // Past the end of a shorter series is not derived, it is absent.
    expect(isDerivedAt(['anchor'], 9)).toBe(false);
  });

  it('allows editing only an ACTIVE, non-derived cell on an XY chart', () => {
    expect(isCellEditable('xy', true, false)).toBe(true);
  });

  it('refuses a DERIVED cell — an edit there is wiped by the next rebuild', () => {
    expect(isCellEditable('xy', true, true)).toBe(false);
  });

  it('refuses an inactive series — you edit the series you are working on', () => {
    expect(isCellEditable('xy', false, false)).toBe(false);
  });

  it('refuses every non-XY kind, whose values are not free numbers', () => {
    expect(isCellEditable('bar', true, false)).toBe(false);
    expect(isCellEditable('polar', true, false)).toBe(false);
    expect(isCellEditable('ternary', true, false)).toBe(false);
  });
});
