import { theme } from '../theme.js';
import { fmtValue } from '../format.js';
import { TupleDeleteButton } from './TupleDeleteButton.js';
import type { ReactNode } from 'react';
import type { DisplayRounder } from '../../../core/displayPrecision.js';

/** One tuple's row: its slot members, its name, and the type's derived value. */
export interface TupleRow {
  tupleIndex: number;
  label: string;
  derived: number | null;
  points: readonly ({ data: readonly number[] | null } | null)[];
}

export interface TupleTableProps {
  /** How a number is rounded before it is printed - the figure's own resolution,
   * so this table and the file it exports to report the same reading. */
  display: DisplayRounder;
  rows: readonly TupleRow[];
  /** Slot names, one column each - unless the type declares a derived value. */
  slotNames: readonly string[];
  /** Present when the type's datum is the TUPLE rather than its members. */
  derivedColumn: { label: string } | null;
  tupleNoun: string;
  onRemoveTuple: (tupleIndex: number) => void;
  /** The click-to-edit name cell, supplied by the caller. */
  renderLabel: (tupleIndex: number, label: string) => ReactNode;
  /**
   * Select this row, and ring it on the figure (F30).
   *
   * ⚑⚑ THE FIRST QUESTION ANYONE ASKS OF A TABLE OF TWENTY BOXES is "which one
   * on the figure is this?", and until now four of the seven output panels could
   * not answer it - the XY spreadsheet, the spider table and the heatmap matrix
   * all could. One click SELECTS, exactly as everywhere else (A3).
   */
  onSelectTuple: (tupleIndex: number) => void;
  /** Which row the current selection is standing on, or null. */
  activeTupleIndex: number | null;
  /**
   * The caps someone placed on these tuples, from `errorColumnsByTuple` - the
   * SAME accessor the export asks.
   *
   * ⚑⚑ THE DIVERGENCE RAN THE OTHER WAY HERE (v2.3 re-audit, F43).
   * `errorColumnsFor`'s standing claim is *"one answer, so a column cannot exist
   * on screen and be missing from the file"* - and on a pie or a box plot the
   * column was in the FILE and missing from the SCREEN. The caps are captured,
   * they are drawn on the canvas, they are in all nine formats, and the panel
   * that is meant to be what the file says showed the slots alone. A user could
   * not read back a measurement they had just taken.
   *
   * ⚑ Absent for a series with no caps, so an ordinary pie's table is exactly
   * what it was.
   */
  error?: { labels: readonly string[]; values: readonly (readonly (number | null)[])[] };
  /** Shown when nothing has been captured yet. */
  noPointsHint: string;
}

/**
 * The tuple table - one row per box / slice / bar, for every slotted type.
 *
 * ⚑ ONE DERIVED COLUMN where the type's datum is the tuple rather than its
 * members (pie): a slice's two boundaries are angles and neither is the number
 * anyone wants - the value is the DIFFERENCE between them. Every other tuple
 * type keeps its per-slot columns, because a box plot's Min/Q1/Median really
 * are five separate readings.
 *
 * ⚑ The empty-state hint was MISSING here for a whole release: every slotted
 * type silently lost its "no points yet" guidance the moment its table stopped
 * being the flat spreadsheet, and nothing on screen told a first-run user what
 * to do. Found because a plain Bar chart used to show it and a real e2e test
 * caught the empty screen it left behind.
 */
export function TupleTable({
  display,
  rows,
  slotNames,
  derivedColumn,
  tupleNoun,
  onRemoveTuple,
  renderLabel,
  onSelectTuple,
  activeTupleIndex,
  error,
  noPointsHint,
}: TupleTableProps) {
  const err = error?.labels.length ? error : null;
  return (
    <>
    <table data-testid="points-table" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'left', paddingRight: 16 }}>#</th>
          <th style={{ textAlign: 'left', paddingRight: 16 }}>Category</th>
          {derivedColumn ? (
            <th style={{ textAlign: 'left', paddingRight: 16 }}>{derivedColumn.label}</th>
          ) : (
            slotNames.map((name) => (
              <th key={name} style={{ textAlign: 'left', paddingRight: 16 }}>
                {name}
              </th>
            ))
          )}
          {err?.labels.map((label) => (
            <th key={label} style={{ textAlign: 'left', paddingRight: 16 }}>
              {label}
            </th>
          ))}
          <th aria-hidden />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.tupleIndex}
            data-testid={`tuple-row-${row.tupleIndex}`}
            aria-selected={row.tupleIndex === activeTupleIndex}
            onClick={() => onSelectTuple(row.tupleIndex)}
            style={{
              cursor: 'pointer',
              background:
                row.tupleIndex === activeTupleIndex ? theme.color.background.selectedRow : undefined,
            }}
          >
            <td style={{ paddingRight: 16 }}>{row.tupleIndex + 1}</td>
            <td style={{ paddingRight: 16 }}>{renderLabel(row.tupleIndex, row.label)}</td>
            {/* ⚑ One DERIVED column where the type's datum is the tuple
                rather than its members (pie): a slice's two boundaries are
                angles and neither is the number anyone wants -- the value is
                the difference between them. Every other tuple type keeps its
                per-slot columns, because a box plot's Min/Q1/Median really
                are five separate readings. */}
            {derivedColumn ? (
              <td data-testid={`tuple-derived-${row.tupleIndex}`} style={{ paddingRight: 16 }}>
                {/* ⚑ The figure's own resolution, by the route this table's own
                    export section takes - so the panel and the file agree. */}
                {row.derived === null ? '-' : fmtValue(display.atData([row.derived], 0))}
              </td>
            ) : (
              // ⚑⚑ THE TYPE'S OWN MEMBERS ONLY, sliced to the HEADER's length.
              // A row carries every tuple slot, and once a series gains error
              // that includes the four cap slots - while the header is
              // `slotNames`, which strips them. So a box plot with one SD cap
              // rendered TWELVE body cells under TEN header cells: the cap value
              // appeared twice, once under a heading belonging to another
              // column, and the delete button sat two columns adrift.
              //
              // ⚠️ THE EXPORTER ALREADY FOUND AND FIXED THIS EXACT SHAPE -
              // `tupleDataSection` slices identically, under a comment reading
              // *"three header cells against seven row cells, every number under
              // the wrong word, which is worse than dropping them"* - and the fix
              // was never mirrored into the panel. Adding the error columns (F43)
              // then stacked new columns on an alignment that was already wrong.
              // Pie escaped only because `derivedColumn` short-circuits this map.
              // (v2.3 audit fleet.)
              row.points.slice(0, slotNames.length).map((point, gi) => (
                <td key={gi} style={{ paddingRight: 16 }}>
                  {point && point.data ? fmtValue(display.atData(point.data, 0)) : '-'}
                </td>
              ))
            )}
            {/* Blank, never 0, where that side was never captured - the rule
                the export follows in the same columns. */}
            {err?.labels.map((label, c) => {
              const v = err.values[row.tupleIndex]?.[c];
              return (
                <td key={label} style={{ paddingRight: 16 }}>
                  {v == null ? '' : fmtValue(v)}
                </td>
              );
            })}
            <td>
              <TupleDeleteButton tupleIndex={row.tupleIndex} noun={tupleNoun} onDelete={onRemoveTuple} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {/* ⚑ v2.0: the empty-state hint the flat table already had (below) was
        missing here entirely -- every slotted type (Box Plot, Pie, Spider,
        and now Bar, once it became tuple-shaped) silently lost its
        "no points yet" guidance the moment its table stopped being the flat
        spreadsheet, and nothing on screen told a first-run user what to do.
        Found because a plain Bar chart used to show this and a real e2e
        test caught the empty screen it left behind -- same `noPointsHint`
        text (already written generically per mode/graph-type), same
        testid, just rendered for the other table shape too. */}
    {rows.length === 0 && (
      <div data-testid="no-points" style={{ padding: 8, color: theme.color.text.legend, fontSize: 12.5 }}>
        {noPointsHint}
      </div>
    )}
    </>  );
}
