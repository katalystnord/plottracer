import { theme } from '../theme.js';
import { SidebarSection, SidebarHeading } from '../layout.js';
import type { GeometryResult } from '../../../algorithms/geometry.js';

/**
 * The Geometry OUTPUT card (v1.1 steps 2 + 4) - the derived stats, moved here
 * from the fold-out so that card holds inputs only.
 *
 * ⚑ The result is DERIVED live from the current points, not stored: editing the
 * series recomputes it, and when it cannot (points deleted below 2) the broken
 * state shows HERE as well as in the tips bar. A stale number left on screen
 * would be a measurement of a figure that no longer exists.
 */

export interface GeometryCardProps {
  /** Geometry is switched on for the active series. */
  enabled: boolean;
  /** The live result, or null when it cannot currently be computed. */
  result: GeometryResult | null;
  /** Why it cannot be computed - shown in place of the numbers. */
  error: string | null;
  seriesName: string;
  tableOpen: boolean;
  onToggleTable: () => void;
}

export function GeometryCard({ enabled, result, error, seriesName, tableOpen, onToggleTable }: GeometryCardProps) {
  if (!enabled) return null;
  return (
    <SidebarSection>
      <SidebarHeading>Geometry</SidebarHeading>
      <div data-testid="geometry-output" style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: theme.font.size.small }}>
        <span style={{ color: theme.color.text.secondary }}>{seriesName}</span>
        {result ? (
          <>
            <div data-testid="geometry-summary" style={{ fontVariantNumeric: 'tabular-nums' }}>
              Arc length = {result.arcLength.toPrecision(6)}
              <br />
              {result.areaLabel} = {result.area.toPrecision(6)}
              <br />
              Max curvature = {result.maxCurvature.value.toPrecision(6)} at point {result.maxCurvature.index + 1}
            </div>
            <button
              type="button"
              data-testid="geometry-table-toggle"
              onClick={onToggleTable}
              style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: theme.color.primary.main, textDecoration: 'underline', fontSize: theme.font.size.small }}
            >
              {tableOpen ? 'Hide per-point table' : `Per-point table (${result.perPoint.length})`}
            </button>
            {tableOpen && (
              <div style={{ maxHeight: 220, overflow: 'auto' }}>
                <table data-testid="geometry-table" style={{ borderCollapse: 'collapse', fontSize: theme.font.size.small, fontVariantNumeric: 'tabular-nums' }}>
                  <thead>
                    <tr style={{ color: theme.color.text.legend, textAlign: 'left' }}>
                      <th style={{ paddingRight: 10 }}>#</th>
                      <th style={{ paddingRight: 10 }}>x</th>
                      <th style={{ paddingRight: 10 }}>y</th>
                      <th style={{ paddingRight: 10 }}>len</th>
                      <th>κ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.perPoint.map((p, i) => (
                      <tr key={i}>
                        <td style={{ paddingRight: 10 }}>{i + 1}</td>
                        <td style={{ paddingRight: 10 }}>{p.x.toPrecision(5)}</td>
                        <td style={{ paddingRight: 10 }}>{p.y.toPrecision(5)}</td>
                        <td style={{ paddingRight: 10 }}>{p.cumulativeLength.toPrecision(5)}</td>
                        <td>{p.curvature.toPrecision(5)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <span data-testid="geometry-stale" style={{ color: theme.color.error }}>
            ⚠ Can’t compute - {error}
          </span>
        )}
      </div>
    </SidebarSection>
  );
}
