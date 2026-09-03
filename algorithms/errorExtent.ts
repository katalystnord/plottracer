/**
 * B4 - error caps as EXTENTS ON THE DATUM'S OWN RECORD (v2.3).
 *
 * A datum and its caps are ONE tuple of pixels: `[value, upper, lower, left,
 * right]`. This module is the pure half - turning that stored tuple into the
 * `ErrorBarPoint` the rest of the app already consumes.
 *
 * ⚑⚑ WHAT THIS REPLACES, AND WHY IT IS A CORRECTNESS FIX RATHER THAN A TIDY-UP.
 * The cap→datum link used to be DERIVED on every read: `matchCapToDatum` handed
 * a cap to whichever datum was nearest along one axis. On David's own capture
 * all four caps sat at x ≈ 4.93, so `nearestIndex` gave every one of them to
 * datum 1 - the table showed point 1's caps beside the datum at x = 10 and a
 * collapsed zero-height pair beside point 1. He could not verify or correct his
 * own capture from the only feedback surface there is, which is a tenet-1
 * failure. **Storing the pairing does not improve the arbitration; it deletes
 * the arbitration.** A defect that cannot be expressed cannot come back.
 *
 * ⚑ IT IS THE BAR MODEL ONE DIMENSION OVER. The dimensional taxonomy calls a bar
 * **1.5D** - a category coordinate plus a value with EXTENT - and it is captured
 * as a tuple of two corner pixels (`OPPOSITE_CORNER_SLOTS`). A datum with error
 * bars is a 2-D coordinate plus an extent, so it is the same primitive with more
 * members. Nothing new is invented here: `_tuples` in `core/dataset.ts`, the
 * tuple table, and the tuple export shape all already exist and all already do
 * this job for four other types.
 *
 * ⚠️ THE DERIVED MATCH IS NOT DELETED, because it still has one real caller: an
 * IMPORTED file (WPD, or any of ours written before this) carries error caps as
 * separate series with no per-point pairing, and the only way to pair them is
 * geometrically. `matchCapToDatum` stays as the IMPORT-BOUNDARY rule it always
 * should have been - translating a foreign model into ours (tenet 6) - rather
 * than as the model itself.
 */
import { ERROR_ROLES, ROLE_FIELD, type ErrorBarPoint, type ErrorRole } from './errorBar.js';

/**
 * The tuple's members, in slot order: the datum first, then one slot per role.
 *
 * ⚑ DERIVED FROM `ERROR_ROLES`, NOT WRITTEN OUT BESIDE IT. A hand-maintained
 * list would be a second registry of the same taxonomy, free to omit a role
 * while every test still passed - which is exactly how v2.2 lost a whole axis
 * case. Adding a fifth role to `ERROR_ROLES` extends this automatically.
 *
 * ⚑ Slot names are Title Case because they become COLUMN HEADERS in the data
 * table and the export, alongside `OPPOSITE_CORNER_SLOTS` and `BOX_PLOT_SLOTS`.
 * ⚑ v2.5 renamed the former to `('Corner', 'Opposite corner')` - the capture
 * names the GESTURE now, not the record, and stays direction-neutral because a
 * bar can be negative. The mapping below is unaffected: it works off POSITION
 * in the slot list, not the words.
 */
export const ERROR_EXTENT_SLOTS: readonly string[] = [
  'Value',
  ...ERROR_ROLES.map((role) => role.charAt(0).toUpperCase() + role.slice(1)),
];

/**
 * ⚑⚑ THE ERROR SLOTS ARE ALWAYS THE LAST FOUR, AND THAT IS THE WHOLE MAPPING.
 *
 * Error bars are not an XY feature - `captureErrorCap`'s own header says the
 * gesture *"works on all 7 graph types, including error on a bar plot"*. A bar
 * series ALREADY has tuples (`['Corner', 'Opposite corner']` since v2.5, `['Bar
 * start', 'Bar end']` before it), so a fixed role→slot table of 1..4 would have
 * written an upper cap straight over the second slot and reported the bar's far
 * corner as its error. Appending instead means the offset is derivable from the
 * slot list itself:
 *
 *     XY   ['Value', 'Upper', 'Lower', 'Left', 'Right']           roles at 1..4
 *     Bar  ['Corner', 'Opposite corner', 'Upper', 'Lower', … ]   roles at 2..5
 *
 * ⚑ Derivable, so nothing new has to be stored or serialized - the alternative
 * was a per-dataset "where do my error slots begin" field, which is state that
 * can disagree with the thing it describes.
 */
/**
 * How many tuple members sit BEFORE the error tail - the type's own slots,
 * INCLUDING the synthetic 'Value' that stands in for an XY datum.
 *
 * ⚠️ NOT `ownSlotNames(...).length`, and the difference is a silent emptying.
 * `ownSlotNames` answers "which slots belong to the TYPE", so it drops the
 * synthetic member and returns `[]` for an XY series - correct for a table
 * asking what columns to draw, and fatal for a loop asking which members hold
 * datums, which then walked none of them and exported no rows at all.
 */
export function ownSlotCount(slotNames: readonly string[]): number {
  return errorSlotBase(slotNames);
}

function errorSlotBase(slotNames: readonly string[]): number {
  return slotNames.length - ERROR_ROLES.length * errorGroupCount(slotNames);
}

/**
 * ⚑⚑ HOW MANY ROLE GROUPS THE TAIL CARRIES - one per CAPTURED VALUE.
 *
 * David, 2026-09-03: *"Error bars work exactly the same, on each end."* A span
 * has two ends, so it has two groups; an XY point has one. Before this the tail
 * was a single group by construction, which is the tuple-level assumption that
 * put an upper cap on the low end and an upper cap on the high end into the
 * SAME slot - the second silently overwriting the first.
 *
 * ⚑ COUNTED FROM THE NAMES, like `hasErrorSlots`, and for the same reason: a
 * stored "how many groups" field is state that can disagree with the slot list
 * it describes, and it would have to survive the file, an import and every undo.
 *
 * ⚑ It stops before consuming the last slot. A tuple needs a member 0 to hang
 * its extents off - `errorBarsFromTuples` yields nothing for a tuple with no
 * datum - so a greedy count that ate every slot would leave a carrier-less
 * record that still looked well formed.
 */
export function errorGroupCount(slotNames: readonly string[]): number {
  let groups = 0;
  let end = slotNames.length;
  while (end - ERROR_ROLES.length >= 1) {
    const tail = slotNames.slice(end - ERROR_ROLES.length, end);
    const isGroup = tail.every((name, i) => {
      const words = name.trim().toLowerCase().split(/\s+/);
      return words[words.length - 1] === ERROR_ROLES[i];
    });
    if (!isGroup) break;
    groups += 1;
    end -= ERROR_ROLES.length;
  }
  return groups;
}

/**
 * Does this slot list END IN a full set of error slots?
 *
 * ⚑⚑ IT ASKS THE NAMES, NOT THE COUNT, AND A BOX PLOT IS WHY. Counting was the
 * obvious test - "more slots than a type needs means the extras are error
 * slots" - and it is wrong on the type that would have suffered most: a Box Plot
 * has FIVE slots, `['Min', 'Q1', 'Median', 'Q3', 'Max']`, so a count-based check
 * puts the error base at 1 and reads **Q1, Median, Q3 and Max as upper, lower,
 * left and right**. Every box in the figure would then export its quartiles as
 * error bars, silently, with plausible magnitudes.
 *
 * The names are a reliable inverse because they are not free text: slot names
 * come from the type's config, and the only user-supplied part is the error base
 * ("SD"), which `errorSlotNames` places as a PREFIX. So the last four slots
 * carry the role words as their final token exactly when error slots are
 * present.
 *
 * ⚑ Deliberately no persisted "where do my error slots start" field: that is
 * state which can disagree with the slot list it describes, and it would have to
 * survive the project file, an import, and every undo.
 */
export function hasErrorSlots(slotNames: readonly string[]): boolean {
  return errorGroupCount(slotNames) > 0;
}

/**
 * Which tuple slot a role's cap occupies, in a tuple of `slotCount` members.
 * Defaults to the plain XY shape so the common call reads unchanged.
 */
export function slotForRole(
  role: ErrorRole,
  slotNames: readonly string[] = ERROR_EXTENT_SLOTS,
  valueIndex: number = 0
): number {
  return errorSlotBase(slotNames) + valueIndex * ERROR_ROLES.length + ERROR_ROLES.indexOf(role);
}

/** The role a slot carries, or null when the slot is one of the type's OWN
 * members (a datum, a bar corner) rather than an extent. */
export function roleForSlot(
  slot: number,
  slotNames: readonly string[] = ERROR_EXTENT_SLOTS
): { role: ErrorRole; valueIndex: number } | null {
  const offset = slot - errorSlotBase(slotNames);
  if (offset < 0) return null;
  const role = ERROR_ROLES[offset % ERROR_ROLES.length];
  const valueIndex = Math.floor(offset / ERROR_ROLES.length);
  return role && valueIndex < errorGroupCount(slotNames) ? { role, valueIndex } : null;
}

/**
 * ⚑⚑ THE SLOTS THAT BELONG TO THE GRAPH TYPE, with the error tail removed.
 *
 * Adding error to a series gives it tuples. That is a fact about the SERIES; it
 * is not a change to what the series IS. An XY scatter with caps on its points
 * is still an XY scatter, and every panel, table and exporter that asks "what
 * shape is this?" must get the type's answer, not the storage's.
 *
 * ⚠️ THIS IS NOT A TIDYING FUNCTION - it is the fix for a silent data loss, and
 * the loss is worth stating because the record was correct the whole time. With
 * the shape question answered by `Dataset.hasSlots()`, an XY point at (5, 5)
 * carrying caps at 7 and 3 met the TUPLE exporter, which prints one column per
 * slot from `data[0]` - the x. It wrote `Value 5 · SD upper 5 · SD lower 5`: the
 * y coordinate and both readings gone, every number in the row plausible.
 *
 * ⚑ CLAUDE.md pattern 1 second time round - *"does this belong to the TYPE, or
 * to an AXIS?"* Here: to the TYPE, or to the SERIES. The heatmap collapsed a
 * dimension into a property of a cell; this is the mirror, a property of a
 * series inflating into a property of the type. Same cost: everything
 * downstream forks.
 *
 * ⚑ THE SYNTHETIC 'Value'. On a type with no slots of its own, `errorSlotNames`
 * invents one to stand for the datum, because a tuple needs a member 0. It is a
 * placeholder rather than a member - an XY point's columns are X and Y - so it
 * is stripped here and such a type reads back as having no slots at all.
 * Recognising it BY NAME is safe only while no real type declares a single slot
 * called 'Value', which is asserted as its own test rather than assumed: a
 * future 1-slot type by that name then fails loudly instead of quietly losing
 * its table.
 */
export function ownSlotNames(slotNames: readonly string[]): string[] {
  if (!hasErrorSlots(slotNames)) return [...slotNames];
  const own = slotNames.slice(0, errorSlotBase(slotNames));
  return own.length === 1 && own[0] === ERROR_EXTENT_SLOTS[0] ? [] : own;
}

/** The error tail's slot names - what the user called the error, once per role
 * ('SD upper', 'SD lower', …). Empty for a series carrying no error, so a
 * caller can concatenate it unconditionally. */
export function errorTailNames(slotNames: readonly string[]): string[] {
  return hasErrorSlots(slotNames) ? slotNames.slice(errorSlotBase(slotNames)) : [];
}

/**
 * The slot names a series takes on when error bars are added to it: its own
 * members, then one per role.
 *
 * ⚑ THE ROLE SLOTS CARRY THE USER'S OWN WORD, and that is where the meaning of
 * the error went. The original design refused an `errorKind` field on purpose -
 * *"the kind is not in the geometry, it is in the figure's caption, so we could
 * only ask the user to type it, and asking means offering a default, which is
 * LabPlot's ±30 all over again"* - and put the meaning in the NAME of the error
 * series the user wrote ("SD", "SEM", "CI95"). Folding caps into the datum's
 * record removes that series, so without this the meaning would have been lost
 * in the refactor: a column headed 'Upper' says nothing about what it measures.
 * The user still names the concept exactly once, still gets no default, and the
 * columns read 'SD upper' / 'SD lower' in the table and in the export.
 */
export function errorSlotNames(
  base: string,
  ownSlots: readonly string[] = ['Value'],
  /**
   * ⚑⚑ ONE LABEL PER NAMED VALUE THAT CAN CARRY ERROR - the rule David settled
   * on 2026-09-03: *"error works exactly the same, on each end."*
   *
   * The default is a single unlabelled group, which is every type's layout as it
   * has always been ('SD upper'). A SPAN passes its two ends, so an upper cap on
   * the low end and an upper cap on the high end stop colliding in one slot.
   *
   * ⚠️ NOT one group per OWN slot, which is the version I built first and the
   * tests caught: a histogram and a pie have two own slots (`Bin start`/`Bin
   * end`) and exactly ONE named value between them, so that gave both a second
   * group of columns nobody had measured, and renamed the first. The
   * multiplicity is the type's NAMED VALUES - `valueColumns.ts`' question,
   * asked one layer down.
   */
  groupLabels: readonly string[] = ['']
): string[] {
  const label = base.trim();
  const named = (group: string, role: ErrorRole): string =>
    [group.trim(), label, role].filter(Boolean).join(' ');
  return [
    ...ownSlots,
    ...groupLabels.flatMap((group) => ERROR_ROLES.map((role) => named(group, role))),
  ];
}

/**
 * Read the stored tuples into one `ErrorBarPoint` per captured datum.
 *
 * `pointAt` resolves a tuple member (a pixel index) to its DATA-space position,
 * or null when that member was never captured - which is why nothing here does
 * geometry: the pairing arrives already decided.
 *
 * ⚑ A MISSING MEMBER IS OMITTED, NEVER ZEROED. A tuple is legitimately
 * half-built between clicks, and a real figure may carry only an upper bound; a
 * `yLower: 0` would be a fabricated measurement sitting in the record wearing
 * the same clothes as a real one (tenet 9).
 *
 * ⚑ A tuple with no DATUM yields nothing at all. The card states the invariant -
 * *"an error bar hangs off a data point"* - and an extent with nothing to hang
 * off is a coordinate, not a measurement.
 */
export function errorBarsFromTuples(
  tuples: readonly (readonly (number | null)[])[],
  pointAt: (pixelIndex: number) => { x: number; y: number } | null,
  /** The tuple's slot NAMES, so the error groups can be found at its END and
   * counted. Defaults to the plain XY shape. A bar has two own slots and so two
   * groups; an XY point one. */
  slotNames: readonly string[] = ERROR_EXTENT_SLOTS
): ErrorBarPoint[] {
  const bars: ErrorBarPoint[] = [];
  const groups = errorGroupCount(slotNames);
  for (const [tupleIndex, tuple] of tuples.entries()) {
    // ⚑⚑ ONE GATE, NOT TWO (v2.3 re-audit, found by mutation). This used to test
    // the INDEX for null and then test the POINT it resolved to, and the second
    // test subsumed the first: a null index looks up `undefined`, which the
    // `!datum` check already rejects. So neither gate could be shown to matter -
    // Stryker replaced the first with `if (false)` and all 82 tests still
    // passed, because the second one caught the case anyway. That is the exact
    // mutual masking `exportAssembly`'s `geometries` note records: "a second
    // gate behind the first, so neither could be shown to matter".
    // ⚑⚑ ONE BAR PER CAPTURED END, not one per tuple (v2.5). A span has error on
    // each end, so each end is a carrier in its own right; an XY point and a bar
    // have one group and read exactly as before. ⚠️ It also repairs an
    // alignment that was already wrong: `getDatumPixelIndices` has yielded one
    // row per OWN SLOT since v2.3, so a bar series with error produced two rows
    // against one bar and every reading after the first sat on the wrong row.
    for (let valueIndex = 0; valueIndex < groups; valueIndex += 1) {
    const datumIndex = tuple[valueIndex];
    const datum = datumIndex == null ? null : pointAt(datumIndex);
    if (!datum) continue;

    // ⚑⚑ WHICH TUPLE THIS CAME FROM, recorded HERE because this is the loop that
    // decides to skip one (v2.3 re-audit, F41). The result is COMPACTED - a
    // tuple whose first slot is empty produces no bar - which is right for the
    // XY table, whose rows are `getDatumPixelIndices` and skip identically. It
    // is wrong for every TUPLE table, whose rows are the tuples themselves: zip
    // the compacted list against them and the first gap shifts every later
    // series' error onto the wrong row and blanks the last. That is exactly
    // F20's defect, still live on the other half of the app.
    // ⚑ Written by the skipping loop rather than re-derived by a second walk,
    // so the two cannot disagree about which tuples were dropped.
    // ⚑ THE END IS NAMED ONLY WHEN THERE IS MORE THAN ONE. The import-boundary
    // path resolves caps geometrically and has no ends to speak of, so stamping
    // `valueIndex: 0` on a one-value type would make the two primitives differ
    // in the record while agreeing on every reading - which is precisely what
    // `errorPrimitiveConvergence` exists to refuse.
    const bar: ErrorBarPoint = { x: datum.x, y: datum.y, tupleIndex, ...(groups > 1 ? { valueIndex } : {}) };
    for (const role of ERROR_ROLES) {
      // The same one gate, for the same reason as the datum above.
      const member = tuple[slotForRole(role, slotNames, valueIndex)];
      const cap = member == null ? null : pointAt(member);
      if (!cap) continue; // an empty slot, or one pointing at a pixel that is gone
      bar[ROLE_FIELD[role]] = role === 'upper' || role === 'lower' ? cap.y : cap.x;
    }
    bars.push(bar);
    }
  }
  return bars;
}

/** A datum's error as SIGNED OFFSETS from its own value - the `yerr` form. */
export interface ErrorDeltas {
  yUpper?: number;
  yLower?: number;
  xLeft?: number;
  xRight?: number;
}

/**
 * Turn one resolved `ErrorBarPoint` into the delta form.
 *
 * ⚑⚑ WHY BOTH FORMS EXIST, MEASURED 2026-08-17 (`docs/generator-input-formats.md`):
 * **Python wants deltas and R wants absolutes.** `errorbar(y=[10,20,30],
 * yerr=[1,2,3])` draws its first bar from 9 to 11, so `yerr` is an offset;
 * `geom_errorbar(aes(ymin, ymax))` takes the positions outright. Carrying both
 * means neither consumer has to do arithmetic on the record.
 *
 * ⚑ SIGNED BY ROLE, not by magnitude - `upper`/`right` positive, `lower`/`left`
 * negative - so the two columns of an asymmetric bar can be told apart at a
 * glance. (matplotlib itself refuses negative `yerr`, taking direction from
 * which ROW a magnitude sits in; our column is labelled, so the sign is free
 * information rather than a contradiction.)
 *
 * ⚠️⚠️ AN ABSENT SIDE IS OMITTED, NEVER ZERO, and this is the whole reason the
 * ABSOLUTES are the record and these are a projection. In the delta form "no
 * lower bound" and "a lower bound of size zero" are the same number - measured:
 * matplotlib CRASHES on `NaN` in `yerr` and silently accepts `0`, drawing a cap
 * sitting exactly on the value. A record shaped like this would make a
 * measurement we never took indistinguishable from one we did, and it would look
 * entirely plausible. So the projection stays lossy-by-omission rather than
 * lying, even though that leaves a matplotlib consumer a decision to make.
 */
export function deltasFromBar(bar: ErrorBarPoint): ErrorDeltas {
  const out: ErrorDeltas = {};
  if (bar.y !== undefined) {
    if (bar.yUpper !== undefined) out.yUpper = bar.yUpper - bar.y;
    if (bar.yLower !== undefined) out.yLower = bar.yLower - bar.y;
  }
  if (bar.xLeft !== undefined) out.xLeft = bar.xLeft - bar.x;
  if (bar.xRight !== undefined) out.xRight = bar.xRight - bar.x;
  return out;
}
