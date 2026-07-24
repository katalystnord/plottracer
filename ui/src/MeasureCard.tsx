/**
 * Measure fold-out (v1.1 step 2 — single row). A COMPACT icon strip anchored to
 * the ruler rail button: the four measurement tools + Set-scale, icon-only with
 * tooltips, no title (the pressed rail icon + tooltips identify it — same language
 * as the Select strip). Transient sub-flows (typing a scale value; finishing an
 * Area polygon) drop in just BELOW the row while active, then disappear, so the
 * resting card is one line.
 *
 * The RECORDED measurements themselves are an OUTPUT: they live in the right
 * output panel's Measurements section (bound with the series data, copyable,
 * exportable), NOT here — a tool fold-out holds inputs/actions only.
 *
 * History: was a full labelled card with the list inline (2026-07-13, see
 * docs/competitor-data-panel-study.md §5); the list moved to the output panel in
 * the v1.1 fold-out redesign. Reference reasoning unchanged: a Slope reads in the
 * chart's own axis units (reuses calibration); a physical Distance on an
 * uncalibrated drawing needs a NEW px->unit scale (Set-scale).
 */
import { type ReactNode } from 'react';
import styled from '@emotion/styled';
import { theme, glassSurface } from './theme.js';

export type MeasureToolId = 'distance' | 'angle' | 'area' | 'slope';

export interface Measurement {
  id: string;
  tool: MeasureToolId;
  /** Pre-formatted display value incl. unit, e.g. "3.35 mm", "47.2°". */
  value: string;
  /** Optional derived note, e.g. "≈ 1.24 GPa" under a slope. */
  note?: string;
}

/** Reference frame the measurements are computed in. */
export type MeasureRef =
  | { kind: 'chart'; units?: string } // reuse the plot's axis calibration (data units)
  | { kind: 'scale'; perPx: string } // a dedicated px->real-world scale
  | { kind: 'degrees' } // angle needs no reference -- always degrees
  | { kind: 'none' }; // pixels only, until a reference is chosen

const Card = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 4,
  borderRadius: 8,
  // Never overrun a short viewport -- scroll inside the card instead of spilling
  // off the bottom (v1.1 fast-follow). Its own box-shadow is unaffected.
  maxHeight: 'calc(100vh - 16px)',
  overflowY: 'auto',
  // Frosted glass: this card floats over the immutable figure (see glassSurface).
  ...glassSurface,
  border: `1px solid ${theme.color.border.regular}`,
  boxShadow: '0 2px 6px rgba(103, 104, 132, 0.2)',
  pointerEvents: 'auto',
  fontFamily: theme.font.family,
  color: theme.color.text.primary,
});

const IconRow = styled('div')({
  display: 'flex',
  flexDirection: 'row',
  gap: 4,
});

const ToolButton = styled('button', {
  shouldForwardProp: (p) => p !== 'active',
})<{ active: boolean }>(({ active }) => ({
  width: 34,
  height: 34,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  borderRadius: theme.border.radius.regular,
  border: `1px solid ${active ? theme.color.primary.main : theme.color.border.regular}`,
  background: active ? theme.color.primary.clicked : theme.color.background.primary,
  color: active ? theme.color.background.primary : theme.color.icon.active,
  ':hover': { borderColor: theme.color.primary.main },
}));

const ScaleForm = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: theme.font.size.small,
  color: theme.color.text.secondary,
  background: theme.color.background.canvas,
  borderRadius: theme.border.radius.regular,
  padding: '4px 6px',
});

const IconBtn = styled('button')({
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 2,
  display: 'inline-flex',
  color: theme.color.text.legend,
  borderRadius: 4,
  ':hover': { background: theme.color.background.canvas, color: theme.color.text.primary },
});

// --- tiny inline line-icons (stroke=currentColor), matching the icon set's
//     convention; measure tools have no icon in icons.tsx ---
const S = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
/** Shared with the output panel's Measurements list so a row shows its tool. */
export const measureIcons: Record<MeasureToolId, ReactNode> = {
  distance: S(<>{<line x1="3" y1="13" x2="13" y2="3" />}<circle cx="3" cy="13" r="1.4" fill="currentColor" stroke="none" /><circle cx="13" cy="3" r="1.4" fill="currentColor" stroke="none" /></>),
  angle: S(<>{<path d="M3 3 L3 13 L13 13" />}<path d="M3 9 A6 6 0 0 0 9 13" /></>),
  area: S(<polygon points="3,6 8,3 13,7 11,13 5,12" />),
  slope: S(<>{<path d="M3 13 L3 3" />}<path d="M3 13 L13 13" />{<line x1="4" y1="12" x2="12" y2="4" />}</>),
};
const scaleIcon = S(<>{<line x1="2" y1="8" x2="14" y2="8" />}<line x1="2" y1="5" x2="2" y2="11" /><line x1="14" y1="5" x2="14" y2="11" /><line x1="6" y1="6.5" x2="6" y2="9.5" /><line x1="10" y1="6.5" x2="10" y2="9.5" /></>);
const XIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M4 4 L12 12 M12 4 L4 12" />
  </svg>
);

const TOOLS: { id: MeasureToolId; label: string; hint: string }[] = [
  { id: 'distance', label: 'Distance', hint: 'Click point A, then point B.' },
  { id: 'angle', label: 'Angle', hint: 'Click the vertex, then the two arms.' },
  { id: 'area', label: 'Area', hint: 'Click the polygon corners, then Finish (or Enter) to close.' },
  { id: 'slope', label: 'Slope', hint: "Click two points → slope of the line in the axes' units." },
];

/** The in-progress Set-scale form: after clicking two points a known distance
 * apart, the user types that distance + unit and confirms, defining px->unit. */
export interface SetScaleDraft {
  px: number;
  value: string;
  unit: string;
  onValueChange: (v: string) => void;
  onUnitChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface MeasureCardProps {
  /** Active measurement tool -- lifted to the parent (Workspace), which routes
   * canvas clicks by it. Controlled, so the same selection drives both the strip
   * highlight and the canvas measuring. */
  activeTool: MeasureToolId | null;
  onSelectTool: (tool: MeasureToolId) => void;
  /** Begin the Set-scale flow (arm the next two clicks as the scale reference). */
  onStartSetScale?: () => void;
  /** When set, the two scale points are placed and the card shows the
   * "N px = [value] [unit]" form (transient, below the row). */
  setScaleDraft?: SetScaleDraft | null;
  /** Vertices placed so far for the in-progress Area polygon (Area tool only);
   * drives the transient "Finish"/"Cancel" row. */
  areaPointCount?: number;
  onFinishArea?: () => void;
  onCancelArea?: () => void;
}

export function MeasureCard({
  activeTool,
  onSelectTool,
  onStartSetScale,
  setScaleDraft,
  areaPointCount = 0,
  onFinishArea,
  onCancelArea,
}: MeasureCardProps) {
  return (
    <Card data-testid="measure-card">
      <IconRow>
        {TOOLS.map((t) => (
          <ToolButton
            key={t.id}
            type="button"
            active={activeTool === t.id}
            onClick={() => onSelectTool(t.id)}
            data-testid={`measure-tool-${t.id}`}
            title={`${t.label} — ${t.hint}`}
          >
            {measureIcons[t.id]}
          </ToolButton>
        ))}
        <ToolButton
          type="button"
          active={!!setScaleDraft}
          onClick={onStartSetScale}
          data-testid="measure-set-scale"
          title="Set scale — click two points a known distance apart, then type the real distance + unit."
        >
          {scaleIcon}
        </ToolButton>
      </IconRow>

      {setScaleDraft && (
        <ScaleForm data-testid="set-scale-form">
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(setScaleDraft.px)} px =</span>
          <input
            data-testid="set-scale-value"
            value={setScaleDraft.value}
            onChange={(e) => setScaleDraft.onValueChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setScaleDraft.onConfirm()}
            placeholder="value"
            autoFocus
            style={{ width: 52 }}
          />
          <input
            data-testid="set-scale-unit"
            value={setScaleDraft.unit}
            onChange={(e) => setScaleDraft.onUnitChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setScaleDraft.onConfirm()}
            placeholder="unit"
            style={{ width: 42 }}
          />
          <button type="button" data-testid="set-scale-confirm" onClick={setScaleDraft.onConfirm} style={{ fontSize: 11, padding: '0 6px' }}>
            Set
          </button>
          <IconBtn type="button" title="Cancel" onClick={setScaleDraft.onCancel}><XIcon /></IconBtn>
        </ScaleForm>
      )}

      {activeTool === 'area' && areaPointCount > 0 && (
        <ScaleForm data-testid="area-progress">
          <span>Polygon: <b>{areaPointCount}</b> {areaPointCount === 1 ? 'point' : 'points'}</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              data-testid="area-finish"
              onClick={onFinishArea}
              disabled={areaPointCount < 3}
              style={{ fontSize: 11, padding: '0 6px' }}
            >
              Finish
            </button>
            <IconBtn type="button" title="Cancel" onClick={onCancelArea}><XIcon /></IconBtn>
          </span>
        </ScaleForm>
      )}
    </Card>
  );
}
