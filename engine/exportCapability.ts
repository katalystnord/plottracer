/**
 * What a data export CANNOT carry — said before the user picks a format.
 *
 * David, 2026-07-28: warn when the target format cannot hold something, rather
 * than dropping it silently. He first asked this about writing other tools'
 * project files; the decision was to point it at OUR OWN exports instead,
 * because that is where real, present-day silent loss lives and it costs no
 * unverifiable round trip.
 *
 * ⚑⚑ THE RULE THIS MODULE IS WRITTEN UNDER: **every claim here is verified
 * against the export code, and nothing is asserted that is not actually lost.**
 * Announcing a loss that does not happen is the same defect as hiding one that
 * does — it is the "prose outran the app" failure the v1.3 gate spent itself
 * deleting, pointed the other way. Specifically, and checked:
 *
 *  • point ROLES are carried (csvExport attaches `role` to the rows and JSON to
 *    the points), so this must NOT claim they are lost;
 *  • category names, measurements, curve fits and geometry all become their own
 *    sections and ARE carried by every format;
 *  • what genuinely never appears in ANY export — csv, tsv, latex, matlab,
 *    python, r, json, xlsx, ods alike — is the FIGURE, the CALIBRATION and any
 *    bundled source document. That is a real and total loss, and it is the one
 *    worth saying, because it is what makes an export not a project.
 *
 * ⚑ Spider charts turned out NOT to be a special case, though they prompted the
 * question. A spider exports through the same section path as everything else;
 * what its record holds and its export does not is the per-spoke SCALE — which
 * is the axis calibration, i.e. the general omission above rather than a
 * spider-specific one. Saying "spider loses something extra" would have been
 * inventing a defect.
 */

import type { TableFormat } from './tableFormats.js';

export type ExportTarget = 'json' | 'xlsx' | 'ods' | TableFormat;

/** What the project currently holds, as far as the export is concerned. */
export interface ExportContent {
  /** Titled blocks in the document: the record, plus measurements, curve fits
   * and geometry when present. More than one is what makes flattening matter. */
  sectionCount: number;
  /** Does any cell hold text rather than a number — a role column, a category
   * name, a series name? This is what changes MATLAB's output type. */
  hasTextCells: boolean;
  /** Is a source document (a PDF or TIFF the figure came from) bundled? */
  hasSourceDocument: boolean;
}

/** The formats that render to one flat stream of text, where several titled
 * blocks are separated by comment/title lines rather than by structure. */
const FLAT_TEXT: ReadonlySet<ExportTarget> = new Set<ExportTarget>([
  'csv', 'tsv', 'latex', 'matlab', 'python', 'r',
]);

/** The formats that give each section a place of its own. */
const SECTIONED: ReadonlySet<ExportTarget> = new Set<ExportTarget>(['xlsx', 'ods', 'json']);

/**
 * What NO data export carries, in any format.
 *
 * Verified by reading every writer: engine/csvExport.ts (including
 * buildSeriesJSON), engine/tableFormats.ts, engine/xlsxExport.ts and
 * engine/odsExport.ts emit values, names and derived blocks — and never the
 * image, the axes, or the source bytes.
 */
export function universalOmissions(content: ExportContent): string[] {
  const out = ['the figure image', 'the axis calibration'];
  if (content.hasSourceDocument) out.push('the source document it was taken from');
  return out;
}

/**
 * What THIS format additionally does to the data, given what the project holds.
 *
 * Returns an empty list when there is nothing true to say — silence is correct,
 * and padding it with generic caveats would train the user to ignore the line.
 */
export function formatLimitations(target: ExportTarget, content: ExportContent): string[] {
  const notes: string[] = [];

  // MATLAB switches its literal type when any cell is text: a numeric matrix
  // `[...]` becomes a cell array `{...}`. Documented in tableFormats.ts, and a
  // real surprise for anyone expecting a matrix to index into.
  if (target === 'matlab' && content.hasTextCells) {
    notes.push(
      'text columns (series names, categories, point roles) make this a cell array rather than a numeric matrix'
    );
  }

  // Several blocks in one stream: readable, but a reader has to split them.
  if (FLAT_TEXT.has(target) && content.sectionCount > 1) {
    // Deliberately NOT stating a count. The caller can only estimate how many
    // blocks the export will contain without re-running the whole assembly, and
    // a wrong number would be its own false claim.
    notes.push(
      'the data, measurements and any fitted curves are written to one file, separated by title lines rather than kept apart'
    );
  }

  return notes;
}

/**
 * The one line shown wherever the user chooses a format.
 *
 * Deliberately ends by naming what DOES keep everything, so the disclosure is
 * actionable rather than merely discouraging — a warning with no door out is
 * just noise.
 */
export function exportOmissionNote(content: ExportContent): string {
  const omitted = universalOmissions(content);
  const list =
    omitted.length > 1
      ? `${omitted.slice(0, -1).join(', ')} and ${omitted[omitted.length - 1]}`
      : omitted[0]!;
  return `These formats save the numbers, not the project — they do not carry ${list}. Save a project to keep those.`;
}

/** The per-format sentence, for a tooltip. Empty when the format does nothing
 * to this project worth mentioning. */
export function formatLimitationNote(target: ExportTarget, content: ExportContent): string {
  const notes = formatLimitations(target, content);
  if (notes.length === 0) return '';
  return `Note: ${notes.join('; ')}.`;
}

/** Does this format keep each block in a place of its own? Exposed so the UI
 * can say the positive thing too, rather than only the losses. */
export function keepsSectionsApart(target: ExportTarget): boolean {
  return SECTIONED.has(target);
}
