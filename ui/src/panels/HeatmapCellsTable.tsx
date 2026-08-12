import { useState, type ReactNode } from 'react';
import { theme } from '../theme.js';
import type { HeatmapRow } from '../../../engine/heatmapRun.js';

/**
 * A heatmap's cells, IN THE DATA POINTS PANEL — the same place every other
 * graph type puts what it extracted.
 *
 * ⚑⚑ DAVID, 2026-08-12: *"But we DO want the output in the same place as for
 * the other graphs, not down in the bottom… Else it becomes very confusing for
 * the users, and extremely inconsistent."* The cells first appeared inside the
 * Heatmap card, which put a heatmap's record somewhere no other type's record
 * lives, while the panel a user actually looks at said "No points yet". Two
 * output-shaped places, and the real one was the wrong one.
 *
 * ⚑ It is the same split the rail redesign settled: fold-outs and cards take
 * INPUTS, outputs go to the series-bound panel, the canvas and the export. Bar,
 * box plot, spider and histogram each render their own table here for exactly
 * this reason; a matrix is one more shape, not an exception.
 *
 * ⚑ THE EVIDENCE COLUMNS TRAVEL WITH THE VALUE, here as in the file. In a
 * heatmap the colour IS the value, so a wrong cell has no other symptom — the
 * interval it cannot be told apart from and the note saying what is off about it
 * are not decoration, they are the only way to know which numbers to trust.
 *
 * ⚑⚑ AND IT OPENS AS A MATRIX, because that is what a heatmap is. David: *"You
 * are presenting a matrix as a table in the results, and that is just a mess.
 * There is no way anyone could see the categories belonging where. We should
 * have two buttons to say present results as a [matrix] [table]."* Twenty-five
 * rows of `x, y, value` is the tidy/long form — correct, exportable, and
 * unreadable against the figure. The matrix puts each value where the figure put
 * it with the names down the edges; the long form is one click away and is the
 * only view with room for the evidence.
 *
 * ⚑ Both are the same record — the matrix is the long form pivoted, and the
 * names come from the same per-band lists — so switching view cannot change a
 * number or move a name, and a name typed in either applies to the whole band.
 */

export interface HeatmapCellsTableProps {
  cells: HeatmapRow[];
  /** Shown when there are no cells yet — the heatmap's own "no points" hint. */
  noCellsHint: string;
  /**
   * Click-to-edit the CATEGORY name, per axis — the same gesture the bar
   * chart's Category column has had since v2.0.
   *
   * ⚑⚑ A NAME IS THE ONE THING IN THIS TABLE THE FIGURE DOES NOT MEASURE, so it
   * is the one thing that must be correctable in place. Every other column is
   * read off the pixels; the names are transcribed by a person, and a person
   * mistypes. Bulk entry stays in the grid fold-down (twelve gene names in one
   * field), and this is how you fix the one that is wrong.
   *
   * ⚑ Editing ANY cell of a column edits the COLUMN — the name belongs to the
   * band, not to the cell — which is exactly what the bar table does when
   * naming a category shared by several series.
   */
  renderXName?: (bandIndex: number, name: string, ordinal: number) => ReactNode;
  renderYName?: (bandIndex: number, name: string, ordinal: number) => ReactNode;
}

const num = (v: number | null, digits = 4): string => (v === null ? '—' : v.toPrecision(digits));

export function HeatmapCellsTable({ cells, noCellsHint, renderXName, renderYName }: HeatmapCellsTableProps) {
  const [view, setView] = useState<'matrix' | 'table'>('matrix');

  if (cells.length === 0) {
    return (
      <p data-testid="heatmap-no-cells" style={{ color: theme.color.text.secondary, fontSize: theme.font.size.small }}>
        {noCellsHint}
      </p>
    );
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {(['matrix', 'table'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            data-testid={`heatmap-view-${kind}`}
            onClick={() => setView(kind)}
            style={{
              fontSize: theme.font.size.small,
              padding: '1px 8px',
              borderRadius: theme.border.radius.regular,
              cursor: 'pointer',
              textTransform: 'capitalize',
              border: `1px solid ${view === kind ? theme.color.primary.main : theme.color.border.regular}`,
              background: view === kind ? theme.color.primary.main : theme.color.background.primary,
              color: view === kind ? '#fff' : theme.color.text.primary,
            }}
          >
            {kind}
          </button>
        ))}
      </div>
      {view === 'matrix' ? (
        <MatrixView cells={cells} renderXName={renderXName} renderYName={renderYName} />
      ) : (
        <LongView cells={cells} renderXName={renderXName} renderYName={renderYName} />
      )}
    </div>
  );
}

type ViewProps = Pick<HeatmapCellsTableProps, 'cells' | 'renderXName' | 'renderYName'>;

/**
 * The figure's own shape: one cell per cell, names down the edges.
 *
 * ⚑⚑ ROWS RUN TOP-DOWN, which is the whole point of this view. Cell row 0 is
 * `yMin` — the BOTTOM of the plot — so rendering rows in index order would print
 * the matrix upside down against the figure it came from, and "which category
 * belongs where" would be exactly as unanswerable as it was in the long form.
 */
function MatrixView({ cells, renderXName, renderYName }: ViewProps) {
  const columns = [...new Set(cells.map((c) => c.col))].sort((a, b) => a - b);
  const rows = [...new Set(cells.map((c) => c.row))].sort((a, b) => b - a);
  const byKey = new Map(cells.map((c) => [`${c.col},${c.row}`, c]));
  return (
    <div style={{ maxHeight: 320, overflow: 'auto' }}>
      <table
        data-testid="heatmap-matrix"
        style={{ borderCollapse: 'collapse', fontSize: theme.font.size.small, fontVariantNumeric: 'tabular-nums' }}
      >
        <thead>
          <tr style={{ color: theme.color.text.legend, textAlign: 'left' }}>
            <th />
            {columns.map((col) => {
              const cell = cells.find((c) => c.col === col)!;
              return (
                <th key={col} style={{ padding: '0 8px', fontWeight: 500 }}>
                  {cell.xIsCategory && renderXName
                    ? renderXName(col, cell.xLabel, cell.xCentre)
                    : cell.xLabel || num(cell.xCentre, 4)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const rowCell = cells.find((c) => c.row === row)!;
            return (
              <tr key={row} data-testid="heatmap-matrix-row">
                <th style={{ color: theme.color.text.legend, textAlign: 'left', paddingRight: 8, fontWeight: 500 }}>
                  {rowCell.yIsCategory && renderYName
                    ? renderYName(row, rowCell.yLabel, rowCell.yCentre)
                    : rowCell.yLabel || num(rowCell.yCentre, 4)}
                </th>
                {columns.map((col) => {
                  const cell = byKey.get(`${col},${row}`);
                  return (
                    <td
                      key={col}
                      // ⚑ The evidence cannot fit in a matrix cell, so a flagged
                      // one is coloured and carries its note as a tooltip, and
                      // the Table view holds the full account. A matrix showing
                      // only numbers would hide the one thing that says which
                      // numbers to trust.
                      title={cell?.warning || undefined}
                      style={{ padding: '0 8px', textAlign: 'right', color: cell?.warning ? theme.color.error : undefined }}
                    >
                      {cell ? num(cell.value, 5) : ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One row per cell — the tidy/long form, and the only view with room for the
 * evidence that says whether to trust a value. */
function LongView({ cells, renderXName, renderYName }: ViewProps) {
  return (
    <div style={{ maxHeight: 320, overflow: 'auto' }}>
      <table
        data-testid="heatmap-table"
        style={{
          borderCollapse: 'collapse',
          fontSize: theme.font.size.small,
          fontVariantNumeric: 'tabular-nums',
          width: '100%',
        }}
      >
        <thead>
          <tr style={{ color: theme.color.text.legend, textAlign: 'left' }}>
            <th style={{ paddingRight: 8 }}>x</th>
            <th style={{ paddingRight: 8 }}>y</th>
            <th style={{ paddingRight: 8 }}>value</th>
            {/* ⚑ The interval travels WITH the value, in the same row and the
                same units. A number whose uncertainty lives somewhere else is
                read as exact. */}
            <th style={{ paddingRight: 8 }}>range</th>
            <th>note</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((cell) => (
            <tr key={`${cell.col}-${cell.row}`} data-testid="heatmap-row">
              {/* The name where the figure prints one, the measured centre where
                  it does not. Only the TABLE chooses: the export carries both,
                  because the bounds stay true whatever the axis is called. */}
              {/* ⚑ Editable only where the coordinate IS a name. On a value
                  axis the cell shows a measured centre, and a measurement is
                  not something to type over. */}
              <td style={{ paddingRight: 8 }}>
                {cell.xIsCategory && renderXName
                  ? renderXName(cell.col, cell.xLabel, cell.xCentre)
                  : cell.xLabel || num(cell.xCentre, 4)}
              </td>
              <td style={{ paddingRight: 8 }}>
                {cell.yIsCategory && renderYName
                  ? renderYName(cell.row, cell.yLabel, cell.yCentre)
                  : cell.yLabel || num(cell.yCentre, 4)}
              </td>
              <td style={{ paddingRight: 8 }}>{num(cell.value, 5)}</td>
              <td style={{ paddingRight: 8, color: theme.color.text.legend }}>
                {cell.value === null ? '—' : `${num(cell.low, 4)} – ${num(cell.high, 4)}`}
              </td>
              <td style={{ color: cell.warning ? theme.color.error : undefined }}>{cell.warning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
