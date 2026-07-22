/**
 * Icon-only toolbar buttons (checkpoint 24, see CLAUDE.md), sourced from
 * the top-level icons/ directory -- a straight copy of ui-patches/icons/
 * (Ketcher, Apache-2.0, plus Katalyst Nord's own custom/ originals; see
 * icons/NOTICE and icons/LICENSE) per the target module structure in
 * CLAUDE.md's "Product #1 — rebuild design". Imported with Vite's `?raw`
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
import handSvg from '../../icons/hand.svg?raw';
import plusSvg from '../../icons/plus.svg?raw';
import deleteSvg from '../../icons/delete.svg?raw';
import clearSvg from '../../icons/clear.svg?raw';
// Eraser (per-point delete tool, David 2026-07-22): a discoverable click-to-
// remove-a-point mode, distinct from the top-bar "Clear all points". Reinstates
// the retired eraser art (icons/erase.svg), normalized to 24x24.
import eraseSvg from '../../icons/erase.svg?raw';
import openSvg from '../../icons/open.svg?raw';
import placePointSvg from '../../icons/custom/place-point.svg?raw';
import segmentFillSvg from '../../icons/custom/segment-fill.svg?raw';
import chevronDownSvg from '../../icons/custom/chevron-down.svg?raw';
import undoSvg from '../../icons/undo.svg?raw';
import redoSvg from '../../icons/redo.svg?raw';
import imageSvg from '../../icons/custom/image.svg?raw';
import saveSvg from '../../icons/custom/save.svg?raw';
import exportSvg from '../../icons/custom/export.svg?raw';
import boxPlotSvg from '../../icons/custom/box-plot.svg?raw';
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
import interpolateSvg from '../../icons/custom/interpolate.svg?raw';
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
import selectSvg from '../../icons/custom/select.svg?raw';

function Icon({ svg }: { svg: string }) {
  return <span aria-hidden="true" style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const HandIcon = () => <Icon svg={handSvg} />;
export const PlusIcon = () => <Icon svg={plusSvg} />;
export const DeleteIcon = () => <Icon svg={deleteSvg} />;
export const EraseIcon = () => <Icon svg={eraseSvg} />;
export const ClearIcon = () => <Icon svg={clearSvg} />;
export const OpenIcon = () => <Icon svg={openSvg} />;
// The reticle glyph (icons/custom/place-point.svg) is used for the CALIBRATE
// tool: it deliberately mirrors the on-canvas calibration markers, while Place
// Point uses the plus (swapped 2026-07-13 -- a reticle on Place Point read as a
// calibration point).
export const CalibrateIcon = () => <Icon svg={placePointSvg} />;
export const SegmentFillIcon = () => <Icon svg={segmentFillSvg} />;
export const ChevronDownIcon = () => <Icon svg={chevronDownSvg} />;
export const UndoIcon = () => <Icon svg={undoSvg} />;
export const RedoIcon = () => <Icon svg={redoSvg} />;
export const ImageIcon = () => <Icon svg={imageSvg} />;
export const SaveIcon = () => <Icon svg={saveSvg} />;
export const ExportIcon = () => <Icon svg={exportSvg} />;
export const BoxPlotIcon = () => <Icon svg={boxPlotSvg} />;
export const GridRemovalIcon = () => <Icon svg={gridRemovalSvg} />;
export const CurveFitIcon = () => <Icon svg={curveFitSvg} />;
export const GeometryIcon = () => <Icon svg={geometrySvg} />;
export const HelpIcon = () => <Icon svg={helpSvg} />;
export const MeasureIcon = () => <Icon svg={measureSvg} />;
export const ImageEditIcon = () => <Icon svg={imageEditSvg} />;
export const ErrorBarsIcon = () => <Icon svg={errorBarsSvg} />;
export const InterpolateIcon = () => <Icon svg={interpolateSvg} />;
export const CameraIcon = () => <Icon svg={cameraSvg} />;
export const AutoTraceIcon = () => <Icon svg={autoTraceSvg} />;
export const SelectIcon = () => <Icon svg={selectSvg} />;
