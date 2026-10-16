import React from 'react';
import { theme } from '../theme.js';
import type { AxesFromLabels, AxisFromLabels } from '../../../engine/labelCalibration.js';

/**
 * v2.7 V5-V11: what was read from a drawn figure's tick labels, OFFERED in the
 * calibration card. Nothing reaches the calibration until Apply, as with the
 * OCR offer window (OcrReviewCard): the read is shown, the user looks at it
 * against the figure, where each label is drawn joined to its own tick mark,
 * and only then fills the walk with it (V6).
 */
export interface LabelAxesOfferProps {
  read: AxesFromLabels;
  onApply: () => void;
  onCancel: () => void;
}

const name = (a: AxisFromLabels) => a.axis.toUpperCase();

/** "X: 0, 20, 40, 60, 80, 100" or "Y: 10^1 … 10^4, log". */
function axisLine(a: AxisFromLabels & { ok: true }): string {
  const labels = a.pairs.map((p) => p.label);
  const shown = labels.length > 8 ? `${labels.slice(0, 3).join(', ')} … ${labels[labels.length - 1]}` : labels.join(', ');
  return `${name(a)}: ${shown}${a.log ? ', log' : ''}`;
}

/** "7.3 has no tick mark at it; 8 tick marks have no label". */
function unusedLine(a: AxisFromLabels): string | null {
  const labels = a.unused.filter((u) => u.label !== null).map((u) => `${u.label} has ${u.reason === 'no tick mark at it' ? 'no tick mark at it' : u.reason}`);
  const bare = a.unused.filter((u) => u.label === null).length;
  const parts = [...labels, ...(bare ? [`${bare} tick mark${bare === 1 ? ' has' : 's have'} no label`] : [])];
  return parts.length ? `Not used on ${name(a)}: ${parts.join('; ')}.` : null;
}

export function LabelAxesOffer({ read, onApply, onCancel }: LabelAxesOfferProps): React.ReactElement {
  const axes = [read.x, read.y];
  const small = { fontSize: theme.font.size.small, color: theme.color.text.secondary } as const;
  const ok = axes.filter((a): a is AxisFromLabels & { ok: true } => a.ok);
  return (
    <div data-testid="label-axes-offer" style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
      {axes.map((a) => (
        <span key={a.axis} data-testid={`label-axes-${a.axis}`} style={{ color: a.ok ? theme.color.text.primary : theme.color.error }}>
          {a.ok ? axisLine(a) : `${name(a)} could not be read: ${a.reason}.`}
        </span>
      ))}
      {ok.length > 0 && (
        <span data-testid="label-axes-precision" style={small}>
          {/* V11: the labels' rounding, not the drawing, limits the scale */}
          To the printed digits: {ok.map((a) => `${a.precision} on ${name(a)}`).join(', ')}.
        </span>
      )}
      {axes.map((a) => {
        const line = unusedLine(a);
        return line ? (
          <span key={`u-${a.axis}`} data-testid={`label-axes-unused-${a.axis}`} style={small}>
            {line}
          </span>
        ) : null;
      })}
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          data-testid="label-axes-apply"
          onClick={onApply}
          disabled={!read.points}
          title={read.points ? 'Fill X1, X2, Y1 and Y2 with these ticks and values' : 'Both axes must be read to fill the calibration'}
          style={{ fontSize: 12 }}
        >
          Apply
        </button>
        <button type="button" data-testid="label-axes-cancel" onClick={onCancel} style={{ fontSize: 12 }}>
          Cancel
        </button>
        {!read.points && <span style={small}>Both axes must be read to fill the calibration; calibrate by hand instead.</span>}
      </span>
    </div>
  );
}
