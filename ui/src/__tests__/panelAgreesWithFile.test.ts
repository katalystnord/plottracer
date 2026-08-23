import { describe, expect, it } from 'vitest';
import { makeDisplayRounder } from '../../../core/displayPrecision.js';
import { editSeed, fmtValue } from '../format.js';
import { valueAtPixel } from '../../../core/exportValues.js';
import { XYAxes } from '../../../core/axes/xy.js';
import { Calibration } from '../../../core/calibration.js';

/**
 * ⚑⚑ THE PANEL AND THE FILE MUST REPORT THE SAME READING (v2.3).
 *
 * The export has rounded to about half a pixel in data units since B6; the data
 * panel never did. Measured 2026-08-23: `makeRounder` had exactly one non-test
 * caller in the tree. So a bar's value read `-7.95455` on screen and about `-8`
 * in the file, off the same two clicks.
 *
 * ⚑ FEWER DIGITS IS NOT THE POINT - AGREEMENT IS. Either rule alone is a defensible
 * choice; two surfaces answering the same question differently is a defect, and the
 * kind nobody reports because each surface looks reasonable on its own. So the
 * assertion here is an EQUALITY between the two paths, not a digit count.
 */

/** The bundled XY calibration: 100..400 px = 0..10 in x, 300..100 px = 0..20 in y. */
function axes(): XYAxes {
  const cal = new Calibration();
  cal.addPoint(100, 300, '0', '');
  cal.addPoint(400, 300, '10', '', '5');
  cal.addPoint(100, 300, '', '0');
  cal.addPoint(100, 100, '', '20', '4');
  const a = new XYAxes();
  expect(a.calibrate(cal, false, false, true)).toBe(true);
  return a;
}

describe('a number on screen is the number in the file', () => {
  it('⚑⚑ the panel rounds a reading exactly as the export does, at the same pixel', () => {
    const a = axes();
    const display = makeDisplayRounder(a);
    for (const [px, py] of [[137, 219], [251, 288], [399, 101], [100, 300]] as const) {
      const raw = a.pixelToData(px, py);
      // The file's own path, the one `getExportRows` calls.
      // `ExportValue` is the bare number (or a string label), not a wrapper.
      const file = valueAtPixel(0, a, { x: px, y: py, metadata: {} }, 'auto');
      expect(display.atPixel(px, py, raw, 0)).toBe(file[0]);
      expect(display.atPixel(px, py, raw, 1)).toBe(file[1]);
    }
  });

  it('⚑ it actually rounds - the raw double is longer than what is shown', () => {
    // Guards the equality above against the vacuous case: if `valueAtPixel` ever
    // stopped rounding, the test above would pass while both surfaces reported
    // full precision. So one case pins that a digit really was dropped.
    const a = axes();
    const raw = a.pixelToData(137, 219);
    const shown = makeDisplayRounder(a).atPixel(137, 219, raw, 0);
    expect(String(raw[0])).not.toBe(String(shown));
    expect(fmtValue(shown).length).toBeLessThan(fmtValue(raw[0]!).length);
  });

  it('⚑⚑ THE EDITOR STILL OPENS WITH THE WHOLE NUMBER (F23 must not come back)', () => {
    // The defect this rounding could recreate, and the reason the model keeps raw
    // values: F23 measured a `toFixed(3)` display feeding the editor, which turned
    // 0.00042 into 0 on a log axis, silently, on double-click-and-blur. A rounded
    // DISPLAY is fine; a rounded SEED moves the datum.
    const a = axes();
    const display = makeDisplayRounder(a);
    const raw = a.pixelToData(137, 219);
    expect(editSeed(raw[0])).toBe(String(raw[0]));
    expect(editSeed(raw[0])).not.toBe(String(display.atPixel(137, 219, raw, 0)));
  });

  it('⚑ a small value SURVIVES ON AN AXIS THAT CAN RESOLVE IT - the B6 defect', () => {
    // ⚠️ THE FIRST VERSION OF THIS TEST WAS WRONG AND THE CODE WAS RIGHT. It asked
    // for 0.0012 to survive on the axis above, which spans 0 to 10 over 300 px:
    // half a pixel there is about 0.017, so 0.0012 is genuinely finer than the
    // figure can resolve and rounding it away is the correct answer. B6's defect
    // was a FIXED two-decimal round applied whatever the axis - the whole point of
    // `halfPixelResolution` is that the step is LOCAL. So the case has to be posed
    // on an axis where the small value is really resolvable.
    const small = new Calibration();
    small.addPoint(100, 300, '0', '');
    small.addPoint(400, 300, '0.01', '', '5');
    small.addPoint(100, 300, '', '0');
    small.addPoint(100, 100, '', '0.02', '4');
    const a = new XYAxes();
    expect(a.calibrate(small, false, false, true)).toBe(true);
    const display = makeDisplayRounder(a);
    // One pixel is 0.01/300 here, so 0.0012 is dozens of pixels - real data.
    expect(display.scalarAtPixel(0.0012, 137, 219, 0)).not.toBe(0);
    expect(display.scalarAtPixel(0.0012, 137, 219, 0)).toBeCloseTo(0.0012, 5);
  });

  it('⚑ an UNCALIBRATED panel passes the number through rather than inventing a step', () => {
    const display = makeDisplayRounder(null);
    expect(display.atPixel(0, 0, [0.123456789], 0)).toBe(0.123456789);
    expect(display.atData([0.123456789], 0)).toBe(0.123456789);
  });

  it('⚑ the DATA route agrees with the pixel route on a linear axis', () => {
    // Why the tuple and bin tables may use `atData`: their own export sections do,
    // and on a linear axis the resolution is constant, so the route cannot matter.
    // If this ever diverges, a bar table has started disagreeing with its file.
    const a = axes();
    const display = makeDisplayRounder(a);
    const raw = a.pixelToData(251, 288);
    expect(display.atData(raw, 0)).toBe(display.atPixel(251, 288, raw, 0));
    expect(display.atData(raw, 1)).toBe(display.atPixel(251, 288, raw, 1));
  });
});
