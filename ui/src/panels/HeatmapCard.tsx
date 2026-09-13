import { theme } from '../theme.js';
import { heatmapGridLine } from '../../../engine/heatmapRun.js';

/**
 * The heatmap's GRID DEFINITION - a fold-down on the calibration card (v2.2).
 *
 * ⚑⚑ WHERE THIS LIVES IS THE POINT. It was a sidebar card holding both the
 * inputs AND the extracted cells; David: *"where we assign columns and rows, I
 * think we need to have another fold down point on the calibration card, like
 * we did for bars… Because it is part of setting up the data definition /
 * calibration. NOT outputs."* So the counts, the boundaries and the names sit
 * with the calibration that defines them, and the cells went to the Cells panel
 * where every other type's output already is - the split the rail fold-out
 * redesign settled and marked LOCKED, which this card had quietly broken.
 *
 * ⚑ EVERY DECISION IS IN `engine/heatmapRun.ts`; this file is a button, two
 * number boxes and a table. That is the split the v2.1 work settled on, and the
 * reason is instrument reach: mutation testing cannot see `ui/` at all, and the
 * only other thing that can is an 18-minute Electron run.
 *
 * ⚑ THE STATUS LINE IS NOT DECORATION. In a heatmap the colour IS the value, so
 * a wrong cell has no other symptom - nothing missing, nothing misplaced, no
 * refusal. The whole apparatus underneath measures whether each cell can vouch
 * for itself; if that never reached the screen it would have been for nothing.
 * So the summary says how many need a look, and every flagged cell says why in
 * its own row.
 */

export interface HeatmapCardProps {
  /** Columns and rows the user says the figure has - a CHECK on detection, never
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
  /** Add a boundary on one axis - it lands in the middle of the widest cell,
   * which is where a boundary detection missed almost always belongs. */
  onAddColumnBoundary: () => void;
  onAddRowBoundary: () => void;
  /** The boundary whose handle the user clicked on the figure, in the figure's
   * own units - null when none is picked. */
  selectedBoundary: { axis: 'x' | 'y'; value: number } | null;
  onRemoveBoundary: () => void;
  /** False when removing it would leave the axis with no cell at all; the button
   * stays visible and says why, rather than the refusal arriving on click. */
  canRemoveBoundary: boolean;
  /** What the figure PRINTS along each axis, comma separated, as typed. Blank
   * means the axis is a value axis and its coordinates are the numbers. */
  /** Arm the label reader for one of the two axes. */
  onReadNames?: (axis: 'x' | 'y') => void;
  /** Which axis the armed reader is waiting for, or null. */
  readingNames?: 'x' | 'y' | null;
  /**
   * Which axes can hold names at all.
   *
   * ⚑⚑ ONLY A NAMED AXIS TAKES NAMES, and the reader has to say so where it is
   * offered. David, 2026-09-13, on being shown a mixed figure whose columns
   * had no name editor while the button to read column names sat there anyway:
   * *"this has to be the only option, no?"* It is - a band on a value axis is
   * identified by its measured coordinate, so reading a name for it would
   * record something the figure did not use to identify it, and the button
   * would have nowhere to put what it read. Greyed rather than hidden, exactly
   * as the tick convention row is, so the card says one thing consistently.
   */
  xIsNamed?: boolean;
  yIsNamed?: boolean;
  /** Blur handler: a text edit becomes one undo entry when it ENDS, never one
   * per keystroke - the same rule every other text field here follows. */
  /** "3 of 5 named", or a warning that there are more names than cells. Empty
   * before anything has been typed. */
  xLabelCoverage: string;
  yLabelCoverage: string;

  /**
   * What a count or convention change would cost, and any disagreement the grid
   * already has with the declared counts (C3/C4). Null when there is nothing to
   * say - the bar chart's rule, written on its own `regenerateWarning`: a
   * warning that appears when nothing would be discarded teaches the user to
   * ignore it.
   */
  regenerateWarning: string | null;
  /** What the CALIBRATION declared, so the line under the summary can say
   * whether the grid actually came from it (v2.3, E6). */
  declared: { columns: number; rows: number };
  /** Detection's own report - agreement, a miss, or why nothing could be read.
   *
   * ⚑ THERE IS NO `summary` PROP. The read's own summary - "20 cells read; 3
   * need a look" - is a statement about the RECORD and renders beside it in the
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
  onAddColumnBoundary,
  onAddRowBoundary,
  selectedBoundary,
  onRemoveBoundary,
  canRemoveBoundary,
  onReadNames,
  readingNames = null,
  xIsNamed = false,
  yIsNamed = false,
  xLabelCoverage,
  yLabelCoverage,
  regenerateWarning,
  declared,
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
            never asked - so the panel asked again, and the two answers could
            disagree. The declaration is shown here, never re-collected. */}
        <span data-testid="heatmap-declared-grid" style={{ color: theme.color.text.secondary }}>
          {heatmapGridLine(gridSize, declared)}
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" data-testid="heatmap-detect" onClick={onDetect} disabled={!canRead}>
            Detect grid
          </button>
          {/* ⚑⚑ ASKED FOR, NEVER ASSERTED. An even lattice used to appear the
              moment a count was known - geometry we invented, drawn as
              confidently as one read off the figure, and visibly wrong on any
              figure whose columns are unequal. David: *"it will look like we
              have gotten it wrong every single time. We show it AFTER."*
              ⚑ It still has to be REACHABLE, because a continuous field draws no
              boundaries to detect and a sampling lattice is the honest answer
              there - so it becomes a button the user presses, and the message it
              leaves says the boundaries are not measured. */}
          <button
            type="button"
            data-testid="heatmap-overlay-even"
            onClick={onOverlayEvenGrid}
            disabled={!canRead}
            title="Lay an evenly spaced grid over the plot - for a continuous field with no drawn cells. These boundaries are chosen, not measured."
          >
            Overlay even grid
          </button>
        </div>
        {/* ⚑⚑ READ CELLS IS NOT HERE ANY MORE - it lives on the Grid summary
            line, outside this fold-out, and there is only ONE of it.
            ⚑ It moved out because the flow had no visible next step: everything
            on screen said READY while the action that finishes the job sat
            inside a closed fold-out inside a closed card (David: *"that is a UI
            design fault"*). It is not ALSO here because, with the card open,
            two identical teal buttons sat eighty pixels apart - David: *"we now
            still have the old red cells button there too. I think that old one
            should go."*
            ⚠️ AND MY ARGUMENT FOR KEEPING BOTH WAS WRONG. I cited `Reset to key`,
            which is offered on the picked-cell line AND in the right-click menu.
            That precedent does not apply: those two are never on screen at the
            same time, and one of them is undiscoverable. These were both visible
            at once, in one card. **The same action in two places is justified by
            two different MOMENTS or SURFACES, never by two positions in one
            view** - otherwise it is just the second-mechanism smell again.
            ⚑ The ENDING survives the move: pressing it still folds the card, so
            the eye goes to the Cells panel where the record now is. */}
        {/* ⚑⚑ THE HAND `detectGrid` KEEPS TELLING THE USER TO USE. When detection
            finds every rule the figure draws but one, it refuses to fill the miss
            in and says "place the missing ones by hand" - and until now there was
            no gesture that could. A message naming an action the interface does
            not offer is the keystone-persona failure, not a wording problem.
            ⚑ Buttons rather than a canvas gesture: a boundary added by clicking
            the figure would be invisible machinery, and a heatmap's canvas is the
            one surface where clicks mean nothing else. */}
        {gridSize && (
          <>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                data-testid="heatmap-add-column"
                onClick={onAddColumnBoundary}
                title="Adds a boundary in the widest cell. Drag a handle beside the figure to move one; click a handle to remove it."
              >
                + Column boundary
              </button>
              <button
                type="button"
                data-testid="heatmap-add-row"
                onClick={onAddRowBoundary}
                title="Adds a boundary in the tallest cell. Drag a handle beside the figure to move one; click a handle to remove it."
              >
                + Row boundary
              </button>
            </div>
            {selectedBoundary && (
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
                      : 'An axis keeps its last two boundaries - one cell is still a grid'
                  }
                >
                  Remove
                </button>
              </div>
            )}
            {/* ⚑⚑ "THE LABEL IS THE COORDINATE." A heatmap's axes are each
                independently a CATEGORY or a VALUE, and all four combinations are
                published - gene × sample, treatment × time, field × field. On a
                named axis the printed name is what identifies the cell, and an
                export reading `1, 2, 3` for it cannot be rejoined to anything the
                reader has. Typing what the figure prints is RECORDING, the same
                act as typing a calibration tick's value; what would be
                interpretation is inventing a name nobody printed, and nothing
                here does that - an unnamed cell keeps its measured coordinates. */}
            {/* ⚑ "Column NAMES", not "Columns": the card already has a Columns
                box holding a COUNT, and two fields with the same word in one
                panel is a question the user has to answer by experiment. Found
                by reading a screenshot of the finished card. */}
            {/* ⚑⚑ READ THEM, OR TYPE THEM WHERE THEY ARE SHOWN - the same two
                ways every other category type offers. David, 2026-09-13:
                *"asking for an order name list and NOT offering an OCR
                functionality is wrong"*, and *"the order list input should go
                completely... we do not use it for the other category graphs"*.

                ⚑⚑ THE COMMA LIST WAS A PARALLEL MECHANISM, which is why the
                reader never reached it. A bar chart's names live on its category
                axis, are read off the figure by the reader, and are corrected
                one at a time in the table. The heatmap had a second way of doing
                the same job - two strings with their own parser, formatter and
                coverage readout - so the reader, which lands names on
                CATEGORIES, had nothing to land on. Removing it is the reuse
                rule, not a simplification: the per-name half already existed in
                `HeatmapCellsTable`, whose own comment calls it "the same gesture
                the bar chart's table uses".

                ⚑ One button per axis, because a figure names its columns and
                its rows in two different places and a single box could not say
                which one it was about to read. */}
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                data-testid="heatmap-read-x-names"
                onClick={() => onReadNames?.('x')}
                disabled={!onReadNames || !xIsNamed}
                title={xIsNamed ? undefined : 'The X axis is a value axis - its columns are identified by their coordinates'}
                style={{ flex: 1 }}
              >
                {readingNames === 'x' ? 'Drag a box round the column labels...' : 'Read column names'}
              </button>
              <button
                type="button"
                data-testid="heatmap-read-y-names"
                onClick={() => onReadNames?.('y')}
                disabled={!onReadNames || !yIsNamed}
                title={yIsNamed ? undefined : 'The Y axis is a value axis - its rows are identified by their coordinates'}
                style={{ flex: 1 }}
              >
                {readingNames === 'y' ? 'Drag a box round the row labels...' : 'Read row names'}
              </button>
            </div>
            <span style={{ color: theme.color.text.secondary }}>
              {xIsNamed || yIsNamed
                ? 'Or click a name in the Cells table to type it.'
                : 'Both axes are value axes, so their cells are identified by their coordinates.'}
            </span>
            {(xLabelCoverage || yLabelCoverage) && (
              <span data-testid="heatmap-label-coverage" style={{ color: theme.color.text.secondary }}>
                {[xLabelCoverage && `Columns: ${xLabelCoverage}`, yLabelCoverage && `Rows: ${yLabelCoverage}`]
                  .filter(Boolean)
                  .join('. ')}
              </span>
            )}
          </>
        )}
        {/* ⚑ Above the error, and in a quieter colour: this is a CAUTION about
            something that has not happened yet (or a disagreement to resolve),
            not a refusal of something attempted. Colouring it like a refusal
            would spend the error colour on a state that is still fine. */}
        {regenerateWarning && (
          <span data-testid="heatmap-regenerate-warning" style={{ color: theme.color.text.secondary }}>
            {regenerateWarning}
          </span>
        )}
        {error && (
          <span data-testid="heatmap-error" style={{ color: theme.color.error }}>
            {error}
          </span>
        )}
    </div>
  );
}
