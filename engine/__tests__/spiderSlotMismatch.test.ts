/**
 * ⚑⚑ A SERIES KEEPS THE COLUMNS IT WAS CAPTURED UNDER when the axis count no
 * longer matches - and the FILE is the only door that can produce the mismatch.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-10 (R5, gate 3). `applyAxesDerivedSlots`'s comment
 * ends *"the recorded data keeps the names it was captured under, and the
 * mismatch stays visible rather than being papered over"* - and nothing
 * enforced either half. This file enforces the half that is true, and the
 * comment now says what the other half actually amounts to on screen.
 *
 * ⚑ WHY THE FILE IS THE DOOR, measured rather than assumed: `addRepeat` refuses
 * once a calibration is live (*"changing the shape underneath them is a
 * re-calibration, via reset"*) and `reset` wipes every series, so the click path
 * cannot get a 3-slot series next to a 5-spoke axes. A project written before
 * the names existed, one whose series was added without them, a hand-edited file
 * or a foreign import can - which is the door `loadCalibrated` already names.
 *
 * ⚠️⚑⚑ AND THE FIRST FIXTURE HERE MEASURED THE OPPOSITE OF ITS SUBJECT. A
 * series holding a bare `addPixel` is not a series holding points: the load door
 * PRUNES a pixel that belongs to no tuple (*"a point with no axis is not a
 * datum"*), so `hasPoints` was false, the rename went through, and the probe
 * reported the papering-over it was written to refuse. The fixture has to carry
 * a real TUPLE. Same shape as the pie-apex fixture two days ago: check the case
 * is reachable by the route the test takes.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, SPIDER_AXES_CONFIG } from '../calibrationSession.js';
import { Dataset } from '../../core/dataset.js';
import type { SpiderAxes } from '../../core/axes/spider.js';

/** A calibrated spider with `spokes` axes, named `Axis 1 .. Axis n`. */
function spiderSession(spokes: number): CalibrationSession<SpiderAxes> {
  const session = new CalibrationSession(SPIDER_AXES_CONFIG);
  while (session.getRepeatCount() < spokes) expect(session.addRepeat()).toBe(true);
  let i = 0;
  for (let guard = 0; guard < 40; guard++) {
    const step = session.getCurrentStep();
    if (!step) break;
    if (step.key === 'origin') {
      session.handleCalibrationClick(300, 300);
      session.confirmCalibrationValues(['0']);
      continue;
    }
    const angle = (i * 2 * Math.PI) / spokes;
    session.handleCalibrationClick(300 + 150 * Math.cos(angle), 300 + 150 * Math.sin(angle));
    session.confirmCalibrationValues(['100', `Axis ${i + 1}`]);
    i++;
  }
  expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
  return session;
}

/**
 * A series holding ONE COMPLETE TUPLE across `names.length` axes.
 *
 * ⚑ A tuple, not three loose pixels - see this file's header. `getCount()` is 3
 * either way, and only one of the two survives the load door.
 */
function seriesWithATuple(names: string[]): Dataset {
  const ds = new Dataset(names.length);
  ds.setSlotNames([...names]);
  const tuple = ds.addTuple(ds.addPixel(320, 310))!;
  names.forEach((_, slot) => {
    if (slot === 0) return;
    ds.addToTupleAt(tuple, slot, ds.addPixel(300 - slot * 10, 300 - slot * 20));
  });
  return ds;
}

describe('a spider series whose axis count no longer matches', () => {
  it('⚑⚑ keeps the columns it was captured under, on load AND through a re-calibration', () => {
    const captured = ['Strength', 'Weight', 'Cost'];
    const series = seriesWithATuple(captured);
    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    session.loadCalibrated(spiderSession(5).getAxes()!, [series]);

    // The tuple survived the load door - without this the case below is vacuous.
    expect(session.getDataPoints()).toHaveLength(3);
    expect(session.getSlotNames()).toEqual(captured);

    // ⚑ A DRAG IS A RE-CALIBRATION, which is the moment the rename would happen.
    session.updateCalibPointPixel('spoke1', 460, 300);
    expect(session.getSlotNames()).toEqual(captured);
    expect(session.getDataPoints()).toHaveLength(3);
  });

  it('is renamed in place when the counts still AGREE - the guard must not over-reach', () => {
    // Renaming is safe here: slot k still means the axis it was recorded
    // against, so the series picks up the figure's own words.
    const series = seriesWithATuple(['1', '2', '3']);
    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    session.loadCalibrated(spiderSession(3).getAxes()!, [series]);
    expect(session.getSlotNames()).toEqual(['Axis 1', 'Axis 2', 'Axis 3']);
    expect(session.getDataPoints()).toHaveLength(3);
  });

  it('⚑ the click path cannot produce the mismatch at all - the file is the door', () => {
    // The two halves that close it, asserted rather than described: the shape
    // cannot change under a live calibration, and the way to change it takes
    // every series with it.
    const session = spiderSession(3);
    expect(session.addRepeat(), 'a live calibration must refuse a new spoke').toBe(false);
    expect(session.removeRepeat(), 'and must refuse dropping one').toBe(false);

    session.reset();
    expect(session.getDataPoints()).toHaveLength(0);
    expect(session.getRepeatCount()).toBe(SPIDER_AXES_CONFIG.repeatingStep?.min);
  });
});
