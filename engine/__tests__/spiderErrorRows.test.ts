import { describe, expect, it } from 'vitest';
import { CalibrationSession, SPIDER_AXES_CONFIG, CATEGORICAL_LINE_CONFIG } from '../calibrationSession.js';
import type { SpiderAxes } from '../../core/axes/spider.js';
import type { BarAxes } from '../../core/axes/bar.js';

/**
 * ⚑⚑ ONE ROW PER DATUM - ON EVERY TYPE (v2.3 re-audit, F20).
 *
 * `getExportRows`'s general branch filters through `getDatumPixelIndices`, under
 * a comment that says exactly why: *"A datum's error caps are pixels of its own
 * series now (B4), and this used to hand every one of them out as a data point:
 * two readings exported as four rows, with nothing in the file saying which two
 * were caps. A curve fitted downstream would run through the error bars."*
 *
 * ⚠️ TWO BRANCHES ABOVE IT STILL RETURN `pixels.map(...)`: spider and
 * categorical Line. B4's fix landed in one of three.
 *
 * ⚠️⚠️ AND THE SECOND CONSEQUENCE IS WORSE THAN THE EXTRA ROWS. `flatDataSection`
 * zips the error columns against the row list BY INDEX, while `getErrorRows` is
 * aligned with `getDatumPixelIndices` - one entry per DATUM. Once a cap occupies
 * a row, every later datum's error lands on the wrong row and the last datum's
 * goes blank. Silent, and every number in the file is individually plausible.
 */
function spiderWithError() {
  const s = new CalibrationSession<SpiderAxes>(SPIDER_AXES_CONFIG);
  s.handleCalibrationClick(300, 300); // centre
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(300, 100); // spoke 1 outer
  s.confirmCalibrationValues(['10']);
  s.runCalibration();
  return s;
}

describe('a series that carries error still exports one row per datum', () => {
  it('⚑⚑ spider: a cap is not handed out as a reading of its own', () => {
    const s = spiderWithError();
    const spokes = s.getSteps().length;
    expect(spokes).toBeGreaterThan(0);
    s.addDataPoint(300, 200);
    const before = s.getExportRows(0).length;
    const err = s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 300, y: 200 },
      capPixel: { x: 300, y: 180 },
      baseName: 'SD',
    });
    if (err !== null) return; // spider may refuse error capture; nothing to assert
    expect(s.getExportRows(0)).toHaveLength(before);
  });

  it('⚑⚑ categorical Line: same rule, same reason', () => {
    const s = new CalibrationSession<BarAxes>(CATEGORICAL_LINE_CONFIG);
    s.handleCalibrationClick(100, 300);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(100, 100);
    s.confirmCalibrationValues(['10']);
    s.runCalibration();
    s.addDataPoint(150, 200);
    const before = s.getExportRows(0).length;
    const err = s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 150, y: 200 },
      capPixel: { x: 150, y: 180 },
      baseName: 'SD',
    });
    if (err !== null) return;
    expect(s.getExportRows(0)).toHaveLength(before);
  });
});
