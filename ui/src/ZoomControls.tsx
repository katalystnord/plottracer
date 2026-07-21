import { useEffect, useState, type MouseEvent } from 'react';
import styled from '@emotion/styled';
import { Button, Popover, Slider } from '@mui/material';
import { scaleToSlider, sliderToScale } from '../../engine/canvasView.js';
import { theme } from './theme.js';
import { ChevronDownIcon } from './icons.js';

/**
 * On-canvas zoom control (checkpoint 34, see CLAUDE.md and
 * project_mui_adoption_flagged.md's memory note) -- checkpoint 34's first
 * real `@mui/material` component usage, chosen after surveying Ketcher's
 * actual MUI usage and finding a near-exact analog:
 * `ketcher-react/src/script/ui/views/toolbars/TopToolbar/ZoomControls.tsx`
 * (a button showing the current zoom %, opening an MUI `Popover` with
 * Zoom In/Out/Reset actions) -- structure mirrored here, adapted to this
 * app's simpler needs (no raw numeric zoom-percent input field; that's a
 * real chunk of additional scope -- parsing, clamping, Enter-to-submit --
 * not needed to prove the pattern, can follow later if wanted).
 *
 * Checkpoint 37 adds a continuous zoom `Slider` (`@mui/material`'s, the
 * fourth real MUI component adopted -- surveyed against Ketcher's own usage
 * first, same discipline as 34-36) inside this same Popover. Ketcher's own
 * near-exact analog is `TopToolbar/ZoomSlider.tsx` (a `styled(Slider)`
 * sitting beside its zoom controls); the one deliberate adaptation is
 * placement -- Ketcher's slider lives inline in the always-visible top
 * toolbar, but this app already consolidated its whole zoom affordance into
 * this dropdown at checkpoint 34, so the slider joins it there rather than
 * introducing a second on-canvas zoom widget. The slider maps zoom on a log
 * axis (engine/canvasView.ts's scaleToSlider/sliderToScale) so 100% sits at
 * its midpoint; dragging it drives the same `zoomTo` recentering path the
 * discrete buttons use.
 *
 * Closes a real, until-now-unfilled gap: checkpoint 32 wired Zoom In/Out/
 * Fit to Window/Actual Size to the native menu bar, but there was no
 * *on-canvas* way to zoom other than the mouse wheel, and no visible
 * zoom-percent readout beyond ImageCanvas.tsx's own `view-state` debug
 * text (a test-support readout, not real UI). The four callbacks passed
 * in here are the exact same `zoomIn`/`zoomOut`/`zoomFit`/`zoom100`
 * ImageCanvas.tsx already built for the menu wiring -- this widget is
 * strictly a second way to trigger them, not a second implementation, so
 * the native menu and the on-canvas control can never drift apart.
 *
 * Matches Ketcher's own real behavior, not guessed at: neither the "Zoom
 * In" nor "Zoom Out" nor "Actual Size" button in Ketcher's own
 * `ZoomControlButton` closes its dropdown on click -- only clicking
 * outside or Escape does (MUI Popover's own default `onClose` triggers).
 * That reads as deliberate, not an oversight: it lets a user click "Zoom
 * In" repeatedly without the menu closing and reopening between clicks.
 * Reproduced here the same way.
 */
export interface ZoomControlsProps {
  scale: number;
  disabled: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onZoom100: () => void;
  onZoomTo: (scale: number) => void;
}

const ZoomButton = styled(Button)({
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
});

const DropdownContent = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 180,
  padding: '4px 0',
});

const ZoomActionButton = styled(Button)({
  display: 'flex',
  justifyContent: 'space-between',
  padding: '8px 12px',
  fontSize: theme.font.size.regular,
  fontFamily: theme.font.family,
  color: theme.color.text.primary,
  textTransform: 'none',
  borderRadius: 0,

  ':hover': {
    background: theme.color.background.canvas,
  },
});

const ShortcutHint = styled('span')({
  color: theme.color.text.legend,
  fontSize: theme.font.size.small,
});

/** Row holding the continuous zoom Slider (checkpoint 37). Mirrors the
 * `styled(Slider)` treatment in Ketcher's own ZoomSlider.tsx, but reading
 * theme.ts tokens rather than Ketcher's inline hex literals -- consistent
 * with this codebase's token convention (same call made at checkpoint 35).
 * The primary teal happens to match Ketcher's own hardcoded #167782. */
const SliderRow = styled('div')({
  padding: '6px 16px 2px',
});

const ZoomSlider = styled(Slider)({
  color: theme.color.primary.main,
  padding: '10px 0',
  '& .MuiSlider-rail': {
    backgroundColor: theme.color.border.regular,
    opacity: 1,
  },
  '& .MuiSlider-thumb': {
    height: 12,
    width: 12,
    border: `2px solid ${theme.color.background.primary}`,
    ':hover, &.Mui-focusVisible': {
      boxShadow: `0 0 0 6px ${theme.color.primary.main}22`,
    },
  },
});

const SliderDivider = styled('div')({
  height: 1,
  margin: '2px 0',
  background: theme.color.border.regular,
});

export function ZoomControls({
  scale,
  disabled,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onZoom100,
  onZoomTo,
}: ZoomControlsProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  // Close on window blur (OS title bar click, alt-tab) -- MUI Popover only
  // dismisses on an in-document outside click otherwise. Same fix as
  // FloatingPanel.
  useEffect(() => {
    if (!anchorEl) return;
    const close = () => setAnchorEl(null);
    window.addEventListener('blur', close);
    return () => window.removeEventListener('blur', close);
  }, [anchorEl]);

  return (
    <>
      <ZoomButton
        data-testid="zoom-controls-button"
        disabled={disabled}
        onClick={(e: MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget)}
      >
        <span>{Math.round(scale * 100)}%</span>
        <ChevronDownIcon />
      </ZoomButton>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <DropdownContent>
          <SliderRow data-testid="zoom-slider">
            <ZoomSlider
              aria-label="Zoom"
              min={0}
              max={100}
              step={1}
              value={scaleToSlider(scale)}
              onChange={(_, value) => onZoomTo(sliderToScale(value as number))}
            />
          </SliderRow>
          <SliderDivider />
          <ZoomActionButton data-testid="zoom-in" onClick={onZoomIn}>
            <span>Zoom In</span>
            <ShortcutHint>Ctrl+=</ShortcutHint>
          </ZoomActionButton>
          <ZoomActionButton data-testid="zoom-out" onClick={onZoomOut}>
            <span>Zoom Out</span>
            <ShortcutHint>Ctrl+-</ShortcutHint>
          </ZoomActionButton>
          <ZoomActionButton data-testid="zoom-fit" onClick={onZoomFit}>
            <span>Fit to Window</span>
            <ShortcutHint>Ctrl+0</ShortcutHint>
          </ZoomActionButton>
          <ZoomActionButton data-testid="zoom-100" onClick={onZoom100}>
            <span>Actual Size</span>
            <ShortcutHint>Ctrl+1</ShortcutHint>
          </ZoomActionButton>
        </DropdownContent>
      </Popover>
    </>
  );
}
