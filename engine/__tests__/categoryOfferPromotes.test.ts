import { describe, expect, it } from 'vitest';
import { CalibrationSession, CATEGORICAL_LINE_CONFIG } from '../calibrationSession.js';
import { flatDataSection } from '../csvExport.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { loadWithoutCategoryAxis } from './helpers/noCategoryAxis.js';

/**
 * ⛔⛔ THE OFFER IS GONE, AND ITS PREMISE WITH IT (v2.4). This file used to open
 * by asserting that *"marking categories is not always needed, and the app knows
 * which is which"* - one series quiet, a second series promoted. David settled
 * that the other way: the category axis is a REQUIREMENT, calibrated in the walk
 * like the value axis, so there is no offer to promote and no unmarked state to
 * reason about on a chart being captured now.
 *
 * ⚑ WHAT SURVIVES, AND WHY. The export half below is about what a FILE claims,
 * and it still has a job: a project SAVED before this change can be reopened
 * with an unmarked axis, and its ordinal must still not be called a coordinate
 * two series share. The claim is checked at the file, where it is made.
 *
 * THEME E / C, as it now stands:
 *
 * ⚑⚑ MARKING CATEGORIES IS NOT ALWAYS NEEDED, AND THE APP KNOWS WHICH IS WHICH.
 * One series with every reading present: the left-to-right ordinal is a faithful
 * statement about that series' own pixels, and marking adds nothing. A SECOND
 * series: the ordinal stops being a within-series fact and starts being used as
 * a coordinate the two share - which it is not. A series missing one category
 * slides every later reading one place, every number plausible, nothing on
 * screen wrong (the tenet-11 failure `Line` was fixed for).
 *
 * ⚠️ SO THE TRIGGER IS EVIDENCE, NOT PREDICTION. It fires on what has been
 * captured - how many series carry readings - never on what the user might do.
 *
 * ⛔ AND IT DOES NOT BLOCK. David: *"would it in fact always happen?"* - no, and
 * tenet 1 settles the rest: nothing may put constraints on graph in -> reliable
 * data out. What changes is what the card SAYS and what the file CLAIMS, never
 * what the user is allowed to do.
 */

/** Categorical line: the value axis calibrated 0 @ y=500, 10 @ y=100. */
function calibratedCategorical(): CalibrationSession<BarAxes> {
  const s = new CalibrationSession<BarAxes>(CATEGORICAL_LINE_CONFIG);
  s.handleCalibrationClick(300, 500);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100);
  s.confirmCalibrationValues(['10']);
  // ⚑ THE CATEGORY AXIS IS PART OF THE WALK NOW - two clicks and a count, the
  // same four steps a user makes. A fixture that stopped at the value axis is a
  // fixture describing a state the app can no longer be in.
  s.handleCalibrationClick(100, 500);
  s.handleCalibrationClick(500, 500);
  s.confirmCalibrationValues(['4']);
  expect(s.runCalibration()).toBe(true);
  return s;
}

describe('C - the session counts what was actually captured', () => {
  it('counts only series that carry a reading', () => {
    const s = calibratedCategorical();
    expect(s.seriesWithReadings()).toBe(0);
    s.addDataPoint(150, 300);
    expect(s.seriesWithReadings()).toBe(1);
    s.addDataset();
    // An EMPTY second series is not evidence of anything - it is a series
    // nobody has read yet.
    expect(s.seriesWithReadings()).toBe(1);
    s.setActiveDataset(1);
    s.addDataPoint(250, 300);
    expect(s.seriesWithReadings()).toBe(2);
  });
});

describe('C - the file stops claiming a coordinate the series do not share', () => {
  it('one unmarked series exports Position, because within a series it is true', () => {
    const s = calibratedCategorical();
    loadWithoutCategoryAxis(s, s.getAxes()!, s.getDatasets());
    s.addDataPoint(150, 300);
    s.addDataPoint(250, 300);
    expect(s.getExportFields()[0]).toBe('Position');
  });

  it('⚑ two unmarked series export "Position (in series)" - the ordinal is real, the sharing is not', () => {
    const s = calibratedCategorical();
    // ⚑⚑ THE UNMARKED STATE IS REACHED THROUGH THE FILE DOOR, because the
    // walk can no longer produce it: a calibrated bar-family figure has its
    // category axis by construction since v2.4. What it describes is a WPD
    // IMPORT - permanent, not a legacy file - and the file door is the entrance
    // this project has been bitten through repeatedly.
    loadWithoutCategoryAxis(s, s.getAxes()!, s.getDatasets());
    s.addDataPoint(150, 300);
    s.addDataset();
    s.setActiveDataset(1);
    s.addDataPoint(250, 300);
    expect(s.getExportFields()[0]).toBe('Position (in series)');
    const section = flatDataSection(s.getExportRows(0), s.getExportFields());
    expect(section.header[2]).toBe('Position (in series)');
  });

  it('⚑ marking the axis makes it shared again, and the heading says so', () => {
    const s = calibratedCategorical();
    s.addDataPoint(150, 300);
    s.addDataset();
    s.setActiveDataset(1);
    s.addDataPoint(250, 300);
    // ⚑ Already marked - the walk did it. That IS the change: `Position` is
    // shared by construction now, because a calibrated bar-family figure cannot
    // be missing its category axis.
    expect(s.getCategoryAxis().hasGeometry()).toBe(true);
    expect(s.getExportFields()[0]).toBe('Position');
  });
});
