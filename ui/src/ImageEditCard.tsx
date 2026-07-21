/**
 * Image-editing fold-out card (checkpoint 62) -- mirrors the Measure card's
 * dynamics exactly (a rail icon toggles it; it folds out docked beside the rail,
 * press-again-to-close). Unlike Measure, its tools are discrete one-click actions
 * (rotate/flip) rather than canvas-interaction modes, so there's no active-tool,
 * reference, or recorded list -- just the buttons. Crop (a drag-rectangle) is the
 * planned follow-up.
 */
import { useState, type ReactNode } from 'react';
import styled from '@emotion/styled';
import { theme, glassSurface } from './theme.js';
import { ChevronDownIcon } from './icons.js';
import type { ImageEditOp } from '../../engine/imageEdit.js';

// `interactive` false makes the whole card pass pointer events THROUGH to the
// canvas beneath -- used while a crop rectangle is being drawn, so the drag can
// start anywhere including under the card (v1.0 audit: a drag couldn't start under
// a fold-out card). Once a rectangle exists the card is interactive again for
// Apply/Cancel; it also dims slightly so it reads as "drawing on the figure now".
const Card = styled('div', { shouldForwardProp: (p) => p !== 'interactive' })<{ interactive?: boolean }>(({ interactive = true }) => ({
  width: 200,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '6px 8px 8px',
  borderRadius: 8,
  // Frosted glass: floats over the immutable figure (see glassSurface).
  ...glassSurface,
  border: `1px solid ${theme.color.border.regular}`,
  boxShadow: '0 2px 6px rgba(103, 104, 132, 0.2)',
  pointerEvents: interactive ? 'auto' : 'none',
  opacity: interactive ? 1 : 0.55,
  transition: 'opacity 0.12s',
  fontFamily: theme.font.family,
  color: theme.color.text.primary,
}));

const HeaderRow = styled('div')({ display: 'flex', alignItems: 'center', gap: 6 });

const FoldButton = styled('button')({
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  color: theme.color.icon.active,
  padding: 2,
});

const ToolRow = styled('div')({ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 3 });

const ToolButton = styled('button')({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 28,
  padding: '0 6px',
  fontSize: theme.font.size.small,
  fontFamily: theme.font.family,
  cursor: 'pointer',
  borderRadius: theme.border.radius.regular,
  border: `1px solid ${theme.color.border.regular}`,
  background: theme.color.background.primary,
  color: theme.color.text.primary,
  ':hover:not(:disabled)': { borderColor: theme.color.primary.main },
  ':disabled': { color: theme.color.text.legend, cursor: 'default', opacity: 0.5 },
});

const Hint = styled('div')({ fontSize: theme.font.size.small, color: theme.color.text.legend, lineHeight: 1.3 });

const StraightenRow = styled('div')({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' });

const AngleValue = styled('span')({
  fontSize: theme.font.size.small,
  fontVariantNumeric: 'tabular-nums',
  color: theme.color.text.primary,
  fontWeight: 600,
});

const CropBar = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: theme.font.size.small,
  color: theme.color.text.secondary,
  background: theme.color.background.canvas,
  borderRadius: theme.border.radius.regular,
  padding: '4px 6px',
});

const WideButton = styled('button', { shouldForwardProp: (p) => p !== 'active' })<{ active?: boolean }>(({ active }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  height: 26,
  padding: '0 6px',
  fontSize: theme.font.size.small,
  fontFamily: theme.font.family,
  cursor: 'pointer',
  borderRadius: theme.border.radius.regular,
  border: `1px solid ${active ? theme.color.primary.main : theme.color.border.regular}`,
  background: active ? theme.color.primary.main : theme.color.background.primary,
  color: active ? '#fff' : theme.color.text.primary,
  ':hover:not(:disabled)': { borderColor: theme.color.primary.main },
  ':disabled': { color: theme.color.text.legend, cursor: 'default', opacity: 0.5 },
}));

const S = (children: ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const icons: Record<ImageEditOp, ReactNode> = {
  'rotate-ccw': S(<>{<path d="M3 8a5 5 0 1 1 1.5 3.6" />}<path d="M3 5v3h3" /></>),
  'rotate-cw': S(<>{<path d="M13 8a5 5 0 1 0-1.5 3.6" />}<path d="M13 5v3h-3" /></>),
  'flip-h': S(<>{<path d="M8 2v12" />}<path d="M6 5 3 8l3 3" /><path d="M10 5l3 3-3 3" /></>),
  'flip-v': S(<>{<path d="M2 8h12" />}<path d="M5 6 8 3l3 3" /><path d="M5 10l3 3 3-3" /></>),
};

const TOOLS: { op: ImageEditOp; label: string }[] = [
  { op: 'rotate-ccw', label: 'Rotate ↺' },
  { op: 'rotate-cw', label: 'Rotate ↻' },
  { op: 'flip-h', label: 'Flip H' },
  { op: 'flip-v', label: 'Flip V' },
];

export interface ImageEditCardProps {
  onEdit: (op: ImageEditOp) => void;
  disabled?: boolean;
  /** Crop (checkpoint 63): arm a drag-rectangle on the canvas. `cropArmed` is
   * true from the Crop click until Apply/Cancel; once the user has dragged a
   * rectangle, `cropPending` holds its pixel size and the Apply button enables. */
  onStartCrop?: () => void;
  cropArmed?: boolean;
  cropPending?: { width: number; height: number } | null;
  onApplyCrop?: () => void;
  onCancelCrop?: () => void;
  /** Deskew / fine-angle straighten (checkpoint 64). `angle` is the live preview
   * angle (deg, clockwise); the slider and Auto-straighten set it via
   * onAngleChange (previewed on the canvas), and Apply bakes it. onRequestAutoAngle
   * returns the angle that levels the image off the calibration axis, or null when
   * that can't be computed (not XY / axis handles not placed) -- used to enable the
   * Auto-straighten button and to seed the slider. */
  angle?: number;
  onAngleChange?: (deg: number) => void;
  onApplyAngle?: (deg: number) => void;
  onRequestAutoAngle?: () => number | null;
  /** False while a crop rectangle is being drawn: the card passes pointer events
   * through so the drag can start anywhere (including under it). Default true. */
  interactive?: boolean;
}

export function ImageEditCard({
  onEdit,
  disabled = false,
  onStartCrop,
  cropArmed = false,
  cropPending = null,
  onApplyCrop,
  onCancelCrop,
  angle = 0,
  onAngleChange,
  onApplyAngle,
  onRequestAutoAngle,
  interactive = true,
}: ImageEditCardProps) {
  const [expanded, setExpanded] = useState(true);
  const autoAngle = onRequestAutoAngle ? onRequestAutoAngle() : null;
  return (
    <Card data-testid="image-edit-card" interactive={interactive}>
      <HeaderRow>
        <FoldButton type="button" onClick={() => setExpanded((v) => !v)} title={expanded ? 'Fold' : 'Unfold'}>
          <span style={{ display: 'inline-block', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>
            <ChevronDownIcon />
          </span>
        </FoldButton>
        <strong style={{ fontSize: theme.font.size.regular }}>Image</strong>
      </HeaderRow>
      {expanded && (
        <>
          <ToolRow>
            {TOOLS.map((t) => (
              <ToolButton key={t.op} type="button" data-testid={`image-edit-${t.op}`} onClick={() => onEdit(t.op)} disabled={disabled}>
                <span style={{ display: 'inline-flex' }}>{icons[t.op]}</span>
                {t.label}
              </ToolButton>
            ))}
          </ToolRow>
          <WideButton type="button" data-testid="image-edit-crop" active={cropArmed} onClick={onStartCrop} disabled={disabled}>
            Crop…
          </WideButton>
          {cropArmed ? (
            <CropBar data-testid="crop-bar">
              {cropPending ? (
                <span>
                  Crop to <b>{Math.round(cropPending.width)}×{Math.round(cropPending.height)}</b> px
                </span>
              ) : (
                <span>Drag a rectangle over the area to keep.</span>
              )}
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                <button type="button" data-testid="crop-apply" onClick={onApplyCrop} disabled={!cropPending} style={{ fontSize: 11, padding: '0 6px' }}>
                  Apply
                </button>
                <button type="button" data-testid="crop-cancel" onClick={onCancelCrop} style={{ fontSize: 11, padding: '0 6px' }}>
                  Cancel
                </button>
              </span>
            </CropBar>
          ) : (
            <Hint>Rotate, flip, or crop the image. Calibration and points move with it.</Hint>
          )}
          <div style={{ height: 1, background: theme.color.border.regular, margin: '2px 0' }} />
          <StraightenRow>
            <span style={{ fontSize: theme.font.size.small, color: theme.color.text.secondary }}>Straighten</span>
            <AngleValue data-testid="deskew-angle">{angle.toFixed(1)}°</AngleValue>
          </StraightenRow>
          <input
            type="range"
            data-testid="deskew-slider"
            min={-15}
            max={15}
            step={0.1}
            value={angle}
            disabled={disabled}
            onChange={(e) => onAngleChange?.(Number(e.target.value))}
            style={{ width: '100%', accentColor: theme.color.primary.main, cursor: disabled ? 'default' : 'pointer' }}
          />
          <ToolRow>
            <ToolButton
              type="button"
              data-testid="deskew-auto"
              onClick={() => autoAngle != null && onAngleChange?.(autoAngle)}
              disabled={disabled || autoAngle == null}
              title={
                autoAngle == null
                  ? 'Calibrate an XY chart first — levels the image off the X-axis handles'
                  : 'Level the image using the X-axis calibration handles'
              }
              style={{ justifyContent: 'center' }}
            >
              Auto-straighten
            </ToolButton>
            <WideButton type="button" data-testid="deskew-apply" onClick={() => onApplyAngle?.(angle)} disabled={disabled || angle === 0}>
              Apply
            </WideButton>
          </ToolRow>
        </>
      )}
    </Card>
  );
}
