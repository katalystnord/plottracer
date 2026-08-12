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
  /** Add a boundary on one axis — it lands in the middle of the widest cell,
   * which is where a boundary detection missed almost always belongs. */
  onAddColumnBoundary: () => void;
  onAddRowBoundary: () => void;
  /** The boundary whose handle the user clicked on the figure, in the figure's
   * own units — null when none is picked. */
  selectedBoundary: { axis: 'x' | 'y'; value: number } | null;
  onRemoveBoundary: () => void;
  /** False when removing it would leave the axis with no cell at all; the button
   * stays visible and says why, rather than the refusal arriving on click. */
  canRemoveBoundary: boolean;
  /** What the figure PRINTS along each axis, comma separated, as typed. Blank
   * means the axis is a value axis and its coordinates are the numbers. */
  xLabels: string;
  yLabels: string;
  onLabelsChange: (xLabels: string, yLabels: string) => void;
  /** "3 of 5 named", or a warning that there are more names than cells. Empty
   * before anything has been typed. */
  xLabelCoverage: string;
  yLabelCoverage: string;
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
  onAddColumnBoundary,
  onAddRowBoundary,
  selectedBoundary,
  onRemoveBoundary,
  canRemoveBoundary,
  xLabels,
  yLabels,
  onLabelsChange,
  xLabelCoverage,
  yLabelCoverage,
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
        {/* ⚑⚑ THE HAND `detectGrid` KEEPS TELLING THE USER TO USE. When detection
            finds every rule the figure draws but one, it refuses to fill the miss
            in and says "place the missing ones by hand" — and until now there was
            no gesture that could. A message naming an action the interface does
            not offer is the keystone-persona failure, not a wording problem.
            ⚑ Buttons rather than a canvas gesture: a boundary added by clicking
            the figure would be invisible machinery, and a heatmap's canvas is the
            one surface where clicks mean nothing else. */}
        {gridSize && (
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" data-testid="heatmap-add-column" onClick={onAddColumnBoundary}>
                + Column boundary
              </button>
              <button type="button" data-testid="heatmap-add-row" onClick={onAddRowBoundary}>
                + Row boundary
              </button>
            </div>
            {selectedBoundary ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span data-testid="heatmap-selected-boundary" style={{ color: theme.color.text.secondary }}>
                  {selectedBoundary.axis === 'x' ? 'Column' : 'Row'} boundary at{' '}
                  {selectedBoundary.axis === 'x' ? 'x' : 'y'} = {selectedBoundary.value.toPrecision(4)}
                </span>
                <button
                  type="button"
                  data-testid="heatmap-remove-boundary"
                  onClick={onRemoveBoundary}
                  disabled={!canRemoveBoundary}
                  title={
                    canRemoveBoundary
                      ? 'Remove this boundary and merge the two cells it separates'
                      : 'An axis keeps its last two boundaries — one cell is still a grid'
                  }
                >
                  Remove
                </button>
              </div>
            ) : (
              <span style={{ color: theme.color.text.legend }}>
                Drag a handle beside the figure to move a boundary; click one to remove it.
              </span>
            )}
            {/* ⚑⚑ "THE LABEL IS THE COORDINATE." A heatmap's axes are each
                independently a CATEGORY or a VALUE, and all four combinations are
                published — gene × sample, treatment × time, field × field. On a
                named axis the printed name is what identifies the cell, and an
                export reading `1, 2, 3` for it cannot be rejoined to anything the
                reader has. Typing what the figure prints is RECORDING, the same
                act as typing a calibration tick's value; what would be
                interpretation is inventing a name nobody printed, and nothing
                here does that — an unnamed cell keeps its measured coordinates. */}
            {/* ⚑ "Column NAMES", not "Columns": the card already has a Columns
                box holding a COUNT, and two fields with the same word in one
                panel is a question the user has to answer by experiment. Found
                by reading a screenshot of the finished card. */}
            <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ minWidth: 84 }}>Column names</span>
              <input
                data-testid="heatmap-x-labels"
                value={xLabels}
                onChange={(e) => onLabelsChange(e.target.value, yLabels)}
                placeholder="names, comma separated"
                style={{ flex: 1, minWidth: 0 }}
              />
            </label>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ minWidth: 84 }}>Row names</span>
              <input
                data-testid="heatmap-y-labels"
                value={yLabels}
                onChange={(e) => onLabelsChange(xLabels, e.target.value)}
                placeholder="names, comma separated"
                style={{ flex: 1, minWidth: 0 }}
              />
            </label>
            {xLabelCoverage || yLabelCoverage ? (
              <span data-testid="heatmap-label-coverage" style={{ color: theme.color.text.secondary }}>
                {[xLabelCoverage && `Columns: ${xLabelCoverage}`, yLabelCoverage && `Rows: ${yLabelCoverage}`]
                  .filter(Boolean)
                  .join('. ')}
              </span>
            ) : (
              <span style={{ color: theme.color.text.legend }}>
                Name the columns and rows if the figure prints names rather than numbers — they
                travel with the values into the export.
              </span>
            )}
          </>
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
                    {/* ⚑ The name where the figure prints one, the measured
                        centre where it does not. Only the TABLE chooses: the
                        export carries both, because the bounds stay true
                        whatever the axis is called. */}
                    <td style={{ paddingRight: 8 }}>{cell.xLabel || num(cell.xCentre, 4)}</td>
                    <td style={{ paddingRight: 8 }}>{cell.yLabel || num(cell.yCentre, 4)}</td>
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
