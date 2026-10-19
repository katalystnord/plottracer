import React from 'react';
import { theme } from '../theme.js';
import { WarningIcon } from '../icons.js';

/**
 * ⚑⚑ ONE LOOK FOR "THIS CANNOT GO ON": the warning triangle and the sentence (David, 2026-10-19: "triangle
 * everywhere it applies like this... Consistency and predictability is paramount"). Every message that
 * says something could not be read, was not done, or stops the walk is drawn by this, at the card's
 * own text size, so it reads the same wherever it appears.
 */
export function WarningLine({ id, text, size = 'small' }: { id: string; text: React.ReactNode; size?: 'small' | 'regular' }): React.ReactElement {
  const fontSize = size === 'regular' ? theme.font.size.regular : theme.font.size.small;
  return (
    <span data-testid={id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize, color: theme.color.text.secondary }}>
      <span style={{ color: theme.color.error, flexShrink: 0, display: 'inline-flex' }}><WarningIcon size={size === 'regular' ? 16 : 14} /></span>
      <span>{text}</span>
    </span>
  );
}

/** Several of them, stacked: the bottom of the automatic path's calibration card (David, 2026-10-18). */
export function WarningLines({ lines, testId }: { lines: readonly { id: string; text: string }[]; testId: string }): React.ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {lines.map((l) => <WarningLine key={l.id} id={l.id} text={l.text} />)}
    </div>
  );
}
