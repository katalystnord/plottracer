/**
 * The NAMES on a heatmap's axes (v2.2) — "the label is the coordinate".
 *
 * ⚑⚑ WHY A HEATMAP NEEDS THIS AND AN XY CHART DOES NOT. The settled record asks
 * one question per axis — is it a CATEGORY or a VALUE? — and all four
 * combinations are published: gene × sample, treatment × time, field × field.
 * On a value axis the coordinate is a number the calibration already produces.
 * On a CATEGORY axis the coordinate is the printed name, and until it is
 * recorded the export hands back `1, 2, 3` for what the figure calls `BRCA1,
 * TP53, EGFR` — numbers that are not wrong so much as not the answer. A
 * correlation matrix or a confusion matrix exported that way cannot be rejoined
 * to anything.
 *
 * ⚑ TYPING A NAME IS RECORDING, NOT INTERPRETING (tenet 9). The name is printed
 * on the figure; transcribing it is the same act as typing the value of a
 * calibration tick, which the whole tool already rests on. What would be
 * interpretation is INVENTING one — inferring "Sample 4" from a sequence, or
 * fabricating a name for an unlabelled band — and nothing here does that: an
 * unnamed cell keeps its numeric coordinates and exports an empty label.
 *
 * ⚑ ONE LIST PER AXIS, INDEXED BY CELL, and deliberately NOT `core/categoryAxis.ts`.
 * That class is the canonical name list a bar chart's DATASETS bind to through
 * `metadata.categoryIndex`, one per session; a heatmap has two independent
 * axes, no datasets and no tuples, so binding it here would mean one axis
 * silently renaming the other. The band model is shared; the storage is not.
 *
 * Pure: strings in, strings out. No image, no axes, no DOM.
 */

/**
 * Split what the user typed into one label per cell.
 *
 * ⚑ COMMAS SEPARATE, AND DOUBLE QUOTES PROTECT A COMMA INSIDE A NAME. Twelve
 * gene names in one field is the gesture that fits a sidebar — a box per row
 * would be a column of twelve inputs — and the CSV convention is the one
 * readers already know, which matters because a label like `Treatment A, 10 mg`
 * is ordinary in published figures and splitting it in half would be a silent
 * loss of exactly the thing being recorded.
 *
 * ⚑ POSITION IS MEANING: an empty field keeps its slot, so `A,,C` names the
 * first and third columns and leaves the second unnamed rather than shifting C
 * onto column 2. A wholly empty string is no labels at all.
 */
export function parseLabelList(text: string): string[] {
  if (text.trim() === '') return [];
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      // A doubled quote inside a quoted field is one literal quote, as CSV has
      // it — so a name that really contains `"` is still expressible.
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field.trim());
  return out;
}

/**
 * The labels back as one line the user can edit — the same text they typed,
 * rebuilt from the record rather than remembered alongside it.
 *
 * ⚑ Quoting is re-applied where it is NEEDED and nowhere else, so a plain list
 * reads as a plain list on the way back and does not accumulate punctuation
 * across a save and a reopen.
 */
export function formatLabelList(labels: readonly string[]): string {
  // ⚑ Trailing empties are dropped, because `reindexLabels` PADS a short list to
  // the grid's size and a reopened project would otherwise show the user
  // "BRCA1, TP53, , , " — punctuation they did not type, growing every time the
  // grid does. Empties BETWEEN names are kept: those are positions.
  const trimmed = [...labels];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return trimmed
    .map((l) => (l.includes(',') || l.includes('"') ? `"${l.replace(/"/g, '""')}"` : l))
    .join(', ');
}

/**
 * The label for one cell index, or `''` when that cell has none.
 *
 * ⚑ A SHORT LIST IS NOT AN ERROR. Someone naming the three columns they care
 * about on a twelve-column figure has recorded three true things, and refusing
 * that would push them into inventing nine more. The unnamed cells keep their
 * measured coordinates, which is what they had before anyone typed anything.
 */
export function labelAt(labels: readonly string[], index: number): string {
  // ⚑ No index guard, and mutation is what proved one unnecessary: an array
  // lookup at -1, 1.5 or NaN is a plain property miss, so `?? ''` already
  // answers every one of them. A guard that cannot change an answer reads as
  // protection and is only something else to keep true.
  return labels[index] ?? '';
}

/**
 * Line up a typed list with the CELLS it names, reversing it when the figure
 * reads the opposite way to the cell indices.
 *
 * ⚑⚑ THE DEFECT THIS EXISTS TO STOP, found in the v2.2 audit. Cell row 0 is
 * `yMin` — the BOTTOM of the plot — while a person copying names off a
 * published heatmap reads them TOP-DOWN, because that is how the figure prints
 * them. So the first name typed was landing on the last row: every value
 * correct, every name filed against the wrong one, and nothing on screen saying
 * so. It is the same failure `moveDivider` refuses to allow when it will not
 * re-sort dividers — values right, filed wrong is the silent kind of wrong.
 *
 * ⚑ PADDED FIRST, THEN REVERSED, and the order matters: three names on a
 * five-row figure belong to the top three rows, not to rows 0–2 counted from
 * the bottom. Reversing a short list without padding would slide them two rows
 * down the figure.
 *
 * ⚑ Its own inverse for a given `cellCount`, which is what lets the display
 * path reuse it instead of carrying a second copy of the rule.
 */
export function reindexLabels(
  labels: readonly string[],
  cellCount: number,
  reversed: boolean
): string[] {
  if (!Number.isInteger(cellCount) || cellCount < 0) return [...labels];
  const padded = Array.from({ length: Math.max(cellCount, labels.length) }, (_, i) => labels[i] ?? '');
  if (!reversed) return padded;
  // Only the cells' own slots take part in the flip; anything the user typed
  // BEYOND the grid has no cell to be reversed against, so it stays where it is
  // and `labelCoverage` reports it as surplus.
  const within = padded.slice(0, cellCount).reverse();
  return [...within, ...padded.slice(cellCount)];
}

/**
 * How many of an axis's cells are named — the sentence the card shows.
 *
 * ⚑ IT COUNTS RATHER THAN VALIDATES, and says so plainly, because both
 * mismatches are things a user does on the way to being finished: fewer labels
 * than cells while still typing, more than cells after removing a boundary. A
 * refusal would be wrong in both cases; a count is a measurement, and it makes
 * the extra-labels case visible instead of letting names silently address cells
 * that are not there.
 */
export function labelCoverage(labels: readonly string[], cellCount: number): string {
  const named = labels.slice(0, Math.max(0, cellCount)).filter((l) => l !== '').length;
  const extra = Math.max(0, labels.length - Math.max(0, cellCount));
  if (named === 0 && extra === 0) return '';
  const head = `${named} of ${cellCount} named`;
  return extra === 0 ? head : `${head}; ${extra} more label${extra === 1 ? '' : 's'} than cells`;
}
