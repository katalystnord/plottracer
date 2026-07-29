import { describe, expect, it } from 'vitest';
import { CalibrationSession, SPIDER_AXES_CONFIG } from '../calibrationSession.js';
import type { SpiderAxes } from '../../core/axes/spider.js';

/**
 * A tuple's category label — the one thing on a slotted series the user TYPES.
 *
 * ⚑ It was stored on the tuple's slot-0 pixel and read back from there, so a tuple
 * whose slot 0 happened to be empty swallowed the name in silence. That is reachable
 * by hand on a spider, where the slots are N×1D: aim at a later axis first (the table's
 * empty cells exist precisely so you can), type a category, and it is gone with nothing
 * on screen to say so. It also produced the pie's blank category, by a different route.
 *
 * This is the "a check that did not run looks exactly like one that passed" shape, and
 * the fix is to stop the write having a way to go nowhere rather than to report that
 * it did.
 */

const CX = 300;
const CY = 240;
const R = 120;

/** Three-axis spider, calibrated, ready to capture. */
function spider(): CalibrationSession<SpiderAxes> {
  const names = ['Strength', 'Weight', 'Cost'];
  const session = new CalibrationSession(SPIDER_AXES_CONFIG);
  while (session.getRepeatCount() < names.length) session.addRepeat();
  session.handleCalibrationClick(CX, CY);
  session.confirmCalibrationValues(['0']);
  names.forEach((name, i) => {
    session.handleCalibrationClick(...spokeAt(i, 1));
    session.confirmCalibrationValues(['100', name]);
  });
  if (!session.runCalibration()) throw new Error('fixture calibration failed');
  return session;
}

function spokeAt(i: number, frac: number): [number, number] {
  const t = (-Math.PI / 2) + (i * 2 * Math.PI) / 3;
  return [CX + R * frac * Math.cos(t), CY + R * frac * Math.sin(t)];
}

describe('a category typed against a tuple whose slot 0 is empty', () => {
  it('is KEPT, not silently dropped', () => {
    // ⚑ The defect, reached exactly as a user reaches it. The table's empty cells are
    // there so a reading can be aimed at a particular gap (David: "Can I make an empty
    // slot active again?"), so starting a profile on axis 2 is ordinary use -- and
    // then slot 0 is null and the name went nowhere.
    const session = spider();
    expect(session.setSlotCursor(null, 1)).toBe(true);
    session.addDataPoint(...spokeAt(1, 0.5));
    const tuple = session.getDataset().getTuple(0);
    expect(tuple[0], 'fixture: slot 0 must be empty for this to test anything').toBeNull();

    expect(session.setTupleLabel(0, 'Chitosan film')).toBe(true);
    expect(session.getTupleLabel(0)).toBe('Chitosan film');
  });

  it('survives slot 0 being filled afterwards', () => {
    // ⚑ The trap in the obvious fix. Write to "the first non-null slot" and read back
    // "the first non-null slot", and the label vanishes the moment an EARLIER slot is
    // filled -- the read starts looking at a pixel that never held it. So the read
    // scans the whole tuple; whichever pixel carries the name, it is found.
    const session = spider();
    session.setSlotCursor(null, 1);
    session.addDataPoint(...spokeAt(1, 0.5));
    session.setTupleLabel(0, 'Chitosan film');

    session.setSlotCursor(0, 0);
    session.addDataPoint(...spokeAt(0, 0.7));
    expect(session.getDataset().getTuple(0)[0]).not.toBeNull();
    expect(session.getTupleLabel(0)).toBe('Chitosan film');
  });

  it('keeps ONE name per tuple when it is renamed', () => {
    // Renaming after slot 0 arrives writes to a different pixel than the original did.
    // Both must not end up holding a name, or deleting one point would resurrect the
    // old one.
    const session = spider();
    session.setSlotCursor(null, 1);
    session.addDataPoint(...spokeAt(1, 0.5));
    session.setTupleLabel(0, 'first');
    session.setSlotCursor(0, 0);
    session.addDataPoint(...spokeAt(0, 0.7));
    session.setTupleLabel(0, 'second');

    expect(session.getTupleLabel(0)).toBe('second');
    const ds = session.getDataset();
    const labels = ds
      .getTuple(0)
      .filter((v): v is number => v !== null)
      .map((i) => ds.getPixel(i).metadata?.['label'])
      .filter((l) => typeof l === 'string');
    expect(labels).toEqual(['second']);
  });

  it('REPORTS the one case it genuinely cannot serve', () => {
    // A wholly empty tuple has no pixel to hang metadata on, and inventing one would
    // put a mark on the figure the user never made. That case is now answered rather
    // than pretended -- which is the whole complaint: a write that cannot happen must
    // not look like one that did.
    const session = spider();
    session.getDataset().addEmptyTupleAt(0);
    expect(session.setTupleLabel(0, 'nowhere')).toBe(false);
    expect(session.setTupleLabel(99, 'no such tuple')).toBe(false);
  });
});
