import { theme } from '../theme.js';
import { fmtValue } from '../format.js';
import type { ReactNode } from 'react';

/** One series' column of the spider table, index-aligned with the axes. */
export interface SpiderColumn {
  seriesIndex: number;
  seriesName: string;
  profileIndex: number;
  /** The column heading — the profile's own name, or its position. */
  label: string;
  values: readonly (number | null)[];
  pointIndices: readonly (number | null)[];
}

export interface SpiderProfileTable {
  columns: readonly SpiderColumn[];
  axisNames: readonly string[];
  axisRawNames: readonly string[];
}

export interface SpiderTableProps {
  table: SpiderProfileTable;
  activeSeriesIndex: number;
  activePointIndex: number | null;
  /** Which axis the next click fills, and in which profile (null = a new one). */
  cursorAxisIndex: number | null;
  cursorTupleIndex: number | null;
  /** How many profiles exist — a column past the end is a NEW one. */
  tupleCount: number;
  onSelectSeries: (seriesIndex: number) => void;
  onSelectPoint: (pointIndex: number) => void;
  /** Aim the capture cursor at an empty slot. */
  onAimSlot: (tupleIndex: number | null, axisIndex: number) => void;
  renderAxisName: (axisIndex: number, rawName: string) => ReactNode;
  renderValue: (seriesIndex: number, pointIndex: number, axisIndex: number, value: number) => ReactNode;
}

/**
 * The Spider table (v1.4): `# | Category | Series 1 | Series 2 | …` — one row
 * per AXIS, one column per series.
 *
 * ⚑ The slot table this replaced showed the ACTIVE series only, so adding a
 * second series made the first one's readings vanish off the screen. Every
 * ungrouped type already showed all series at once, so that table was the
 * outlier — caught by driving the app, not by a test. Rows-as-axes is also how
 * radar data is normally published, and it stays compact as series are added.
 *
 * ⚑ The alignment is REAL: row k is axis k for every series, because each
 * series has exactly one slot per axis by construction. The same layout LIED
 * for error bars, where the pairing was never stored.
 */
export function SpiderTable({
  table,
  activeSeriesIndex,
  activePointIndex,
  cursorAxisIndex,
  cursorTupleIndex,
  tupleCount,
  onSelectSeries,
  onSelectPoint,
  onAimSlot,
  renderAxisName,
  renderValue,
}: SpiderTableProps) {
  return (
    <table data-testid="points-table" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr>
          <th style={{ textAlign: 'right', paddingRight: 10, color: theme.color.text.legend }}>#</th>
          <th style={{ textAlign: 'left', paddingRight: 16 }}>Category</th>
          {table.columns.map((col) => (
            <th
              key={`${col.seriesIndex}-${col.profileIndex}`}
              data-testid={`spider-col-${col.seriesIndex}-${col.profileIndex}`}
              style={{
                textAlign: 'right',
                paddingRight: 16,
                borderLeft: `1px solid ${theme.color.border.regular}`,
                paddingLeft: 10,
                fontWeight: 600,
                color: col.seriesIndex === activeSeriesIndex ? theme.color.primary.main : theme.color.text.primary,
              }}
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.axisNames.map((axisName, axisIndex) => (
          <tr key={axisName + String(axisIndex)}>
            <td style={{ textAlign: 'right', paddingRight: 10, color: theme.color.text.legend }}>{axisIndex + 1}</td>
            <td style={{ paddingRight: 16 }}>
              {renderAxisName(axisIndex, table.axisRawNames[axisIndex] ?? '')}
            </td>
            {table.columns.map((col) => {
              const value = col.values[axisIndex];
              const pointIndex = col.pointIndices[axisIndex];
              return (
                <td
                  key={`${col.seriesIndex}-${col.profileIndex}`}
                  data-testid={`spider-cell-${col.seriesIndex}-${axisIndex}`}
                  // ⚑ Clicking a cell SELECTS that point, switching the
                  // active series if it belongs to another one. Points of an
                  // inactive series are deliberately inert on the canvas (so
                  // a click can never land on the wrong series), which left
                  // the table as the only possible route to them — and it
                  // wasn't wired, so they could not be reached at all.
                  onClick={() => {
                    if (col.seriesIndex !== activeSeriesIndex) onSelectSeries(col.seriesIndex);
                    // ⚑ An EMPTY cell aims the capture cursor at that slot
                    // (David: "Can I make an empty slot active again, so
                    // that I can re-add a point that is missing?"). The
                    // cursor otherwise walks to the FIRST gap, which cannot
                    // reach the second one until the first is filled — and
                    // gaps are normal here: the axis-aware trace leaves one
                    // wherever it refused a ray. Clicking the dash is how
                    // that refusal list becomes a worklist.
                    if (pointIndex == null) {
                      onAimSlot(col.profileIndex < tupleCount ? col.profileIndex : null, axisIndex);
                      return;
                    }
                    onSelectPoint(pointIndex);
                  }}
                  title={
                    pointIndex == null
                      ? `Click to fill ${axisName} next`
                      : 'Click to select this point'
                  }
                  style={{
                    textAlign: 'right',
                    paddingRight: 16,
                    paddingLeft: 10,
                    borderLeft: `1px solid ${theme.color.border.regular}`,
                    cursor: 'pointer',
                    background:
                      pointIndex != null &&
                      pointIndex === activePointIndex &&
                      col.seriesIndex === activeSeriesIndex
                        ? theme.color.background.canvas
                        // ⚑ The slot the NEXT click fills is marked here too,
                        // not only in the "Next point fills" line: this is the
                        // table you are reading when you notice a gap, so it is
                        // where the answer to "which one am I about to fill?"
                        // has to be visible.
                        : pointIndex == null &&
                          col.seriesIndex === activeSeriesIndex &&
                          axisIndex === cursorAxisIndex &&
                          (cursorTupleIndex === null
                            ? col.profileIndex >= tupleCount
                            : col.profileIndex === cursorTupleIndex)
                        ? theme.color.background.canvas
                        : undefined,
                  }}
                >
                  {/* An axis this series has not reached reads as a dash, not
                      a zero — nothing was measured there.

                      ⚑ Typing is offered on the ACTIVE series only, the same
                      rule the XY table follows — and it has to be, because the
                      editor is keyed by (point index, axis) and point indices
                      are per-series, so two columns would otherwise open an
                      editor on the same keystroke. One click on another
                      column makes it active (above); its cells then read as
                      editable. */}
                  {value == null || pointIndex == null ? (
                    <span style={{ color: theme.color.text.legend }}>—</span>
                  ) : col.seriesIndex === activeSeriesIndex ? (
                    renderValue(col.seriesIndex, pointIndex, axisIndex, value)
                  ) : (
                    fmtValue(value)
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>  );
}
