/**
 * ⚑⚑ ERROR BARS ON ONE SERIES DO NOT MAKE IT A DIFFERENT KIND OF SERIES.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-15, against the layered-project offer added the
 * evening before. `layeredProjectOffer` is asked for each series' shape, and
 * both the session (`getLayeredProjectOffer`) and the split in `Workspace.tsx`
 * answered it with `Dataset.getSlotNames()` - the RAW list, error tail included.
 *
 * Capturing one error cap calls `adoptSlots`, which appends `SD upper`,
 * `SD lower`, ... to THAT series alone. So an ordinary bar chart with error bars
 * on one of its two series answered two different shapes, was declared to hold
 * *"series of different kinds"*, and its owner was offered the split of a
 * project PlotTracer supports completely.
 *
 * ⚑ THE APP ALREADY HAS THE ANSWER AND IT WAS NOT USED (the reuse rule).
 * `ownSlotNames` exists for exactly this question, under the heading *"error
 * slots are an addition to a SERIES, not a change of what the series IS"*, and
 * every other consumer of a series' shape goes through
 * `CalibrationSession.ownSlots`, which calls it. The new door asked the raw list.
 *
 * ⚑ The same mistake reaches `typeForSlots`: a Box-Plot series carrying error
 * caps carries `Min ... Max, SD upper, SD lower`, which matches no type's
 * `defaultSlots`, so a split figure of box plots would have gone back to being
 * declared Bar - the very defect `18e9d7d` fixed, returning through the tail.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, BAR_AXES_CONFIG } from '../calibrationSession.js';
import { BOX_PLOT_SLOTS, OPPOSITE_CORNER_SLOTS, ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';
import { errorSlotNames } from '../../algorithms/errorExtent.js';
import { isLayered, layeredProjectOffer, typeForSlots } from '../layeredSeries.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/** An upright bar chart: y 0..10 over py 300..100, four categories along y=500. */
function barSession() {
  const s = new CalibrationSession(BAR_AXES_CONFIG);
  for (const [px, py, v] of [
    [100, 300, '0'],
    [100, 100, '10'],
  ] as Array<[number, number, string]>) {
    expect(s.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues([v])).toBe(true);
  }
  walkCategoryAxis(s);
  expect(s.runCalibration()).toBe(true);
  return s;
}

/**
 * Two bar series, both plain bars, one of them carrying an error cap - which is
 * an ORDINARY project: the app builds it, the table shows it, and it is the
 * shape v2.3's error-bar work exists to record.
 */
function twoBarSeriesOneWithError() {
  const s = barSession();
  s.addDataPoint(150, 200);
  s.addDataset('Series 2');
  s.addDataPoint(250, 200);
  s.setActiveDataset(0);
  expect(
    s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 150, y: 200 },
      capPixel: { x: 150, y: 160 },
      baseName: 'SD',
    })
  ).toBeNull();
  return s;
}

describe('a series carrying error bars is the same kind as its plain sibling', () => {
  it('⚠️⚑⚑ an ordinary bar chart with error on one series is NOT offered the split', () => {
    const s = twoBarSeriesOneWithError();
    // The premise, so a failure here reads as the fixture and not the rule.
    expect(s.getDatasets()[0]!.getSlotNames(), 'the fixture captured no cap').not.toEqual([]);
    expect(s.getLayeredProjectOffer()).toBeNull();
  });

  it('⚑ the module says the same thing when asked directly', () => {
    expect(
      isLayered([
        { name: 'With error', slots: errorSlotNames('SD', OPPOSITE_CORNER_SLOTS) },
        { name: 'Plain', slots: OPPOSITE_CORNER_SLOTS },
      ])
    ).toBe(false);
    expect(
      layeredProjectOffer([
        { name: 'With error', slots: errorSlotNames('95% CI', BOX_PLOT_SLOTS) },
        { name: 'Plain', slots: BOX_PLOT_SLOTS },
      ])
    ).toBeNull();
  });

  it('⚑⚑ and a split figure of box plots carrying error still declares Box Plot', () => {
    const TYPES = ALL_AXES_TYPE_CONFIGS.map((c) => ({
      id: c.id,
      axesKind: c.axesKind,
      ...(c.defaultSlots ? { defaultSlots: c.defaultSlots } : {}),
    }));
    const BAR = TYPES.find((t) => t.id === 'bar')!;
    expect(typeForSlots(errorSlotNames('SD', BOX_PLOT_SLOTS), TYPES, BAR)).toBe('boxplot');
  });

  it('⚑ two genuinely different kinds are still reported', () => {
    // The companion assertion: stripping the error tail must not blind the
    // offer to the case it exists for.
    expect(
      isLayered([
        { name: 'A bar', slots: [] },
        { name: 'A box plot', slots: BOX_PLOT_SLOTS },
      ])
    ).toBe(true);
  });
});
