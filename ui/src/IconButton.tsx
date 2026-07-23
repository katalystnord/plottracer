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
  /** When `disabled`, a short on-hover explanation of what unlocks the tool
   * (e.g. "Calibrate the axes first"). Chromium suppresses `title` on a disabled
   * <button>, so a greyed tool otherwise shows NO hint on hover (v1.0.2 audit
   * B3); this is surfaced via the wrapping span below. Falls back to the plain
   * label+shortcut when omitted. */
  disabledReason?: string;
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
    // Let hover reach the wrapping span (see IconButton below) so its `title`
    // tooltip and not-allowed cursor show -- a disabled <button> both swallows
    // the hover and suppresses its own title in Chromium.
    pointerEvents: 'none',
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

export function IconButton({
  icon,
  label,
  shortcut,
  pressed,
  disabled,
  disabledReason,
  onClick,
  testId,
}: IconButtonProps) {
  const enabledTitle = shortcut ? `${label} (${shortcut})` : label;
  // When disabled, prefer the "why" hint; fall back to the plain label.
  const title = disabled && disabledReason ? disabledReason : enabledTitle;
  const button = (
    <StyledButton
      type="button"
      data-testid={testId}
      // A disabled <button> suppresses its own tooltip in Chromium, so when
      // disabled the wrapping span carries the title instead -- omit it here to
      // avoid a dead attribute. aria-label stays for assistive tech either way.
      title={disabled ? undefined : title}
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
  if (!disabled) return button;
  // The button is disabled: it fires no hover and shows no title. Wrap it in a
  // span that carries the tooltip and the not-allowed cursor; the button's
  // pointer-events:none (:disabled above) lets the hover reach the span. The
  // `disabled` attribute stays on the button, so isDisabled()/click guards and
  // the greyed styling are unaffected.
  return (
    <span title={title} style={{ display: 'inline-flex', cursor: 'not-allowed' }}>
      {button}
    </span>
  );
}
