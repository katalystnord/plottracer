import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, BAR_AXES_CONFIG } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';
import { getErrorRelation } from '../errorRelation.js';
import { slotForRole, deltasFromBar } from '../../algorithms/errorExtent.js';

/** The same 4-point setup the rest of engine/'s tests use: a pixel maps to data
 * as x = (px-100)/30, y = (250-py)/15. */
function calibrateStandardXY(session: CalibrationSession<XYAxes>) {
  const steps: Array<[number, number, string]> = [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, value] of steps) {
    expect(session.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(session.confirmCalibrationValues([value])).toBe(true);
  }
  expect(session.runCalibration()).toBe(true);
}

function names(session: CalibrationSession<never>) {
  return session.getDatasetInfos().map((i) => i.name);
}

describe('captureErrorCap - the drag gesture', () => {
  function calibratedWithAPoint() {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.renameDataset(0, 'Sample A');
    session.addDataPoint(200, 200); // data (3.333, 3.333)
    return session;
  }

  it('places the dragged cap AND its mirror, on the datum\'s own record', () => {
    // ⚠️ MIGRATED for v2.3's B4. This asserted the two RELATED SERIES the gesture
    // used to create; the reading now lives in the datum's own tuple. The
    // BEHAVIOUR asserted is unchanged - dragged cap where released, mirror
    // reflected across the datum - and it is now read through the primitive
    // rather than by reaching into `getDatasets()[1]`. That reaching is exactly
    // why 25 tests here broke at once: 41 assertions went to storage and none
    // through the primitive, the same diagnosis the production code had.
    const session = calibratedWithAPoint();
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 200, y: 170 }, // dragged UP 30px
        baseName: 'SD',
      })
    ).toBeNull();

    expect(names(session as never), 'no series is spawned any more').toEqual(['Sample A']);

    const [bar] = session.getResolvedErrorBars(0);
    expect(bar!.y).toBeCloseTo(3.333, 3);
    expect(bar!.yUpper, 'the cap where the user released').toBeCloseTo(5.333, 3);
    expect(bar!.yLower, 'the mirror, reflected across the datum').toBeCloseTo(1.333, 3);
  });

  it('leaves the DATA series active, not the error-cap series it creates', () => {
    // The trap this fixes: addDataset makes each new series (SD upper / SD lower)
    // active as a side effect, so after adding an error cap the active series was
    // silently the error-cap series -- and the next Place-Point click landed there
    // instead of on the data series, with nothing on screen saying so.
    const session = calibratedWithAPoint(); // 'Sample A' is index 0, and active
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 170 },
      baseName: 'SD',
    });
    // Active is restored to the target data series.
    expect(session.getActiveDatasetIndex()).toBe(0);
    expect(session.getDatasetInfos().find((i) => i.active)?.name).toBe('Sample A');

    // ⚑ The trap it guarded against cannot arise now: the caps go INTO the
    // target series, so there is no other series for "active" to be stolen by.
    // The assertion stays because the gesture is documented to leave the user
    // where they were, and that must not depend on it happening to be true.
    session.addDataPoint(260, 190);
    expect(session.getResolvedErrorBars(0), 'the click added a DATA point').toHaveLength(2);
    expect(session.getResolvedErrorBars(0)[1]!.yUpper, 'and not a cap').toBeUndefined();
  });

  it('works on a BAR chart - the case a data-space mirror would have refused', () => {
    // BarAxes.dataToPixel was a stub returning {x:0,y:0} when this test was
    // written (it's real since v2.0, core/axes/bar.ts) -- an earlier draft
    // mirrored in data space and would have had to disable the tool here, or
    // worse, stored the mirrored cap at the image corner. Pixel geometry needs
    // nothing from the axes, so bar error capture works regardless.
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    const steps: Array<[number, number, string[]]> = [
      [100, 250, ['0']],
      [100, 100, ['10']],
    ];
    for (const [px, py, values] of steps) {
      expect(session.handleCalibrationClick(px, py)).toBe('awaiting-value');
      expect(session.confirmCalibrationValues(values)).toBe(true);
    }
    expect(session.runCalibration()).toBe(true);
    session.renameDataset(0, 'Bar A');
    session.addDataPoint(150, 180);

    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 150, y: 180 },
        capPixel: { x: 150, y: 150 },
        baseName: 'SD',
      })
    ).toBeNull();
    expect(names(session as never), 'no series spawned on a bar chart either').toEqual(['Bar A']);
    // The mirror is still reflected across the datum: 180 - 30 -> 210.
    const pixels = session.getDatasets()[0]!.getAllPixels();
    expect(pixels.some((p) => p.x === 150 && p.y === 210), 'the mirrored cap is recorded').toBe(true);
  });

  it('a horizontal drag records left/right instead', () => {
    const session = calibratedWithAPoint();
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 230, y: 200 },
        baseName: 'CI',
      })
    ).toBeNull();
    expect(names(session as never)).toEqual(['Sample A']);
    const [bar] = session.getResolvedErrorBars(0);
    // x 0..10 over px 100..400: the release at 230 is 4.333, the mirror 2.333.
    expect(bar!.xRight, 'a horizontal drag records RIGHT').toBeCloseTo(4.333, 3);
    expect(bar!.xLeft, 'and mirrors to LEFT').toBeCloseTo(2.333, 3);
    expect(bar!.yUpper, 'no vertical role is invented').toBeUndefined();
  });

  it('reuses the same pair of series across several bars', () => {
    const session = calibratedWithAPoint();
    session.addDataPoint(300, 150);
    for (const [d, c] of [
      [{ x: 200, y: 200 }, { x: 200, y: 170 }],
      [{ x: 300, y: 150 }, { x: 300, y: 130 }],
    ] as const) {
      expect(
        session.captureErrorCap({ targetIndex: 0, datumPixel: d, capPixel: c, baseName: 'SD' })
      ).toBeNull();
    }
    // Two error bars, still exactly ONE series -- the point of the change.
    expect(names(session as never)).toEqual(['Sample A']);
    const bars = session.getResolvedErrorBars(0);
    expect(bars).toHaveLength(2);
    expect(bars.every((b) => b.yUpper !== undefined && b.yLower !== undefined)).toBe(true);
  });

  it('a moved cap stays moved - nothing re-symmetrizes the pair', () => {
    // The core of the model (David, 2026-07-16): the mirror is a starting
    // position, not a constraint. An asymmetric bar is just a bar whose cap you
    // moved, so capturing a SECOND bar must not disturb the first.
    const session = calibratedWithAPoint();
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 170 },
      baseName: 'SD',
    });
    const ds = session.getDatasets()[0]!;
    const slots = ds.getSlotNames();
    const lowerPixel = ds.getAllTuples()[0]![slotForRole('lower', slots.length)]!;
    ds.setPixelAt(lowerPixel, 200, 245); // user drags the lower cap far down
    const asymmetric = session.getResolvedErrorBars(0)[0]!.yLower!;

    session.addDataPoint(300, 150);
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 300, y: 150 },
      capPixel: { x: 300, y: 130 },
      baseName: 'SD',
    });
    expect(session.getResolvedErrorBars(0)[0]!.yLower, 'the first bar is undisturbed').toBeCloseTo(
      asymmetric,
      6
    );
  });

  it('refuses a zero-length drag rather than placing a degenerate bar', () => {
    const session = calibratedWithAPoint();
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 200, y: 200 },
        baseName: 'SD',
      })
    ).toMatch(/drag from a data point/i);
    expect(names(session as never)).toEqual(['Sample A']);
  });

  it('refuses an unnamed error series - the name is the only meaning we record', () => {
    const session = calibratedWithAPoint();
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 200, y: 170 },
        baseName: '   ',
      })
    ).toMatch(/name/i);
    expect(names(session as never)).toEqual(['Sample A']);
  });

  it('refuses before calibration, like addDataPoint', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 200, y: 170 },
        baseName: 'SD',
      })
    ).toMatch(/calibrate/i);
  });

  it('refuses to hijack an existing series that is not error for this target', () => {
    // ⚠️ MIGRATED: the FIRST error kind now goes into the datum's tuple and
    // creates no series, so there is no name to collide with. The refusal still
    // matters on the FALLBACK path - a SECOND kind, which keeps the related-series
    // storage - so the case is exercised there.
    const session = calibratedWithAPoint();
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 170 },
      baseName: 'SD',
    }); // SD -> the tuple
    session.addDataset('95% CI upper'); // an ordinary series that happens to be named that
    const refusal = session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 150 },
      baseName: '95% CI',
    });
    // Bookkeeping integrity, not a constraint on where points may go: silently
    // adopting the user's own series would put caps into data they placed for
    // something else.
    expect(refusal).toBeTruthy();
  });

  it('a rename of the target follows through to the relation (checkpoint 77 cascade)', () => {
    // ⚠️ MIGRATED for the same reason. A tuple-recorded kind needs no relation to
    // retarget - the caps are IN the series being renamed - so the cascade is
    // asserted where relations still exist: a second error kind.
    const session = calibratedWithAPoint();
    session.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 170 },
      baseName: 'SD',
    });
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 200, y: 140 },
        baseName: '95% CI',
      })
    ).toBeNull();
    expect(session.renameDataset(0, 'Renamed')).toBeNull();

    const ci = session.getDatasets().find((d) => d.name.trim() === '95% CI upper')!;
    expect(getErrorRelation(ci)).toEqual({ role: 'upper', of: 'Renamed' });
    // ⚑ And the tuple-recorded kind survives the rename untouched, because it
    // never depended on the name in the first place.
    expect(session.getResolvedErrorBars(0)[0]!.yUpper).toBeCloseTo(5.333, 3);
  });
});

describe('nearestDatumPixel - snapping the drag start', () => {
  it('snaps to a real point of the target series', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.addDataPoint(200, 200);
    session.addDataPoint(300, 150);
    expect(session.nearestDatumPixel(0, { x: 204, y: 197 }, 12)).toEqual({
      index: 0,
      point: { x: 200, y: 200 },
    });
  });

  it('returns null when the press is nowhere near a point', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.addDataPoint(200, 200);
    expect(session.nearestDatumPixel(0, { x: 400, y: 400 }, 12)).toBeNull();
  });
});

describe('deleting points/caps keeps error bars whole (cascade + pair, 2026-07-22)', () => {
  // Two data points, each with an SD error bar (upper cap dragged up, lower
  // mirrored). getDatasets(): [0] Sample A, [1] SD upper, [2] SD lower.
  function twoPointsWithErrorBars() {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.renameDataset(0, 'Sample A');
    session.addDataPoint(200, 200); // datum 0
    session.addDataPoint(300, 150); // datum 1
    session.captureErrorCap({ targetIndex: 0, datumPixel: { x: 200, y: 200 }, capPixel: { x: 200, y: 170 }, baseName: 'SD' });
    session.captureErrorCap({ targetIndex: 0, datumPixel: { x: 300, y: 150 }, capPixel: { x: 300, y: 120 }, baseName: 'SD' });
    return session;
  }

  it('cascade: deleting a data point takes its error bar (both caps), leaving the other point whole', () => {
    // ⚠️ MIGRATED. The cascade is now STRUCTURAL - a datum and its caps are one
    // tuple, so there is no second store that could survive the delete. It used
    // to be a deliberate sweep across the related series, which is exactly the
    // kind of arrangement that had already failed once: the trashcan left four
    // orphaned caps on the canvas while the card stated the invariant in words.
    const session = twoPointsWithErrorBars();
    expect(session.getResolvedErrorBars(0)).toHaveLength(2);

    session.setActiveDataset(0);
    session.removeTuple(0); // delete datum 0 and, with it, its extents

    const bars = session.getResolvedErrorBars(0);
    expect(bars, 'one datum left').toHaveLength(1);
    expect(bars[0]!.x, 'datum 1 survived').toBeCloseTo(6.667, 3);
    expect(bars[0]!.yUpper, 'and kept its own error whole').toBeDefined();
  });

  it('⚑ deleting ONE cap removes only it, so a one-sided bar is reachable', () => {
    // ⚠️⚠️ A DELIBERATE CHANGE OF BEHAVIOUR, not a migration. Deleting a cap used
    // to remove its matched PAIR ("a selected cap stands for its whole error
    // bar", David 2026-07-22). That rule made a ONE-SIDED bar unreachable - and
    // the app itself places the mirrored cap, so a user recording only an upper
    // bound had no way to remove the lower one it invented for them.
    //
    // The two behaviours both survive; they swapped gestures:
    //   · delete a cap        -> removes that cap        (this test)
    //   · removeErrorFromDatum -> removes the whole bar  (errorRemoveFromDatum)
    // which is the difference between "this bound is not in the figure" and
    // "this point has no error bar".
    const session = twoPointsWithErrorBars();
    const ds = session.getDatasets()[0]!;
    const slots = ds.getSlotNames();
    const upperPixel = ds.getAllTuples()[0]![slotForRole('upper', slots.length)]!;

    session.setActiveDataset(0);
    session.removeDataPoints([upperPixel]);

    const bar = session.getResolvedErrorBars(0)[0]!;
    expect(bar.yUpper, 'the upper is gone').toBeUndefined();
    expect(bar.yLower, 'the lower remains - a one-sided bar').toBeDefined();
    expect(session.getResolvedErrorBars(0), 'both data points untouched').toHaveLength(2);
  });

  // A point carrying TWO error-bar TYPES: an "SD" bar and a "95% CI" bar. The
  // model records no error kind, so the base name is the only thing separating
  // them; deleting a cap of one type must not disturb the other (v1.0.1).
  function onePointWithTwoErrorTypes() {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.renameDataset(0, 'Sample A');
    session.addDataPoint(200, 200); // datum 0
    // SD bar: caps close to the point. 95% CI bar: caps further out.
    session.captureErrorCap({ targetIndex: 0, datumPixel: { x: 200, y: 200 }, capPixel: { x: 200, y: 185 }, baseName: 'SD' });
    session.captureErrorCap({ targetIndex: 0, datumPixel: { x: 200, y: 200 }, capPixel: { x: 200, y: 160 }, baseName: '95% CI' });
    // getDatasets(): [0] Sample A, [1] SD upper, [2] SD lower, [3] 95% CI upper, [4] 95% CI lower.
    return session;
  }

  it('the FIRST kind goes to the tuple and the SECOND to its own series', () => {
    // ⚠️ MIGRATED. Storage was never the limit on how many error kinds a datum
    // may carry -- any number of series may relate to one parent -- so the first
    // kind is UPGRADED to a stored pairing and every further kind stays exactly
    // where it was. Nothing is taken away.
    //
    // ⚑ Measured before settling for this: of 556,894 Europe PMC figure captions
    // mentioning error bars, 40 say "inner/outer error bars" and 3 say "two sets
    // of error bars" -- order one in ten thousand.
    const session = onePointWithTwoErrorTypes();
    const names = session.getDatasets().map((d) => d.name.trim());
    expect(names, 'SD is in the datum record, so no SD series').not.toContain('SD upper');
    expect(names, 'the second kind keeps the related-series storage').toContain('95% CI upper');
    expect(session.getResolvedErrorBars(0)[0]!.yUpper, 'SD is what resolves').toBeCloseTo(4.333, 3);
  });

  it('deleting the SD cap leaves the separate 95% CI bar untouched', () => {
    const session = onePointWithTwoErrorTypes();
    const ds = session.getDatasets()[0]!;
    const upperPixel = ds.getAllTuples()[0]![slotForRole('upper', ds.getSlotNames().length)]!;
    const ciUpper = session.getDatasets().findIndex((d) => d.name.trim() === '95% CI upper');

    session.setActiveDataset(0);
    session.removeDataPoints([upperPixel]);

    expect(session.getResolvedErrorBars(0)[0]!.yUpper, 'the SD upper is gone').toBeUndefined();
    expect(session.getResolvedErrorBars(0), 'the data point is untouched').toHaveLength(1);
    expect(session.getDatasets()[ciUpper]!.getAllPixels(), 'the CI bar survives').toHaveLength(1);
  });

  it('cascade still takes BOTH error-bar types when the data point itself is deleted', () => {
    const session = onePointWithTwoErrorTypes();
    const names = session.getDatasets().map((d) => d.name.trim());

    session.setActiveDataset(0); // the parent data series
    session.removeDataPoints([0]); // delete the datum -> all its error bars go

    expect(session.getResolvedErrorBars(0), 'the datum and its tuple extents').toHaveLength(0);
    for (const n of ['95% CI upper', '95% CI lower']) {
      expect(
        session.getDatasets()[names.indexOf(n)]!.getAllPixels(),
        `${n} cascaded too`
      ).toHaveLength(0);
    }
  });

  it('a 2D cross under ONE base: deleting the vertical arm leaves the horizontal arm (they are not linked)', () => {
    // David 2026-07-23: the vertical and horizontal whiskers of a same-named
    // error bar are independent -- deleting one direction must not take the other.
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.renameDataset(0, 'Sample A');
    session.addDataPoint(200, 200); // datum 0
    session.captureErrorCap({ targetIndex: 0, datumPixel: { x: 200, y: 200 }, capPixel: { x: 200, y: 170 }, baseName: 'SD' }); // vertical
    session.captureErrorCap({ targetIndex: 0, datumPixel: { x: 200, y: 200 }, capPixel: { x: 230, y: 200 }, baseName: 'SD' }); // horizontal
    // ⚠️ MIGRATED: all four arms of one base now live in the SAME tuple, as four
    // role slots - which is what makes their independence structural rather than
    // a rule about which series to sweep.
    const ds = session.getDatasets()[0]!;
    const slots = ds.getSlotNames();
    const before = session.getResolvedErrorBars(0)[0]!;
    expect(before.yUpper, 'the vertical arm exists').toBeDefined();
    expect(before.xRight, 'and so does the horizontal').toBeDefined();

    const upperPixel = ds.getAllTuples()[0]![slotForRole('upper', slots.length)]!;
    session.setActiveDataset(0);
    session.removeDataPoints([upperPixel]); // delete the vertical arm's upper cap

    const after = session.getResolvedErrorBars(0)[0]!;
    expect(after.yUpper, 'the vertical upper is gone').toBeUndefined();
    expect(after.xRight, 'the horizontal arm is untouched').toBeCloseTo(before.xRight!, 6);
    expect(after.xLeft).toBeCloseTo(before.xLeft!, 6);
    expect(session.getResolvedErrorBars(0), 'data point untouched').toHaveLength(1);
  });

  it('deleting a cap when its sibling was already removed (asymmetric bar) drops just that cap, no throw', () => {
    // ⚠️ MIGRATED. Under the tuple record this is simply a slot that is already
    // null, which is the ordinary "not captured" state rather than a special
    // case - so the throw this guarded against has nowhere to come from.
    const session = twoPointsWithErrorBars();
    const ds = session.getDatasets()[0]!;
    const slots = ds.getSlotNames();
    const lowerPixel = ds.getAllTuples()[0]![slotForRole('lower', slots.length)]!;
    session.setActiveDataset(0);
    session.removeDataPoints([lowerPixel]); // one-sided now: upper only
    expect(session.getResolvedErrorBars(0)[0]!.yLower).toBeUndefined();

    const upperPixel = ds.getAllTuples()[0]![slotForRole('upper', slots.length)]!;
    expect(() => session.removeDataPoints([upperPixel])).not.toThrow();

    const bars = session.getResolvedErrorBars(0);
    expect(bars, 'both data points untouched').toHaveLength(2);
    expect(bars[0]!.yUpper, 'datum 0 has no error left').toBeUndefined();
    expect(bars[1]!.yUpper, "datum 1's bar is whole").toBeDefined();
  });
});

describe('errorCapDragLine - the axis-lock a cap is dragged along', () => {
  // ⚑ Before this block the whole method was UNREACHED: a scoped Stryker run
  // (2026-08-03) put 26 no-coverage mutants in it, the largest such cluster in
  // calibrationSession.ts. It is what keeps captureErrorCap's invariant holding
  // while the user adjusts a cap afterwards -- and error-cap dragging is the
  // area that produced the v1.3 release blocker, where a fix silently took
  // every cap out of the hit graph while three on-screen strings still promised
  // the drag. A method with no test cannot notice that happening again.

  function calibratedWithACappedPoint() {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.renameDataset(0, 'Sample A');
    session.addDataPoint(200, 200); // data (3.333, 3.333)
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 200, y: 200 },
        capPixel: { x: 200, y: 170 },
        baseName: 'SD',
      })
    ).toBeNull();
    // ⚠️ MIGRATED for B4: the caps are now slots of 'Sample A' rather than two
    // related series, so these tests address them by PIXEL INDEX in series 0.
    return session;
  }

  /** The pixel index of a role's cap on the first datum of series 0. */
  function capPixel(session: { getDatasets(): { getAllTuples(): (number | null)[][]; getSlotNames(): string[] }[] }, role: 'upper' | 'lower' | 'left' | 'right') {
    const ds = session.getDatasets()[0]!;
    return ds.getAllTuples()[0]![slotForRole(role, ds.getSlotNames().length)]!;
  }

  it('locks an upper cap to the vertical through its own datum', () => {
    const session = calibratedWithACappedPoint();
    const line = session.errorCapDragLine(0, capPixel(session, 'upper'));
    expect(line).not.toBeNull();
    // Origin is the DATUM, not the cap: the cap slides along the bar, and the
    // bar is anchored at the point it belongs to.
    expect(line!.origin.x).toBeCloseTo(200, 6);
    expect(line!.origin.y).toBeCloseTo(200, 6);
    // y = (250-py)/15, so stepping the value UP moves the pixel UP the screen.
    expect(line!.direction.x).toBeCloseTo(0, 6);
    expect(line!.direction.y).toBeCloseTo(-1, 6);
  });

  it('gives the lower cap the SAME line, so both caps slide along one bar', () => {
    const session = calibratedWithACappedPoint();
    const upper = session.errorCapDragLine(0, capPixel(session, 'upper'))!;
    const lower = session.errorCapDragLine(0, capPixel(session, 'lower'))!;
    expect(lower.origin.x).toBeCloseTo(upper.origin.x, 6);
    expect(lower.origin.y).toBeCloseTo(upper.origin.y, 6);
    // Same axis. (Direction is a ray; the lower cap sits on the far side of the
    // datum, and constrainCap projects onto the line either way.)
    expect(Math.abs(lower.direction.x)).toBeCloseTo(0, 6);
    expect(Math.abs(lower.direction.y)).toBeCloseTo(1, 6);
  });

  it('returns a UNIT direction, so ui/ can scale it without renormalising', () => {
    const session = calibratedWithACappedPoint();
    const { direction } = session.errorCapDragLine(0, capPixel(session, 'upper'))!;
    expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1, 9);
  });

  it('leaves an ordinary data point unconstrained', () => {
    // Sample A carries no error relation, so it is not a cap and must drag
    // freely. Null here means "unconstrained", never "disabled".
    const session = calibratedWithACappedPoint();
    expect(session.errorCapDragLine(0, 0)).toBeNull();
  });

  it('refuses an out-of-range dataset index rather than throwing', () => {
    const session = calibratedWithACappedPoint();
    expect(session.errorCapDragLine(99, 0)).toBeNull();
    expect(session.errorCapDragLine(-1, 0)).toBeNull();
  });

  it('refuses an out-of-range point index rather than throwing', () => {
    const session = calibratedWithACappedPoint();
    expect(session.errorCapDragLine(1, 99)).toBeNull();
    expect(session.errorCapDragLine(1, -1)).toBeNull();
  });

  it('a cap cannot outlive its datum series at all', () => {
    // ⚠️ MIGRATED, and the case has DISSOLVED rather than moved. It mattered
    // because caps lived in their OWN series, which survived the deletion of the
    // series they described - `clearErrorRelationsTo` then had to demote them so
    // they stopped claiming to be caps. In the tuple record the caps ARE the
    // series' own points, so removing it removes them: nothing is left to
    // constrain, and nothing is left to demote.
    const session = calibratedWithACappedPoint();
    expect(session.errorCapDragLine(0, capPixel(session, 'upper'))).not.toBeNull();
    // ⚑ Note it takes a SECOND series to even run this now: the capped series is
    // the only one there is, and a session always keeps one.
    session.addDataset('Sample B');
    session.removeDataset(0); // remove 'Sample A', caps and all
    expect(session.getDatasets().some((d) => d.name.trim() === 'Sample A')).toBe(false);
    expect(session.getResolvedErrorBars(0), 'no cap outlived it').toHaveLength(0);
    expect(session.errorCapDragLine(0, 0), 'nothing survives to be a cap').toBeNull();
  });

  it('CONSTRAINS a cap on a BAR chart - and still lets it be placed at all', () => {
    // ⚠️ UPDATED 2026-08-17. This used to assert the opposite: Bar's
    // `pixelToData` returns `[value]`, so `capFreeDirection` gave up on the
    // missing second coordinate and every cap on a bar chart was UNCONSTRAINED.
    // Measured across the type table, that was 5 of 12 types where a DIAGONAL
    // cap could be recorded - against David's *"error bars align with an axis,
    // either horizontal or vertical; there cannot be one in between"*
    // (2026-08-17), and he asked for it closed.
    //
    // ⚑ A 1-D axes CAN say which way its value runs: stepping its single value
    // through `dataToPixel` is the same probe, and Bar answers (0,-1) here. The
    // dimensionality assumption was in the probe, not in the chart.
    //
    // ⚑ THE HALF THAT STILL MATTERS IS KEPT. An earlier draft of
    // capFreeDirection probed in order to GATE the feature and would have
    // REFUSED error bars on bar charts outright. A constraint must never become
    // a refusal, so this still asserts that the capture succeeds.
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    const steps: Array<[number, number, string[]]> = [
      [100, 250, ['0']],
      [100, 100, ['10']],
    ];
    for (const [px, py, values] of steps) {
      expect(session.handleCalibrationClick(px, py)).toBe('awaiting-value');
      expect(session.confirmCalibrationValues(values)).toBe(true);
    }
    expect(session.runCalibration()).toBe(true);
    session.renameDataset(0, 'Bar A');
    session.addDataPoint(150, 180);
    expect(
      session.captureErrorCap({
        targetIndex: 0,
        datumPixel: { x: 150, y: 180 },
        capPixel: { x: 150, y: 150 },
        baseName: 'SD',
      })
    ).toBeNull();

    // The cap EXISTS -- the constraint did not become a refusal...
    expect(session.getDatasets(), 'and no series was spawned for it').toHaveLength(1);
    // ...and it is now axis-locked, along the value axis this chart calibrated.
    const line = session.errorCapDragLine(0, capPixel(session, 'upper'));
    expect(line, 'a bar chart can now say which way its value runs').not.toBeNull();
    expect(Math.abs(line!.direction.x), 'vertical value axis: no x component').toBeLessThan(1e-6);
  });

  it('⚑ adjusting a cap afterwards keeps it ON the bar', () => {
    // THE INVARIANT captureErrorCap ESTABLISHES, HELD THROUGH A LATER MOVE.
    // Placing a cap axis-locks it (capFreeDirection + constrainCap). Adjusting
    // it later goes through updateDataPointPixel -- where drag, arrow-nudge and
    // value-edit all converge -- and until 2026-08-03 nothing re-applied the
    // lock there. A sideways drag drifted the cap off its datum, giving a
    // slanted whisker and a recorded X the figure never showed.
    //
    // Same rule, same place, as the spider snap directly above it in that
    // method: a point that belongs to an axis stays on it however it is moved.
    const session = calibratedWithACappedPoint();
    session.setActiveDataset(0); // the caps are points of the data series now
    const upper = capPixel(session, 'upper');
    session.updateDataPointPixel(upper, 260, 150); // dragged UP and sideways

    const cap = session.getDatasets()[0]!.getAllPixels()[upper]!;
    expect(cap.x).toBeCloseTo(200, 6); // the sideways part is discarded
    expect(cap.y).toBeCloseTo(150, 6); // free to slide along the bar
  });

  // ⚑⚑ THE CAP THAT JUMPED TO THE BAR NEXT TO IT (David, 2026-08-04, by driving
  // the app on the asymmetric error-bar example).
  //
  // Every test above this point uses ONE data point, so "which datum is this
  // cap's datum?" had only one possible answer and the question was never
  // really asked. With a second point it is answerable two different ways, and
  // errorCapDragLine was answering it a THIRD way -- `nearestPixel`, Euclidean,
  // in pixel space -- while the record (`matchCapToDatum`) matches on the
  // cap's INVARIANT axis. That is precisely finding A6 recurring in a new
  // caller: algorithms/errorBar.ts exports matchCapToDatum for the express
  // reason that "the rendering must ask the same question the record does".
  //
  // A long whisker is closer to the NEXT datum than to its own whenever the
  // neighbour is nearer than the error is large -- ordinary on a decaying curve
  // with wide error at the left, which is the figure David was tracing. The
  // drag then locked the cap to the neighbour's vertical and it jumped sideways
  // onto the next bar.
  function calibratedWithNeighbouringBars() {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.renameDataset(0, 'Sample A');
    session.addDataPoint(200, 120); // datum A
    session.addDataPoint(250, 190); // datum B -- right of A, and BELOW it
    // A carries a LARGE error (±100px), B a small one: the shape of a decaying
    // curve with wide error at its left-hand end.
    expect(
      session.captureErrorCap({ targetIndex: 0, datumPixel: { x: 200, y: 120 }, capPixel: { x: 200, y: 20 }, baseName: 'SD' })
    ).toBeNull();
    expect(
      session.captureErrorCap({ targetIndex: 0, datumPixel: { x: 250, y: 190 }, capPixel: { x: 250, y: 170 }, baseName: 'SD' })
    ).toBeNull();
    // A's lower cap is at (200,220): 100px from its own datum A, but only
    // hypot(50,30) = 58px from datum B. Euclidean-nearest picks the WRONG one.
    return session;
  }

  it('⚑ resolves a cap to its OWN datum, not whichever datum is nearest as the crow flies', () => {
    const session = calibratedWithNeighbouringBars();
    const line = session.errorCapDragLine(0, capPixel(session, 'lower'))!; // A's lower cap
    expect(line).not.toBeNull();
    expect(line.origin.x).toBeCloseTo(200, 6); // datum A, not datum B's 250
    expect(line.origin.y).toBeCloseTo(120, 6);
  });

  it('⚑ a cap adjusted along its bar does not JUMP to the bar next to it', () => {
    // The symptom exactly as reported: grab the lower cap, drag it straight
    // down the bar it belongs to, and it snaps sideways onto the neighbour.
    const session = calibratedWithNeighbouringBars();
    session.setActiveDataset(0);
    const lower = capPixel(session, 'lower'); // A's lower cap
    session.updateDataPointPixel(lower, 200, 240);

    const cap = session.getDatasets()[0]!.getAllPixels()[lower]!;
    expect(cap.x).toBeCloseTo(200, 6); // stays on A's bar; 250 is the defect
    expect(cap.y).toBeCloseTo(240, 6);
  });

  it('⚑ the drag lock and the recorded delta resolve the SAME datum', () => {
    // The invariant behind both tests above, stated once: a cap constrained
    // against one datum and reported against another is a whisker whose drawing
    // contradicts its own number.
    const session = calibratedWithNeighbouringBars();
    session.setActiveDataset(0);
    session.updateDataPointPixel(capPixel(session, 'lower'), 200, 240);
    // 120px below datum A; y = (250-py)/15, so 120px = 8 units, signed by role.
    // ⚠️ MIGRATED to the DELTA PROJECTION of the primitive: `getErrorCapDeltas`
    // answers per error-cap SERIES, which a tuple-recorded kind does not have.
    // The invariant is unchanged and now reads off the same object the drawing
    // and the export do - which is the whole point of having a primitive.
    const bar = session.getResolvedErrorBars(0)[0]!;
    expect(deltasFromBar(bar).yLower).toBeCloseTo(-8, 6);
  });

  it('an ordinary point is still free to move in both axes', () => {
    // The lock must not over-reach onto points that are not caps.
    const session = calibratedWithACappedPoint();
    session.setActiveDataset(0); // Sample A -- the data series
    session.updateDataPointPixel(0, 260, 150);
    const p = session.getDatasets()[0]!.getAllPixels()[0]!;
    expect(p.x).toBeCloseTo(260, 6);
    expect(p.y).toBeCloseTo(150, 6);
  });

  it('⚑ reports each cap as a SIGNED DELTA from its datum', () => {
    // The numbers you would need to redraw the figure: x, y, -delta, +delta.
    // Datum at pixel (200,200) = data (3.333, 3.333); upper cap at (200,170).
    // y = (250-py)/15, so 30px up is +2 in value.
    // ⚠️ MIGRATED to the delta PROJECTION of the primitive. `getErrorCapDeltas`
    // answers per error-cap SERIES, which a tuple-recorded kind has none of;
    // `deltasFromBar` derives the same numbers from the one object the drawing
    // and the export also read.
    const session = calibratedWithACappedPoint();
    const d = deltasFromBar(session.getResolvedErrorBars(0)[0]!);
    expect(d.yUpper).toBeCloseTo(2, 6);
    expect(d.yLower).toBeCloseTo(-2, 6); // mirrored
  });

  it('signs by ROLE, not by magnitude, so an asymmetric bar reads apart', () => {
    // Move the lower cap so the bar is genuinely asymmetric, then both columns
    // must still be tellable apart by sign alone.
    const session = calibratedWithACappedPoint();
    session.setActiveDataset(0);
    session.updateDataPointPixel(capPixel(session, 'lower'), 200, 245); // 45px below = -3
    const d = deltasFromBar(session.getResolvedErrorBars(0)[0]!);
    expect(d.yUpper).toBeCloseTo(2, 6);
    expect(d.yLower).toBeCloseTo(-3, 6);
  });

  it('is EMPTY for a series that is not an error series - never zero', () => {
    // 0 would read as "measured, and equal". Absence is the honest answer.
    const session = calibratedWithACappedPoint();
    expect(session.getErrorCapDeltas(0)).toEqual([]);
  });

  it('a cap with no datum reports nothing rather than a number', () => {
    // ⚠️ MIGRATED, and the case has DISSOLVED: deleting the datum takes its
    // extents with it, so a cap "resolving to no datum" is no longer a state the
    // record can be in. That is the orphan defect made inexpressible.
    const session = calibratedWithACappedPoint();
    session.setActiveDataset(0);
    session.removeDataPoints([0]); // the datum, so the whole tuple
    expect(session.getResolvedErrorBars(0)).toHaveLength(0);
  });

  // ⚑ NOT TESTED, and said plainly rather than left implied: the `!targetEntry`
  // guard is defence in depth and no click path reaches it. renameDataset
  // retargets relations, and removeDataset clears them, so a relation naming a
  // series that does not exist cannot be produced interactively -- only by a
  // loaded file. Same honesty as liveSpokeStepKey's own `!this.axes` note.
});
