import type React from 'react';
import { theme } from '../theme.js';
import type { OcrProposal } from '../ocrClient.js';

/**
 * ⚑⚑ THE OFFER WINDOW - where a machine's reading becomes a person's (v2.4).
 *
 * David, 2026-08-30, asked whether an OCR'd name needs a provenance mark and
 * answered it himself with this card: *"the results are OFFERED to the user with
 * the right numbered categories. And the user then has the option of editing the
 * text, before it is then transferred to the output card. And then the
 * provenance is clear because it has been vetted by the user."*
 *
 * ▶ So nothing here has touched the record. Proposals live in this card until
 * Apply, which means the unvetted state is not REACHABLE rather than being
 * checked for - the same move as collapsing the error-bar ball into the whisker
 * end. It also means no new in-cell look had to be invented: `[brackets]`,
 * italics and the selection tint all keep their single meanings.
 *
 * ⚑⚑ EVERY ROW CARRIES ITS OWN CROP, and that is how the rotation is shown.
 * David: *"how do we show this rotation clearly?"* Not with a `90 degrees`
 * badge - with the picture. Press `Rotate` and the thumbnail turns while the
 * text and the confidence beneath it change, so the feedback needs no words. It
 * pays twice more: a badly aimed box stops being a confidence number to
 * interpret (you SEE that it caught half a label), and a column of thumbnails is
 * a visual index of the axis, checkable against the figure at a glance.
 *
 * ⚑ The card opens with the turn THE WHOLE AXIS agreed on already applied, so
 * an axis of rotated labels arrives the right way up. Measured: per-label
 * confidence picks a confidently wrong turn for one label in six; the axis mean
 * picks the right one by 90 against 53.
 */

export interface OcrReviewCardProps {
  proposals: readonly OcrProposal[];
  /** The name each category holds NOW, so a row can show what it would replace. */
  currentNames: readonly string[];
  /** Row edits are the user's; the card owns no state of its own. */
  onEditText: (categoryIndex: number, text: string) => void;
  onRotate: (categoryIndex: number) => void;
  onApply: () => void;
  onCancel: () => void;
  /** True while a row is being re-read, so the control cannot be pressed twice. */
  busyIndex: number | null;
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1200,
};

const card: React.CSSProperties = {
  background: theme.color.background.primary,
  border: `1px solid ${theme.color.border.regular}`,
  borderRadius: 10,
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
  width: 560,
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'calc(100vh - 48px)',
  padding: '18px 22px 16px',
  overflow: 'auto',
};

export function OcrReviewCard({
  proposals,
  currentNames,
  onEditText,
  onRotate,
  onApply,
  onCancel,
  busyIndex,
}: OcrReviewCardProps) {
  return (
    <div
      style={backdrop}
      data-testid="ocr-review-backdrop"
      // ⚑ Esc backs out and writes nothing - the same meaning the key has
      // everywhere else in this app (the global ladder, and F40's fix to the
      // name editor). A click on the backdrop does NOT dismiss: there is typing
      // in here, and losing a card of corrected names to a stray click outside
      // it would be the expensive kind of accident.
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      tabIndex={-1}
    >
      <div style={card} data-testid="ocr-review-card">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Names read from the figure</div>
        {/* ⚑ SAYS WHAT WILL HAPPEN, in the words of the thing about to happen.
            The persona can only use what he sees, and "Apply" alone does not say
            that these go to the categories, nor that an empty row is skipped. */}
        <div
          style={{
            fontSize: theme.font.size.small,
            color: theme.color.text.secondary,
            marginBottom: 12,
          }}
        >
          Check each one against its picture and correct anything misread. Apply puts them on the
          categories; a row you leave empty is left alone.
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr style={{ color: theme.color.text.legend, textAlign: 'left' }}>
              <th style={{ paddingRight: 10, fontWeight: 400 }}>#</th>
              <th style={{ paddingRight: 10, fontWeight: 400 }}>read</th>
              <th style={{ paddingRight: 10, fontWeight: 400 }}>name</th>
              <th style={{ paddingRight: 10, fontWeight: 400, textAlign: 'right' }}>conf.</th>
              <th style={{ fontWeight: 400 }}></th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => {
              const current = currentNames[p.categoryIndex] ?? '';
              return (
                <tr key={p.categoryIndex} data-testid={`ocr-row-${p.categoryIndex}`}>
                  <td style={{ paddingRight: 10, color: theme.color.text.legend, verticalAlign: 'middle' }}>
                    {p.categoryIndex + 1}
                  </td>
                  <td style={{ paddingRight: 10, verticalAlign: 'middle', padding: '4px 10px 4px 0' }}>
                    {/* ⚑ THE WHOLE CROP, SCALED TO THE ROW, NEVER TRIMMED. What
                        the user is checking is whether the box caught the whole
                        label, so a thumbnail that cropped the crop would hide
                        the one fault it exists to reveal. */}
                    <img
                      data-testid={`ocr-thumb-${p.categoryIndex}`}
                      src={p.thumbnail}
                      alt={`the pixels read for category ${p.categoryIndex + 1}`}
                      style={{
                        display: 'block',
                        maxHeight: 34,
                        maxWidth: 150,
                        border: `1px solid ${theme.color.border.regular}`,
                        background: '#fff',
                      }}
                    />
                  </td>
                  <td style={{ paddingRight: 10, verticalAlign: 'middle' }}>
                    <input
                      data-testid={`ocr-text-${p.categoryIndex}`}
                      value={p.text}
                      onChange={(e) => onEditText(p.categoryIndex, e.target.value)}
                      placeholder={current === '' ? 'not read' : current}
                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 'inherit' }}
                    />
                  </td>
                  <td
                    style={{
                      paddingRight: 10,
                      textAlign: 'right',
                      verticalAlign: 'middle',
                      // ⚑ REPORTED, never a threshold. A low number is evidence
                      // for the reader's eye, not grounds for us to drop a row:
                      // the same rule evenness got on the tick detector.
                      color: theme.color.text.secondary,
                    }}
                  >
                    {Math.round(p.confidence)}
                  </td>
                  <td style={{ verticalAlign: 'middle' }}>
                    <button
                      type="button"
                      data-testid={`ocr-rotate-${p.categoryIndex}`}
                      disabled={busyIndex !== null}
                      onClick={() => onRotate(p.categoryIndex)}
                      title="Read this one again, turned a quarter turn"
                    >
                      {busyIndex === p.categoryIndex ? 'reading' : 'Rotate'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" data-testid="ocr-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="ocr-apply"
            disabled={busyIndex !== null}
            onClick={onApply}
          >
            Apply names
          </button>
        </div>
      </div>
    </div>
  );
}
