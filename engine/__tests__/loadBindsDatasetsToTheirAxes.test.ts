/**
 * ⚑⚑ A SERIES IS READ AGAINST THE AXES ITS FILE BINDS IT TO.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-10. `deserializeProject` took axes **[0]** and
 * **every** dataset and handed both to `loadCalibrated`, which calibrates the
 * lot against that one axes. A file that binds a series to a SECOND coordinate
 * system had that series re-read against the first one - measured, a pixel
 * worth 500 on its own axes reported as 5 - while the second axes and its whole
 * calibration vanished from the record. No notice, no calibration error.
 *
 * ⚑ THE RULE WAS ALREADY WRITTEN, one file over. `datasetsForAxes` in
 * `wpdImport.ts` exists for exactly this and says so: *"WPD maps each dataset to
 * its own axes, so a multi-figure project's datasets must be filtered, not taken
 * wholesale."* The foreign door filtered; our own door did not.
 *
 * ⚑ AND THE FILTER CANNOT BE THE NAIVE ONE. `plotData` binds a dataset only
 * when its `axesName` matches a known axes, so a file whose datasets carry no
 * binding - a hand-written one, or any older shape - would have every series
 * dropped by a strict filter. UNBOUND means "the only axes there is". Only a
 * series bound to a DIFFERENT axes is held back, and then the file says so.
 */
import { describe, expect, it } from 'vitest';
import { serializeProject, deserializeProject } from '../projectFile.js';
import { CalibrationSession, XY_AXES_CONFIG, type CalibratedAxes } from '../calibrationSession.js';

/** A calibrated XY figure with one series, as the app writes it. */
function xyProject(): Record<string, unknown> {
  const s = new CalibrationSession<CalibratedAxes>(XY_AXES_CONFIG as never);
  s.handleCalibrationClick(100, 400);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(400, 400);
  s.confirmCalibrationValues(['1000']);
  s.handleCalibrationClick(100, 400);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['1000']);
  expect(s.runCalibration(), s.getCalibrationError() ?? 'no error').toBe(true);
  s.addDataPoint(250, 250);
  const file = serializeProject(s, 'data:image/png;base64,AA==', 'f.png');
  if ('error' in file) throw new Error(file.error);
  return JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
}

/** Add a second axes, and a series explicitly bound to it. */
function withSecondAxes(raw: Record<string, unknown>): Record<string, unknown> {
  const file = JSON.parse(JSON.stringify(raw)) as {
    plotData: { axesColl: Record<string, unknown>[]; datasetColl: Record<string, unknown>[] };
  };
  const second = JSON.parse(JSON.stringify(file.plotData.axesColl[0])) as {
    name: string;
    calibrationPoints: { dx: string; dy: string }[];
  };
  second.name = 'XY Axes 2';
  // The same pixels, worth a hundred times as much.
  for (const p of second.calibrationPoints) {
    p.dx = String(Number(p.dx) * 100);
    p.dy = String(Number(p.dy) * 100);
  }
  file.plotData.axesColl.push(second as unknown as Record<string, unknown>);
  const ds = JSON.parse(JSON.stringify(file.plotData.datasetColl[0])) as {
    name: string;
    axesName: string;
  };
  ds.name = 'Series on axes 2';
  ds.axesName = 'XY Axes 2';
  file.plotData.datasetColl.push(ds as unknown as Record<string, unknown>);
  return file as unknown as Record<string, unknown>;
}

function opened(raw: Record<string, unknown>) {
  const back = deserializeProject(raw);
  if ('error' in back) throw new Error(back.error);
  const session = new CalibrationSession<CalibratedAxes>(XY_AXES_CONFIG as never);
  session.loadCalibrated(back.axes as never, back.datasets, back.categoryAxis);
  return { back, session };
}

describe('a loaded file binds each series to its own axes', () => {
  it('⚑⚑ does not read a second axes’ series against the first one', () => {
    const { back, session } = opened(withSecondAxes(xyProject()));
    const names = session.getDatasetInfos().map((d) => d.name);
    expect(
      names,
      `a series bound to another coordinate system was opened against this one: ${JSON.stringify(names)}`
    ).not.toContain('Series on axes 2');
    // ...and the file says what it did with it, rather than dropping it in silence.
    expect(back.notice, 'nothing said the file held more than one coordinate system').toMatch(
      /coordinate system|axes/i
    );
  });

  it('⚑ an ordinary single-axes project is untouched - the companion assertion', () => {
    // The filter must not become a way to lose ordinary series. This is the
    // case every existing project is.
    const { back, session } = opened(xyProject());
    expect(session.getDatasetInfos().length).toBe(1);
    expect(session.getTupleRows().length + session.getDataset().getCount()).toBeGreaterThan(0);
    expect(back.notice, 'an ordinary file has nothing to report').toBeUndefined();
  });

  it('⚑ a series bound to NOTHING belongs to the only axes there is', () => {
    // `plotData` binds by name and skips a dataset whose `axesName` matches no
    // axes, so a strict filter would silently drop it. Unbound is not "someone
    // else's" - it is "the only one".
    const raw = xyProject() as { plotData: { datasetColl: { axesName: string }[] } };
    raw.plotData.datasetColl[0]!.axesName = 'a name no axes has';
    const { session } = opened(raw as unknown as Record<string, unknown>);
    expect(session.getDatasetInfos().length, 'the unbound series was dropped').toBe(1);
  });
});
