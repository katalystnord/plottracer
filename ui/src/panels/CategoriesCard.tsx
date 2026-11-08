import { theme } from '../theme.js';
import { WarningLine } from './WarningLine.js';
import { CATEGORY_TICK_DRAG_HINT, CONVENTION_LABELS } from '../../../engine/categoryTickOverlay.js';
import type { TickConvention } from '../../../core/categoryAxis.js';
import { namesRow } from '../../../engine/categoryStageRows.js';
import { StageRow } from './StageRow.js';

/**
 * The categorical stage - stage 2 of the calibration card, for Bar, Box Plot and
 * categorical Line (v2.3).
 *
 * ⚑⚑ IT IS `HeatmapCard`'s SIBLING, DELIBERATELY AND VISIBLY. David, putting the
 * two cards side by side: *"So it is a two stage fold out card, mirroring exactly
 * heatmaps, and when we unfold from a calibrated state, then we show both card
 * content at the same time, exact mirroring heatmaps."* And, on what happens when
 * a thirteenth type needs two stages: *"I will give you a hint. Mirror the
 * process from heatmaps."*
 *
 * ⚠️ WHAT THIS REPLACES, so nobody rebuilds it. The categorical stage was not a
 * card at all - it was a fold-out INSIDE the card, behind a teal `Mark
 * categories` entry button, with its own bordered section, its own count box,
 * its own vocabulary for the tick convention, a `Re-place axis` and a `Remove
 * ticks` beside it, and two paragraphs of rationale. Beside the heatmap's stage
 * 2 it read as a different feature by a different author. Every one of those
 * controls is GONE rather than restyled:
 *
 *   · the entry button - the stage is not optional any more, so there is
 *     nothing to enter. David: *"not have 'Mark categories' ready before it can
 *     actually do it."*
 *   · the count box - the count is declared ON the second calibration click, and
 *     is shown here, never re-collected. That is the heatmap's own rule, in its
 *     own words: *"A CATEGORY AXIS IS NOT ASKED TWICE."*
 *   · `Re-place axis` - the axis IS two calibration steps now, and a calibration
 *     handle is dragged where it stands, like every other one.
 *   · `Remove ticks` - there is no state with an axis and no ticks to get back to.
 *   · the rationale - a required step does not have to argue for itself.
 *
 * ⚑ WHAT IS LEFT IS WHAT E6's TEST ADMITS: an ACTION of this stage, or STATE you
 * need in order to choose between those actions. The ending lives on the summary
 * row outside this body, exactly as `Read cells` does, and for the reason that
 * move was made: everything on screen said READY while the one action that
 * finishes the job sat inside a closed fold-out inside a closed card.
 */
export interface CategoriesCardProps {
  /**
   * How many categories the CALIBRATION declared - shown, never re-collected.
   * `null` when the walk has not got there yet, which is only reachable on a
   * figure that arrived part-calibrated (a WPD import, a pre-v2.3 project).
   */
  declared: number | null;
  convention: TickConvention;
  onConventionChange: (convention: TickConvention) => void;
  /**
   * What changing the convention would cost, or null when nothing would be lost.
   *
   * ⚑ ONLY WHERE THERE IS SOMETHING TO LOSE, which is the bar chart's own rule
   * written on its own `regenerateWarning`: a warning that appears when nothing
   * would be discarded teaches the user to ignore it. And it is in the quiet
   * colour, not the error colour - it cautions about something that has not
   * happened, it does not refuse something attempted.
   */
  regenerateWarning: string | null;
  /**
   * Arm the label-band drag (v2.4) - or absent where there is no axis to read
   * against yet.
   *
   * ⚑ THE OFFER LIVES BESIDE THE COUNT IT WILL FILL. A category's name and its
   * place on the axis are the same card's business, so the button that reads the
   * names sits where the axis is already being described - not in the rail,
   * where it would be a capability with no visible connection to what it fills.
   */
  onReadLabels?: () => void;
  /** True while the next drag is the label band, so the button says so. */
  readingArmed?: boolean;
  /**
   * Look for the tick marks the FIGURE draws, and move the ticks onto them.
   *
   * ⚑ David, driving the built app: *"The ticks were not auto detected
   * properly... I have to move them by hand. Was there a button for that?"*
   * There was not - the detector existed with no callers and no surface, which
   * is a capability that does not exist as far as anyone using the app is
   * concerned.
   */
  onDetectTicks?: () => void;
  /** What the last look found, in one sentence, and whether it failed (then it carries the warning
   * triangle, as every message that something could not be done does), or null before one was made. */
  detectNotice?: { text: string; failed: boolean } | null;
  /** The names [Automatic axis detection] read, offered on the Names row until used or withdrawn (v2.7), or null. */
  nameOffer?: { count: number; onUse: () => void; onCheck: () => void } | null;
}

export function CategoriesCard({
  declared,
  convention,
  onConventionChange,
  regenerateWarning,
  onReadLabels,
  readingArmed = false,
  onDetectTicks,
  detectNotice = null,
  nameOffer = null,
}: CategoriesCardProps) {
  const names = namesRow({ offered: nameOffer?.count ?? null, readingArmed });
  return (
    <div
      data-testid="categories-card"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: theme.font.size.small }}
    >
      {/* ⚑⚑ NO COUNT BOX, AND THE COUNT SAID ONCE. How many categories the figure has is declared on the second
          category click in the walk and shown on the Calibration heading ("6 categories"); a line here
          repeating it was the same fact twice (David, 2026-11-04: "things in many different places on the card").
          Only an undeclared axis gets a line, because then there is something to say: where the count comes from. */}
      {declared === null && (
        <span data-testid="category-declared" style={{ color: theme.color.text.secondary }}>
          The calibration has not placed the category axis yet - its last two clicks are the axis ends.
        </span>
      )}
      {/* ⚑ TICKS AT: the convention and the button that replaces its even guess with the figure's own ticks, on one
          row, because they answer the same question. Two RADIOS, not a select: both readings stay visible, and
          flipping one moves the marks on screen, which is the whole answer. The words are the heatmap's own. */}
      <StageRow name="Ticks at" testId="category-ticks-row">
        <fieldset
          style={{ border: 'none', margin: 0, padding: 0, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
        >
          {(['edge', 'centred'] as TickConvention[]).map((c) => (
            <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                name="category-convention"
                data-testid={`category-convention-${c}`}
                checked={convention === c}
                onChange={() => onConventionChange(c)}
                title={CATEGORY_TICK_DRAG_HINT}
              />
              <span style={{ whiteSpace: 'nowrap' }}>{CONVENTION_LABELS[c]}</span>
            </label>
          ))}
        </fieldset>
        {onDetectTicks && declared !== null && (
          <button
            type="button"
            data-testid="detect-ticks"
            onClick={onDetectTicks}
            style={{ fontSize: 12 }}
            title="Look just outside the axis for the tick marks the figure draws, and move the ticks onto them"
          >
            Find the figure&apos;s own ticks
          </button>
        )}
      </StageRow>
      {detectNotice &&
        (detectNotice.failed ? (
          <WarningLine id="detect-ticks-notice" text={detectNotice.text} />
        ) : (
          <span data-testid="detect-ticks-notice" style={{ color: theme.color.text.secondary }}>
            {detectNotice.text}
          </span>
        ))}
      {/* ⚑⚑ NAMES: ONE ROW FOR WHATEVER WRITES THEM. The names detection read are offered here, and with no offer the
          row holds the reader's button; both fill the same Category column, so they share one place on the card
          (David, 2026-11-04) instead of an offer under the header and a button at the foot. */}
      {declared !== null && (onReadLabels || names.kind === 'offer') && (
        <StageRow name="Names" testId="category-names-row">
          {names.kind === 'offer' && nameOffer ? (
            <span data-testid="name-offer" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span>{names.text}</span>
              <button type="button" data-testid="name-offer-use" onClick={nameOffer.onUse} style={{ fontSize: 12 }}>
                Use them
              </button>
              <button type="button" data-testid="name-offer-check" onClick={nameOffer.onCheck} style={{ fontSize: 12 }}>
                Check them
              </button>
            </span>
          ) : (
            onReadLabels && (
              <button
                type="button"
                data-testid="ocr-read-labels"
                onClick={onReadLabels}
                style={{ fontSize: 12 }}
                title="Read the category names off the figure instead of typing them"
              >
                {names.kind === 'read' ? names.label : ''}
              </button>
            )
          )}
        </StageRow>
      )}
      {/* ⚑ No `# Series (optional)` box (David, 2026-11-07: "yes. :)"): nothing read it since f6178fe (2026-08-10). */}
      {regenerateWarning && (
        <span data-testid="category-regenerate-warning" style={{ color: theme.color.text.secondary }}>
          {regenerateWarning}
        </span>
      )}
    </div>
  );
}
