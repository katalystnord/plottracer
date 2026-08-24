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
   * ⛔ `markEnds` IS GONE (v2.4), and its absence is the point.
   *
   * It drew the two axis ENDS as their own labelled marks, because on a bar
   * chart they were placed by a fold-out and nothing else on screen owned them.
   * They are CALIBRATION STEPS now (`Cat 1`, `Cat n`), so the walk draws a
   * handle at each of those pixels, names it in the card's chip row and lets it
   * be dragged - and drawing them here as well put two markers on one pixel and
   * printed a label across the axis line.
   *
   * ⚑ The heatmap already passed `false` for the same reason at one remove: its
   * outer boundaries are ordinary dividers, so marking them separately would
   * assert a distinction the model does not make. With the bar chart's ends now
   * owned by the calibration, NOTHING wanted them marked here, and an option
   * every caller declines is not an option. [[feedback_delete_unreachable_code]]
   */
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
  return [axis, ...ticks];
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
  /** The axis's own unit vector - the only direction a tick may travel. */
  const axisLen = Math.hypot(edges[1].x - edges[0].x, edges[1].y - edges[0].y);
  const along =
    axisLen > 0
      ? { x: (edges[1].x - edges[0].x) / axisLen, y: (edges[1].y - edges[0].y) / axisLen }
      : { x: 1, y: 0 };
  const ticks: CanvasMarker[] = tickPoints.map((p, i) => ({
    id: tickId(i),
    x: p.x + stand.x * TICK_LENGTH,
    y: p.y + stand.y * TICK_LENGTH,
    label: '',
    color,
    draggable: true,
    // ⚑⚑ AND THE DRAG IS BOUND TO THE AXIS ON SCREEN, not only in the record.
    // `moveTick` has always PROJECTED the drop point onto the axis and clamped
    // it between its neighbours - so the model was right and the picture was
    // not: the mark leaned off the axis under the cursor and snapped back on
    // release, teaching the user that a tick off the axis is a thing they might
    // get. CLAUDE.md pattern 4, and the same `dragLine` the error cap already
    // declares for the same reason.
    // ⚑ It became MORE visible, not less, once the mark and its grip travelled
    // together: before, only a 4px square swung out.
    dragLine: { origin: { x: p.x + stand.x * TICK_LENGTH, y: p.y + stand.y * TICK_LENGTH }, direction: along },
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
  return ticks;
}

/** The tick index a marker id refers to, or null when the id is not one of ours. */
export function categoryTickIndexFromId(id: string): number | null {
  const m = /^categoryTick(\d+)$/.exec(id);
  if (!m) return null;
  return Number(m[1]);
}

// ---------------------------------------------------------------------------
// The categorical STAGE - stage 2 of the calibration card
// ---------------------------------------------------------------------------

/**
 * ⚑⚑ THIS SECTION USED TO BE A STATE MACHINE FOR A FLOW THAT NO LONGER EXISTS.
 *
 * It carried `CategoryTickPhase` (`unavailable` | `closed` | `mark-axis` |
 * `declaring`), the prompts for a two-click marking gesture, a seed pixel and
 * the label of the calibration handle it was borrowed from, a "place both edges"
 * escape hatch, a refusal message for a second click that landed on the first, a
 * measured note about a span that looked too short to be a whole axis, and an
 * OFFER line that had to argue for opening the fold-out at all.
 *
 * All of it existed because the category axis was marked by a fold-out AFTER
 * calibration, seeded from a value-axis handle. Since v2.4 it is two steps of
 * the calibration walk (`BAR_AXES_CONFIG.fixedSteps`), so:
 *
 *   · there is no phase - the stage exists exactly when the type declares one;
 *   · there is no prompt here - each click has its own step prompt, in the walk,
 *     beside the handle it places;
 *   · there is no seed, so nothing has to name the handle it was taken from;
 *   · there is no short-span note, because there is no click that can be
 *     mistaken for the end of the first category - the step says "the outer edge
 *     of the LAST category";
 *   · and there is no offer, because a required step is not offered.
 *
 * ▶ What is left is what the heatmap's stage has: a SUMMARY LINE and what the
 * rebuilding control costs. [[feedback_delete_unreachable_code]].
 */

/** The stage's summary line - the sibling of `heatmapGridLine`.
 *
 * ⚑ It states what the CALIBRATION declared, and says so; and it reports the
 * stage as finished only once the ending has actually been pressed, never merely
 * because ticks exist. Ticks exist the moment the walk completes now, so "there
 * are ticks" is not evidence that anyone has looked at them. */
export function categoryStageLine(count: number, marked: boolean): string {
  const n = count === 1 ? '1 category' : `${count} categories`;
  return marked ? `Categories - ${n} ✓` : `Categories - ${n}`;
}

/**
 * What re-generating would cost, or null when it would cost nothing.
 *
 * ⚑⚑ IT IS NOT A STANDING LINE, and it is not red. It used to appear the moment
 * a tick had been dragged - the one CONSTRUCTIVE gesture the whole design rests
 * on - and warn, in the colour this app uses for errors, about the consequences
 * of OTHER, future actions. A feature cannot ask for a gesture and warn against
 * it in the same breath. It travels with the control that would actually rebuild.
 */
export function categoryRegenerateWarning(hasAdjustments: boolean): string | null {
  return hasAdjustments
    ? 'Changing the tick convention rebuilds these ticks evenly and discards the ones you moved.'
    : null;
}

/**
 * Shown once the ticks are up, because dragging them is otherwise invisible.
 *
 * ⚑ The ticks are small marks with no label and no tooltip of their own.
 * "Drag any of them if the figure isn't evenly spaced" lived only in MANUAL, and
 * a capability whose only announcement is the manual fails the keystone rule
 * (v2.1 audit). It rides on the control that GENERATED them.
 */
export const CATEGORY_TICK_DRAG_HINT =
  'Ticks not lining up? Drag any of them along the axis - the figure may not be evenly spaced.';

/**
 * The two words the user reads for a `TickConvention`, in ONE place.
 *
 * ⚑⚑ THE HEATMAP'S WORDS, AND NOW LITERALLY THE HEATMAP'S STRINGS. This used to
 * say `Under each category` / `Between categories` while
 * `HEATMAP_AXES_CONFIG.options` said `Centres` / `Boundaries` for the identical
 * fact, so one question wore two vocabularies and nothing on screen said they
 * were the same question. David: *"we should be CONSISTENT and use the same
 * mechanism / drawing in all places so that users can recognize them easily."*
 * The heatmap's own choices are built from this constant, so they cannot drift
 * apart again.
 */
export const CONVENTION_LABELS: Record<TickConvention, string> = {
  centred: 'Centres',
  edge: 'Boundaries',
};
