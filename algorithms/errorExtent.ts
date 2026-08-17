/**
 * B4 — error caps as EXTENTS ON THE DATUM'S OWN RECORD (v2.3).
 *
 * A datum and its caps are ONE tuple of pixels: `[value, upper, lower, left,
 * right]`. This module is the pure half — turning that stored tuple into the
 * `ErrorBarPoint` the rest of the app already consumes.
 *
 * ⚑⚑ WHAT THIS REPLACES, AND WHY IT IS A CORRECTNESS FIX RATHER THAN A TIDY-UP.
 * The cap→datum link used to be DERIVED on every read: `matchCapToDatum` handed
 * a cap to whichever datum was nearest along one axis. On David's own capture
 * all four caps sat at x ≈ 4.93, so `nearestIndex` gave every one of them to
 * datum 1 — the table showed point 1's caps beside the datum at x = 10 and a
 * collapsed zero-height pair beside point 1. He could not verify or correct his
 * own capture from the only feedback surface there is, which is a tenet-1
 * failure. **Storing the pairing does not improve the arbitration; it deletes
 * the arbitration.** A defect that cannot be expressed cannot come back.
 *
 * ⚑ IT IS THE BAR MODEL ONE DIMENSION OVER. The dimensional taxonomy calls a bar
 * **1.5D** — a category coordinate plus a value with EXTENT — and it is captured
 * as a tuple of two corner pixels (`BAR_INTERVAL_SLOTS`). A datum with error
 * bars is a 2-D coordinate plus an extent, so it is the same primitive with more
 * members. Nothing new is invented here: `_tuples` in `core/dataset.ts`, the
 * tuple table, and the tuple export shape all already exist and all already do
 * this job for four other types.
 *
 * ⚠️ THE DERIVED MATCH IS NOT DELETED, because it still has one real caller: an
 * IMPORTED file (WPD, or any of ours written before this) carries error caps as
 * separate series with no per-point pairing, and the only way to pair them is
 * geometrically. `matchCapToDatum` stays as the IMPORT-BOUNDARY rule it always
 * should have been — translating a foreign model into ours (tenet 6) — rather
 * than as the model itself.
 */
import { ERROR_ROLES, type ErrorBarPoint, type ErrorRole } from './errorBar.js';

/**
 * The tuple's members, in slot order: the datum first, then one slot per role.
 *
 * ⚑ DERIVED FROM `ERROR_ROLES`, NOT WRITTEN OUT BESIDE IT. A hand-maintained
 * list would be a second registry of the same taxonomy, free to omit a role
 * while every test still passed — which is exactly how v2.2 lost a whole axis
 * case. Adding a fifth role to `ERROR_ROLES` extends this automatically.
 *
 * ⚑ Slot names are Title Case because they become COLUMN HEADERS in the data
 * table and the export, alongside `BAR_INTERVAL_SLOTS` ('Bar start', 'Bar end')
 * and `BOX_PLOT_SLOTS`.
 */
export const ERROR_EXTENT_SLOTS: readonly string[] = [
  'Value',
  ...ERROR_ROLES.map((role) => role.charAt(0).toUpperCase() + role.slice(1)),
];

/**
 * ⚑⚑ THE ERROR SLOTS ARE ALWAYS THE LAST FOUR, AND THAT IS THE WHOLE MAPPING.
 *
 * Error bars are not an XY feature — `captureErrorCap`'s own header says the
 * gesture *"works on all 7 graph types, including error on a bar plot"*. A bar
 * series ALREADY has tuples (`['Bar start', 'Bar end']`), so a fixed role→slot
 * table of 1..4 would have written an upper cap straight over 'Bar end' and
 * reported the bar's far corner as its error. Appending instead means the
 * offset is derivable from the slot list itself:
 *
 *     XY   ['Value', 'Upper', 'Lower', 'Left', 'Right']           roles at 1..4
 *     Bar  ['Bar start', 'Bar end', 'Upper', 'Lower', … ]         roles at 2..5
 *
 * ⚑ Derivable, so nothing new has to be stored or serialized — the alternative
 * was a per-dataset "where do my error slots begin" field, which is state that
 * can disagree with the thing it describes.
 */
function errorSlotBase(slotCount: number): number {
  return slotCount - ERROR_ROLES.length;
}

/**
 * Does this slot list END IN a full set of error slots?
 *
 * ⚑⚑ IT ASKS THE NAMES, NOT THE COUNT, AND A BOX PLOT IS WHY. Counting was the
 * obvious test — "more slots than a type needs means the extras are error
 * slots" — and it is wrong on the type that would have suffered most: a Box Plot
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
  if (slotNames.length < ERROR_ROLES.length + 1) return false; // no room for a datum plus four
  const tail = slotNames.slice(errorSlotBase(slotNames.length));
  return tail.every((name, i) => {
    const words = name.trim().toLowerCase().split(/\s+/);
    return words[words.length - 1] === ERROR_ROLES[i];
  });
}

/**
 * Which tuple slot a role's cap occupies, in a tuple of `slotCount` members.
 * Defaults to the plain XY shape so the common call reads unchanged.
 */
export function slotForRole(role: ErrorRole, slotCount: number = ERROR_EXTENT_SLOTS.length): number {
  return errorSlotBase(slotCount) + ERROR_ROLES.indexOf(role);
}

/** The role a slot carries, or null when the slot is one of the type's OWN
 * members (a datum, a bar corner) rather than an extent. */
export function roleForSlot(slot: number, slotCount: number = ERROR_EXTENT_SLOTS.length): ErrorRole | null {
  const offset = slot - errorSlotBase(slotCount);
  return offset < 0 ? null : ERROR_ROLES[offset] ?? null;
}

/**
 * The slot names a series takes on when error bars are added to it: its own
 * members, then one per role.
 *
 * ⚑ THE ROLE SLOTS CARRY THE USER'S OWN WORD, and that is where the meaning of
 * the error went. The original design refused an `errorKind` field on purpose —
 * *"the kind is not in the geometry, it is in the figure's caption, so we could
 * only ask the user to type it, and asking means offering a default, which is
 * LabPlot's ±30 all over again"* — and put the meaning in the NAME of the error
 * series the user wrote ("SD", "SEM", "CI95"). Folding caps into the datum's
 * record removes that series, so without this the meaning would have been lost
 * in the refactor: a column headed 'Upper' says nothing about what it measures.
 * The user still names the concept exactly once, still gets no default, and the
 * columns read 'SD upper' / 'SD lower' in the table and in the export.
 */
export function errorSlotNames(base: string, ownSlots: readonly string[] = ['Value']): string[] {
  const label = base.trim();
  return [...ownSlots, ...ERROR_ROLES.map((role) => (label ? `${label} ${role}` : role))];
}

/** The `ErrorBarPoint` field each role writes. Mirrors `errorBar.ts`'s ROLE_FIELD;
 * kept here too because this module writes the same record from the other end. */
const ROLE_FIELD: Record<ErrorRole, 'yUpper' | 'yLower' | 'xLeft' | 'xRight'> = {
  upper: 'yUpper',
  lower: 'yLower',
  left: 'xLeft',
  right: 'xRight',
};

/**
 * Read the stored tuples into one `ErrorBarPoint` per captured datum.
 *
 * `pointAt` resolves a tuple member (a pixel index) to its DATA-space position,
 * or null when that member was never captured — which is why nothing here does
 * geometry: the pairing arrives already decided.
 *
 * ⚑ A MISSING MEMBER IS OMITTED, NEVER ZEROED. A tuple is legitimately
 * half-built between clicks, and a real figure may carry only an upper bound; a
 * `yLower: 0` would be a fabricated measurement sitting in the record wearing
 * the same clothes as a real one (tenet 9).
 *
 * ⚑ A tuple with no DATUM yields nothing at all. The card states the invariant —
 * *"an error bar hangs off a data point"* — and an extent with nothing to hang
 * off is a coordinate, not a measurement.
 */
export function errorBarsFromTuples(
  tuples: readonly (readonly (number | null)[])[],
  pointAt: (pixelIndex: number) => { x: number; y: number } | null,
  /** How many members a tuple has, so the error slots can be found at its END.
   * Defaults to the plain XY shape. On a bar series this is 6, not 5. */
  slotCount: number = ERROR_EXTENT_SLOTS.length
): ErrorBarPoint[] {
  const bars: ErrorBarPoint[] = [];
  for (const tuple of tuples) {
    const datumIndex = tuple[0];
    if (datumIndex === null || datumIndex === undefined) continue;
    const datum = pointAt(datumIndex);
    if (!datum) continue;

    const bar: ErrorBarPoint = { x: datum.x, y: datum.y };
    for (const role of ERROR_ROLES) {
      const member = tuple[slotForRole(role, slotCount)];
      if (member === null || member === undefined) continue;
      const cap = pointAt(member);
      if (!cap) continue; // a slot pointing at a pixel that is gone records nothing
      bar[ROLE_FIELD[role]] = role === 'upper' || role === 'lower' ? cap.y : cap.x;
    }
    bars.push(bar);
  }
  return bars;
}

/** A datum's error as SIGNED OFFSETS from its own value — the `yerr` form. */
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
 * ⚑ SIGNED BY ROLE, not by magnitude — `upper`/`right` positive, `lower`/`left`
 * negative — so the two columns of an asymmetric bar can be told apart at a
 * glance. (matplotlib itself refuses negative `yerr`, taking direction from
 * which ROW a magnitude sits in; our column is labelled, so the sign is free
 * information rather than a contradiction.)
 *
 * ⚠️⚠️ AN ABSENT SIDE IS OMITTED, NEVER ZERO, and this is the whole reason the
 * ABSOLUTES are the record and these are a projection. In the delta form "no
 * lower bound" and "a lower bound of size zero" are the same number — measured:
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
