import React from 'react';
import { theme, glassSurface } from '../theme.js';

/**
 * The Legend tool's card, rail 3 (v2.7; David 2026-10-31, docs/v2.7-workflow-walk.md, The Legend tool's card). Only
 * three buttons, top to bottom: Mark legend, Auto detect legend, Mask an area. It replaces the Legend detection card,
 * and Mask an area left the Edit image card for it.
 *
 * Nothing read from the legend is shown here ("It will just confuse people"); the only thing on screen is the
 * legend's rectangle on the figure, marked or detected, masked by itself, with corners to move while this card is
 * open. A masked area is shaded in a colour of its own, apart from the legend's.
 *
 * ⚑ The card is click-THROUGH (`pointerEvents: 'none'`) and only its buttons take clicks: its whole job is a drag
 * on the figure beside and under it.
 */
export interface LegendCardProps {
  /** Which drag is armed: the next drag on the figure marks the legend, or masks an area. */
  armed: 'legend' | 'mask' | null;
  /** Auto detect legend is running. */
  detecting: boolean;
  onMarkLegend: () => void;
  onAutoDetect: () => void;
  onMaskArea: () => void;
}

export function LegendCard(p: LegendCardProps): React.ReactElement {
  const button = (testId: string, label: string, on: boolean, onClick: () => void, disabled = false) => (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      style={{
        pointerEvents: 'auto',
        fontSize: theme.font.size.small,
        padding: '4px 8px',
        borderRadius: theme.border.radius.regular,
        cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${on ? theme.color.primary.main : theme.color.border.regular}`,
        background: on ? theme.color.primary.main : theme.color.background.primary,
        color: on ? '#fff' : theme.color.text.primary,
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      data-testid="legend-card"
      style={{
        pointerEvents: 'none',
        ...glassSurface,
        border: `1px solid ${theme.color.border.regular}`,
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(103, 104, 132, 0.22)',
        padding: '8px 10px',
        width: 176,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: theme.font.size.regular,
      }}
    >
      <strong style={{ fontSize: theme.font.size.regular }}>Legend</strong>
      {button('legend-mark', 'Mark legend', p.armed === 'legend', p.onMarkLegend)}
      {button('legend-auto-detect', p.detecting ? 'Detecting…' : 'Auto detect legend', false, p.onAutoDetect, p.detecting)}
      {button('legend-mask', 'Mask an area', p.armed === 'mask', p.onMaskArea)}
    </div>
  );
}
