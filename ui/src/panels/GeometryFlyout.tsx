import { FloatingPanel } from '../FloatingPanel.js';
import { GeometryIcon } from '../icons.js';

/**
 * The Geometry rail fold-out — INPUTS only (v1.1 step 2): Closed curve ·
 * Compute · Clear.
 *
 * The RESULT (arc length, area, curvature + the per-point table) lives in
 * `panels/GeometryCard.tsx`, in the sidebar, and re-derives as the series is
 * edited. Splitting them that way is the rail redesign's own rule, and it is
 * what stops a stale number sitting in a fold-out nobody has reopened.
 */

export interface GeometryFlyoutProps {
  /** Offered only where it means something — see Workspace's own gate. */
  visible: boolean;
  /** Disabled until there are axes to measure against. */
  disabled: boolean;
  closed: boolean;
  onClosedChange: (closed: boolean) => void;
  /** Geometry is already switched on for this series, so Clear has work to do. */
  active: boolean;
  onRun: () => void;
  onClear: () => void;
  onOpenChange: (open: boolean) => void;
}

export function GeometryFlyout({
  visible,
  disabled,
  closed,
  onClosedChange,
  active,
  onRun,
  onClear,
  onOpenChange,
}: GeometryFlyoutProps) {
  if (!visible) return null;
  return (
    <FloatingPanel
      placement="rail"
      label="Geometry"
      icon={<GeometryIcon />}
      testId="geometry"
      shortcut="9"
      disabled={disabled}
      onOpenChange={onOpenChange}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input
            type="checkbox"
            data-testid="geometry-closed"
            checked={closed}
            onChange={(e) => onClosedChange(e.target.checked)}
          />
          Closed curve
        </label>
        <button type="button" data-testid="geometry-run" onClick={onRun}>
          Compute
        </button>
        <button type="button" data-testid="geometry-clear" onClick={onClear} disabled={!active}>
          Clear
        </button>
      </div>
    </FloatingPanel>
  );
}
