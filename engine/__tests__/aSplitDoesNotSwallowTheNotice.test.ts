/**
 * ⚑⚑ A PROJECT CAN ARRIVE WITH A NOTICE *AND* AN OFFER, AND ACCEPTING THE
 * OFFER MUST NOT SWALLOW THE NOTICE.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-15. The split branch added to `openProject` in
 * `fd37c7b` returns before `if (result.notice) setProjectNotice(result.notice)`,
 * so every sentence the load door produced is discarded the moment the user says
 * Yes - and shown if they say No. The notices are about the DATA, not about the
 * figure count: series held back because the file carries a second set of axes,
 * marks orphaned by a dropped role, a document relabelled Bar -> Span, a box plot
 * whose slots cannot draw a box. Splitting the project makes none of them untrue.
 *
 * ⚑ THIS FILE PINS THE REACHABILITY, which is the half a source assertion cannot
 * show: a real file that produces both at once. The Workspace rule itself is
 * asserted on the source in `ui/src/__tests__/theSplitCarriesWhatTheOpenCarries.test.ts`,
 * the way `bothLoadDoorsAgreeOnTheType` does, since no runtime instrument here
 * reaches `openProject`.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, BOX_PLOT_AXES_CONFIG } from '../calibrationSession.js';
import { BOX_PLOT_SLOTS, OPPOSITE_CORNER_SLOTS } from '../axesTypeConfigs.js';
import { serializeProject, deserializeProject } from '../projectFile.js';
import { Dataset } from '../../core/dataset.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { isLayered } from '../layeredSeries.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A series holding one complete tuple under `names`. */
function seriesWithATuple(name: string, names: readonly string[], x: number): Dataset {
  const ds = new Dataset(names.length);
  ds.name = name;
  ds.setSlotNames([...names]);
  const tuple = ds.addTuple(ds.addPixel(x, 400))!;
  names.forEach((_, slot) => {
    if (slot === 0) return;
    ds.addToTupleAt(tuple, slot, ds.addPixel(x, 400 - slot * 30));
  });
  return ds;
}

/**
 * A Box Plot document carrying one box-shaped series and one bar-shaped one -
 * layered, and also exactly what `boxPlotSlotNotice` exists to announce
 * (*"a box plot whose slots are not the five cannot draw a box, so it says so"*).
 */
function layeredBoxPlotFile() {
  const calib = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
  calib.handleCalibrationClick(300, 500);
  calib.confirmCalibrationValues(['0']);
  calib.handleCalibrationClick(300, 100);
  calib.confirmCalibrationValues(['10']);
  walkCategoryAxis(calib, { count: 2 });
  expect(calib.runCalibration(), calib.getCalibrationError() ?? 'no error').toBe(true);

  const session = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
  session.loadCalibrated(
    calib.getAxes()!,
    [
      seriesWithATuple('Box series', BOX_PLOT_SLOTS, 250),
      seriesWithATuple('Bar series', OPPOSITE_CORNER_SLOTS, 350),
    ],
    calib.getCategoryAxis()
  );
  const file = serializeProject(session, PNG_DATA_URL);
  if ('error' in file) throw new Error(file.error);
  return file;
}

describe('a layered project can also carry a notice', () => {
  it('⚠️⚑⚑ the load door produces BOTH - so the split branch has one to carry', () => {
    const opened = deserializeProject(JSON.parse(JSON.stringify(layeredBoxPlotFile())));
    expect('error' in opened, 'the fixture did not open').toBe(false);
    const project = opened as Exclude<typeof opened, { error: string }>;

    expect(
      isLayered(project.datasets.map((d) => ({ name: d.name, slots: d.getSlotNames() }))),
      'the fixture is not layered, so it would never reach the offer'
    ).toBe(true);
    expect(project.notice, 'the fixture produced no notice to lose').toBeTruthy();
    expect(project.notice).toMatch(/box/i);
  });
});
