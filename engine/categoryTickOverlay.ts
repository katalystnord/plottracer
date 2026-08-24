/**
 * Category tick overlay + fold-out state (v2.1).
 *
 * Two pure pieces, both extracted out of `ui/` on purpose: the geometry that
 * DRAWS the marked category axis, and the small state machine deciding what the
 * "Mark category ticks?" fold-out is asking for at any moment. Neither touches
 * React, so both are reachable by mutation testing, which `ui/` is not.
 *
 * ⚑ Ticks are an AID. Nothing here decides a measured value - a bar reads its
 * value from the calibrated value axis, and auto-extract finds bars from ink.
 * These functions decide what is DRAWN and what is ASKED, and nothing else.
 *
 * ⚑⚑ A MARK IS ONE OBJECT. It used to be two - a segment painted in the bin
 * glyph layer plus a separate square handle standing 14px away - which is the
 * error-bar cap defect arriving by another door. See `AidGlyph`.
 */

import type { CategoryAxisPoint, TickConvention } from '../core/categoryAxis.js';
import type { CanvasMarker } from './canvasOverlays.js';
import type { GlyphSegment } from './histogramGlyph.js';

/** How far a tick mark stands off the axis, in image pixels. Long enough to
 * read as a tick rather than a speck, short enough not to bury the bar above
 * it - the same judgement histogramGlyph.ts's own EDGE_TICK makes. */
const TICK_LENGTH = 14;

/** The axis EDGES stand off further, and to both sides, so they read as the
 * ends of a thing rather than as two more ticks. They are not ticks: the user
 * placed them, they are frozen, and every generated mark derives from them. */
const EDGE_LENGTH = 11;

/**
 * ⚑⚑ THE STRUCTURE VIOLET - every mark the USER placed on the figure's frame.
 * Category ticks and their axis ends, a heatmap's grid dividers, the bar
 * drag-box, and the picked highlight in both the canvas and the results matrix.
 *
 * ⚑ Deliberately NOT the calibration amber. The category axis's first edge sits
 * on the very same pixel as P1, so borrowing P1's colour would put two different
 * kinds of thing in one place wearing one uniform.
 *
 * ⚠️ THE COMMENT ALREADY SAID IT WAS SHARED - *"the violet the bar drag-box
 * already uses"* - and the sharing was done by COPYING THE LITERAL. The v2.2
 * audit found the same colour at SEVEN sites in THREE spellings (`#7c3aed`,
 * `rgb(124, 58, 237)`, `rgba(…)`), with a second constant `GRID_OVERLAY_COLOR`
 * of its own, while this exported one had a single consumer: itself. Grepping
 * the NAME found nothing; grepping the VALUE found all seven.
 * ⚑ So: import it, and build the translucent forms with `withAlpha` rather than
 * writing the channels out again.
 */
export const CATEGORY_TICK_COLOR = '#7c3aed';

/** The unit vector perpendicular to the axis, pointing away from the plot: down
 * for an upright chart, and rotating with the axis for anything else. Null for a
 * degenerate axis, which the model refuses to create in the first place. */
function outwardNormal(
  edges: readonly [CategoryAxisPoint, CategoryAxisPoint]
): { x: number; y: number } | null {
  const dx = edges[1].x - edges[0].x;
  const dy = edges[1].y - edges[0].y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len === 0) return null;
  // (-dy, dx) sends a left-to-right axis to (0, +1), which is DOWN in image
  // coordinates - where a chart prints its ticks.
  return { x: -dy / len, y: dx / len };
}

export interface CategoryOverlayInput {
  edges: readonly [CategoryAxisPoint, CategoryAxisPoint] | null;
  tickPoints: readonly CategoryAxisPoint[];
  /**
   * Draw the two ends as their own labelled, non-draggable marks.
   *
   * ⚑⚑ TRUE FOR A BAR CHART, FALSE FOR A HEATMAP, and the difference is real
   * rather than cosmetic. A bar chart's axis edges are FROZEN: every tick is a
   * function of them, so dragging one rescales the lot - they are a different
   * kind of thing and are marked as one. A heatmap's outer boundaries are
   * ORDINARY DIVIDERS that drag like any other (the two-layer model: the
   * CALIBRATION is the axis, the grid merely derives from it), so marking them
   * separately would assert a distinction the model does not make.
   */
  markEnds?: boolean;
  /** Identity for tick `i`. Defaults to v2.1's `categoryTick<i>`; a heatmap
   * brings `hmx:3`, which is what its drag handler answers to. */
  tickId?: (index: number) => string;
  /** Overrides the violet, for a caller whose marks mean something else. */
  color?: string;
}

/**
 * ONE DRAWN THING PER MARK, with the identity of the handle it IS.
 *
 * ⚑⚑ THIS TYPE EXISTS BECAUSE A TICK USED TO BE TWO OBJECTS. The mark was a
 * `GlyphSegment` painted in the bin-glyph layer (`listening={false}`, and in
 * that layer's BLACK, not this feature's violet); the grab target was a separate
 * violet square standing 14px away at the mark's outer end. So the thing you
 * could see was not the thing you could grab, they were different colours, and
 * nothing recomputed the mark while the square was being dragged - it stayed
 * frozen until release. David, reading the loupe: *"Why is the tick marker these
 * two separate pieces and you can only move one?"*
 *
 * ⚑⚑ AND IT IS THE ERROR-BAR CAP DEFECT, UNSWEPT. `ImageCanvas` already carries
 * the cure in its own words, written for `kind: 'cap'`: *"two objects for one
 * thing, one moved live by Konva and the other frozen until release, so they
 * visibly separated while the record stayed perfectly correct... this marker
 * draws NOTHING. Its whole job is to be grabbable... There is no second object
 * left that COULD drift."* That rule was applied to caps and stopped there.
 * A found bug is a search query, not a ticket closed.
 *
 * ▶ So a mark is now ONE thing: its segments and its grip are drawn together, in
 * its own colour, from this one description, and the renderer translates the
 * whole of it by the live drag while its marker is under the cursor.
 */
export interface AidGlyph {
  /**
   * The marker this mark IS, so the renderer can follow its drag live - the same
   * link `errorBarGlyphs`' `capMarkerId` provides. Null for a mark nobody can
   * drag (the axis line, the two frozen ends).
   */
  markerId: string | null;
  segments: GlyphSegment[];
  /** Where to draw the square grip, or null for a mark that is not a handle. */
  grip: { x: number; y: number } | null;
  /** Half-width of that grip, in screen pixels. The picked one is drawn bigger,
   * because the card names a boundary in data units and the user has to find it
   * among a dozen identical marks. */
  gripRadius?: number;
  /** Draw the picked ring - the same highlight the marker layer used to own. */
  selected?: boolean;
  color: string;
}

/**
 * The axis line, its two end marks and one mark per tick.
 *
 * Empty when no axis is marked - an unmarked session draws nothing, which is
 * what makes the whole feature invisible until someone asks for it.
 */
export function categoryAidGlyphs({
  edges,
  tickPoints,
  markEnds = true,
  tickId = (i) => `categoryTick${i}`,
  color = CATEGORY_TICK_COLOR,
}: CategoryOverlayInput): AidGlyph[] {
  if (!edges) return [];
  const n = outwardNormal(edges);
  if (!n) return [];

  const axis: AidGlyph = {
    markerId: null,
    grip: null,
    color,
    segments: [
      { from: { x: edges[0].x, y: edges[0].y }, to: { x: edges[1].x, y: edges[1].y } },
    ],
  };
  // The edges are drawn across the axis, the ticks only outward from it - so an
  // end never reads as one more category divider. They carry no marker id: every
  // tick is a function of them, so they are deliberately not draggable.
  const ends: AidGlyph[] = markEnds
    ? [edges[0], edges[1]].map((p) => ({
        markerId: null,
        grip: null,
        color,
        segments: [
          {
            from: { x: p.x - n.x * EDGE_LENGTH, y: p.y - n.y * EDGE_LENGTH },
            to: { x: p.x + n.x * EDGE_LENGTH, y: p.y + n.y * EDGE_LENGTH },
          },
        ],
      }))
    : [];
  // ⚑ THE MARK AND ITS GRIP, IN ONE DESCRIPTION. The grip sits at the mark's
  // outer end exactly where the separate square used to, so nothing moves on
  // screen - what changes is that they are now one object with one identity, and
  // the renderer moves both together.
  const ticks: AidGlyph[] = tickPoints.map((p, i) => ({
    markerId: tickId(i),
    grip: { x: p.x + n.x * TICK_LENGTH, y: p.y + n.y * TICK_LENGTH },
    color,
    segments: [
      { from: { x: p.x, y: p.y }, to: { x: p.x + n.x * TICK_LENGTH, y: p.y + n.y * TICK_LENGTH } },
    ],
  }));
  return [axis, ...ends, ...ticks];
}

/**
 * Drag handles for the ticks.
 *
 * ⚑ The axis EDGES get no handle, and that is the point: everything else is a
 * function of them, so dragging one would rescale every tick at once and
 * silently discard any the user had adjusted. Re-placing the axis is available
 * from the fold-out, where it can say so first. A handle here would make the
 * destructive gesture the easiest one to reach.
 */
export function categoryTickMarkers({
  edges,
  tickPoints,
  markEnds = true,
  tickId = (i) => `categoryTick${i}`,
  color = CATEGORY_TICK_COLOR,
}: CategoryOverlayInput): CanvasMarker[] {
  if (!edges) return [];
  // ⚑ The two EDGES get a visible, LABELLED, non-draggable mark. Drawing them
  // only as glyph segments made them invisible in practice: the segments carry
  // no colour, so they rendered dark straight on top of the figure's own axis,
  // and the marked SPAN could not be seen at all -- you could see where the
  // categories started only because P1 happens to sit there. Caught by David
  // reading a screenshot, which is the instrument that keeps finding these.
  //
  // Not draggable, and that stays deliberate: every tick is a function of these
  // two, so dragging one rescales the lot and discards any the user adjusted.
  // Visible is not the same as grabbable, and the labels say which is which.
  //
  // ⚑⚑ AND BOTH LABELS LEAN INWARD (v2.3). They used to take the fixed
  // up-and-to-the-right offset every label has, so on David's figure the right
  // one was CUT to `Categ` at the plot boundary - the axis ends where the figure
  // does, and the text ran off it. `labelAway` is aimed at a point just OUTSIDE
  // each end, which makes the label's direction point back along the axis: it
  // grows into the span rather than off the edge, and the renderer right-aligns
  // it when it points left so the text never crosses its own marker.
  // ⚑ The other half of that finding - the left label overlapping `P1=0` - is
  // gone for a different reason: a committed calibration no longer labels its
  // anchors at all (see `buildCanvasMarkers`).
  const outward = { x: edges[1].x - edges[0].x, y: edges[1].y - edges[0].y };
  const ends: CanvasMarker[] = !markEnds
    ? []
    : [
        {
          id: 'categoryAxisStart',
          x: edges[0].x,
          y: edges[0].y,
          label: 'Categories start',
          labelAway: { x: edges[0].x - outward.x, y: edges[0].y - outward.y },
        },
        {
          id: 'categoryAxisEnd',
          x: edges[1].x,
          y: edges[1].y,
          label: 'Categories end',
          labelAway: { x: edges[1].x + outward.x, y: edges[1].y + outward.y },
        },
      ].map((m) => ({
        ...m,
        color,
        draggable: false,
        kind: 'calibration' as const,
        radius: 5,
      }));
  // ⚑⚑ THE HANDLE SITS AT THE OUTER END OF ITS TICK, not on the axis line.
  // Two reasons, and the second is a defect the first would have hidden:
  //  · it stays visibly BOUND to the axis - the mark connects it - where the
  //    retired heatmap handles floated 16px away with nothing joining them;
  //  · and on a heatmap BOTH axes meet at the plot's corner, so an x boundary
  //    and a y boundary at the origin land on the SAME PIXEL. A click there
  //    picked whichever came first. Standing each handle off along its own
  //    axis's outward normal separates them by construction.
  const n = outwardNormal(edges);
  const stand = n ?? { x: 0, y: 0 };
  const ticks: CanvasMarker[] = tickPoints.map((p, i) => ({
    id: tickId(i),
    x: p.x + stand.x * TICK_LENGTH,
    y: p.y + stand.y * TICK_LENGTH,
    label: '',
    color,
    draggable: true,
    // ⚑⚑ THE WHOLE MARK IS THE HIT AREA, not just the grip at its end. The mark
    // is what the user sees and therefore what they reach for; before this it
    // was paint with no hit area at all, so reaching for it did nothing and the
    // only thing that worked was a 4px square 14px away. See `AidGlyph`.
    hitFrom: { x: p.x, y: p.y },
    // ⚑⚑ AN AID, NOT A PRECISE REFERENCE. These used to be `calibration`, which
    // draws the crosshair reticle that exists - in its own comment - "so an axis
    // handle reads as a precise reference, not a data dot". A divider is the
    // opposite: something you drag onto the figure's own rule by eye. Drawing
    // both alike claimed a nudged boundary had a calibration point's authority,
    // and invited the calibration point to be dragged as casually as a divider.
    // The two-layer model made visible - the axis is calibrated, the grid
    // DERIVES from it.
    // ⚑ It also separates the pair that COINCIDE under the `edge` convention
    // (B1/B2): a derived end sitting on its calibration point was two identical
    // marks on one pixel, indistinguishable by construction.
    kind: 'aid' as const,
    radius: 4,
  }));
  return [...ends, ...ticks];
}

/** The tick index a marker id refers to, or null when the id is not one of ours. */
export function categoryTickIndexFromId(id: string): number | null {
  const m = /^categoryTick(\d+)$/.exec(id);
  if (!m) return null;
  return Number(m[1]);
}

// ---------------------------------------------------------------------------
// The fold-out
// ---------------------------------------------------------------------------

export type CategoryTickPhase = 'unavailable' | 'closed' | 'mark-axis' | 'declaring';

export interface CategoryPanelInput {
  /** The graph type has categories at all. */
  supported: boolean;
  /** The value axis is calibrated - the fold-out appears after it, not during. */
  isCalibrated: boolean;
  /** The user has opened the fold-out. */
  open: boolean;
  /** An axis has been marked. */
  hasGeometry: boolean;
  /** The pixel of the seed calibration step, if placed - offered as the first edge. */
  seedPixel: { px: number; py: number } | null;
  /**
   * The LABEL of the calibration handle being reused as the axis' first edge -
   * 'P1' on a bar chart, 'V1' on a categorical Line.
   *
   * ⚠️ It was the literal string 'P1', and extending category ticks to Line
   * (v2.3) gave a chart whose handle is labelled V1 a prompt telling the user to
   * look for a P1 that is not on the figure. Gate 4's exact class: a prompt may
   * only name what is actually on screen. `categoryTicks.originStep` was always
   * a NAME rather than a literal for this reason; this is the prompt catching up.
   */
  seedLabel: string;
  /** How many edges are down in the current marking gesture (0 or 1). */
  edgesPlaced: number;
  /** A tick has been dragged since the last generation. */
  hasAdjustments: boolean;
  /**
   * The user asked to place BOTH ends by hand - "Re-place axis".
   *
   * ⚑ Without this the seed always wins and the two-click walk is unreachable:
   * `seedPixel` is P1, which exists the moment the figure is calibrated, so
   * `canReuseSeed` was permanently true, `edgesPlaced` permanently 0, and the
   * two prompts below were dead strings. P1 is only the category axis's corner
   * on a chart calibrated AT the corner - its own prompt is "a known bar value
   * (e.g. 0)", and clicking the 0 gridline mid-plot is perfectly ordinary
   * calibration, which anchored the category axis in the middle of the figure
   * with nothing on screen able to move it (v2.1 audit).
   */
  placeBothEdges: boolean;
  /** A COUNT has been declared, so ticks exist rather than merely an axis. */
  hasDeclaredCount?: boolean;
  /** The figure's own size in pixels - the only frame available for judging
   * whether a marked span is plausibly a whole category axis. */
  imageSize?: { width: number; height: number } | null;
  /** The span just marked, in pixels, when there is one. */
  spanPx?: number | null;
}

/** Why a click could not become an axis edge. Null when nothing has failed. */
export type CategoryMarkError = 'too-close' | null;

/**
 * What to say when `markCategoryAxis` refuses.
 *
 * ⚑ A REFUSAL WITH NO VISIBLE REASON is the shape this project has been bitten
 * by repeatedly, and the fold-out had one: if the second click lands on the seed
 * pixel (or on the first edge), `setAxisEdges` refuses a zero-length axis, the
 * handler returns having done nothing, and the prompt is unchanged. The user
 * clicks and the app appears to ignore them (code review, 2026-08-10).
 */
export function categoryMarkMessage(error: CategoryMarkError): string | null {
  return error === 'too-close'
    ? 'That is the same point as the start of the axis - click where the categories END, further along.'
    : null;
}

export interface CategoryPanelView {
  phase: CategoryTickPhase;
  /** What the card asks for next; null when it is asking nothing. */
  prompt: string | null;
  /**
   * What the REBUILDING controls have to say before they are used, or null.
   *
   * ⚑⚑ IT IS NO LONGER A STANDING LINE ON THE CARD (v2.3). It used to appear the
   * moment a tick had been dragged, in RED - so David did the one CONSTRUCTIVE
   * thing the whole design rests on, adjusting a marker, and was answered with
   * what read as an error about other, future actions. A feature cannot ask for a
   * gesture and warn against it in the same breath.
   * ▶ The information is real and belongs ON the controls that rebuild - the
   * count, the tick style, Re-place axis - as what they will cost when used.
   */
  regenerateWarning: string | null;
  /** The seed can stand in for the first edge, so only one click is needed. */
  canReuseSeed: boolean;
  /**
   * What was MEASURED about a span that looks too short to be a whole category
   * axis, or null.
   *
   * ⚑ IT REPORTS, IT DOES NOT REFUSE. David clicked the end of the FIRST
   * category on a four-category chart, because the prompt said "click where the
   * categories end" and read cold that is exactly what it means. Nothing said
   * anything. But a figure whose category axis really is a small part of the
   * image exists, and a hard refusal would make it unmarkable - so this states
   * the measurement and names the way back.
   * ⚑ The live markers are the other half, and the better half: with a count
   * declared they appear at once, so a wrong span is visible in a second.
   */
  spanNote: string | null;
  /** `Read categories` has something to read. */
  canRead: boolean;
  /** Why it has not, for the disabled button to say. Null when it can. */
  readBlockedReason: string | null;
}

/**
 * What the fold-out is doing right now.
 *
 * ⚑ The fold-out appears only once the value axis is CALIBRATED, and never
 * gates it. A bar chart still calibrates in two clicks and a single-series chart
 * never needs any of this - the whole feature is an offer made after the work
 * that matters is already done.
 */
export function categoryPanelView(input: CategoryPanelInput): CategoryPanelView {
  const { supported, isCalibrated, open, hasGeometry, seedPixel, seedLabel, edgesPlaced, hasAdjustments } =
    input;
  const canReuseSeed = seedPixel !== null && edgesPlaced === 0 && !input.placeBothEdges;
  const blank = {
    prompt: null,
    regenerateWarning: null,
    spanNote: null,
    canRead: false,
    readBlockedReason: null,
  };

  if (!supported || !isCalibrated) {
    return { ...blank, phase: 'unavailable', canReuseSeed: false };
  }
  if (!open) {
    return { ...blank, phase: 'closed', canReuseSeed };
  }
  if (!hasGeometry) {
    // ⚑⚑ THE PROMPT NAMES THE FAR EDGE OF THE WHOLE AXIS, and that wording is
    // the fix (v2.3). It used to read "Click where the categories end", and
    // David clicked the end of the FIRST category on a four-category chart -
    // read cold, that is exactly what the sentence means. It is CLAUDE.md gate 4
    // for the second time: v2.2's shared-corners walk sent its second click to
    // the wrong corner in the same way, and both were found only when a person
    // made the gesture.
    const prompt = canReuseSeed
      ? `Click the FAR END of the whole category axis - past the last category, not the end of the first. ${seedLabel} (the amber handle) is the start; press Re-place axis if that is wrong.`
      : edgesPlaced === 0
        ? 'Click where the category axis STARTS, before the first category, then its FAR END past the last.'
        : 'Now click the FAR END of the axis, past the last category.';
    return {
      ...blank,
      phase: 'mark-axis',
      prompt,
      canReuseSeed,
      readBlockedReason: 'Mark the category axis first - then this reads the categories.',
    };
  }
  const declaredCount = input.hasDeclaredCount ?? true;
  return {
    ...blank,
    phase: 'declaring',
    // ⚑ On the CONTROLS that rebuild, not standing on the card - see the field.
    // Still only where there is something to lose: a warning that appears when
    // nothing would be discarded teaches the user to ignore it.
    regenerateWarning: hasAdjustments
      ? 'This rebuilds the ticks evenly and discards the ones you moved.'
      : null,
    spanNote: shortSpanNote(input.spanPx ?? null, input.imageSize ?? null),
    canReuseSeed: false,
    canRead: declaredCount,
    readBlockedReason: declaredCount
      ? null
      : 'Say how many categories there are first - then this reads them.',
  };
}

/**
 * Under a QUARTER of the figure's longer side, which is where a marked span
 * stops being plausible as a whole category axis.
 *
 * ⚑ A JUDGEMENT, AND SAID OUT LOUD RATHER THAN BURIED. There is no plot box in
 * the record to compare against, so the image is the only frame available. A
 * fifth of a figure is a legitimate axis on a small inset; a quarter is where it
 * is worth ASKING. Nothing is refused either way.
 */
const SHORT_SPAN_FRACTION = 0.25;

function shortSpanNote(
  spanPx: number | null,
  imageSize: { width: number; height: number } | null
): string | null {
  if (spanPx === null || !imageSize) return null;
  const longSide = Math.max(imageSize.width, imageSize.height);
  if (!(longSide > 0) || !(spanPx > 0)) return null;
  const fraction = spanPx / longSide;
  if (fraction >= SHORT_SPAN_FRACTION) return null;
  return `That axis covers about ${Math.round(fraction * 100)}% of the figure. If the categories run further, press Re-place axis.`;
}

/** Whether a canvas click should be taken as placing a category-axis edge. */
export function isMarkingCategoryAxis(view: CategoryPanelView): boolean {
  return view.phase === 'mark-axis';
}

/** What the stage's own line says, and whether it is asking for attention. */
export interface CategoryOffer {
  text: string;
  /**
   * The app has EVIDENCE that leaving the categories unmarked will cost
   * something, so the line stops being a quiet offer and becomes the next step.
   */
  promoted: boolean;
}

/**
 * The stage's own line - it has to say when this is worth opening, because
 * nothing else on screen will.
 *
 * ⚑⚑ IT SPEAKS UP ONLY WHEN THE APP HAS EVIDENCE (v2.3, theme E / C). David:
 * *"Are there instances where we would not want to mark their categories now?
 * Or would it in fact always happen?"* Both halves have an answer, and they
 * differ:
 *
 *   ONE series, unmarked - the export's `Position` is a left-to-right ordinal
 *   computed from that series' own pixels, which is a faithful statement about
 *   it. Marking adds nothing, and asking would spend the user's attention on a
 *   chart that never needed it.
 *
 *   TWO series, unmarked - the same ordinal is now being read as a coordinate
 *   the two SHARE, which it is not. A series missing one category slides every
 *   later reading one place: every number plausible, nothing on screen wrong.
 *   That is the tenet-11 failure `Line` was fixed for, arriving through the
 *   other door.
 *
 * ⚠️ EVIDENCE, NEVER PREDICTION (tenet 9's habit applied to a prompt). It fires
 * on series that CARRY READINGS - what was captured - not on series that exist,
 * and not on what the user might do next.
 *
 * ⛔ AND IT DOES NOT BLOCK. Tenet 1: nothing may put constraints on graph in ->
 * reliable data out. What changes is what the card SAYS, and what the FILE
 * claims (`getExportFields` stops calling an unshared ordinal `Position`), never
 * what the user is allowed to do. A prompt that cannot be ignored is a refusal
 * wearing a prompt's clothes.
 */
export function categoryOffer(
  hasGeometry: boolean,
  categoryCount: number,
  seriesWithReadings: number,
  /**
   * A count was DECLARED, rather than a list of categories having accumulated
   * some other way.
   *
   * ⚑⚑ THE CARD USED TO ASSERT `2 categories` WITH THE COUNT FIELD EMPTY, on a
   * figure with four - because two bars had been captured and the shared name
   * list had two entries. A count nobody typed, reported as fact, is exactly the
   * fabricated-category defect the v2.1 work was supposed to have closed,
   * arriving through a different door. Say what was declared, or say that
   * nothing was.
   */
  hasDeclaredCount = true
): CategoryOffer {
  if (hasGeometry) {
    if (!hasDeclaredCount) {
      return { text: 'Category ticks - axis marked, no count yet', promoted: true };
    }
    return {
      text:
        categoryCount === 1
          ? 'Category ticks - 1 category'
          : `Category ticks - ${categoryCount} categories`,
      promoted: false,
    };
  }
  // ⚑ It states WHAT IT SAW and what that costs, in the vocabulary the panel
  // hint already uses ("which bar belongs to which, instead of it guessing from
  // position"). A prompt that gives its reason can be judged; one that only
  // insists has to be obeyed or ignored.
  if (seriesWithReadings > 1) {
    return { text: `${seriesWithReadings} series - mark category ticks to pair them`, promoted: true };
  }
  return { text: 'Mark category ticks?', promoted: false };
}

/**
 * Why someone would open it. Shown inside, once, rather than as a tooltip.
 *
 * ⚑ The third sentence is the one a user looking at a MERGED RUN needs. Splitting
 * touching same-coloured bars at the marked boundaries is the biggest thing this
 * feature buys, and it was documented only in MANUAL - so someone staring at the
 * exact figure it helps had nothing on screen telling them to open the fold-out
 * (v2.1 audit).
 */
export const CATEGORY_PANEL_HINT =
  'Recommended for charts with more than one series, or where a series is missing a bar. ' +
  'Marking the categories tells PlotTracer which bar belongs to which, instead of it guessing from position. ' +
  'It also lets Auto-extract split a run of touching same-coloured bars at the boundaries you mark.';

/**
 * Shown once the ticks are up, because dragging them is otherwise invisible.
 *
 * ⚑ The ticks are 4px dots with no label and no tooltip. "Drag any of them if
 * the figure isn't evenly spaced" lived only in MANUAL, and the sole hint on
 * screen was the regenerate warning's "discarding the ones you moved" - legible
 * only to someone who already knew. A capability whose only announcement is the
 * manual fails the keystone rule (v2.1 audit).
 */
export const CATEGORY_TICK_DRAG_HINT =
  'Ticks not lining up? Drag any of them along the axis - the figure may not be evenly spaced.';

/** The convention labels, kept here so the two words the user reads are next to
 * the code that acts on them. */
export const CONVENTION_LABELS: Record<TickConvention, string> = {
  centred: 'Under each category',
  edge: 'Between categories',
};
