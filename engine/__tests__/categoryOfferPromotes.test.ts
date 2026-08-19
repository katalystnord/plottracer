import { describe, expect, it } from 'vitest';
import { categoryOffer } from '../categoryTickOverlay.js';
import { CalibrationSession, CATEGORICAL_LINE_CONFIG } from '../calibrationSession.js';
import { flatDataSection } from '../csvExport.js';
import type { BarAxes } from '../../core/axes/bar.js';

/**
 * THEME E / C: THE OFFER SPEAKS UP WHEN THE APP HAS EVIDENCE IT MATTERS.
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
  expect(s.runCalibration()).toBe(true);
  return s;
}

describe('C - the offer is quiet until there is something to pair', () => {
  it('a chart with one series is offered the ticks, quietly', () => {
    expect(categoryOffer(false, 0, 1)).toEqual({ text: 'Mark category ticks?', promoted: false });
  });

  it('a chart with nothing captured yet is quiet too - there is no evidence either way', () => {
    expect(categoryOffer(false, 0, 0)).toEqual({ text: 'Mark category ticks?', promoted: false });
  });

  it('⚑ a SECOND series carrying readings promotes the offer, and says what it saw', () => {
    const offer = categoryOffer(false, 0, 2);
    expect(offer.promoted).toBe(true);
    expect(offer.text).toBe('2 series - mark category ticks to pair them');
  });

  it('once the ticks exist the offer is over, and the line reports instead', () => {
    expect(categoryOffer(true, 1, 3)).toEqual({ text: 'Category ticks - 1 category', promoted: false });
    expect(categoryOffer(true, 5, 3)).toEqual({ text: 'Category ticks - 5 categories', promoted: false });
  });
});

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
    s.addDataPoint(150, 300);
    s.addDataPoint(250, 300);
    expect(s.getExportFields()[0]).toBe('Position');
  });

  it('⚑ two unmarked series export "Position (in series)" - the ordinal is real, the sharing is not', () => {
    const s = calibratedCategorical();
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
    // Mark the category axis: both edges and a count, the same way the card does.
    expect(s.markCategoryAxis({ x: 100, y: 500 }, { x: 500, y: 500 })).toBe(true);
    expect(s.setCategoryCount(4)).toBe(true);
    expect(s.getExportFields()[0]).toBe('Position');
  });
});
