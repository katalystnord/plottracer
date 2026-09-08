/**
 * ⚑⚑ A FILE THAT SAYS CANDLESTICK AND DOES NOT CARRY A CANDLE SAYS SO.
 *
 * Every candlestick mechanism - the overlay, the direction read, the flip -
 * gates on the slot names being exactly `Low, Open, Close, High` and returns
 * QUIETLY when they are not. Nothing on the load path checked that a file
 * declaring the type carries them.
 *
 * ⚠️ So a hand-edited or foreign file opened as a candlestick that could never
 * draw a candle and never have its direction read - and worse, the tuple holds
 * only as many marks as there are slots, so measured pixels sat in the dataset
 * unreachable from every panel and every export, with nothing on screen saying
 * a reading had gone missing. Measured: four pixels in, a two-slot tuple out.
 *
 * ⚑ SURFACED, NOT REFUSED - this module's standing posture for a file that is
 * merely odd ("visible and recoverable beats silent and plausible"). The
 * measurements are in the file and refusing it would strand them.
 */
import { describe, expect, it } from 'vitest';
import { candlestickSlotNotice, serializeProject, deserializeProject } from '../projectFile.js';
import { Dataset } from '../../core/dataset.js';
import {
  CalibrationSession,
  CANDLESTICK_AXES_CONFIG,
  type CalibratedAxes,
} from '../calibrationSession.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

function seriesWith(slots: string[]): Dataset {
  const d = new Dataset(1);
  d.setSlotNames(slots);
  return d;
}

const FOUR = ['Low', 'Open', 'Close', 'High'];

describe('a candlestick file that cannot hold a candle says so', () => {
  it('says so when a series carries the wrong number of slots', () => {
    const notice = candlestickSlotNotice('candlestick', [seriesWith(['Low', 'Open'])]);
    expect(notice, 'a two-slot candlestick opened silently').toBeTruthy();
    expect(notice).toMatch(/four marks/i);
    // ⚑ It says the readings are safe, because they are - the whole reason this
    // surfaces rather than refuses.
    expect(notice).toMatch(/readings themselves are untouched/i);
  });

  it('says so when the slots are the right COUNT under the wrong names', () => {
    // ⚑ The gate is on the names, not the count - `Min/Q1/Median/Q3` would pass
    // a count check and still draw nothing.
    expect(candlestickSlotNotice('candlestick', [seriesWith(['A', 'B', 'C', 'D'])])).toBeTruthy();
  });

  it('⚑ stays quiet for a real candlestick - the companion assertion', () => {
    expect(candlestickSlotNotice('candlestick', [seriesWith(FOUR)])).toBeNull();
  });

  it('⚑ and says nothing at all about any other type', () => {
    // A box plot's five slots are not this function's business, and a bar that
    // was relabelled to Span must never be told about slots Span has no idea of.
    expect(candlestickSlotNotice('boxplot', [seriesWith(['Min', 'Q1', 'Median', 'Q3', 'Max'])])).toBeNull();
    expect(candlestickSlotNotice('span', [seriesWith(['Corner', 'Opposite corner'])])).toBeNull();
  });

  it('counts the series it is talking about, so a multi-series file is specific', () => {
    const notice = candlestickSlotNotice('candlestick', [
      seriesWith(FOUR),
      seriesWith(['Low', 'Open']),
      seriesWith(['Low']),
    ]);
    expect(notice).toMatch(/2 of its series/);
  });

  /**
   * ⚑⚑ AND THE LOAD DOOR ACTUALLY ASKS IT. A refusal that exists and is never
   * called is the exact failure this whole audit kept finding, so the wiring is
   * asserted through the real door rather than assumed from the function.
   */
  it('⚑⚑ reaches the user through the real load door', () => {
    const s = new CalibrationSession<CalibratedAxes>(CANDLESTICK_AXES_CONFIG as never);
    s.handleCalibrationClick(300, 400);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(300, 100);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s, { from: { x: 200, y: 400 }, to: { x: 500, y: 400 }, count: 2 });
    s.runCalibration();
    for (const y of [370, 340, 310, 280]) s.addDataPoint(250, y);

    const file = serializeProject(s, 'data:image/png;base64,AA==', 'f.png');
    if ('error' in file) throw new Error(file.error);
    const good = deserializeProject(JSON.parse(JSON.stringify(file)));
    if ('error' in good) throw new Error(good.error);
    expect(good.notice, 'a real candlestick opens with nothing to say').toBeUndefined();

    // The hand-edited case: the same file with two of its slot names removed.
    const edited = JSON.parse(JSON.stringify(file));
    const ds = edited.plotData.datasetColl[0];
    ds.groupNames = ds.groupNames.slice(0, 2);
    const back = deserializeProject(edited);
    if ('error' in back) throw new Error(back.error);
    expect(back.configId, 'it still opens - surfaced, not refused').toBe('candlestick');
    expect(back.notice, 'and it says what is wrong with it').toMatch(/four marks/i);
  });
});
