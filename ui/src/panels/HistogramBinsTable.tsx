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
  /** Index-aligned with the rows. NULL where a bin is half-captured - only one
   *  corner is down, and which edge it is isn't known until the second corner
   *  decides the ordering. */
  bins: readonly (HistogramBin | null)[];
  tupleNoun: string;
  onRemoveTuple: (tupleIndex: number) => void;
}

/**
 * The Histogram table - BINS, not the corner clicks that produced them, and the
 * same call `buildHistogramCSV` makes for export, so what is on screen is what
 * lands in the file.
 *
 * No Category column: a bin is identified by its interval, unlike a Box Plot
 * tuple which needs a name.
 */
export function HistogramBinsTable({ rows, bins, tupleNoun, onRemoveTuple }: HistogramBinsTableProps) {
  return (
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
            <th aria-hidden />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const bin = bins[row.tupleIndex] ?? null;
            return (
              <tr key={row.tupleIndex} data-testid={`bin-row-${row.tupleIndex}`}>
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
                <td>
                  <TupleDeleteButton tupleIndex={row.tupleIndex} noun={tupleNoun} onDelete={onRemoveTuple} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>  );
}
