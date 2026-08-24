import { describe, expect, it } from 'vitest';
import { CalibrationSession, type CalibratedAxes } from '../calibrationSession.js';
import {
  BAR_AXES_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
} from '../axesTypeConfigs.js';
import {
  buildExportJson,
  buildExportSections,
  errorColumnsByTuple,
  errorColumnsFor,
  type ExportAssemblyInput,
} from '../exportAssembly.js';
import type { BarAxes } from '../../core/axes/bar.js';
import type { XYAxes } from '../../core/axes/xy.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ A CAP THAT IS ON SCREEN IS IN THE FILE - IN EVERY FORMAT (v2.3 re-audit,
 * F26 + F27).
 *
 * `errorColumnsFor` has carried this sentence since B4: *"Both export paths go
 * through here, because they are the same question. The on-screen panel asks
 * `getErrorColumns` too: one answer, so a column cannot exist on screen and be
 * missing from the file."* Two callers did not ask it.
 *
 *   F26 - `buildExportJson`'s TUPLE branch rebuilt `{name, rows}` by hand and
 *         dropped the error spread the CSV branch passes. So bar, box plot and
 *         pie exported their caps to eight formats and not to JSON - the one
 *         format a PROGRAM reads, which is the reader the error record exists
 *         for (matplotlib's `yerr` takes the deltas directly).
 *   F27 - histogram carried them NOWHERE. The error tool is offered on every
 *         type that has points, the whiskers are drawn on the canvas, and the
 *         bins table, `histogramSection` and `buildHistogramJSON` all reported
 *         the interval and the magnitude alone.
 *
 * ⚑ Driven through a real session and the real assembly rather than by handing
 * the builders a literal: what failed was the WIRING between them, and a test
 * that calls `buildTupleSeriesJSON` directly cannot see wiring. That is this
 * project's own "a fixture is blind to what it lacks".
 */

/** Bar axes: category across, value up. X1=0 @ (100,250), X2=10 @ (400,250)... */
function calibratedBar<T extends BarAxes>(config: typeof BAR_AXES_CONFIG): CalibrationSession<T> {
  const s = new CalibrationSession(config) as unknown as CalibrationSession<T>;
  s.handleCalibrationClick(100, 250);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s);
  s.runCalibration();
  return s;
}

function inputFor(session: CalibrationSession<never>, configId: string): ExportAssemblyInput {
  const s = session as unknown as CalibrationSession<CalibratedAxes>;
  return {
    session: s,
    axes: s.getAxes()!,
    configId,
    scope: 'active',
    precision: 'auto',
    measures: [],
  };
}

/** Place a cap on the datum at `datum`, returning whether the type took it. */
function capOn(
  session: { captureErrorCap: CalibrationSession<CalibratedAxes>['captureErrorCap'] },
  datum: { x: number; y: number },
  cap: { x: number; y: number }
): boolean {
  const refusal = session.captureErrorCap({
    targetIndex: 0,
    datumPixel: datum,
    capPixel: cap,
    baseName: 'SD',
  });
  // ⚑ A REFUSAL FAILS THE TEST, it does not skip it. A silent `return` here
  // would make every assertion below vacuous the day the capture path changes,
  // which is the one way this file could go green while the defect came back.
  expect(refusal, `the cap was refused: ${refusal}`).toBeNull();
  return true;
}

/** Every header cell of every section, flattened - "does the word appear in the
 *  table half of the export at all?" */
function allHeaders(input: ExportAssemblyInput): string[] {
  return buildExportSections(input).flatMap((s) => s.header.map(String));
}

describe('a captured error cap reaches the JSON, not only the tables (F26)', () => {
  for (const [label, config] of [
    ['bar', BAR_AXES_CONFIG],
    ['box plot', BOX_PLOT_AXES_CONFIG],
  ] as const) {
    it(`${label}: the caps in the CSV headers are keys in the JSON too`, () => {
      const s = calibratedBar(config as typeof BAR_AXES_CONFIG);
      s.addDataPoint(200, 200);
      s.addDataPoint(200, 150);
      if (!capOn(s as never, { x: 200, y: 200 }, { x: 200, y: 180 })) return; // type refused
      const input = inputFor(s as never, config.id);
      const headers = allHeaders(input).filter((h) => h.startsWith('SD'));
      expect(headers.length, 'the CSV path must carry the cap for this test to mean anything').toBeGreaterThan(0);
      const json = buildExportJson(input);
      for (const label of headers) {
        expect(json, `${label} is a column in the tables and absent from the JSON`).toContain(
          `"${label}"`
        );
      }
    });
  }
});

describe('a histogram carries its caps at all (F27)', () => {
  function calibratedHistogram(): CalibrationSession<XYAxes> {
    const s = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    for (const [px, py, v] of [
      [100, 250, '0'],
      [400, 250, '10'],
      [100, 250, '0'],
      [100, 100, '10'],
    ] as Array<[number, number, string]>) {
      s.handleCalibrationClick(px, py);
      s.confirmCalibrationValues([v]);
    }
    s.runCalibration();
    // Two top corners make one bin.
    s.addDataPoint(130, 200);
    s.addDataPoint(190, 200);
    return s;
  }

  it('the cap is a column in the bins table section', () => {
    const s = calibratedHistogram();
    expect(s.getHistogramBins().filter(Boolean).length, 'the bin must exist').toBe(1);
    if (!capOn(s as never, { x: 130, y: 200 }, { x: 130, y: 180 })) return;
    const headers = allHeaders(inputFor(s as never, 'histogram'));
    expect(headers.some((h) => h.startsWith('SD'))).toBe(true);
  });

  it('and a key in the histogram JSON', () => {
    const s = calibratedHistogram();
    if (!capOn(s as never, { x: 130, y: 200 }, { x: 130, y: 180 })) return;
    const input = inputFor(s as never, 'histogram');
    const labels = allHeaders(input).filter((h) => h.startsWith('SD') && !h.endsWith('delta'));
    expect(labels.length).toBeGreaterThan(0);
    const json = buildExportJson(input);
    for (const label of labels) expect(json).toContain(`"${label}"`);
  });

  it('a histogram with NO caps exports exactly what it did before', () => {
    const s = calibratedHistogram();
    const headers = allHeaders(inputFor(s as never, 'histogram'));
    expect(headers).toEqual(['bin start', 'bin end', 'value']);
    expect(buildExportJson(inputFor(s as never, 'histogram'))).not.toContain('SD');
  });
});

/**
 * ⚑⚑ AND IT REACHES THE RIGHT ROW (v2.3 re-audit, F41).
 *
 * `getResolvedErrorBars` is COMPACTED - a tuple whose first slot is empty yields
 * no bar - and that is right for the XY spreadsheet, whose rows come from
 * `getDatumPixelIndices` and skip identically. It is wrong for every TUPLE
 * table, whose rows ARE the tuples, gaps included: zipped by position, the first
 * gap shifts every later series' error up one row and blanks the last.
 *
 * That is F20's defect exactly - *"error columns then zipped onto the WRONG
 * ROWS"* - surviving on the other half of the app, and F27 was about to extend
 * it to the histogram. Every number stays individually plausible and nothing on
 * screen says which are misfiled.
 *
 * ⚑ The gap is reachable: `plotData.ts` fills tuple slots from the FILE, so a
 * project (ours, hand-edited, or a foreign import translated at the boundary)
 * can name a group without naming group 0.
 */
describe('a cap lands on the row that recorded it (F41)', () => {
  it('a tuple with an empty first slot does not shift every later row\'s error', () => {
    const s = calibratedBar(BAR_AXES_CONFIG);
    s.addDataPoint(150, 200);
    s.addDataPoint(170, 200); // tuple 0
    s.addDataPoint(200, 180);
    s.addDataPoint(220, 180); // tuple 1
    expect(capOn(s as never, { x: 200, y: 180 }, { x: 200, y: 160 })).toBe(true);

    const ds = s.getDataset();
    const firstPixelOfTupleZero = ds.getAllTuples()[0]![0]!;
    // Blank tuple 0's FIRST slot, the way a file can.
    ds.removeFromTupleAt(0, firstPixelOfTupleZero);
    expect(ds.getAllTuples()[0]![0]).toBeNull();

    const byTuple = errorColumnsByTuple(s as never, 0).error;
    expect(byTuple, 'the cap must still be reported at all').toBeDefined();
    // ⚑ THE WHOLE ASSERTION: the cap belongs to tuple 1, so row 1 carries it and
    // row 0 carries nothing. Zipped from the compacted list, row 0 would hold
    // tuple 1's reading and row 1 would be blank.
    expect(byTuple!.values[0]!.every((v) => v === null), 'tuple 0 recorded no cap').toBe(true);
    expect(byTuple!.values[1]!.some((v) => v !== null), "tuple 1's cap is on tuple 1's row").toBe(true);
    // And the rows keep the table's own length, not the compacted one.
    expect(byTuple!.values).toHaveLength(ds.getAllTuples().length);
    expect(byTuple!.deltas).toHaveLength(ds.getAllTuples().length);
  });

  it('an ordinary series, with no gaps, is unchanged by the by-tuple alignment', () => {
    const s = calibratedBar(BAR_AXES_CONFIG);
    s.addDataPoint(150, 200);
    s.addDataPoint(170, 200);
    expect(capOn(s as never, { x: 150, y: 200 }, { x: 150, y: 180 })).toBe(true);
    const byTuple = errorColumnsByTuple(s as never, 0).error;
    const byDatum = errorColumnsFor(s as never, 0).error;
    expect(byTuple!.labels).toEqual(byDatum!.labels);
    expect(byTuple!.values).toEqual(byDatum!.values);
    expect(byTuple!.deltas).toEqual(byDatum!.deltas);
  });
});
