import { theme } from '../theme.js';
import { fmtValue } from '../format.js';
import { TupleDeleteButton } from './TupleDeleteButton.js';
import { Fragment, type ReactNode } from 'react';

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

export interface BarTableProps {
  table: BarCategoryTable;
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
  activeSeriesIndex,
  tupleNoun,
  onSelectSeries,
  onSelectTuple,
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
  const headRowSpan = anyError ? 2 : 1;
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
              colSpan={1 + (errors[i]?.labels.length ?? 0)}
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
        {anyError && (
          <tr>
            {table.columns.map((col, i) => (
              <Fragment key={col.seriesIndex}>
                <th
                  style={{
                    textAlign: 'right',
                    paddingRight: 16,
                    paddingLeft: 10,
                    borderLeft: `1px solid ${theme.color.border.regular}`,
                    color: theme.color.text.legend,
                    fontWeight: 400,
                  }}
                >
                  Value
                </th>
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
              const aimTupleIndex = isActive && value == null && tupleIndex != null ? tupleIndex : null;
              const missingGroupIndex =
                aimTupleIndex != null ? missingSlotIndexOf(aimTupleIndex) : -1;
              const aimable = aimTupleIndex != null && missingGroupIndex > -1;
              return (
                <Fragment key={col.seriesIndex}>
                <td
                  data-testid={`bar-cell-${col.seriesIndex}-${categoryIndex}`}
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
                      : value == null
                      ? `${col.seriesName} has no ${categoryName} bar`
                      : isActive
                      ? 'Click to select this bar on the figure'
                      : undefined
                  }
                  style={{
                    textAlign: 'right',
                    paddingRight: 16,
                    paddingLeft: 10,
                    borderLeft: `1px solid ${theme.color.border.regular}`,
                    cursor: isActive && !aimable && tupleIndex == null ? 'default' : 'pointer',
                    // The SAME highlight the other output panels give a selected
                    // row - a token rather than a fourth copy of one colour.
                    ...(isActive && tupleIndex != null && tupleIndex === activeTupleIndex
                      ? { background: theme.color.background.selectedRow }
                      : {}),
                  }}
                >
                  {value == null ? (
                    <span style={{ color: theme.color.text.legend }}>-</span>
                  ) : (
                    <>
                      {/* `tuple-derived-N`, not just this cell's own bar-cell-S-C
                          testid: the ACTIVE series' Nth tuple (capture order),
                          same identifier the generic hasSlots table (Pie/Box
                          Plot) has always used for its one-series-at-a-time
                          Value column -- kept so e2e's shared derivedValue()
                          helper reads either table the same way. Active-series
                          only, since that's the one whose tupleIndex this is. */}
                      <span data-testid={isActive && tupleIndex != null ? `tuple-derived-${tupleIndex}` : undefined}>
                        {fmtValue(value)}
                      </span>
                      {isActive && tupleIndex != null && (
                        <TupleDeleteButton tupleIndex={tupleIndex} noun={tupleNoun} onDelete={onRemoveTuple} />
                      )}
                    </>
                  )}
                </td>
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
    {table.categoryNames.length === 0 && (
      <div data-testid="no-points" style={{ padding: 8, color: theme.color.text.legend, fontSize: 12.5 }}>
        {noPointsHint}
      </div>
    )}
    {(table.crowded?.length ?? 0) > 0 && (
      <div
        data-testid="bar-crowded"
        style={{ padding: 8, color: theme.color.error, fontSize: 12.5 }}
      >
        {crowdedMessage(table.crowded!, table.categoryNames, tupleNoun)}
      </div>
    )}
    </>  );
}
