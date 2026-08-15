import { endsCardButton, theme } from '../theme.js';

/**
 * The heatmap's GRID DEFINITION — a fold-down on the calibration card (v2.2).
 *
 * ⚑⚑ WHERE THIS LIVES IS THE POINT. It was a sidebar card holding both the
 * inputs AND the extracted cells; David: *"where we assign columns and rows, I
 * think we need to have another fold down point on the calibration card, like
 * we did for bars… Because it is part of setting up the data definition /
 * calibration. NOT outputs."* So the counts, the boundaries and the names sit
 * with the calibration that defines them, and the cells went to the Cells panel
 * where every other type's output already is — the split the rail fold-out
 * redesign settled and marked LOCKED, which this card had quietly broken.
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
  /**
   * The count ALREADY DECLARED at calibration, per axis, or null for a value
   * axis that never declared one.
   *
   * ⚑⚑ A CATEGORY AXIS IS NOT ASKED TWICE. David: *"Why do I have to FIRST tell
   * it that there are 5 rows in the calibration, and then 5 again? That should
   * carry over."* It does now: declaring the categories IS the declaration, so
   * the box is replaced by what it already knows. Two fields for one fact is how
   * his 5 met a typo'd 6 and detection refused the whole grid.
   */
  /** How many boundaries the grid currently holds, so the user can see the grid
   * exists even before reading any cells. */
  gridSize: { columns: number; rows: number } | null;
  onDetect: () => void;
  onOverlayEvenGrid: () => void;
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
  /** Blur handler: a text edit becomes one undo entry when it ENDS, never one
   * per keystroke — the same rule every other text field here follows. */
  onCommitPendingEdit: () => void;
  /** "3 of 5 named", or a warning that there are more names than cells. Empty
   * before anything has been typed. */
  xLabelCoverage: string;
  yLabelCoverage: string;

  /** Detection's own report — agreement, a miss, or why nothing could be read.
   *
   * ⚑ THERE IS NO `summary` PROP. The read's own summary — "20 cells read; 3
   * need a look" — is a statement about the RECORD and renders beside it in the
   * Cells panel, which is also the only place it can survive: pressing Read
   * cells folds this card, so a summary rendered here would be filed away in a
   * closed fold-out at the exact moment it became true. The ERROR stays,
   * because a refusal belongs beside the button that produced it and a failed
   * read does not fold anything. */
  error: string | null;
  canRead: boolean;
}

export function HeatmapCard({
  gridSize,
  onDetect,
  onOverlayEvenGrid,
  onRead,
  onAddColumnBoundary,
  onAddRowBoundary,
  selectedBoundary,
  onRemoveBoundary,
  canRemoveBoundary,
  xLabels,
  yLabels,
  onLabelsChange,
  onCommitPendingEdit,
  xLabelCoverage,
  yLabelCoverage,
  error,
  canRead,
}: HeatmapCardProps) {
  return (
    <div
        data-testid="heatmap-card"
        style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: theme.font.size.small }}
      >
        {/* ⚑⚑ NO COUNT BOXES. How many columns and rows the figure has is
            declared ONCE, in the calibration walk, for a measured axis exactly
            as for a named one. These inputs existed because a value axis was
            never asked — so the panel asked again, and the two answers could
            disagree. The declaration is shown here, never re-collected. */}
        <span data-testid="heatmap-declared-grid" style={{ color: theme.color.text.secondary }}>
          {gridSize
            ? `${gridSize.columns} columns × ${gridSize.rows} rows, from the calibration — drag a boundary to adjust`
            : 'Calibrate the axes to see the grid.'}
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" data-testid="heatmap-detect" onClick={onDetect} disabled={!canRead}>
            Detect grid
          </button>
          {/* ⚑⚑ ASKED FOR, NEVER ASSERTED. An even lattice used to appear the
              moment a count was known — geometry we invented, drawn as
              confidently as one read off the figure, and visibly wrong on any
              figure whose columns are unequal. David: *"it will look like we
              have gotten it wrong every single time. We show it AFTER."*
              ⚑ It still has to be REACHABLE, because a continuous field draws no
              boundaries to detect and a sampling lattice is the honest answer
              there — so it becomes a button the user presses, and the message it
              leaves says the boundaries are not measured. */}
          <button
            type="button"
            data-testid="heatmap-overlay-even"
            onClick={onOverlayEvenGrid}
            disabled={!canRead}
            title="Lay an evenly spaced grid over the plot — for a continuous field with no drawn cells. These boundaries are chosen, not measured."
          >
            Overlay even grid
          </button>
        </div>
        {/* ⚑⚑ THE ENDING, AND IT LOOKS LIKE ONE. David: *"There is nothing
            intuitive here to press to say 'done!'"* — and he was right in a
            precise way: the card HAD a terminal action all along, sitting in a
            row of three identical buttons where two of them are setup. Reading
            the cells is what consumes the grid and produces the record, so it is
            the end of this card's job; it just never looked or behaved like it.
            ⚑⚑ THE MIRROR ALREADY EXISTED. The bar chart's category-ticks
            fold-out — the panel this one was modelled on — has carried a teal
            `Done` since v2.1, for the same reason recorded there: *"the only
            exits on screen were 'Re-place axis' and 'Remove ticks' — both
            destructive. The way out must never be the way to lose your work."*
            This card was in exactly that state: Detect grid and Overlay even
            grid both REGENERATE, discarding adjustments. So the same colour and
            the same shape, on the button that already did the job.
            ⚑ It FOLDS the card on success (David's call), which moves the eye to
            the Cells panel where the record now is. Nothing is lost: the folded
            line reads "Grid — 7 × 5 cells", and one click reopens it.
            ⚑ CALLED WITH NOTHING, deliberately. `onRead` takes no arguments, and
            handing it straight to onClick would pass React's mouse event into
            whatever first parameter the handler grows later — which it has: the
            read takes the user's own cell readings, and a SyntheticEvent
            arriving there would be silently treated as them. */}
        <div style={{ display: 'flex' }}>
          <button
            type="button"
            data-testid="heatmap-read"
            onClick={() => onRead()}
            disabled={!canRead}
            title="Read every cell through the colour key, and close this — the cells appear in the Cells panel"
            style={endsCardButton(canRead)}
          >
            Read cells
          </button>
        </div>
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
                onBlur={onCommitPendingEdit}
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
                onBlur={onCommitPendingEdit}
                placeholder="names, comma separated"
                style={{ flex: 1, minWidth: 0 }}
              />
            </label>
            {/* ⚑ THE CONVENTION, SAID OUT LOUD rather than left to be discovered
                from an export. It is a constant and not a computed direction
                because the mapping GUARANTEES it: `labelsForCells` measures
                which way the cell indices run and flips the typed list to suit,
                so the first name is the top-left cell on an ordinary figure, on
                one calibrated upside down, and on a rotated scan alike. */}
            <span data-testid="heatmap-label-direction" style={{ color: theme.color.text.legend }}>
              First name = the figure’s top-left cell; columns left → right, rows top → bottom.
            </span>
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
        {error && (
          <span data-testid="heatmap-error" style={{ color: theme.color.error }}>
            {error}
          </span>
        )}
    </div>
  );
}
