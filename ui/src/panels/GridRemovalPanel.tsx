import { theme } from '../theme.js';
import { FloatingPanel } from '../FloatingPanel.js';
import { GridRemovalIcon, EyedropperIcon } from '../icons.js';

/**
 * The Grid Removal fold-out — INPUTS only, like every other rail/chrome card
 * (the v1.1 rail redesign: fold-outs take settings, results go to the sidebar
 * or the canvas).
 *
 * ⚑ `close()` before arming the eyedropper. The card overlays the canvas, so
 * leaving it open would put the panel between the cursor and the gridline the
 * user has just been told to click — the same class of defect as a marker
 * eating the press it was drawn to invite.
 */

export interface GridRemovalPanelProps {
  color: string;
  onColorChange: (hex: string) => void;
  tolerance: number;
  onToleranceChange: (value: number) => void;
  error: string | null;
  onRun: () => void;
  onPickFromImage: () => void;
}

export function GridRemovalPanel({
  color,
  onColorChange,
  tolerance,
  onToleranceChange,
  error,
  onRun,
  onPickFromImage,
}: GridRemovalPanelProps) {
  return (
    <FloatingPanel label="Grid Removal" icon={<GridRemovalIcon />} testId="grid-removal">
      {(close) => (
        <>
          <p style={{ marginTop: 0, color: theme.color.text.secondary }}>
            Whites-out gridline-colored pixels so auto-tracing (Segment Fill) follows the
            data, not the grid. Pick the grid color, then Remove.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Grid color:</span>
            <span
              data-testid="grid-removal-swatch"
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                border: `1px solid ${theme.color.border.regular}`,
                background: color,
                flex: '0 0 auto',
              }}
            />
            <input
              type="text"
              data-testid="grid-removal-color"
              value={color}
              onChange={(e) => onColorChange(e.target.value)}
              spellCheck={false}
              style={{ width: 84 }}
            />
            <button
              type="button"
              data-testid="grid-removal-eyedropper"
              onClick={() => {
                close();
                onPickFromImage();
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              <EyedropperIcon />
              Pick from image
            </button>
          </div>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>Tolerance:</span>
            <input
              type="number"
              data-testid="grid-removal-tolerance"
              min={1}
              max={255}
              value={tolerance}
              onChange={(e) => onToleranceChange(Math.max(1, Math.min(255, Number(e.target.value) || 1)))}
              style={{ width: 60 }}
            />
            <button type="button" data-testid="grid-removal-run" onClick={onRun}>
              Remove grid lines
            </button>
          </p>
          {error && (
            <p data-testid="grid-removal-error" style={{ color: theme.color.error }}>
              {error}
            </p>
          )}
        </>
      )}
    </FloatingPanel>
  );
}
