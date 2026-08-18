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
            {reference.kind === 'none' && <span style={{ color: theme.color.text.legend }}>Pixels (set a scale or calibrate)</span>}
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
