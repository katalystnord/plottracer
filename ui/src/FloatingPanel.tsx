import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import styled from '@emotion/styled';
import { Button, Popover } from '@mui/material';
import { theme, glassSurface } from './theme.js';
import { ChevronDownIcon } from './icons.js';
import { IconButton } from './IconButton.js';

/**
 * A top-bar button that opens its contents in a floating `@mui/material`
 * Popover (checkpoint 40). Used for the analysis panels (Grid Removal, Curve
 * Fit, Geometry) that were inline sidebar accordions through checkpoint 39.
 *
 * Popover, not Drawer: CLAUDE.md's design flagged these as "floating panels",
 * and the survey for checkpoints 34/39 confirmed Ketcher uses `Popover` for
 * its own floating dropdowns (ZoomControls, ModeControl) and `Drawer` nowhere.
 * Same structure this app already uses for `ZoomControls.tsx` -- an anchored
 * Popover whose default `onClose` (outside click / Escape) is the only way it
 * closes, so a user can adjust a control and click "Run" without the panel
 * dismissing between interactions.
 *
 * The panel body carries `{testId}-panel` so the existing e2e content
 * assertions keep working once it's open; the trigger is `{testId}-trigger`.
 */
export interface FloatingPanelProps {
  label: string;
  /** Optional leading icon (checkpoint 43). */
  icon?: ReactNode;
  /** Render icon-only, with `label` as the tooltip (checkpoint 46) -- for the
   * Help "?" trigger where the icon carries the meaning. */
  hideLabel?: boolean;
  /** kebab id, e.g. 'grid-removal' -> `grid-removal-trigger` / `grid-removal-panel`. */
  testId: string;
  disabled?: boolean;
  /** Panel contents. May be a render function receiving a `close()` callback,
   * so an action inside the panel (e.g. Grid Removal's eyedropper) can dismiss
   * the Popover to free up the canvas for a click. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Notified when the panel opens/closes (checkpoint 121) -- the Auto-trace by
   * colour panel uses it to show a live colour-match overlay on the canvas only
   * while it is open. */
  onOpenChange?: (open: boolean) => void;
  /** Where the trigger lives (v0.8). `'topbar'` (default) is the labelled
   * chevron button; `'rail'` is an icon-only left-rail button (matching the
   * tool rail's IconButtons) whose panel flies out to the RIGHT of the rail,
   * like the Measure/Image-Edit cards. Curve Fit + Geometry moved to the rail
   * because four analysis panels overflowed the top bar into two lanes. */
  placement?: 'topbar' | 'rail';
  /** Digit-hotkey badge for a rail trigger (v0.8) -- so Curve Fit / Geometry
   * carry their 7 / 8 like the other numbered tools. Ignored for top-bar. */
  shortcut?: string;
}

const TriggerButton = styled(Button)({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  height: 30,
  padding: '0 9px',
  fontSize: theme.font.size.regular,
  fontFamily: theme.font.family,
  color: theme.color.text.primary,
  textTransform: 'none',
  border: 'none',
  borderRadius: theme.border.radius.regular,
  background: 'transparent',

  ':hover': {
    background: theme.color.background.canvas,
  },
  ':disabled': {
    color: theme.color.text.legend,
  },
});

const PanelBody = styled('div')({
  padding: '10px 14px',
  minWidth: 240,
  maxWidth: 460,
  fontSize: theme.font.size.regular,
  color: theme.color.text.primary,
  fontFamily: theme.font.family,
});

export function FloatingPanel({ label, icon, hideLabel, testId, disabled, children, onOpenChange, placement = 'topbar', shortcut }: FloatingPanelProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const isRail = placement === 'rail';

  // One source of truth for open-state notifications (checkpoint 121): fire
  // onOpenChange whenever the Popover opens or closes, however it got there
  // (trigger click, outside click, Escape, window blur, or a render-prop close).
  const isOpen = Boolean(anchorEl);
  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  // Close on window blur (clicking the OS title bar, alt-tabbing away, etc.).
  // MUI's Popover only dismisses on an in-document outside click, so without
  // this it stays open when focus leaves the window entirely.
  useEffect(() => {
    if (!anchorEl) return;
    const close = () => setAnchorEl(null);
    window.addEventListener('blur', close);
    return () => window.removeEventListener('blur', close);
  }, [anchorEl]);

  return (
    <>
      {isRail ? (
        <IconButton
          testId={`${testId}-trigger`}
          icon={icon}
          label={label}
          shortcut={shortcut}
          pressed={Boolean(anchorEl)}
          disabled={disabled}
          onClick={(e) => setAnchorEl(e.currentTarget)}
        />
      ) : (
        <TriggerButton
          data-testid={`${testId}-trigger`}
          title={hideLabel ? label : undefined}
          disabled={disabled}
          onClick={(e: MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget)}
        >
          {icon}
          {!hideLabel && <span>{label}</span>}
          <ChevronDownIcon />
        </TriggerButton>
      )}
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        // Rail panels fly out to the RIGHT of the rail icon (like the Measure
        // card); top-bar panels drop DOWN from their button.
        anchorOrigin={isRail ? { vertical: 'top', horizontal: 'right' } : { vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={isRail ? { vertical: 'top', horizontal: 'left' } : undefined}
        // Frosted glass, like the fold-out cards -- these float over the immutable
        // figure too (Curve Fit / Geometry rail fly-outs, Grid Removal, Help).
        slotProps={{ paper: { sx: glassSurface } }}
      >
        <PanelBody data-testid={`${testId}-panel`}>
          {typeof children === 'function' ? children(() => setAnchorEl(null)) : children}
        </PanelBody>
      </Popover>
    </>
  );
}
