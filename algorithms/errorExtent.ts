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

/** Which tuple slot a role's cap occupies. Slot 0 is the datum, so roles start at 1. */
export function slotForRole(role: ErrorRole): number {
  return ERROR_ROLES.indexOf(role) + 1;
}

/** The role a slot carries, or null for slot 0 — the datum, which is no one's extent. */
export function roleForSlot(slot: number): ErrorRole | null {
  return slot === 0 ? null : ERROR_ROLES[slot - 1] ?? null;
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
  pointAt: (pixelIndex: number) => { x: number; y: number } | null
): ErrorBarPoint[] {
  const bars: ErrorBarPoint[] = [];
  for (const tuple of tuples) {
    const datumIndex = tuple[0];
    if (datumIndex === null || datumIndex === undefined) continue;
    const datum = pointAt(datumIndex);
    if (!datum) continue;

    const bar: ErrorBarPoint = { x: datum.x, y: datum.y };
    for (const role of ERROR_ROLES) {
      const member = tuple[slotForRole(role)];
      if (member === null || member === undefined) continue;
      const cap = pointAt(member);
      if (!cap) continue; // a slot pointing at a pixel that is gone records nothing
      bar[ROLE_FIELD[role]] = role === 'upper' || role === 'lower' ? cap.y : cap.x;
    }
    bars.push(bar);
  }
  return bars;
}
