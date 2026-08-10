/**
 * Category tick overlay + fold-out state (v2.1).
 *
 * Two pure pieces, both extracted out of `ui/` on purpose: the geometry that
 * DRAWS the marked category axis, and the small state machine deciding what the
 * "Mark category ticks?" fold-out is asking for at any moment. Neither touches
 * React, so both are reachable by mutation testing, which `ui/` is not.
 *
 * ⚑ Ticks are an AID. Nothing here decides a measured value — a bar reads its
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
 * it — the same judgement histogramGlyph.ts's own EDGE_TICK makes. */
const TICK_LENGTH = 14;

/** The axis EDGES stand off further, and to both sides, so they read as the
 * ends of a thing rather than as two more ticks. They are not ticks: the user
 * placed them, they are frozen, and every generated mark derives from them. */
const EDGE_LENGTH = 11;

/** Colour of the marked category axis and its ticks. Deliberately the calibration
 * amber of P1 rather than a new hue — this geometry is placed the same way a
 * calibration handle is, even though it is not one. */
export const CATEGORY_TICK_COLOR = '#e0a458';

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
  // coordinates — where a chart prints its ticks.
  return { x: -dy / len, y: dx / len };
}

export interface CategoryOverlayInput {
  edges: readonly [CategoryAxisPoint, CategoryAxisPoint] | null;
  tickPoints: readonly CategoryAxisPoint[];
}

/**
 * The axis line, its two end marks and one mark per tick, as segment runs.
 *
 * Empty when no axis is marked — an unmarked session draws nothing, which is
 * what makes the whole feature invisible until someone asks for it.
 */
export function categoryAxisGlyphs({ edges, tickPoints }: CategoryOverlayInput): GlyphSegment[][] {
  if (!edges) return [];
  const n = outwardNormal(edges);
  if (!n) return [];

  const axis: GlyphSegment = {
    from: { x: edges[0].x, y: edges[0].y },
    to: { x: edges[1].x, y: edges[1].y },
  };
  // The edges are drawn across the axis, the ticks only outward from it — so an
  // end never reads as one more category divider.
  const ends: GlyphSegment[] = [edges[0], edges[1]].map((p) => ({
    from: { x: p.x - n.x * EDGE_LENGTH, y: p.y - n.y * EDGE_LENGTH },
    to: { x: p.x + n.x * EDGE_LENGTH, y: p.y + n.y * EDGE_LENGTH },
  }));
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
export function categoryTickMarkers({ edges, tickPoints }: CategoryOverlayInput): CanvasMarker[] {
  if (!edges) return [];
  return tickPoints.map((p, i) => ({
    id: `categoryTick${i}`,
    x: p.x,
    y: p.y,
    label: '',
    color: CATEGORY_TICK_COLOR,
    draggable: true,
    kind: 'calibration' as const,
    radius: 4,
  }));
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
  /** The value axis is calibrated — the fold-out appears after it, not during. */
  isCalibrated: boolean;
  /** The user has opened the fold-out. */
  open: boolean;
  /** An axis has been marked. */
  hasGeometry: boolean;
  /** The pixel of the seed calibration step, if placed — offered as the first edge. */
  seedPixel: { px: number; py: number } | null;
  /** How many edges are down in the current marking gesture (0 or 1). */
  edgesPlaced: number;
  /** A tick has been dragged since the last generation. */
  hasAdjustments: boolean;
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
 * never needs any of this — the whole feature is an offer made after the work
 * that matters is already done.
 */
export function categoryPanelView(input: CategoryPanelInput): CategoryPanelView {
  const { supported, isCalibrated, open, hasGeometry, seedPixel, edgesPlaced, hasAdjustments } =
    input;
  const canReuseSeed = seedPixel !== null && edgesPlaced === 0;

  if (!supported || !isCalibrated) {
    return { phase: 'unavailable', prompt: null, regenerateWarning: null, canReuseSeed: false };
  }
  if (!open) {
    return { phase: 'closed', prompt: null, regenerateWarning: null, canReuseSeed };
  }
  if (!hasGeometry) {
    // ⚑ The prompt says which click is expected, because "mark the category
    // axis" alone leaves the user guessing whether one point or two is wanted —
    // and the answer differs depending on whether P1 can stand in for the first.
    const prompt = canReuseSeed
      ? 'Click where the categories end. The value origin is already the start — drag it later if that is wrong.'
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
      ? 'Changing the count or the tick style rebuilds the ticks evenly, discarding the ones you moved.'
      : null,
    canReuseSeed: false,
  };
}

/** Whether a canvas click should be taken as placing a category-axis edge. */
export function isMarkingCategoryAxis(view: CategoryPanelView): boolean {
  return view.phase === 'mark-axis';
}

/** The fold-out's own summary line — it has to say when this is worth opening,
 * because nothing else on screen will. */
export function categoryPanelSummary(hasGeometry: boolean, categoryCount: number): string {
  if (!hasGeometry) return 'Mark category ticks?';
  return categoryCount === 1 ? 'Category ticks — 1 category' : `Category ticks — ${categoryCount} categories`;
}

/** Why someone would open it. Shown inside, once, rather than as a tooltip. */
export const CATEGORY_PANEL_HINT =
  'Recommended for charts with more than one series, or where a series is missing a bar. ' +
  'Marking the categories tells PlotTracer which bar belongs to which, instead of it guessing from position.';

/** The convention labels, kept here so the two words the user reads are next to
 * the code that acts on them. */
export const CONVENTION_LABELS: Record<TickConvention, string> = {
  centred: 'Under each category',
  edge: 'Between categories',
};
