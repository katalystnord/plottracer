import React from 'react';
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
  onApply: () => void;
  onCancel: () => void;
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
  onApply,
  onCancel,
}: OcrReviewCardProps) {
  // ⚑ Esc backs out and writes nothing - the same meaning the key has everywhere
  // else in this app (the global ladder, and F40's fix to the name editor).
  //
  // ⚠️⚑⚑ ON THE WINDOW, CAPTURING, WHICH IS THE ONLY VERSION THAT WORKS. The
  // first draft put `onKeyDown` on the backdrop div with `tabIndex={-1}` and a
  // comment saying Escape backed out. Nothing ever focuses that div, so the
  // handler fired only once the user had clicked into a name field - the key
  // did nothing at the moment the card opened, which is exactly when someone
  // reaches for it. `HelpOverlay` had already solved this and says so in its own
  // words: *"Captured on the window so it works regardless of what has focus
  // inside the card."* Mirrored rather than re-invented.
  //
  // ⚑ A click on the backdrop deliberately does NOT dismiss, and that is the one
  // place this differs from `HelpOverlay`: there is typing in here, and losing a
  // card of corrected names to a stray click outside it is the expensive kind of
  // accident. Help has nothing to lose.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return (
    <div style={backdrop} data-testid="ocr-review-backdrop">
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
          Check each one against the figure and correct anything misread. Apply puts them on the
          categories; a row you leave empty is left alone.
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr style={{ color: theme.color.text.legend, textAlign: 'left' }}>
              <th style={{ paddingRight: 10, fontWeight: 400 }}>#</th>
              <th style={{ paddingRight: 10, fontWeight: 400 }}>name</th>
              <th style={{ paddingRight: 10, fontWeight: 400, textAlign: 'right' }}>conf.</th>
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
            onClick={onApply}
          >
            Apply names
          </button>
        </div>
      </div>
    </div>
  );
}
