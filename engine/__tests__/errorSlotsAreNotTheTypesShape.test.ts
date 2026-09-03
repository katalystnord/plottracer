/**
 * B4, the UI half - ⚑⚑ ERROR SLOTS ARE AN ADDITION TO A SERIES, NOT A CHANGE OF
 * WHAT THE SERIES IS.
 *
 * The model half (commits 1–10 plus the capture switch) puts a datum's caps on
 * its own tuple. That gives every series that carries error a `_tuples` array -
 * and `hasSlots()` answers "does this dataset have named slots", so from that
 * moment an XY scatter reported itself as a TUPLE-SHAPED graph type. It is not
 * one. It is an XY scatter with extents on its points.
 *
 * ⚑⚑ CLAUDE.md pattern 1, in its second incarnation: *"does this belong to the
 * TYPE, or to an AXIS?"* - here, to the TYPE or to the SERIES. A heatmap's third
 * dimension was collapsed into a property of a cell; this is the mirror mistake,
 * a property of a series inflating into a property of the type. The cost is the
 * same shape too: everything downstream forks.
 *
 * ⚠️ MEASURED before writing these, on the capture branch, so none of it is
 * hypothetical:
 *
 *   · the XY data panel switched to the tuple table, which prints `data[0]` per
 *     slot - so a point at (5, 5) with caps at 7 and 3 exported as
 *     `Value 5 · SD upper 5 · SD lower 5`. **The y coordinate and both readings
 *     were gone, silently, and the record underneath was correct all along.**
 *   · `isBarIntervalShape` compares the slot COUNT to `OPPOSITE_CORNER_SLOTS.length`,
 *     so a bar chart lost its category table the moment one error bar was added.
 *   · `computeSlotCursorFor` scans for the first empty member, which after a
 *     one-sided capture is 'SD left' - so reloading a project aimed the next
 *     click at an error slot.
 *
 * ⚑ The distinction these tests pin is between two questions that `hasSlots()`
 * was answering at once:
 *
 *   STORAGE - "are the pixels filed into tuples?" -> Dataset.hasSlots(), which
 *             the capture path still asks and which stays true.
 *   SHAPE   - "is this a tuple-shaped graph type?" -> the type's OWN slots, with
 *             the error tail removed. This is what the panels and the export ask.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG, BAR_AXES_CONFIG } from '../calibrationSession.js';
import {
  BOX_PLOT_SLOTS,
  OPPOSITE_CORNER_SLOTS,
  HISTOGRAM_SLOTS,
  PIE_SECTOR_SLOTS,
} from '../axesTypeConfigs.js';
import { ownSlotNames, errorSlotNames } from '../../algorithms/errorExtent.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/** x 0..10 over px 100..300; y 0..10 over py 300..100. */
function xySession() {
  const s = new CalibrationSession(XY_AXES_CONFIG);
  for (const [px, py, v] of [
    [100, 300, '0'],
    [300, 300, '10'],
    [100, 300, '0'],
    [100, 100, '10'],
  ] as Array<[number, number, string]>) {
    expect(s.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues([v])).toBe(true);
  }
  expect(s.runCalibration()).toBe(true);
  s.renameDataset(0, 'Sample');
  return s;
}

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

/** One datum at (5, 5) with caps at y = 7 and y = 3. */
function xyWithError() {
  const s = xySession();
  s.addDataPoint(200, 200);
  expect(
    s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 200 },
      capPixel: { x: 200, y: 160 },
      baseName: 'SD',
    })
  ).toBeNull();
  return s;
}

describe("the type's own slots, with the error tail removed", () => {
  it('a list with no error tail is its own slots unchanged', () => {
    expect(ownSlotNames(BOX_PLOT_SLOTS)).toEqual([...BOX_PLOT_SLOTS]);
    expect(ownSlotNames([])).toEqual([]);
  });

  it("a slotted type's own slots survive the error tail", () => {
    expect(ownSlotNames(errorSlotNames('SD', OPPOSITE_CORNER_SLOTS))).toEqual([...OPPOSITE_CORNER_SLOTS]);
    expect(ownSlotNames(errorSlotNames('95% CI', BOX_PLOT_SLOTS))).toEqual([...BOX_PLOT_SLOTS]);
  });

  it('⚑ a type that had NO slots reads back as having none', () => {
    // `errorSlotNames` synthesises a single 'Value' slot to stand for the datum
    // on a type with no slots of its own. It is a placeholder, not a member --
    // an XY point's columns are X and Y -- so it must not be reported as one.
    expect(ownSlotNames(errorSlotNames('SD'))).toEqual([]);
  });

  it('⚑⚑ no shipped type declares a single slot named "Value"', () => {
    // The guard above recognises the synthetic placeholder BY NAME, which is
    // only safe while no real type can produce the same list. This is that
    // premise, as a test, so a future 1-slot type called 'Value' fails here
    // rather than silently losing its table.
    const shipped: readonly (readonly string[])[] = [
      BOX_PLOT_SLOTS,
      OPPOSITE_CORNER_SLOTS,
      HISTOGRAM_SLOTS,
      PIE_SECTOR_SLOTS,
    ];
    for (const slots of shipped) {
      expect(ownSlotNames(errorSlotNames('SD', slots)), `${slots.join('/')} must survive`).toEqual([
        ...slots,
      ]);
    }
  });
});

describe('an XY series that gained error slots is still an XY series', () => {
  it('the session does not report it as a slotted type', () => {
    const s = xyWithError();
    expect(s.getDataset().hasSlots(), 'the STORAGE really is tuples now').toBe(true);
    expect(s.hasSlots(), 'but the TYPE is not tuple-shaped').toBe(false);
  });

  it('its export shape stays flat', () => {
    // ⚠️ This is the one that destroyed data: the tuples exporter prints
    // `data[0]` per slot, so every column of an XY row read back its x.
    expect(xyWithError().getExportShape()).toBe('flat');
  });

  it("the panel's slot names are the type's own - none, for XY", () => {
    expect(xyWithError().getSlotNames()).toEqual([]);
  });

  it('the error slot names are still reachable, under their own name', () => {
    expect(xyWithError().getErrorSlotNames()).toEqual(['SD upper', 'SD lower', 'SD left', 'SD right']);
  });

  it('⚑ a series with no error at all reports no error slots', () => {
    const s = xySession();
    s.addDataPoint(200, 200);
    expect(s.getErrorSlotNames()).toEqual([]);
  });

  it('⚑ the STORAGE path is untouched - a later datum still gets its own tuple', () => {
    // The companion assertion for what must STILL work: routing the SHAPE
    // question away from `hasSlots()` must not route the CAPTURE question away
    // with it, or the next point would land as a loose pixel that no tuple owns
    // and no cap could ever attach to.
    const s = xyWithError();
    expect(s.addDataPoint(250, 250)).toBe('point-added');
    expect(s.getDataset().getAllTuples()).toHaveLength(2);
    const bars = s.getResolvedErrorBars(0);
    expect(bars).toHaveLength(2);
    expect(bars[0]!.yUpper).toBeCloseTo(7, 6);
    expect(bars[1]!.x).toBeCloseTo(7.5, 6);
  });
});

describe('the capture cursor never aims at an error slot', () => {
  /** Reopen a session's data the way a project file does - the entrance that
   * recomputes the slot cursor from the tuples, since the cursor is not part of
   * the file (see computeSlotCursorFor). */
  const reopen = (s: CalibrationSession<never>) => {
    const fresh = new CalibrationSession(s.getConfig());
    fresh.loadCalibrated(s.getAxes()!, s.getDatasets());
    return fresh;
  };

  it('⚑⚑ reopening a project does not point the next click at "SD left"', () => {
    // `computeSlotCursorFor` walks to the first EMPTY member. After a capture
    // the mirrored pair fills upper and lower, so the tuple's first empty member
    // is 'SD left' - and the cursor is recomputed on every load, which aimed the
    // next click there. An error slot is filled by DRAGGING a cap, never by the
    // click walk, so it must not be a destination.
    const reloaded = reopen(xyWithError() as never);
    expect(reloaded.getCurrentSlotIndex()).toBe(0);
    expect(reloaded.getCurrentTupleIndex()).toBeNull();
    expect(reloaded.addDataPoint(250, 250)).toBe('point-added');
    expect(reloaded.getDataset().getAllTuples(), 'the click opened its OWN tuple').toHaveLength(2);
  });

  it('⚑⚑ the LIVE cursor does not walk into one either - the second entrance', () => {
    // ⚠️ FOUND BY A FIXTURE WITH FOUR POINTS INSTEAD OF ONE. `computeSlotCursorFor`
    // was fixed first, and it is only the LOAD entrance; `nextSlot` advances the
    // cursor during capture and had the same whole-tuple scan. Measured, with
    // four datums each given a cap:
    //
    //     tuples after the third click:  [[0,1,2,null,null], [3,6,5,7,null]]
    //                                                            ^ pixel 7, the
    //     third DATA POINT, filed into 'SD left' of the second datum's tuple.
    //
    // The fourth capture then refused, because the point it was dragged from was
    // not a datum any more. "Guards belong in the model, and the model has more
    // than one entrance" - the third time this file's own comments say so.
    const s = xySession();
    for (const px of [120, 160, 200, 240]) {
      const py = 400 - px;
      expect(s.addDataPoint(px, py)).toBe('point-added');
      expect(
        s.captureErrorCap({
          targetIndex: 0,
          datumPixel: { x: px, y: py },
          capPixel: { x: px, y: py - 60 },
          baseName: 'SD',
        }),
        `the cap on the datum at px ${px}`
      ).toBeNull();
    }
    expect(s.getDataset().getAllTuples()).toHaveLength(4);
    for (const tuple of s.getDataset().getAllTuples()) {
      expect(tuple.slice(3), 'no click may land in a horizontal error slot').toEqual([null, null]);
    }
    expect(s.getDatasetInfos()[0]!.pointCount).toBe(4);
  });

  it('⚑ a genuinely half-built tuple is still walked to', () => {
    // The companion assertion: only the ERROR tail may be skipped. A box plot
    // two members in still has to send the next click to member 3.
    const s = barSession();
    expect(s.applyBoxPlotGroups()).toBe(true);
    s.addDataPoint(200, 300);
    s.addDataPoint(200, 280);
    const reloaded = reopen(s as never);
    expect(reloaded.getCurrentTupleIndex()).toBe(0);
    expect(reloaded.getCurrentSlotIndex()).toBe(2);
  });
});

describe('a BAR series that gained error slots is still a bar', () => {
  it("its own slots come back without the error tail", () => {
    const s = barSession();
    s.addDataPoint(200, 300);
    s.addDataPoint(200, 200);
    s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 300 },
      capPixel: { x: 200, y: 180 },
      baseName: 'SD',
    });
    expect(s.getSlotNames()).toEqual([...OPPOSITE_CORNER_SLOTS]);
    expect(s.hasSlots(), 'a bar IS tuple-shaped, error or not').toBe(true);
    expect(s.getExportShape()).toBe('tuples');
  });

  it('⚑ it keeps its category table', () => {
    // `isBarIntervalShape` compared the slot COUNT to OPPOSITE_CORNER_SLOTS.length,
    // so one error bar took the bar chart's whole category table away.
    const s = barSession();
    s.addDataPoint(200, 300);
    s.addDataPoint(200, 200);
    const before = s.getBarCategoryTable();
    expect(before.categoryNames.length, 'the bar is in the table to begin with').toBeGreaterThan(0);
    s.captureErrorCap({
      targetIndex: 0,
      datumPixel: { x: 200, y: 300 },
      capPixel: { x: 200, y: 180 },
      baseName: 'SD',
    });
    const after = s.getBarCategoryTable();
    expect(after.categoryNames).toEqual(before.categoryNames);
    expect(after.columns[0]!.cells.map((c) => c[0])).toEqual(before.columns[0]!.cells.map((c) => c[0]));
  });
});

describe('an error cap is not a data point', () => {
  it('⚑ the series list counts datums, not caps', () => {
    // David's e2e read `Series 1 (3)` for ONE point with an error bar, because
    // the two caps are now pixels of that series. A cap is part of a point's
    // reading, not another point.
    const s = xyWithError();
    expect(s.getDatasetInfos()[0]!.pointCount).toBe(1);
    s.addDataPoint(250, 250);
    expect(s.getDatasetInfos()[0]!.pointCount).toBe(2);
  });

  it('⚑ a series with no error still counts every pixel', () => {
    const s = xySession();
    s.addDataPoint(200, 200);
    s.addDataPoint(250, 250);
    expect(s.getDatasetInfos()[0]!.pointCount).toBe(2);
  });
});
