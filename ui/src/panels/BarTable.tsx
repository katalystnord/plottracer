import { theme } from '../theme.js';
import { fmtValue } from '../format.js';
import { TupleDeleteButton } from './TupleDeleteButton.js';
import type { ReactNode } from 'react';

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
  /** Which slot of this tuple is still empty, or -1 when it is complete. */
  missingSlotIndexOf: (tupleIndex: number) => number;
  /** Aim the next capture at that slot. */
  onAimSlot: (tupleIndex: number, slotIndex: number) => void;
  onRemoveTuple: (tupleIndex: number) => void;
  renderCategoryName: (categoryIndex: number, rawName: string) => ReactNode;
  noPointsHint: string;
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
  missingSlotIndexOf,
  onAimSlot,
  onRemoveTuple,
  renderCategoryName,
  noPointsHint,
}: BarTableProps) {
  return (
    <>
    <table data-testid="points-table" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'right', paddingRight: 10, color: theme.color.text.legend }}>#</th>
          <th style={{ textAlign: 'left', paddingRight: 16 }}>Category</th>
          {table.columns.map((col) => (
            <th
              key={col.seriesIndex}
              data-testid={`bar-col-${col.seriesIndex}`}
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
      </thead>
      <tbody>
        {table.categoryNames.map((categoryName, categoryIndex) => (
          <tr key={categoryIndex}>
            <td style={{ textAlign: 'right', paddingRight: 10, color: theme.color.text.legend }}>{categoryIndex + 1}</td>
            <td style={{ paddingRight: 16 }}>
              {renderCategoryName(categoryIndex, table.categoryRawNames[categoryIndex] ?? '')}
            </td>
            {table.columns.map((col) => {
              const value = col.values[categoryIndex];
              const tupleIndex = col.tupleIndices[categoryIndex];
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
                <td
                  key={col.seriesIndex}
                  data-testid={`bar-cell-${col.seriesIndex}-${categoryIndex}`}
                  // Clicking a cell of an INACTIVE series switches to it --
                  // the same reachability rule Spider's own cells follow,
                  // since deleting a bar (below) is offered on the active
                  // series only. An ACTIVE cell with a half-filled bar aims
                  // the next capture at its missing corner.
                  onClick={() => {
                    if (!isActive) {
                      onSelectSeries(col.seriesIndex);
                      return;
                    }
                    if (aimable && aimTupleIndex != null) {
                  onAimSlot(aimTupleIndex, missingGroupIndex);
                }
                  }}
                  title={
                    aimable
                      ? `Click to fill this bar's missing corner next`
                      : value == null
                      ? `${col.seriesName} has no ${categoryName} bar`
                      : undefined
                  }
                  style={{
                    textAlign: 'right',
                    paddingRight: 16,
                    paddingLeft: 10,
                    borderLeft: `1px solid ${theme.color.border.regular}`,
                    cursor: isActive && !aimable ? 'default' : 'pointer',
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
