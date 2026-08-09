import { theme } from '../theme.js';
import { SidebarSection, SidebarHeading } from '../layout.js';
import { formatCurveFitEquation, type CurveFitState } from '../../../engine/curveFitPanel.js';

/**
 * The Curve fit OUTPUT card (v1.1 step 2) — the result, moved here from the
 * Curve Fit fold-out so that card holds inputs only. Bound to the active
 * series; already stored on the dataset and exported as its own derived block.
 *
 * ⚑ Two of the three lines below exist because a number LOOKED like an answer
 * when it was not — see their own comments. Both are release-gate findings, and
 * both are prose the user reads instead of a bare figure.
 */

export interface CurveFitCardProps {
  /** Null when the type has no curve fit, or none has been run. */
  state: CurveFitState | null;
  seriesName: string;
}

export function CurveFitCard({ state, seriesName }: CurveFitCardProps) {
  if (!state) return null;
  return (
    <SidebarSection>
      <SidebarHeading>Curve fit</SidebarHeading>
      <div data-testid="curve-fit-output" style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: theme.font.size.small }}>
        <span style={{ color: theme.color.text.secondary }}>{seriesName}</span>
        <code data-testid="curve-fit-equation" style={{ fontSize: theme.font.size.small, wordBreak: 'break-word' }}>{formatCurveFitEquation(state)}</code>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: theme.color.text.secondary }}>
          R² = {state.rSquared === undefined ? '—' : state.rSquared.toFixed(5)} · RMS = {state.rms.toPrecision(5)} · n = {state.n}
        </span>
        {/* ⚑ R² is undefined when the series is flat: it is the fraction of the
            data's variation that the model accounts for, and a flat series has
            none. This used to read 1.00000 -- a written-in default where the
            formula divides by zero -- so a flat baseline looked like a PERFECT
            fit, sometimes beside the red "did not settle" below. Say why it is
            blank rather than leaving a dash to be puzzled over. */}
        {state.rSquared === undefined && (
          <span data-testid="curve-fit-no-r2" style={{ color: theme.color.text.secondary }}>
            R² needs variation to measure against, and every value in this series is the same — so it has none here. Read the RMS instead: it is in the data's own units.
          </span>
        )}
        {/* ⚑ A nonlinear solver can run out of iterations and still leave a
            drawn curve behind, and a drawn curve is read as an answer. When
            it did not settle, SAY so beside the numbers rather than let the
            line speak for itself. Absent for a polynomial, which is solved
            directly and has nothing to converge. */}
        {state.converged === false && (
          <span data-testid="curve-fit-not-converged" style={{ color: theme.color.error }}>
            This fit did not settle — the curve is where the solver stopped, not a result. Try another model or a restricted x-range.
          </span>
        )}
      </div>
    </SidebarSection>
  );
}
