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
 */

export interface HeatmapCellsTableProps {
  cells: HeatmapRow[];
  /** Shown when there are no cells yet — the heatmap's own "no points" hint. */
  noCellsHint: string;
}

const num = (v: number | null, digits = 4): string => (v === null ? '—' : v.toPrecision(digits));

export function HeatmapCellsTable({ cells, noCellsHint }: HeatmapCellsTableProps) {
  if (cells.length === 0) {
    return (
      <p data-testid="heatmap-no-cells" style={{ color: theme.color.text.secondary, fontSize: theme.font.size.small }}>
        {noCellsHint}
      </p>
    );
  }
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
              <td style={{ paddingRight: 8 }}>{cell.xLabel || num(cell.xCentre, 4)}</td>
              <td style={{ paddingRight: 8 }}>{cell.yLabel || num(cell.yCentre, 4)}</td>
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
