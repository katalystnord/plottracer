import { theme } from '../theme.js';
import { CATEGORY_TICK_COLOR } from '../../../engine/categoryTickOverlay.js';
import { fmtValue, rgbToHex } from '../format.js';
import { isDerivedAt, isCellEditable, type SpreadsheetSeries } from '../../../engine/spreadsheetModel.js';
import { formatDateNumber } from '../../../core/dateConversion.js';
import { valueText } from './ValueMark.js';
import type { ReactNode } from 'react';

export interface SpreadsheetTableProps {
  series: readonly SpreadsheetSeries[];
  /** Rows are RAGGED - row i is the i-th point of each series, blank where short. */
  maxRows: number;
  /** How many value columns this graph type has (XY: 2, Bar: 1, Ternary: 3, …). */
  dataDim: number;
  axesKind: string;
  /** The type's own output panel, or undefined for the value spreadsheet -
   *  half of "does this type edit values in a table" (see `editsValuesInTable`). */
  outputPanel: string | undefined;
  showCategoryColumn: boolean;
  /** Whether the active series has SLOTS - a tuple table, not a value table.
   *  ⚑ Passed explicitly rather than inferred from `showCategoryColumn`: the two
   *  happen to agree on bar-kind today, and two meanings for one flag is a
   *  defect waiting for the first type where they differ (`setDataPointValue`'s
   *  `dim` argument records the same lesson). */
  hasSlots: boolean;
  valueLabels: readonly string[];
  /** Per-column date format, where an axis is date-calibrated. */
  dateFormats: readonly (string | null | undefined)[];
  mode: string;
  activePointIndex: number | null;
  selectedPointIndices: readonly number[];
  /** The ACTIVE series' ROW count - rows past it are other series' points. */
  activeSeriesPointCount: number;
  /**
   * Select one point (null clears). Sets both the active and picked point.
   *
   * ⚑⚑ IT TAKES THE SERIES TOO (v2.3, A2). A cell already knows which series it
   * belongs to; the selection used to throw that away and re-derive the series
   * from the dropdown, so clicking a value in one column ringed a point in
   * another. `seriesIndex` omitted means "the one already active", which is what
   * a canvas click and a keyboard step mean.
   */
  onSelectPoint: (index: number | null, seriesIndex?: number) => void;
  /**
   * ⚑⚑ IT CARRIES THE SERIES for the same reason `onSelectPoint` does (A2). The
   * marquee set is interpreted against the ACTIVE series by everything that
   * reads it - the canvas ring, arrow-nudge, Del - so a marquee holding another
   * series' indices deletes and moves the wrong points, silently, because the
   * ring lands on a real point either way.
   */
  onSelectMarquee: (indices: number[], seriesIndex?: number) => void;
  /** ⚑ `supplied` rides with the value because the CELL decides how it reads,
   * editable or not (A4): the same number wears the same brackets in every
   * column of the table, not only in the series that happens to be active. */
  renderValue: (index: number, dim: number, value: number, supplied: boolean) => ReactNode;
  /**
   * The Category cell of the ACTIVE series - the same `EditableName` every other
   * output panel names its rows with.
   *
   * ⚑⚑ IT USED TO BE A PERMANENT `<input>`, and it was the LAST one (v2.3
   * re-audit, F28). David, 2026-07-27, on the spider table: *"now a user thinks
   * he HAS to add something"* - a boxed field on an optional name is a demand,
   * not an offer, and `EditableCell`'s own header has recorded that ever since.
   * The fix reached Spider, then Bar, then Pie and Box Plot; categorical Line is
   * the one type that still reaches this cell, so it kept the box and, with it,
   * the second convention: everywhere else one click SELECTS the row and a
   * double click EDITS, while here a click landed in a text field and selected
   * nothing (A3, David: *"One click == Select, double click == edit value"*).
   */
  renderCategoryName: (pointIndex: number, name: string, testId: string) => ReactNode;
  noPointsHint: string;
}

/**
 * The adaptive multi-series spreadsheet (checkpoint 57): every series side by
 * side, one column set per series. Rows are ragged; pixel columns are dropped
 * by design. The active series' cells stay click-to-edit; others are read-only.
 *
 * ⚑ A spline-DERIVED sample is not the user's number to type over: the next
 * rebuild regenerates it from the anchors, so an edit there looked like it took
 * and was silently wiped (v0.6 audit). It reads muted + italic and refuses the
 * edit, pointing at the anchors - which ARE editable, and which the curve
 * follows. A derived row is not selectable either: selecting it made it the
 * nudge/Del target, so an italic read-only row could still be moved with an
 * arrow key.
 */
/**
 * ⚑⚑ THE SAME PICK THE HEATMAP DRAWS, not a second thing that means the same.
 *
 * David: *"We ALWAYS need to aim for consistency... Even better when two things
 * can mirror each other in a visual way. Makes it absolutely clear what is
 * referring to what."* The heatmap already marks a picked cell with this outline
 * in this purple, and the canvas draws the same, so "picked" looks like "picked"
 * everywhere without anyone being told.
 *
 * ⚑ A tint was tried first and could not be seen: the ROW is already tinted, so
 * a slightly darker tint on one cell reads as the same colour. An outline is a
 * different CHANNEL, which is what makes it legible on top of a highlight.
 *
 * ⚑ Drawn INSIDE the cell's own box (`outlineOffset: -2`), the heatmap's own
 * note, and A5's rule once more: picking a cell must not move any other.
 */
const PICKED_OUTLINE = `2px solid ${CATEGORY_TICK_COLOR}`;
const PICKED_OUTLINE_OFFSET = -2;

/** Did the user supply this cell's number, rather than us reading it off the
 * pixel? Asked of the CELL - its own series, its own row, its own dimension -
 * which is the A2 rule the selection had to learn the hard way. */
function isSupplied(s: SpreadsheetSeries, row: number, dim: number): boolean {
  return (s.supplied[row] ?? []).includes(dim);
}

export function SpreadsheetTable({
  series,
  maxRows,
  dataDim,
  axesKind,
  outputPanel,
  showCategoryColumn,
  hasSlots,
  valueLabels,
  dateFormats,
  mode,
  activePointIndex,
  selectedPointIndices,
  activeSeriesPointCount,
  onSelectPoint,
  onSelectMarquee,
  renderValue,
  renderCategoryName,
  noPointsHint,
}: SpreadsheetTableProps) {
  // The series a row's selection, nudging and editing act on. Every one of
  // those takes a pixel index of the ACTIVE series, so the row needs it by name
  // rather than by position.
  const activeSeries = series.find((s) => s.active);
  return (
    <div
      data-testid="data-spreadsheet"
      style={{ maxHeight: 360, overflow: 'auto', border: `1px solid ${theme.color.border.regular}`, borderRadius: 6 }}
    >
      <table data-testid="points-table" style={{ borderCollapse: 'collapse', fontSize: 12.5, whiteSpace: 'nowrap' }}>
        <thead>
          <tr>
            <th
              rowSpan={2}
              style={{ position: 'sticky', left: 0, top: 0, zIndex: 3, background: theme.color.background.panel, textAlign: 'right', padding: '3px 8px', color: theme.color.text.legend }}
            >
              #
            </th>
            {series.map((s) => (
              <th
                key={s.index}
                // ⚑ An error-cap series renders ONE column (its Δ), not dataDim.
                // Hardcoding dataDim here spanned the name across two columns
                // while the body filled one, skewing every column to its right
                // (David spotted it on screen 2026-08-03 - the e2e asserts values
                // and counts, not alignment, so nothing else could have).
                colSpan={
                  (s.deltas.length > 0 ? 1 : dataDim) +
                  (showCategoryColumn ? 1 : 0) +
                  // ⚑ The error columns are the series' OWN columns, so the name
                  // above them has to span them too - the same off-by-one-column
                  // skew the Δ column caused when its colSpan was hardcoded.
                  s.errorColumns.length
                }
                data-testid={`series-col-${s.index}`}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  background: theme.color.background.panel,
                  textAlign: 'left',
                  padding: '3px 8px',
                  borderLeft: `1px solid ${theme.color.border.regular}`,
                  fontWeight: 600,
                  color: s.active ? theme.color.primary.main : theme.color.text.primary,
                }}
              >
                <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: rgbToHex(s.color), marginRight: 5, verticalAlign: 'middle' }} />
                {s.name}
              </th>
            ))}
          </tr>
          <tr>
            {series.map((s) => {
              const headCell = (key: string, label: string, first: boolean) => (
                <th
                  key={key}
                  style={{
                    position: 'sticky',
                    top: 24,
                    zIndex: 1,
                    background: theme.color.background.panel,
                    textAlign: 'left',
                    padding: '2px 8px',
                    color: theme.color.text.legend,
                    fontWeight: 500,
                    borderLeft: first ? `1px solid ${theme.color.border.regular}` : 'none',
                  }}
                >
                  {label}
                </th>
              );
              // Category leads the series' columns: an independent variable
              // comes before the dependent one. ⚑ This claimed to match "the
              // export's own Label-first convention" while the CATEGORICAL
              // export actually appended Category last -- screen and file
              // disagreed on order until David caught it (2026-07-26). Both
              // are now Position, Category, Value.
              // ⚑ An ERROR-CAP series gets ONE column, not X/Y. Its x is the
              // datum's x by construction (the cap is axis-locked to its own
              // bar), so printing x per cap repeats the same number down three
              // columns, and the cap's absolute y is not what anyone reads --
              // asked what you would need to REDRAW the figure, the answer is
              // x, y, -delta, +delta (David, 2026-08-03). matplotlib's yerr and
              // Excel's error bars take deltas outright; ggplot's ymin/ymax are
              // one subtraction away. None of them take the cap's x.
              const isErrorCap = s.deltas.length > 0;
              return [
                ...(showCategoryColumn ? [headCell(`${s.index}-cat`, 'Category', true)] : []),
                ...(isErrorCap
                  ? [headCell(`${s.index}-delta`, 'Δ', !showCategoryColumn)]
                  : valueLabels.map((label, d) =>
                      headCell(`${s.index}-${d}`, label, d === 0 && !showCategoryColumn)
                    )),
                // ⚑⚑ AFTER the series' own value columns, under the word the
                // user gave the error ('SD upper'). The old table stacked
                // `SD upper` and `SD lower` as SERIES beside the data, aligned
                // by ROW INDEX - which implied a pairing the model did not hold
                // and showed point 1's caps against the datum at x = 10. A
                // column on the datum's own row is the same fact, drawn true.
                ...s.errorColumns.map((c) => headCell(`${s.index}-err-${c.role}`, c.label, false)),
              ];
            })}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxRows }, (_, i) => {
            // ⚑⚑ THE ROW'S PIXEL, not the row number. A datum's caps are pixels
            // of its own series now (B4), so the i-th row of the active series
            // is no longer its i-th pixel - and every outward call here takes a
            // PIXEL index. Left as `i` it would select, nudge and delete the
            // point two along, which is a real point, so nothing would look
            // broken. `-1` for a row past this series' end, which no lookup and
            // no comparison can match.
            const activeRowPixel = activeSeries?.pixelIndices[i] ?? -1;
            // In Select mode the row must mirror the MARQUEE selection (the
            // set Del acts on), not activePointIndex (which the marquee forces
            // to null); a row-click joins that set. Everywhere else the row
            // tracks the single active point (the canvas-click counterpart).
            const isActive =
              mode === 'select'
                ? selectedPointIndices.includes(activeRowPixel)
                : activeRowPixel === activePointIndex;
            const rowBg = isActive ? theme.color.background.selectedRow : undefined; // the token every output panel's selected row uses
            // A ragged multi-series table can render rows past the ACTIVE
            // series' point count; in Select mode only a real active-series
            // point is selectable (the marquee only ever holds those too).
            // ⚑ A DERIVED row is not selectable. Selecting it made it the
            // nudge/Del target, so an italic read-only row could still be
            // moved with an arrow key or deleted -- the v1.3 gate's way
            // around the read-only cells. A derived sample has no
            // independent existence: the next anchor move rebuilds it.
            const isDerivedRow = isDerivedAt(activeSeries?.roles ?? [], i);
            // ⚑⚑ THE CELL'S OWN SERIES, not the active one (A2). David: *"We
            // need for each cell to be directly linked with its anchor... I have
            // no way of knowing what is happening when I think that I am
            // selecting the original point value."* The old link was
            // `ROW index -> active series`; it is `CELL -> (series, row)` now.
            //
            // ⚠️ It is the "picture lies" pattern: the ring landed on a REAL
            // point, so nothing looked broken - you simply could not tell that
            // the thing highlighted was not the thing you clicked.
            const selectCell = (s: SpreadsheetSeries) => {
              const pixel = s.pixelIndices[i];
              if (pixel === undefined) return;
              if (isDerivedAt(s.roles, i)) {
                onSelectPoint(null);
                onSelectMarquee([]);
                return;
              }
              if (mode === 'select') {
                // ⚑⚑ `s.index` - the CELL'S OWN SERIES, which the block comment
                // above has always claimed and only the other branch did. In
                // Select mode this passed a foreign series' pixel index into a
                // set read against the active one, so clicking a non-active
                // column and pressing Del deleted the ACTIVE series' point at
                // that index. Found by the 2026-08-29 pre-tag audit.
                if (i < s.values.length) onSelectMarquee([pixel], s.index);
                return;
              }
              onSelectPoint(pixel, s.index);
            };
            const selectRow = () => {
              // ⚑ CLEAR rather than ignore. Merely refusing the selection left
              // the PREVIOUS one active, so the arrow keys then nudged a point
              // the user was no longer looking at -- and moving an anchor
              // rebuilds the fill, so the derived row they clicked shifted
              // anyway. Same class as the v0.6 audit's lingering-selection
              // nudge. Caught by this test's own first run.
              if (isDerivedRow) {
                onSelectPoint(null);
                onSelectMarquee([]);
                return;
              }
              if (mode === 'select') {
                if (i < activeSeriesPointCount) onSelectMarquee([activeRowPixel]);
                return;
              }
              onSelectPoint(activeRowPixel < 0 ? null : activeRowPixel);
            };
            return (
              <tr key={i} data-testid={`point-row-${i}`} aria-selected={isActive} onClick={selectRow} style={{ cursor: 'pointer', background: rowBg }}>
                <td style={{ position: 'sticky', left: 0, background: rowBg ?? theme.color.background.primary, textAlign: 'right', padding: '1px 8px', color: theme.color.text.legend }}>
                  {i + 1}
                </td>
                {series.map((s) => {
                  const data = s.values[i];
                  // ⚑ The rounded twin of the row, for PRINTING. Kept separate
                  // from `data` because the editable cell seeds an editor from
                  // the raw number and the commit moves the datum (F23).
                  const shown = s.display[i];
                  // This series' pixel for this row - what an edit or a rename
                  // addresses. Only the active series is editable, so this and
                  // `activeRowPixel` agree wherever it is used; named per series
                  // so it cannot quietly become the wrong one.
                  const rowPixel = s.pixelIndices[i] ?? -1;
                  // The category cell: double-click-to-edit on the ACTIVE series
                  // (the same "you edit the series you're working on" rule
                  // the value cells follow), plain text elsewhere so a
                  // grouped chart still shows every series' names.
                  const categoryCell = showCategoryColumn ? (
                    <td
                      key={`${s.index}-cat`}
                      style={{ padding: '1px 8px', borderLeft: `1px solid ${theme.color.border.regular}` }}
                    >
                      {i < s.values.length ? (
                        s.active ? (
                          renderCategoryName(rowPixel, s.labels[i] ?? '', `category-${s.index}-${i}`)
                        ) : (
                          <span data-testid={`category-${s.index}-${i}`}>{s.labels[i] ?? ''}</span>
                        )
                      ) : (
                        ''
                      )}
                    </td>
                  ) : null;
                  // A spline-DERIVED sample is not the user's number to type over:
                  // the next rebuild regenerates it from the anchors, so an edit
                  // here looked like it took and was silently wiped (v0.6 audit).
                  // It reads muted + italic and refuses the edit, pointing at the
                  // anchors -- which ARE editable, and which the curve follows.
                  const derived = isDerivedAt(s.roles, i);
                  const editable = isCellEditable(axesKind, outputPanel, s.active, derived, hasSlots);
                  const isErrorCap = s.deltas.length > 0;
                  if (isErrorCap) {
                    const delta = s.deltas[i];
                    return [
                      ...(categoryCell ? [categoryCell] : []),
                      <td
                        key={`${s.index}-delta`}
                        data-testid={`delta-cell-${s.index}-${i}`}
                        style={{
                          padding: '1px 8px',
                          borderLeft: !showCategoryColumn ? `1px solid ${theme.color.border.regular}` : 'none',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {/* Blank, never 0, for a cap that resolves to no datum:
                            0 would read as "measured, and equal to the datum". */}
                        {delta == null ? '' : `${delta > 0 ? '+' : ''}${fmtValue(delta)}`}
                      </td>,
                    ];
                  }
                  return [
                    ...(categoryCell ? [categoryCell] : []),
                    ...valueLabels.map((_label, d) => {
                      const dateFmt = dateFormats[d];
                      return (
                        <td
                          key={`${s.index}-${d}`}
                          // ⚑ EVERY cell is addressable, not only the active
                          // series' editable ones. `data-value-*` exists solely
                          // on the active series (it is the click-to-edit span),
                          // so until now there was no way to name - or to test -
                          // a cell in any other column, which is precisely where
                          // A2's defect lived.
                          //
                          // ⚠️ ONE ATTRIBUTE, and it has to be: the first draft
                          // added `data-cell-*` above the existing derived one
                          // and JSX silently kept the LAST - which is `undefined`
                          // on an ordinary cell, so no testid rendered anywhere
                          // and the new one looked simply absent. A derived cell
                          // keeps its own name and needs no other: it cannot be
                          // selected, which is the only thing `data-cell-*` is
                          // for.
                          data-testid={
                            derived ? `derived-cell-${s.index}-${i}-${d}` : `data-cell-${s.index}-${i}-${d}`
                          }
                          // ⚑⚑ A1: THE CELL says it is selected, not just its
                          // row. A row tint alone cannot answer "which of these
                          // five columns did I click?", which is the question a
                          // multi-series table exists to raise. The row keeps its
                          // own lighter tint - it still says WHICH READING - and
                          // the cell carries the stronger one.
                          aria-selected={isActive && s.active}
                          // ⚑ A1 + A2: clicking a VALUE selects that value's own
                          // point, in that value's own series. The row keeps its
                          // handler for the gaps between columns, so clicking the
                          // row number still selects the active series' point.
                          onClick={(e) => {
                            e.stopPropagation();
                            selectCell(s);
                          }}
                          title={derived ? 'Derived by the spline from your guide points - move an anchor to change it' : undefined}
                          style={{
                            padding: '1px 8px',
                            borderLeft: d === 0 && !showCategoryColumn ? `1px solid ${theme.color.border.regular}` : 'none',
                            fontVariantNumeric: 'tabular-nums',
                            ...(isActive && s.active
                              ? { outline: PICKED_OUTLINE, outlineOffset: PICKED_OUTLINE_OFFSET }
                              : {}),
                            ...(derived ? { color: theme.color.text.legend, fontStyle: 'italic' } : {}),
                          }}
                        >
                          {data
                            ? dateFmt != null
                              ? // Date-calibrated column: show the formatted date, like the
                                // export (not editable inline -- move the point on canvas).
                                formatDateNumber(data[d]!, dateFmt)
                              : editable
                              ? renderValue(rowPixel, d, data[d]!, isSupplied(s, i, d))
                              : // ⚑ `display`, not `values`: the rounded twin, so a
                                // read-only cell prints the number the FILE has.
                                // The editable branch above still hands the
                                // EDITOR the raw value - see `SpreadsheetSeries`.
                                valueText(fmtValue(shown?.[d] ?? data[d]!), isSupplied(s, i, d))
                            : ''}
                        </td>
                      );
                    }),
                    // ⚑⚑ THE DATUM'S OWN EXTENTS, on the datum's own row. An
                    // ABSOLUTE position on the value axis, because that is what
                    // the record holds: in the delta form "no bound" and "a
                    // bound of size zero" are the same number, which is tenet
                    // 9's exact failure (docs/generator-input-formats.md). The
                    // export carries the delta alongside.
                    //
                    // ⚑ Blank, never 0, where a side was never captured - a one
                    // sided error bar is a real figure, and a printed 0 reads as
                    // a measurement that was taken and came out equal.
                    ...s.errorColumns.map((c, ei) => (
                      <td
                        key={`${s.index}-err-${c.role}`}
                        data-testid={`error-cell-${s.index}-${i}-${c.role}`}
                        style={{ padding: '1px 8px', fontVariantNumeric: 'tabular-nums' }}
                      >
                        {s.errorValues[i]?.[ei] == null ? '' : fmtValue(s.errorValues[i]![ei]!)}
                      </td>
                    )),
                  ];
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Empty-state message lives outside <tbody> so a "no data points"
          check can still count tbody rows (== points placed). */}
      {maxRows === 0 && (
        <div data-testid="no-points" style={{ padding: 8, color: theme.color.text.legend, fontSize: 12.5 }}>
          {noPointsHint}
        </div>
      )}
    </div>  );
}
