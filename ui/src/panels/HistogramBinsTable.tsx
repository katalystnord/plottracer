import { theme } from '../theme.js';
import { fmtValue } from '../format.js';
import { TupleDeleteButton } from './TupleDeleteButton.js';

/** One captured bin, as the session reports it. */
export interface HistogramBin {
  binStart: number;
  binEnd: number;
  value: number;
}

export interface HistogramBinsTableProps {
  /** One row per bin, in capture order. */
  rows: readonly { tupleIndex: number }[];
  /**
   * The caps someone placed on these bins, from `errorColumnsFor` - the SAME
   * function the export asks (F27).
   *
   * ⚑⚑ THE ERROR TOOL IS OFFERED ON EVERY TYPE THAT HAS POINTS, histogram
   * included, and the whiskers are drawn on the canvas. This table reported the
   * interval and the magnitude alone, and so did every one of the nine export
   * formats - so a Poisson root-N bar someone had measured, and could see on
   * their own figure, existed nowhere afterwards. Row-aligned with `bins` by
   * tuple index. Absent for a series with no caps, so an ordinary histogram's
   * table is exactly what it was.
   */
  error?: { labels: readonly string[]; values: readonly (readonly (number | null)[])[] };
  /** Index-aligned with the rows. NULL where a bin is half-captured - only one
   *  corner is down, and which edge it is isn't known until the second corner
   *  decides the ordering. */
  bins: readonly (HistogramBin | null)[];
  tupleNoun: string;
  onRemoveTuple: (tupleIndex: number) => void;
  /** Select this bin, and ring it on the figure - see `TupleTable` (F30). */
  onSelectTuple: (tupleIndex: number) => void;
  /** Which bin the current selection is standing on, or null. */
  activeTupleIndex: number | null;
  /** Shown when nothing has been captured yet.
   *
   * ⚑ THIS PANEL WAS THE ONE WITHOUT ONE (F31). `noPointsHint` reaches every
   * other table - the spreadsheet, the tuple table, the bar table - and the
   * histogram's showed an empty grid with no headers explained and nothing
   * saying what to do, which is the exact first-run failure `TupleTable`'s own
   * header records having had for a whole release. */
  noPointsHint: string;
}

/**
 * The Histogram table - BINS, not the corner clicks that produced them, and the
 * same call `buildHistogramCSV` makes for export, so what is on screen is what
 * lands in the file.
 *
 * No Category column: a bin is identified by its interval, unlike a Box Plot
 * tuple which needs a name.
 */
export function HistogramBinsTable({
  rows,
  bins,
  tupleNoun,
  onRemoveTuple,
  onSelectTuple,
  activeTupleIndex,
  error,
  noPointsHint,
}: HistogramBinsTableProps) {
  const err = error?.labels.length ? error : null;
  return (
    <>
      // Bins, not the corner clicks that produced them -- the same call
      // buildHistogramCSV makes for export, so what's on screen is what
      // lands in the file. No Category column: a bin is identified by its
      // interval, unlike a Box Plot tuple which needs a name.
      <table data-testid="points-table" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingRight: 16 }}>#</th>
            <th style={{ textAlign: 'left', paddingRight: 16 }}>Bin start</th>
            <th style={{ textAlign: 'left', paddingRight: 16 }}>Bin end</th>
            <th style={{ textAlign: 'left', paddingRight: 16, color: theme.color.primary.main }}>Value</th>
            {err?.labels.map((label) => (
              <th key={label} style={{ textAlign: 'left', paddingRight: 16 }}>
                {label}
              </th>
            ))}
            <th aria-hidden />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const bin = bins[row.tupleIndex] ?? null;
            return (
              <tr
                key={row.tupleIndex}
                data-testid={`bin-row-${row.tupleIndex}`}
                aria-selected={row.tupleIndex === activeTupleIndex}
                onClick={() => onSelectTuple(row.tupleIndex)}
                style={{
                  cursor: 'pointer',
                  background:
                    row.tupleIndex === activeTupleIndex
                      ? theme.color.background.selectedRow
                      : undefined,
                }}
              >
                <td style={{ paddingRight: 16 }}>{row.tupleIndex + 1}</td>
                {/* A half-captured bin reads as "-" rather than showing its
                    one placed corner: which edge a lone click is isn't known
                    until the second corner decides the ordering, so naming it
                    "Bin start" would be a guess. The group-cursor line above
                    says which corner is next. */}
                <td style={{ paddingRight: 16 }}>{bin ? fmtValue(bin.binStart) : '-'}</td>
                <td style={{ paddingRight: 16 }}>{bin ? fmtValue(bin.binEnd) : '-'}</td>
                <td style={{ paddingRight: 16, color: theme.color.primary.main }}>
                  {bin ? fmtValue(bin.value) : '-'}
                </td>
                {/* Blank, never 0, where that side was never captured - the
                    rule the export follows in the same columns. */}
                {err?.labels.map((label, c) => (
                  <td key={label} style={{ paddingRight: 16 }}>
                    {(() => {
                      const v = err.values[row.tupleIndex]?.[c];
                      return v == null ? '' : fmtValue(v);
                    })()}
                  </td>
                ))}
                <td>
                  <TupleDeleteButton tupleIndex={row.tupleIndex} noun={tupleNoun} onDelete={onRemoveTuple} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div data-testid="no-points" style={{ padding: 8, color: theme.color.text.legend, fontSize: 12.5 }}>
          {noPointsHint}
        </div>
      )}
    </>
  );
}
