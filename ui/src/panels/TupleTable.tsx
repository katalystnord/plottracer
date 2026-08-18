import { theme } from '../theme.js';
import { fmtValue } from '../format.js';
import { TupleDeleteButton } from './TupleDeleteButton.js';
import type { ReactNode } from 'react';

/** One tuple's row: its slot members, its name, and the type's derived value. */
export interface TupleRow {
  tupleIndex: number;
  label: string;
  derived: number | null;
  points: readonly ({ data: readonly number[] | null } | null)[];
}

export interface TupleTableProps {
  rows: readonly TupleRow[];
  /** Slot names, one column each - unless the type declares a derived value. */
  slotNames: readonly string[];
  /** Present when the type's datum is the TUPLE rather than its members. */
  derivedColumn: { label: string } | null;
  tupleNoun: string;
  onRemoveTuple: (tupleIndex: number) => void;
  /** The click-to-edit name cell, supplied by the caller. */
  renderLabel: (tupleIndex: number, label: string) => ReactNode;
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
  rows,
  slotNames,
  derivedColumn,
  tupleNoun,
  onRemoveTuple,
  renderLabel,
  noPointsHint,
}: TupleTableProps) {
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
          <th aria-hidden />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.tupleIndex}>
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
                {row.derived === null ? '-' : fmtValue(row.derived)}
              </td>
            ) : (
              row.points.map((point, gi) => (
                <td key={gi} style={{ paddingRight: 16 }}>
                  {point && point.data ? fmtValue(point.data[0]!) : '-'}
                </td>
              ))
            )}
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
