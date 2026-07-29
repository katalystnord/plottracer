import { describe, expect, it } from 'vitest';
import { CalibrationSession, PIE_AXES_CONFIG } from '../calibrationSession.js';
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
});
