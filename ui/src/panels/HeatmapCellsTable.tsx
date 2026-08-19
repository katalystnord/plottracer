import { useEffect, useRef, useState, type ReactNode } from 'react';
import { theme, withAlpha } from '../theme.js';
import { CATEGORY_TICK_COLOR } from '../../../engine/categoryTickOverlay.js';
import { cellKey, type HeatmapRow } from '../../../engine/heatmapRun.js';
import { textOn } from '../contrast.js';
import { valueText as sharedValueText, suppliedBySource } from './ValueMark.js';

/**
 * A heatmap's cells, IN THE DATA POINTS PANEL - the same place every other
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
 * heatmap the colour IS the value, so a wrong cell has no other symptom - the
 * interval it cannot be told apart from and the note saying what is off about it
 * are not decoration, they are the only way to know which numbers to trust.
 *
 * ⚑⚑ AND IT OPENS AS A MATRIX, because that is what a heatmap is. David: *"You
 * are presenting a matrix as a table in the results, and that is just a mess.
 * There is no way anyone could see the categories belonging where. We should
 * have two buttons to say present results as a [matrix] [table]."* Twenty-five
 * rows of `x, y, value` is the tidy/long form - correct, exportable, and
 * unreadable against the figure. The matrix puts each value where the figure put
 * it with the names down the edges; the long form is one click away and is the
 * only view with room for the evidence.
 *
 * ⚑ Both are the same record - the matrix is the long form pivoted, and the
 * names come from the same per-band lists - so switching view cannot change a
 * number or move a name, and a name typed in either applies to the whole band.
 */

export interface HeatmapCellsTableProps {
  cells: HeatmapRow[];
  /** Shown when there are no cells yet - the heatmap's own "no points" hint. */
  noCellsHint: string;
  /**
   * Click-to-edit the CATEGORY name, per axis - the same gesture the bar
   * chart's Category column has had since v2.0.
   *
   * ⚑⚑ A NAME IS THE ONE THING IN THIS TABLE THE FIGURE DOES NOT MEASURE, so it
   * is the one thing that must be correctable in place. Every other column is
   * read off the pixels; the names are transcribed by a person, and a person
   * mistypes. Bulk entry stays in the grid fold-down (twelve gene names in one
   * field), and this is how you fix the one that is wrong.
   *
   * ⚑ Editing ANY cell of a column edits the COLUMN - the name belongs to the
   * band, not to the cell - which is exactly what the bar table does when
   * naming a category shared by several series.
   */
  renderXName?: (bandIndex: number, name: string, ordinal: number, copy?: string) => ReactNode;
  renderYName?: (bandIndex: number, name: string, ordinal: number, copy?: string) => ReactNode;
  /**
   * The cell picked on the figure or here - the two are one selection.
   *
   * ⚑ A heatmap's cells have no markers on the canvas, so until now nothing tied
   * a row of the results to the square it was read from. David: *"if you are on
   * a square in the matrix, it is highlighted in the heatmap?"* It works both
   * ways round, which is what every other type already does between its table
   * and its markers.
   */
  selectedCell?: { col: number; row: number } | null;
  /** Every picked cell, as `col,row` keys - the app's own selection model,
   * which data points have used since v1.2. */
  selectedCells?: ReadonlySet<string>;
  /** Pick these keys; `additive` is Shift held. A header hands its whole band. */
  onPickCells?: (keys: readonly string[], additive: boolean) => void;
  /**
   * Click-to-edit the cell's VALUE - the typed twin of reading it off the key.
   *
   * ⚑⚑ WE ARE NEVER THE ONLY INSTRUMENT LOOKING AT THE FIGURE. David: *"there
   * might be something in the color/patern/shape that a user can see and we
   * can't."* A hatched cell, an asterisk over the fill, a printed label bleeding
   * into the colour, a texture the modal sampler averages away - their eye is
   * the better instrument for all of those, and often the only one that can
   * tell. So this is not interpretation getting past tenet 9; it is a reading
   * taken with a better instrument, recorded exactly the way ours is.
   *
   * ⚑ The caller is handed the DISPLAY STRING this table would have printed, so
   * the brackets round a user's value are decided in one place whether or not
   * the cell is editable.
   */
  renderValue?: (cell: HeatmapRow, display: string) => ReactNode;
  /**
   * Right-click a cell: which instrument's reading to use (B16).
   *
   * ⚑ Right-click ALONE would be undiscoverable, which is why the cell already
   * SHOWS its source - tinted for the colour, bracketed for a person. The menu
   * CHANGES the source; it does not reveal it.
   */
  onCellContextMenu?: (col: number, row: number, clientX: number, clientY: number) => void;
  /**
   * The ink under the colour key's cursor while it is being dragged.
   *
   * ⚑ A PREVIEW, not a reading: it shows what colour the position you are
   * dragging to is worth, so you can drag until it matches the cell in the
   * figure. That is the eye used as the instrument B7 says it is - comparing two
   * colours, which people are good at, instead of estimating a number off a
   * ramp, which they are not.
   * ⚠️ It must not survive the drag: at rest a tint means "read from the colour"
   * (B16), and a cell a person set wears no tint and square brackets instead.
   */
  dragTint?: { col: number; row: number; rgb: readonly [number, number, number] } | null;
  /**
   * Hand this cell back to the colour key.
   *
   * ⚑ The context menu can already do it, and right-click is undiscoverable -
   * which is exactly what B16 warned about. On the picked-cell line it mirrors
   * the Grid card's picked BOUNDARY row, which has carried its Remove button
   * beside it all along: the thing you picked, said plainly, with its action
   * attached.
   */
  onResetCell?: (col: number, row: number) => void;
}

const num = (v: number | null, digits = 4): string => (v === null ? '-' : v.toPrecision(digits));

export function HeatmapCellsTable({
  cells,
  noCellsHint,
  renderXName,
  renderYName,
  selectedCell,
  selectedCells,
  onPickCells,
  renderValue,
  onCellContextMenu,
  dragTint,
  onResetCell,
}: HeatmapCellsTableProps) {
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
          renderValue={renderValue}
          onCellContextMenu={onCellContextMenu}
          dragTint={dragTint}
        />
      ) : (
        <LongView
          cells={cells}
          renderXName={renderXName}
          renderYName={renderYName}
          selectedCell={selectedCell}
          selectedCells={selectedCells}
          onPickCells={onPickCells}
          renderValue={renderValue}
          onCellContextMenu={onCellContextMenu}
          dragTint={dragTint}
        />
      )}
      {/* ⚑⚑ BELOW THE GRID, AND THAT IS THE WHOLE POINT (v2.3). It sat ABOVE,
          and it renders nothing until a cell is picked - so the first click
          INSERTED a row and pushed the matrix down 27px, moving the cell out
          from under the cursor. David, driving the built app: *"The cell jumps
          around when you try to select it."* Worse than untidy: the second click
          of a double-click then lands on the row below, so the gesture that
          opens the editor could open the wrong cell.
          ⚑ A5's rule, one panel over: entering a state must not move anything
          the user is not interacting with - and here it moved the very thing
          they were. Reserving space above was the other candidate and is worse:
          the line wraps at a narrow panel width, so its height is not a constant
          to reserve. Below the grid, nothing above it can move at all. */}
      <PickedCell cells={cells} selectedCell={selectedCell} renderValue={renderValue} onResetCell={onResetCell} />
    </div>
  );
}

type ViewProps = Pick<
  HeatmapCellsTableProps,
  | 'cells'
  | 'renderXName'
  | 'renderYName'
  | 'selectedCell'
  | 'selectedCells'
  | 'onPickCells'
  | 'renderValue'
  | 'onCellContextMenu'
  | 'dragTint'
>;

/** The pick, as an OUTLINE. Same purple and same mechanism the canvas draws, so
 * the two are visibly one thing. */
const PICKED_OUTLINE = `2px solid ${CATEGORY_TICK_COLOR}`;
/** Drawn INSIDE the cell's own box, so picking one cannot move any other. */
const PICKED_OUTLINE_OFFSET = -2;

/** A row highlight for the long view, where the row is not itself tinted - the
 * value cell there paints its own opaque fill, so nothing mirrored is covered. */
const PICKED_BACKGROUND = withAlpha(CATEGORY_TICK_COLOR, 0.18);

/**
 * The colour a cell is painted - a RENDERING of its number, at full strength.
 *
 * ⚑⚑ ABSOLUTE MIRRORING. David, 2026-08-15: *"We need to have absolute MIRRORING
 * of the colour between the heatmap, the draggable colour key, and the output
 * matrix. That is the ground truth."*
 *
 * ⚠️ THIS REPLACES TWO EARLIER RULES AT ONCE, and both replacements are his.
 *   1. It is `keyRgb` - the key's ink at the cell's position - NOT the sampled
 *      pixel. *"The colour we show is only its REPRESENTATION… that is WHY it is
 *      important that the colour follows the value, not the other way around."*
 *      So a cell a person read is painted too, because the colour is a function
 *      of the number and the number changed; provenance rides in the
 *      `[brackets]` and the export's own column, where it always did.
 *   2. It is FULL STRENGTH. The old `alpha 0.35` over white turned viridis's
 *      darkest purple `rgb(68,1,84)` into a pale lavender `rgb(190,166,195)` -
 *      David: *"They do not look like the same colours to my eyes on this
 *      screen."* He was right, and the wash existed only as a workaround for
 *      the missing half of B16 (text contrast), which is now built.
 */
function tintOf(
  cell: { col: number; row: number; keyRgb?: readonly [number, number, number] } | undefined,
  dragTint?: HeatmapCellsTableProps['dragTint']
): readonly [number, number, number] | undefined {
  // ⚑ THE PREVIEW WINS WHILE IT LASTS. Dragging the key's cursor shows the ink
  // it is sitting on, so the cell can be matched against the figure by eye. It
  // is the ACTUAL pixel under the cursor rather than a rendering, because the
  // whole point of the gesture is to compare the figure with the key.
  if (cell && dragTint && dragTint.col === cell.col && dragTint.row === cell.row) {
    return dragTint.rgb;
  }
  return cell?.keyRgb;
}

const cssRgb = (rgb: readonly [number, number, number]) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

/**
 * How a tinted cell's text is coloured: from its FILL, never from a token.
 *
 * ⚑ The half of B16 that was recorded and never built - *"cell text contrast
 * must follow the fill, or half the matrix is unreadable on a dark palette"* -
 * and its absence is the whole reason the tint was weakened into something that
 * no longer matched the figure. David settled it: *"we can have white text when
 * needed too."* `textOn` picks whichever of black and white contrasts better,
 * and a test sweeps the entire RGB cube to show that the winner always clears
 * the WCAG AA floor, which is what makes a full-strength fill safe at all.
 *
 * ⚑⚑ A FLAGGED CELL KEEPS ITS FLAG WITHOUT FIGHTING THE FILL. Red text was
 * legible on a pale wash and is not legible on viridis, so the flag moves into
 * the same channel as the value: a trailing DAGGER, drawn in the ink that is
 * legible by construction. Same reasoning the `[brackets]` already carry in this
 * file - a mark made of TEXT survives every background, and a copy-paste.
 * ⚠️ Deliberately NOT an asterisk: real heatmaps print asterisks over their own
 * cells for significance, and a mark of ours that collides with one of theirs is
 * worse than no mark.
 */
const FLAGGED_MARK = '†';


/**
 * How a value reads, given which instrument read it.
 *
 * ⚑⚑ THE MARK IS THE APP'S, NOT THE HEATMAP'S (v2.3, A4). The convention was
 * written here first, for the one type that had a second instrument; every
 * other type acquired one the moment a value could be typed. It lives in
 * `ValueMark.tsx` now, with its reasoning - a second panel reinventing the same
 * bracket is exactly what the reuse rule exists to stop.
 */
function valueText(display: string, source?: string): string {
  return sharedValueText(display, suppliedBySource(source));
}

/**
 * The cell in hand: all THREE of its coordinates, and its value editable.
 *
 * ⚑⚑ THE THIRD AXIS IS AN AXIS, so a picked cell that showed its column and its
 * row and stopped was showing two coordinates out of three. A heatmap is 2.5D:
 * where it sits on the COLOUR KEY is a coordinate exactly as x and y are, and it
 * is the one the whole figure exists to convey.
 *
 * ⚑ IT MIRRORS THE PICKED BOUNDARY on the Grid card - "Column boundary at x =
 * 3.5" beside the one thing you can do to it. Same shape here: the thing you
 * picked, said plainly, with its action attached. Nothing new to learn, and it
 * is the VISIBLE way to correct a cell from the matrix, where the cell itself
 * cannot carry the gesture.
 */
function PickedCell({
  cells,
  selectedCell,
  renderValue,
  onResetCell,
}: Pick<HeatmapCellsTableProps, 'cells' | 'selectedCell' | 'renderValue' | 'onResetCell'>) {
  if (!selectedCell) return null;
  const cell = cells.find((c) => c.col === selectedCell.col && c.row === selectedCell.row);
  if (!cell) return null;
  const band = (label: string, name: string, lo: number, hi: number) =>
    `${label}${name ? ` “${name}”` : ''} (${num(lo, 3)} – ${num(hi, 3)})`;
  return (
    <p
      data-testid="heatmap-picked-cell"
      style={{
        margin: '6px 0 0',
        fontSize: theme.font.size.small,
        color: theme.color.text.secondary,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
      }}
    >
      <span>
        {band(`C${cell.col + 1}`, cell.xLabel, cell.xMin, cell.xMax)}
        {' × '}
        {band(`R${cell.row + 1}`, cell.yLabel, cell.yMin, cell.yMax)}
      </span>
      <span style={{ color: theme.color.text.primary }}>
        value{' '}
        {renderValue
          ? renderValue(cell, valueText(num(cell.value, 5), cell.source))
          : valueText(num(cell.value, 5), cell.source)}
      </span>
      {/* ⚑ ONLY WHERE THERE IS SOMETHING TO UNDO. A cell read from the colour has
          nothing to reset, and a control that is always there and usually inert
          teaches people to stop reading it - the same rule the bar chart's
          regenerate warning states about itself. The brackets already say the
          value is a person's, so the button appearing beside them is a
          consequence of something visible, not a hidden precondition.
          ⚑ THE SAME WORDS as the right-click entry, so the two obviously do one
          thing rather than looking like two features. */}
      {cell.source === 'user' && onResetCell && (
        <button
          type="button"
          data-testid="heatmap-reset-cell"
          onClick={() => onResetCell(cell.col, cell.row)}
          title="Discard this reading and take the number the colour key gives"
          style={{ fontSize: theme.font.size.small, padding: '0 6px', cursor: 'pointer' }}
        >
          Reset to key
        </button>
      )}
    </p>
  );
}

/** The value as the two views print it: editable where the caller supplies an
 * editor, plain text where it does not - decided once, so the matrix and the
 * long form can never disagree about how a number reads. */
function valueCell(cell: HeatmapRow, renderValue: HeatmapCellsTableProps['renderValue']): ReactNode {
  const display = valueText(num(cell.value, 5), cell.source);
  return renderValue ? renderValue(cell, display) : display;
}

/**
 * A container that SAYS when it is hiding something sideways (B17).
 *
 * ⚑ David, photographing the tint: the matrix scrolled horizontally with a
 * fifth column off-screen in a narrow sidebar, and nothing said so. A table
 * that silently ends mid-record is worse than a narrow one - the columns you
 * cannot see look like columns that do not exist, and this panel IS the record.
 *
 * ⚑ MEASURED, not assumed. Whether it overflows depends on the sidebar's width,
 * the number of columns and the font, none of which this component gets to know
 * - so it reads `scrollWidth` against `clientWidth` and re-reads on resize.
 * Guessing from the column count would be wrong at both ends: five narrow
 * columns fit, three wide ones may not.
 */
function ScrollNoticer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();
    // ⚑ ResizeObserver rather than a window listener: the sidebar can change
    // width without the window doing so (a fold-out opening beside it), and
    // that is exactly when a matrix starts and stops overflowing.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);
  return (
    <>
      <div ref={ref} style={{ maxHeight: 320, overflow: 'auto' }}>
        {children}
      </div>
      {clipped && (
        <p
          data-testid="heatmap-scroll-notice"
          style={{ margin: '2px 0 0', color: theme.color.text.legend, fontSize: theme.font.size.small }}
        >
          More columns to the right - scroll sideways.
        </p>
      )}
    </>
  );
}

/**
 * The figure's own shape: one cell per cell, names down the edges.
 *
 * ⚑⚑ ROWS RUN TOP-DOWN, which is the whole point of this view. Cell row 0 is
 * `yMin` - the BOTTOM of the plot - so rendering rows in index order would print
 * the matrix upside down against the figure it came from, and "which category
 * belongs where" would be exactly as unanswerable as it was in the long form.
 */
function MatrixView({
  cells,
  renderXName,
  renderYName,
  selectedCells,
  onPickCells,
  onCellContextMenu,
  dragTint,
}: ViewProps) {
  // ⚑ THE MODEL'S OWN KEY FORMAT, not a fourth copy of it. A pick, a user's
  // reading and this table must all name a cell the same way or they silently
  // stop referring to the same cell.
  const picked = (col: number, row: number) => selectedCells?.has(cellKey(col, row)) === true;
  const columns = [...new Set(cells.map((c) => c.col))].sort((a, b) => a - b);
  const rows = [...new Set(cells.map((c) => c.row))].sort((a, b) => b - a);
  const byKey = new Map(cells.map((c) => [cellKey(c.col, c.row), c]));
  return (
    <ScrollNoticer>
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
                  onClick={(e) => onPickCells?.(rows.map((r) => cellKey(col, r)), e.shiftKey)}
                  title="Click to select this whole column - Shift to add it to the picked cells"
                  style={{
                    padding: '0 8px',
                    fontWeight: 700,
                    textAlign: 'left',
                    cursor: onPickCells ? 'pointer' : undefined,
                    // ⚑ A band shows as picked only when ALL of it is, so a
                    // partial range never looks like a whole column.
                    // ⚑ The same outline the cells use, so a picked column and a
                    // picked cell are visibly the same gesture.
                    outline: rows.every((r) => picked(col, r)) ? PICKED_OUTLINE : undefined,
                    outlineOffset: PICKED_OUTLINE_OFFSET,
                  }}
                >
                  {/* ⚑⚑ THE HEADER IS THE COLUMN'S IDENTITY, not a coordinate.
                      It used to show the CENTRE - `0.9994`, `3.496` - which is a
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
                  onClick={(e) => onPickCells?.(columns.map((c) => cellKey(c, row)), e.shiftKey)}
                  title="Click to select this whole row - Shift to add it to the picked cells"
                  style={{
                    textAlign: 'left',
                    paddingRight: 8,
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                    cursor: onPickCells ? 'pointer' : undefined,
                    outline: columns.every((c) => picked(c, row)) ? PICKED_OUTLINE : undefined,
                    outlineOffset: PICKED_OUTLINE_OFFSET,
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
                  const cell = byKey.get(cellKey(col, row));
                  const isPicked = picked(col, row);
                  const fill = tintOf(cell, dragTint);
                  return (
                    <td
                      key={col}
                      data-testid={`heatmap-matrix-cell-${col}-${row}`}
                      onClick={(e) => onPickCells?.([cellKey(col, row)], e.shiftKey)}
                      onContextMenu={(e) => {
                        if (!cell || !onCellContextMenu) return;
                        e.preventDefault();
                        onCellContextMenu(col, row, e.clientX, e.clientY);
                      }}
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
                        // ⚑⚑ THE CELL IS THE FIGURE'S COLOUR, FULL STRENGTH.
                        backgroundColor: fill ? cssRgb(fill) : undefined,
                        // ⚑⚑ AND THE PICK IS AN OUTLINE, NOT A WASH - the same
                        // mechanism the canvas draws, and for the same reason it
                        // has to be: a translucent highlight OVER the cell means
                        // a picked cell is no longer the figure's colour, so the
                        // one cell you are inspecting is the one that stops
                        // mirroring. Inset, so picking cannot move anything.
                        outline: isPicked ? PICKED_OUTLINE : undefined,
                        outlineOffset: isPicked ? PICKED_OUTLINE_OFFSET : undefined,
                        // ⚑ The fill decides the ink. Only an UNTINTED cell can
                        // fall back to the error token - on a painted one, red
                        // is illegible and the dagger carries the flag instead.
                        color: fill ? textOn(fill) : cell?.warning ? theme.color.error : undefined,
                      }}
                    >
                      {/* ⚑⚑ NOT EDITABLE HERE, and that is a decision rather
                          than an omission. In this view the cell IS the value,
                          so "click to select" and "click to edit" are the same
                          click - the trap that has bitten twice already, where a
                          thing drawn on the target eats the press. Worse, an
                          editor seeded with the current number commits it on
                          blur, so a glance at a cell stamped it as user-read.
                          ⚑ The value is edited where it has a COLUMN OF ITS OWN
                          - the picked-cell line above and the Table view - which
                          is the shape the XY spreadsheet has always used. */}
                      {cell ? valueText(num(cell.value, 5), cell.source) : ''}
                      {cell?.warning ? FLAGGED_MARK : ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollNoticer>
  );
}

/** One row per cell - the tidy/long form, and the only view with room for the
 * evidence that says whether to trust a value. */
function LongView({
  cells,
  renderXName,
  renderYName,
  selectedCells,
  onPickCells,
  renderValue,
  onCellContextMenu,
  dragTint,
}: ViewProps) {
  // ⚑ THE MODEL'S OWN KEY FORMAT, not a fourth copy of it. A pick, a user's
  // reading and this table must all name a cell the same way or they silently
  // stop referring to the same cell.
  const picked = (col: number, row: number) => selectedCells?.has(cellKey(col, row)) === true;
  return (
    <ScrollNoticer>
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
            {/* ⚑⚑ IDENTITY BEFORE COORDINATE. David: *"the table format needs
                C1, R1 markings also, else it is really difficult to read."* The
                x and y columns are COORDINATES - a centre, or a name - so
                nothing on a row said WHICH CELL it was, and the reader had to do
                arithmetic to match a row to the matrix or the figure.
                ⚑ THE SAME TOKENS the rest of the app uses: the matrix heads its
                columns `C4`, and the picked-cell line reads
                `C4 (6.00 – 8.99) × R4 (4.01 – 6.00)`. This view was the only one
                staying silent, so it was harder to read than the matrix AND less
                complete than the file we write from the same data.
                ⚑ Coordinates do NOT replace identity: `C4` is what the cell IS,
                `6.00 – 8.99` is where it sits. The matrix header shows both,
                stacked - this shows both, side by side. */}
            <th style={{ paddingRight: 8 }}>column</th>
            <th style={{ paddingRight: 8 }}>row</th>
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
              onClick={(e) => onPickCells?.([cellKey(cell.col, cell.row)], e.shiftKey)}
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
              <td style={{ paddingRight: 8, fontWeight: 600 }}>{`C${cell.col + 1}`}</td>
              <td style={{ paddingRight: 8, fontWeight: 600 }}>{`R${cell.row + 1}`}</td>
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
                data-testid={`heatmap-long-value-${cell.col}-${cell.row}`}
                onContextMenu={(e) => {
                  if (!onCellContextMenu) return;
                  e.preventDefault();
                  onCellContextMenu(cell.col, cell.row, e.clientX, e.clientY);
                }}
                style={{
                  paddingRight: 8,
                  // ⚑ The long form mirrors the matrix, which mirrors the figure
                  // - same function of the same number, so all three agree.
                  ...(() => {
                    const fill = tintOf(cell, dragTint);
                    return fill ? { backgroundColor: cssRgb(fill), color: textOn(fill) } : {};
                  })(),
                }}
              >
                {valueCell(cell, renderValue)}
              </td>
              {/* ⚑ A DASH, not a bracketed pair, for a value a person read: the
                  interval is what the COLOUR could not be told apart from, and a
                  reading by eye has none. Printing `59 – 59` would dress a bare
                  number as a measured interval. */}
              <td style={{ paddingRight: 8, color: theme.color.text.legend }}>
                {cell.low === null || cell.high === null
                  ? '-'
                  : `${num(cell.low, 4)} – ${num(cell.high, 4)}`}
              </td>
              <td style={{ color: cell.warning ? theme.color.error : undefined }}>{cell.warning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollNoticer>
  );
}
