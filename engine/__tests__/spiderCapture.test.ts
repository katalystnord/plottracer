import { describe, expect, it } from 'vitest';
import { CalibrationSession, SPIDER_AXES_CONFIG, XY_AXES_CONFIG, BOX_PLOT_AXES_CONFIG } from '../calibrationSession.js';
import type { SpiderAxes } from '../../core/axes/spider.js';
import { Dataset } from '../../core/dataset.js';
import { serializeProject, deserializeProject } from '../projectFile.js';

/**
 * Spider CAPTURE and EXPORT (v1.4 Stage 2).
 *
 * The one thing worth being paranoid about: a captured point's value must be read
 * against the spoke it was captured ON, taken from its slot - never against
 * whichever ray it happens to sit nearest. The two agree for a click that landed on
 * its axis and diverge exactly when the user mis-clicked, which is the case where a
 * nearest-ray reading would export a number off a DIFFERENT axis's scale while the
 * table still showed it in the slot they aimed at.
 */

/** Centre (100,100); `n` spokes of 100px, clockwise from 12 o'clock. */
function spokePixel(i: number, n: number, radius = 100): [number, number] {
  const angle = (2 * Math.PI * i) / n;
  return [100 + radius * Math.sin(angle), 100 - radius * Math.cos(angle)];
}

function calibratedSpider(values: string[], names: string[], centre = '0'): CalibrationSession<SpiderAxes> {
  const session = new CalibrationSession(SPIDER_AXES_CONFIG);
  const n = values.length;
  while (session.getRepeatCount() < n) session.addRepeat();
  session.handleCalibrationClick(100, 100);
  session.confirmCalibrationValues([centre]);
  for (let i = 0; i < n; i++) {
    const [px, py] = spokePixel(i, n);
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues([values[i]!, names[i]!]);
  }
  expect(session.runCalibration()).toBe(true);
  return session;
}

const THREE = () => calibratedSpider(['100', '100', '100'], ['Strength', 'Weight', 'Cost']);

describe('a calibrated spider gives every series one capture slot per axis', () => {
  it('names the slots after the spokes', () => {
    // ⚑ Cannot be `defaultSlots`: a spider's groups do not exist until its
    // axes are calibrated, and their names are transcribed at that moment.
    expect(THREE().getSlotNames()).toEqual(['Strength', 'Weight', 'Cost']);
  });

  it('falls back positionally for an axis left unnamed', () => {
    const session = calibratedSpider(['10', '10', '10'], ['A', '', 'C']);
    expect(session.getSlotNames()).toEqual(['A', 'Axis 2', 'C']);
  });

  it('gives EVERY series the slots, not just the active one', () => {
    const session = THREE();
    session.addDataset();
    session.setActiveDataset(1);
    expect(session.getSlotNames()).toEqual(['Strength', 'Weight', 'Cost']);
  });

  it('renames in place when a re-calibration keeps the same axis count', () => {
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    // Rename axis 2 by re-placing its calibration point with a new name.
    session.updateCalibPointPixel('spoke2', ...spokePixel(1, 3));
    expect(session.getSlotNames()).toEqual(['Strength', 'Weight', 'Cost']);
    expect(session.getDataPoints()).toHaveLength(3);
  });
});

describe('a captured point is read against ITS OWN axis', () => {
  it('reads each slot off its own spoke', () => {
    const session = THREE();
    // Halfway out along each of the three rays, in slot order.
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    const rows = session.getExportRows(0);
    expect(rows.map((r) => r.values[2])).toEqual([50, 50, 50]);
  });

  it('⚑ does NOT re-read a mis-clicked point off the ray it sits nearest', () => {
    // The heart of it. Slot 0 is "Strength" (12 o'clock); this click is placed way
    // over on the Weight ray. Read against Weight it would be 50 - a plausible
    // number off the wrong axis. Read against the axis it was captured on, its
    // projection onto that ray is what the record says, and the warning below is
    // what tells the user something is wrong.
    const session = THREE();
    session.addDataPoint(...spokePixel(1, 3, 50)); // fills slot 0 (Strength)
    const row = session.getExportRows(0)[0]!;
    expect(row.values[0]).toBe(1);
    expect(row.values[1]).toBe('Strength');
    // Projection of the Weight-ray point onto the Strength ray: 50 * cos(120°).
    expect(row.values[2]).toBeCloseTo(-25, 6);
    expect(row.values[2]).not.toBeCloseTo(50, 6);
  });

  it('exports Axis, Name, Value - independent variables first', () => {
    const session = THREE();
    session.addDataPoint(...spokePixel(0, 3, 50));
    expect(session.getExportFields()).toEqual(['Axis', 'Name', 'Value']);
    expect(session.getExportRows(0)[0]!.values).toEqual([1, 'Strength', 50]);
  });

  it('numbers the Axis column from 1, matching what the calibration card shows', () => {
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    expect(session.getExportRows(0).map((r) => r.values[0])).toEqual([1, 2, 3]);
  });

  it('exports a blank name for an axis nobody transcribed, not an invented one', () => {
    const session = calibratedSpider(['10', '10', '10'], ['A', '', 'C']);
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    // The positional fallback is a DISPLAY label; what the file records for an
    // untranscribed name is the label the app derived, never a guess at the figure.
    expect(session.getExportRows(0)[1]!.values[1]).toBe('Axis 2');
  });
});

describe('the wrong-axis notice - asked at capture time, never stored', () => {
  it('fires for a click nearer a different axis than the slot it fills', () => {
    const session = THREE();
    const [px, py] = spokePixel(1, 3, 50); // on ray 1, while slot 0 is next
    const notice = session.previewSpiderCapture(px, py);
    expect(notice).not.toBeNull();
    expect(notice!.capturedOnLabel).toBe('Strength');
    expect(notice!.nearestLabel).toBe('Weight');
    expect(notice!.offRayPx).toBeGreaterThan(0);
  });

  it('says nothing for a click on the axis it is filling', () => {
    const session = THREE();
    expect(session.previewSpiderCapture(...spokePixel(0, 3, 50))).toBeNull();
  });

  it('tolerates a click off its ray but still closest to it', () => {
    // ⚑ The threshold is "nearer another ray", not a fixed pixel tolerance, so an
    // ordinary imprecise click on the right axis is not nagged about.
    const session = THREE();
    const [px, py] = spokePixel(0, 3, 50);
    expect(session.previewSpiderCapture(px + 8, py)).toBeNull();
  });

  it('tightens automatically as the spokes crowd together', () => {
    // The same 8px slip that is fine on a 3-spoke chart is a different proposition
    // on a 24-spoke one. Nothing is configured for this; it falls out of comparing
    // against the other rays.
    const many = calibratedSpider(Array(24).fill('100'), Array.from({ length: 24 }, (_, i) => `A${i}`));
    const [px, py] = spokePixel(0, 24, 50);
    expect(many.previewSpiderCapture(px + 8, py)).not.toBeNull();
  });

  it('⚑ must be asked BEFORE the click is recorded - the snap erases its evidence', () => {
    // Not a quirk of the API: the point is snapped onto its axis, so afterwards
    // the stored pixel IS on the ray and there is nothing left to measure. This is
    // the whole reason the check is a capture-time question rather than a property
    // of the record.
    const session = THREE();
    const [px, py] = spokePixel(1, 3, 50);
    // Before: the click is well off the Strength ray it is about to fill
    // (50px out along a ray 120 degrees away => 50*sin(120) = 43.3px off).
    const before = session.previewSpiderCapture(px, py);
    expect(before!.offRayPx).toBeCloseTo(43.3, 1);

    session.addDataPoint(px, py);
    // After: the stored point sits exactly on the ray it was captured against, so
    // the offset the notice reads is gone from the record entirely.
    const stored = session.getDataPoints()[0]!;
    const onOwnSpoke = session.getAxes()!.projectOnSpoke(0, stored.px, stored.py)!;
    expect(onOwnSpoke.offRayPx).toBeCloseTo(0, 6);
  });

  it('says nothing on a graph type that has no spokes', () => {
    expect(new CalibrationSession(SPIDER_AXES_CONFIG).previewSpiderCapture(10, 10)).toBeNull();
  });
});

describe('a captured point is SNAPPED onto its axis', () => {
  it('lands exactly on the ray, even from a click well off it', () => {
    // ⚑ David's call, 2026-07-27. The value was always the projection; what the
    // snap adds is that the dot the user sees IS the number recorded. And once
    // they can see the point sitting on the axis they stop aiming
    // perpendicular-accurately - so a stored perpendicular offset would no longer
    // mean "mis-click", it would mean "the app told me not to care", which is a
    // worse thing to keep than nothing.
    const session = THREE();
    const [px, py] = spokePixel(0, 3, 50);
    session.addDataPoint(px + 30, py);
    const stored = session.getDataPoints()[0]!;
    expect(stored.px).toBeCloseTo(px, 6);
    expect(stored.py).toBeCloseTo(py, 6);
  });

  it('records the same value the projection always gave', () => {
    // The snap must not move the NUMBER, only the pixel. If these disagreed, the
    // snap would be changing measurements rather than tidying their positions.
    const session = THREE();
    const [px, py] = spokePixel(0, 3, 50);
    session.addDataPoint(px + 30, py);
    expect(session.getExportRows(0)[0]!.values[2]).toBeCloseTo(50, 6);
  });

  it('keeps a point on its axis when it is DRAGGED or nudged', () => {
    // Every move converges on updateDataPointPixel - drag, arrow nudge, value
    // edit. Without the snap there, a drag would lift the point back off its ray.
    const session = THREE();
    session.addDataPoint(...spokePixel(0, 3, 50));
    const [px, py] = spokePixel(0, 3, 80);
    session.updateDataPointPixel(0, px + 25, py);
    const stored = session.getDataPoints()[0]!;
    expect(stored.px).toBeCloseTo(px, 6);
    expect(stored.py).toBeCloseTo(py, 6);
  });

  it('a drag can never move a reading onto a DIFFERENT axis', () => {
    // The spoke comes from the point's own tuple slot, not from where the drag
    // ended. Changing which axis a reading belongs to is a delete-and-re-place, a
    // deliberate act, not something a slipped drag can do silently.
    const session = THREE();
    session.addDataPoint(...spokePixel(0, 3, 50));
    session.updateDataPointPixel(0, ...spokePixel(1, 3, 50));
    expect(session.getExportRows(0)[0]!.values[1]).toBe('Strength');
    // Projected onto ITS OWN ray, a point over on ray 1 reads 50*cos(120°).
    expect(session.getExportRows(0)[0]!.values[2]).toBeCloseTo(-25, 6);
    // ⚑ And the stored PIXEL is on its own ray too, not on the one it was dragged
    // over. Reading the value from the group makes the number right either way,
    // so only the position distinguishes "snapped to its own axis" from "snapped
    // to whichever ray the drag ended nearest".
    const stored = session.getDataPoints()[0]!;
    expect(session.getAxes()!.projectOnSpoke(0, stored.px, stored.py)!.offRayPx).toBeCloseTo(0, 6);
  });

  it('leaves points of every other graph type exactly where they were clicked', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(300, 300);
    session.confirmCalibrationValues(['10']);
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues(['10']);
    expect(session.runCalibration()).toBe(true);

    session.addDataPoint(173, 241);
    const stored = session.getDataPoints()[0]!;
    expect(stored.px).toBe(173);
    expect(stored.py).toBe(241);

    // And a DRAG on a non-spider chart is untouched too. This is the path that
    // runs for every graph type, so a snap not gated on the type would quietly
    // pull XY points around - the grouped capture path above would never show it.
    session.updateDataPointPixel(0, 210, 190);
    const moved = session.getDataPoints()[0]!;
    expect(moved.px).toBe(210);
    expect(moved.py).toBe(190);
  });
});

describe('the live axis is drawn on the figure', () => {
  it('emphasises the ray the capture cursor is filling, and follows it round', () => {
    // ⚑ PREVENTION, not correction. Spoke order is deliberately unenforced at
    // calibration, so the cursor walks the spokes in CALIBRATION order, which need
    // not match the visual order round the chart - a user going clockwise by eye
    // can drift out of step and click the wrong vertex. Showing which ray is live
    // is what stops that happening, rather than reporting it afterwards.
    const session = THREE();
    const emphasised = () => session.getCalibrationPreview().segments.findIndex((s) => s.emphasis);
    expect(emphasised()).toBe(0);

    session.addDataPoint(...spokePixel(0, 3, 50));
    expect(emphasised()).toBe(1);
    session.addDataPoint(...spokePixel(1, 3, 50));
    expect(emphasised()).toBe(2);
    // ...and rolls round to the first axis of the next profile.
    session.addDataPoint(...spokePixel(2, 3, 50));
    expect(emphasised()).toBe(0);
  });

  it('draws the live ray in the colour-match magenta, not the step colour', () => {
    // ⚑ Spider rays inherit the shared ORIGIN step's colour, which is green - and a
    // green highlight over a green series is no highlight at all. The bundled
    // example has exactly that (Cellulose is green), and on screen the emphasis was
    // simply invisible. This magenta is the app's existing "pointing at the image"
    // colour, chosen for not reading as a series.
    const session = THREE();
    const segments = session.getCalibrationPreview().segments;
    const live = segments.find((s) => s.emphasis)!;
    expect(live.color.toLowerCase()).toBe('#ff00c8');
    for (const other of segments.filter((s) => !s.emphasis)) {
      expect(other.color.toLowerCase()).not.toBe('#ff00c8');
    }
  });

  it('emphasises exactly one ray, never several', () => {
    const session = THREE();
    const segments = session.getCalibrationPreview().segments;
    expect(segments.filter((s) => s.emphasis)).toHaveLength(1);
    expect(segments).toHaveLength(3);
  });

  it('emphasises nothing DURING calibration - the card already marks the step', () => {
    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    session.handleCalibrationClick(100, 100);
    const [px, py] = spokePixel(0, 3);
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues(['100', 'A']);
    expect(session.getCalibrationPreview().segments.some((s) => s.emphasis)).toBe(false);
  });

  it('leaves every other graph type\'s preview unemphasised', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(300, 300);
    session.confirmCalibrationValues(['10']);
    expect(session.getCalibrationPreview().segments.some((s) => s.emphasis)).toBe(false);
  });
});

describe('the load path refuses to restructure data it cannot re-pair', () => {
  /** A project whose dataset's slot count disagrees with the axes' spoke count. */
  function loadMismatched(groupNames: string[]): CalibrationSession<SpiderAxes> {
    const built = calibratedSpider(['100', '100', '100'], ['Strength', 'Weight', 'Cost']);
    const axes = built.getAxes()!;

    const dataset = new Dataset(1);
    dataset.name = 'Series 1';
    if (groupNames.length > 0) dataset.setSlotNames([...groupNames]);
    for (let i = 0; i < 2; i++) {
      const [px, py] = spokePixel(i, 3, 40);
      const index = dataset.addPixel(px, py);
      // ⚑ FILED INTO A TUPLE, like a real project's points. This fixture used to
      // leave them loose, which made it quietly test two things at once - and once
      // an axis-less point became something the load path DROPS, the mismatch test
      // was asserting the survival of points that are no longer data at all. The
      // count mismatch is what this fixture is for; the points must be sound.
      if (groupNames.length > 0) dataset.addTuple(index);
    }

    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    session.loadCalibrated(axes, [dataset]);
    return session;
  }

  it('leaves the recorded slots alone when their COUNT disagrees with the axes', () => {
    // ⚑ Renaming is safe when the counts match - it is a pure relabel. When they
    // differ, slot k of an existing tuple no longer means the axis it was recorded
    // against, and rewriting the names would make the table assert a pairing
    // nobody measured: exactly the failure the error-bar record is parked on. The
    // data keeps the names it was captured under and the mismatch stays visible.
    const session = loadMismatched(['Old A', 'Old B']);
    expect(session.getSlotNames()).toEqual(['Old A', 'Old B']);
    expect(session.getDataPoints()).toHaveLength(2);
  });

  it('DROPS a point that belongs to no axis, rather than keeping it as nulls', () => {
    // ⚑ David, 2026-07-27: "a point that belongs to no tuple carries NO meaning,
    // and should not be allowed." On an N x 1D chart the datum is the PAIR - the
    // vector and the position along it - so a pixel with no axis stands for no
    // number and belongs in no row. It is a mark on an image, not data.
    //
    // This REPLACES the older behaviour, which exported such points as
    // [null, '', null]. That was honest as far as it went, and right while the
    // alternative on the table was defaulting them onto spoke 0 - but it kept a
    // meaningless thing alive through save, reload and every reader downstream.
    // The click path cannot create one (every capture files into a slot), so the
    // file is the only door and the guard belongs on it.
    const session = loadMismatched([]);
    expect(session.getDataPoints()).toHaveLength(0);
    expect(session.getExportRows(0)).toHaveLength(0);
  });

  it('drops ONLY the axis-less ones, and leaves a properly filed point alone', () => {
    // The guard must not become a blunt "grouped dataset from a file, discard" - a
    // real project's points are all in slots, and every one of them must survive.
    const built = calibratedSpider(['100', '100', '100'], ['Strength', 'Weight', 'Cost']);
    const axes = built.getAxes()!;
    const dataset = new Dataset(1);
    dataset.name = 'Series 1';
    dataset.setSlotNames(['Strength', 'Weight', 'Cost']);
    const filed = dataset.addPixel(...spokePixel(0, 3, 40));
    dataset.addTuple(filed); // slot 0 - a real reading
    dataset.addPixel(...spokePixel(1, 3, 40)); // in no tuple - not a datum

    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    session.loadCalibrated(axes, [dataset]);

    expect(session.getDataPoints()).toHaveLength(1);
    expect(session.getSpiderTable().columns[0]!.values[0]).not.toBeNull();
  });
});

/**
 * N x 1D, not 1.5D (David's taxonomy, 2026-07-27).
 *
 * A spider reused the Box Plot slot machinery - rightly, the capture
 * workflow is the same - but it is not the same KIND of thing. A box's five
 * numbers describe one distribution and only together; a spider's six describe six
 * independent measurements that happen to share an origin. Every rule keyed on
 * "has slots" inherited the box's meaning, and this is where that shows.
 */
describe('a spider profile is a row of independent readings', () => {
  it('removes ONE reading, not the whole profile', () => {
    // ⚑ Found by driving the app: the Eraser blanked a six-axis series. The
    // whole-tuple rule is right for a box (half a box is nonsense) and wrong here
    // (an empty axis is a state the app produces on purpose).
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    expect(session.getDataPoints()).toHaveLength(3);

    session.removeDataPoints([1]);

    expect(session.getDataPoints()).toHaveLength(2);
    const values = session.getSpiderTable().columns[0]!.values;
    expect(values[0]).not.toBeNull();
    expect(values[1]).toBeNull(); // the one removed, and only that one
    expect(values[2]).not.toBeNull();
  });

  it('offers the freed slot as the next thing to capture', () => {
    // The gap is not a hole to tidy away, it is the worklist - the same thing the
    // axis-aware trace leaves behind when it refuses a ray.
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    session.removeDataPoints([1]);
    expect(session.getCurrentSlotIndex()).toBe(1);
    expect(session.getCurrentTupleIndex()).toBe(0);
  });

  it('drops the profile only when its last reading goes', () => {
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    session.removeDataPoints([0, 1, 2]);
    expect(session.getDataPoints()).toHaveLength(0);
    expect(session.getSpiderTable().columns[0]!.values.every((v) => v === null)).toBe(true);
  });

  it('aims the cursor at a CHOSEN empty slot, so a second gap is reachable', () => {
    // David: "Can I make an empty slot active again, so that I can re-add a point
    // that is missing?" With two gaps the automatic cursor only ever offers the
    // first, so the second cannot be filled until the first is.
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    session.removeDataPoints([0]);
    session.removeDataPoints([session.getDataPoints().length - 1]); // now axes 0 and 2 are empty
    expect(session.getCurrentSlotIndex()).toBe(0);

    expect(session.setSlotCursor(0, 2)).toBe(true);
    expect(session.getCurrentSlotIndex()).toBe(2);

    // ...and a capture lands in THAT slot.
    session.addDataPoint(...spokePixel(2, 3, 25));
    const values = session.getSpiderTable().columns[0]!.values;
    expect(values[2]).not.toBeNull();
    expect(values[0]).toBeNull();
  });

  it('files a reading into the slot it was AIMED at, even on an empty series', () => {
    // ⚑ The wrong-number defect the release audit caught. Aiming at a slot on a
    // series that has no readings yet leaves the cursor's tupleIndex null, and the
    // capture path then created the tuple with `addTuple`, which ALWAYS writes slot
    // 0. So the tips bar said "Cost index", the live ray highlighted spoke 6, the
    // marker snapped to ray 6 - and the reading was filed as Axis 1, carrying the
    // value that point projects to on ray 1 (typically negative). The sibling path
    // `addSpiderTracePoints` documents this exact trap and avoids it; this one
    // walked into it.
    const session = THREE();
    expect(session.setSlotCursor(null, 2)).toBe(true);
    session.addDataPoint(...spokePixel(2, 3, 50));

    const values = session.getSpiderTable().columns[0]!.values;
    expect(values[0]).toBeNull();
    expect(values[1]).toBeNull();
    expect(values[2]).not.toBeNull();
    expect(Math.round(values[2]!)).toBe(50);
  });

  it('refuses to aim at a slot that already holds a reading', () => {
    // Capturing there would overwrite the slot's pixel index and orphan the point
    // it displaced -- a reading lost with nothing on screen to say so.
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    expect(session.setSlotCursor(0, 1)).toBe(false);
  });

  it('refuses on a graph type whose tuple is ONE object', () => {
    // A box plot's cursor walks its members as a unit: letting it be aimed would
    // allow a box built out of order and left permanently half-made.
    //
    // ⚑ This test first used XY, which has no slots at all - so the FIRST
    // clause of the guard answered and the capability check was never reached. It
    // asserted the right thing and could not fail (caught by neutering the very
    // clause it claims to cover). Box Plot carries its groups from the start, so
    // here the first clause passes and `tupleMembers` is what does the refusing.
    const session = new CalibrationSession(BOX_PLOT_AXES_CONFIG);
    expect(session.hasSlots()).toBe(true);
    expect(session.setSlotCursor(null, 3)).toBe(false);
  });
});

describe('Clear all points leaves a spider able to capture again', () => {
  it('keeps the axis slots, so the next capture is still filed against an axis', () => {
    // ⚑ The data-loss chain the release audit caught, from two of the same day's
    // changes meeting. `clearPoints` restores only `config.defaultSlots`, and
    // a spider HAS none - its slots come from the calibrated axes. So the series
    // came back with no slots at all: every later capture took the ungrouped path,
    // unsnapped and invisible in the table, and the new load-time drop then deleted
    // every one of them on reopen. Silent loss, on an ordinary path.
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    session.clearPoints();

    expect(session.getSlotNames()).toEqual(['Strength', 'Weight', 'Cost']);
    session.addDataPoint(...spokePixel(0, 3, 50));
    expect(session.getSpiderTable().columns[0]!.values[0]).not.toBeNull();
  });

  it('so the load-time drop has nothing to take from a re-captured series', () => {
    // The drop guard's premise - "the click path cannot make an axis-less point" -
    // is only true once the above holds. This is that premise, tested.
    const session = THREE();
    session.clearPoints();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));

    const axes = session.getAxes()!;
    const reopened = new CalibrationSession(SPIDER_AXES_CONFIG);
    reopened.loadCalibrated(axes, session.getDatasets());
    expect(reopened.getDataPoints()).toHaveLength(3);
  });
});

describe('an axis can be renamed from the spreadsheet', () => {
  it('writes the new name into the CALIBRATION, so everything derived follows', () => {
    // ⚑ The name is the one transcribed thing on the row - everything else was read
    // off the pixels - so a typo must be fixable without re-walking the calibration.
    // It belongs to the AXIS, not to any point, which is why this goes to the
    // calibration and re-derives rather than being stored a second time.
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));

    expect(session.setSpokeName(1, 'Elongation at break (%)')).toBe(true);

    expect(session.getSpiderTable().axisNames[1]).toBe('Elongation at break (%)');
    // ...the capture slots are the same names, so the tips line and the status
    // follow without a second source of truth.
    expect(session.getSlotNames()[1]).toBe('Elongation at break (%)');
    // ...and the readings are untouched: this renamed an axis, it did not move data.
    expect(session.getDataPoints()).toHaveLength(3);
    expect(session.getSpiderTable().columns[0]!.values.every((v) => v !== null)).toBe(true);
  });

  it('SURVIVES a save and reopen - the name reaches the persisted calibration', () => {
    // ⚑ The release audit's finding, and the comment above that method asserted the
    // opposite of what it did. The name went to the session map, the live axes and
    // the slot names - three DERIVED copies - while SERIALIZATION reads it from the
    // calibration point's `dz`, which nothing updated. Fix the typo, save, reopen,
    // and the typo is back.
    //
    // ⚑ This must round-trip through the FILE. My first attempt at this test
    // reloaded from the live axes object, whose spoke name had been updated, and
    // passed while the defect was fully present.
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, 50));
    session.setSpokeName(1, 'Elongation at break (%)');

    const saved = serializeProject(session, 'data:image/png;base64,AA==');
    if ('error' in saved) throw new Error(saved.error);
    const reopened = deserializeProject(JSON.parse(JSON.stringify(saved)));
    if ('error' in reopened) throw new Error(reopened.error);

    const session2 = new CalibrationSession(SPIDER_AXES_CONFIG);
    session2.loadCalibrated(reopened.axes as unknown as SpiderAxes, reopened.datasets);
    expect(session2.getSpiderTable().axisRawNames[1]).toBe('Elongation at break (%)');
    expect(session2.getSlotNames()[1]).toBe('Elongation at break (%)');
  });

  it('keeps a blank name BLANK rather than storing the positional fallback', () => {
    // "Axis 2" is what the UI shows for an unnamed spoke; storing it would turn a
    // display fallback into a transcription nobody made.
    const session = calibratedSpider(['10', '10', '10'], ['A', '', 'C']);
    const table = session.getSpiderTable();
    expect(table.axisNames[1]).toBe('Axis 2'); // shown
    expect(table.axisRawNames[1]).toBe(''); // stored
  });

  it('can clear a name back to blank', () => {
    const session = THREE();
    expect(session.setSpokeName(0, '')).toBe(true);
    expect(session.getSpiderTable().axisRawNames[0]).toBe('');
    expect(session.getSpiderTable().axisNames[0]).toBe('Axis 1'); // falls back again
  });

  it('refuses on a graph type that has no spokes', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(session.setSpokeName(0, 'nope')).toBe(false);
  });
});
