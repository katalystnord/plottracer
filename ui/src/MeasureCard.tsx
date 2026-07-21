/**
 * Measure card (prototype, 2026-07-13) — a left-column floating card, sitting
 * under the tool-rail card, holding the image-measurement tools and the running
 * list of recorded measurements. Kept "always on hand" per David's call.
 *
 * Design decisions (see docs/competitor-data-panel-study.md §5 and the design
 * discussion that followed):
 *  - Measurements are a SEPARATE collection, NOT data series — they don't fit
 *    the right-panel spreadsheet's per-type value dims, and the right sidebar
 *    stays series-only.
 *  - They are RECORDED (people take several per figure), not show-and-forget:
 *    each committed measurement is a row here with a per-row copy button.
 *  - Live feedback while measuring goes to the hint line + an on-canvas label
 *    (not modelled in this card); this card is the persistent record.
 *  - A fixed, foldable card (same pattern as the checkpoint-50 calibration
 *    card) — deliberately NOT a movable popup (that violates the "nothing moves
 *    around" rule).
 *  - Reference selector (David): a Slope for the initial stress-strain gradient
 *    → E-modulus reads in the chart's OWN data units, so it REUSES the existing
 *    axis calibration; a physical Distance on an uncalibrated drawing needs a
 *    NEW px→unit scale. The card lets the user pick which.
 *
 * This is a visual/interaction prototype: tool selection + fold are live; the
 * measurement rows are supplied by props (mocked in the preview). Wiring the
 * actual canvas clicking / value computation is the follow-up.
 */
import { useState, type ReactNode } from 'react';
import styled from '@emotion/styled';
import { theme, glassSurface } from './theme.js';
import { ChevronDownIcon } from './icons.js';

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
  width: 214,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '6px 8px 8px',
  borderRadius: 8,
  // Frosted glass: this card floats over the immutable figure (see glassSurface).
  ...glassSurface,
  border: `1px solid ${theme.color.border.regular}`,
  boxShadow: '0 2px 6px rgba(103, 104, 132, 0.2)',
  pointerEvents: 'auto',
  fontFamily: theme.font.family,
  color: theme.color.text.primary,
});

const HeaderRow = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
});

const FoldButton = styled('button')({
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  color: theme.color.icon.active,
  padding: 2,
});

const ToolRow = styled('div')({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 3,
});

const ToolButton = styled('button', {
  shouldForwardProp: (p) => p !== 'active',
})<{ active: boolean }>(({ active }) => ({
  display: 'inline-flex',
  alignItems: 'center',
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
  ':hover': { borderColor: theme.color.primary.main },
}));

const RefBar = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: theme.font.size.small,
  color: theme.color.text.secondary,
  background: theme.color.background.canvas,
  borderRadius: theme.border.radius.regular,
  padding: '3px 6px',
});

const LinkButton = styled('button')({
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: theme.color.primary.main,
  fontSize: theme.font.size.small,
  fontFamily: theme.font.family,
  textDecoration: 'underline',
  whiteSpace: 'nowrap',
});

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

const Hint = styled('div')({
  fontSize: theme.font.size.small,
  color: theme.color.text.legend,
  lineHeight: 1.3,
  minHeight: 15,
});

const Divider = styled('div')({
  height: 1,
  background: theme.color.border.regular,
  margin: '1px 0',
});

const ListHeader = styled('div')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: theme.font.size.small,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: theme.color.text.legend,
});

const Row = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 2px',
  fontSize: theme.font.size.small,
  ':not(:last-of-type)': { borderBottom: `1px solid ${theme.color.background.canvas}` },
});

const Glyph = styled('span')({
  width: 18,
  height: 18,
  flex: '0 0 18px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: theme.color.icon.active,
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

// --- tiny inline line-icons (16px, stroke=currentColor) matching the icon set's
//     currentColor convention; measure tools have no icon in icons.tsx yet ---
const S = (children: ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
const icons: Record<MeasureToolId, ReactNode> = {
  distance: S(<>{<line x1="3" y1="13" x2="13" y2="3" />}<circle cx="3" cy="13" r="1.4" fill="currentColor" stroke="none" /><circle cx="13" cy="3" r="1.4" fill="currentColor" stroke="none" /></>),
  angle: S(<>{<path d="M3 3 L3 13 L13 13" />}<path d="M3 9 A6 6 0 0 0 9 13" /></>),
  area: S(<polygon points="3,6 8,3 13,7 11,13 5,12" />),
  slope: S(<>{<path d="M3 13 L3 3" />}<path d="M3 13 L13 13" />{<line x1="4" y1="12" x2="12" y2="4" />}</>),
};
const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 11 V3.5 A1.5 1.5 0 0 1 4.5 2 H11" />
  </svg>
);
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
  reference?: MeasureRef;
  measurements?: Measurement[];
  /** Active measurement tool -- lifted to the parent (Workspace), which routes
   * canvas clicks by it. Controlled, so the same selection drives both the card
   * highlight and the canvas measuring. */
  activeTool: MeasureToolId | null;
  onSelectTool: (tool: MeasureToolId) => void;
  onCopy?: (m: Measurement) => void;
  onDelete?: (id: string) => void;
  onCopyAll?: () => void;
  /** Begin the Set-scale flow (arm the next two clicks as the scale reference). */
  onStartSetScale?: () => void;
  /** When set, the two scale points are placed and the card shows the
   * "N px = [value] [unit]" form. */
  setScaleDraft?: SetScaleDraft | null;
  /** Vertices placed so far for the in-progress Area polygon (Area tool only);
   * drives the "Finish"/"Cancel" row. */
  areaPointCount?: number;
  onFinishArea?: () => void;
  onCancelArea?: () => void;
}

export function MeasureCard({
  reference = { kind: 'none' },
  measurements = [],
  activeTool,
  onSelectTool,
  onCopy,
  onDelete,
  onCopyAll,
  onStartSetScale,
  setScaleDraft,
  areaPointCount = 0,
  onFinishArea,
  onCancelArea,
}: MeasureCardProps) {
  const [expanded, setExpanded] = useState(true);
  const activeHint = activeTool ? TOOLS.find((t) => t.id === activeTool)!.hint : 'Pick a measurement tool.';

  return (
    <Card data-testid="measure-card">
      <HeaderRow>
        <FoldButton type="button" onClick={() => setExpanded((v) => !v)} title={expanded ? 'Fold' : 'Unfold'}>
          <span style={{ display: 'inline-block', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>
            <ChevronDownIcon />
          </span>
        </FoldButton>
        <strong style={{ fontSize: theme.font.size.regular }}>Measure</strong>
        <span style={{ marginLeft: 'auto', fontSize: theme.font.size.small, color: theme.color.text.legend }}>
          {measurements.length ? `${measurements.length}` : ''}
        </span>
      </HeaderRow>

      {expanded && (
        <>
          {/* Reference selector — reuse the chart calibration, or set a px->unit scale */}
          <RefBar data-testid="measure-ref">
            {reference.kind === 'chart' && <span>Ref: <b>chart axes</b>{reference.units ? ` (${reference.units})` : ''}</span>}
            {reference.kind === 'scale' && <span>Scale: <b>{reference.perPx}</b></span>}
            {reference.kind === 'degrees' && <span>Measured in <b>degrees</b></span>}
            {reference.kind === 'none' && <span style={{ color: theme.color.error }}>No reference set</span>}
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
              <LinkButton type="button" onClick={onStartSetScale} data-testid="measure-set-scale">Set scale…</LinkButton>
            </span>
          </RefBar>

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

          <ToolRow>
            {TOOLS.map((t) => (
              <ToolButton key={t.id} type="button" active={activeTool === t.id} onClick={() => onSelectTool(t.id)} data-testid={`measure-tool-${t.id}`}>
                <span style={{ display: 'inline-flex' }}>{icons[t.id]}</span>
                {t.label}
              </ToolButton>
            ))}
          </ToolRow>

          <Hint>{activeHint}</Hint>

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

          {measurements.length > 0 && (
            <>
              <Divider />
              <ListHeader>
                <span>Recorded</span>
                <LinkButton type="button" title="Copy all as text" onClick={onCopyAll}>Copy all</LinkButton>
              </ListHeader>
              <div>
                {measurements.map((m) => (
                  <Row key={m.id} data-testid={`measure-row-${m.id}`}>
                    <Glyph>{icons[m.tool]}</Glyph>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{m.value}</span>
                      {m.note && <span style={{ color: theme.color.text.legend }}> · {m.note}</span>}
                    </span>
                    <IconBtn type="button" title="Copy value" onClick={() => onCopy?.(m)}><CopyIcon /></IconBtn>
                    <IconBtn type="button" title="Delete" onClick={() => onDelete?.(m.id)}><XIcon /></IconBtn>
                  </Row>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}
