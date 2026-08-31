import { theme } from '../theme.js';
import { CATEGORY_TICK_DRAG_HINT, CONVENTION_LABELS } from '../../../engine/categoryTickOverlay.js';
import type { TickConvention } from '../../../core/categoryAxis.js';

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
   * ⛔ `# Series (optional)` IS PARKED AND UNTOUCHED, by standing order. It is
   * carried across verbatim rather than redesigned or dropped, so this rebuild
   * does not quietly settle a question David has reserved.
   */
  seriesInput: string;
  onSeriesInputChange: (value: string) => void;
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
  /** What the last look found, in one sentence, or null before one was made. */
  detectNotice?: string | null;
}

export function CategoriesCard({
  declared,
  convention,
  onConventionChange,
  regenerateWarning,
  seriesInput,
  onSeriesInputChange,
  onReadLabels,
  readingArmed = false,
  onDetectTicks,
  detectNotice = null,
}: CategoriesCardProps) {
  return (
    <div
      data-testid="categories-card"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: theme.font.size.small }}
    >
      {/* ⚑⚑ NO COUNT BOX. How many categories the figure has is declared ONCE,
          on the second category click in the walk, and shown here. Two fields
          for one fact is how a heatmap's 5 met a typo'd 6 and detection refused
          the whole grid - and how this card came to print `axis marked, no count
          yet` beside a box reading 17. Correct it where it was declared: the
          calibration values are editable in place, above. */}
      {/* ⚑⚑ AND IT DOES NOT SAY `0 categories` WHEN NOBODY HAS SAID ANY. The
          count arrives on the second category click, so a figure whose walk is
          unfinished has none - and a zero presented as the figure's own count is
          the fabricated-count defect this card had once already, arriving
          through a door that did not exist when it was fixed. */}
      <span data-testid="category-declared" style={{ color: theme.color.text.secondary }}>
        {declared === null
          ? 'The calibration has not placed the category axis yet - its last two clicks are the axis ends.'
          : `${declared === 1 ? '1 category' : `${declared} categories`}, from the calibration`}
      </span>
      {/* ⚑⚑ THE HEATMAP'S OWN WORDS, not a second vocabulary for one fact. This
          control used to say `Under each category` / `Between categories` while
          the heatmap said `Centres` / `Boundaries` for the identical
          `TickConvention` - so the user had to be told that the two were the
          same question. David: *"we should be CONSISTENT and use the same
          mechanism / drawing in all places so that users can recognize them
          easily."*
          ⚑ Two RADIOS, not a select: both readings have to be visible without a
          click, because the user is being asked which one their figure prints,
          and flipping it moves the marks on screen, which is the whole answer. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ minWidth: 84 }}>ticks at</span>
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
                /* ⚑ THE DRAG SENTENCE IS THE TOOLTIP HERE (E6), exactly as the
                   heatmap's moved onto its boundary buttons. The convention is
                   what GENERATES evenly spaced ticks, so "they may not be evenly
                   spaced - drag them" belongs on the control that made them. */
                title={CATEGORY_TICK_DRAG_HINT}
              />
              <span style={{ whiteSpace: 'nowrap' }}>{CONVENTION_LABELS[c]}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ minWidth: 84 }}># Series (optional)</span>
        <input
          id="category-series-input"
          type="number"
          min={1}
          data-testid="category-series-count"
          value={seriesInput}
          onChange={(e) => onSeriesInputChange(e.target.value)}
          style={{ width: 56 }}
        />
      </label>
      {/* ⚑⚑ THE BIG WIN, AND IT HAS TO BE VISIBLE TO BE ONE (v2.4). Typing
          twelve category names is the tedious half of a bar chart, and a
          capability nobody can see does not exist - so the offer is a plain
          button on the card that describes the axis, and its own label says what
          the gesture will be. */}
      {onReadLabels && declared !== null && (
        <button
          type="button"
          data-testid="ocr-read-labels"
          onClick={onReadLabels}
          style={{ alignSelf: 'flex-start' }}
          title="Read the category names off the figure instead of typing them"
        >
          {readingArmed ? 'Drag a box round the labels...' : 'Read labels from the figure'}
        </button>
      )}
      {/* ⚑ BESIDE THE CONVENTION IT CORRECTS. The radios above generate ticks
          EVENLY from the two clicked ends; this is how you replace that guess
          with the positions the figure actually prints, so the two controls
          belong next to each other and in that order. */}
      {onDetectTicks && declared !== null && (
        <button
          type="button"
          data-testid="detect-ticks"
          onClick={onDetectTicks}
          style={{ alignSelf: 'flex-start' }}
          title="Look just outside the axis for the tick marks the figure draws, and move the ticks onto them"
        >
          Find the figure&apos;s own ticks
        </button>
      )}
      {detectNotice && (
        <span data-testid="detect-ticks-notice" style={{ color: theme.color.text.secondary }}>
          {detectNotice}
        </span>
      )}
      {regenerateWarning && (
        <span data-testid="category-regenerate-warning" style={{ color: theme.color.text.secondary }}>
          {regenerateWarning}
        </span>
      )}
    </div>
  );
}
