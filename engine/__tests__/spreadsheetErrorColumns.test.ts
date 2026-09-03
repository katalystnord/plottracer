/**
 * B4, the UI half - ⚑⚑ A DATUM'S CAPS ARE COLUMNS ON ITS OWN ROW.
 *
 * This is where the old model's worst symptom was visible, so it is where the
 * fix has to become visible. Three series stacked side by side implied a
 * pairing the model did not hold:
 *
 *     row | Series 1 x | SD upper        | SD lower
 *     1   | 4.96       | x=4.93 y=8.028  | x=4.93 y=8.025
 *     2   | 10.02      | x=4.93 y=9.561  | x=4.93 y=6.492
 *
 * Every cap belonged to point 1; the layout showed point 1's caps beside the
 * datum at x = 10. David: *"The workflow is just not amenable to do that."* It
 * misled me three times in one session too - I told him his capture was wrong
 * when it was substantially right.
 *
 * ⚑ TWO THINGS MUST BE TRUE, and the second is the one that bites. The caps
 * must appear as columns on the datum's row - and they must STOP appearing as
 * ROWS, because under B4 a cap is a pixel of the series it belongs to, so the
 * table that lists a series' pixels lists its caps as data points.
 *
 * ⚑ ABSOLUTES, not deltas, and that was measured rather than chosen:
 * `docs/generator-input-formats.md` - ggplot's `geom_errorbar` takes ymin/ymax
 * outright, and in the delta form "no lower bound" and "a bound of size zero"
 * are the same number, which is tenet 9's exact failure. The record holds
 * absolutes; the delta is a projection the EXPORT carries alongside.
 *
 * ⚑ A ROLE GETS A COLUMN WHEN IT WAS MEASURED. All four roles always exist in
 * the record, but a vertical-error figure has nothing to say about left and
 * right, and four columns of blanks assert an emptiness nobody looked for
 * (pattern 3: assert only what was measured).
 */
import { describe, it, expect } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, type CalibratedAxes } from '../calibrationSession.js';
import { buildSpreadsheetSeries } from '../spreadsheetModel.js';
import type { XYAxes } from '../../core/axes/xy.js';

/** x 0..10 over px 100..400; y 0..10 over py 250..100. */
function sessionXY(): CalibrationSession<XYAxes> {
  const s = new CalibrationSession(XY_AXES_CONFIG);
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
  return s;
}

function modelFor(s: CalibrationSession<XYAxes>) {
  const sess = s as unknown as CalibrationSession<CalibratedAxes>;
  return buildSpreadsheetSeries(s.getAllDatasetsData(), s.getDatasetInfos(), sess);
}

/** Two datums; the FIRST carries a vertical error bar, the second none. */
function twoPointsFirstWithError() {
  const s = sessionXY();
  s.addDataPoint(250, 175); // (5, 5)
  s.captureErrorCap({
    targetIndex: 0,
    datumPixel: { x: 250, y: 175 },
    capPixel: { x: 250, y: 145 }, // y = 7
    baseName: 'SD',
  });
  s.addDataPoint(340, 220); // (8, 2)
  return s;
}

describe("a cap is a column on its datum's row, not a row of its own", () => {
  it('⚑ the series has one row per DATUM', () => {
    const [only] = modelFor(twoPointsFirstWithError());
    expect(only!.values).toHaveLength(2);
    expect(only!.values[0]![0]).toBeCloseTo(5, 6);
    expect(only!.values[0]![1]).toBeCloseTo(5, 6);
    expect(only!.values[1]![0]).toBeCloseTo(8, 6);
    expect(only!.values[1]![1]).toBeCloseTo(2, 6);
  });

  it('⚑⚑ a row still addresses its own PIXEL, so a click selects the right point', () => {
    // Row index stopped being pixel index the moment caps became pixels of the
    // series. Every outward call from the table -- select, nudge, rename, edit a
    // value -- takes a pixel index, so a row that does not carry its own would
    // silently address the point two along. That is A2's shape ("the link is ROW
    // index -> active series when it must be CELL -> (series, row)"), and it
    // lands on a real point, so nothing would look broken.
    const s = twoPointsFirstWithError();
    const [only] = modelFor(s);
    expect(only!.pixelIndices).toHaveLength(2);
    const pixels = s.getDataset().getAllPixels();
    expect(pixels[only!.pixelIndices[0]!]).toMatchObject({ x: 250, y: 175 });
    expect(pixels[only!.pixelIndices[1]!]).toMatchObject({ x: 340, y: 220 });
  });

  it('⚑ a series with no error is row-for-pixel exactly as before', () => {
    const s = sessionXY();
    s.addDataPoint(250, 175);
    s.addDataPoint(340, 220);
    const [only] = modelFor(s);
    expect(only!.pixelIndices).toEqual([0, 1]);
    expect(only!.errorColumns).toEqual([]);
    expect(only!.errorValues).toEqual([[], []]);
  });
});

describe("the error columns carry the user's own word", () => {
  it('⚑ one column per role that was MEASURED, named as the record names it', () => {
    const [only] = modelFor(twoPointsFirstWithError());
    // Upper AND lower: the capture mirrors the cap into the empty opposite slot
    // as a starting position, so both were recorded. Left and right were not
    // touched, and get no column.
    expect(only!.errorColumns).toEqual([
      { role: 'upper', valueIndex: 0, label: 'SD upper' },
      { role: 'lower', valueIndex: 0, label: 'SD lower' },
    ]);
  });

  it('⚑ the values are ABSOLUTE positions on the value axis', () => {
    const [only] = modelFor(twoPointsFirstWithError());
    expect(only!.errorValues[0]![0]).toBeCloseTo(7, 6); // upper cap
    expect(only!.errorValues[0]![1]).toBeCloseTo(3, 6); // mirrored lower
  });

  it('⚑ a datum with no error reads BLANK, never 0', () => {
    // 0 is a measurement nobody took, and it renders as a plausible little cap.
    const [only] = modelFor(twoPointsFirstWithError());
    expect(only!.errorValues[1]).toEqual([null, null]);
  });

  it('⚑ a horizontal cap adds its own column, and only then', () => {
    const s = twoPointsFirstWithError();
    s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 340, y: 220 },
      capPixel: { x: 370, y: 220 }, // x = 9
      baseName: 'SD',
    });
    const [only] = modelFor(s);
    expect(only!.errorColumns.map((c) => c.role)).toEqual(['upper', 'lower', 'left', 'right']);
    const right = only!.errorColumns.findIndex((c) => c.role === 'right');
    expect(only!.errorValues[1]![right]).toBeCloseTo(9, 6);
    expect(only!.errorValues[0]![right], 'the first datum has no horizontal bar').toBeNull();
  });
});

describe('the other series are unaffected', () => {
  it('⚑ a second series without error keeps its own rows', () => {
    const s = twoPointsFirstWithError();
    s.addDataset('Series 2');
    s.setActiveDataset(1);
    s.addDataPoint(160, 200);
    const model = modelFor(s);
    expect(model[0]!.values).toHaveLength(2);
    expect(model[1]!.values).toHaveLength(1);
    expect(model[1]!.errorColumns).toEqual([]);
  });
});
