/**
 * ⚑⚑ A SPAN CARRIES ERROR ON EACH END - the case the whole per-value rework is
 * for, driven through the session exactly as the user's hands drive it.
 *
 * David, 2026-09-03: *"A floating bar chart is just a bar chart, but with two
 * ends on the span. And error bars work exactly the same, on each end."*
 *
 * ⚠️ BEFORE THIS, THE SECOND CAP DESTROYED THE FIRST. `ERROR_ROLES` was
 * appended ONCE to a tuple, so 'SD upper' was a single slot: an upper cap on the
 * low end and an upper cap on the high end were the same member, and the second
 * capture MOVED the first (`write`'s re-capture branch) rather than adding to
 * it. The figure's lower uncertainty simply left the record, with every
 * remaining number plausible - and the app refused the gesture outright, so
 * nobody would have met it. Both halves are fixed here.
 *
 * ⚑ WHICH END A CAP BELONGS TO IS MEASURED, NOT ASKED: the drag starts on one
 * of the two corners, and the UI has already snapped that start to a point of
 * the series. See `tupleIndexAtDatum`.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, type CalibratedAxes } from '../calibrationSession.js';
import { calibratedHealthy } from './fixtures/anyType.js';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';

const SPAN = ALL_AXES_TYPE_CONFIGS.find((c) => c.id === 'span')!;

/** A span whose single tuple has both corners placed: a floating bar from
 *  (300, 260) up to (300, 180) in image pixels. */
function spanWithOneBar(): {
  session: CalibrationSession<CalibratedAxes>;
  low: { px: number; py: number };
  high: { px: number; py: number };
} {
  const session = calibratedHealthy('span', SPAN);
  session.addDataPoint(300, 260);
  session.addDataPoint(300, 180);
  const points = session.getDataPoints();
  return { session, low: points[0]!, high: points[1]! };
}

describe('a span carries error on each end', () => {
  it('accepts a cap on the low end and a cap on the high end', () => {
    const { session, low, high } = spanWithOneBar();
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: low.px, y: low.py },
        capPixel: { x: low.px, y: low.py + 20 },
        baseName: 'SD',
      }),
      'the low end refused a cap'
    ).toBeNull();
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: high.px, y: high.py },
        capPixel: { x: high.px, y: high.py - 20 },
        baseName: 'SD',
      }),
      'the high end refused a cap'
    ).toBeNull();
  });

  it('keeps the two ends\' readings apart instead of overwriting one with the other', () => {
    const { session, low, high } = spanWithOneBar();
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: low.px, y: low.py },
      capPixel: { x: low.px, y: low.py + 20 },
      baseName: 'SD',
    });
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: high.px, y: high.py },
      capPixel: { x: high.px, y: high.py - 20 },
      baseName: 'SD',
    });

    // Four columns: an upper and a lower on EACH end, named after the end.
    const labels = session.getErrorColumns(0).map((c) => c.label);
    // ⚑⚑ NAMED FOR THE REPORTED END, not the corner the hand grabbed. The
    // table's value columns say Min and Max, so its error columns say Min and
    // Max: what refers to what is visible without being told.
    expect(labels).toEqual([
      'Min SD upper',
      'Min SD lower',
      'Max SD upper',
      'Max SD lower',
    ]);

    // ⚑ And they carry DIFFERENT readings - the low end's caps sit below the
    // high end's. A single shared slot would have made these equal, which is
    // exactly how the loss would have looked in the file.
    const row = session.getErrorRowsByTuple(0)[0];
    expect(row, 'the tuple recorded no error at all').not.toBeNull();
    const [lowUpper, lowLower, highUpper, highLower] = row!;
    for (const v of [lowUpper, lowLower, highUpper, highLower]) expect(v).not.toBeNull();
    expect(lowUpper).not.toBeCloseTo(highUpper as number, 6);
    expect(lowLower).not.toBeCloseTo(highLower as number, 6);
    // The span runs upward on screen, so the high end's readings are the larger.
    expect(highUpper as number).toBeGreaterThan(lowUpper as number);
  });

  it('draws a whisker set at each end rather than both at the first corner', () => {
    const { session, low, high } = spanWithOneBar();
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: low.px, y: low.py },
      capPixel: { x: low.px, y: low.py + 20 },
      baseName: 'SD',
    });
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: high.px, y: high.py },
      capPixel: { x: high.px, y: high.py - 20 },
      baseName: 'SD',
    });
    // Two ends, each with a cap and its mirror.
    expect(session.getErrorWhiskers().length).toBe(4);
  });

  it('declares its two ends in the config rather than being special-cased', () => {
    expect(SPAN.errorValueSlots).toEqual([0, 1]);
    expect(SPAN.errorBarsRefusal, 'a span no longer refuses error bars').toBeUndefined();
  });

  it('files each cap under the end it belongs to even when the corners were dragged high-first', () => {
    // ⚑⚑ THE CASE `endColumnOrder` EXISTS FOR. The record stores error against
    // the CORNER; the table reports the ends SORTED. Capture the high corner
    // FIRST and the two orders disagree - so corner 0's cap must appear under
    // `Max`, not under `Min`. Without the mapping the Min column carries one
    // corner's value beside the other corner's uncertainty, every number
    // plausible and nothing on screen saying which pair belong together.
    const session = calibratedHealthy('span', SPAN);
    session.addDataPoint(300, 180); // the HIGH end, captured first
    session.addDataPoint(300, 260); // the low end
    const [high, low] = session.getDataPoints();

    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: high!.px, y: high!.py },
      capPixel: { x: high!.px, y: high!.py - 20 },
      baseName: 'SD',
    });
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: low!.px, y: low!.py },
      capPixel: { x: low!.px, y: low!.py + 20 },
      baseName: 'SD',
    });

    // Min first, Max second - the order the VALUES are reported in, not the
    // order the hand captured them.
    const columns = session.getErrorColumns(0);
    expect(columns.map((c) => c.label)).toEqual([
      'Min SD upper',
      'Min SD lower',
      'Max SD upper',
      'Max SD lower',
    ]);

    const row = session.getErrorRowsByTuple(0)[0];
    expect(row, 'the tuple recorded no error at all').not.toBeNull();
    const [minUpper, , maxUpper] = row!;
    // The Min column's readings must be the LOWER pair, whichever corner was
    // dragged first. Reversed filing would swap exactly these two.
    expect(maxUpper as number).toBeGreaterThan(minUpper as number);
  });
});
