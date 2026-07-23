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
  /** Marks this button as one that FOLDS OUT a card / options (v1.1, Ketcher's
   * design language): draws a small arrow in the lower-right corner as the
   * always-visible "there's more here" affordance. Because the arrow lives where
   * the shortcut badge used to, the badge moved to the upper-left corner. */
  foldout?: boolean;
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

// The digit-hotkey badge, in the UPPER-LEFT (v1.1) to clear the lower-right corner
// for the fold-out arrow (Ketcher's rail puts its "opens options" triangle there,
// and the two would otherwise overlap). Tucked up into the corner with an equal
// VISIBLE inset from the top and left: top:1 vs left:2 cancels the ~1px of empty
// leading above the digit's cap inside its text box.
const ShortcutBadge = styled('span')({
  position: 'absolute',
  top: 2,
  left: 3,
  fontSize: 9,
  lineHeight: 1,
  opacity: 0.75,
  pointerEvents: 'none',
});

// The fold-out affordance (v1.1): a small arrow tucked into the lower-right
// corner, marking a button whose click opens a card / options portal -- the same
// signal Ketcher's rail uses for its multi-tools. Purely decorative (the button
// itself carries the click); pointer-events off so it never eats the press.
// The 24x24 icon sits centred in the 36x36 button, so its lower-right corner is
// ~6px in from the button edge. Anchor the arrow just inside THERE (not the button
// corner) so it reads as part of the icon. display:flex + lineHeight:0 kill the
// inline-SVG baseline gap that otherwise pushed the glyph up and made the bottom
// inset look larger than the right one; equal right/bottom offsets then read even.
const FoldoutArrow = styled('span')({
  position: 'absolute',
  right: 3,
  bottom: 3,
  width: 8,
  height: 8,
  display: 'flex',
  lineHeight: 0,
  pointerEvents: 'none',
  opacity: 0.85,
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
  foldout,
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
      {foldout && (
        // A rounded right-triangle filling the corner (Ketcher's `dropdown`
        // glyph), pointing into the button's lower-right -- "click to fold out".
        <FoldoutArrow data-testid="foldout-arrow" aria-hidden>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ display: 'block' }}>
            <path d="M8 0 V8 H0 A8 8 0 0 0 8 0 Z" />
          </svg>
        </FoldoutArrow>
      )}
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
