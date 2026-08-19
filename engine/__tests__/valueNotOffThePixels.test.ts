import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, SPIDER_AXES_CONFIG } from '../calibrationSession.js';
import { buildSpreadsheetSeries } from '../spreadsheetModel.js';
import { flatDataSection, allSeriesSection, buildSeriesJSON } from '../csvExport.js';
import { serializeProject, deserializeProject } from '../projectFile.js';
import type { XYAxes } from '../../core/axes/xy.js';
import type { SpiderAxes } from '../../core/axes/spider.js';

/**
 * A4: WHICH NUMBERS CAME OFF THE PIXELS, AND WHICH THE USER SUPPLIED.
 *
 * ⚑⚑ ONE FACT, TRUE ON EVERY TYPE - *this number did not come from the pixels*.
 * The heatmap has carried it since v2.2 (a person reads a hatched cell the
 * sampler averages away, and the matrix prints `[59]`); every other type let a
 * typed value join the clicked ones with nothing to tell them apart. That is
 * the tenet-9 distinction a downstream reader needs, and it was recorded for
 * one type out of twelve.
 *
 * ⚠️ NOT a declared-vs-measured flag. A user's own reading is a MEASUREMENT
 * taken with a better instrument - their eye - so it is recorded the way ours
 * is, through the same transform. What the record keeps is WHICH INSTRUMENT.
 *
 * The cases below are the design, written as outcomes rather than conclusions.
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

/** Centre (100,100); `n` spokes of 100px, clockwise from 12 o'clock. */
function spokePixel(i: number, n: number, radius = 100): [number, number] {
  const angle = (2 * Math.PI * i) / n;
  return [100 + radius * Math.sin(angle), 100 - radius * Math.cos(angle)];
}

/** Spider: three spokes, 0 at the centre and 10 at every rim. */
function calibratedSpider(): CalibrationSession<SpiderAxes> {
  const s = new CalibrationSession<SpiderAxes>(SPIDER_AXES_CONFIG);
  while (s.getRepeatCount() < 3) s.addRepeat();
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['0']);
  for (let i = 0; i < 3; i++) {
    s.handleCalibrationClick(...spokePixel(i, 3));
    s.confirmCalibrationValues(['10', ['Strength', 'Weight', 'Cost'][i]!]);
  }
  expect(s.runCalibration()).toBe(true);
  return s;
}

describe('A4 - the mark on the model', () => {
  it('a clicked point supplies nothing', () => {
    const s = calibratedXY();
    s.addDataPoint(250, 200);
    expect(s.getSuppliedDimsFor(0)).toEqual([[]]);
  });

  it('typing a value marks THAT value, and leaves the other one alone', () => {
    const s = calibratedXY();
    s.addDataPoint(250, 200);
    expect(s.setDataPointValue(0, 0, 8)).toBe(true);
    expect(s.getSuppliedDimsFor(0)).toEqual([[0]]);
    // The typed value is what the point now reads, through the axes' inverse -
    // the datum MOVED; nothing was overwritten.
    expect(s.getDataPoints()[0]!.data![0]).toBeCloseTo(8, 6);
    expect(s.getDataPoints()[0]!.data![1]).toBeCloseTo(5, 6);
  });

  it('typing the other value adds it to the same point', () => {
    const s = calibratedXY();
    s.addDataPoint(250, 200);
    s.setDataPointValue(0, 0, 8);
    s.setDataPointValue(0, 1, 2);
    expect(s.getSuppliedDimsFor(0)).toEqual([[0, 1]]);
  });

  it('⚑ dragging the point clears the mark - it was read off the pixels again', () => {
    const s = calibratedXY();
    s.addDataPoint(250, 200);
    s.setDataPointValue(0, 0, 8);
    s.updateDataPointPixel(0, 260, 210);
    expect(s.getSuppliedDimsFor(0)).toEqual([[]]);
  });

  it('a refused edit marks nothing', () => {
    const s = calibratedXY();
    s.addDataPoint(250, 200);
    expect(s.setDataPointValue(0, 0, Number.NaN)).toBe(false);
    expect(s.getSuppliedDimsFor(0)).toEqual([[]]);
  });

  it('⚑ the mark survives save and reload', () => {
    const s = calibratedXY();
    s.addDataPoint(250, 200);
    s.setDataPointValue(0, 1, 3);
    const saved = serializeProject(s, 'data:image/png;base64,AA==');
    if ('error' in saved) throw new Error(saved.error);
    const reopened = deserializeProject(JSON.parse(JSON.stringify(saved)));
    if ('error' in reopened) throw new Error(reopened.error);
    const back = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    back.loadCalibrated(reopened.axes as unknown as XYAxes, reopened.datasets);
    expect(back.getSuppliedDimsFor(0)).toEqual([[1]]);
  });

  it('spider: a typed reading is marked, and it slides along its OWN spoke', () => {
    const s = calibratedSpider();
    s.addDataPoint(...spokePixel(0, 3, 50)); // spoke 0, value 5
    expect(s.setDataPointValue(0, 0, 8)).toBe(true);
    expect(s.getSuppliedDimsFor(0)).toEqual([[0]]);
    expect(s.getSpiderTable().columns[0]!.values[0]).toBeCloseTo(8, 6);
  });
});

describe('A4 - the mark on screen', () => {
  it('the data panel knows which cells were supplied', () => {
    const s = calibratedXY();
    s.addDataPoint(250, 200);
    s.addDataPoint(300, 200);
    s.setDataPointValue(1, 0, 8);
    const series = buildSpreadsheetSeries(s.getAllDatasetsData(), s.getDatasetInfos(), s);
    expect(series[0]!.supplied).toEqual([[], [0]]);
  });

  it('the spider table knows which readings were supplied', () => {
    const s = calibratedSpider();
    s.addDataPoint(...spokePixel(0, 3, 50));
    s.setDataPointValue(0, 0, 8);
    expect(s.getSpiderTable().columns[0]!.supplied).toEqual([true, false, false]);
  });
});

describe('A4 - the mark in the file', () => {
  it('⚑ no source column at all when every value came off the pixels', () => {
    const s = calibratedXY();
    s.addDataPoint(250, 200);
    const section = flatDataSection(s.getExportRows(0), s.getExportFields());
    expect(section.header).toEqual(['x_px', 'y_px', 'X', 'Y']);
  });

  it('the CSV says which instrument read each value, per column', () => {
    const s = calibratedXY();
    s.addDataPoint(250, 200);
    s.addDataPoint(300, 200);
    s.setDataPointValue(1, 0, 8);
    const section = flatDataSection(s.getExportRows(0), s.getExportFields());
    expect(section.header).toEqual(['x_px', 'y_px', 'X', 'Y', 'X source']);
    expect(section.rows[0]![4]).toBe('pixel');
    expect(section.rows[1]![4]).toBe('user');
  });

  it('the all-series table carries it under the series it belongs to', () => {
    const s = calibratedXY();
    s.addDataPoint(250, 200);
    s.setDataPointValue(0, 1, 3);
    const section = allSeriesSection(
      [{ name: 'Series 1', rows: s.getExportRows(0) }],
      s.getExportFields()
    );
    expect(section.header).toContain('Series 1 Y source');
  });

  it('the JSON attaches it only to the value it applies to', () => {
    const s = calibratedXY();
    s.addDataPoint(250, 200);
    s.setDataPointValue(0, 0, 8);
    const doc = JSON.parse(
      buildSeriesJSON([{ name: 'Series 1', rows: s.getExportRows(0) }], s.getExportFields())
    );
    expect(doc.series[0].points[0]['X source']).toBe('user');
    expect(doc.series[0].points[0]['Y source']).toBeUndefined();
  });

  it('spider: the source lands on the VALUE column, not the axis identity', () => {
    const s = calibratedSpider();
    s.addDataPoint(...spokePixel(0, 3, 50));
    s.setDataPointValue(0, 0, 8);
    const fields = s.getExportFields();
    const section = flatDataSection(s.getExportRows(0), fields);
    expect(section.header).toEqual(['x_px', 'y_px', ...fields, `${fields[2]} source`]);
    expect(section.rows[0]![section.header.length - 1]).toBe('user');
  });
});
