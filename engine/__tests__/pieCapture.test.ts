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
    // Two clicks: one complete sector, and the next already opened on the shared edge.
    expect(ds.getCount()).toBe(2);
    expect(ds.getTupleCount()).toBe(2);
    expect(ds.getTuple(0)).toEqual([0, 1]);
    expect(ds.getTuple(1)![0]).toBe(1); // the SAME pixel index, not a copy
    expect(ds.getTuple(1)![1]).toBeNull();
  });

  it('records one pixel per boundary, however many slices there are', () => {
    // ⚑ The point of chaining: a boundary is one piece of ink and is measured once.
    // Clicking pairs would put two pixels on every shared line and let them disagree.
    const session = calibratedPie();
    clickBoundaries(session, [-90, 0, 90, 180]);
    expect(session.getDataset().getCount()).toBe(4); // not 8
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
