/**
 * B4, the export half - ⚑⚑ A CAP IS NOT A DATA POINT IN THE FILE EITHER.
 *
 * ⚠️ MEASURED on the branch before this was written. One datum at (5, 5) with a
 * mirrored SD bar, plus a second datum at (7.5, 2.5), exported as:
 *
 *     x_px  y_px  X    Y
 *     200   200   5    5
 *     200   160   5    7      <- the upper cap, as a data point
 *     200   240   5    3      <- the lower cap, as a data point
 *     250   250   7.5  2.5
 *
 * Four points for two readings, with nothing in the file saying which two were
 * caps. A curve fitted downstream would run through the error bars. Before B4
 * the caps at least sat in their own named series; folding them onto the datum
 * put them in the carrier's own row list, and the exporter had not been told.
 *
 * ⚑ ABSOLUTES AND DELTAS, BOTH - measured, in docs/generator-input-formats.md:
 * ggplot's `geom_errorbar` takes `ymin`/`ymax` absolutes, matplotlib's
 * `errorbar` takes `yerr` deltas, and neither will do the other's arithmetic.
 * The record is absolutes (a delta cannot tell "no bound" from "a bound of size
 * zero"); the delta rides alongside as a projection, never instead.
 *
 * ⚑ PRESENCE IS THE SIGNAL, the rule `role` and `delta` already follow here: a
 * column exists exactly when that series recorded that side. A series with no
 * error exports byte-for-byte as it did before.
 */
import { describe, it, expect } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, BAR_AXES_CONFIG } from '../calibrationSession.js';
import { buildExportSections, buildExportJson } from '../exportAssembly.js';
import type { ExportAssemblyInput } from '../exportAssembly.js';

function session() {
  const s = new CalibrationSession(XY_AXES_CONFIG);
  for (const [px, py, v] of [
    [100, 300, '0'],
    [300, 300, '10'],
    [100, 300, '0'],
    [100, 100, '10'],
  ] as Array<[number, number, string]>) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  s.runCalibration();
  s.renameDataset(0, 'Sample');
  return s;
}

/** Datum (5, 5) with SD upper 7 / lower 3, then a bare datum at (7.5, 2.5). */
function withError() {
  const s = session();
  s.addDataPoint(200, 200);
  expect(
    s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 160 },
      baseName: 'SD',
    })
  ).toBeNull();
  s.addDataPoint(250, 250);
  return s;
}

const sectionsFor = (s: ReturnType<typeof session>, scope: 'active' | 'all') =>
  buildExportSections({
    session: s,
    axes: s.getAxes()!,
    configId: 'xy',
    scope,
    measures: [],
    precision: 'auto',
  } as unknown as ExportAssemblyInput);

describe('the flat export of a series carrying error', () => {
  it('⚑⚑ one row per DATUM - a cap is not a point', () => {
    const [data] = sectionsFor(withError(), 'active');
    expect(data!.rows).toHaveLength(2);
    expect(data!.rows.map((r) => r[3])).toEqual([5, 2.5]); // the Y column
  });

  it('⚑ the caps ride on their datum, as absolutes', () => {
    const [data] = sectionsFor(withError(), 'active');
    expect(data!.header).toEqual([
      'x_px',
      'y_px',
      'X',
      'Y',
      'SD upper',
      'SD lower',
      'SD upper delta',
      'SD lower delta',
    ]);
    expect(data!.rows[0]!.slice(4)).toEqual([7, 3, 2, -2]);
  });

  it('⚑ a datum with no error leaves those cells BLANK, never 0', () => {
    // 0 is a measurement nobody took, and matplotlib accepts it and draws a
    // bound sitting exactly on the value.
    const [data] = sectionsFor(withError(), 'active');
    expect(data!.rows[1]!.slice(4)).toEqual(['', '', '', '']);
  });

  it('⚑ a series with no error at all grows no columns', () => {
    const s = session();
    s.addDataPoint(200, 200);
    const [data] = sectionsFor(s, 'active');
    expect(data!.header).toEqual(['x_px', 'y_px', 'X', 'Y']);
  });

  it('⚑ only the roles that were MEASURED get columns', () => {
    const s = withError();
    s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 250, y: 250 },
      capPixel: { x: 280, y: 250 },
      baseName: 'SD',
    });
    const [data] = sectionsFor(s, 'active');
    expect(data!.header.filter((h) => String(h).startsWith('SD'))).toEqual([
      'SD upper',
      'SD lower',
      'SD left',
      'SD right',
      'SD upper delta',
      'SD lower delta',
      'SD left delta',
      'SD right delta',
    ]);
  });
});

describe('the all-series export', () => {
  it('⚑ the error columns sit with their own series', () => {
    const s = withError();
    s.addDataset('Control');
    s.setActiveDataset(1);
    s.addDataPoint(150, 280);
    const [data] = sectionsFor(s, 'all');
    expect(data!.header).toEqual([
      '#',
      'Sample X',
      'Sample Y',
      'Sample SD upper',
      'Sample SD lower',
      'Sample SD upper delta',
      'Sample SD lower delta',
      'Control X',
      'Control Y',
    ]);
    expect(data!.rows[0]).toEqual([1, 5, 5, 7, 3, 2, -2, 2.5, 1]);
  });

  it('⚑ its rows are datums too', () => {
    const [data] = sectionsFor(withError(), 'all');
    expect(data!.rows).toHaveLength(2);
  });
});

describe('the JSON export', () => {
  it('⚑ a point carries its own extents, named exactly as the CSV names them', () => {
    // Mirror, not merely match: a reader who switches format must meet the same
    // column names, so nothing has to be explained twice.
    const doc = JSON.parse(
      buildExportJson({
        session: withError(),
        axes: withError().getAxes()!,
        configId: 'xy',
        scope: 'active',
        measures: [],
        precision: 'auto',
      } as unknown as ExportAssemblyInput)
    );
    expect(doc.series[0].points[0]).toEqual({
      X: 5,
      Y: 5,
      'SD upper': 7,
      'SD lower': 3,
      'SD upper delta': 2,
      'SD lower delta': -2,
    });
  });

  it('⚑ a datum with no error carries no error keys at all', () => {
    // An absent field means "not measured" - the rule the whole error schema
    // follows. A null would be a claim that we looked.
    const doc = JSON.parse(
      buildExportJson({
        session: withError(),
        axes: withError().getAxes()!,
        configId: 'xy',
        scope: 'active',
        measures: [],
        precision: 'auto',
      } as unknown as ExportAssemblyInput)
    );
    expect(doc.series[0].points[1]).toEqual({ X: 7.5, Y: 2.5 });
  });
});

describe('a TUPLE type carrying error - the bar chart', () => {
  /** One bar, floor to top, with an SD cap above its top. */
  function barWithError() {
    const s = new CalibrationSession(BAR_AXES_CONFIG);
    for (const [px, py, v] of [
      [100, 300, '0'],
      [100, 100, '10'],
    ] as Array<[number, number, string]>) {
      s.handleCalibrationClick(px, py);
      s.confirmCalibrationValues([v]);
    }
    s.runCalibration();
    s.renameDataset(0, 'Sample');
    s.addDataPoint(200, 300); // bar start, value 0
    s.addDataPoint(200, 200); // bar end, value 5
    expect(
      s.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 300 },
        capPixel: { x: 200, y: 260 },
        baseName: 'SD',
      })
    ).toBeNull();
    return s;
  }

  it('⚑⚑ the header and the row are the same length', () => {
    // ⚠️ THE PLAINEST FORM OF THE BUG, AND IT ARRIVED WITH THE FIX. Routing
    // `getSlotNames()` to the type's OWN slots gave the header its two interval
    // columns - while `tupleDataSection` still mapped over ALL of a row's
    // members, error slots included. Three header cells against seven row cells:
    // every value under the wrong name, which is worse than dropping them.
    const [data] = sectionsFor(barWithError() as never, 'active');
    for (const row of data!.rows) expect(row).toHaveLength(data!.header.length);
  });

  it("⚑ the bar keeps its own columns and the error follows them", () => {
    const [data] = sectionsFor(barWithError() as never, 'active');
    // ⚑ The error follows the DERIVED value, because that is the number it
    // qualifies: a bar's height is what has an SD, not either of its corners.
    expect(data!.header).toEqual([
      // F21: a captured bar owns a category from the moment it exists, so its
      // coordinate leads the row. ⚑ A2 renamed it: with the axis unmarked the
      // frame is derived from the bars themselves, so this is a measured
      // Position rather than a name-list index in capture order.
      'Position',
      'category',
      'Min',
      'Max',
      'Value',
      'SD upper',
      'SD lower',
      'SD upper delta',
      'SD lower delta',
    ]);
  });

  it('⚑⚑ the cap VALUES actually reach the file', () => {
    // ⚠️ The column headers existing is not the test. Bar's `pixelToData`
    // returns `[value]`, so the 2-D projection left every cap on a bar chart
    // resolving to nothing - `[{x: 0}]`, no roles at all. Before B4 that cost
    // nothing visible, because a bar's caps were a separate SERIES whose rows
    // reached the file as ordinary readings; folding them onto the datum routed
    // them through the projection instead. Assert the numbers.
    const [data] = sectionsFor(barWithError() as never, 'active');
    const at = (name: string) => data!.rows[0]![data!.header.indexOf(name)];
    expect(at('Max')).toBeCloseTo(5, 6);
    expect(at('SD upper')).toBeCloseTo(2, 6); // the cap at py 260
    expect(at('SD upper delta')).toBeCloseTo(2, 6); // measured from the bar's base
  });

  it('⚑ a bar with no error exports exactly as it did before', () => {
    const s = new CalibrationSession(BAR_AXES_CONFIG);
    for (const [px, py, v] of [
      [100, 300, '0'],
      [100, 100, '10'],
    ] as Array<[number, number, string]>) {
      s.handleCalibrationClick(px, py);
      s.confirmCalibrationValues([v]);
    }
    s.runCalibration();
    s.addDataPoint(200, 300);
    s.addDataPoint(200, 200);
    const [data] = sectionsFor(s as never, 'active');
    // ⚑ A2: `Position`, not `Category index`. A single bar with no axis marked
    // still has a position, and it is 1 - what it does not have is a measurable
    // PITCH, which is why no extent columns appear beside it.
    expect(data!.header).toEqual(['Position', 'category', 'Min', 'Max', 'Value']);
  });
});
