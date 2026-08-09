import type { ToolMode } from './toolMode.js';

/**
 * What a bare click on the figure MEANS. Carrying it out stays in `Workspace.tsx`.
 *
 * ⚑ WHY THIS IS WORTH ITS OWN MODULE, small as it is. `place-point` is this
 * router's FALLTHROUGH: every mode that does not claim the click ends up adding
 * a data point. That default has produced the same defect more than once — a
 * rail-wired mode with no branch of its own silently fabricating a raw point in
 * the active series while the user was aiming at something else. The v0.8
 * "By colour" bug is the case that named it: clicking the curve is exactly what
 * the sibling Flood-fill mechanism wants, so the gesture is natural, and the
 * fabricated point poisons the record invisibly until export (tenets 1 and 9).
 *
 * Every `ignore` below is therefore a DEFENSIVE no-add guard, not dead code, and
 * the property that matters is a single sentence: **only Place Point may add.**
 * That is now one assertion instead of an invitation to read carefully.
 */

export type CanvasClickRoute =
  /** One sampler, routed by target (ckpt 90) — it intercepts before any tool. */
  | { kind: 'sample-colour'; target: 'grid' | 'series' | 'trace' }
  /** The click does nothing, deliberately. */
  | { kind: 'ignore' }
  /** Select never adds; a click on empty canvas clears instead. */
  | { kind: 'clear-selection' }
  | { kind: 'measure' }
  /** Capture is mandatory step 1 (ckpt 103) — refuse, and say what to do. */
  | { kind: 'capture-first'; message: string }
  | { kind: 'calibrate' }
  | { kind: 'segment-fill' }
  | { kind: 'interpolate' }
  | { kind: 'add-point' };

export interface CanvasClickInput {
  /** Armed eyedropper, or null. Outranks every tool. */
  eyedropper: 'grid' | 'series' | 'trace' | null;
  mode: ToolMode;
  /** The figure-of-record has been frozen. */
  figureCaptured: boolean;
}

/**
 * The one mode a bare canvas click may turn into a data point.
 *
 * Exported so the guard can be asserted against the router rather than restated
 * in a test — a list that agrees with itself proves nothing.
 */
export const ADDS_POINT_ON_CLICK: readonly ToolMode[] = ['place-point'];

export function routeCanvasClick({ eyedropper, mode, figureCaptured }: CanvasClickInput): CanvasClickRoute {
  // Eyedropper intercepts the click before any tool action.
  if (eyedropper) return { kind: 'sample-colour', target: eyedropper };
  if (mode === 'pan') return { kind: 'ignore' };
  // Error bars are captured by DRAGGING, not clicking (ckpt 79). An explicit
  // branch, because a stray click would otherwise drop a data point into the
  // active series while the user was aiming at a cap.
  if (mode === 'error-bars') return { kind: 'ignore' };
  // Auto-extract ▸ By colour traces via the Trace button, NOT a canvas click
  // (v0.8) — the bug that named this whole guard family. The eyedropper path
  // above already returned, so this only guards a bare click.
  if (mode === 'color-trace') return { kind: 'ignore' };
  // Select (David 2026-07-21): NEVER adds. In practice a select-mode press is
  // intercepted by the marquee drag in ImageCanvas, so this rarely fires; when
  // it does, we clear rather than place. The user-facing clear paths are Esc and
  // an empty-space marquee, both advertised in the tips bar.
  if (mode === 'select') return { kind: 'clear-selection' };
  // Eraser removes a point on a MARKER click; a bare canvas click must not fall
  // through to addDataPoint.
  if (mode === 'eraser') return { kind: 'ignore' };
  // Image-edit tools are card buttons, not canvas clicks.
  if (mode === 'image-edit') return { kind: 'ignore' };
  if (mode === 'measure') return { kind: 'measure' };
  if (mode === 'calibrate') {
    // You cannot place an axis point until the figure-of-record is established,
    // so autosave always has a stable figure and it cannot shift mid-work
    // (David). The Capture button is on the calibration card.
    if (!figureCaptured) {
      return {
        kind: 'capture-first',
        message:
          'Capture the figure first — frame the whole figure in the window, then press “Capture figure”. What you see is what you capture.',
      };
    }
    return { kind: 'calibrate' };
  }
  if (mode === 'segment-fill') return { kind: 'segment-fill' };
  if (mode === 'interpolate') return { kind: 'interpolate' };
  return { kind: 'add-point' };
}
