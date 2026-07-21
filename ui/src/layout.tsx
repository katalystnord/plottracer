/**
 * Canvas-dominant window shell (checkpoint 39, see CLAUDE.md's "Product #1
 * — rebuild design" and the checkpoint 39 notes). Mirrors Ketcher's own
 * editor-window structure -- a single CSS-Grid frame with named areas, an
 * intrinsic-width icon rail, and the canvas as the dominant `1fr` cell that
 * absorbs all remaining space (`packages/ketcher-react/src/script/ui/App/
 * App.module.less`). Two deliberate divergences from Ketcher, both because
 * this app's domain has persistent *data output* that a molecule editor
 * doesn't:
 *
 *   1. The right region is a docked, scrollable *content sidebar* (series
 *      list + the live datapoint table + contextual tool guidance), not
 *      Ketcher's thin icon rail. This is the plotextract.com-derived
 *      "unified tool palette + inline data table" pattern CLAUDE.md's
 *      competitive research validated, not a Ketcher one.
 *   2. No bottom toolbar row (no template library to host).
 *
 * Expressed with `@emotion/styled` reading theme.ts tokens rather than
 * Ketcher's LESS modules -- this codebase has no LESS, and its established
 * convention since checkpoint 33 is styled-components-on-tokens.
 */
import styled from '@emotion/styled';
import { theme } from './theme.js';

/** The whole window: a fixed-height grid of [top bar] / [left rail | canvas |
 * right sidebar]. `100%` (not `100vh`) so it fills whatever the mounting
 * container gives it -- App.tsx sizes that to the viewport. */
export const AppShell = styled('div')({
  height: '100%',
  width: '100%',
  display: 'grid',
  // Full-width top and bottom bars; the middle row is just the canvas and the
  // right sidebar. The tool rail is NOT a column here (checkpoint 48b) -- it
  // floats over the canvas as an absolute overlay so the image extends under
  // it, rather than a grey strip stealing canvas width.
  gridTemplateAreas: `
    'top    top'
    'canvas right'
    'bottom bottom'
  `,
  // Canvas takes all remaining width; the sidebar is a resizable content column
  // (checkpoint 60) -- its width is a CSS variable a drag handle updates, default
  // 320px. min-width:0 on the canvas cell (below) is what lets the 1fr track
  // shrink instead of overflowing.
  gridTemplateColumns: 'minmax(0, 1fr) var(--sidebar-width, 320px)',
  gridTemplateRows: 'auto minmax(0, 1fr) auto',
  background: theme.color.background.primary,
  color: theme.color.text.primary,
  fontFamily: theme.font.family,
  fontSize: theme.font.size.regular,
  overflow: 'hidden',
});

/** Full-width action/status bar along the bottom, spanning under all three
 * middle columns (checkpoint 47) -- the right sidebar sits between it and the
 * top bar. Holds the zoom/view readout and status text, AND real actions the
 * user must take (Capture figure, Extract another graph, PDF paging).
 *
 * Height matched to the top bar (v0.8, David): once the bar carries buttons you
 * *have* to push, a thin 28px status strip read as passive chrome. Same
 * construction as the top bar -- 28px content + 5px vertical padding = ~38px --
 * and a `minHeight` so the bar stays that height even when no action button is
 * currently shown (it must not shrink back to a strip after calibration). */
export const BottomBar = styled('div')({
  gridArea: 'bottom',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minHeight: 28,
  padding: '5px 12px',
  borderTop: `1px solid ${theme.color.border.regular}`,
  background: theme.color.background.panel,
  // Darker + larger than the original legend-grey/small (per request) so the
  // zoom %/coordinate readout is comfortably legible.
  color: theme.color.text.secondary,
  fontSize: theme.font.size.regular,
});

/** A bottom-bar action button. Two variants via the `data-variant` attribute:
 * `primary` (accent fill) for the one required next step -- so "Capture figure"
 * reads unmistakably as a button you must push, not a label -- and the default
 * secondary (outlined) for supporting source actions like "Extract another
 * graph". 28px tall to sit flush with the bar's matched top-bar height. */
export const BottomBarButton = styled('button')({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 28,
  padding: '0 12px',
  fontSize: theme.font.size.regular,
  fontFamily: theme.font.family,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  borderRadius: theme.border.radius.regular,
  flex: '0 0 auto',

  // Secondary (default): outlined, on the page background.
  color: theme.color.text.primary,
  background: theme.color.background.primary,
  border: `1px solid ${theme.color.border.regular}`,
  ':hover:not(:disabled)': { background: theme.color.background.canvas },

  // Primary: accent fill, white text -- the required action.
  '&[data-variant="primary"]': {
    color: '#ffffff',
    background: theme.color.primary.main,
    border: `1px solid ${theme.color.primary.main}`,
    fontWeight: 600,
  },
  '&[data-variant="primary"]:hover:not(:disabled)': {
    background: theme.color.primary.hover,
    border: `1px solid ${theme.color.primary.hover}`,
  },

  ':disabled': { color: theme.color.text.legend, cursor: 'default', opacity: 0.5 },
});

/** Thin top bar spanning the full width: title, axes-type select, file
 * actions, undo/redo, floating-panel triggers. */
export const TopBar = styled('div')({
  gridArea: 'top',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
  padding: '5px 10px',
  borderBottom: `1px solid ${theme.color.border.regular}`,
  background: theme.color.background.panel,
});

/** A logical cluster of top-bar controls with "a bit of chrome" around it
 * (checkpoint 44) -- a subtle white card with a soft shadow, mirroring
 * Ketcher's toolbar groups. Replaces the bare dividers; the card *is* the group
 * boundary. */
export const TopBarGroup = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  padding: 2,
  borderRadius: theme.border.radius.regular,
  background: theme.color.background.primary,
  boxShadow: '0 1px 3px rgba(103, 104, 132, 0.16)',
});

/** A top-bar action button (checkpoint 43): icon + a short label -- icon-only
 * proved too cryptic for the domain-specific actions, so keep the smallest
 * label that reads clearly. Flat inside its TopBarGroup card, light fill on
 * hover. */
export const TopBarButton = styled('button')({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  padding: '0 8px',
  fontSize: theme.font.size.regular,
  fontFamily: theme.font.family,
  color: theme.color.text.primary,
  background: 'transparent',
  border: 'none',
  borderRadius: theme.border.radius.regular,
  cursor: 'pointer',
  whiteSpace: 'nowrap',

  ':hover:not(:disabled)': {
    background: theme.color.background.canvas,
  },
  ':disabled': {
    color: theme.color.text.legend,
    cursor: 'default',
    opacity: 0.5,
  },
});

/** Left icon rail, flush against the canvas -- an intrinsic-width vertical
 * column of tool/action buttons grouped into cards, mirroring Ketcher's own
 * `.vertical-toolbar` rail. */
export const LeftRail = styled('div')({
  // Absolute overlay pinned to the left edge of the canvas region (a child of
  // CanvasRegion, which is position:relative), vertically centered
  // (checkpoint 48b). Transparent and non-interactive itself -- only the card
  // inside (RailGroup, pointerEvents:auto) catches clicks -- so the rest of
  // the left edge, and the image under it, stay fully interactive (pan, click,
  // hover pass straight through).
  position: 'absolute',
  left: 8,
  top: 0,
  bottom: 0,
  zIndex: 2,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 8,
  pointerEvents: 'none',
});

/** The floating rail card (checkpoint 46/47) -- a white "chrome" card with a
 * clear shadow + hairline border, mirroring Ketcher's rail `.group`. Sized to
 * its content, so it grows/shrinks as buttons appear (e.g. the point actions
 * once calibrated). */
export const RailGroup = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 3,
  padding: 4,
  borderRadius: 8,
  // SOLID, not glass (David, 2026-07-21): the icon rail takes very little space,
  // and its icons must stay crisp over ANY figure -- a translucent rail would let
  // a dark or busy plot show through the icons. The fold-out CARDS stay frosted
  // glass; the rail does not.
  background: theme.color.background.panel,
  border: `1px solid ${theme.color.border.regular}`,
  boxShadow: '0 2px 6px rgba(103, 104, 132, 0.2)',
  // The interactive part of the otherwise pass-through LeftRail overlay.
  pointerEvents: 'auto',
});

/** Separator between the rail's tool bands. Thicker + darker than a hairline
 * (v0.8, David) so the banding reads clearly -- it's what makes the setup /
 * point-ops / auto-extract / analysis / image / destructive grouping legible. */
export const RailDivider = styled('div')({
  height: 2,
  alignSelf: 'stretch',
  margin: '4px 1px',
  borderRadius: 1,
  // Thicker than a hairline for legible banding, but the softer border tone
  // (not the darker divider) so it groups without shouting (David, v0.8).
  background: theme.color.border.regular,
});

/** The dominant central region. `position: relative` so ImageCanvas's own
 * absolutely-positioned overlays (loupe, zoom control, readouts) anchor to
 * it; `min-width/height: 0` + `overflow: hidden` so the 1fr/1fr grid cell
 * actually clips instead of being blown out by the canvas. */
export const CanvasRegion = styled('div')({
  gridArea: 'canvas',
  position: 'relative',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
});

/** Docked, scrollable content sidebar -- series list, the live datapoint
 * table, contextual tool guidance. `position: relative` anchors the resize
 * handle to its left edge (checkpoint 60). */
export const RightSidebar = styled('div')({
  gridArea: 'right',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '10px 12px',
  borderLeft: `1px solid ${theme.color.border.regular}`,
  background: theme.color.background.panel,
  overflowY: 'auto',
});

/** A thin grab bar on the sidebar's left edge for resizing it (checkpoint 60).
 * Sits just inside the border; widens its hit area with padding via the
 * transparent zone, and shows the accent on hover so it's discoverable. */
export const ResizeHandle = styled('div')({
  position: 'absolute',
  left: -3,
  top: 0,
  bottom: 0,
  width: 7,
  cursor: 'col-resize',
  zIndex: 5,
  ':hover': { background: theme.color.primary.main, opacity: 0.4 },
});

/** A titled block within the sidebar (e.g. "Series", "Data points"). */
export const SidebarSection = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const SidebarHeading = styled('div')({
  fontSize: theme.font.size.small,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: theme.color.text.legend,
});
