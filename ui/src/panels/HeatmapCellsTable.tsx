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
  renderXName?: (bandIndex: number, name: string, ordinal: number, copy?: string) => ReactNode;
  renderYName?: (bandIndex: number, name: string, ordinal: number, copy?: string) => ReactNode;
  /**
   * The cell picked on the figure or here — the two are one selection.
   *
   * ⚑ A heatmap's cells have no markers on the canvas, so until now nothing tied
   * a row of the results to the square it was read from. David: *"if you are on
   * a square in the matrix, it is highlighted in the heatmap?"* It works both
   * ways round, which is what every other type already does between its table
   * and its markers.
   */
  selectedCell?: { col: number; row: number } | null;
  /** Every picked cell, as `col,row` keys — the app's own selection model,
   * which data points have used since v1.2. */
  selectedCells?: ReadonlySet<string>;
  /** Pick these keys; `additive` is Shift held. A header hands its whole band. */
  onPickCells?: (keys: readonly string[], additive: boolean) => void;
}

const num = (v: number | null, digits = 4): string => (v === null ? '—' : v.toPrecision(digits));

export function HeatmapCellsTable({ cells, noCellsHint, renderXName, renderYName, selectedCell, selectedCells, onPickCells }: HeatmapCellsTableProps) {
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
        <MatrixView
          cells={cells}
          renderXName={renderXName}
          renderYName={renderYName}
          selectedCell={selectedCell}
          selectedCells={selectedCells}
          onPickCells={onPickCells}
        />
      ) : (
        <LongView
          cells={cells}
          renderXName={renderXName}
          renderYName={renderYName}
          selectedCell={selectedCell}
          selectedCells={selectedCells}
          onPickCells={onPickCells}
        />
      )}
    </div>
  );
}

type ViewProps = Pick<
  HeatmapCellsTableProps,
  'cells' | 'renderXName' | 'renderYName' | 'selectedCell' | 'selectedCells' | 'onPickCells'
>;

/** The pick reads as a highlight in both views — same colour as the outline the
 * canvas draws, so the two are visibly one thing. */
const PICKED_BACKGROUND = 'rgba(124, 58, 237, 0.18)';

/**
 * How strongly a cell is tinted with the colour it was read from.
 *
 * ⚑⚑ THE MATRIX MIRRORS THE FIGURE. David: *"Fill our cell with a color if it
 * derived from color, and no color if it is user set or OCR"* — the indicator is
 * the EVIDENCE, so nothing has to be learned, and a shadowed column shows up in
 * the table as a darker band beside numbers that look perfectly reasonable.
 *
 * ⚑ A WASH rather than the full colour, so the numbers stay black and legible on
 * a dark palette — and so the picked highlight, which is itself translucent,
 * layers over it exactly as it does on the canvas. Same mechanism in both
 * places; no special case for the table.
 */
const VALUE_TINT_ALPHA = 0.35;

/** The cell's background: the colour it was read from, or nothing at all when
 * the number came from somewhere else. */
function tintOf(cell: { rgb?: readonly [number, number, number]; source?: string } | undefined) {
  if (!cell?.rgb || cell.source !== 'colour') return undefined;
  return `rgba(${cell.rgb[0]}, ${cell.rgb[1]}, ${cell.rgb[2]}, ${VALUE_TINT_ALPHA})`;
}

/**
 * How a value reads, given where it came from.
 *
 * ⚑⚑ SQUARE brackets for a user-entered value — the convention from scholarly
 * editing, epigraphy and archaeology, where `[x]` means EDITORIALLY SUPPLIED,
 * which is exactly what this is. ⚠️ NOT round brackets: `(59)` is accounting
 * notation for NEGATIVE FIFTY-NINE, and pasting it into a spreadsheet silently
 * becomes −59 — the precise class of error this feature exists to prevent.
 * ⚑ The bracket is TEXT, so it survives a copy-paste into a spreadsheet where
 * the tint cannot. The channel carrying the most important fact is the one that
 * travels; machine-readable provenance rides in the export's own column.
 */
function valueText(display: string, source?: string): string {
  return source === 'user' ? `[${display}]` : display;
}

/**
 * The figure's own shape: one cell per cell, names down the edges.
 *
 * ⚑⚑ ROWS RUN TOP-DOWN, which is the whole point of this view. Cell row 0 is
 * `yMin` — the BOTTOM of the plot — so rendering rows in index order would print
 * the matrix upside down against the figure it came from, and "which category
 * belongs where" would be exactly as unanswerable as it was in the long form.
 */
function MatrixView({ cells, renderXName, renderYName, selectedCells, onPickCells }: ViewProps) {
  const key = (col: number, row: number) => `${col},${row}`;
  const picked = (col: number, row: number) => selectedCells?.has(key(col, row)) === true;
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
                <th
                  key={col}
                  data-testid={`heatmap-col-select-${col}`}
                  onClick={(e) => onPickCells?.(rows.map((r) => key(col, r)), e.shiftKey)}
                  title="Click to select this whole column — Shift to add it to the picked cells"
                  style={{
                    padding: '0 8px',
                    fontWeight: 700,
                    textAlign: 'left',
                    cursor: onPickCells ? 'pointer' : undefined,
                    // ⚑ A band shows as picked only when ALL of it is, so a
                    // partial range never looks like a whole column.
                    background: rows.every((r) => picked(col, r)) ? PICKED_BACKGROUND : undefined,
                  }}
                >
                  {/* ⚑⚑ THE HEADER IS THE COLUMN'S IDENTITY, not a coordinate.
                      It used to show the CENTRE — `0.9994`, `3.496` — which is a
                      DERIVED value presented as the thing itself, unstable (drag
                      a boundary and every label changes), and not how any
                      generator identifies a column: `pcolormesh` takes EDGES,
                      `seaborn.heatmap` takes NAMES, `imshow` takes INDICES. A
                      per-column centre is the lossy input convention, and it was
                      the label.
                      ⚑ So: the NUMBER always, because a column's position never
                      moves; the NAME where the figure prints one; and the EXTENT
                      underneath, which is what the record actually holds. */}
                  <div data-testid={`heatmap-col-head-${col}`}>{`C${col + 1}`}</div>
                  {cell.xIsCategory && renderXName ? (
                    <div style={{ fontWeight: 500 }}>{renderXName(col, cell.xLabel, cell.xCentre)}</div>
                  ) : cell.xLabel ? (
                    <div style={{ fontWeight: 500 }}>{cell.xLabel}</div>
                  ) : (
                    <div style={{ fontWeight: 400, color: theme.color.text.legend }}>
                      {`${num(cell.xMin, 3)} – ${num(cell.xMax, 3)}`}
                    </div>
                  )}
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
                <th
                  data-testid={`heatmap-row-select-${row}`}
                  onClick={(e) => onPickCells?.(columns.map((c) => key(c, row)), e.shiftKey)}
                  title="Click to select this whole row — Shift to add it to the picked cells"
                  style={{
                    textAlign: 'left',
                    paddingRight: 8,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    cursor: onPickCells ? 'pointer' : undefined,
                    background: columns.every((c) => picked(c, row)) ? PICKED_BACKGROUND : undefined,
                  }}
                >
                  <span data-testid={`heatmap-row-head-${row}`}>{`R${row + 1}`}</span>{' '}
                  {rowCell.yIsCategory && renderYName ? (
                    <span style={{ fontWeight: 500 }}>{renderYName(row, rowCell.yLabel, rowCell.yCentre)}</span>
                  ) : rowCell.yLabel ? (
                    <span style={{ fontWeight: 500 }}>{rowCell.yLabel}</span>
                  ) : (
                    <span style={{ fontWeight: 400, color: theme.color.text.legend }}>
                      {`${num(rowCell.yMin, 3)} – ${num(rowCell.yMax, 3)}`}
                    </span>
                  )}
                </th>
                {columns.map((col) => {
                  const cell = byKey.get(`${col},${row}`);
                  const isPicked = picked(col, row);
                  return (
                    <td
                      key={col}
                      data-testid={`heatmap-matrix-cell-${col}-${row}`}
                      onClick={(e) => onPickCells?.([key(col, row)], e.shiftKey)}
                      // ⚑ The evidence cannot fit in a matrix cell, so a flagged
                      // one is coloured and carries its note as a tooltip, and
                      // the Table view holds the full account. A matrix showing
                      // only numbers would hide the one thing that says which
                      // numbers to trust.
                      title={cell?.warning || undefined}
                      style={{
                        padding: '0 8px',
                        textAlign: 'right',
                        cursor: onPickCells ? 'pointer' : undefined,
                        // ⚑ THE SAME TRANSLUCENT HIGHLIGHT, LAYERED — exactly as
                        // it is on the canvas, over whatever the cell's own
                        // colour happens to be. No outline invented for the
                        // table: "picked" looks like "picked" in both places.
                        backgroundColor: tintOf(cell),
                        backgroundImage: isPicked
                          ? `linear-gradient(${PICKED_BACKGROUND}, ${PICKED_BACKGROUND})`
                          : undefined,
                        color: cell?.warning ? theme.color.error : undefined,
                      }}
                    >
                      {cell ? valueText(num(cell.value, 5), cell.source) : ''}
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
function LongView({ cells, renderXName, renderYName, selectedCells, onPickCells }: ViewProps) {
  const key = (col: number, row: number) => `${col},${row}`;
  const picked = (col: number, row: number) => selectedCells?.has(key(col, row)) === true;
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
            <tr
              key={`${cell.col}-${cell.row}`}
              data-testid="heatmap-row"
              onClick={(e) => onPickCells?.([key(cell.col, cell.row)], e.shiftKey)}
              style={{
                cursor: onPickCells ? 'pointer' : undefined,
                background: picked(cell.col, cell.row) ? PICKED_BACKGROUND : undefined,
              }}
            >
              {/* The name where the figure prints one, the measured centre where
                  it does not. Only the TABLE chooses: the export carries both,
                  because the bounds stay true whatever the axis is called. */}
              {/* ⚑ Editable only where the coordinate IS a name. On a value
                  axis the cell shows a measured centre, and a measurement is
                  not something to type over. */}
              <td style={{ paddingRight: 8 }}>
                {cell.xIsCategory && renderXName
                  ? renderXName(cell.col, cell.xLabel, cell.xCentre, `x${cell.col}@${cell.col}-${cell.row}`)
                  : cell.xLabel || num(cell.xCentre, 4)}
              </td>
              <td style={{ paddingRight: 8 }}>
                {cell.yIsCategory && renderYName
                  ? renderYName(cell.row, cell.yLabel, cell.yCentre, `y${cell.row}@${cell.col}-${cell.row}`)
                  : cell.yLabel || num(cell.yCentre, 4)}
              </td>
              <td
                style={{
                  paddingRight: 8,
                  // ⚑ The long form mirrors the matrix, which mirrors the figure.
                  backgroundColor: tintOf(cell),
                }}
              >
                {valueText(num(cell.value, 5), cell.source)}
              </td>
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
