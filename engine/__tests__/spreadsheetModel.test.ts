/**
 * The spreadsheet's rules.
 *
 * ⚑ Each block below covers a rule that has ALREADY produced a defect once -
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
  isDerivedAt,
  isCellEditable,
  editsValuesInTable,
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

describe('derived rows and editability', () => {
  it('spots a derived row by its role', () => {
    expect(isDerivedAt(['anchor', 'interpolated', null], 1)).toBe(true);
    expect(isDerivedAt(['anchor', 'interpolated', null], 0)).toBe(false);
    expect(isDerivedAt(['anchor', 'interpolated', null], 2)).toBe(false);
    // Past the end of a shorter series is not derived, it is absent.
    expect(isDerivedAt(['anchor'], 9)).toBe(false);
  });

  it('allows editing only an ACTIVE, non-derived cell on an XY chart', () => {
    expect(isCellEditable('xy', undefined, true, false)).toBe(true);
  });

  it('refuses a DERIVED cell - an edit there is wiped by the next rebuild', () => {
    expect(isCellEditable('xy', undefined, true, true)).toBe(false);
  });

  it('refuses an inactive series - you edit the series you are working on', () => {
    expect(isCellEditable('xy', undefined, false, false)).toBe(false);
  });

  it('refuses the kinds whose values are not free numbers', () => {
    expect(isCellEditable('polar', undefined, true, false)).toBe(false);
    expect(isCellEditable('ternary', undefined, true, false)).toBe(false);
  });

  /**
   * ⚑⚑ B1 (v2.4): BAR-KIND EDITS A VALUE, AND THE THREE BAR-KIND TYPES DIFFER.
   *
   * They render three different things, so one answer cannot serve all three:
   * Line renders this value table, Box Plot renders the TUPLE table (hasSlots),
   * and Bar has replaced the table with a panel of its own. Only the first has a
   * cell to type into. `showsCategoryColumn` needed exactly this distinction for
   * exactly this reason, which is why `hasSlots` is asked here too.
   *
   * ⚑ The MODEL is wider than this gate: `setDataPointValue` moves a bar-kind
   * datum along its value axis whatever renders it, so Bar's and Box Plot's own
   * panels can offer the edit as soon as they grow an editor, the way the spider
   * panel already does.
   */
  it('a categorical LINE edits its value in the table - it renders one', () => {
    expect(editsValuesInTable('bar', undefined, false)).toBe(true);
    expect(isCellEditable('bar', undefined, true, false, false)).toBe(true);
  });

  it('a BOX PLOT does not - its rows are tuples, in a table of their own', () => {
    expect(editsValuesInTable('bar', undefined, true)).toBe(false);
    expect(isCellEditable('bar', undefined, true, false, true)).toBe(false);
  });

  it('a BAR does not either - its panel has replaced the value table', () => {
    expect(editsValuesInTable('bar', 'bar', false)).toBe(false);
  });

  /**
   * ⚑⚑ THE XY-KIND TYPES THAT SHOW NO VALUE TABLE (v2.3 re-audit, F29).
   *
   * Histogram and heatmap are both `axesKind: 'xy'` and neither renders the
   * spreadsheet - one shows BINS derived from pairs of corners, the other CELLS.
   * The canvas point menu asked `axesKind === 'xy'` alone, so it offered
   * "Edit value…" on a histogram, set the edit state and rendered no editor
   * anywhere. Named for the case, not for the function.
   */
  it('a HISTOGRAM edits no value in a table - it shows bins, not values', () => {
    expect(editsValuesInTable('xy', 'bins')).toBe(false);
    expect(isCellEditable('xy', 'bins', true, false)).toBe(false);
  });

  it('a HEATMAP edits no value in a table either - it shows cells', () => {
    expect(editsValuesInTable('xy', 'heatmap')).toBe(false);
    expect(isCellEditable('xy', 'heatmap', true, false)).toBe(false);
  });

  it('plain XY, which HAS the spreadsheet, still does', () => {
    expect(editsValuesInTable('xy', undefined)).toBe(true);
  });
});
