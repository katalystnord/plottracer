import type { AxesTypeConfig, CalibratedAxes } from './calibrationSession.js';

/**
 * The tool rail's vocabulary, and the one pure decision that reads it.
 *
 * ⚑ Lives here rather than in `Workspace.tsx` for the reason
 * `engine/captureProgress.ts` gives at the top of its own file: a decision kept
 * inside the React component is reachable only by launching Electron, so the
 * feedback loop on it is the ~20-minute e2e and mutation testing cannot see it
 * at all. `autoExtractModesFor` decides which rail buttons a graph type offers -
 * a capability question, answered from the type's declared `autoExtractKind` -
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
  | 'interpolate'
  | 'find-lines'
  | 'cut'
  // The Data extraction card is open and none of its tools is picked: a click on the figure adds nothing.
  | 'extract'
  // The Legend card is open (rail 3, v2.7): the legend and masked areas are marked by a drag, never a click.
  | 'legend';

/** The modes fronted by the single Auto-extract rail tool. Find lines (v2.6)
 * comes first because, where it applies, it does the whole job in one press. */
export const AUTO_EXTRACT_MODES: readonly ToolMode[] = ['find-lines', 'segment-fill', 'color-trace', 'interpolate'];

/**
 * The Data extraction tool (rail 4, v2.7): Place point, the Auto-extract mechanisms and Cut, in one card, in the
 * order David settled (docs/v2.7-workflow-walk.md, The Data extraction card). Each keeps its own mode and canvas
 * behaviour; `'extract'` is the card open with none of them picked, which is how it always opens.
 */
export const DATA_EXTRACTION_TOOLS: readonly ToolMode[] = ['find-lines', 'color-trace', 'segment-fill', 'interpolate', 'place-point', 'cut'];
export const DATA_EXTRACTION_MODES: readonly ToolMode[] = ['extract', ...DATA_EXTRACTION_TOOLS];

/**
 * Which of the card's tools apply to a graph type; the others are greyed in their place. The automatic ones are
 * `autoExtractModesFor`'s answer, Split a line goes with Find lines (lines are the record), and Place points
 * applies everywhere but a heatmap, whose cells are read at the end of the calibration card.
 */
export function dataExtractionToolsFor(
  config: Pick<AxesTypeConfig<CalibratedAxes>, 'autoExtractKind' | 'id'>,
  // ⚑ A Trace Challenge round is traced by hand (David, 2026-11-08: "manual-only"): the automatic tools are greyed in
  // their places, and Place points (with Split a line where lines are the record) is what is left.
  { byHand = false }: { byHand?: boolean } = {}
): readonly ToolMode[] {
  if (config.id === 'heatmap') return [];
  const auto = byHand ? [] : autoExtractModesFor(config.autoExtractKind, config.id);
  return DATA_EXTRACTION_TOOLS.filter(
    (m) => auto.includes(m) || m === 'place-point' || (m === 'cut' && findLinesKind(config.id) !== null)
  );
}

/** Why an automatic tool is greyed during a Trace Challenge round. */
export const BY_HAND_REASON = 'The Trace Challenge is traced by hand.';

/**
 * Does Find lines apply to this graph type, and as what?
 *
 * Only to the two types whose record is LINES on a plain x/y plane: XY curves
 * (which may cross) and Contour lines (which never cross - a rule Find lines
 * uses). Answered by the type's id, not by spreading a flag through the
 * configs, because Histogram and Heatmap are built by spreading XY's config
 * and would silently inherit it.
 */
export function findLinesKind(configId: string): 'curves' | 'contours' | null {
  if (configId === 'xy') return 'curves';
  if (configId === 'contour') return 'contours';
  return null;
}

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
  kind: AxesTypeConfig<CalibratedAxes>['autoExtractKind'],
  configId?: string
): readonly ToolMode[] {
  const k = kind ?? 'curve';
  if (k === 'none') return [];
  if (k === 'curve') return AUTO_EXTRACT_MODES.filter((m) => m !== 'find-lines' || (configId !== undefined && findLinesKind(configId) !== null));
  return ['color-trace'];
}

/** The tools that open a card of their own: the left fold-outs, and Calibrate, whose card is the one at the top. */
const TOOLS_WITH_A_CARD: readonly ToolMode[] = ['legend', 'image-edit', 'error-bars', 'measure', 'calibrate', ...DATA_EXTRACTION_MODES];

/**
 * The tool left picked when a card is closed by clicking its rail icon again (v2.7). It goes back to the tool used
 * before the card, as it always has, unless that tool has a card of its own: then to Pan. David, 2026-11-04, closing
 * Data extraction and getting the Legend card: closing a card never opens another one.
 */
export function toolAfterClosingCard(before: ToolMode): ToolMode {
  return TOOLS_WITH_A_CARD.includes(before) ? 'pan' : before;
}
