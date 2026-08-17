/**
 * B4 — a datum's error caps become EXTENTS ON ITS OWN RECORD.
 *
 * ⚑⚑ THESE TESTS ARE WRITTEN BEFORE THE MODULE THEY TEST, per CLAUDE.md gate 2:
 * *"the cases become named failing tests before the first line of
 * implementation"*, and named for the CASE rather than the function. v2.2's
 * lesson was that a design doc reads as satisfied while a red test does not.
 *
 * ⚑ THE DEFECT THIS RECORD MAKES INEXPRESSIBLE. Today a cap belongs to whichever
 * datum is NEAREST along one axis (`matchCapToDatum` → `nearestIndex`). On
 * David's own capture, all four caps sat at x ≈ 4.93, so every one of them was
 * handed to datum 1 — the table showed point 1's caps beside the datum at x=10,
 * and a collapsed zero-height pair beside point 1. He could not verify or correct
 * his own capture, which is a tenet-1 failure. Storing the pairing in the tuple
 * does not FIX the arbitration; it removes the arbitration.
 *
 * ⚑ The record is the bar model one dimension over ([[dimensional taxonomy]]): a
 * bar is a category coordinate plus a value with EXTENT, captured as a tuple of
 * two corner pixels. A datum with error bars is a 2-D coordinate plus an extent,
 * captured as a tuple of up to five pixels. Same primitive, same table, no new
 * concept — see BAR_INTERVAL_SLOTS / BOX_PLOT_SLOTS for the precedent.
 */
import { describe, it, expect } from 'vitest';
import { ERROR_ROLES, matchCapToDatum, type ErrorRole } from '../errorBar.js';
import {
  ERROR_EXTENT_SLOTS,
  slotForRole,
  roleForSlot,
  errorSlotNames,
  errorBarsFromTuples,
} from '../errorExtent.js';

/**
 * A datum-space lookup standing in for the dataset's pixels-through-axes. Index
 * -> point; a null models a slot that was never captured.
 */
function lookup(points: readonly ({ x: number; y: number } | null)[]) {
  return (pixelIndex: number) => points[pixelIndex] ?? null;
}

describe('the slot list is derived from the roles, so a role cannot be forgotten', () => {
  it('every declared ErrorRole has its own slot', () => {
    // ⚑ A SECOND REGISTRY IS THE THING TO AVOID. `ERROR_ROLES` already names the
    // taxonomy ("not four features; four roles in combination"), so a
    // hand-written slot list beside it could omit one and nothing would say so —
    // exactly the shape that hid the missing category axis for a whole release.
    for (const role of ERROR_ROLES) {
      const slot = slotForRole(role);
      expect(slot, `${role} has no slot`).toBeGreaterThan(0); // 0 is the datum
      expect(ERROR_EXTENT_SLOTS[slot], `${role}'s slot is unnamed`).toBeTruthy();
      expect(roleForSlot(slot), `${role}'s slot does not map back`).toBe(role);
    }
  });

  it('slot 0 is the DATUM and belongs to no role', () => {
    // The value itself is a member of the tuple, not an extent -- which is what
    // makes "clear the point" and "clear its caps" the same operation.
    expect(ERROR_EXTENT_SLOTS[0]).toBe('Value');
    expect(roleForSlot(0)).toBeNull();
  });

  it('the slots are exactly the datum plus one per role, with no spares', () => {
    expect(ERROR_EXTENT_SLOTS).toHaveLength(ERROR_ROLES.length + 1);
    expect(new Set(ERROR_EXTENT_SLOTS).size).toBe(ERROR_EXTENT_SLOTS.length);
  });
});

describe("a point's caps come from its OWN tuple, never from whichever cap is nearest", () => {
  it("two points whose caps share an x keep their own caps", () => {
    // ⚑⚑ DAVID'S CAPTURE, AS A TEST. Both points' caps sit at x = 4.93; under
    // nearest-along-x every cap resolves to point 1. Here the tuple says which
    // is which, so the arbitration never runs.
    const points = [
      { x: 4.96, y: 8.03 }, // 0: datum 1
      { x: 4.93, y: 9.56 }, // 1: its upper
      { x: 4.93, y: 6.49 }, // 2: its lower
      { x: 10.02, y: 18.0 }, // 3: datum 2
      { x: 4.93, y: 20.1 }, // 4: datum 2's upper -- MISPLACED in x, on purpose
      { x: 4.93, y: 15.9 }, // 5: datum 2's lower -- likewise
    ];
    const tuples = [
      [0, 1, 2, null, null],
      [3, 4, 5, null, null],
    ];
    const bars = errorBarsFromTuples(tuples, lookup(points));
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ x: 4.96, y: 8.03, yUpper: 9.56, yLower: 6.49 });
    // The one that used to be stolen: datum 2 keeps ITS caps even though they
    // are nearer point 1 in x than point 1's own are.
    expect(bars[1]).toMatchObject({ x: 10.02, y: 18.0, yUpper: 20.1, yLower: 15.9 });

    // ⚑⚑ AND HERE IS THE DEFECT THIS RECORD REMOVES, asserted against the REAL
    // old rule rather than described in a comment. Ask `matchCapToDatum` — the
    // function that used to decide this — where each of the four caps belongs:
    // it gives EVERY ONE of them to datum 0, because all four sit at x ≈ 4.93
    // and it matches on nearest-x. That is precisely the table David
    // photographed. If anyone ever reroutes the resolution back through it,
    // this expectation is what says so.
    const data = [points[0]!, points[3]!]; // the two datums, in record order
    const stolen = [1, 2, 4, 5].map((i) => matchCapToDatum(data, points[i]!, i < 3 ? 'upper' : 'lower'));
    expect(stolen, 'nearest-x hands every cap to datum 0').toEqual([0, 0, 0, 0]);
  });

  it('a cap sitting exactly on another datum still belongs to its own point', () => {
    const points = [
      { x: 1, y: 1 }, // 0: datum A
      { x: 2, y: 2 }, // 1: datum B -- and A's cap lands right on it
      { x: 2, y: 2 }, // 2: A's upper cap, same position as datum B
    ];
    const bars = errorBarsFromTuples([[0, 2, null, null, null], [1, null, null, null, null]], lookup(points));
    expect(bars[0]).toMatchObject({ x: 1, yUpper: 2 });
    expect(bars[1]!.yUpper).toBeUndefined(); // B has no cap of its own
  });
});

describe('a missing member means NOT CAPTURED, never zero', () => {
  it('a point with only an upper cap reports the upper and omits the lower', () => {
    // A real figure may carry only an upper bound; a tuple is also legitimately
    // half-built between clicks. Reporting 0 would be a fabricated measurement.
    const bars = errorBarsFromTuples(
      [[0, 1, null, null, null]],
      lookup([{ x: 3, y: 5 }, { x: 3, y: 7 }])
    );
    expect(bars[0]).toMatchObject({ x: 3, y: 5, yUpper: 7 });
    expect(bars[0]!.yLower).toBeUndefined();
    expect('yLower' in bars[0]!).toBe(false);
  });

  it('a tuple whose DATUM is missing reports no bar at all', () => {
    // An extent with nothing to hang off is not a measurement -- the card's own
    // words, "an error bar hangs off a data point".
    const bars = errorBarsFromTuples([[null, 1, 2, null, null]], lookup([null, { x: 3, y: 7 }, { x: 3, y: 3 }]));
    expect(bars).toHaveLength(0);
  });

  it('a tuple whose DATUM PIXEL no longer resolves reports no bar', () => {
    // ⚑ Distinct from the case above, where the datum SLOT is null. Here the
    // slot holds an index and the lookup cannot resolve it -- a point deleted
    // out from under a tuple. Found by hand-mutating the guard away and
    // watching every test still pass: the suite covered a missing CAP pixel and
    // not a missing DATUM one.
    const bars = errorBarsFromTuples([[99, 1, null, null, null]], lookup([{ x: 3, y: 5 }, { x: 3, y: 7 }]));
    expect(bars).toHaveLength(0);
  });

  it('a slot pointing at a pixel that no longer exists is dropped, not reported as 0', () => {
    const bars = errorBarsFromTuples([[0, 99, null, null, null]], lookup([{ x: 3, y: 5 }]));
    expect(bars[0]).toMatchObject({ x: 3, y: 5 });
    expect(bars[0]!.yUpper).toBeUndefined();
  });
});

describe('all four roles land in their own field', () => {
  it('a 2-D cross records upper, lower, left and right independently', () => {
    // The taxonomy is four roles in combination, so the record must carry all
    // four at once -- this is the v1.1 #17 case working by construction rather
    // than as a later feature.
    const points = [
      { x: 10, y: 20 }, // datum
      { x: 10, y: 24 }, // upper
      { x: 10, y: 16 }, // lower
      { x: 7, y: 20 }, // left
      { x: 13, y: 20 }, // right
    ];
    // Built by ASKING for each role's slot, so the test breaks if the slot order
    // ever changes. (It was first written as `[...].map((_, i) => i)`, which
    // discarded every slotForRole call and passed only because the answers
    // happened to be 1,2,3,4 in order -- a test that asserted its own fixture.)
    const tuple: (number | null)[] = [0, null, null, null, null];
    tuple[slotForRole('upper')] = 1;
    tuple[slotForRole('lower')] = 2;
    tuple[slotForRole('left')] = 3;
    tuple[slotForRole('right')] = 4;
    const bars = errorBarsFromTuples([tuple], lookup(points));
    expect(bars[0]).toMatchObject({ x: 10, y: 20, yUpper: 24, yLower: 16, xLeft: 7, xRight: 13 });
  });

  it('each role writes ONLY its own field', () => {
    const fieldOf: Record<ErrorRole, 'yUpper' | 'yLower' | 'xLeft' | 'xRight'> = {
      upper: 'yUpper',
      lower: 'yLower',
      left: 'xLeft',
      right: 'xRight',
    };
    for (const role of ERROR_ROLES) {
      const tuple: (number | null)[] = [0, null, null, null, null];
      tuple[slotForRole(role)] = 1;
      const [bar] = errorBarsFromTuples([tuple], lookup([{ x: 1, y: 1 }, { x: 2, y: 2 }]));
      const written = (['yUpper', 'yLower', 'xLeft', 'xRight'] as const).filter((f) => bar![f] !== undefined);
      expect(written, `${role} wrote ${written.join('+')}`).toEqual([fieldOf[role]]);
    }
  });
});

describe('error bars on a series that ALREADY has slots — a bar chart', () => {
  it("an upper cap does not overwrite the bar's far corner", () => {
    // ⚑⚑ THE COLLISION THAT MADE THE MAPPING DERIVED. `captureErrorCap` works on
    // all seven graph types, "including error on a bar plot" — and a bar series
    // already owns slots 0 and 1 ('Bar start', 'Bar end'). A fixed role table of
    // 1..4 would have written the upper cap over 'Bar end', so the record would
    // have reported the BAR'S OWN far corner as its error bar: a wrong number
    // that looks entirely plausible, on the type where the value IS an extent.
    const barSlots = ['Bar start', 'Bar end', 'SD upper', 'SD lower', 'SD left', 'SD right'];
    expect(slotForRole('upper', barSlots.length)).toBe(2); // NOT 1
    expect(roleForSlot(1, barSlots.length)).toBeNull(); // 'Bar end' is no one's extent
    expect(roleForSlot(0, barSlots.length)).toBeNull();

    const points = [
      { x: 1, y: 0 }, // 0: bar start
      { x: 1, y: 10 }, // 1: bar end -- the bar's own top
      { x: 1, y: 12 }, // 2: SD upper
      { x: 1, y: 8 }, // 3: SD lower
    ];
    const [bar] = errorBarsFromTuples([[0, 1, 2, 3, null, null]], lookup(points), barSlots.length);
    expect(bar).toMatchObject({ x: 1, y: 0, yUpper: 12, yLower: 8 });
    // The bar's own top (10) must not appear as an error reading anywhere.
    expect(bar!.yUpper).not.toBe(10);
  });

  it('the slot names keep the user\'s own word for what the error IS', () => {
    // The original design deliberately refused an `errorKind` field and put the
    // meaning in the series NAME the user writes. Folding caps into the datum
    // removes that series, so the word moves to the columns instead -- otherwise
    // the refactor would quietly discard whether a bar is SD, SEM or CI95.
    expect(errorSlotNames('SD')).toEqual(['Value', 'SD upper', 'SD lower', 'SD left', 'SD right']);
    expect(errorSlotNames('CI95', ['Bar start', 'Bar end'])).toEqual([
      'Bar start',
      'Bar end',
      'CI95 upper',
      'CI95 lower',
      'CI95 left',
      'CI95 right',
    ]);
    // No name offered when none was given -- never a default (LabPlot's ±30).
    expect(errorSlotNames('  ')).toEqual(['Value', 'upper', 'lower', 'left', 'right']);
  });
});

describe('an orphaned cap is inexpressible', () => {
  it('a point removed from the record takes its caps with it', () => {
    // ⚑ THE DEFECT THAT SURFACED THE WHOLE REWORK: the trashcan cleared a
    // series' points and left four caps floating with no datum under them,
    // while the card stated the invariant in words. With the caps IN the tuple,
    // clearing the tuple is clearing the caps -- there is no second store that
    // could survive.
    const points = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 5, y: 5 }, { x: 5, y: 6 }];
    const all = [
      [0, 1, null, null, null],
      [2, 3, null, null, null],
    ];
    expect(errorBarsFromTuples(all, lookup(points))).toHaveLength(2);
    // Remove the first point the only way the record allows -- drop its tuple.
    expect(errorBarsFromTuples(all.slice(1), lookup(points))).toHaveLength(1);
    // And nothing anywhere still reports the removed point's cap.
    const left = errorBarsFromTuples(all.slice(1), lookup(points));
    expect(left[0]).toMatchObject({ x: 5, yUpper: 6 });
  });

  it('an empty record reports nothing rather than throwing', () => {
    expect(errorBarsFromTuples([], lookup([]))).toEqual([]);
  });
});
