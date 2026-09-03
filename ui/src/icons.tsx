/**
 * Icon-only toolbar buttons (checkpoint 24, see CLAUDE.md), sourced from
 * the top-level icons/ directory -- a straight copy of ui-patches/icons/
 * (Ketcher, Apache-2.0, plus Katalyst Nord's own custom/ originals; see
 * icons/NOTICE and icons/LICENSE) per the target module structure in
 * CLAUDE.md's "Product #1 - rebuild design". Imported with Vite's `?raw`
 * suffix (raw string content, declared by vite/client -- see
 * ui/src/vite-env.d.ts) and inlined via dangerouslySetInnerHTML rather
 * than referenced by URL, since `fill="currentColor"` only resolves to
 * the surrounding text color when the <svg> is actually in the DOM, not
 * when loaded as an opaque <img> source -- required for these to pick up
 * the button's own color. Safe here specifically because the content is static,
 * build-time, trusted SVG markup, never derived from user input.
 *
 * "Place Point" has no equivalent in Ketcher's set or in WPD's own
 * images (it's a mode this app introduced explicitly in checkpoint 17) --
 * icons/custom/place-point.svg is a new hand-drawn original
 * (reticle: ring + center dot + 4 ticks), matching the existing custom/
 * set's 24×24 / currentColor / flat style.
 *
 * "Segment Fill" (checkpoint 26) is a second new original,
 * icons/custom/segment-fill.svg -- a paint bucket with a pouring drop.
 * The old (now-deleted) wpd-core/ui-patches app's Segment Fill button used
 * Ketcher's select-lasso.svg as a placeholder, flagged as not really
 * communicating "flood-fill trace a curve" -- rather than reuse that
 * known-weak placeholder here
 * too, or overload custom/droplet.svg (already means "Display Color"
 * elsewhere in this set, and reusing one icon for two unrelated actions
 * is exactly the ambiguity FIXME.md avoided for Box Plot/Edit Point
 * Groups), a paint bucket is the more universally recognized flood-fill
 * symbol (Paint/Photoshop/GIMP's own fill tool icon).
 *
 * "Chevron Down" (checkpoint 34) is a third new original,
 * icons/custom/chevron-down.svg -- a small filled downward triangle for
 * ZoomControls.tsx's dropdown indicator. Ketcher's own equivalent
 * (ZoomControls.tsx/ModeControl.tsx) uses a "chevron" icon from its own
 * asset set that has no equivalent here.
 */
import styled from '@emotion/styled';
import handSvg from '../../icons/hand.svg?raw';
import plusSvg from '../../icons/plus.svg?raw';
import deleteSvg from '../../icons/delete.svg?raw';
// Eraser (per-point delete tool, David 2026-07-22): a discoverable click-to-
// remove-a-point mode, distinct from the top-bar "Clear all points". Reinstates
// the retired eraser art (icons/erase.svg), normalized to 24x24.
import eraseSvg from '../../icons/erase.svg?raw';
import openSvg from '../../icons/open.svg?raw';
import placePointSvg from '../../icons/custom/place-point.svg?raw';
import chevronDownSvg from '../../icons/custom/chevron-down.svg?raw';
// Marks visibility (v2.5, David 2026-09-02): ONE control that takes every
// overlay mark off the figure at once, so what the paper actually printed can be
// seen whole. Two NEW originals rather than a reuse -- an eye is the symbol every
// tool uses for show/hide, on the same reasoning the paint bucket was chosen for
// flood-fill above, and nothing in this set already means "visibility"
// (custom/droplet.svg means "Display Color"). The icon SWAPS with the state
// rather than relying on the teal pressed treatment alone: the slash is the half
// that survives being looked at without hovering for a tooltip.
// Span chart (v2.5): a plain FLOATING bar chart - bars at different heights,
// none of them touching the faint baseline, which is the one thing the type is
// about (David: *"All three chart types reject a fixed zero baseline"*).
// ⚑ THE FAMILY IS VISIBLE IN THE PICKER WITHOUT A CAPTION: this same bar gains
// wicks to become a candlestick and a median plus whiskers to become a box plot.
// The same shape with more marks in it, which is the MIRROR rule doing real work.
import graphSpanSvg from '../../icons/custom/graph-span.svg?raw';
import marksVisibleSvg from '../../icons/custom/marks-visible.svg?raw';
import marksHiddenSvg from '../../icons/custom/marks-hidden.svg?raw';
// Eyedropper (David, 2026-07-27): the "Pick from image" buttons wore a bare ⌖
// glyph, which is the reticle Place Point already means. A pipette is the symbol
// every image editor uses for "sample a colour from the picture", and it is a NEW
// original rather than a reuse of custom/droplet.svg -- that one already means
// "Display Color" in this set, and one icon for two unrelated actions is the exact
// ambiguity the rest of this file exists to avoid.
import eyedropperSvg from '../../icons/custom/eyedropper.svg?raw';
import undoSvg from '../../icons/undo.svg?raw';
import redoSvg from '../../icons/redo.svg?raw';
import imageSvg from '../../icons/custom/image.svg?raw';
import saveSvg from '../../icons/custom/save.svg?raw';
import exportSvg from '../../icons/custom/export.svg?raw';
import gridRemovalSvg from '../../icons/custom/grid-removal.svg?raw';
import curveFitSvg from '../../icons/custom/curve-fit.svg?raw';
import geometrySvg from '../../icons/custom/geometry.svg?raw';
import helpSvg from '../../icons/custom/help.svg?raw';
import measureSvg from '../../icons/custom/measure.svg?raw';
import imageEditSvg from '../../icons/custom/image-edit.svg?raw';
// "Error Bars" (checkpoint 79) is another new original, icons/custom/error-bars.svg
// -- a datum with a cap above and below. Neither Ketcher's set nor wpd-core has
// anything for it: WPD reaches error bars through generic Point Groups, which has
// no icon at all (it is a popup), which is a large part of why its own author
// called the mechanism confusing. Same 24x24 / currentColor / flat style as the
// rest of custom/.
import errorBarsSvg from '../../icons/custom/error-bars.svg?raw';
// "Interpolate" (checkpoint 120) is another new original, icons/custom/interpolate.svg
// -- three big GUIDE-POINT dots joined by a DASHED curve. Redrawn dashed in v0.8
// (David): the old solid curve-through-dots was near-indistinguishable from the
// Curve Fit icon, and interpolation-assist is precisely the tool for DASHED /
// dash-differentiated curves, so a dashed line both disambiguates it from Curve
// Fit and states its purpose (the user drops the anchors; the dashed segment is
// the inferred fill between them). Same 24x24 / currentColor / flat style.
// "Camera" (v0.8) is another new original, icons/custom/camera.svg -- the
// "Capture figure" action's glyph. Replaces the 📸 emoji, which read poorly at
// button scale (David) and clashed with the set's clean line style. Same
// 24x24 / currentColor / stroke style as the rest of custom/.
import cameraSvg from '../../icons/custom/camera.svg?raw';
// "Auto-trace"/"Auto-extract" (v0.8) -- icons/custom/auto-trace.svg, a magic
// wand + sparkles: the universal "select/extract automatically" symbol. Replaces
// the paint-bucket the Auto-trace-by-colour panel borrowed from Segment Fill
// (David: the two read as the same tool). Now the umbrella Auto-extract tool's
// icon. Same 24x24 / currentColor style.
// (The old "Clear points" eraser icon was retired when per-point delete moved to
// the Select tool; "Clear all points" now uses the trash/DeleteIcon.)
import autoTraceSvg from '../../icons/custom/auto-trace.svg?raw';
// "Select" (data-point selector, subsumes delete) -- icons/custom/select.svg, a
// standard mouse-pointer arrow (David): the universal "select/edit" symbol. Clicks
// or box-drags to select DATA points (never calibration handles) for nudge/delete.
// The four Select sub-modes (v1.1 #6, Ketcher's select multi-tool). The rail
// Select button renders whichever one is the active sub-mode. Hybrid set (David):
// Rectangle + Lasso are Ketcher's own glyphs (icons/, Apache-2.0, attributed in
// icons/NOTICE like the rest of the Ketcher-derived set); Whole-series and Point
// are our clean-room originals (custom/) -- Ketcher's structure/fragment glyphs
// are molecule-specific and don't map to a data series or a single datum.
import selectBoxSvg from '../../icons/select-rectangle.svg?raw';
import selectLassoSvg from '../../icons/select-lasso.svg?raw';
import selectSeriesSvg from '../../icons/custom/select-series.svg?raw';
import selectPointSvg from '../../icons/custom/select-point.svg?raw';
// Graph-type glyphs (v2.0, David: plotdigitizer.com's one genuine advantage
// over this app was its icon+label CARD picker, not a plain text list --
// see project_chart_type_icons_backlog.md). One new original per type
// (24x24 / currentColor / flat-or-stroke, matching this set's existing
// style) except Box Plot, which reuses the icon already drawn for it.
import graphXySvg from '../../icons/custom/graph-xy.svg?raw';
import graphHistogramSvg from '../../icons/custom/graph-histogram.svg?raw';
// ⚑ A heatmap's glyph is a 3x3 of cells at DIFFERENT opacities - the one thing
// that distinguishes it from a plain grid at 24px, and the one thing a reader
// scanning the picker for "mine has coloured squares" is looking for.
import graphHeatmapSvg from '../../icons/custom/graph-heatmap.svg?raw';
import graphBarSvg from '../../icons/custom/graph-bar.svg?raw';
import graphCategoricalLineSvg from '../../icons/custom/graph-categorical-line.svg?raw';
import boxPlotSvg from '../../icons/custom/box-plot.svg?raw';
// ⚑ The icon TEACHES THE CONVENTION the overlay uses: one hollow candle (the
// period closed above where it opened) beside one filled candle (it closed
// below). A user who has seen the card knows what a filled body means before
// they place their first mark.
import graphCandlestickSvg from '../../icons/custom/graph-candlestick.svg?raw';
import graphPolarSvg from '../../icons/custom/graph-polar.svg?raw';
import graphSpiderSvg from '../../icons/custom/graph-spider.svg?raw';
import graphPieSvg from '../../icons/custom/graph-pie.svg?raw';
// Donut is not its own axes type (it's the multi-series pie pattern, same
// code path -- project_pie_charts_v16.md), so it has no entry in
// GRAPH_TYPE_ICONS below. It exists only for the Open Example list, whose
// donut row was otherwise visually identical to every other pie example
// (David: "for variety").
import graphDonutSvg from '../../icons/custom/graph-donut.svg?raw';
import graphTernarySvg from '../../icons/custom/graph-ternary.svg?raw';
import graphMapSvg from '../../icons/custom/graph-map.svg?raw';
import graphCcrSvg from '../../icons/custom/graph-ccr.svg?raw';

// Every icons/*.svg is hand-authored at a fixed 24x24 (this set's own
// convention). A caller that needs a SMALLER glyph (Workspace.tsx's Open
// Example list) must resize the raw injected <svg> itself via a real CSS
// rule, not a wrapper's own width/height + overflow:hidden -- the raw
// element arrives via dangerouslySetInnerHTML, so there is no React child
// to size directly, and a naive "shrink the wrapper and clip" approach
// visibly CUT two sides off every round glyph (David, driving the app):
// inline-flex centres the still-24x24 svg inside the smaller box before
// any transform is even in play, so the overflow clip lands symmetrically
// left/right and top/bottom instead of just shrinking the artwork.
const SizedIcon = styled('span')<{ size: number }>(({ size }) => ({
  display: 'inline-flex',
  '& svg': { width: size, height: size },
}));

function Icon({ svg, size }: { svg: string; size?: number }) {
  if (size != null) {
    return <SizedIcon aria-hidden="true" size={size} dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  return <span aria-hidden="true" style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const HandIcon = () => <Icon svg={handSvg} />;
export const PlusIcon = () => <Icon svg={plusSvg} />;
export const DeleteIcon = () => <Icon svg={deleteSvg} />;
export const EraseIcon = () => <Icon svg={eraseSvg} />;
export const OpenIcon = () => <Icon svg={openSvg} />;
// The reticle glyph (icons/custom/place-point.svg) is used for the CALIBRATE
// tool: it deliberately mirrors the on-canvas calibration markers, while Place
// Point uses the plus (swapped 2026-07-13 -- a reticle on Place Point read as a
// calibration point).
export const CalibrateIcon = () => <Icon svg={placePointSvg} />;
export const ChevronDownIcon = () => <Icon svg={chevronDownSvg} />;
export const MarksVisibleIcon = () => <Icon svg={marksVisibleSvg} />;
export const MarksHiddenIcon = () => <Icon svg={marksHiddenSvg} />;
export const EyedropperIcon = () => <Icon svg={eyedropperSvg} />;
export const UndoIcon = () => <Icon svg={undoSvg} />;
export const RedoIcon = () => <Icon svg={redoSvg} />;
export const ImageIcon = () => <Icon svg={imageSvg} />;
export const SaveIcon = () => <Icon svg={saveSvg} />;
export const ExportIcon = () => <Icon svg={exportSvg} />;
export const GridRemovalIcon = () => <Icon svg={gridRemovalSvg} />;
export const CurveFitIcon = () => <Icon svg={curveFitSvg} />;
export const GeometryIcon = () => <Icon svg={geometrySvg} />;
export const HelpIcon = () => <Icon svg={helpSvg} />;
export const MeasureIcon = () => <Icon svg={measureSvg} />;
export const ImageEditIcon = () => <Icon svg={imageEditSvg} />;
export const CameraIcon = () => <Icon svg={cameraSvg} />;
export const AutoTraceIcon = () => <Icon svg={autoTraceSvg} />;
export const SelectBoxIcon = () => <Icon svg={selectBoxSvg} />;
export const SelectLassoIcon = () => <Icon svg={selectLassoSvg} />;
export const SelectSeriesIcon = () => <Icon svg={selectSeriesSvg} />;
export const SelectPointIcon = () => <Icon svg={selectPointSvg} />;
// Graph-type icons (plus ErrorBarsIcon, reused by the Open Example list for
// its error-bars entry) all accept an optional `size` -- forwarded straight
// to Icon's own real-CSS resize, see SizedIcon above.
export interface GraphIconProps {
  size?: number;
}
export const ErrorBarsIcon = ({ size }: GraphIconProps = {}) => <Icon svg={errorBarsSvg} size={size} />;
export const GraphXyIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphXySvg} size={size} />;
export const GraphHistogramIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphHistogramSvg} size={size} />;
export const GraphHeatmapIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphHeatmapSvg} size={size} />;
export const GraphBarIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphBarSvg} size={size} />;
export const GraphCategoricalLineIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphCategoricalLineSvg} size={size} />;
export const GraphBoxPlotIcon = ({ size }: GraphIconProps = {}) => <Icon svg={boxPlotSvg} size={size} />;
export const GraphSpanIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphSpanSvg} size={size} />;
export const GraphCandlestickIcon = ({ size }: GraphIconProps = {}) => (
  <Icon svg={graphCandlestickSvg} size={size} />
);
export const GraphPolarIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphPolarSvg} size={size} />;
export const GraphSpiderIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphSpiderSvg} size={size} />;
export const GraphPieIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphPieSvg} size={size} />;
export const GraphDonutIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphDonutSvg} size={size} />;
export const GraphTernaryIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphTernarySvg} size={size} />;
export const GraphMapIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphMapSvg} size={size} />;
export const GraphCcrIcon = ({ size }: GraphIconProps = {}) => <Icon svg={graphCcrSvg} size={size} />;

/** Maps an AxesTypeConfig.id to its graph-type glyph -- the one lookup both
 * the Graph type card picker and the Open Example menu share, so the two
 * pickers can never silently drift to different icons for the same type.
 * 'donut' and 'errorbars' are the two keys with no matching AxesTypeConfig.id
 * (donut is the multi-series pie pattern, not a distinct axes type; error
 * bars are a rail tool on an ordinary XY series, not a graph type) -- both
 * exist only for the Open Example list's per-entry `icon` override, never
 * looked up by the card picker, which only ever queries real axes-type ids. */
export const GRAPH_TYPE_ICONS: Record<string, (props?: GraphIconProps) => React.JSX.Element> = {
  xy: GraphXyIcon,
  histogram: GraphHistogramIcon,
  heatmap: GraphHeatmapIcon,
  bar: GraphBarIcon,
  categorical: GraphCategoricalLineIcon,
  boxplot: GraphBoxPlotIcon,
  candlestick: GraphCandlestickIcon,
  span: GraphSpanIcon,
  polar: GraphPolarIcon,
  spider: GraphSpiderIcon,
  pie: GraphPieIcon,
  donut: GraphDonutIcon,
  ternary: GraphTernaryIcon,
  map: GraphMapIcon,
  ccr: GraphCcrIcon,
  errorbars: ErrorBarsIcon,
};
