import { theme } from '../theme.js';
import { fmtValue } from '../format.js';
import { TupleDeleteButton } from './TupleDeleteButton.js';
import { Fragment, type ReactNode } from 'react';
import type { DisplayRounder } from '../../../core/displayPrecision.js';

/**
 * What to say when a category holds more than one of a series' readings.
 *
 * Names the categories involved and what to do, because the fix is the user's:
 * either the declared count is wrong or a bar sits outside the marked axis, and
 * only they can see which.
 */
export function crowdedMessage(
  crowded: readonly { categoryIndex: number }[],
  categoryNames: readonly string[],
  tupleNoun: string
): string {
  const names = [...new Set(crowded.map((c) => categoryNames[c.categoryIndex] ?? `#${c.categoryIndex + 1}`))];
  const list = names.filter((n) => n !== '').join(', ');
  const where = list === '' ? '' : ` (${list})`;
  return `${crowded.length} more ${tupleNoun}${crowded.length === 1 ? '' : 's'} fall${crowded.length === 1 ? 's' : ''} in a category that already has one${where}, so ${crowded.length === 1 ? 'it is' : 'they are'} not shown above. Check the category count, or whether a ${tupleNoun} sits outside the marked axis.`;
}

/** One series' column of the bar table, index-aligned with the categories. */
export interface BarColumn {
  seriesIndex: number;
  seriesName: string;
  values: readonly (number | null)[];
  /** Each row's two measured ends, where that bar has no single value - see
   * `isInterval` below and `CalibrationSession.getBarCategoryTable`. */
  intervals: readonly ({ min: number; max: number } | null)[];
  tupleIndices: readonly (number | null)[];
}

export interface BarCategoryTable {
  columns: readonly BarColumn[];
  categoryNames: readonly string[];
  categoryRawNames: readonly string[];
  /**
   * Readings that could not be shown, because another one of the same series
   * already occupies that category.
   *
   * ⚑ THE TRACE THAT DID NOT EXIST. The session computes this precisely so that
   * "nothing is dropped without a trace", and the UI declared it out of its own
   * interface and never rendered it. Two bars landing in one band -- a stray bar
   * past the last divider, or a mis-declared count, both ordinary -- produced a
   * complete-LOOKING table with a real reading silently missing (v2.1 audit).
   */
  crowded?: readonly { seriesIndex: number; categoryIndex: number; tupleIndex: number }[];
}

/**
 * Is this figure carrying a few STRAY readings, or a whole second series?
 *
 * ⚑⚑ TWO SITUATIONS, ONE SYMPTOM, AND OPPOSITE REMEDIES. A legend swatch or a
 * bar past the last divider crowds ONE category, and the fix is to delete it. A
 * second colour traced into the same series crowds EVERY category, and deleting
 * anything would be wrong - the readings are all real, they simply belong in a
 * series of their own.
 *
 * ⚠️ WRITTEN AFTER THE FIRST VERSION SHIPPED A WALL. Every crowded reading drew
 * its own block with its own neighbours, which reads fine for one and is
 * unusable for five: the same four values repeat down the panel with nothing
 * saying what is actually wrong. David, tracing a second colour into series 1:
 * *"this is what I thought. It is completely broken."* The design was only ever
 * exercised with N=1, which is the fixture being blind to what it lacks.
 *
 * ▶ MEASURED, NOT GUESSED: how many DISTINCT categories are doubled, against how
 * many the figure has. Half or more is not a stray pattern, and saying so names
 * the likely cause without asserting it - the same shape as the swatch report,
 * which reports and does not act.
 */
export function crowdedIsSystematic(
  crowded: readonly { categoryIndex: number }[],
  categoryCount: number
): boolean {
  if (categoryCount === 0) return false;
  const doubled = new Set(crowded.map((c) => c.categoryIndex)).size;
  return doubled >= 2 && doubled * 2 >= categoryCount;
}

/**
 * What to say when the doubling is systematic.
 *
 * ⚑ IT OFFERS THE CAUSE AS A QUESTION, because the panel cannot know. Two
 * series in one slot is much the likeliest way every category gains a second
 * reading, and naming the remedy is what turns a report into something the user
 * can act on - but it is still their figure and their judgement.
 */
export function systematicCrowdedMessage(doubled: number, tupleNoun: string): string {
  return `${doubled} of the categories hold a second ${tupleNoun} that is not shown above. If you traced two colours into one series, add a series and trace the second colour into that instead - the extra readings are real, they just belong in a series of their own.`;
}

export interface ConflictRow {
  key: string;
  /** The category this row is about, named or numbered. */
  label: string;
  reading: string;
  /** A CANDIDATE is one of the two bars competing for this cell and is
   * clickable; CONTEXT is a neighbour, shown as evidence and inert. */
  kind: 'context' | 'candidate';
  tupleIndex: number | null;
  note: string;
}

/**
 * The rows shown beneath the table for ONE crowded reading.
 *
 * ⚑⚑ EXTRACTED SO THE RULE CAN BE NAMED IN A TEST, following `crowdedMessage`
 * directly above - the same reason, and the same precedent. What has to be right
 * here is WHICH rows appear and which of them a click may act on, and neither is
 * reachable from a component body.
 *
 * ⚑⚑ BOTH CANDIDATES, NEVER ONE. The reading sitting in the table above is
 * not the trustworthy one by virtue of being there: which reading wins a cell is
 * decided by CAPTURE ORDER, and on an auto-trace that is position along the
 * category axis - so a legend swatch drawn to the LEFT of the bar it collides
 * with takes the cell and the real bar is the hidden one. David: *"that row might
 * be the one that we want to remove."*
 *
 * ⚑ THE NEIGHBOURS ARE EVIDENCE, NOT CHOICES, so they are inert and drawn
 * back. David: *"show the row just above and below, so the user can see which one
 * might actually be correct, based on the neighbours."* A reading that fits the
 * trend either side is the plausible one, and that judgement is the user's.
 *
 * ⚠️ THE HIDDEN ROW HAS NO NUMBER, and says so rather than showing a blank. It
 * lost the cell, so its value is not among `col.values` at all - the table knows
 * THAT it exists and WHICH bar it is, which is what makes it selectable, and
 * nothing more. A blank there would read as "this bar measured nothing".
 */
export function conflictRows(
  crowded: { seriesIndex: number; categoryIndex: number; tupleIndex: number },
  table: BarCategoryTable,
  display: DisplayRounder
): ConflictRow[] {
  const col = table.columns.find((c) => c.seriesIndex === crowded.seriesIndex);
  if (!col) return [];
  const held = col.tupleIndices[crowded.categoryIndex] ?? null;
  const nameOf = (i: number) => {
    const n = table.categoryNames[i];
    return n === undefined ? '' : n === '' ? `Category ${i + 1}` : n;
  };
  const readingOf = (i: number): string => {
    const iv = col.intervals[i] ?? null;
    if (iv) return `${display.atData([iv.min], 0)} to ${display.atData([iv.max], 0)}`;
    const v = col.values[i];
    return v == null ? '-' : String(display.atData([v], 0));
  };
  const at = crowded.categoryIndex;
  const out: ConflictRow[] = [];
  if (at - 1 >= 0) {
    out.push({ key: 'above', label: nameOf(at - 1), reading: readingOf(at - 1), kind: 'context', tupleIndex: null, note: '' });
  }
  if (held !== null) {
    out.push({ key: 'held', label: nameOf(at), reading: readingOf(at), kind: 'candidate', tupleIndex: held, note: 'in the table above' });
  }
  out.push({ key: 'hidden', label: nameOf(at), reading: 'not read', kind: 'candidate', tupleIndex: crowded.tupleIndex, note: 'not shown above' });
  if (at + 1 < table.categoryNames.length) {
    out.push({ key: 'below', label: nameOf(at + 1), reading: readingOf(at + 1), kind: 'context', tupleIndex: null, note: '' });
  }
  return out;
}

/**
 * One crowded reading, shown WITH the row it collides with and their neighbours.
 *
 * ⚑⚑ TWO CANDIDATES FOR ONE CELL, and the panel must not decide which is
 * right. First-wins is capture order, not correctness, so the reading sitting in
 * the table above is not the trustworthy one by virtue of being there. Both are
 * offered; the neighbours are drawn faint because they are evidence, not choices.
 */
function ConflictBlock({
  crowded,
  table,
  display,
  onSelectTuples,
  onRemoveTuple,
  tupleNoun,
  activeTupleIndex,
}: {
  crowded: { seriesIndex: number; categoryIndex: number; tupleIndex: number };
  table: BarCategoryTable;
  display: DisplayRounder;
  onSelectTuples: (tupleIndices: readonly number[]) => void;
  onRemoveTuple: (tupleIndex: number) => void;
  tupleNoun: string;
  activeTupleIndex: number | null;
}) {
  const col = table.columns.find((c) => c.seriesIndex === crowded.seriesIndex);
  if (!col) return null;
  const held = col.tupleIndices[crowded.categoryIndex] ?? null;
  const pair = held === null ? [crowded.tupleIndex] : [held, crowded.tupleIndex];

  const rows = conflictRows(crowded, table, display);

  // ⚑⚑ EITHER ONE SELECTED TINTS BOTH, because they are a PAIR - two
  // candidates for one cell, and the question on screen is which of them belongs
  // there. Tinting only the row that was clicked shows a selection; tinting both
  // shows the conflict. David: *"perhaps change the background of both rows?"*
  const pairSelected = activeTupleIndex !== null && pair.includes(activeTupleIndex);

  const row = (
    key: string,
    label: string,
    reading: string,
    kind: 'context' | 'candidate',
    tupleIndex: number | null,
    note: string
  ) => {
    const selected = kind === 'candidate' && pairSelected;
    return (
      <tr
        key={key}
        data-testid={`conflict-row-${key}`}
        onClick={kind === 'candidate' ? () => onSelectTuples(pair) : undefined}
        title={kind === 'candidate' ? 'Click to select both bars on the figure' : undefined}
        style={{
          cursor: kind === 'candidate' ? 'pointer' : 'default',
          // ⚑⚑ THE SAME ROW TINT THE TABLE ABOVE USES, so "selected" looks
          // like "selected" everywhere. David: *"perhaps change the background of
          // both rows?"* - and because a click selects the PAIR, both take it at
          // once without a second highlight style being invented.
          background: selected ? theme.color.background.selectedRow : undefined,
          color: kind === 'context' ? theme.color.text.legend : undefined,
          opacity: kind === 'context' ? 0.55 : 1,
        }}
      >
        <td style={{ paddingRight: 10, textAlign: 'right' }}>{label}</td>
        <td style={{ paddingRight: 16 }}>{reading}</td>
        <td style={{ color: theme.color.text.legend, fontSize: 11.5, paddingRight: 8 }}>{note}</td>
        {/* ⚑⚑ THE ENDING. Selecting a candidate and stopping there is a flow
            with no way out: David, driving it, *"when one is selected, what
            happens then? Nothing, and I have no way of moving forward."* The
            resolution is to keep one and delete the other, so the gesture that
            does it belongs HERE, on the row - the same `TupleDeleteButton` every
            row of the table above carries, not a new control.
            ⚑ And deleting the one holding the cell needs no follow-up: the
            hidden reading takes it by itself, straight out of first-wins
            recomputation. Measured, not assumed. */}
        <td>
          {kind === 'candidate' && tupleIndex !== null && (
            <TupleDeleteButton tupleIndex={tupleIndex} noun={tupleNoun} onDelete={onRemoveTuple} />
          )}
        </td>
      </tr>
    );
  };

  return (
    <table
      data-testid={`bar-conflict-${crowded.seriesIndex}-${crowded.tupleIndex}`}
      style={{ borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 10 }}
    >
      <tbody>
        {rows.map((r) => row(r.key, r.label, r.reading, r.kind, r.tupleIndex, r.note))}
      </tbody>
    </table>
  );
}

export interface BarTableProps {
  table: BarCategoryTable;
  /** How a number is rounded before it is printed - the figure's own resolution,
   * so this table and the file it exports to report the same reading. */
  display: DisplayRounder;
  activeSeriesIndex: number;
  tupleNoun: string;
  onSelectSeries: (seriesIndex: number) => void;
  /**
   * Select this bar, and ring it on the figure (F30).
   *
   * ⚑ A cell of the ACTIVE series that already holds a bar had NO click
   * behaviour at all - the only clicks that did anything switched series or
   * aimed at a missing corner - so a bar table of twenty categories could not
   * answer "which bar on the figure is this row?". Every other panel's rule
   * applies here unchanged: one click selects (A3).
   */
  onSelectTuple: (tupleIndex: number) => void;
  /**
   * Select SEVERAL bars at once - the two candidates for one crowded cell.
   *
   * ⚑⚑ `selectTuple`'S OWN BRANCH, WIDENED, not a second mechanism. Select
   * mode's highlight is `selectedPointIndices`, which has held any number of
   * points since v1.2 (marquee, Shift-click, whole-series pick). David: *"find a
   * mechanism so that both can be highlighted at the same time."* It was there.
   */
  onSelectTuples: (tupleIndices: readonly number[]) => void;
  /** Which tuple the current selection is standing on, or null. */
  activeTupleIndex: number | null;
  /** Which slot of this tuple is still empty, or -1 when it is complete. */
  missingSlotIndexOf: (tupleIndex: number) => number;
  /** Aim the next capture at that slot. */
  onAimSlot: (tupleIndex: number, slotIndex: number) => void;
  onRemoveTuple: (tupleIndex: number) => void;
  renderCategoryName: (categoryIndex: number, rawName: string) => ReactNode;
  /**
   * That series' error columns, from `errorColumnsByTuple` - the SAME accessor
   * the export asks (v2.3 re-audit, F44).
   *
   * ⚑⚑ A BAR CHART IS THE TYPE THAT MOST OFTEN CARRIES ERROR BARS, and this
   * table was the one that would not show them. The capture works, the drag is
   * constrained to the value axis exactly as on an XY chart, the whiskers are
   * drawn by the same code, and all nine export formats carry the columns - and
   * the panel that is meant to BE what the file says showed the value alone. A
   * user could not read back a cap they had just measured.
   *
   * ⚑ PER SERIES, because this table is a MATRIX: rows are categories, columns
   * are series, and each series has its own error base name and its own measured
   * roles. One series may carry SD and its neighbour nothing at all.
   *
   * ⚑ Row-aligned by TUPLE, which is what `col.tupleIndices` already carries -
   * so the same index answers "which bar is this cell" and "which cap is its".
   */
  errorForSeries: (seriesIndex: number) => ErrorColumns | undefined;
  noPointsHint: string;
}

/** One series' measured error roles, and their readings per tuple. */
export interface ErrorColumns {
  labels: readonly string[];
  values: readonly (readonly (number | null)[])[];
}

/**
 * The Bar table (v2.0): `# | Category | Series 1 | Series 2 | …` - one row per
 * CATEGORY, one column per series, mirroring Spider's own table (David: *"we
 * need to store them, series by series, as columns. Like this"*).
 *
 * It replaced a per-series switching table that hid every other series' bars
 * the moment you switched the active one.
 */
export function BarTable({
  table,
  display,
  activeSeriesIndex,
  tupleNoun,
  onSelectSeries,
  onSelectTuple,
  onSelectTuples,
  activeTupleIndex,
  missingSlotIndexOf,
  onAimSlot,
  onRemoveTuple,
  renderCategoryName,
  errorForSeries,
  noPointsHint,
}: BarTableProps) {
  // ⚑ Asked ONCE per render, not once per cell: the accessor walks the series'
  // tuples, and a table of twenty categories would otherwise walk them twenty
  // times over.
  const errors = table.columns.map((col) => {
    const e = errorForSeries(col.seriesIndex);
    return e && e.labels.length > 0 ? e : null;
  });
  // ⚑ The second header row exists only when some series actually carries error,
  // so an ordinary bar chart's table is exactly what it was.
  const anyError = errors.some((e) => e !== null);
  /**
   * ⚑⚑ WHICH SERIES REPORT AN INTERVAL RATHER THAN A VALUE (v2.3).
   *
   * A bar whose near end does not sit on the baseline is not worth one number,
   * so its column becomes `Min` and `Max` under a spanning series heading.
   * David: *"add another row below #, Category, Series N, that says Min, Max in
   * two separate columns."*
   * ⚑ NOT A NEW CONVENTION: the heatmap matrix header is already two lines
   * (`C1` over `0.00 - 2.00`), so a spanning name over a pair is something the
   * reader has met - and it grows the way this table already grows, a block per
   * series.
   * ⚑ PER SERIES, and only where bars actually float. David refused showing
   * `Min` on ordinary bars too: a column of zeros *"will look like a fault to
   * the users"*, and adaptive columns are already the house rule here.
   */
  const isInterval = table.columns.map((col) => col.intervals.some((iv) => iv !== null));
  const anyInterval = isInterval.some(Boolean);
  const headRowSpan = anyError || anyInterval ? 2 : 1;
  return (
    <>
    <table data-testid="points-table" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          <th rowSpan={headRowSpan} style={{ textAlign: 'right', paddingRight: 10, color: theme.color.text.legend }}>#</th>
          <th rowSpan={headRowSpan} style={{ textAlign: 'left', paddingRight: 16 }}>Category</th>
          {table.columns.map((col, i) => (
            <th
              key={col.seriesIndex}
              data-testid={`bar-col-${col.seriesIndex}`}
              // ⚑ The series name spans its OWN columns - the value and every
              // error role beside it - the same fix the spreadsheet's header
              // needed when a series grew a Δ column and the name stayed one
              // cell wide, skewing every column to its right.
              colSpan={(isInterval[i] ? 2 : 1) + (errors[i]?.labels.length ?? 0)}
              style={{
                textAlign: 'right',
                paddingRight: 16,
                borderLeft: `1px solid ${theme.color.border.regular}`,
                paddingLeft: 10,
                fontWeight: 600,
                color: col.seriesIndex === activeSeriesIndex ? theme.color.primary.main : theme.color.text.primary,
              }}
            >
              {col.seriesName}
            </th>
          ))}
        </tr>
        {(anyError || anyInterval) && (
          <tr>
            {table.columns.map((col, i) => (
              <Fragment key={col.seriesIndex}>
                {(isInterval[i] ? ['Min', 'Max'] : ['Value']).map((label, sub) => (
                  <th
                    key={label}
                    style={{
                      textAlign: 'right',
                      paddingRight: 16,
                      paddingLeft: 10,
                      // ⚑ The rule that separates SERIES stays on the first of a
                      // series' own columns, so `Min` and `Max` read as one block
                      // rather than as two neighbouring series.
                      ...(sub === 0
                        ? { borderLeft: `1px solid ${theme.color.border.regular}` }
                        : {}),
                      color: theme.color.text.legend,
                      fontWeight: 400,
                    }}
                  >
                    {label}
                  </th>
                ))}
                {errors[i]?.labels.map((label) => (
                  <th
                    key={label}
                    style={{ textAlign: 'right', paddingRight: 16, color: theme.color.text.legend, fontWeight: 400 }}
                  >
                    {label}
                  </th>
                ))}
              </Fragment>
            ))}
          </tr>
        )}
      </thead>
      <tbody>
        {table.categoryNames.map((categoryName, categoryIndex) => (
          <tr key={categoryIndex}>
            <td style={{ textAlign: 'right', paddingRight: 10, color: theme.color.text.legend }}>{categoryIndex + 1}</td>
            <td style={{ paddingRight: 16 }}>
              {renderCategoryName(categoryIndex, table.categoryRawNames[categoryIndex] ?? '')}
            </td>
            {table.columns.map((col, colIndex) => {
              const value = col.values[categoryIndex];
              const tupleIndex = col.tupleIndices[categoryIndex];
              const err = errors[colIndex];
              const isActive = col.seriesIndex === activeSeriesIndex;
              // v2.0 pre-launch audit: a half-dragged bar (one corner
              // clicked, not dragged) has a tupleIndex but no computed
              // value yet -- computeSlotCursorFor only ever defaults
              // to the FIRST such half-filled tuple, so a second one
              // was unreachable until the first was completed, unlike
              // Spider's table which can aim at any of its own empty
              // slots directly. Same fix, scoped to the case it's
              // actually safe for (see setSlotCursor's own comment on
              // why Box Plot stays excluded).
              const interval = col.intervals[categoryIndex] ?? null;
              // ⚑ A cell is EMPTY when it has neither - not when it has no
              // `value`, which a floating bar legitimately does not.
              const empty = value == null && interval == null;
              const aimTupleIndex = isActive && empty && tupleIndex != null ? tupleIndex : null;
              const missingGroupIndex =
                aimTupleIndex != null ? missingSlotIndexOf(aimTupleIndex) : -1;
              const aimable = aimTupleIndex != null && missingGroupIndex > -1;
              return (
                <Fragment key={col.seriesIndex}>
                {(isInterval[colIndex]
                  ? [
                      { key: 'min', shown: interval ? interval.min : null, sub: 0 },
                      { key: 'max', shown: interval ? interval.max : null, sub: 1 },
                    ]
                  : [{ key: 'value', shown: value, sub: 0 }]
                ).map(({ key: cellKey, shown, sub }) => (
                <td
                  key={cellKey}
                  data-testid={
                    sub === 0
                      ? `bar-cell-${col.seriesIndex}-${categoryIndex}`
                      : `bar-cell-${col.seriesIndex}-${categoryIndex}-max`
                  }
                  // Clicking a cell of an INACTIVE series switches to it --
                  // the same reachability rule Spider's own cells follow,
                  // since deleting a bar (below) is offered on the active
                  // series only. An ACTIVE cell with a half-filled bar aims
                  // the next capture at its missing corner.
                  onClick={() => {
                    // ⚑⚑ SWITCH **AND** SELECT, in one click. This used to
                    // switch series and stop, so clicking a cell of a non-active
                    // series appeared to do nothing to the figure and you had to
                    // click it twice - with nothing on screen saying so. Spider's
                    // identical matrix has always done both, and the spreadsheet
                    // learned it as A2 (*"switch first, then select"*); this was
                    // the third copy of the mechanism, still holding the defect.
                    // (v2.3 audit fleet, G6.)
                    if (!isActive) onSelectSeries(col.seriesIndex);
                    if (aimable && aimTupleIndex != null) {
                      onAimSlot(aimTupleIndex, missingGroupIndex);
                      return;
                    }
                    // A cell that HOLDS a bar selects it - the click every other
                    // output panel already answers this way (F30).
                    if (tupleIndex != null) onSelectTuple(tupleIndex);
                  }}
                  title={
                    aimable
                      ? `Click to fill this bar's missing corner next`
                      : empty
                      ? `${col.seriesName} has no ${categoryName} bar`
                      : isActive
                      ? 'Click to select this bar on the figure'
                      : undefined
                  }
                  style={{
                    textAlign: 'right',
                    paddingRight: 16,
                    paddingLeft: 10,
                    // ⚑ The series rule sits on the FIRST of a series' columns,
                    // so `Min` and `Max` read as one block.
                    ...(sub === 0
                      ? { borderLeft: `1px solid ${theme.color.border.regular}` }
                      : {}),
                    cursor: isActive && !aimable && tupleIndex == null ? 'default' : 'pointer',
                    // The SAME highlight the other output panels give a selected
                    // row - a token rather than a fourth copy of one colour.
                    ...(isActive && tupleIndex != null && tupleIndex === activeTupleIndex
                      ? { background: theme.color.background.selectedRow }
                      : {}),
                  }}
                >
                  {shown == null ? (
                    <span style={{ color: theme.color.text.legend }}>-</span>
                  ) : (
                    <>
                      {/* `tuple-derived-N`, not just this cell's own bar-cell-S-C
                          testid: the ACTIVE series' Nth tuple (capture order),
                          same identifier the generic hasSlots table (Pie/Box
                          Plot) has always used for its one-series-at-a-time
                          Value column -- kept so e2e's shared derivedValue()
                          helper reads either table the same way. Active-series
                          only, since that's the one whose tupleIndex this is.
                          ⚑ On an interval series it names the FIRST of the pair,
                          because a floating bar has no single derived value for
                          that helper to be reading. */}
                      <span
                        data-testid={
                          sub === 0 && isActive && tupleIndex != null
                            ? `tuple-derived-${tupleIndex}`
                            : undefined
                        }
                      >
                        {/* ⚑ At the figure's own resolution, by the same route this
                            table's own export section takes (`makeRounder`, the
                            data route) - so the panel and the file agree. The bar
                            family is linear, which is why the data route is sound
                            here; see core/displayPrecision.ts. */}
                        {fmtValue(display.atData([shown], 0))}
                      </span>
                      {/* ⚑ ONE delete button per BAR, on the last of its cells -
                          a bar is one datum however many columns report it. */}
                      {isActive && tupleIndex != null && sub === (isInterval[colIndex] ? 1 : 0) && (
                        <TupleDeleteButton tupleIndex={tupleIndex} noun={tupleNoun} onDelete={onRemoveTuple} />
                      )}
                    </>
                  )}
                </td>
                ))}
                {/* Blank, never 0, where that side was never captured - the rule
                    the export follows in the same columns. */}
                {err?.labels.map((label, c) => {
                  const v = tupleIndex == null ? null : err.values[tupleIndex]?.[c] ?? null;
                  return (
                    <td
                      key={label}
                      data-testid={`bar-error-${col.seriesIndex}-${categoryIndex}-${c}`}
                      style={{
                        textAlign: 'right',
                        paddingRight: 16,
                        color: theme.color.text.secondary,
                        ...(isActive && tupleIndex != null && tupleIndex === activeTupleIndex
                          ? { background: theme.color.background.selectedRow }
                          : {}),
                      }}
                    >
                      {v == null ? '' : fmtValue(v)}
                    </td>
                  );
                })}
                </Fragment>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
    {/* ⚑⚑ NO READINGS YET, NOT "NO ROWS" (v2.3). This asked whether the table had
        any CATEGORY rows - which was the same question while a bar chart could be
        calibrated without its category axis. Since the axis is part of the walk,
        a freshly calibrated figure ALREADY has one row per declared category, so
        the hint that tells a first-time user how to capture anything at all
        became unreachable on every bar-family type. The rows are not the
        readings: what the hint is about is whether anything has been MEASURED.
        ⚑ Caught by the e2e (`the empty-table hint recommends BOTH Add points and
        Auto-extract`), which timed out waiting for a hint that no longer
        rendered - the failure mode of a control that quietly stops existing. */}
    {/* ⚠️ AND IT ASKS ABOUT TUPLES, NOT DERIVED VALUES. The first version of this
        fix asked whether every `values` entry was null - which is TRUE for a
        chart of FLOATING bars, because a floating bar has no single value at
        all: its record is `Min` and `Max`. So a figure with bars captured and
        their two ends on screen said "No points yet" directly above them. David
        hit it within the hour. `tupleIndices` is what the table already carries
        to know which row is which bar, and it answers the question actually
        being asked: has anything been captured? */}
    {table.columns.every((c) => c.tupleIndices.every((t) => t === null)) && (
      <div data-testid="no-points" style={{ padding: 8, color: theme.color.text.legend, fontSize: 12.5 }}>
        {noPointsHint}
      </div>
    )}
    {(table.crowded?.length ?? 0) > 0 && (
      <div data-testid="bar-crowded" style={{ padding: 8, fontSize: 12.5 }}>
        <div style={{ color: theme.color.error, marginBottom: 8 }}>
          {crowdedIsSystematic(table.crowded!, table.categoryNames.length)
            ? systematicCrowdedMessage(
                new Set(table.crowded!.map((c) => c.categoryIndex)).size,
                tupleNoun
              )
            : crowdedMessage(table.crowded!, table.categoryNames, tupleNoun)}
        </div>
        {/* ⚑⚑ THE READING ITSELF, NOT JUST A SENTENCE ABOUT IT. The message
            already carried the `tupleIndex` of the bar it is describing, and the
            renderer printed prose and threw it away - so the panel said a
            reading was missing and gave you nothing to press, while every other
            row in the table above selects its bar on click. Finding it meant
            hunting two dots on the figure by eye.

            ⚑⚑ AND THE ROW IT COLLIDES WITH IS SHOWN BESIDE IT, because the
            one in the table above may be the wrong one. Which reading wins a
            cell is decided by CAPTURE ORDER, and on an auto-trace that is
            position along the axis - so a legend swatch to the left of the bar
            it collides with wins, and the real bar is the hidden one. David:
            *"that row might be the one that we want to remove."*

            ⚑ WITH ITS NEIGHBOURS, in faint grey, so the choice can be made on
            evidence: a reading that fits the trend of the categories either side
            is the plausible one. David: *"show the row just above and below, so
            the user can see which one might actually be correct, based on the
            neighbours."* They are context, not candidates, so they do not
            respond to a click and are drawn back. */}
        {/* ⚑⚑ NO BLOCKS WHEN THE DOUBLING IS SYSTEMATIC. One conflict wants
            its neighbours beside it so the user can judge which reading belongs;
            five of them repeat the same four values down the panel and say
            nothing. And the remedy is different in that case - the extra
            readings are all real and belong in their own series, so offering to
            delete them one at a time would be offering the wrong thing five
            times. */}
        {!crowdedIsSystematic(table.crowded!, table.categoryNames.length) &&
          table.crowded!.map((c) => (
          <ConflictBlock
            key={`${c.seriesIndex}-${c.tupleIndex}`}
            crowded={c}
            table={table}
            display={display}
            onSelectTuples={onSelectTuples}
            onRemoveTuple={onRemoveTuple}
            tupleNoun={tupleNoun}
            activeTupleIndex={activeTupleIndex}
          />
        ))}
      </div>
    )}
    </>  );
}
