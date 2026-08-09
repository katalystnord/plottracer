import type { AxesTypeConfig, CalibratedAxes } from './calibrationSession.js';

/**
 * The tool rail's vocabulary, and the one pure decision that reads it.
 *
 * ⚑ Lives here rather than in `Workspace.tsx` for the reason
 * `engine/captureProgress.ts` gives at the top of its own file: a decision kept
 * inside the React component is reachable only by launching Electron, so the
 * feedback loop on it is the ~20-minute e2e and mutation testing cannot see it
 * at all. `autoExtractModesFor` decides which rail buttons a graph type offers —
 * a capability question, answered from the type's declared `autoExtractKind` —
 * and it had no unit test of its own until it moved out.
 */

// 'segment-fill' | 'color-trace' | 'interpolate' are the three AUTO-EXTRACT
// mechanisms (v0.8): one rail tool ("Auto-extract", the wand) fronts all three,
// and its fold-out card switches between them. They stay distinct MODES so each
// keeps its own canvas behaviour (flood on click / colour pick + Trace / guide
// points) unchanged -- the umbrella is a presentation wrapper, not a rewrite.
export type ToolMode =
  | 'pan'
  | 'calibrate'
  | 'place-point'
  | 'select'
  | 'eraser'
  | 'segment-fill'
  | 'color-trace'
  | 'measure'
  | 'image-edit'
  | 'error-bars'
  | 'interpolate';

/** The three modes fronted by the single Auto-extract rail tool. */
export const AUTO_EXTRACT_MODES: readonly ToolMode[] = ['segment-fill', 'color-trace', 'interpolate'];

/** Which of the three Auto-extract modes actually apply to a graph type's
 * declared `autoExtractKind` (generalizes the spider-only restriction
 * checkpoint 122 introduced -- v2.0 Phase 7 adds a second restricted kind
 * for Bar, so this is now the one place both are decided instead of two
 * separate special cases). `'curve'` (undeclared/default) offers all three;
 * `'along-axes'` (Spider) and `'bounding-box'` (Bar, and Histogram since
 * 2026-07-30) both have exactly one sensible reading path -- By colour -- so
 * Flood-fill/Guide points would run and silently record nothing; `'none'`
 * offers none at all (auto-extract is refused outright: Box Plot,
 * categorical Line -- neither has a shape a colour trace could reduce to). */
export function autoExtractModesFor(
  kind: AxesTypeConfig<CalibratedAxes>['autoExtractKind']
): readonly ToolMode[] {
  const k = kind ?? 'curve';
  if (k === 'none') return [];
  if (k === 'curve') return AUTO_EXTRACT_MODES;
  return ['color-trace'];
}
