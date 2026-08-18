import { theme } from '../theme.js';
import { FloatingPanel } from '../FloatingPanel.js';
import { CurveFitIcon } from '../icons.js';
import type { CurveFitModelId } from '../../../engine/curveFitPanel.js';
import { CURVE_FIT_MAX_DEGREE } from '../../../algorithms/curveFit.js';
import { FIT_MODELS } from '../../../algorithms/nonlinearFit.js';

/**
 * The Curve Fit rail fold-out - INPUTS only (v1.1 step 2): Model · Degree ·
 * Restrict · Fit · Clear. The RESULT (equation, R², RMS, n) lives in
 * `panels/CurveFitCard.tsx`, in the sidebar.
 *
 * ⚑ The width cap on the model `<select>` is load-bearing, not styling: a
 * `<select>` sizes itself to its WIDEST option, and each option carries its own
 * form (`y = a·e^(b·x)`) so the list can be read rather than recognised. Left
 * uncapped, that made this fold-out wide enough to cover the figure it floats
 * over. The chosen form is repeated below the row, so the cap hides nothing.
 */

export interface CurveFitFlyoutProps {
  /** This graph type supports fitting at all. */
  visible: boolean;
  /** Disabled until there are axes to fit against. */
  disabled: boolean;
  model: CurveFitModelId;
  onModelChange: (model: CurveFitModelId) => void;
  degree: number;
  onDegreeChange: (degree: number) => void;
  restrict: boolean;
  onRestrictChange: (restrict: boolean) => void;
  xMin: string;
  onXMinChange: (value: string) => void;
  xMax: string;
  onXMaxChange: (value: string) => void;
  error: string | null;
  /** A fit already exists for this series, so Clear has work to do. */
  hasFit: boolean;
  onRun: () => void;
  onClear: () => void;
  onOpenChange: (open: boolean) => void;
}

export function CurveFitFlyout({
  visible,
  disabled,
  model,
  onModelChange,
  degree,
  onDegreeChange,
  restrict,
  onRestrictChange,
  xMin,
  onXMinChange,
  xMax,
  onXMaxChange,
  error,
  hasFit,
  onRun,
  onClear,
  onOpenChange,
}: CurveFitFlyoutProps) {
  if (!visible) return null;
  return (
    <FloatingPanel
      placement="rail"
      label="Curve Fit"
      icon={<CurveFitIcon />}
      testId="curve-fit"
      shortcut="8"
      disabled={disabled}
      onOpenChange={onOpenChange}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* The SHAPE comes first, because it decides whether Degree means anything. */}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Model
          <select
            data-testid="curve-fit-model"
            value={model}
            onChange={(e) => onModelChange(e.target.value as CurveFitModelId)}
            style={{ maxWidth: 120 }}
          >
            <option value="polynomial">Polynomial</option>
            {FIT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} - {m.form}
              </option>
            ))}
          </select>
        </label>
        {/* Degree belongs to the polynomial alone. Showing it greyed for the
            others would imply it still applies to them. */}
        {model === 'polynomial' && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Degree
            <select data-testid="curve-fit-degree" value={degree} onChange={(e) => onDegreeChange(Number(e.target.value))}>
              {Array.from({ length: CURVE_FIT_MAX_DEGREE }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            data-testid="curve-fit-restrict"
            checked={restrict}
            onChange={(e) => onRestrictChange(e.target.checked)}
          />
          Restrict
        </label>
        <button type="button" data-testid="curve-fit-run" onClick={onRun}>
          Fit
        </button>
        <button type="button" data-testid="curve-fit-clear" onClick={onClear} disabled={!hasFit}>
          Clear
        </button>
      </div>
      {/* The chosen model's form, spelled out - what makes the width cap free. */}
      {model !== 'polynomial' && (
        <div
          data-testid="curve-fit-model-form"
          style={{ marginTop: 4, fontSize: theme.font.size.small, color: theme.color.text.secondary }}
        >
          {FIT_MODELS.find((m) => m.id === model)?.form}
        </div>
      )}
      {restrict && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: theme.font.size.small, color: theme.color.text.secondary }}>
          X min
          <input type="number" data-testid="curve-fit-xmin" value={xMin} onChange={(e) => onXMinChange(e.target.value)} style={{ width: 70 }} />
          X max
          <input type="number" data-testid="curve-fit-xmax" value={xMax} onChange={(e) => onXMaxChange(e.target.value)} style={{ width: 70 }} />
        </div>
      )}
      {error && (
        <p data-testid="curve-fit-error" style={{ color: theme.color.error, marginBottom: 0 }}>
          {error}
        </p>
      )}
    </FloatingPanel>
  );
}
