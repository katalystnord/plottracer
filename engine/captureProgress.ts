import type { Dataset } from '../core/dataset.js';

/**
 * The capture-progress sentence — "where you ARE" (which slot is next, how
 * many of the tuple's slots are filled, whether anything was left behind
 * incomplete). Pure string-building only; where this text actually APPEARS
 * on screen has moved twice now:
 *
 * ⚑ v1.6 (David: *"do we need it? … lets make it more meaningful"*) split it OUT
 * of the tips bar into its own sidebar line, because the old line read `Next point
 * fills: Axis 1 (new profile)` while the tips bar two inches below already read
 * *"Click where the shape crosses the Axis 1 axis — how far out along that ray you
 * click IS the number recorded (starting a new profile)."* -- a strict SUBSET,
 * hence noise. The split was: tips bar → what to DO, sidebar → where you ARE
 * (completeness, the one thing the figure itself cannot tell you -- a spider's
 * N×1D slots make a partial profile look exactly like a finished one unless you
 * scan the table for dashes).
 *
 * ⚑ v2.0 (2026-07-30) folded it back INTO the tips bar, a second time -- David hit
 * the identical "two surfaces, one job" feeling again, now on Pie, and settled it
 * harder: "Hint should be in the hint bar, not in other places." Workspace.tsx's
 * `guidanceTip` now appends this sentence (minus its own "Next: " prefix) as a
 * suffix, but ONLY where its own branch doesn't already name the slot -- so the
 * "(N of M filled)" count is visible whenever it would add information, and never
 * printed as a literal duplicate of the sentence right above it. See guidanceTip's
 * own `slotAimNote` comment for the exact rule.
 *
 * Lives here rather than in JSX so the strings are unit-testable: this is the same
 * "move the body into engine/, never the hook" method the last two refactors used.
 */

export interface CaptureProgressInput {
  /** Label of the slot the next click fills, e.g. "Axis 1", "Median", "Sector end". */
  slotLabel: string;
  /** Tuple the cursor sits in; null when the next click starts a fresh one. */
  tupleIndex: number | null;
  /** What one tuple is called for this type — "profile", "box", "bin", "sector". */
  tupleNoun: string;
  dataset: Pick<Dataset, 'getAllTuples' | 'getSlotNames'>;
}

export interface CaptureProgress {
  /** The finished sentence, or null when this type has no slots to report on. */
  text: string | null;
  filled: number;
  slots: number;
  /** Partly-filled tuples OTHER than the one being worked on. */
  incompleteElsewhere: number;
}

/**
 * Count tuples that were started and left unfinished, EXCLUDING the one in hand.
 *
 * ⚑ Two exclusions, both of which are the difference between a useful nudge and a
 * permanent false accusation:
 *
 * - **The current tuple.** It is incomplete because you are in the middle of it. On a
 *   pie this matters doubly: chaining pre-opens the next sector holding the shared
 *   boundary, so there is ALWAYS an open tuple, and counting it would make every pie
 *   read "1 sector incomplete" from the first click to the last.
 * - **Wholly empty tuples.** Those are unstarted, not abandoned. Nothing was left
 *   behind, so there is nothing to go back to.
 */
function countIncompleteElsewhere(tuples: (number | null)[][], current: number | null): number {
  return tuples.filter(
    (t, i) => i !== current && t.some((v) => v === null) && t.some((v) => v !== null)
  ).length;
}

/** Pluralise by count — "2 profiles incomplete" but "1 profile incomplete". */
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

export function describeCaptureProgress({
  slotLabel,
  tupleIndex,
  tupleNoun,
  dataset,
}: CaptureProgressInput): CaptureProgress {
  const slots = dataset.getSlotNames().length;
  if (slots === 0) return { text: null, filled: 0, slots: 0, incompleteElsewhere: 0 };

  const tuples = dataset.getAllTuples();
  const current = tupleIndex !== null ? tuples[tupleIndex] : undefined;
  const filled = current ? current.filter((v) => v !== null).length : 0;
  const incompleteElsewhere = countIncompleteElsewhere(tuples, tupleIndex);

  // ⚑ "new X" rather than a number, because the tuple does not exist yet. Numbering it
  // ahead of the click would name a row the table does not have.
  const where = tupleIndex === null ? `new ${tupleNoun}` : `${tupleNoun} ${tupleIndex + 1}`;
  let text = `Next: ${slotLabel} — ${where} (${filled} of ${slots} filled)`;
  // Only when true. A clause that is permanently present is furniture, not a signal.
  if (incompleteElsewhere > 0) text += ` · ${plural(incompleteElsewhere, tupleNoun)} incomplete`;

  return { text, filled, slots, incompleteElsewhere };
}
