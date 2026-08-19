import { theme } from '../theme.js';

/**
 * ONE MARK FOR ONE FACT, ON EVERY GRAPH TYPE (v2.3, A4).
 *
 * ⚑⚑ `[square brackets]` say exactly one thing, and it is true of every type:
 * *this number did not come off the pixels.* On a heatmap it is a person who
 * read a hatched cell the sampler averages away; on an XY or spider table it is
 * a value typed rather than read through the calibration from a clicked pixel.
 * Same tenet-9 distinction - WHICH NUMBERS WERE MEASURED OFF THE IMAGE AND
 * WHICH WERE SUPPLIED - which is what a downstream reader needs and what the
 * record exists to keep straight.
 *
 * ⚠️ NOT a declared-vs-measured flag, and it must not drift into one. A user's
 * own reading is a MEASUREMENT taken with a better instrument (their eye); we
 * are never the only instrument looking at the figure. The mark says whose
 * reading it is, never that the number is worth less.
 *
 * ⚑ THE CONVENTION IS BORROWED, not invented: scholarly editing, epigraphy and
 * archaeology all use `[x]` for EDITORIALLY SUPPLIED, which is precisely this.
 * ⚠️ NOT round brackets: `(59)` is accounting notation for NEGATIVE 59, and
 * pasting it into a spreadsheet silently becomes -59 - the exact class of error
 * this exists to prevent. The general rule worth keeping: prefer a mark that
 * fails VISIBLY over one that fails silently. `[59]` lands in a spreadsheet as
 * TEXT - left-aligned, formulas break, seen at once.
 * ⚑ And not italic or bold: formatting does not survive a copy-paste into plain
 * text or CSV, so the mark would evaporate exactly when the data leaves the app
 * and provenance starts to matter. The machine-readable half rides in the
 * export's own `<field> source` column.
 */
export function valueText(display: string, supplied: boolean): string {
  return supplied ? `[${display}]` : display;
}

/** The heatmap's own spelling of the same question - a cell records WHICH
 * instrument read it, and only a person's reading is bracketed. An OCR'd value
 * is read off the pixels, by a different machine, so it wears no brackets. */
export function suppliedBySource(source?: string): boolean {
  return source === 'user';
}

/**
 * What a marked value says when you hover it.
 *
 * ⚑⚑ A FACT, NOT A CONTROL, AND THE DIFFERENCE IS THE WHOLE POINT (v2.3). The
 * heatmap can offer *"discard this reading and take the number the colour key
 * gives"* because THE IMAGE CAN STILL ANSWER: the cell sits at fixed grid
 * coordinates, its ink never moved, and the sampler can be re-run over the same
 * pixels. A DATA POINT has no such instrument. The point IS a position - yours,
 * or the tracer's - and the figure was never asked to remember it, so once a
 * typed value moves the datum there is nothing left to re-read.
 *
 * ⚠️ SO THE WAY BACK IS UNDO, AND ONLY UNDO. Storing the pre-edit pixel was
 * proposed and rejected: it would not be a re-read, it would be a SECOND undo
 * mechanism beside the one every other action in this app already uses, bought
 * with a new field in the record. David: *"if you make a mistake and move on, we
 * have to remove a series and retrace it. Not a huge loss with autotrace"* - the
 * cost is real, named, and smaller than a parallel mechanism.
 *
 * ▶ The asymmetry with the heatmap is a property of the two RECORDS, not an
 * oversight: colour is a reading OF the figure; a point's position is a reading
 * the figure never held.
 */
export function valueTitle(base: string, supplied: boolean): string {
  return supplied ? `You entered this value - Ctrl+Z takes it back. ${base}` : base;
}

/**
 * The key to the mark, shown only when a marked value is on screen.
 *
 * ⚑⚑ A MARK WITH NO KEY IS TRIBAL KNOWLEDGE. The persona this project designs
 * against can only use what he sees: `[59]` beside `58.7` is a puzzle unless
 * the panel says what the brackets mean, and nothing else on screen does. It
 * appears with the first bracketed value and disappears with the last, so it
 * costs a panel that has none of them nothing at all.
 *
 * ⚑⚑ FOUR WORDS, David's call (2026-08-19), shown three candidate lengths at
 * the panel's real width: *"shortest possible"*, then the wording itself -
 * *"user edited value"*. The two clauses that came off were
 * a HOW ("move the point to re-read it") and a WHERE ("exports name the source
 * in their own column") - the first is discoverable by doing it, the second is
 * in MANUAL.md and belongs to a file the reader is not looking at yet. Only the
 * definition has to be here, because only the definition cannot be found any
 * other way. ▶ A legend earns one line by defining a mark, not by teaching the
 * feature behind it.
 */
export function SuppliedLegend({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    // ⚑ The DERIVED legend's own box, to the pixel: same padding, same colour,
    // same size, directly beneath it. Two lines that answer the same question -
    // *where did this number come from?* - must look like two of one thing, or
    // the reader has to work out that they are related.
    <div
      data-testid="supplied-legend"
      style={{ padding: '4px 2px 0', color: theme.color.text.legend, fontSize: 12 }}
    >
      <code>[ ]</code> = user edited value
    </div>
  );
}
