import type { MouseEvent, ReactNode } from 'react';
import styled from '@emotion/styled';
import { theme } from './theme.js';

/**
 * A single icon-only toolbar button (checkpoint 24, see CLAUDE.md) --
 * every icon keeps a tooltip with its keyboard shortcut, no exceptions
 * (CLAUDE.md's "Product #1 — rebuild design"). `shortcut` renders both
 * in the native `title` tooltip and as a small always-visible badge on
 * the button itself ("Numbered single-key hotkeys visible on every tool
 * button", same doc), rather than being tooltip-only.
 *
 * Since checkpoint 33 (CSS-in-JS foundation, see CLAUDE.md and
 * project_mui_adoption_flagged.md's memory note), the button itself is a
 * real `@emotion/styled` component instead of an inline `style={{...}}`
 * object with hand-computed ternaries -- the same pattern Ketcher's own
 * toolbar `IconButton` uses (`ketcher-react/src/components/Buttons/
 * IconButton/styles.ts`: a plain `<button>` wrapped with `styled()`, not
 * MUI's own `IconButton` component -- see that memory note for why this
 * checkpoint deliberately doesn't reach for `@mui/material` here). Real
 * `:hover`/`:disabled` pseudo-selectors replace what used to be only a
 * pressed/unpressed ternary with no hover treatment at all -- a genuine
 * small improvement this conversion enables, not scope creep: Ketcher's
 * own equivalent has a hover state too.
 */
export interface IconButtonProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  /** Receives the click event so a trigger can anchor a popover to itself
   * (the rail Curve Fit / Geometry fly-outs, v0.8). Callers that don't need it
   * can still pass a zero-arg handler -- it's assignable. */
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  testId: string;
}

// `shouldForwardProp` keeps `pressed` out of the DOM -- it's not a real
// <button> attribute, unlike `disabled`, which passes through untouched
// and drives the native `:disabled` pseudo-selector below directly.
const StyledButton = styled('button', {
  shouldForwardProp: (prop) => prop !== 'pressed',
})<{ pressed?: boolean }>(({ pressed }) => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  padding: 0,
  border: `1px solid ${pressed ? theme.color.primary.main : theme.color.border.regular}`,
  borderRadius: theme.border.radius.regular,
  background: pressed ? theme.color.primary.clicked : theme.color.background.panel,
  color: pressed ? theme.color.background.primary : theme.color.icon.active,
  cursor: 'pointer',

  ':hover': {
    background: pressed ? theme.color.primary.hover : theme.color.background.canvas,
    borderColor: pressed ? theme.color.primary.hover : theme.color.border.hover,
  },

  ':disabled': {
    cursor: 'not-allowed',
    opacity: 0.4,
  },
}));

const ShortcutBadge = styled('span')({
  position: 'absolute',
  bottom: 1,
  right: 3,
  fontSize: 9,
  lineHeight: 1,
  opacity: 0.75,
  pointerEvents: 'none',
});

export function IconButton({ icon, label, shortcut, pressed, disabled, onClick, testId }: IconButtonProps) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <StyledButton
      type="button"
      data-testid={testId}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      pressed={pressed}
    >
      {icon}
      {shortcut && <ShortcutBadge>{shortcut}</ShortcutBadge>}
    </StyledButton>
  );
}
