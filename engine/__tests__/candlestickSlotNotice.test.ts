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
import {
  candlestickSlotNotice,
  boxPlotSlotNotice,
  orphanedMarksNotice,
  serializeProject,
  deserializeProject,
} from '../projectFile.js';
import { Dataset } from '../../core/dataset.js';
import {
  CalibrationSession,
  CANDLESTICK_AXES_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  PIE_AXES_CONFIG,
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

/**
 * ⚑⚑ THE SAME GUARD, FOR THE OTHER TYPE THAT GATES ON EXACT SLOT NAMES.
 *
 * ⚠️ The candlestick guard was never generalised. `getBoxPlotGlyphs` returns
 * nothing unless the slots are exactly Min/Q1/Median/Q3/Max - the identical
 * silent failure - and nothing at the load door asked. Measured: a box plot
 * whose `groupNames` were renamed loaded with all five readings intact and no
 * box that could ever draw, `notice=undefined`.
 *
 * ⚑ AND ONLY THESE TWO TYPES. Bar and Span declare `defaultSlots` too, but a
 * bar RESHAPED to a box plot's five slots is a legitimate record - `isReshaped`
 * exists to say so - and a notice on every reshaped bar would be a false alarm,
 * which is worse than none.
 */
describe('a box plot that cannot draw a box says so', () => {
  it('says so when the five values are renamed', () => {
    const notice = boxPlotSlotNotice('boxplot', [seriesWith(['A', 'B', 'C', 'D', 'E'])]);
    expect(notice, 'a box plot with no box opened silently').toBeTruthy();
    expect(notice).toMatch(/five values/i);
    expect(notice).toMatch(/readings themselves are untouched/i);
  });

  it('⚑ stays quiet for a real box plot - the companion assertion', () => {
    expect(boxPlotSlotNotice('boxplot', [seriesWith(['Min', 'Q1', 'Median', 'Q3', 'Max'])])).toBeNull();
  });

  it('⚑ and says nothing about a BAR reshaped to those same five slots', () => {
    // The false alarm this guard must not raise: a reshaped bar is a record the
    // app itself produces, through `applyBoxPlotGroups`.
    expect(boxPlotSlotNotice('bar', [seriesWith(['Min', 'Q1', 'Median', 'Q3', 'Max'])])).toBeNull();
    expect(boxPlotSlotNotice('span', [seriesWith(['Corner', 'Opposite corner'])])).toBeNull();
  });
});

/**
 * ⚑⚑ A MEASUREMENT THE FILE HOLDS AND NO VALUE CLAIMS.
 *
 * ⚠️ `core/plotData.ts` files a pixel under a slot only while `group <
 * slotCount`, so a file whose `groupNames` is SHORTER than the marks it carries
 * loads every pixel and files only some. `getTupleRows` IS the data panel and
 * every export, so a reading present in the file reaches no panel, no table and
 * no file saved next - with nothing saying a measurement went missing.
 * Measured on a real box plot: five marks in the file, three cells out.
 */
describe('marks the file holds that nothing claims', () => {
  /** A real box plot, walked through the app's own path so its marks are FILED
   *  under slots - which is the thing `addPixel` alone does not do, and the
   *  reason the first draft of this test reported every mark as orphaned. */
  function boxPlotFile(): Record<string, unknown> {
    const s = new CalibrationSession<CalibratedAxes>(BOX_PLOT_AXES_CONFIG as never);
    s.handleCalibrationClick(300, 400);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(300, 100);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s, { from: { x: 200, y: 400 }, to: { x: 500, y: 400 }, count: 2 });
    expect(s.runCalibration(), s.getCalibrationError() ?? 'no error').toBe(true);
    for (const y of [380, 340, 300, 260, 220]) s.addDataPoint(250, y);
    const file = serializeProject(s, 'data:image/png;base64,AA==', 'f.png');
    if ('error' in file) throw new Error(file.error);
    return JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
  }

  it('⚑⚑ counts a reading that no value in the file claims', () => {
    const raw = boxPlotFile() as { plotData: { datasetColl: { groupNames: string[] }[] } };
    const before = deserializeProject(JSON.parse(JSON.stringify(raw)));
    if ('error' in before) throw new Error(before.error);
    expect(before.notice, 'an intact box plot has nothing to report').toBeUndefined();

    // The hand-edited case the audit measured: five marks, three names.
    raw.plotData.datasetColl[0]!.groupNames = raw.plotData.datasetColl[0]!.groupNames.slice(0, 3);
    const back = deserializeProject(raw as unknown as Record<string, unknown>);
    if ('error' in back) throw new Error(back.error);
    // ⚑⚑ ANCHORED, because `/2 measured marks/` also matches "-2 measured
    // marks" - and mutation testing proved it: flipping `orphaned +=` to `-=`
    // SURVIVED this assertion. A count that can go negative is a count nobody
    // is really checking.
    expect(back.notice, 'two unreachable readings passed in silence').toMatch(
      /(^|\s)2 measured marks/
    );
    // ⚑ It counts, it does not repair: which value an orphaned mark belongs to
    // is exactly what the file failed to say.
    expect(back.notice).toMatch(/Nothing has been changed or discarded/i);
  });

  it('⚑ says nothing when every mark is filed - the companion assertion', () => {
    const ds = seriesWith(['Min', 'Q1', 'Median']);
    expect(orphanedMarksNotice([ds])).toBeNull();
  });

  it('⚑ counts ONE mark in the singular, and never a negative number', () => {
    // Mutation testing found both of these unguarded: the plural choice and the
    // sign of the sum could each be flipped with the suite still green.
    const raw = boxPlotFile() as { plotData: { datasetColl: { groupNames: string[] }[] } };
    raw.plotData.datasetColl[0]!.groupNames = raw.plotData.datasetColl[0]!.groupNames.slice(0, 4);
    const back = deserializeProject(raw as unknown as Record<string, unknown>);
    if ('error' in back) throw new Error(back.error);
    expect(back.notice).toMatch(/(^|\s)1 measured mark(?!s)/);
    expect(back.notice, 'a negative count reached the user').not.toMatch(/-[0-9]+ measured/);
  });

  it('⚑ a PIE, whose sectors chain, is not accused of losing marks', () => {
    // ⚠️⚑ I ADDED THIS BELIEVING A PIE FILES MORE MARKS THAN IT HOLDS - the
    // sectors chain, so I assumed one pixel INDEX was filed into two tuples and
    // that the `held > filed` guard was defending against a negative count.
    // Measured, and it is not so: `held 7, filed 7, tuples [[0,1],[2,3],[4,5],
    // [6,null]]`. The chaining adds ANOTHER pixel rather than re-filing the same
    // index, so `filed` never exceeds `held` and that guard's mutants are
    // EQUIVALENT - they differ only in a case the model cannot produce.
    // ▶ The test earns its place anyway, as the assertion that the commonest
    // chained-tuple type raises no false alarm. The claim it was written on was
    // simply wrong, and saying so is cheaper than leaving a comment that lies.
    const s = new CalibrationSession<CalibratedAxes>(PIE_AXES_CONFIG as never);
    s.handleCalibrationClick(420, 200);
    s.handleCalibrationClick(300, 320);
    s.handleCalibrationClick(180, 200);
    expect(s.runCalibration(), s.getCalibrationError() ?? 'no error').toBe(true);
    // Three boundaries, two slices - the middle pixel belongs to both.
    s.addDataPoint(420, 200);
    s.addDataPoint(300, 320);
    s.addDataPoint(180, 200);
    expect(orphanedMarksNotice([s.getDataset()]), 'a pie was told it lost marks').toBeNull();
  });

  it('⚑ and ignores a series with no slots at all, which is most of them', () => {
    const plain = new Dataset(2);
    plain.addPixel(10, 10);
    plain.addPixel(20, 20);
    expect(orphanedMarksNotice([plain])).toBeNull();
  });
});
