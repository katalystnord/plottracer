import React from 'react';
import { theme } from '../theme.js';
import type { LegendEntry } from '../../../engine/legendRead.js';

/**
 * The LEGEND DETECTION card (David's design, 2026-10-17): the step between the
 * calibration and the series, the same step the automated extraction takes.
 *
 *   - a foldable header, "Legend detection";
 *   - it asks the user to mark the legend, with the box Image ▸ Mask an area
 *     draws (the legend marker PlotTracer already has);
 *   - "Read legend" is greyed out until a legend is marked, then teal;
 *   - underneath, what the read found, which the user can edit;
 *   - below it, "Accept legend read".
 *
 * ⚑ THE CARD STAYS SMALL WHILE THE LEGEND IS BEING MARKED and grows only when
 * there is a read to show, so it never covers the figure the box is drawn on.
 */
export interface LegendCardProps {
  expanded: boolean;
  onToggle: () => void;
  /** The box gesture is armed: the next drag on the figure marks the legend. */
  marking: boolean;
  marked: boolean;
  entries: LegendEntry[] | null;
  busy: boolean;
  notice: string | null;
  /** How many series the accepted read named, once accepted. */
  accepted: number | null;
  onMark: () => void;
  onRead: () => void;
  onEditName: (index: number, name: string) => void;
  onAccept: () => void;
  /** The teal style the calibration card's ending buttons share. */
  endsButton: React.CSSProperties;
}

const hex = (c: readonly number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

export function LegendCard(p: LegendCardProps): React.ReactElement {
  const small = { fontSize: theme.font.size.small, color: theme.color.text.secondary } as const;
  const line = p.accepted !== null
    ? `Legend accepted: ${p.accepted} series named from it, and the legend is masked so no series tool reads it.`
    : p.marking
      ? 'Draw a box round the legend on the figure.'
      : p.marked
        ? 'Legend marked. Read it to see what it says.'
        : 'Mark the legend, so its swatches and sample lines are not read as data.';
  return (
    <div
      data-testid="legend-card"
      style={{
        background: theme.color.background.primary,
        border: `1px solid ${theme.color.border.regular}`,
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(103, 104, 132, 0.22)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '5px 10px',
        maxWidth: 420,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          data-testid="legend-fold"
          onClick={p.onToggle}
          title={p.expanded ? 'Fold the card' : 'Unfold the card'}
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontSize: 12 }}
        >
          {p.expanded ? '▾' : '▸'}
        </button>
        <strong style={{ fontSize: theme.font.size.regular }}>Legend detection</strong>
      </div>
      {p.expanded && (
        <>
          <span data-testid="legend-line" style={small}>{line}</span>
          {p.accepted === null && (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" data-testid="legend-mark" onClick={p.onMark} disabled={p.marking} style={{ fontSize: 12 }}>
                {p.marked ? 'Mark it again' : 'Mark the legend'}
              </button>
              <button
                type="button"
                data-testid="legend-read"
                onClick={p.onRead}
                disabled={!p.marked || p.busy}
                title={p.marked ? 'Read the names and colours in the marked legend' : 'Mark the legend first'}
                style={p.marked && !p.busy ? p.endsButton : { fontSize: 12 }}
              >
                {p.busy ? 'Reading…' : 'Read legend'}
              </button>
            </span>
          )}
          {p.notice && <span data-testid="legend-notice" style={small}>{p.notice}</span>}
          {p.accepted === null && p.entries && p.entries.length > 0 && (
            <>
              <div data-testid="legend-entries" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {p.entries.map((e, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span
                      data-testid={`legend-entry-colour-${i}`}
                      title={e.colour ? hex(e.colour) : 'No colour found beside this entry'}
                      style={{ width: 14, height: 14, borderRadius: 3, border: `1px solid ${theme.color.border.regular}`, background: e.colour ? hex(e.colour) : 'transparent' }}
                    />
                    <input
                      data-testid={`legend-entry-name-${i}`}
                      value={e.name}
                      onChange={(ev) => p.onEditName(i, ev.target.value)}
                      style={{ width: 200 }}
                    />
                    {e.sample && <span style={small}>{e.sample}</span>}
                  </span>
                ))}
              </div>
              <span>
                <button type="button" data-testid="legend-accept" onClick={p.onAccept} style={p.endsButton}>
                  Accept legend read
                </button>
              </span>
            </>
          )}
        </>
      )}
    </div>
  );
}
