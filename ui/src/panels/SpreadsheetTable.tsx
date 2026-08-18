import { theme } from '../theme.js';
import { fmtValue, rgbToHex } from '../format.js';
import { isDerivedAt, isCellEditable, type SpreadsheetSeries } from '../../../engine/spreadsheetModel.js';
import { formatDateNumber } from '../../../core/dateConversion.js';
import type { ReactNode } from 'react';

export interface SpreadsheetTableProps {
  series: readonly SpreadsheetSeries[];
  /** Rows are RAGGED — row i is the i-th point of each series, blank where short. */
  maxRows: number;
  /** How many value columns this graph type has (XY: 2, Bar: 1, Ternary: 3, …). */
  dataDim: number;
  axesKind: string;
  showCategoryColumn: boolean;
  valueLabels: readonly string[];
  /** Per-column date format, where an axis is date-calibrated. */
  dateFormats: readonly (string | null | undefined)[];
  mode: string;
  activePointIndex: number | null;
  selectedPointIndices: readonly number[];
  /** The ACTIVE series' ROW count — rows past it are other series' points. */
  activeSeriesPointCount: number;
  /** Select one point (null clears). Sets both the active and picked point. */
  onSelectPoint: (index: number | null) => void;
  onSelectMarquee: (indices: number[]) => void;
  onSetPointLabel: (index: number, label: string) => void;
  onCommitPendingEdit: () => void;
  renderValue: (index: number, dim: number, value: number) => ReactNode;
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
 * edit, pointing at the anchors — which ARE editable, and which the curve
 * follows. A derived row is not selectable either: selecting it made it the
 * nudge/Del target, so an italic read-only row could still be moved with an
 * arrow key.
 */
export function SpreadsheetTable({
  series,
  maxRows,
  dataDim,
  axesKind,
  showCategoryColumn,
  valueLabels,
  dateFormats,
  mode,
  activePointIndex,
  selectedPointIndices,
  activeSeriesPointCount,
  onSelectPoint,
  onSelectMarquee,
  onSetPointLabel,
  onCommitPendingEdit,
  renderValue,
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
                // (David spotted it on screen 2026-08-03 — the e2e asserts values
                // and counts, not alignment, so nothing else could have).
                colSpan={
                  (s.deltas.length > 0 ? 1 : dataDim) +
                  (showCategoryColumn ? 1 : 0) +
                  // ⚑ The error columns are the series' OWN columns, so the name
                  // above them has to span them too — the same off-by-one-column
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
                // by ROW INDEX — which implied a pairing the model did not hold
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
            // is no longer its i-th pixel — and every outward call here takes a
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
            const rowBg = isActive ? '#dff0f2' : undefined; // opaque light teal for the selected point's row
            // A ragged multi-series table can render rows past the ACTIVE
            // series' point count; in Select mode only a real active-series
            // point is selectable (the marquee only ever holds those too).
            // ⚑ A DERIVED row is not selectable. Selecting it made it the
            // nudge/Del target, so an italic read-only row could still be
            // moved with an arrow key or deleted -- the v1.3 gate's way
            // around the read-only cells. A derived sample has no
            // independent existence: the next anchor move rebuilds it.
            const isDerivedRow = isDerivedAt(activeSeries?.roles ?? [], i);
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
                  // This series' pixel for this row — what an edit or a rename
                  // addresses. Only the active series is editable, so this and
                  // `activeRowPixel` agree wherever it is used; named per series
                  // so it cannot quietly become the wrong one.
                  const rowPixel = s.pixelIndices[i] ?? -1;
                  // The category cell: a text input on the ACTIVE series
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
                          <input
                            data-testid={`category-${s.index}-${i}`}
                            value={s.labels[i] ?? ''}
                            placeholder="name…"
                            onChange={(e) => onSetPointLabel(rowPixel, e.target.value)}
                            onBlur={onCommitPendingEdit}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: 90, fontSize: 12.5 }}
                          />
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
                  const editable = isCellEditable(axesKind, s.active, derived);
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
                          data-testid={derived ? `derived-cell-${s.index}-${i}-${d}` : undefined}
                          title={derived ? 'Derived by the spline from your guide points — move an anchor to change it' : undefined}
                          style={{
                            padding: '1px 8px',
                            borderLeft: d === 0 && !showCategoryColumn ? `1px solid ${theme.color.border.regular}` : 'none',
                            fontVariantNumeric: 'tabular-nums',
                            ...(derived ? { color: theme.color.text.legend, fontStyle: 'italic' } : {}),
                          }}
                        >
                          {data
                            ? dateFmt != null
                              ? // Date-calibrated column: show the formatted date, like the
                                // export (not editable inline -- move the point on canvas).
                                formatDateNumber(data[d]!, dateFmt)
                              : editable
                              ? renderValue(rowPixel, d, data[d]!)
                              : fmtValue(data[d]!)
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
                    // ⚑ Blank, never 0, where a side was never captured — a one
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
