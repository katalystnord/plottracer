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
 * ⚑ The card opens with the angle THE WHOLE AXIS agreed on already applied, so
 * an axis of rotated labels arrives the right way up. Measured: per-label
 * confidence picks a confidently wrong answer for one label in six; the axis
 * mean picks the right one by 90 against 53.
 *
 * ⚠️⚑⚑ THIS PARAGRAPH USED TO DESCRIBE A PER-ROW THUMBNAIL AND A `Rotate`
 * BUTTON, and `efab594` deleted both in the commit that made the card read the
 * whole band at once - there is no per-label crop any more, so there is nothing
 * to draw. The description outlived the controls, which is the failure gate 3
 * names: a header restating a design is what stops the next reader from
 * checking the code, and this one answered David's *"how do we show this
 * rotation clearly?"* with a mechanism that was gone. The card is `#`, `name`,
 * `conf.`
 *
 * ⛔ SO THE QUESTION IS OPEN AGAIN, and it should be read as open: nothing on
 * screen now shows the angle the band was read at, and the `angleRadians` the
 * client returns is discarded by its only caller. `readBandAtAngle` already
 * takes a user's angle as its last argument - documented as "the user's own
 * setting, which always wins" - and nothing passes one. That control is the
 * next step both earlier commits named, and it is not built.
 */

export interface OcrReviewCardProps {
  proposals: readonly OcrProposal[];
  /** The name each category holds NOW, so a row can show what it would replace. */
  currentNames: readonly string[];
  /** Row edits are the user's; the card owns no state of its own. */
  onEditText: (categoryIndex: number, text: string) => void;
  onApply: () => void;
  onCancel: () => void;
  /**
   * ⚑⚑ THE ANGLE THE BAND WAS READ AT, in degrees, and whether WE measured it.
   *
   * David: *"should we not re-add some form of user control at the point of
   * showing what the automated state has found? Else, what is the point of
   * showing it to the user?"* Exactly - a measurement nobody can act on has no
   * business on screen, and a control with nothing to act on is blind. They are
   * one thing, so they arrive together.
   */
  angleDegrees: number;
  /** True once the reader has been pointed at an angle by hand - so the card can
   *  say whose answer it is showing. */
  angleIsYours: boolean;
  /**
   * ⚑⚑ WHAT WE MEASURED, KEPT EVEN AFTER YOU DISAGREE WITH IT.
   *
   * ⚠️ Found by reading the card cold, in a screenshot, after the control was
   * built: the moment you set an angle of your own, the measured one vanished
   * from the screen and there was no way back to it. That defeats the whole
   * purpose - the automated finding is the thing being shown, and a control that
   * ERASES it on first use has taken the display away rather than made it
   * useful. So it stays, and it stays reachable.
   */
  measuredDegrees: number;
  /** Read the same band again at this angle. ONE read, not a sweep. */
  onReadAgain: (degrees: number) => void;
  /** A re-read is in flight - the busy state `efab594` removed with `Rotate`. */
  busy?: boolean;
  /** What the last re-read said when it could not read anything. The rows it
   *  replaces are KEPT, so a bad guess costs nothing. */
  notice?: string | null;
}

/**
 * ⚑⚑ ONE DEGREE, WHICH IS FINER THAN ANYTHING THIS FEATURE HAS HAD. David:
 * *"we need to make the steps finer than we had before."* Before was `Rotate`,
 * which moved in QUARTER TURNS - 90 degrees a press, so on a 45 degree axis
 * every one of its four positions was equally wrong. The automatic sweep
 * refines at 5, which is close enough to find the peak and not close enough to
 * sit on it: a hand-drawn axis lands between the angles chart tools offer.
 *
 * ⚑ AND ONE DEGREE IS AFFORDABLE HERE PRECISELY BECAUSE THE SWEEP IS NOT
 * REPEATED. Finding the angle costs up to 18 reads; reading AT a stated angle
 * costs one. That asymmetry is what makes a fine control usable at all, and it
 * is why the control reads on demand rather than live as the slider moves.
 */
const ANGLE_STEP_DEG = 1;
const ANGLE_LIMIT_DEG = 90;

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
  angleDegrees,
  angleIsYours,
  measuredDegrees,
  onReadAgain,
  busy = false,
  notice = null,
}: OcrReviewCardProps) {
  // ⚑ The slider's own position is a CONTROL, not a record, so it lives here -
  // and it follows the angle the card is showing whenever a read comes back, so
  // the handle never sits somewhere the rows were not read at.
  const [pending, setPending] = React.useState(angleDegrees);
  // ⚑ ADJUSTED DURING RENDER, not in an effect. When a read comes back the
  // handle has to follow it, or it sits at an angle the rows below were not read
  // at - which is the one thing this control must never do. React's own answer
  // for "a prop changed, reset some state" is to compare and set while
  // rendering; an effect would paint the stale position first, and the lint rule
  // that forbids it is right.
  const [shownFor, setShownFor] = React.useState(angleDegrees);
  if (shownFor !== angleDegrees) {
    setShownFor(angleDegrees);
    setPending(angleDegrees);
  }
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
        {/* ⚑⚑ WHAT IT READ AT, AND THE HANDLE ON IT, TOGETHER.
            The angle was measured and then thrown away by the only caller, so
            nothing on screen distinguished a band read at the angle the labels
            are actually drawn at from one read at the sweep's fallback. Now it
            says which, and lets you move it.
            ⚑ IT SAYS WHOSE ANSWER IT IS in words rather than in `[brackets]`.
            The bracket convention (`ValueMark`) marks a NUMBER IN THE RECORD
            that did not come off the pixels; the angle never reaches the record,
            it is how the pixels were read. Borrowing the mark here would spend
            it on a control and blunt it where it matters. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 12,
            fontSize: theme.font.size.small,
            color: theme.color.text.secondary,
          }}
        >
          <label htmlFor="ocr-angle" style={{ whiteSpace: 'nowrap' }}>
            Read at{' '}
            <strong data-testid="ocr-angle-value" style={{ color: theme.color.text.primary }}>
              {Math.round(pending)}&deg;
            </strong>
          </label>
          <input
            id="ocr-angle"
            data-testid="ocr-angle"
            type="range"
            min={-ANGLE_LIMIT_DEG}
            max={ANGLE_LIMIT_DEG}
            step={ANGLE_STEP_DEG}
            value={pending}
            disabled={busy}
            onChange={(e) => setPending(Number(e.target.value))}
            style={{ flex: 1, minWidth: 120 }}
          />
          <button
            type="button"
            data-testid="ocr-read-again"
            disabled={busy || Math.round(pending) === Math.round(angleDegrees)}
            onClick={() => onReadAgain(Math.round(pending))}
          >
            {busy ? 'Reading…' : 'Read again'}
          </button>
        </div>
        {/* ⚑ THE SCALE, because a bare handle says nothing about how far it can
            go or where flat is. Read cold from a screenshot the slider was a dot
            on a line: you could not tell the range was a half-turn either way,
            and 0 - the angle most figures are drawn at - was not marked. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: theme.font.size.small,
            color: theme.color.text.legend,
            margin: '-6px 0 10px',
          }}
        >
          <span>&minus;90&deg;</span>
          <span>0&deg; (flat)</span>
          <span>90&deg;</span>
        </div>
        <div
          data-testid="ocr-angle-source"
          style={{
            fontSize: theme.font.size.small,
            color: theme.color.text.legend,
            marginBottom: 12,
          }}
        >
          {/* ⚑ The sentence names the instrument, which is the tenet-9
              distinction the card exists to keep straight: an angle we found by
              reading at it, or one you pointed us at. Neither is worth less. */}
          {angleIsYours ? (
            <>
              {`These names were read at ${Math.round(angleDegrees)}°, the angle you set. We measured ${Math.round(measuredDegrees)}°.`}{' '}
              {/* ⚑⚑ THE WAY BACK. Our reading stays on offer however far you
                  wander - the app's standing posture is that a measurement is
                  OFFERED, never imposed, and an offer you cannot accept twice is
                  not an offer. */}
              <button
                type="button"
                data-testid="ocr-angle-reset"
                disabled={busy}
                onClick={() => onReadAgain(Math.round(measuredDegrees))}
                style={{ fontSize: 'inherit' }}
              >
                Back to {Math.round(measuredDegrees)}&deg;
              </button>
            </>
          ) : (
            `These names were read at ${Math.round(angleDegrees)}°, measured by reading the band at each angle and keeping the best. Move the slider if the labels sit at a different angle.`
          )}
        </div>
        {notice && (
          <div
            data-testid="ocr-angle-notice"
            style={{
              fontSize: theme.font.size.small,
              color: theme.color.text.primary,
              background: theme.color.background.panel,
              border: `1px solid ${theme.color.border.regular}`,
              borderRadius: 6,
              padding: '6px 8px',
              marginBottom: 12,
            }}
          >
            {/* ⚑ THE ROWS BELOW ARE THE ONES THAT SURVIVED. Replacing a card of
                corrected names with nothing, because a guessed angle read
                nothing, is the expensive accident this card already guards
                against for a stray backdrop click. */}
            {notice}
          </div>
        )}
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
