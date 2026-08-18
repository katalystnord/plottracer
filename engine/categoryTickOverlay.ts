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
 * The rendering reuses what ImageCanvas already has rather than adding a path:
 * segments (like a histogram's bin glyph) for the marks, and ordinary markers
 * for the drag handles.
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
 * The axis line, its two end marks and one mark per tick, as segment runs.
 *
 * Empty when no axis is marked - an unmarked session draws nothing, which is
 * what makes the whole feature invisible until someone asks for it.
 */
export function categoryAxisGlyphs({
  edges,
  tickPoints,
  markEnds = true,
}: CategoryOverlayInput): GlyphSegment[][] {
  if (!edges) return [];
  const n = outwardNormal(edges);
  if (!n) return [];

  const axis: GlyphSegment = {
    from: { x: edges[0].x, y: edges[0].y },
    to: { x: edges[1].x, y: edges[1].y },
  };
  // The edges are drawn across the axis, the ticks only outward from it - so an
  // end never reads as one more category divider.
  const ends: GlyphSegment[] = markEnds
    ? [edges[0], edges[1]].map((p) => ({
        from: { x: p.x - n.x * EDGE_LENGTH, y: p.y - n.y * EDGE_LENGTH },
        to: { x: p.x + n.x * EDGE_LENGTH, y: p.y + n.y * EDGE_LENGTH },
      }))
    : [];
  const ticks: GlyphSegment[] = tickPoints.map((p) => ({
    from: { x: p.x, y: p.y },
    to: { x: p.x + n.x * TICK_LENGTH, y: p.y + n.y * TICK_LENGTH },
  }));
  return [[axis, ...ends, ...ticks]];
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
  const ends: CanvasMarker[] = !markEnds
    ? []
    : [
        { id: 'categoryAxisStart', x: edges[0].x, y: edges[0].y, label: 'Categories start' },
        { id: 'categoryAxisEnd', x: edges[1].x, y: edges[1].y, label: 'Categories end' },
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
  /** What the fold-out asks for next; null when it is asking nothing. */
  prompt: string | null;
  /** Shown before anything that regenerates, or null when nothing would be lost. */
  regenerateWarning: string | null;
  /** The seed can stand in for the first edge, so only one click is needed. */
  canReuseSeed: boolean;
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

  if (!supported || !isCalibrated) {
    return { phase: 'unavailable', prompt: null, regenerateWarning: null, canReuseSeed: false };
  }
  if (!open) {
    return { phase: 'closed', prompt: null, regenerateWarning: null, canReuseSeed };
  }
  if (!hasGeometry) {
    // ⚑ The prompt says which click is expected, because "mark the category
    // axis" alone leaves the user guessing whether one point or two is wanted -
    // and the answer differs depending on whether P1 can stand in for the first.
    const prompt = canReuseSeed
      ? `Click where the categories end. ${seedLabel} (the amber handle) is being reused as the start - press Re-place axis if that is wrong.`
      : edgesPlaced === 0
        ? 'Click where the categories start, then where they end.'
        : 'Now click where the categories end.';
    return { phase: 'mark-axis', prompt, regenerateWarning: null, canReuseSeed };
  }
  return {
    phase: 'declaring',
    prompt: null,
    // Only ever shown when there is something to lose. A warning that appears
    // when nothing would be discarded teaches the user to ignore it.
    regenerateWarning: hasAdjustments
      ? 'Changing the count or the tick style, or re-placing the axis, rebuilds the ticks evenly and discards the ones you moved.'
      : null,
    canReuseSeed: false,
  };
}

/** Whether a canvas click should be taken as placing a category-axis edge. */
export function isMarkingCategoryAxis(view: CategoryPanelView): boolean {
  return view.phase === 'mark-axis';
}

/** The fold-out's own summary line - it has to say when this is worth opening,
 * because nothing else on screen will. */
export function categoryPanelSummary(hasGeometry: boolean, categoryCount: number): string {
  if (!hasGeometry) return 'Mark category ticks?';
  return categoryCount === 1 ? 'Category ticks - 1 category' : `Category ticks - ${categoryCount} categories`;
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
