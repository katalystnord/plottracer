import { describe, expect, it } from 'vitest';
import { Calibration } from '../calibration.js';

/**
 * `Calibration` — the store every axes class reads its points out of.
 *
 * ⚑ WHY THIS FILE EXISTS. The 2026-07-31 full mutation run scored
 * `core/calibration.ts` at **50.77%**, one of the weakest files in the tree,
 * with 33 mutants NO TEST REACHES AT ALL. It had no test file of its own:
 * everything it does was exercised only incidentally, through whichever axes
 * class happened to call it, and the half of its API the axes classes never
 * touch (`changePointPx`, `setDataAt`, `findNearestPoint`, and the whole
 * selection group) was unreached by anything.
 *
 * That matters more than the percentage suggests. This class is where a
 * calibration point's PIXEL and its typed VALUE live; `changePointPx` is what
 * a handle drag calls, and `setDataAt` is what a spider's name-fan-out and
 * every value edit call. A silent off-by-one in either is a silently wrong
 * calibration, which is the failure mode tenet 1 exists to prevent.
 *
 * Cases are written against the SURVIVING MUTANTS the report named, so each
 * one has a specific wrong behaviour it rules out — the boundary tests below
 * exist because `index < 0` mutated to `<= 0`, and `index >= length` to
 * `> length`, both survived.
 */

/** Two points, values as (dx, dy) pairs — the 2-slot shape every axes but
 * spider uses. */
function twoPointCalibration(): Calibration {
  const cal = new Calibration(2);
  cal.addPoint(10, 20, '0', '100');
  cal.addPoint(30, 40, '1', '200');
  return cal;
}

describe('Calibration — the shape it was constructed with', () => {
  it('reports its own dimension count, which decides where each point s values live', () => {
    // getDimensions had NO test at all; its body could be emptied and nothing
    // noticed. It is the stride used to index `_dp`, so it is not cosmetic.
    expect(new Calibration(2).getDimensions()).toBe(2);
    expect(new Calibration(3).getDimensions()).toBe(3);
  });

  it('defaults to 2 value slots when constructed with no argument', () => {
    expect(new Calibration().getDimensions()).toBe(2);
  });

  it('keeps each point s values at its OWN stride offset, not a shared one', () => {
    const cal = twoPointCalibration();
    expect(cal.getCount()).toBe(2);
    expect(cal.getPoint(0)).toEqual({ px: 10, py: 20, dx: '0', dy: '100', dz: null });
    expect(cal.getPoint(1)).toEqual({ px: 30, py: 40, dx: '1', dy: '200', dz: null });
  });

  it('carries a THIRD value only when constructed for three, and reads back null when not', () => {
    // The 2-vs-3 branch is what makes a spider s axis NAME (dz) survive; at 2
    // it must read back null rather than leaking the next point s dx.
    const three = new Calibration(3);
    three.addPoint(1, 2, 'a', 'b', 'name');
    three.addPoint(3, 4, 'c', 'd', 'other');
    expect(three.getPoint(0)!.dz).toBe('name');
    expect(three.getPoint(1)!.dz).toBe('other');
    expect(three.getPoint(1)!.dx).toBe('c'); // not shifted by the extra slot
    expect(twoPointCalibration().getPoint(0)!.dz).toBeNull();
  });

  it('refuses an out-of-range index rather than returning a half-built point', () => {
    const cal = twoPointCalibration();
    expect(cal.getPoint(-1)).toBeNull();
    expect(cal.getPoint(2)).toBeNull();
    // ...and the two ENDS are in range, which is what rules out the mutated
    // `<= 0` / `> length` boundaries.
    expect(cal.getPoint(0)).not.toBeNull();
    expect(cal.getPoint(1)).not.toBeNull();
  });
});

describe('Calibration.changePointPx — what a handle drag calls', () => {
  it('moves the named point and leaves every other point and value untouched', () => {
    const cal = twoPointCalibration();
    cal.changePointPx(0, 111, 222);
    expect(cal.getPoint(0)).toEqual({ px: 111, py: 222, dx: '0', dy: '100', dz: null });
    expect(cal.getPoint(1)).toEqual({ px: 30, py: 40, dx: '1', dy: '200', dz: null });
  });

  it('moves the LAST point — the boundary the `>= length` guard must still admit', () => {
    const cal = twoPointCalibration();
    cal.changePointPx(1, 55, 66);
    expect(cal.getPoint(1)!.px).toBe(55);
    expect(cal.getPoint(1)!.py).toBe(66);
  });

  it('is a silent no-op out of range, never a write past the end', () => {
    const cal = twoPointCalibration();
    cal.changePointPx(-1, 999, 999);
    cal.changePointPx(2, 999, 999);
    expect(cal.getCount()).toBe(2); // no phantom third point appeared
    expect(cal.getPoint(0)!.px).toBe(10);
    expect(cal.getPoint(1)!.px).toBe(30);
  });
});

describe('Calibration.setDataAt — what a value edit calls', () => {
  it('replaces that point s values without moving its pixel', () => {
    const cal = twoPointCalibration();
    cal.setDataAt(0, '5', '500');
    expect(cal.getPoint(0)).toEqual({ px: 10, py: 20, dx: '5', dy: '500', dz: null });
    expect(cal.getPoint(1)!.dx).toBe('1'); // the neighbour is untouched
  });

  it('writes the LAST point s values — the boundary again', () => {
    const cal = twoPointCalibration();
    cal.setDataAt(1, '9', '900');
    expect(cal.getPoint(1)!.dx).toBe('9');
    expect(cal.getPoint(1)!.dy).toBe('900');
  });

  it('is a silent no-op out of range', () => {
    const cal = twoPointCalibration();
    cal.setDataAt(-1, 'x', 'y');
    cal.setDataAt(2, 'x', 'y');
    expect(cal.getPoint(0)!.dx).toBe('0');
    expect(cal.getPoint(1)!.dx).toBe('1');
  });

  it('writes the third slot ONLY for a 3-dimension calibration', () => {
    // ⚑ The `_dimensions === 3` branch mutated to always-true survived. At 2
    // slots a stray third write lands on the NEXT point s dx -- silently
    // corrupting a neighbour, which is exactly the shape of bug this asserts
    // against.
    const two = twoPointCalibration();
    two.setDataAt(0, 'A', 'B', 'SHOULD-NOT-APPEAR');
    expect(two.getPoint(0)!.dz).toBeNull();
    expect(two.getPoint(1)!.dx).toBe('1'); // neighbour intact

    const three = new Calibration(3);
    three.addPoint(1, 2, 'a', 'b', 'first');
    three.setDataAt(0, 'a2', 'b2', 'renamed');
    expect(three.getPoint(0)!.dz).toBe('renamed');
  });
});

describe('Calibration.findNearestPoint — the hit test behind handle picking', () => {
  it('returns the nearest point s index, measured as real 2-D distance', () => {
    // ⚑ Pins the DISTANCE ARITHMETIC: the squared-difference product mutated
    // to a division survived, because nothing asserted which of several points
    // won. Both coordinates differ here, so a wrong metric picks wrong.
    const cal = new Calibration(2);
    cal.addPoint(0, 0, '', '');
    cal.addPoint(40, 30, '', ''); // exactly 50 from the origin
    expect(cal.findNearestPoint(3, 4)).toBe(0); // 5 away from p0, 45 from p1
    expect(cal.findNearestPoint(38, 28)).toBe(1);
  });

  it('applies a DEFAULT threshold of 50 when none is given', () => {
    // ⚑ The `threshold == null` test mutated to `!= null` survived: with it,
    // an omitted threshold becomes `undefined` and every comparison is false,
    // so nothing is ever found. A no-threshold call that HITS rules that out.
    const cal = new Calibration(2);
    cal.addPoint(0, 0, '', '');
    expect(cal.findNearestPoint(30, 40)).toBe(0); // exactly 50 away -- inside
    expect(cal.findNearestPoint(0, 51)).toBe(-1); // just outside the default
  });

  it('honours an explicit threshold, including finding nothing', () => {
    const cal = new Calibration(2);
    cal.addPoint(0, 0, '', '');
    expect(cal.findNearestPoint(0, 10, 5)).toBe(-1);
    expect(cal.findNearestPoint(0, 10, 20)).toBe(0);
  });

  it('considers the LAST point, not every point but the last', () => {
    const cal = new Calibration(2);
    cal.addPoint(500, 500, '', '');
    cal.addPoint(1, 1, '', ''); // the only one in range, and it is last
    expect(cal.findNearestPoint(0, 0)).toBe(1);
  });

  it('returns -1 for an empty calibration rather than a bogus index 0', () => {
    expect(new Calibration(2).findNearestPoint(0, 0)).toBe(-1);
  });
});

describe('Calibration — the selection set', () => {
  it('selects a point, reports it selected, and lists it', () => {
    const cal = twoPointCalibration();
    expect(cal.isPointSelected(0)).toBe(false);
    cal.selectPoint(0);
    expect(cal.isPointSelected(0)).toBe(true);
    expect(cal.isPointSelected(1)).toBe(false);
    expect(cal.getSelectedPoints()).toEqual([0]);
  });

  it('selects INDEX 0 like any other — the boundary both `indexOf` guards mutate around', () => {
    // ⚑ `indexOf(index) < 0` mutated to `>= 0` and `<= 0`, and
    // `isPointSelected`'s `>= 0` to `> 0`, all survived. Index 0 is the value
    // that separates them: at `> 0`, selecting point 0 reads back as NOT
    // selected.
    const cal = twoPointCalibration();
    cal.selectPoint(0);
    expect(cal.isPointSelected(0)).toBe(true);
    expect(cal.getSelectedPoints()).toEqual([0]);
  });

  it('does not add the same point twice', () => {
    const cal = twoPointCalibration();
    cal.selectPoint(1);
    cal.selectPoint(1);
    expect(cal.getSelectedPoints()).toEqual([1]);
  });

  it('unselectAll empties the set, and it is genuinely empty afterwards', () => {
    // ⚑ The `[]` literal mutated to a non-empty array survived -- so assert
    // the LENGTH, not just that the call returns.
    const cal = twoPointCalibration();
    cal.selectPoint(0);
    cal.selectPoint(1);
    expect(cal.getSelectedPoints()).toHaveLength(2);
    cal.unselectAll();
    expect(cal.getSelectedPoints()).toEqual([]);
    expect(cal.isPointSelected(0)).toBe(false);
    expect(cal.isPointSelected(1)).toBe(false);
  });

  it('selectNearestPoint selects the point under the cursor, including index 0', () => {
    const cal = new Calibration(2);
    cal.addPoint(10, 10, '', '');
    cal.addPoint(400, 400, '', '');
    cal.selectNearestPoint(12, 12);
    expect(cal.getSelectedPoints()).toEqual([0]);
  });

  it('selectNearestPoint selects NOTHING when the click is out of range', () => {
    // ⚑ Rules out the mutated `minIndex >= 0` -> `< 0`, which would select on
    // a miss and skip on a hit.
    const cal = new Calibration(2);
    cal.addPoint(10, 10, '', '');
    cal.selectNearestPoint(900, 900);
    expect(cal.getSelectedPoints()).toEqual([]);
  });
});
