import { describe, expect, it } from 'vitest';
import { BOX_PLOT_AXES_CONFIG, CalibrationSession, PIE_AXES_CONFIG } from '../calibrationSession.js';
import type { PieAxes } from '../../core/axes/pie.js';

/**
 * Capturing a pie's slices — one click per boundary.
 *
 * ⚑ A pie's slices SHARE their boundaries, which is what separates this from every
 * other tuple-shaped type. A histogram's bins do not: bins can have gaps and uneven
 * widths, so its two corners belong to that bar alone and are clicked as a pair. Ask
 * for a pair here and the user measures the same line twice, gets two slightly
 * different answers for it, and does twenty clicks on a ten-slice pie.
 */

const CX = 300;
const CY = 200;
const R = 120;

function at(deg: number, r = R): [number, number] {
  const t = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(t), CY + r * Math.sin(t)];
}

/** A calibrated pie: outline first, centre fitted, then the two globals. */
function calibratedPie(total = '100'): CalibrationSession<PieAxes> {
  const session = new CalibrationSession(PIE_AXES_CONFIG);
  for (const a of [90, 210, 330]) session.handleCalibrationClick(...at(a));
  session.setGlobalFieldValue('total', total);
  expect(session.runCalibration()).toBe(true);
  return session;
}

/**
 * Click boundaries at the given angles, in order around the pie.
 *
 * ⚑ THE WALK GOES CLOCKWISE, which is both how a pie is conventionally read and the
 * positive direction of the measuring frame (image y runs DOWN, so increasing angle
 * turns clockwise on screen). Twelve o'clock is -90 here. A sector runs from its
 * FIRST boundary to its second, so walking the other way reports each slice's
 * complement -- 75 where 25 was meant. That failure is loud rather than silent: four
 * quarters would total 300, and the figure's own total says otherwise, so nothing
 * needs to infer the direction from the clicks.
 */
function clickBoundaries(session: CalibrationSession<PieAxes>, degs: number[]): void {
  for (const d of degs) expect(session.addDataPoint(...at(d))).toBe('point-added');
}

describe('one click per boundary', () => {
  it('closes a sector and opens the next with the same click', () => {
    const session = calibratedPie();
    const ds = session.getDataset();
    clickBoundaries(session, [-90, 0]);
    // Two clicks: one complete sector, and the next already opened on that same edge.
    expect(ds.getTupleCount()).toBe(2);
    expect(ds.getTuple(0)).toEqual([0, 1]);
    const opened = ds.getTuple(1)![0]!;
    expect(ds.getTuple(1)![1]).toBeNull();
    // ⚑ Its OWN pixel, at the same place -- not a shared index. Sharing could not
    // survive the project file: a pixel serialises with one {tuple, group}, so every
    // sector after the first reopened missing its opening edge.
    expect(opened).not.toBe(1);
    expect(ds.getPixel(opened).x).toBeCloseTo(ds.getPixel(1).x, 9);
    expect(ds.getPixel(opened).y).toBeCloseTo(ds.getPixel(1).y, 9);
  });

  it('asks for one CLICK per boundary, however many slices there are', () => {
    // ⚑ The point of chaining is the CLICKING, not the storage: a boundary is one
    // piece of ink and the user points at it once. Each sector still keeps its own
    // copy, because that is what the project file can represent.
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0, 90, 180]);
    const complete = session.getDataset().getAllTuples().filter((t) => t.every((v) => v !== null));
    expect(complete).toHaveLength(3); // four boundaries bound three sectors
    for (const t of complete) expect(new Set(t).size).toBe(2); // no sector reuses a pixel
  });

  it('reads each completed sector as the angle actually swept', () => {
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0, 90, 180, 270]); // five clicks close four sectors
    const axes = session.getAxes()!;
    const ds = session.getDataset();
    const values = ds
      .getAllTuples()
      .filter((t) => t.every((v) => v !== null))
      .map((t) => {
        const a = ds.getPixel(t[0]!);
        const b = ds.getPixel(t[1]!);
        return axes.sectorValue(axes.angleAt(a.x, a.y), axes.angleAt(b.x, b.y), 100);
      });
    // Four quarter-turns, clicked clockwise from twelve o'clock.
    expect(values).toHaveLength(4);
    for (const v of values) expect(v).toBeCloseTo(25, 6);
    expect(values.reduce((s, v) => s + v, 0)).toBeCloseTo(100, 6);
  });

  it('leaves the ring open until the user closes it', () => {
    // ⚑ Whether the last sector wraps is something only the FIGURE knows -- a half
    // pie does not -- so nothing here infers "you must be finished". Four boundaries
    // leave three complete sectors and one still open.
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0, 90, 180]);
    const complete = session.getDataset().getAllTuples().filter((t) => t.every((v) => v !== null));
    expect(complete).toHaveLength(3);
  });
});

describe('chaining is opt-in, not the default for tuples', () => {
  it('is declared by the pie and not by the histogram', () => {
    // A bin's two corners belong to that bar alone: bins can have gaps and uneven
    // widths, so chaining them would invent an adjacency the figure never showed.
    expect(PIE_AXES_CONFIG.chainTuples).toBe(true);
  });
});

describe('the direction of the walk', () => {
  it('reports the complement when walked backwards — loudly, not silently', () => {
    // ⚑ Nothing infers which way round the user is going, and nothing needs to: walk
    // anticlockwise and four quarter-turns report 75 each, totalling 300 against a
    // figure that says 100. The error is in the numbers rather than hidden by them,
    // which is why this needs no guess and no guard.
    const session = calibratedPie();
    clickBoundaries(session, [90, 0, -90, 180, -270]);
    const axes = session.getAxes()!;
    const ds = session.getDataset();
    const values = ds
      .getAllTuples()
      .filter((t) => t.every((v) => v !== null))
      .map((t) => {
        const a = ds.getPixel(t[0]!);
        const b = ds.getPixel(t[1]!);
        return axes.sectorValue(axes.angleAt(a.x, a.y), axes.angleAt(b.x, b.y), 100);
      });
    for (const v of values) expect(v).toBeCloseTo(75, 6);
    expect(values.reduce((s2, v) => s2 + v, 0)).toBeGreaterThan(100);
  });
});

describe('an exploded slice is captured about its own apex', () => {
  it('takes the apex first, then its two edges', () => {
    // ⚑ Apex FIRST so the guide arc can be drawn about it while the edges are being
    // placed. A pulled-out slice is translated, so its edges no longer point at the
    // pie's centre; measured from there a 90° slice pulled out a tenth of the radius
    // reads ~8° wrong, with the two edges erring in opposite directions so the errors
    // add.
    const session = calibratedPie();
    const apex = { x: CX + 30, y: CY + 30 };

    session.setNextSectorExploded(true);
    expect(session.isAwaitingExplodedApex()).toBe(true);
    expect(session.addDataPoint(apex.x, apex.y)).toBe('point-added');
    // Consumed: explosion arms ONE sector, it is not a mode the figure is in.
    expect(session.isAwaitingExplodedApex()).toBe(false);

    // The apex is not a data point — it is geometry the sector is measured about.
    expect(session.getDataset().getCount()).toBe(0);

    // Its two edges, as a pair: a pulled-out slice shares boundaries with nobody.
    expect(session.addDataPoint(apex.x + 120, apex.y)).toBe('point-added');
    expect(session.addDataPoint(apex.x, apex.y + 120)).toBe('point-added');

    const stored = session.getSectorApex(0);
    expect(stored).not.toBeNull();
    expect(stored!.x).toBeCloseTo(apex.x, 6);
    expect(stored!.y).toBeCloseTo(apex.y, 6);
  });

  it('does NOT chain out of an exploded slice', () => {
    // The gap on both sides is real: the next slice's boundary is its own click, not
    // a continuation of this one. Chaining here would file the exploded slice's edge
    // as its neighbour's start and put every later boundary in the wrong slice.
    const session = calibratedPie();
    session.setNextSectorExploded(true);
    session.addDataPoint(CX + 30, CY + 30);
    session.addDataPoint(CX + 150, CY + 30);
    session.addDataPoint(CX + 30, CY + 150);
    // One tuple, complete, and NO half-open successor opened by the closing click.
    const tuples = session.getDataset().getAllTuples();
    expect(tuples).toHaveLength(1);
    expect(tuples[0]!.every((v) => v !== null)).toBe(true);
  });

  it('reads the pulled-out slice correctly, where the shared centre would not', () => {
    // ⚑ The measurement this whole mechanism exists for.
    const session = calibratedPie();
    const axes = session.getAxes()!;
    // A quarter-turn slice, translated 40px down-right from the fitted centre.
    const apex = { x: CX + 40, y: CY + 40 };
    session.setNextSectorExploded(true);
    session.addDataPoint(apex.x, apex.y);
    session.addDataPoint(apex.x + R, apex.y); // 0°
    session.addDataPoint(apex.x, apex.y + R); // 90°

    const ds = session.getDataset();
    const t = ds.getTuple(0);
    const a = ds.getPixel(t[0]!);
    const b = ds.getPixel(t[1]!);
    const own = session.getSectorApex(0)!;

    const correct = axes.sectorValue(axes.angleAt(a.x, a.y, own), axes.angleAt(b.x, b.y, own), 100);
    const naive = axes.sectorValue(axes.angleAt(a.x, a.y), axes.angleAt(b.x, b.y), 100);
    expect(correct).toBeCloseTo(25, 6);
    expect(Math.abs(naive - 25)).toBeGreaterThan(2); // several points of share
  });

  it('leaves ordinary slices measured about the fitted centre', () => {
    // No apex stored means "this slice never moved" — so the fallback is the pie's
    // own centre, and nothing about an ordinary capture changes.
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0]);
    expect(session.getSectorApex(0)).toBeNull();
  });
});

describe('an exploded slice is named like every other', () => {
  it('gets its auto category label', () => {
    // ⚑ THE BLANK-CATEGORY DEFECT, found by driving the app: a captured pie read
    // Slice0, (blank), Slice2, Slice3 -- the hole being the exploded one.
    //
    // The cause is an ordering trap the rest of the file cannot hit. A label is stored
    // as metadata on the tuple's PRIMARY PIXEL, so `setTupleLabel` silently returns
    // when there is no primary pixel yet. Every other path labels a tuple that has
    // just had a pixel filed into it; the apex branch creates the tuple EMPTY (the
    // apex is not a pixel, it is per-tuple metadata) and labelled it there and then,
    // so the write went nowhere. Silent by construction -- `setTupleLabel` has no way
    // to report that it did nothing.
    const session = calibratedPie();
    session.setNextSectorExploded(true);
    session.addDataPoint(CX + 30, CY + 30);
    clickBoundaries(session, [0, 60]);
    expect(session.getTupleLabel(0)).toBe('Slice0');
  });

  it('numbers it in capture order alongside ordinary slices', () => {
    // The whole run, as the screenshot showed it: an ordinary slice, then a pulled-out
    // one, then another ordinary one. No gaps and no repeats.
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0]); // slice 0
    session.setNextSectorExploded(true);
    session.addDataPoint(CX + 30, CY + 30);
    clickBoundaries(session, [30, 90]); // slice 1, exploded
    clickBoundaries(session, [140, 200]); // slice 2
    expect(session.getTupleLabel(0)).toBe('Slice0');
    expect(session.getTupleLabel(1)).toBe('Slice1');
    expect(session.getTupleLabel(2)).toBe('Slice2');
  });
});

describe('an exploded slice after an ordinary one', () => {
  it('does not strand the tuple that chaining had already opened', () => {
    // ⚑ Found by the e2e, not by reasoning. Completing an ordinary sector pre-opens
    // the next one holding the shared boundary. Declaring THAT slice exploded means
    // the pre-opened tuple is for a sector which will never exist -- left behind it
    // is a permanently incomplete row in the table and an orphan in the file.
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0]); // one ordinary sector; chain opens the next
    expect(session.getDataset().getTupleCount()).toBe(2);

    session.setNextSectorExploded(true);
    session.addDataPoint(CX + 40, CY + 40);
    session.addDataPoint(CX + 40 + R, CY + 40);
    session.addDataPoint(CX + 40, CY + 40 + R);

    const tuples = session.getDataset().getAllTuples();
    expect(tuples).toHaveLength(2); // the completed ordinary one, and the exploded one
    for (const t of tuples) expect(t.every((v) => v !== null)).toBe(true);
    // The completed sector before it keeps its own two pixels; the copy that had been
    // opened for the sector which never happened is gone with its tuple.
    expect(tuples[0]!.every((v) => v !== null)).toBe(true);
  });
  it('leaves NO pixel behind in no tuple at all', () => {
    // ⚑ THE DUPLICATE-MARKER DEFECT. Discarding the stranded chain dropped its tuple
    // and kept its pixel, on the stated reasoning that the pixel was "a real click"
    // belonging to the sector before. It is not: chaining COPIES the boundary (a pixel
    // serialises with one {tuple, group}, so it cannot be shared), and that sector
    // already holds its own copy. What stayed was a second marker sitting exactly on
    // the first, in no tuple, drawn on the figure and written to the project file for
    // good -- invisible in the table, which reads tuples, and permanent.
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0]); // one complete sector; the next is chained open
    session.setNextSectorExploded(true);
    session.addDataPoint(CX + 30, CY + 30); // the apex click is where the chain is cut

    const ds = session.getDataset();
    const referenced = new Set(ds.getAllTuples().flat().filter((v) => v !== null));
    const orphans = [...Array(ds.getCount()).keys()].filter((i) => !referenced.has(i));
    expect(orphans).toEqual([]);
    // And nothing that IS referenced was disturbed by the removal: the completed
    // sector still points at its own two pixels, at the angles they were clicked.
    expect(ds.getTuple(0)!.every((v) => v !== null)).toBe(true);
    expect(ds.getPixel(ds.getTuple(0)![1]!).x).toBeCloseTo(at(0)[0], 9);
  });
});

/**
 * What the SCREEN is told while an exploded slice is being captured.
 *
 * ⚑ These exist because the control failed the keystone test outright: the person who
 * asked for it went looking and could not find it, so it moved from an 11px chip in
 * the sidebar onto the figure itself (ui/src/ExplodedSliceControl.tsx). What the button
 * offers has to be true in every state it is shown in, and that is what is asserted
 * here -- the UI reads these two accessors and nothing else.
 */
describe('what the exploded control can say and do', () => {
  it('reports all three clicks, not just the first', () => {
    // ⚑ THE DEFECT THIS NAMES. `isAwaitingExplodedApex()` goes false the instant the
    // tip lands, so a screen reading only that flag would show "nothing armed" for
    // BOTH edge clicks -- exactly when the user needs telling that this slice is
    // measured about its own tip and that the chain is broken, so both its edges must
    // be clicked. Three distinct states, because three distinct things are being asked.
    const session = calibratedPie();
    expect(session.getExplodedStage()).toBe('off');

    session.setNextSectorExploded(true);
    expect(session.getExplodedStage()).toBe('apex');
    expect(session.getExplodedEdgesPlaced()).toBe(0);

    session.addDataPoint(CX + 30, CY + 30); // the tip
    expect(session.getExplodedStage()).toBe('edges');
    expect(session.getExplodedEdgesPlaced()).toBe(0);

    clickBoundaries(session, [0]);
    expect(session.getExplodedStage()).toBe('edges');
    expect(session.getExplodedEdgesPlaced()).toBe(1);

    clickBoundaries(session, [60]);
    // Complete: the slice is an ordinary recorded sector now, and the NEXT one goes
    // back to the pie's centre. Explosion is a per-slice exception, not a mode.
    expect(session.getExplodedStage()).toBe('off');
  });

  it('cancels before the tip is placed', () => {
    const session = calibratedPie();
    session.setNextSectorExploded(true);
    session.cancelExplodedSector();
    expect(session.getExplodedStage()).toBe('off');
    expect(session.getDataset().getTupleCount()).toBe(0);
  });

  it('cancels AFTER the tip, discarding the edges already clicked', () => {
    // ⚑ The state `setNextSectorExploded(false)` cannot reach: past the apex the
    // arming flag is already down and everything that matters lives in the pending
    // tuple. A cancel button that silently does nothing in two of the three states it
    // is offered in is worse than no button at all.
    const session = calibratedPie();
    session.setNextSectorExploded(true);
    session.addDataPoint(CX + 30, CY + 30);
    clickBoundaries(session, [0]);
    expect(session.getDataset().getTupleCount()).toBe(1);

    session.cancelExplodedSector();
    expect(session.getExplodedStage()).toBe('off');
    // The half-built sector goes, and its edge with it -- read about the shared centre
    // that click is several points wrong, so keeping it would turn a cancel into a
    // silently mis-measured row.
    expect(session.getDataset().getTupleCount()).toBe(0);
    expect(session.getDataset().getCount()).toBe(0);
  });

  it('leaves finished slices alone when a later one is cancelled', () => {
    // The guard that matters: cancel must reach only the slice in progress. It runs
    // against a dataset that already holds completed sectors AND the chained tuple
    // that arming discards, which is where an off-by-one would land.
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0, 60]); // two complete sectors
    const before = session.getDataset().getCount();
    session.setNextSectorExploded(true);
    session.addDataPoint(CX + 30, CY + 30);
    clickBoundaries(session, [120]);
    session.cancelExplodedSector();

    const ds = session.getDataset();
    expect(ds.getTupleCount()).toBe(2);
    for (const t of ds.getAllTuples()) expect(t.every((v) => v !== null)).toBe(true);
    // Arming discarded the chained tuple's copy of the shared boundary, so one pixel
    // fewer than before -- the completed sectors' own four are untouched.
    expect(ds.getCount()).toBe(before - 1);
    // ...and every surviving tuple still points at a real pixel.
    for (const t of ds.getAllTuples()) {
      for (const i of t) expect(i!).toBeLessThan(ds.getCount());
    }
  });

  it('is off for every type that is not a pie', () => {
    const box = new CalibrationSession(BOX_PLOT_AXES_CONFIG);
    expect(box.getExplodedStage()).toBe('off');
    expect(box.getExplodedEdgesPlaced()).toBe(0);
  });
});

/**
 * Closing the ring.
 *
 * David, driving the app: *"When I come to the end of the ring, I naturally want to
 * click the first point to close it."* He is right, and the alternative is worse than
 * inconvenient -- without it the last click opens a sector that will never exist, and
 * the capture ends on a permanently half-filled row.
 */
describe('the last sector closes on the first boundary', () => {
  it('completes it and stops chaining', () => {
    const session = calibratedPie();
    const ds = session.getDataset();
    clickBoundaries(session, [-90, 0, 90, 180]); // three sectors, the fourth open
    expect(ds.getTupleCount()).toBe(4);

    // Click the FIRST boundary again -- the far edge of the last sector.
    const first = ds.getPixel(ds.getTuple(0)![0]!);
    expect(session.addDataPoint(first.x, first.y)).toBe('point-added');

    // Four complete sectors and NOT a fifth: there is no next one to open.
    expect(ds.getTupleCount()).toBe(4);
    for (const t of ds.getAllTuples()) expect(t.every((v) => v !== null)).toBe(true);
    // The closing edge sits exactly where the opening one does...
    const closing = ds.getPixel(ds.getTuple(3)![1]!);
    expect(closing.x).toBeCloseTo(first.x, 9);
    expect(closing.y).toBeCloseTo(first.y, 9);
    // ...as its OWN pixel. A shared index cannot survive the project file, which is
    // the trap that once reopened every sector after the first missing its edge.
    expect(ds.getTuple(3)![1]).not.toBe(ds.getTuple(0)![0]);
  });

  it('makes the four sectors of a closed pie account for the whole figure', () => {
    // The reading, not just the bookkeeping: quarters clicked round the rim and closed
    // on the first boundary must total the figure's own total.
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0, 90, 180]);
    const ds = session.getDataset();
    const first = ds.getPixel(ds.getTuple(0)![0]!);
    session.addDataPoint(first.x, first.y);
    const total = session.getTupleRows().reduce((a, r) => a + (r.derived ?? 0), 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it('is NOT offered on the very first sector, where it would cut the capture short', () => {
    // ⚑ The trap in the obvious implementation. With one sector open, the user's
    // ordinary SECOND click is near no earlier boundary except its own opening one --
    // treat that as "closing" and a two-slice pie can never be captured at all.
    const session = calibratedPie();
    clickBoundaries(session, [-90]);
    const ds = session.getDataset();
    const first = ds.getPixel(ds.getTuple(0)![0]!);
    expect(session.ringClosingPixel(first.x, first.y)).toBeNull();
    clickBoundaries(session, [0]);
    expect(session.ringClosingPixel(first.x, first.y)).toBeNull();
  });

  it('is not offered away from the first boundary, nor on other types', () => {
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0, 90]);
    expect(session.ringClosingPixel(...at(200))).toBeNull();
    const box = new CalibrationSession(BOX_PLOT_AXES_CONFIG);
    expect(box.ringClosingPixel(0, 0)).toBeNull();
  });

  it('is not offered while an exploded slice is being captured', () => {
    // A pulled-out slice shares its edges with nobody -- there is a visible gap on
    // both sides -- so it can never be the sector that closes a ring.
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0, 90]);
    const first = session.getDataset().getPixel(session.getDataset().getTuple(0)![0]!);
    session.setNextSectorExploded(true);
    session.addDataPoint(CX + 20, CY + 20);
    expect(session.ringClosingPixel(first.x, first.y)).toBeNull();
  });
});

describe('a boundary click is tidied onto the rim', () => {
  it('lands on the ring without moving the reading', () => {
    const session = calibratedPie();
    const centre = session.getAxes()!.getCentre();
    // Clicked a little inside the rim, as a hand does.
    session.addDataPoint(...at(-90, R * 0.96));
    const p = session.getDataset().getPixel(0);
    expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(R, 6);
  });

  it("leaves a DONUT's inner ring exactly where it was clicked", () => {
    // ⚑ The reason the snap is banded. A click on an inner ring is a legitimate
    // reading -- angles are scale-invariant, which is precisely why ONE calibration
    // reads every ring of a donut -- and hauling it out to the rim would drag the
    // marker off the ink it measured and read as the app misunderstanding the figure.
    const session = calibratedPie();
    const inner = at(-90, R * 0.55);
    session.addDataPoint(...inner);
    const p = session.getDataset().getPixel(0);
    expect(p.x).toBeCloseTo(inner[0], 9);
    expect(p.y).toBeCloseTo(inner[1], 9);
  });
});
