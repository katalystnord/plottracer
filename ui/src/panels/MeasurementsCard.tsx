import { theme } from '../theme.js';
import { SidebarSection, SidebarHeading } from '../layout.js';
import { measureIcons, type MeasureRef, type MeasureToolId } from '../MeasureCard.js';

/**
 * The Measurements OUTPUT card (v1.1 step 2) - the recorded measurements, moved
 * out of the Measure fold-out so the rail card holds INPUTS only.
 *
 * ⚑ Every value here is DERIVED, never stored: `measureDisplay` re-reads the
 * pixels through `core/measurementValues.ts` each render, which is what makes
 * Set-scale retroactive (a measurement taken in pixels re-reads in millimetres
 * the moment a scale exists). This card must therefore never cache a value.
 */

/** One recorded measurement, already rendered to display text by the caller. */
export interface MeasurementView {
  id: string;
  tool: MeasureToolId;
  value: string;
  note?: string;
  /** A Colour measurement's own reading, drawn as a box beside its hex.
   * ⚑ The row David settled is `🔬 ▉ #440154 · 12.57`: the swatch is there
   * because a hex code is not a colour to anyone reading quickly, and the point
   * of a SECOND OPINION is that you can check it against the figure by eye. */
  swatch?: readonly [number, number, number];
}

export interface MeasurementsCardProps {
  /** Shown while the ruler is active even with nothing recorded, so the panel
   * does not appear out of nowhere on the first measurement. */
  visible: boolean;
  views: readonly MeasurementView[];
  reference: MeasureRef;
  onCopyAll: () => void;
  onCopy: (view: MeasurementView) => void;
  onDelete: (id: string) => void;
}

export function MeasurementsCard({ visible, views, reference, onCopyAll, onCopy, onDelete }: MeasurementsCardProps) {
  if (!visible) return null;
  return (
    <SidebarSection>
      <SidebarHeading>Measurements</SidebarHeading>
      <div data-testid="measurements-panel" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: theme.font.size.small }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: theme.color.text.secondary }}>
          <span data-testid="measure-ref">
            {reference.kind === 'chart' && <>Ref: <b>chart axes</b>{reference.units ? ` (${reference.units})` : ''}</>}
            {reference.kind === 'scale' && <>Scale: <b>{reference.perPx}</b></>}
            {reference.kind === 'degrees' && <>Measured in <b>degrees</b></>}
            {reference.kind === 'colour-key' && <>Read against the <b>colour key</b></>}
            {reference.kind === 'colour-only' && (
              <span style={{ color: theme.color.text.legend }}>Colour only (no colour key calibrated)</span>
            )}
            {reference.kind === 'no-scale' && (
              <span style={{ color: theme.color.text.legend }}>Pixels - set a scale for a real length</span>
            )}
            {reference.kind === 'no-xy-axes' && (
              <span style={{ color: theme.color.text.legend }}>Pixels - a slope reads against calibrated XY axes</span>
            )}
          </span>
          {views.length > 0 && (
            <button
              type="button"
              data-testid="measure-copy-all"
              title="Copy all as text"
              onClick={onCopyAll}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: theme.color.primary.main, textDecoration: 'underline', fontSize: theme.font.size.small }}
            >
              Copy all
            </button>
          )}
        </div>
        {views.length === 0 ? (
          <span style={{ color: theme.color.text.legend }}>No measurements yet.</span>
        ) : (
          views.map((m) => (
            <div
              key={m.id}
              data-testid={`measure-row-${m.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', borderBottom: `1px solid ${theme.color.background.canvas}` }}
            >
              <span style={{ display: 'inline-flex', flex: '0 0 auto', color: theme.color.icon.active }}>{measureIcons[m.tool]}</span>
              {m.swatch && (
                <span
                  data-testid={`measure-swatch-${m.id}`}
                  title={`rgb(${m.swatch.join(', ')})`}
                  style={{
                    flex: '0 0 auto',
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    // ⚑ A border, because the measured colour can be the panel's
                    // own background - white ink on a white figure would
                    // otherwise read as no swatch at all rather than as white.
                    border: `1px solid ${theme.color.border.regular}`,
                    background: `rgb(${m.swatch.join(',')})`,
                  }}
                />
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{m.value}</b>
                {m.note && <span style={{ color: theme.color.text.legend }}> · {m.note}</span>}
              </span>
              <button type="button" title="Copy value" onClick={() => onCopy(m)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: theme.color.text.legend }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 11 V3.5 A1.5 1.5 0 0 1 4.5 2 H11" /></svg>
              </button>
              <button type="button" title="Delete" onClick={() => onDelete(m.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: theme.color.text.legend }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4 L12 12 M12 4 L4 12" /></svg>
              </button>
            </div>
          ))
        )}
      </div>
    </SidebarSection>
  );
}
