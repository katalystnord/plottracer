import { describe, expect, it } from 'vitest';
import { CalibrationSession, type CalibratedAxes } from '../calibrationSession.js';
import { XY_AXES_CONFIG } from '../axesTypeConfigs.js';
import type { LinePoint } from '../lineEdits.js';

/**
 * Series names (role-play 2026-10-12). David: *"they should all be called the
 * same thing, not line/series. Then the count needs to be adjusted when series
 * are merged"*, and *"when merging, you should pick the series with the lowest
 * number, if you have not changed the name"*.
 *
 * A name PlotTracer gives is "Series N" where N is the series' place in the
 * list - the number the table and an agent use for it - so a removal or a
 * merge closes the count up by itself. A name a person typed is theirs and is
 * never changed.
 */

type Session = CalibrationSession<CalibratedAxes>;
function calibrated(): Session {
  const s = new CalibrationSession<CalibratedAxes>(XY_AXES_CONFIG as never);
  for (const [px, py, v] of [[100, 250, '0'], [400, 250, '10'], [100, 250, '0'], [100, 100, '10']] as const) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  expect(s.runCalibration()).toBe(true);
  return s;
}
const line = (y: number, x0 = 120): LinePoint[] => [x0, x0 + 40, x0 + 80].map((x) => ({ x, y, role: null }));
const names = (s: Session) => s.getDatasetInfos().map((d) => d.name);

describe('one naming for every series', () => {
  it('a found line and a series added with + Add are named the same way, Series N', () => {
    const s = calibrated();
    s.addFoundLines([line(200), line(150)]);
    s.addDataset();
    expect(names(s)).toEqual(['Series 1', 'Series 2', 'Series 3']);
  });

  it('removing a series closes up the numbers PlotTracer gave', () => {
    const s = calibrated();
    s.addFoundLines([line(200), line(150), line(100)]);
    s.removeDataset(1);
    expect(names(s)).toEqual(['Series 1', 'Series 2']);
  });

  it('a name the person typed is never renumbered, and keeps its place in the count', () => {
    const s = calibrated();
    s.addFoundLines([line(200), line(150), line(100)]);
    expect(s.renameDataset(2, 'Blend C')).toBeNull();
    s.removeDataset(0);
    expect(names(s)).toEqual(['Series 1', 'Blend C']);
  });

  it('joining two lines keeps the lower-numbered one, and the count closes up', () => {
    const s = calibrated();
    s.addFoundLines([line(200), line(150, 220), line(150), line(100)]);
    // join the earlier piece (Series 3) onto the later one (Series 2)... and the other way round
    expect(s.joinLines(2, 1)).toBeNull();
    expect(names(s)).toEqual(['Series 1', 'Series 2', 'Series 3']);
    expect(s.getLinePoints(1)!.length).toBeGreaterThanOrEqual(6);
  });

  it('joining keeps a typed name over a given one, whichever number it had', () => {
    const s = calibrated();
    s.addFoundLines([line(200), line(150, 220), line(150)]);
    expect(s.renameDataset(2, 'Blend B')).toBeNull();
    expect(s.joinLines(1, 2)).toBeNull();
    expect(names(s)).toEqual(['Series 1', 'Blend B']);
  });
});
