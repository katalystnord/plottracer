import React from 'react';
import { theme } from '../theme.js';
import { WarningIcon } from '../icons.js';
import type { AxesFromLabels, AxisFromLabels } from '../../../engine/labelCalibration.js';

/**
 * v2.7 V5-V10: what was read from a drawn figure's tick labels, OFFERED in the
 * calibration card. Nothing reaches the calibration until Apply, as with the
 * OCR offer window (OcrReviewCard): the read is shown, the user looks at it
 * against the figure, where each label is drawn joined to its own tick mark,
 * and only then fills the walk with it (V6).
 */
export interface LabelAxesOfferProps {
  read: AxesFromLabels;
  onApply: () => void;
  onCancel: () => void;
  /** Its own Apply and Cancel; false where the card carries the action itself (the automatic
   * path's axes card, whose [Accept suggested graph axis] is this Apply). */
  actions?: boolean;
  /** 'warnings': only what the figure itself does not show, each line with a warning triangle, for
   * the bottom of the automatic path's calibration card (David, 2026-10-18: the values read are
   * printed on the graph, "printing the numbers here again is just confusing"). */
  variant?: 'offer' | 'warnings';
}

const name = (a: AxisFromLabels) => a.axis.toUpperCase();

/** "X: 0, 20, 40, 60, 80, 100" or "Y: 10^1 … 10^4, log". */
function axisLine(a: AxisFromLabels & { ok: true }): string {
  // a value the vetting corrected shows what was read too, so the correction is never silent
  const labels = a.pairs.map((p) => (p.vetted ? `${p.value} (read as "${p.vetted.read}")` : p.label));
  const shown = labels.length > 8 ? `${labels.slice(0, 3).join(', ')} … ${labels[labels.length - 1]}` : labels.join(', ');
  // read along the far edge only when it is the figure's one axis: say so
  const edge = a.side === 'top' || a.side === 'right' ? ` (the ${a.side} axis)` : '';
  return `${name(a)}: ${shown}${a.log ? ', log' : ''}${edge}`;
}

/** "7.3 has no tick mark at it; 8 tick marks have no label". */
function unusedLine(a: AxisFromLabels): string | null {
  const labels = a.unused.filter((u) => u.label !== null).map((u) => `${u.label} has ${u.reason === 'no tick mark at it' ? 'no tick mark at it' : u.reason}`);
  const bare = a.unused.filter((u) => u.label === null).length;
  const parts = [...labels, ...(bare ? [`${bare} tick mark${bare === 1 ? ' has' : 's have'} no label`] : [])];
  return parts.length ? `Not used on ${name(a)}: ${parts.join('; ')}.` : null;
}

/** Each label the vetting changed, as a sentence: what the figure shows and what was read. */
function correctedLines(a: AxisFromLabels): string[] {
  return a.pairs
    .filter((p) => p.vetted)
    .map((p) => `${name(a)}: ${p.value} was read as "${p.vetted!.read}" and corrected from ${p.vetted!.how === 'reread' ? 'another read of the label' : 'its neighbours'}.`);
}

function Warnings({ read }: { read: AxesFromLabels }): React.ReactElement | null {
  const axes = [read.x, read.y];
  const lines: { id: string; text: string }[] = [];
  for (const a of axes) {
    if (!a.ok) lines.push({ id: `label-axes-${a.axis}`, text: `${name(a)} could not be read: ${a.reason}.` });
    else {
      correctedLines(a).forEach((t, i) => lines.push({ id: `label-axes-corrected-${a.axis}-${i}`, text: t }));
      if (a.second) lines.push({ id: `label-axes-second-${a.axis}`, text: `A second ${name(a)} axis along the ${a.second} is not read; data plotted against it needs calibrating by hand.` });
    }
    const unused = unusedLine(a);
    if (unused) lines.push({ id: `label-axes-unused-${a.axis}`, text: unused });
  }
  if (lines.length === 0) return null;
  return (
    <div data-testid="label-axes-warnings" style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: theme.font.size.small, color: theme.color.text.secondary }}>
      {lines.map((l) => (
        <span key={l.id} data-testid={l.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <span style={{ color: theme.color.error, flexShrink: 0, display: 'inline-flex' }}><WarningIcon size={14} /></span>
          <span>{l.text}</span>
        </span>
      ))}
    </div>
  );
}

export function LabelAxesOffer({ read, onApply, onCancel, actions = true, variant = 'offer' }: LabelAxesOfferProps): React.ReactElement | null {
  if (variant === 'warnings') return <Warnings read={read} />;
  const axes = [read.x, read.y];
  const small = { fontSize: theme.font.size.small, color: theme.color.text.secondary } as const;
  return (
    <div data-testid="label-axes-offer" style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
      {axes.map((a) => (
        <span key={a.axis} data-testid={`label-axes-${a.axis}`} style={{ color: a.ok ? theme.color.text.primary : theme.color.error }}>
          {a.ok ? axisLine(a) : `${name(a)} could not be read: ${a.reason}.`}
        </span>
      ))}
      {axes.map((a) =>
        a.ok && a.second ? (
          <span key={`s-${a.axis}`} data-testid={`label-axes-second-${a.axis}`} style={small}>
            A second {name(a)} axis along the {a.second} is not read; data plotted against it needs calibrating by hand.
          </span>
        ) : null
      )}
      {axes.map((a) => {
        const line = unusedLine(a);
        return line ? (
          <span key={`u-${a.axis}`} data-testid={`label-axes-unused-${a.axis}`} style={small}>
            {line}
          </span>
        ) : null;
      })}
      {actions && <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
      </span>}
    </div>
  );
}
