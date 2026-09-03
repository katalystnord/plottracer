/**
 * B4 - a datum's error caps become EXTENTS ON ITS OWN RECORD.
 *
 * ⚑⚑ THESE TESTS ARE WRITTEN BEFORE THE MODULE THEY TEST, per CLAUDE.md gate 2:
 * *"the cases become named failing tests before the first line of
 * implementation"*, and named for the CASE rather than the function. v2.2's
 * lesson was that a design doc reads as satisfied while a red test does not.
 *
 * ⚑ THE DEFECT THIS RECORD MAKES INEXPRESSIBLE. Today a cap belongs to whichever
 * datum is NEAREST along one axis (`matchCapToDatum` → `nearestIndex`). On
 * David's own capture, all four caps sat at x ≈ 4.93, so every one of them was
 * handed to datum 1 - the table showed point 1's caps beside the datum at x=10,
 * and a collapsed zero-height pair beside point 1. He could not verify or correct
 * his own capture, which is a tenet-1 failure. Storing the pairing in the tuple
 * does not FIX the arbitration; it removes the arbitration.
 *
 * ⚑ The record is the bar model one dimension over ([[dimensional taxonomy]]): a
 * bar is a category coordinate plus a value with EXTENT, captured as a tuple of
 * two corner pixels. A datum with error bars is a 2-D coordinate plus an extent,
 * captured as a tuple of up to five pixels. Same primitive, same table, no new
 * concept - see OPPOSITE_CORNER_SLOTS / BOX_PLOT_SLOTS for the precedent.
 */
import { describe, it, expect } from 'vitest';
import { ERROR_ROLES, matchCapToDatum, resolveErrorBars, type ErrorRole } from '../errorBar.js';
import {
  ERROR_EXTENT_SLOTS,
  slotForRole,
  roleForSlot,
  errorSlotNames,
  hasErrorSlots,
  errorBarsFromTuples,
  deltasFromBar,
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
    // hand-written slot list beside it could omit one and nothing would say so -
    // exactly the shape that hid the missing category axis for a whole release.
    for (const role of ERROR_ROLES) {
      const slot = slotForRole(role);
      expect(slot, `${role} has no slot`).toBeGreaterThan(0); // 0 is the datum
      expect(ERROR_EXTENT_SLOTS[slot], `${role}'s slot is unnamed`).toBeTruthy();
      // ⚑ v2.5: the inverse names the END as well as the role, because error
      // attaches to a named VALUE - a span has two. A one-value type is end 0.
      expect(roleForSlot(slot), `${role}'s slot does not map back`).toEqual({ role, valueIndex: 0 });
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
    // old rule rather than described in a comment. Ask `matchCapToDatum` - the
    // function that used to decide this - where each of the four caps belongs:
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

describe('recognising error slots - and NOT mistaking a box plot for them', () => {
  it('a BOX PLOT is not read as carrying error slots', () => {
    // ⚑⚑ THE TRAP THAT MADE THIS CHECK ASK THE NAMES. Counting was the obvious
    // test -- "more slots than the type needs means the extras are error slots"
    // -- and a Box Plot has FIVE: ['Min','Q1','Median','Q3','Max']. Under a
    // count-based rule the error base lands at 1, so Q1, Median, Q3 and Max are
    // read as upper, lower, left and right, and every box in the figure exports
    // its QUARTILES as error bars. Silently, with plausible magnitudes, on a
    // type where those numbers look exactly like what an error bar would say.
    expect(hasErrorSlots(['Min', 'Q1', 'Median', 'Q3', 'Max'])).toBe(false);
  });

  it('the other slotted types are not mistaken either', () => {
    expect(hasErrorSlots(['Bar start', 'Bar end'])).toBe(false);
    expect(hasErrorSlots(['Bin start', 'Bin end'])).toBe(false);
    expect(hasErrorSlots(['Sector start', 'Sector end'])).toBe(false);
    expect(hasErrorSlots([])).toBe(false);
  });

  it('recognises error slots on a plain series and on an already-slotted one', () => {
    expect(hasErrorSlots(errorSlotNames('SD'))).toBe(true);
    expect(hasErrorSlots(errorSlotNames('SD', ['Bar start', 'Bar end']))).toBe(true);
    expect(hasErrorSlots(errorSlotNames(''))).toBe(true); // unnamed still recognisable
  });

  it('a PARTIAL tail is not enough - all four roles or none', () => {
    // Half a set would put the base in the wrong place and shift every role.
    expect(hasErrorSlots(['Value', 'SD upper', 'SD lower'])).toBe(false);
    expect(hasErrorSlots(['Value', 'SD upper', 'SD lower', 'SD left'])).toBe(false);
  });

  it('the roles must be in ORDER, not merely present', () => {
    expect(hasErrorSlots(['Value', 'SD lower', 'SD upper', 'SD left', 'SD right'])).toBe(false);
  });
});

describe('error bars on a series that ALREADY has slots - a bar chart', () => {
  it("an upper cap does not overwrite the bar's far corner", () => {
    // ⚑⚑ THE COLLISION THAT MADE THE MAPPING DERIVED. `captureErrorCap` works on
    // all seven graph types, "including error on a bar plot" - and a bar series
    // already owns slots 0 and 1 ('Bar start', 'Bar end'). A fixed role table of
    // 1..4 would have written the upper cap over 'Bar end', so the record would
    // have reported the BAR'S OWN far corner as its error bar: a wrong number
    // that looks entirely plausible, on the type where the value IS an extent.
    const barSlots = ['Bar start', 'Bar end', 'SD upper', 'SD lower', 'SD left', 'SD right'];
    expect(slotForRole('upper', barSlots)).toBe(2); // NOT 1
    expect(roleForSlot(1, barSlots)).toBeNull(); // 'Bar end' is no one's extent
    expect(roleForSlot(0, barSlots)).toBeNull();

    const points = [
      { x: 1, y: 0 }, // 0: bar start
      { x: 1, y: 10 }, // 1: bar end -- the bar's own top
      { x: 1, y: 12 }, // 2: SD upper
      { x: 1, y: 8 }, // 3: SD lower
    ];
    const [bar] = errorBarsFromTuples([[0, 1, 2, 3, null, null]], lookup(points), barSlots);
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

describe('a confidence band is the same record at higher density', () => {
  /**
   * ⚑⚑ DAVID, 2026-08-17: *"One day, we might have continuous error / uncertainty
   * lines for line graphs too. And that too needs to align with what we do here
   * now."* So this is the tenet-11 check on the record BEFORE the capture path
   * hardens around it - asked now, while changing the answer is still cheap.
   *
   * The error design already committed to the shape: *"a confidence band is the
   * same relation at higher density"*. These tests ask whether that is true of
   * the record we are building, and - more usefully - whether it was ever true
   * of the one we are replacing.
   */
  const BAND_POINTS = 200;

  function band() {
    // A dense traced curve, each sample carrying an upper and a lower reading.
    const points: { x: number; y: number }[] = [];
    const tuples: (number | null)[][] = [];
    for (let i = 0; i < BAND_POINTS; i++) {
      const x = i * 0.05; // 200 samples across a narrow x range, as a real band is
      const datum = points.push({ x, y: Math.sin(x) }) - 1;
      const upper = points.push({ x, y: Math.sin(x) + 0.2 }) - 1;
      const lower = points.push({ x, y: Math.sin(x) - 0.2 }) - 1;
      tuples.push([datum, upper, lower, null, null]);
    }
    return { points, tuples };
  }

  it('every sample of a 200-point band keeps its own upper and lower', () => {
    const { points, tuples } = band();
    const bars = errorBarsFromTuples(tuples, lookup(points));
    expect(bars).toHaveLength(BAND_POINTS);
    for (let i = 0; i < BAND_POINTS; i++) {
      expect(bars[i]!.yUpper).toBeCloseTo(bars[i]!.y! + 0.2, 10);
      expect(bars[i]!.yLower).toBeCloseTo(bars[i]!.y! - 0.2, 10);
    }
  });

  it('⚑ an independently-traced boundary SILENTLY LOSES readings under the old model', () => {
    // ⚠️ MY FIRST VERSION OF THIS TEST CLAIMED nearest-x would MIS-ASSIGN a
    // traced band, and measured 0 mismatches - a nudge below half the sample
    // spacing still finds the right datum. The real failure is not assignment,
    // it is COLLAPSE, and it only shows when the boundary carries its own
    // sampling (which a traced curve does).
    //
    // `resolveErrorBars` emits one bar per DATUM and lets the nearest cap claim
    // each field; every other cap for that datum is DROPPED - deliberately, since
    // averaging would fabricate a position no one clicked. So a boundary traced
    // at 500 samples over 200 data points reports 200 readings and discards 300,
    // with nothing saying so.
    const { points, tuples } = band();
    const datums = tuples.map((t) => points[t[0] as number]!);
    const traced: { x: number; y: number }[] = [];
    for (let i = 0; i < 500; i++) {
      const x = (i / 500) * (BAND_POINTS * 0.05);
      traced.push({ x, y: Math.sin(x) + 0.2 });
    }
    const resolved = resolveErrorBars(datums, [{ role: 'upper', caps: traced }]);
    const carried = resolved.filter((b) => b.yUpper !== undefined).length;
    expect(resolved).toHaveLength(BAND_POINTS);
    expect(carried).toBeLessThanOrEqual(BAND_POINTS);
    expect(traced.length - carried, '300 traced readings vanish').toBeGreaterThan(250);
  });

  it('⚑⚑ the tuple record has the SAME per-datum limit, but cannot lose a reading silently', () => {
    // The honest conclusion, and the one that matters for the future feature:
    // BOTH models are per-datum, so "a band is the same relation at higher
    // density" holds only when the band is sampled AT the data points. What
    // changes is the failure mode. Under the old model a surplus cap is accepted
    // and then quietly discarded at read time. In the tuple record there is
    // simply no slot to put it in - the reading cannot be entered at all, so the
    // limit is enforced at capture where the user can see it, instead of applied
    // silently at export.
    //
    // ⇒ An independently-traced uncertainty BOUNDARY is therefore a DIFFERENT
    // KIND OF RECORD, BUT A RELATED ONE - David's correction, 2026-08-17, and it
    // is load-bearing rather than a nicety. "A different record" licenses a
    // fresh apparatus built from scratch, which is the thing this whole theme is
    // an argument against. "Related" says what must stay SHARED:
    //
    //   · THE SAME QUANTITY, sampled differently. A per-datum extent is the
    //     DISCRETE case; a band is the CONTINUOUS case of the same uncertainty
    //     about the same value on the same axis. Not inheritance - sampling.
    //   · THE SAME FOUR ROLES. A band has an upper and a lower boundary; those
    //     are `ERROR_ROLES`, not new vocabulary.
    //   · THE SAME USER WORD. "SD" / "CI95" means the same thing on both, so it
    //     comes from the same place (`errorSlotNames`), with no default on either.
    //   · THEY MUST AGREE WHERE THEY OVERLAP. A band queried AT a datum's
    //     coordinate must report what that datum's extent reports. That is a
    //     testable invariant the day both exist, and it is the reason to write
    //     this down now rather than discover it later.
    //
    // What this record guarantees meanwhile is only that it will not PRETEND to
    // hold a boundary sampled at its own density.
    const { points, tuples } = band();
    expect(tuples.every((t) => t.length === ERROR_EXTENT_SLOTS.length)).toBe(true);
    const bars = errorBarsFromTuples(tuples, lookup(points));
    expect(bars).toHaveLength(BAND_POINTS);
    expect(bars.filter((b) => b.yUpper !== undefined)).toHaveLength(BAND_POINTS);
  });

  it('a band and a sparse error bar are the SAME record, not two features', () => {
    // "Only some points carry error needs no support at all" -- here that is a
    // tuple whose extent slots are null, sitting beside tuples that have them.
    const points = [
      { x: 0, y: 1 },
      { x: 0, y: 2 }, // an upper for point 0 only
      { x: 1, y: 3 }, // a bare datum, no error recorded
      { x: 2, y: 5 },
      { x: 2, y: 6 },
    ];
    const bars = errorBarsFromTuples(
      [
        [0, 1, null, null, null],
        [2, null, null, null, null],
        [3, 4, null, null, null],
      ],
      lookup(points)
    );
    expect(bars.map((b) => b.yUpper)).toEqual([2, undefined, 6]);
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


describe('the DELTA projection - what Python takes, from what R takes', () => {
  it('signs by ROLE: upper/right positive, lower/left negative', () => {
    // So the two columns of an asymmetric bar can be told apart at a glance.
    const d = deltasFromBar({ x: 5, y: 10, yUpper: 12, yLower: 7, xLeft: 4, xRight: 5.5 });
    expect(d).toEqual({ yUpper: 2, yLower: -3, xLeft: -1, xRight: 0.5 });
  });

  it('⚠️ an absent side is OMITTED, never zero', () => {
    // ⚑⚑ THE MEASURED REASON THE ABSOLUTES ARE THE RECORD. In the delta form
    // "no lower bound" and "a lower bound of size zero" are the same number.
    // matplotlib CRASHES on NaN in yerr and silently accepts 0 - drawing a cap
    // sitting exactly on the value. Emitting 0 here would turn a measurement we
    // never took into one that looks entirely plausible.
    const d = deltasFromBar({ x: 5, y: 10, yUpper: 12 });
    expect(d).toEqual({ yUpper: 2 });
    expect('yLower' in d, 'an absent lower must not appear at all').toBe(false);
  });

  it('a genuinely ZERO error is still reported, because it was measured', () => {
    // The mirror case, and the reason omission has to mean "absent" rather than
    // "small": a cap the user really did place on the value is a claim of
    // perfect certainty, and it must survive as one.
    const d = deltasFromBar({ x: 5, y: 10, yUpper: 10 });
    expect(d.yUpper).toBe(0);
    expect('yUpper' in d).toBe(true);
  });

  it('a datum with no y reports no y-deltas rather than NaN', () => {
    const d = deltasFromBar({ x: 5, yUpper: 12, yLower: 7 });
    expect(d.yUpper).toBeUndefined();
    expect(d.yLower).toBeUndefined();
  });

  it('round-trips: absolute = value + delta, for every role', () => {
    // The two forms must describe the same figure, or a consumer picking one
    // gets a different chart from a consumer picking the other.
    const bar = { x: 5, y: 10, yUpper: 12, yLower: 7, xLeft: 4, xRight: 5.5 };
    const d = deltasFromBar(bar);
    expect(bar.y + d.yUpper!).toBeCloseTo(bar.yUpper, 10);
    expect(bar.y + d.yLower!).toBeCloseTo(bar.yLower, 10);
    expect(bar.x + d.xLeft!).toBeCloseTo(bar.xLeft, 10);
    expect(bar.x + d.xRight!).toBeCloseTo(bar.xRight, 10);
  });
});
