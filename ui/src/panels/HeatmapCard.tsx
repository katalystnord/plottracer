import { theme } from '../theme.js';
import { SidebarSection, SidebarHeading } from '../layout.js';
import type { HeatmapRow } from '../../../engine/heatmapRun.js';

/**
 * The Heatmap card (v2.2) — the grid, and what the cells came out as.
 *
 * ⚑ EVERY DECISION IS IN `engine/heatmapRun.ts`; this file is a button, two
 * number boxes and a table. That is the split the v2.1 work settled on, and the
 * reason is instrument reach: mutation testing cannot see `ui/` at all, and the
 * only other thing that can is an 18-minute Electron run.
 *
 * ⚑ THE STATUS LINE IS NOT DECORATION. In a heatmap the colour IS the value, so
 * a wrong cell has no other symptom — nothing missing, nothing misplaced, no
 * refusal. The whole apparatus underneath measures whether each cell can vouch
 * for itself; if that never reached the screen it would have been for nothing.
 * So the summary says how many need a look, and every flagged cell says why in
 * its own row.
 */

export interface HeatmapCardProps {
  /** Columns and rows the user says the figure has — a CHECK on detection, never
   * a target. Blank means "no declaration", and detection then offers whatever
   * it found. */
  columns: string;
  rows: string;
  onColumnsChange: (value: string) => void;
  onRowsChange: (value: string) => void;
  /** How many boundaries the grid currently holds, so the user can see the grid
   * exists even before reading any cells. */
  gridSize: { columns: number; rows: number } | null;
  onDetect: () => void;
  onRead: () => void;
  /** Detection's own report — agreement, a miss, or why nothing could be read. */
  detectMessage: string;
  /** The read-out summary, and the cells themselves. */
  summary: string;
  error: string | null;
  cells: HeatmapRow[];
  canRead: boolean;
}

const num = (v: number | null, digits = 4): string => (v === null ? '—' : v.toPrecision(digits));

export function HeatmapCard({
  columns,
  rows,
  onColumnsChange,
  onRowsChange,
  gridSize,
  onDetect,
  onRead,
  detectMessage,
  summary,
  error,
  cells,
  canRead,
}: HeatmapCardProps) {
  return (
    <SidebarSection>
      <SidebarHeading>Heatmap</SidebarHeading>
      <div
        data-testid="heatmap-card"
        style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: theme.font.size.small }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            Columns
            <input
              data-testid="heatmap-columns"
              value={columns}
              onChange={(e) => onColumnsChange(e.target.value)}
              inputMode="numeric"
              style={{ width: 46 }}
            />
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            Rows
            <input
              data-testid="heatmap-rows"
              value={rows}
              onChange={(e) => onRowsChange(e.target.value)}
              inputMode="numeric"
              style={{ width: 46 }}
            />
          </label>
        </div>
        <span style={{ color: theme.color.text.legend }}>
          Leave blank to take whatever the figure shows.
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" data-testid="heatmap-detect" onClick={onDetect} disabled={!canRead}>
            Detect grid
          </button>
          <button type="button" data-testid="heatmap-read" onClick={onRead} disabled={!canRead}>
            Read cells
          </button>
        </div>
        {gridSize && (
          <span data-testid="heatmap-grid-size" style={{ color: theme.color.text.secondary }}>
            Grid: {gridSize.columns} × {gridSize.rows} cells
          </span>
        )}
        {detectMessage && (
          <span data-testid="heatmap-detect-message" style={{ color: theme.color.text.secondary }}>
            {detectMessage}
          </span>
        )}
        {error && (
          <span data-testid="heatmap-error" style={{ color: theme.color.error }}>
            {error}
          </span>
        )}
        {summary && (
          <span data-testid="heatmap-summary" style={{ color: theme.color.text.secondary }}>
            {summary}
          </span>
        )}
        {cells.length > 0 && (
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            <table
              data-testid="heatmap-table"
              style={{
                borderCollapse: 'collapse',
                fontSize: theme.font.size.small,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <thead>
                <tr style={{ color: theme.color.text.legend, textAlign: 'left' }}>
                  <th style={{ paddingRight: 8 }}>x</th>
                  <th style={{ paddingRight: 8 }}>y</th>
                  <th style={{ paddingRight: 8 }}>value</th>
                  {/* ⚑ The interval travels WITH the value, in the same row and
                      the same units. A number whose uncertainty lives somewhere
                      else is read as exact. */}
                  <th style={{ paddingRight: 8 }}>range</th>
                  <th>note</th>
                </tr>
              </thead>
              <tbody>
                {cells.map((cell) => (
                  <tr key={`${cell.col}-${cell.row}`} data-testid="heatmap-row">
                    <td style={{ paddingRight: 8 }}>{num(cell.xCentre, 4)}</td>
                    <td style={{ paddingRight: 8 }}>{num(cell.yCentre, 4)}</td>
                    <td style={{ paddingRight: 8 }}>{num(cell.value, 5)}</td>
                    <td style={{ paddingRight: 8, color: theme.color.text.legend }}>
                      {cell.value === null ? '—' : `${num(cell.low, 4)} – ${num(cell.high, 4)}`}
                    </td>
                    <td style={{ color: cell.warning ? theme.color.error : undefined }}>
                      {cell.warning}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SidebarSection>
  );
}
