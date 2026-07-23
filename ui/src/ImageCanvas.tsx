import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Konva from 'konva';
import { Stage, Layer, Group, Circle, Line, Rect, Image as KonvaImage, Text as KonvaText } from 'react-konva';

// Mouse model (David 2026-07-20): the middle button pans the view, so it must NOT
// also drag a Konva shape. Konva's default is [0, 1] (left AND middle) -- restrict
// shape-dragging to the left button so middle is purely a pan. (Ctrl+Left also
// pans; that shares button 0 with marker drags, so it is disarmed per-marker via
// onDragStart below rather than here.)
Konva.dragButtons = [0];

// macOS reserves Ctrl+click for its own context menu, so Ctrl+Left must not pan
// there (see onStageMouseDown). Platform detection lives in ./platform.
import { IS_MAC } from './platform.js';
import { fitToContainer, zoomAt, zoomByFactor, panBy, screenToImage, imageToScreen, isClick, type ViewState } from '../../engine/canvasView.js';
import type { BoxPlotGlyphSegment } from '../../engine/boxPlotGlyph.js';
import type { GlyphSegment } from '../../engine/histogramGlyph.js';
import type { CalibrationPreview } from '../../engine/calibrationPreview.js';
import { pagedDocumentFormat } from '../../engine/pdfDetect.js';
import { bytesToBase64 } from '../../engine/projectContainer.js';
import type { CropRect } from '../../engine/imageEdit.js';
import type { AvoidRect } from '../../engine/loupePosition.js';
import { Loupe } from './Loupe.js';
import { theme } from './theme.js';

// The formats PlotTracer can open, as a human-readable list for tooltips/hints.
// The raster/vector types decode straight through Chromium's <img> (what
// loadImageFromSrc relies on); PDF is opened via pdf.js instead (checkpoint 96),
// so it's listed too. Keep this in sync with electron-ipc.cjs's IMAGE_FILTERS
// (the native Open dialog's extension list) -- two files, one truth, same
// discipline as the preload's MENU_EVENT_CHANNELS allowlist vs its TS type.
export const SUPPORTED_IMAGE_FORMATS = 'PNG, JPG, GIF, BMP, WEBP, SVG, PDF, TIFF';

// Shared message when a file can't be opened -- a dropped/pasted unsupported
// type, or one forced through the "All Files" filter that then fails to decode.
// Names what does work and why the file didn't, rather than failing silently
// (the Parallel-Universe-David "no hidden failures" rule). PDF and TIFF (incl.
// multipage) ARE supported now (B7) -- routed by content to their decoders before
// this ever fires; this only catches a genuinely undecodable/corrupt file.
function unsupportedFileMessage(name: string): string {
  return `Can't open ${name} — PlotTracer reads ${SUPPORTED_IMAGE_FORMATS}.`;
}

/** Decode a `data:<mime>;base64,<payload>` URL to raw bytes -- used to hand a
 * PDF chosen via the native dialog (which returns a data URL) up to Workspace
 * as bytes, the same shape the drop/paste path produces from a File. */
function dataURLToBytes(dataURL: string): Uint8Array {
  const bin = atob(dataURL.slice(dataURL.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Thin React wrapper around engine/canvasView.ts's pure view-transform
 * math (checkpoint 2 of the engine/ui spike, see CLAUDE.md). This
 * component owns only DOM/canvas plumbing and React state; the actual
 * zoom/pan/click-vs-drag math lives in engine/ so it's framework-agnostic
 * and independently tested. imageSmoothingEnabled is forced off per the
 * zoom-quality fix already noted in CLAUDE.md's Phase 2 history
 * (nearest-neighbor scaling is what a plot digitizer needs when zoomed in
 * on pixel data, not smoothed interpolation).
 *
 * The base image stays plain Canvas2D; the marker overlay (calibration
 * handles, placed points) renders on a Konva layer stacked on top
 * (checkpoint 10/11, see CLAUDE.md) — per the original Product #1 design
 * of Canvas2D for the base image, Konva for the overlay. Since checkpoint
 * 12, the Konva Stage is the interactive surface: wheel-zoom, drag-pan and
 * click-to-add-point handlers live on the Stage (not the plain canvas
 * underneath), because a CSS `pointer-events: none` wrapper — needed while
 * the overlay was non-interactive — blocks Konva from ever seeing an event
 * regardless of its own `listening` flag. A background click/drag (where
 * `e.target === stage`) runs the existing pan/click logic unchanged;
 * a mousedown that lands on a draggable Circle instead bubbles from the
 * shape and is left alone so Konva's own built-in drag takes over.
 *
 * Also renders the floating cursor-following zoom loupe (see Loupe.tsx)
 * while hovering a loaded image, plus a small persistent x/y readout as
 * a fallback for continuous coordinate awareness (CLAUDE.md "Product #1
 * — rebuild design").
 *
 * Since checkpoint 22, an optional `boxPlotGlyphs` prop (image-pixel-space
 * segments from engine/calibrationSession.ts's getBoxPlotGlyphs, computed
 * by engine/boxPlotGlyph.ts) renders as non-interactive Konva Lines on the
 * same overlay layer as the point markers -- converted to screen space here
 * via imageToScreen, same as every marker already is. Decorative only:
 * `listening={false}`, same reasoning as marker labels.
 *
 * Since checkpoint 24, the "Choose Image…" button carries the Ketcher-
 * derived open.svg icon (icons.tsx) alongside its label -- see
 * Workspace.tsx's own header comment for the rest of that checkpoint's
 * icon-toolbar restructuring.
 *
 * Since checkpoint 25 (project save/load, see CLAUDE.md and
 * engine/projectFile.ts), this component is wrapped in forwardRef and
 * exposes an imperative handle (loadImageFromSrc/getImageDataURL/
 * getImageFileName) instead of only the internal "Choose Image…" button --
 * Workspace.tsx's "Open Project" action needs to load an image
 * programmatically (the data URL embedded in a project file, not a fresh
 * native file pick), and "Save Project" needs to read back whichever image
 * is currently loaded, however it got there. The original data URL string
 * is tracked in its own bit of state (imageSrc) rather than re-derived from
 * the loaded HTMLImageElement via an offscreen canvas + toDataURL(), which
 * would silently re-encode/re-compress the image on every save.
 *
 * Since checkpoint 26 (Segment Fill auto-trace, see CLAUDE.md and
 * engine/segmentFillRun.ts), the imperative handle also exposes
 * getImageData(): native-resolution pixel data for the loaded image,
 * needed because the visible <canvas> is drawn at container/view scale
 * (zoomed/panned), not the image's own pixel grid -- flood-filling that
 * would trace at the wrong resolution and shift with every zoom level. A
 * `useEffect` keyed on `image` draws once into an offscreen canvas sized to
 * the image's native width/height and caches the resulting ImageData in a
 * ref, so a Segment Fill click reads the cached buffer instead of
 * redrawing/re-extracting pixel data on every single click.
 *
 * Since checkpoint 27 (Curve Fit panel, see CLAUDE.md and
 * engine/curveFitPanel.ts), an optional `curveFitLine` prop -- already
 * converted to image-pixel space by Workspace.tsx via the axes' own
 * dataToPixel -- renders as a single non-interactive Konva Line, same
 * `listening={false}` decorative-overlay pattern as boxPlotGlyphs.
 *
 * Since checkpoint 28 (Grid Line Removal, see CLAUDE.md and
 * algorithms/gridRemoval.ts), the imperative handle also exposes
 * applyImageTransform(data, width, height): replaces the loaded image with
 * a same-dimensions transformed pixel buffer (Grid Removal's masked
 * output), reusing loadImageFromSrc's own draw-to-offscreen-canvas-then-
 * reload-as-an-<img> approach so the transformed result flows through the
 * exact same display/getImageData/getImageDataURL paths a freshly opened
 * image would -- but skipping the fitToContainer view reset, so reviewing
 * the result doesn't jar the user out of whatever zoom level they were
 * inspecting grid lines at.
 */

export interface CanvasMarker {
  /** Stable identity passed back to onMarkerDragEnd — not a React key concern. */
  id: string;
  x: number;
  y: number;
  label: string;
  color: string;
  draggable?: boolean;
  /** The selected/"active" data point (checkpoint 58) — drawn with a highlight
   * ring so it stands out on the canvas as the one the trash button will delete. */
  selected?: boolean;
  /** A calibration handle renders as a crosshair reticle rather than a filled
   * dot (checkpoint 59), so axis references read as distinct from data points. */
  kind?: 'calibration' | 'data';
  /** Override the data-dot radius (checkpoint 120): interpolation-assist draws
   * anchors big and derived samples small. Defaults to 5. */
  radius?: number;
}

/** A series drawn as connected polyline(s) under its markers (checkpoint 131) --
 * so a dense traced curve reads as a clean line instead of a furry band of
 * overlapping dots. Image-pixel space, converted at render. `runs` is a list of
 * contiguous point-runs (broken where consecutive points are far apart), so a
 * curve with a genuine gap doesn't get a spurious segment bridged across it; a
 * scatter produces no runs and stays dots. Non-interactive, drawn beneath the
 * markers. See Workspace's seriesLines memo for how the runs are formed. */
export interface SeriesLine {
  color: string;
  runs: { x: number; y: number }[][];
}

/** An on-canvas measurement drawing (checkpoint: measure). Geometry is in
 * image-pixel space, like every other overlay here; converted to screen space
 * at render. A line/polyline through `points` (closed for an area), a dot at
 * each vertex, and a `label` anchored at `labelAt`. Non-interactive. */
export interface MeasureOverlay {
  id: string;
  points: { x: number; y: number }[];
  closed?: boolean;
  label: string;
  labelAt: { x: number; y: number };
  color?: string;
}

/** The Select tool's four sub-modes (v1.1 #6, mirroring Ketcher's select
 * multi-tool). 'rectangle' and 'lasso' bear a background gesture; 'point' and
 * 'series' are click-only (a marker click selects one point / the whole series). */
export type SelectGesture = 'rectangle' | 'lasso' | 'point' | 'series';

interface ImageCanvasProps {
  /** Markers to overlay, in image-pixel space (not screen space). */
  points?: CanvasMarker[];
  /** Per-series connecting polylines drawn beneath the markers (checkpoint 131). */
  seriesLines?: SeriesLine[];
  /** Box-and-whisker glyph segments (one array per completed tuple), in
   * image-pixel space -- see engine/calibrationSession.ts's getBoxPlotGlyphs. */
  boxPlotGlyphs?: BoxPlotGlyphSegment[][];
  /** Histogram bin glyphs (checkpoint 66), image-pixel space -- see
   * engine/histogramGlyph.ts. Same decorative, listening={false} treatment as
   * boxPlotGlyphs: they mark what was captured, they aren't hit targets. */
  binGlyphs?: GlyphSegment[][];
  /** Error-bar glyphs (checkpoint 70), image-pixel space -- see
   * engine/errorBarGlyph.ts. Same decorative treatment as the others. */
  errorBarGlyphs?: GlyphSegment[][];
  /** The geometry the calibration IMPLIES (checkpoint 84), image-pixel space --
   * see engine/calibrationPreview.ts. Drawn UNDER the handles and non-interactive:
   * it exists so a mis-clicked handle stops being invisible, and it must never
   * be a thing you can grab. */
  calibrationPreview?: CalibrationPreview;
  /** Curve Fit overlay polyline, in image-pixel space (already converted
   * from engine/curveFitPanel.ts's data-space sampleCurveFitLine via the
   * axes' own dataToPixel -- see checkpoint 27 in CLAUDE.md). */
  curveFitLine?: { x: number; y: number }[];
  /** Check Calibration overlay (v0.8): the 4 image-space corners of the
   * calibrated axis box, drawn as a magenta rectangle so a user can see whether
   * it aligns with the plot's real axes. Null when off / not applicable. */
  calibrationCheckBox?: { x: number; y: number }[] | null;
  /** On-canvas measurement drawings (distance/angle/area/slope + the in-progress
   * one), in image-pixel space. */
  measureOverlays?: MeasureOverlay[];
  /** Select a measurement's vertex for keyboard nudge (checkpoint 128). Wired
   * only in Measure mode; makes recorded measurement vertices clickable. */
  onMeasureVertexClick?: (id: string, vertex: number) => void;
  /** The currently selected measurement vertex, highlighted (checkpoint 128). */
  selectedMeasureVertex?: { id: string; vertex: number } | null;
  /** A colour-match preview overlay (checkpoint 121): an offscreen canvas the
   * size of the native image, with the matched pixels painted and the rest
   * transparent. Drawn under the markers, scaled/positioned exactly onto the base
   * image, non-interactive -- so the user sees what Auto-trace by colour would
   * capture before committing. Null/undefined => nothing drawn. */
  maskOverlay?: HTMLCanvasElement | null;
  /** Fired with image-pixel coordinates on a plain click (not a drag-pan). */
  onImageClick?: (x: number, y: number) => void;
  /** Fired with a marker's id and its new image-pixel coordinates once a drag ends. */
  onMarkerDragEnd?: (id: string, x: number, y: number) => void;
  /** Fired when a marker is clicked (not dragged) — selects it as the active
   * point (checkpoint 58). `shiftKey` lets the Select tool toggle multi-select. */
  onMarkerClick?: (id: string, shiftKey?: boolean) => void;
  /** Mouse model (David 2026-07-20): true only when Pan is the active tool, so a
   * plain left-drag pans. In any other tool a left-drag is NOT a pan (it does the
   * tool, or nothing) — panning then lives on Ctrl+Left and the middle button,
   * which pan from ANY tool regardless of this flag. */
  leftButtonPans?: boolean;
  /** Right-click a data-point marker → the caller shows a context menu at the
   * given viewport coordinates. The caller decides what the id means and what it
   * offers (keeping this canvas ignorant of series/points), exactly like linkSnap. */
  onPointContextMenu?: (id: string, clientX: number, clientY: number) => void;
  /** Right-click a recorded measurement vertex → context menu for that measurement. */
  onMeasureContextMenu?: (id: string, clientX: number, clientY: number) => void;
  /** Right-click empty canvas (the stage background) → context menu with view
   * actions. Fired only when nothing interactive was under the cursor. */
  onCanvasContextMenu?: (clientX: number, clientY: number) => void;
  /** Crop (checkpoint 63): when true, a background drag draws a selection
   * rectangle instead of panning, reported (image-pixel space) via onCropRect.
   * `cropRect` is the confirmed pending rectangle to keep showing after the drag. */
  cropMode?: boolean;
  onCropRect?: (rect: { x: number; y: number; width: number; height: number }) => void;
  cropRect?: { x: number; y: number; width: number; height: number } | null;
  /** Auto-extract region restrict (B1): when true, a background drag draws a
   * rectangle reported (image-pixel space) via onRegionRect -- the same gesture as
   * crop, but non-destructive. `regionRect` is the persistent region to keep
   * drawn (distinct amber, vs crop's teal) so a trace can be limited to it. */
  regionMode?: boolean;
  onRegionRect?: (rect: { x: number; y: number; width: number; height: number }) => void;
  regionRect?: { x: number; y: number; width: number; height: number } | null;
  /** Select tool sub-mode (v1.1 #6, Ketcher's select multi-tool), or null when the
   * Select tool isn't active. Only the gesture-bearing sub-modes touch the canvas
   * background here: 'rectangle' drags a marquee box (-> onSelectRect), 'lasso'
   * traces a freeform loop (-> onSelectLasso). 'point'/'series' are click-only --
   * a data-marker click fires onMarkerClick and the caller decides single vs whole
   * series -- so a background press in those does nothing (no box, no pan).
   * (The 2026-07-21 marquee was the sole boolean predecessor of this.) */
  selectMode?: SelectGesture | null;
  onSelectRect?: (rect: { x: number; y: number; width: number; height: number }) => void;
  /** Lasso finished: the freeform loop the user drew, in image-pixel space (an
   * open ring -- the first point is not repeated). The caller tests each data
   * point against it (algorithms/geometry pointInPolygon). */
  onSelectLasso?: (polygon: { x: number; y: number }[]) => void;
  /** Error-bar capture (checkpoint 79): when set, a background press near a datum
   * starts a *link* drag instead of a pan -- the gesture that records a cap.
   *
   * `linkSnap` maps the press's image-pixel position to the datum it should
   * anchor on, or null to fall through to a normal pan. Asking the caller keeps
   * the canvas ignorant of series, relations and roles: it only knows it is
   * dragging a line from A to B. onLinkDrag reports the finished gesture in
   * image-pixel space; onLinkDragMove reports the live end so Workspace can draw
   * the rubber-band (the line you drag IS the relationship, so it has to be
   * visible while you drag it).
   */
  linkSnap?: ((x: number, y: number) => { x: number; y: number } | null) | null;
  onLinkDragMove?: (from: { x: number; y: number }, to: { x: number; y: number }) => void;
  onLinkDrag?: (from: { x: number; y: number }, to: { x: number; y: number }) => void;
  /** The in-flight link drag was abandoned (cursor left the canvas) — clear the
   * rubber-band. Distinct from onLinkDrag, which records. */
  onLinkDragCancel?: () => void;
  /** Live deskew preview (checkpoint 64): CSS-rotates the drawn canvas + overlay
   * by this many degrees (clockwise) WITHOUT re-sampling pixels, so the fine-angle
   * slider gives smooth feedback; the actual bake happens on Apply. 0 = no preview. */
  previewRotationDeg?: number;
  /** Fired whenever the view (scale/offset) or image-loaded state changes
   * (checkpoint 42/47) -- lets Workspace.tsx render the top-bar zoom control
   * and the bottom-bar view-state readout while the canvas keeps owning the
   * view state. */
  /** imageHeight/imageWidth are the image's *natural* pixel size (0 with no
   * image). Added at checkpoint 68: MapAxes's bottom-left origin -- WPD's own
   * default -- reads the image height to flip y, and the session has no other
   * way to learn it. */
  onStatusChange?: (status: { scale: number; offsetX: number; offsetY: number; hasImage: boolean; imageWidth: number; imageHeight: number }) => void;
  /** Consulted before the Open Image dialog (button or menu) so Workspace can
   * confirm discarding unsaved work; returning false aborts the open. */
  beforeOpenImage?: () => boolean;
  /** Fired after a fresh image is opened via Open Image, so Workspace can start
   * a clean document (new graph = new calibration) rather than leaving the old
   * calibration overlaid on an unrelated image. */
  /** `name` is the opened file's name (v0.8) -- Workspace uses it as the default
   * export filename. Undefined for a paste (a clipboard blob carries no name). */
  onImageOpened?: (name?: string) => void;
  /** A PDF was chosen (dialog/drop/paste). <img> can't decode a PDF, so instead
   * of loading it as an image the canvas hands the raw bytes up to Workspace,
   * which owns PDF state, rendering (ui/src/pdfRender.ts) and page navigation
   * (checkpoint 96). ImageCanvas stays image-only; the rendered page comes back
   * through loadImageFromSrc like any other picture. */
  onPdfBytes?: (bytes: Uint8Array, fileName?: string) => void;
  /** When true (a placement/pick tool is active), the idle canvas cursor is a
   * crosshair rather than the pan "grab" hand -- the hand wrongly implied
   * panning while the user was aiming a calibration/point click. A live drag
   * still shows "grabbing" since a background drag pans in any mode. */
  crosshairCursor?: boolean;
  /** The open tool card / rail rectangle (container-local), so the loupe and
   * the cursor readout dodge it instead of hiding behind it (David: "overlay +
   * dodge", 2026-07-20). Null when nothing worth avoiding is open. */
  avoidRect?: AvoidRect | null;
}

export interface ImageCanvasHandle {
  /** Loads an image from a data URL (or any <img> src), the same path the
   * internal "Choose Image…" button uses -- exposed so Workspace.tsx's
   * "Open Project" action can load a project file's embedded image
   * programmatically instead of through a native file-pick dialog. */
  loadImageFromSrc: (src: string, fileName?: string) => void;
  /** The currently loaded image's original src -- null if none is loaded. */
  getImageDataURL: () => string | null;
  getImageFileName: () => string | null;
  /** Native-resolution pixel data for the loaded image, for Segment Fill's
   * flood fill -- null if none is loaded. See this file's header comment. */
  getImageData: () => ImageData | null;
  /** Replaces the loaded image with a transformed pixel buffer of the same
   * dimensions (e.g. engine/gridRemoval.ts's output) -- a no-op if no image
   * is loaded. Unlike loadImageFromSrc, deliberately does not reset the
   * view (zoom/pan): the current app's own equivalent operation is tagged
   * `keepZoom: true` (see algorithms/gridRemoval.ts), and re-fitting after
   * every Grid Removal click would be a jarring way to review the result
   * at whatever zoom level the user was already inspecting grid lines at. */
  applyImageTransform: (data: Uint8ClampedArray, width: number, height: number, refit?: boolean) => void;
  /** Open the native image-pick dialog -- exposed (checkpoint 42) so the
   * "Choose Image…" button can live in Workspace.tsx's top bar instead of a
   * strip inside the canvas region. */
  openImage: () => void;
  /** Zoom actions, exposed so the zoom control can render in the top bar
   * (checkpoint 42). Same callbacks the native menu already drives. */
  zoomIn: () => void;
  zoomOut: () => void;
  zoomFit: () => void;
  zoom100: () => void;
  zoomTo: (scale: number) => void;
  /** A PNG snapshot of the canvas exactly as shown -- the base image with the
   * overlay (calibration handles, placed points, glyphs, measurements) drawn
   * over it -- as a `data:image/png;base64,...` URL. Null if no image is
   * loaded. Checkpoint 93: composites the plain-Canvas2D base and the Konva
   * overlay layer, the same two layers on screen, so the export is truly WYSIWYG
   * (whatever pan/zoom the user is viewing). The floating loupe is a separate
   * DOM element and is deliberately not part of either layer, so it never
   * appears in the snapshot. */
  getCompositePngDataURL: () => string | null;
  /** The currently VISIBLE region of the image, in image-pixel coordinates,
   * clamped to the image bounds -- i.e. what the user has framed in the view
   * (checkpoint 102). Null if no image is loaded or nothing is visible. Used by
   * the "Capture figure" step to crop the source to exactly what the user sees,
   * at native resolution (see docs/figure-capture-design.md). */
  getViewImageRect: () => CropRect | null;
}

export const ImageCanvas = forwardRef<ImageCanvasHandle, ImageCanvasProps>(function ImageCanvas(
  { points, seriesLines, calibrationPreview, boxPlotGlyphs, binGlyphs, errorBarGlyphs, curveFitLine, calibrationCheckBox, measureOverlays, maskOverlay, onImageClick, onMarkerDragEnd, onMarkerClick, leftButtonPans = false, onPointContextMenu, onMeasureContextMenu, onCanvasContextMenu, onMeasureVertexClick, selectedMeasureVertex, cropMode, onCropRect, cropRect, regionMode, onRegionRect, regionRect, selectMode, onSelectRect, onSelectLasso, linkSnap, onLinkDragMove, onLinkDrag, onLinkDragCancel, previewRotationDeg = 0, onStatusChange, beforeOpenImage, onImageOpened, onPdfBytes, crosshairCursor, avoidRect },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  // setImageSrc still fires on each load/transform (drives a re-render); the value
  // itself is read only through imageSrcRef now, so the binding is intentionally
  // dropped to keep it out of the imperative-handle deps.
  const [, setImageSrc] = useState<string | null>(null);
  // A SYNCHRONOUS mirror of the current image src. Both loadImageFromSrc and
  // applyImageTransform commit their src to React state inside an async
  // `img.onload`, so `imageSrc` (state) lags a load/transform by a tick -- and
  // getImageDataURL() reading it returned the PREVIOUS image (the same lag the
  // figure-switch stash guards against, Workspace ~L720). Image-edit undo needs
  // captureDoc() to read the JUST-baked src synchronously, so getImageDataURL()
  // reads this ref, which every src change updates up-front. See applyImageTransform.
  const imageSrcRef = useRef<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [isDragging, setIsDragging] = useState(false);
  // `panning` distinguishes a view-pan gesture (Pan tool, Ctrl+Left, or middle
  // button) from a plain-left tool press that is only tracked for click-vs-drag
  // detection. onMouseMove pans only when panning is true; endDrag places a point
  // only for a non-panning press that stayed within click tolerance.
  const dragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number; panning: boolean } | null>(null);
  // Space-bar-to-pan (David 2026-07-21): holding Space arms a device-neutral pan
  // (Space+Left drags the view), the one pan gesture that works on a Mac trackpad
  // where Ctrl+Left is the OS context menu. Gated to when NO text field is focused
  // -- Space is the space character, so a focused numeric field must still receive
  // it (the reason an earlier ungated attempt was reverted). The ref is the
  // synchronous read for onStageMouseDown; the state drives the grab cursor so the
  // user sees pan is armed before pressing.
  const spaceHeldRef = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  // Crop selection drag (checkpoint 63): the canvas-relative screen start, plus
  // the live current point for drawing the selection rectangle.
  const cropDragRef = useRef<{ x: number; y: number } | null>(null);
  const [cropCurrent, setCropCurrent] = useState<{ x: number; y: number } | null>(null);
  // Select-tool LASSO drag (v1.1 #6): the freeform path of canvas-relative screen
  // points being traced. The ref is the synchronous accumulator; the state drives
  // the live dashed outline. Both null when no lasso is in flight.
  const lassoRef = useRef<{ x: number; y: number }[] | null>(null);
  const [lassoCurrent, setLassoCurrent] = useState<{ x: number; y: number }[] | null>(null);
  /** The datum an error-bar link drag is anchored on (image-pixel space), or
   * null when no such drag is in flight (checkpoint 79). */
  const linkDragRef = useRef<{ x: number; y: number } | null>(null);
  /** The Konva overlay layer, so the loupe can show your own points (ckpt 83). */
  const overlayLayerRef = useRef<Konva.Layer>(null);
  /** Handed to the loupe so it resolves the overlay canvas at EFFECT time --
   * refs are attached after render, so reading .current while rendering yields
   * null on the pass the loupe mounts. */
  const getOverlayCanvas = useCallback(() => overlayLayerRef.current?.getNativeCanvasElement() ?? null, []);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  // Checkpoint 39: the canvas now fills its grid cell (was a fixed 500px), so
  // the container's size settles asynchronously after layout -- the image's
  // one-shot onload fit can run against a not-yet-final size. A ResizeObserver
  // (below) re-fits when the container settles or the window resizes, but only
  // while the user hasn't taken manual control of the view -- once they zoom or
  // pan, a resize keeps their scale/offset (just redrawn at the new size)
  // rather than snapping back to fit. Set false again by "Fit to Window",
  // which is an explicit request to re-fit.
  const userAdjustedRef = useRef(false);
  // Auto-fit-on-resize is one-shot *per image*: it exists only to catch the
  // container settling to its real size just after the image loads (the fixed-
  // 500px container settled synchronously; the fill-cell one doesn't). Once
  // that first real fit lands, later resizes -- including internal UI reflows
  // like the "Box Plot Groups" button appearing/disappearing, which must NOT
  // move an already-calibrated view out from under placed points -- only
  // redraw at the new size, preserving scale/offset. Reset when a new image
  // loads.
  const didInitialFitRef = useRef(false);

  const [openError, setOpenError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false); // drag-and-drop hint (checkpoint 45)
  const originalImageDataRef = useRef<ImageData | null>(null);

  const loadImageFromSrc = useCallback((src: string, fileName?: string) => {
    // Update the synchronous src mirror up-front so getImageDataURL() is correct
    // the instant this returns (state below lags to img.onload). Reverted on a
    // decode error so a failed open doesn't leave a bad src behind.
    const prevSrc = imageSrcRef.current;
    imageSrcRef.current = src;
    const img = new Image();
    img.onload = () => {
      userAdjustedRef.current = false;
      didInitialFitRef.current = false; // a fresh image gets one initial fit
      setOpenError(null); // a successful load clears any prior "can't open" message
      setImage(img);
      setImageSrc(src);
      setImageFileName(fileName ?? null);
      // The fit is deliberately NOT done here -- see the initial-fit effect
      // below. onload can fire before the canvas-dominant grid cell has laid
      // out, so fitting against the container here gave a wrong (often 100%)
      // size; doing it in an effect guarantees the container is measured after
      // layout.
    };
    // PDF/TIFF are routed to their decoders by content before <img> ever sees
    // them (B7); this net catches a genuinely undecodable / corrupt file so the
    // canvas doesn't go blank with no explanation.
    img.onerror = () => {
      imageSrcRef.current = prevSrc; // a failed decode never became the current image
      setOpenError(unsupportedFileMessage(fileName ? `"${fileName}"` : 'that file'));
    };
    img.src = src;
  }, []);

  // Load an image File/Blob (checkpoint 45) -- shared by drag-and-drop onto
  // the canvas and paste (Ctrl+V). Reads it to a data URL (same shape
  // loadImageFromSrc already handles) so the image is self-contained, exactly
  // like the native file-open path.
  // Load a dropped/pasted File/Blob (checkpoint 45; reworked at checkpoint 98).
  // Detects by CONTENT, not mime: read the bytes once, and a PDF -- however it
  // is labelled -- goes to Workspace's PDF path (which <img> can't decode). This
  // is the fix for a real defect: checkpoint 96 keyed on file.type, but the drop
  // and paste handlers pre-filtered to image/* before ever calling this, so the
  // PDF branch was dead and a dropped PDF was reported as an unsupported image.
  // A successfully-loaded image fires onImageOpened so the document resets --
  // without it, dropping an image while a PDF was open left the PDF's page/
  // provenance state stale and it was saved as if the image came from that PDF.
  const loadImageFile = useCallback(
    (file: File | Blob) => {
      const name = file instanceof File ? file.name : undefined;
      void file.arrayBuffer().then((buf) => {
        const bytes = new Uint8Array(buf);
        // A paged document <img> can't decode (PDF, or TIFF/multipage TIFF) goes to
        // Workspace's paged-source path. Checked by CONTENT before the image/ check,
        // since a TIFF's mime is image/tiff yet <img> still can't decode it (B7).
        if (pagedDocumentFormat(bytes)) {
          onPdfBytes?.(bytes, name);
          return;
        }
        if (!file.type.startsWith('image/')) {
          setOpenError(unsupportedFileMessage(name ? `"${name}"` : 'that file'));
          return;
        }
        // Rebuild the data URL from the same bytes (equivalent to
        // FileReader.readAsDataURL, which we no longer need since we already
        // have the bytes for the PDF check).
        loadImageFromSrc(`data:${file.type};base64,${bytesToBase64(bytes)}`, name);
        onImageOpened?.(name);
      });
    },
    [loadImageFromSrc, onPdfBytes, onImageOpened]
  );

  // Paste an image from the clipboard (Ctrl+V), anywhere in the window -- but
  // not while a text field has focus, so pasting into a data-value/rename input
  // still works normally.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // Accept a pasted image OR PDF file (checkpoint 98); ignore text/other
      // clipboard content silently (pasting text elsewhere is normal).
      const item = Array.from(e.clipboardData?.items ?? []).find(
        (i) => i.kind === 'file' && (i.type.startsWith('image/') || i.type === 'application/pdf')
      );
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        loadImageFile(file);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadImageFile]);

  // Space-bar-to-pan arming (David 2026-07-21). Holding Space arms a Space+Left
  // view pan and turns the cursor into the grab hand as feedback; releasing it
  // disarms. We preventDefault on the arming keydown to stop the page from eating
  // it as a scroll -- but ONLY when no focusable control owns Space (see below).
  useEffect(() => {
    // Do NOT arm (and do NOT preventDefault) when a focusable control has focus,
    // because Space is that control's own activation key: a text field must
    // receive the character; a <button> (incl. the Capture/Calibrate actions) must
    // click; a MUI <Select> renders a div[role=combobox]/[role=button] that opens
    // on Space. An earlier version armed regardless of a focused button (Figma
    // model), but because this listener is window-global it also swallowed Space
    // from the graph-type dropdown and every action button app-wide (v1.0 audit
    // findings B1/C4). Space pans only when focus is on the canvas/body/non-control
    // -- the normal working state (keyboard tool-select via digits leaves focus on
    // the body, so Space pans immediately; after clicking a rail tool button, pan
    // via Space needs a canvas interaction first, or use middle/Ctrl+Left/the Pan
    // tool -- all still available).
    function ownsSpace(el: EventTarget | null): boolean {
      const t = el as HTMLElement | null;
      if (!t || !t.tagName) return false;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') return true;
      if (t.isContentEditable) return true;
      const role = t.getAttribute?.('role');
      return role === 'button' || role === 'combobox' || role === 'menuitem' || role === 'option' || role === 'link';
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.repeat) return; // autorepeat while held -- arm once
      if (ownsSpace(document.activeElement)) return;
      e.preventDefault();
      spaceHeldRef.current = true;
      setSpaceHeld(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    }
    // Losing focus (Alt+Tab, clicking a native menu) can swallow the keyup, so
    // clear the armed state on blur to avoid a stuck pan mode.
    function onBlur() {
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const applyImageTransform = useCallback((data: Uint8ClampedArray, width: number, height: number, refit = false) => {
    if (!image) return;
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    // Copied into a freshly allocated Uint8ClampedArray rather than passed
    // through directly -- guarantees a plain ArrayBuffer-backed array (what
    // the ImageData constructor's typings require), regardless of what
    // backing buffer the caller's array happened to have.
    const plainData = new Uint8ClampedArray(width * height * 4);
    plainData.set(data);
    ctx.putImageData(new ImageData(plainData, width, height), 0, 0);
    const dataUrl = offscreen.toDataURL('image/png');
    imageSrcRef.current = dataUrl; // synchronous mirror, so an image edit's commit captures the baked src (not the pre-edit one)
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setImageSrc(dataUrl);
      // Normally no setView (see the handle doc comment) -- Grid Removal keeps the
      // zoom. But when the dimensions change (checkpoint 62's rotate), refit so the
      // new orientation fills the container instead of using the old fit.
      if (refit) {
        const container = containerRef.current;
        if (container) {
          userAdjustedRef.current = false;
          setView(fitToContainer(img.width, img.height, container.clientWidth, container.clientHeight));
        }
      }
    };
    img.src = dataUrl;
  }, [image]);

  // Native-resolution pixel data, cached once per image load rather than
  // re-extracted on every Segment Fill click -- see this file's header
  // comment. Drawn into an offscreen canvas, deliberately never attached to
  // the DOM (the visible <canvas> is at container/view scale, not native
  // image resolution).
  useEffect(() => {
    if (!image) {
      originalImageDataRef.current = null;
      return;
    }
    const offscreen = document.createElement('canvas');
    offscreen.width = image.width;
    offscreen.height = image.height;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0);
    originalImageDataRef.current = ctx.getImageData(0, 0, image.width, image.height);
  }, [image]);

  const openImage = useCallback(async () => {
    if (!window.electronAPI) {
      setOpenError('electronAPI is not available — this UI must run inside the Electron dev harness (npm run ui:electron).');
      return;
    }
    if (beforeOpenImage && !beforeOpenImage()) return; // unsaved-work guard declined
    const result = await window.electronAPI.openImage();
    if (!result) return; // dialog was cancelled
    setOpenError(null);
    const name = result.filePath.split(/[\\/]/).pop();
    // A paged document <img> can't decode (PDF, or TIFF/multipage TIFF -- B7)
    // goes to Workspace's paged-source path. Detected by CONTENT (the actual
    // bytes), not the dataURL's mime, so it matches loadImageFile's routing
    // exactly. beforeOpenImage (the unsaved-work guard) already ran above.
    const bytes = dataURLToBytes(result.dataURL);
    if (pagedDocumentFormat(bytes)) {
      onPdfBytes?.(bytes, name);
      return;
    }
    loadImageFromSrc(result.dataURL, name);
    onImageOpened?.(name);
  }, [loadImageFromSrc, beforeOpenImage, onImageOpened, onPdfBytes]);

  // Checkpoint 32's four zoom actions, named and shared rather than left as
  // inline lambdas inside the menu effect below -- checkpoint 34's
  // on-canvas ZoomControls widget calls these exact same callbacks, so the
  // native menu and the on-canvas control can never drift apart into two
  // slightly different zoom behaviors. Zoom In/Out/Actual Size all reduce
  // to engine/canvasView.ts's zoomByFactor centered on the container's own
  // center point, since neither a menu click nor a button click has a
  // mouse position to recenter on the way wheel-zoom does. No-ops with no
  // image loaded -- nothing to zoom -- rather than silently changing an
  // otherwise-invisible view state.
  const zoomIn = useCallback(() => {
    const container = containerRef.current;
    if (!container || !image) return;
    userAdjustedRef.current = true;
    setView((prev) => zoomByFactor(prev, container.clientWidth / 2, container.clientHeight / 2, 1.25));
  }, [image]);

  const zoomOut = useCallback(() => {
    const container = containerRef.current;
    if (!container || !image) return;
    userAdjustedRef.current = true;
    setView((prev) => zoomByFactor(prev, container.clientWidth / 2, container.clientHeight / 2, 0.8));
  }, [image]);

  const zoomFit = useCallback(() => {
    const container = containerRef.current;
    if (!container || !image) return;
    userAdjustedRef.current = false; // an explicit re-fit re-enables auto-fit-on-resize
    setView(fitToContainer(image.width, image.height, container.clientWidth, container.clientHeight));
  }, [image]);

  const zoom100 = useCallback(() => {
    const container = containerRef.current;
    if (!container || !image) return;
    userAdjustedRef.current = true;
    setView((prev) => zoomByFactor(prev, container.clientWidth / 2, container.clientHeight / 2, 1 / prev.scale));
  }, [image]);

  // Checkpoint 37 (zoom Slider, see CLAUDE.md): zoom to an *absolute* scale,
  // recentering on the container's own center like the discrete zoom
  // buttons do. Expressed through zoomByFactor (scale / prev.scale is the
  // factor that lands exactly on the requested scale) so there is still one
  // zoom code path, not a second one to drift from the buttons/menu.
  const zoomTo = useCallback((scale: number) => {
    const container = containerRef.current;
    if (!container || !image) return;
    userAdjustedRef.current = true;
    setView((prev) => zoomByFactor(prev, container.clientWidth / 2, container.clientHeight / 2, scale / prev.scale));
  }, [image]);

  // Checkpoint 93: a WYSIWYG PNG of the two on-screen layers composited. The
  // base canvas is at CSS resolution; the Konva overlay's native canvas may be
  // devicePixelRatio-scaled (larger), so draw it into an offscreen sized to the
  // base canvas with the 4-arg drawImage, which scales it back down to match.
  // Result is at the base canvas's resolution -- upscaling the CSS-res base to
  // the overlay's pixel ratio would only blur the image, which is the part that
  // matters for a digitizer proof. Returns null with no image loaded (nothing
  // to snapshot but the empty-state background).
  const getCompositePngDataURL = useCallback((): string | null => {
    if (!image) return null;
    const base = canvasRef.current;
    if (!base) return null;
    const out = document.createElement('canvas');
    out.width = base.width;
    out.height = base.height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(base, 0, 0);
    const overlay = getOverlayCanvas();
    if (overlay) ctx.drawImage(overlay, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }, [image, getOverlayCanvas]);

  // The visible image region in image-pixel space (checkpoint 102): map the two
  // canvas corners back through the view transform and clamp to the image. This
  // is exactly "what the user has framed", which the Capture-figure step crops
  // the source to.
  const getViewImageRect = useCallback((): CropRect | null => {
    if (!image) return null;
    const tl = screenToImage(view, 0, 0);
    const br = screenToImage(view, stageSize.width, stageSize.height);
    const x0 = Math.max(0, Math.floor(Math.min(tl.x, br.x)));
    const y0 = Math.max(0, Math.floor(Math.min(tl.y, br.y)));
    const x1 = Math.min(image.width, Math.ceil(Math.max(tl.x, br.x)));
    const y1 = Math.min(image.height, Math.ceil(Math.max(tl.y, br.y)));
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, [image, view, stageSize]);

  // Placed here (not up by the state) so the zoom callbacks + openImage it
  // exposes are already declared -- their consts can't be named in the deps
  // array before their `const` lines (temporal dead zone).
  useImperativeHandle(
    ref,
    () => ({
      loadImageFromSrc,
      // The synchronous mirror, not the (tick-lagged) imageSrc state -- so a
      // caller reading this right after a load/transform gets the new src.
      getImageDataURL: () => imageSrcRef.current,
      getImageFileName: () => imageFileName,
      getImageData: () => originalImageDataRef.current,
      applyImageTransform,
      openImage,
      zoomIn,
      zoomOut,
      zoomFit,
      zoom100,
      zoomTo,
      getCompositePngDataURL,
      getViewImageRect,
    }),
    [loadImageFromSrc, imageFileName, applyImageTransform, openImage, zoomIn, zoomOut, zoomFit, zoom100, zoomTo, getCompositePngDataURL, getViewImageRect]
  );

  // Notify Workspace of scale / image-loaded changes (checkpoint 42) so the
  // top bar can render the zoom control and Choose Image button.
  useEffect(() => {
    onStatusChange?.({
      scale: view.scale,
      offsetX: view.offsetX,
      offsetY: view.offsetY,
      hasImage: image !== null,
      imageWidth: image?.naturalWidth ?? 0,
      imageHeight: image?.naturalHeight ?? 0,
    });
  }, [view.scale, view.offsetX, view.offsetY, image, onStatusChange]);

  // One-shot initial fit, done in an effect rather than the img.onload
  // callback (checkpoint 39): effects run after React commits the new image
  // *and* the browser has laid the container out, so container.clientWidth
  // here is the real, settled size -- eliminating the load-timing race where
  // onload's fit ran against a not-yet-sized cell and read 100%. If the
  // container somehow still isn't sized (clientWidth 0), didInitialFit stays
  // false and the ResizeObserver below catches it as a fallback.
  useEffect(() => {
    if (!image || didInitialFitRef.current) return;
    const container = containerRef.current;
    if (!container || container.clientWidth === 0) return;
    didInitialFitRef.current = true;
    setView(fitToContainer(image.width, image.height, container.clientWidth, container.clientHeight));
  }, [image]);

  // Re-fit (fallback for the not-yet-sized case above) or redraw when the
  // container settles / the window resizes. Observes the canvas container;
  // while the user hasn't taken manual control and the one-shot fit hasn't
  // landed yet, fits; otherwise preserves scale/offset and just forces a
  // redraw at the new size (a shallow view copy re-runs the draw effect, which
  // reads container.clientWidth). Never re-fits after the initial fit, so an
  // internal reflow (e.g. the Box Plot Groups button appearing) can't move an
  // already-calibrated view out from under placed points.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setView((prev) => {
        // Keep the image fitted while the container is still settling to its
        // real size (window/layout can resize over several frames after load,
        // and the window size itself varies) -- but only until the user takes
        // control (see userAdjustedRef: set on zoom, pan, AND the first
        // content click). After that the view is locked: a resize just redraws
        // at the new size, so an internal reflow (e.g. the Box Plot Groups
        // button vanishing) can't shift an established view between a
        // calibration click and the data clicks that depend on it.
        if (image && !userAdjustedRef.current && container.clientWidth > 0) {
          return fitToContainer(image.width, image.height, container.clientWidth, container.clientHeight);
        }
        return { ...prev };
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [image]);

  // Checkpoint 32 (native menu bar, see CLAUDE.md and
  // ui/electron-menu.cjs): File > Open Image… and every View > Zoom*
  // action land here, since this component already owns the view state,
  // the container ref, and openImage. onMenuEvent's unsubscribe return
  // value matters here specifically: without it, React StrictMode's
  // double-invoked effects would register each listener twice in
  // development.
  useEffect(() => {
    if (!window.electronAPI) return;
    const electronAPI = window.electronAPI;
    const unsubscribes = [
      electronAPI.onMenuEvent('menu:open-image', () => {
        void openImage();
      }),
      electronAPI.onMenuEvent('menu:zoom-in', zoomIn),
      electronAPI.onMenuEvent('menu:zoom-out', zoomOut),
      electronAPI.onMenuEvent('menu:zoom-fit', zoomFit),
      electronAPI.onMenuEvent('menu:zoom-100', zoom100),
    ];
    return () => unsubscribes.forEach((unsub) => unsub());
  }, [openImage, zoomIn, zoomOut, zoomFit, zoom100]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.color.background.canvas;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (image) {
      ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
      ctx.drawImage(image, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    setStageSize({ width: canvas.width, height: canvas.height });
  }, [image, view]);

  const onWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.evt.clientX - rect.left;
    const mouseY = e.evt.clientY - rect.top;
    userAdjustedRef.current = true;
    setView((prev) => zoomAt(prev, mouseX, mouseY, e.evt.deltaY));
  }, []);

  const onStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const canvas = canvasRef.current;
      // Right button never starts a drag here -- the context menu is raised by
      // onContextMenu (which also suppresses the native browser menu).
      if (e.evt.button === 2) return;
      // Mouse model (David 2026-07-20/21): the MIDDLE button, Ctrl+Left, and
      // Space+Left pan the view from ANY tool and over ANY target -- checked first
      // so they override a marker drag, crop, or link-drag underneath.
      //
      // On macOS, Ctrl+click IS the system context-menu gesture, so Ctrl+Left is
      // NOT a pan there (it would clash). Space+Left (armed by holding Space, see
      // the keydown effect above) is the device-neutral pan that covers a Mac
      // trackpad, where there is no middle button and Ctrl+Left is taken -- it was
      // reverted once for eating Space in numeric fields, and is back gated to when
      // no text field/button is focused (David, 2026-07-21).
      const middle = e.evt.button === 1;
      const ctrlLeft = e.evt.button === 0 && e.evt.ctrlKey && !IS_MAC;
      const spaceLeft = e.evt.button === 0 && spaceHeldRef.current;
      if (middle || ctrlLeft || spaceLeft) {
        e.evt.preventDefault(); // suppress middle-button autoscroll
        dragStartRef.current = { x: e.evt.clientX, y: e.evt.clientY, offsetX: view.offsetX, offsetY: view.offsetY, panning: true };
        setIsDragging(true);
        return;
      }
      // Beyond here it is a plain LEFT press (the active tool's own interaction).
      // An error-bar link drag (checkpoint 79) is tested FIRST, before the
      // landed-on-a-marker bail below -- because pressing *on a datum* is
      // exactly this gesture, and the datum has a marker drawn on it. Found by
      // driving the real app: with the bail first, the one press the tool exists
      // for was the one press it ignored.
      //
      // Safe to pre-empt: linkSnap only answers for a point of the TARGET
      // series, so pressing a cap (which lives in a *different*, related series)
      // returns null and falls through to that cap's own marker drag -- which is
      // how caps stay freely adjustable. Pressing empty canvas also falls
      // through, to a pan, so the tool never traps the view and a cap can never
      // be hung off nothing.
      if (linkSnap && canvas) {
        const rect = canvas.getBoundingClientRect();
        const img = screenToImage(view, e.evt.clientX - rect.left, e.evt.clientY - rect.top);
        const datum = linkSnap(img.x, img.y);
        if (datum) {
          linkDragRef.current = datum;
          onLinkDragMove?.(datum, datum);
          return;
        }
      }
      // A mousedown that landed on a marker (not empty stage background)
      // bubbles up here too, but should drive that shape's own Konva drag
      // instead of starting a background pan.
      if (e.target !== e.target.getStage()) return;
      if (selectMode === 'lasso' && canvas) {
        // Start tracing a freeform lasso loop (v1.1 #6) instead of a pan. Like the
        // marquee it only ever starts on empty canvas (a marker press returned
        // above and single-selects); endDrag reports the enclosed points.
        const rect = canvas.getBoundingClientRect();
        const p = { x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top };
        lassoRef.current = [p];
        setLassoCurrent([p]);
        return;
      }
      if ((cropMode || regionMode || selectMode === 'rectangle') && canvas) {
        // Start a rectangle drag instead of a pan: a crop selection (checkpoint 63),
        // an auto-extract region (B1), or the Select tool's marquee. Same gesture;
        // endDrag routes by mode. (A press ON a marker returned above, so the
        // marquee only ever starts on empty canvas -- a marker press single-selects.)
        const rect = canvas.getBoundingClientRect();
        const p = { x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top };
        cropDragRef.current = p;
        setCropCurrent(p);
        return;
      }
      // A plain-left background press. It pans only when Pan is the active tool
      // (leftButtonPans); in any other tool it is tracked purely for click-vs-drag
      // detection, so a click places a point and a drag does nothing (pan having
      // moved to Ctrl+Left / middle above).
      dragStartRef.current = { x: e.evt.clientX, y: e.evt.clientY, offsetX: view.offsetX, offsetY: view.offsetY, panning: leftButtonPans };
      setIsDragging(true);
    },
    [view, cropMode, regionMode, selectMode, linkSnap, onLinkDragMove, leftButtonPans]
  );

  const onMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        setHover({ x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top });
      }

      if (cropDragRef.current && canvas) {
        const rect = canvas.getBoundingClientRect();
        setCropCurrent({ x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top });
        return;
      }

      if (lassoRef.current && canvas) {
        const rect = canvas.getBoundingClientRect();
        const next = [...lassoRef.current, { x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top }];
        lassoRef.current = next;
        setLassoCurrent(next);
        return;
      }

      if (linkDragRef.current && canvas) {
        const rect = canvas.getBoundingClientRect();
        const img = screenToImage(view, e.evt.clientX - rect.left, e.evt.clientY - rect.top);
        onLinkDragMove?.(linkDragRef.current, img);
        return;
      }

      const start = dragStartRef.current;
      if (!start) return;
      // Only a pan gesture moves the view; a plain-left tool press is tracked but
      // does not pan (mouse model, David 2026-07-20).
      if (!start.panning) return;
      setView(() => panBy({ scale: view.scale, offsetX: start.offsetX, offsetY: start.offsetY }, e.evt.clientX - start.x, e.evt.clientY - start.y));
    },
    [view, onLinkDragMove]
  );

  const endDrag = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Finalize a lasso (v1.1 #6): hand the traced loop to the caller in image-
      // pixel space. A too-short trace (a stray click) selects nothing.
      if (lassoRef.current) {
        const pts = lassoRef.current;
        lassoRef.current = null;
        setLassoCurrent(null);
        const canvas = canvasRef.current;
        if (canvas && onSelectLasso && pts.length >= 3) {
          onSelectLasso(pts.map((p) => screenToImage(view, p.x, p.y)));
        }
        return;
      }

      // Finalize a crop selection (checkpoint 63): report the dragged rectangle
      // in image-pixel space; the card confirms Apply/Cancel.
      if (cropDragRef.current) {
        const startP = cropDragRef.current;
        cropDragRef.current = null;
        const canvas = canvasRef.current;
        // Route the finished rectangle by mode: select marquee, region-restrict
        // (B1), or crop.
        const report = selectMode === 'rectangle' ? onSelectRect : regionMode ? onRegionRect : onCropRect;
        if (canvas && report) {
          const rect = canvas.getBoundingClientRect();
          const endP = { x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top };
          const a = screenToImage(view, startP.x, startP.y);
          const b = screenToImage(view, endP.x, endP.y);
          report({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
        }
        setCropCurrent(null);
        return;
      }

      // Finalize an error-bar link drag (checkpoint 79). Reported even when it
      // is short: the session refuses a zero-length one and says why, which is
      // better than the canvas silently deciding a deliberate gesture was a
      // click.
      if (linkDragRef.current) {
        const from = linkDragRef.current;
        linkDragRef.current = null;
        const canvas = canvasRef.current;
        if (canvas && onLinkDrag) {
          const rect = canvas.getBoundingClientRect();
          const to = screenToImage(view, e.evt.clientX - rect.left, e.evt.clientY - rect.top);
          userAdjustedRef.current = true;
          onLinkDrag(from, to);
        }
        return;
      }

      const start = dragStartRef.current;
      dragStartRef.current = null;
      setIsDragging(false);

      if (!start) return;
      const moved = !isClick(start.x, start.y, e.evt.clientX, e.evt.clientY);
      // A pan gesture (Pan tool / Ctrl+Left / middle): if the view actually moved,
      // take manual control so a later resize doesn't snap it back to fit. A pan
      // that didn't move (e.g. a Ctrl+Left or middle click) places nothing.
      if (start.panning) {
        if (moved) userAdjustedRef.current = true;
        return;
      }
      // A plain-left tool press: a click places a point; a drag beyond tolerance is
      // ignored (it is NOT a pan any more -- pan is Ctrl+Left / middle).
      if (moved) return;
      if (!onImageClick) return;

      // The user is placing points now -- lock the view so a later container
      // reflow can't re-fit it out from under the coordinate mapping these
      // (and subsequent) clicks establish.
      userAdjustedRef.current = true;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const screenX = e.evt.clientX - rect.left;
      const screenY = e.evt.clientY - rect.top;
      const imagePoint = screenToImage(view, screenX, screenY);
      onImageClick(imagePoint.x, imagePoint.y);
    },
    [onImageClick, view, onCropRect, onLinkDrag, regionMode, onRegionRect, selectMode, onSelectRect, onSelectLasso]
  );

  const cancelDrag = useCallback(() => {
    dragStartRef.current = null;
    setIsDragging(false);
    cropDragRef.current = null;
    setCropCurrent(null);
    // A link drag that leaves the canvas is abandoned, matching the existing
    // crop/pan behaviour here. (WPD deliberately *finalizes* a drag that leaves
    // its canvas -- parity gap "A drag leaving the canvas is discarded" -- but
    // that gap is about the crop/mask tools where dragging to the edge is the
    // normal case; an error cap is placed on the figure, well inside it.)
    linkDragRef.current = null;
    onLinkDragCancel?.();
  }, [onLinkDragCancel]);

  const onStageMouseLeave = useCallback(() => {
    cancelDrag();
    setHover(null);
  }, [cancelDrag]);

  // Right-click on empty canvas -> view-action context menu. Always suppresses the
  // native browser menu. Marker / measurement right-clicks handle themselves and
  // stop bubbling (cancelBubble), so this only runs for the stage background.
  const onStageContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      if (e.target === e.target.getStage()) onCanvasContextMenu?.(e.evt.clientX, e.evt.clientY);
    },
    [onCanvasContextMenu]
  );

  const onMarkerDragEndInternal = useCallback(
    (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
      // A Ctrl+Left pan that happened to start on this marker armed a shape drag
      // (button 0); onDragStart stopped it, which fires this dragend. Never report
      // it as a move -- the point must not shift because the user panned over it.
      if (dragStartRef.current?.panning) return;
      const imagePoint = screenToImage(view, e.target.x(), e.target.y());
      onMarkerDragEnd?.(id, imagePoint.x, imagePoint.y);
    },
    [view, onMarkerDragEnd]
  );

  // Cancel a marker drag that a pan gesture (Ctrl+Left) started on top of a
  // marker, so the gesture pans instead of moving the point.
  const cancelDragIfPanning = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    if (dragStartRef.current?.panning) e.target.stopDrag();
  }, []);

  const hoverImagePoint = hover ? screenToImage(view, hover.x, hover.y) : null;
  const container = containerRef.current;

  // Live deskew preview: rotate the drawn canvas + overlay about their shared
  // centre (both are container-sized, positioned at the container's top-left).
  // Applied to each layer individually rather than a wrapper div so the render
  // tree -- and thus Konva hit-testing -- is unchanged when no preview is active.
  const previewCss = previewRotationDeg
    ? { transform: `rotate(${previewRotationDeg}deg)`, transformOrigin: '50% 50%', transition: 'transform 0.06s linear' }
    : {};

  return (
    // Fills the canvas-dominant grid cell. The Choose Image button and zoom
    // control that used to sit in a strip above the canvas moved to
    // Workspace's top bar (checkpoint 42), so the canvas container now takes
    // the whole cell.
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, flex: 1 }}>
      <div
        ref={containerRef}
        data-testid="canvas-container"
        style={{
          width: '100%',
          flex: 1,
          minHeight: 0,
          position: 'relative',
          // Clip the rotated-canvas corners during a live deskew preview so they
          // don't poke out over the sidebar/top bar (checkpoint 64).
          overflow: previewRotationDeg ? 'hidden' : undefined,
          outline: dragOver ? `2px dashed ${theme.color.primary.main}` : 'none',
          outlineOffset: -2,
        }}
        onDragOver={(e) => {
          // Only offer to accept file drops (checkpoint 45).
          if (Array.from(e.dataTransfer.items).some((i) => i.kind === 'file')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files);
          // Pick the first openable file (image OR PDF -- checkpoint 98); fall
          // back to the first file so loadImageFile can report why it can't be
          // opened. loadImageFile detects PDF by content, so a file whose type
          // is missing/wrong still routes correctly.
          const file = files.find((f) => f.type.startsWith('image/') || f.type === 'application/pdf') ?? files[0];
          if (file) loadImageFile(file);
        }}
      >
        <canvas ref={canvasRef} style={{ display: 'block', ...previewCss }} />
        {dragOver && (
          <div
            data-testid="drop-hint"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(22, 119, 130, 0.06)',
              color: theme.color.primary.main,
              pointerEvents: 'none',
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 600 }}>Drop an image to digitize</span>
            <span style={{ fontSize: 12, opacity: 0.75 }}>{SUPPORTED_IMAGE_FORMATS}</span>
          </div>
        )}
        {/* First-run guidance: a blank canvas otherwise gives no hint of what
            to do or what can be opened (the "can only use what he sees" rule).
            Only when there is genuinely no image and no drag in progress. */}
        {!image && !dragOver && (
          <div
            data-testid="empty-state"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              color: theme.color.text.secondary,
              padding: 24,
              // Let drags/clicks fall through to the canvas container beneath
              // (its onDragOver drives the drop hint); only the button opts back in.
              pointerEvents: 'none',
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 600, color: theme.color.text.primary }}>
              Open an image to start digitizing
            </span>
            <button
              type="button"
              data-testid="empty-state-open"
              onClick={openImage}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                border: `1px solid ${theme.color.primary.main}`,
                background: theme.color.primary.main,
                color: '#ffffff',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Open Image…
            </button>
            <span style={{ fontSize: 12, opacity: 0.85 }}>
              …or drag &amp; drop or paste one
            </span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>Supported: {SUPPORTED_IMAGE_FORMATS}</span>
          </div>
        )}
        {openError && (
          <p
            data-testid="open-error"
            style={{
              position: 'absolute',
              left: 8,
              top: 8,
              margin: 0,
              color: theme.color.error,
              background: theme.color.background.panel,
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            {openError}
          </p>
        )}
        {stageSize.width > 0 && stageSize.height > 0 && (
          <div style={{ position: 'absolute', left: 0, top: 0, cursor: isDragging ? 'grabbing' : spaceHeld ? 'grab' : crosshairCursor ? 'crosshair' : 'grab', ...previewCss }}>
            <Stage
              width={stageSize.width}
              height={stageSize.height}
              onWheel={onWheel}
              onMouseDown={onStageMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={endDrag}
              onMouseLeave={onStageMouseLeave}
              onContextMenu={onStageContextMenu}
            >
              {/* The overlay layer is captured by ref so the LOUPE can composite
                  it over the magnified image (checkpoint 83). Konva already
                  renders it to its own <canvas>, so this costs nothing to read —
                  no re-render, no toCanvas(), just a drawImage from a canvas
                  that already exists. WPD has to alpha-composite two contexts
                  pixel-by-pixel (graphicsWidget.js:566-579) because its data
                  layer isn't separable; ours is, which makes the same feature
                  cheaper for us than for the reference. */}
              <Layer ref={overlayLayerRef}>
                {/* Colour-match preview (ckpt 121) — FIRST so it sits UNDER every
                    handle/point/glyph: it is context for what a trace would grab,
                    never a hit target (`listening={false}`). The offscreen canvas
                    is native-image-sized, so it positions at the image origin and
                    scales by view.scale exactly like the base image underneath. */}
                {maskOverlay && (
                  <KonvaImage
                    image={maskOverlay}
                    x={imageToScreen(view, 0, 0).x}
                    y={imageToScreen(view, 0, 0).y}
                    scaleX={view.scale}
                    scaleY={view.scale}
                    listening={false}
                  />
                )}
                {/* The calibration's implied geometry (ckpt 84) — FIRST in the
                    layer so it sits UNDER the handles: it is a check on where
                    they are, so it must never obscure or outrank them. Also
                    `listening={false}` — decorative, never a hit target, same as
                    every other derived overlay here. Being on this layer means it
                    shows in the LOUPE too (ckpt 83), which is how you place a
                    handle precisely AND see what it implies at the same time. */}
                {calibrationPreview?.segments.map((seg, i) => {
                  const a = imageToScreen(view, seg.from.x, seg.from.y);
                  const b = imageToScreen(view, seg.to.x, seg.to.y);
                  return (
                    <Line
                      key={`calib-seg-${i}`}
                      points={[a.x, a.y, b.x, b.y]}
                      stroke={seg.color}
                      strokeWidth={1.5}
                      dash={[6, 4]}
                      opacity={0.75}
                      listening={false}
                    />
                  );
                })}
                {calibrationPreview?.circles.map((c, i) => {
                  const centre = imageToScreen(view, c.cx, c.cy);
                  return (
                    <Circle
                      key={`calib-circle-${i}`}
                      x={centre.x}
                      y={centre.y}
                      radius={c.r * view.scale}
                      stroke={c.color}
                      strokeWidth={1.5}
                      dash={[6, 4]}
                      opacity={0.75}
                      listening={false}
                    />
                  );
                })}
                {/* Connecting polylines beneath the markers (checkpoint 131): a
                    dense traced curve reads as one clean line, not 500 overlapping
                    dots. Non-interactive; one Konva Line per contiguous run. */}
                {seriesLines?.flatMap((series, si) =>
                  series.runs.map((run, ri) => (
                    <Line
                      key={`sl-${si}-${ri}`}
                      points={run.flatMap((p) => {
                        const s = imageToScreen(view, p.x, p.y);
                        return [s.x, s.y];
                      })}
                      stroke={series.color}
                      strokeWidth={1.8}
                      lineCap="round"
                      lineJoin="round"
                      listening={false}
                    />
                  ))
                )}
                {points?.map((point) => {
                  const { x: screenX, y: screenY } = imageToScreen(view, point.x, point.y);
                  const interactive = point.draggable ?? false;
                  if (point.kind === 'calibration') {
                    // A crosshair reticle (ring + center dot + 4 ticks) so an axis
                    // handle reads as a precise reference, not a data dot. Drawn in
                    // a draggable Group; an invisible-but-listening hit disc catches
                    // the drag/click so the thin strokes don't have to (checkpoint 59).
                    return (
                      <Fragment key={point.id}>
                        <Group
                          x={screenX}
                          y={screenY}
                          draggable={interactive}
                          onClick={(e) => onMarkerClick?.(point.id, e.evt.shiftKey)}
                          onDragStart={cancelDragIfPanning}
                          onDragMove={(e) => setHover({ x: e.target.x(), y: e.target.y() })}
                          onDragEnd={(e) => onMarkerDragEndInternal(point.id, e)}
                        >
                          <Circle radius={12} fill="#000000" opacity={0} listening={interactive} />
                          {point.selected && (
                            // Keyboard-nudge selection highlight (checkpoint 127).
                            <Circle radius={11} stroke={theme.color.primary.main} strokeWidth={2.5} listening={false} />
                          )}
                          <Circle radius={7} stroke={point.color} strokeWidth={2} listening={false} />
                          <Circle radius={1.6} fill={point.color} listening={false} />
                          <Line points={[-12, 0, -8, 0]} stroke={point.color} strokeWidth={1.6} listening={false} />
                          <Line points={[8, 0, 12, 0]} stroke={point.color} strokeWidth={1.6} listening={false} />
                          <Line points={[0, -12, 0, -8]} stroke={point.color} strokeWidth={1.6} listening={false} />
                          <Line points={[0, 8, 0, 12]} stroke={point.color} strokeWidth={1.6} listening={false} />
                        </Group>
                        <KonvaText
                          x={screenX + 12}
                          y={screenY - 20}
                          text={point.label}
                          fontSize={12}
                          fontFamily="system-ui, sans-serif"
                          fill={theme.color.overlay.stroke}
                          listening={false}
                        />
                      </Fragment>
                    );
                  }
                  return (
                    <Fragment key={point.id}>
                      {point.selected && (
                        // Highlight ring for the active/selected point (checkpoint 58).
                        <Circle x={screenX} y={screenY} radius={(point.radius ?? 5) + 4} stroke={theme.color.primary.main} strokeWidth={2.5} listening={false} />
                      )}
                      <Circle
                        x={screenX}
                        y={screenY}
                        radius={point.radius ?? 5}
                        fill={point.color}
                        stroke={point.selected ? theme.color.primary.main : theme.color.overlay.stroke}
                        strokeWidth={point.selected ? 2 : 1}
                        draggable={point.draggable ?? false}
                        // Non-draggable markers must not enter Konva's hit
                        // graph at all: otherwise a click that happens to
                        // land exactly on one (e.g. mid-calibration, before
                        // it's draggable) reports e.target as the Circle
                        // instead of the Stage and gets silently swallowed
                        // instead of registering as the next image click.
                        listening={point.draggable ?? false}
                        onClick={() => onMarkerClick?.(point.id)}
                        onContextMenu={(e) => {
                          // A data point's own context menu -- stop the event
                          // reaching the stage's empty-canvas handler, and suppress
                          // the native browser menu. The caller decides what the id
                          // means (only active-series `point-*` ids get a menu).
                          e.evt.preventDefault();
                          e.cancelBubble = true;
                          onPointContextMenu?.(point.id, e.evt.clientX, e.evt.clientY);
                        }}
                        onDragStart={cancelDragIfPanning}
                        // During a Konva shape drag the Stage's own onMouseMove
                        // doesn't fire (Konva captures the pointer at the window),
                        // so the cursor-following loupe would freeze. Feed the
                        // dragged marker's live position into `hover` so the loupe
                        // tracks the point being moved (checkpoint 58).
                        onDragMove={(e) => setHover({ x: e.target.x(), y: e.target.y() })}
                        onDragEnd={(e) => onMarkerDragEndInternal(point.id, e)}
                      />
                      <KonvaText
                        x={screenX + 8}
                        y={screenY - 20}
                        text={point.label}
                        fontSize={12}
                        fontFamily="system-ui, sans-serif"
                        fill={theme.color.overlay.stroke}
                        listening={false}
                      />
                    </Fragment>
                  );
                })}
                {boxPlotGlyphs?.map((segments, glyphIndex) =>
                  segments.map((segment, segmentIndex) => {
                    const from = imageToScreen(view, segment.from.x, segment.from.y);
                    const to = imageToScreen(view, segment.to.x, segment.to.y);
                    return (
                      <Line
                        key={`box-glyph-${glyphIndex}-${segmentIndex}`}
                        points={[from.x, from.y, to.x, to.y]}
                        stroke={theme.color.overlay.stroke}
                        strokeWidth={1.5}
                        listening={false}
                      />
                    );
                  })
                )}
                {binGlyphs?.map((segments, glyphIndex) =>
                  segments.map((segment, segmentIndex) => {
                    const from = imageToScreen(view, segment.from.x, segment.from.y);
                    const to = imageToScreen(view, segment.to.x, segment.to.y);
                    return (
                      <Line
                        key={`bin-glyph-${glyphIndex}-${segmentIndex}`}
                        points={[from.x, from.y, to.x, to.y]}
                        stroke={theme.color.overlay.stroke}
                        strokeWidth={2}
                        listening={false}
                      />
                    );
                  })
                )}
                {errorBarGlyphs?.map((segments, glyphIndex) =>
                  segments.map((segment, segmentIndex) => {
                    const from = imageToScreen(view, segment.from.x, segment.from.y);
                    const to = imageToScreen(view, segment.to.x, segment.to.y);
                    return (
                      <Line
                        key={`errorbar-glyph-${glyphIndex}-${segmentIndex}`}
                        points={[from.x, from.y, to.x, to.y]}
                        stroke={theme.color.overlay.stroke}
                        strokeWidth={2}
                        listening={false}
                      />
                    );
                  })
                )}
                {curveFitLine && curveFitLine.length > 1 && (
                  <Line
                    points={curveFitLine.flatMap((p) => {
                      const s = imageToScreen(view, p.x, p.y);
                      return [s.x, s.y];
                    })}
                    stroke="#7fcf7f"
                    strokeWidth={2}
                    listening={false}
                  />
                )}
                {/* Check Calibration (v0.8): the calibrated axis box in magenta.
                    Closed quad; distinct from the green fit line and blue series
                    so it reads as "the calibration's own frame". */}
                {calibrationCheckBox && calibrationCheckBox.length === 4 && (
                  <Line
                    points={calibrationCheckBox.flatMap((p) => {
                      const s = imageToScreen(view, p.x, p.y);
                      return [s.x, s.y];
                    })}
                    stroke="#e000e0"
                    strokeWidth={2}
                    dash={[8, 4]}
                    closed
                    listening={false}
                  />
                )}
                {measureOverlays?.map((o) => {
                  const scr = o.points.map((p) => imageToScreen(view, p.x, p.y));
                  const lbl = imageToScreen(view, o.labelAt.x, o.labelAt.y);
                  const col = o.color ?? '#e8912d';
                  return (
                    <Fragment key={o.id}>
                      {scr.length >= 2 && (
                        <Line
                          points={scr.flatMap((s) => [s.x, s.y])}
                          stroke={col}
                          strokeWidth={2}
                          closed={o.closed ?? false}
                          listening={false}
                        />
                      )}
                      {scr.map((s, i) => {
                        // Recorded measurements' vertices are clickable in Measure
                        // mode (checkpoint 128) so the arrow keys can nudge them;
                        // the in-progress 'measure-pending' / 'error-link-pending'
                        // overlays stay inert so a placing click is never swallowed.
                        const interactive = !!onMeasureVertexClick && o.id !== 'measure-pending' && o.id !== 'error-link-pending';
                        const isSel = interactive && selectedMeasureVertex?.id === o.id && selectedMeasureVertex.vertex === i;
                        return (
                          <Fragment key={`${o.id}-v${i}`}>
                            {isSel && <Circle x={s.x} y={s.y} radius={7} stroke={theme.color.primary.main} strokeWidth={2.5} listening={false} />}
                            <Circle x={s.x} y={s.y} radius={3.5} fill={col} listening={false} />
                            {interactive && (
                              <Circle
                                x={s.x}
                                y={s.y}
                                radius={9}
                                fill="#000000"
                                opacity={0}
                                onClick={() => onMeasureVertexClick!(o.id, i)}
                                onContextMenu={(e) => {
                                  e.evt.preventDefault();
                                  e.cancelBubble = true;
                                  onMeasureContextMenu?.(o.id, e.evt.clientX, e.evt.clientY);
                                }}
                              />
                            )}
                          </Fragment>
                        );
                      })}
                      {o.label && (
                        <KonvaText
                          x={lbl.x + 8}
                          y={lbl.y - 18}
                          text={o.label}
                          fontSize={12}
                          fontStyle="bold"
                          fontFamily="system-ui, sans-serif"
                          fill={col}
                          listening={false}
                        />
                      )}
                    </Fragment>
                  );
                })}
                {/* Select-tool lasso (v1.1 #6): the freeform loop being traced,
                    drawn closed + dashed like the marquee rect. Screen-space
                    already, so no view transform. */}
                {lassoCurrent && lassoCurrent.length > 1 && (
                  <Line
                    points={lassoCurrent.flatMap((p) => [p.x, p.y])}
                    closed
                    stroke={theme.color.primary.main}
                    strokeWidth={1.5}
                    dash={[6, 4]}
                    fill="rgba(22, 119, 130, 0.12)"
                    listening={false}
                  />
                )}
                {/* Crop selection (checkpoint 63): the live drag rect, or the
                    confirmed pending rect converted from image-pixel space. */}
                {cropDragRef.current && cropCurrent ? (
                  <Rect
                    x={Math.min(cropDragRef.current.x, cropCurrent.x)}
                    y={Math.min(cropDragRef.current.y, cropCurrent.y)}
                    width={Math.abs(cropCurrent.x - cropDragRef.current.x)}
                    height={Math.abs(cropCurrent.y - cropDragRef.current.y)}
                    stroke={theme.color.primary.main}
                    strokeWidth={1.5}
                    dash={[6, 4]}
                    fill="rgba(22, 119, 130, 0.12)"
                    listening={false}
                  />
                ) : (
                  cropRect &&
                  (() => {
                    const a = imageToScreen(view, cropRect.x, cropRect.y);
                    const b = imageToScreen(view, cropRect.x + cropRect.width, cropRect.y + cropRect.height);
                    return (
                      <Rect
                        x={a.x}
                        y={a.y}
                        width={b.x - a.x}
                        height={b.y - a.y}
                        stroke={theme.color.primary.main}
                        strokeWidth={1.5}
                        dash={[6, 4]}
                        fill="rgba(22, 119, 130, 0.12)"
                        listening={false}
                      />
                    );
                  })()
                )}
                {/* Auto-extract region (B1): the persistent restrict-to rectangle,
                    amber to distinguish it from the teal crop rect. The live drag
                    reuses the crop rect above; this is the committed region. */}
                {regionRect && !cropDragRef.current && (() => {
                  const a = imageToScreen(view, regionRect.x, regionRect.y);
                  const b = imageToScreen(view, regionRect.x + regionRect.width, regionRect.y + regionRect.height);
                  return (
                    <Rect
                      x={a.x}
                      y={a.y}
                      width={b.x - a.x}
                      height={b.y - a.y}
                      stroke="#d97706"
                      strokeWidth={1.5}
                      dash={[6, 4]}
                      fill="rgba(217, 119, 6, 0.10)"
                      listening={false}
                    />
                  );
                })()}
              </Layer>
            </Stage>
          </div>
        )}
        {image && hover && !isDragging && container && (
          <Loupe
            image={image}
            view={view}
            cursor={hover}
            containerWidth={container.clientWidth}
            containerHeight={container.clientHeight}
            getOverlayCanvas={getOverlayCanvas}
            overlayVersion={points}
            avoid={avoidRect}
          />
        )}
        {hoverImagePoint && (() => {
          // The readout sits bottom-left by default; a tall open card is
          // anchored there too, so flip it to bottom-right when the card would
          // cover it (David: "readouts avoid cards"). ~150x24px at (8, bottom-8).
          const RW = 150;
          const RH = 24;
          const ch = container?.clientHeight ?? 0;
          const readoutTop = ch - 8 - RH;
          const flip =
            !!avoidRect &&
            ch > 0 &&
            8 < avoidRect.left + avoidRect.width &&
            8 + RW > avoidRect.left &&
            readoutTop < avoidRect.top + avoidRect.height &&
            readoutTop + RH > avoidRect.top;
          return (
            <div
              data-testid="cursor-readout"
              style={{
                position: 'absolute',
                ...(flip ? { right: 8 } : { left: 8 }),
                bottom: 8,
                fontSize: 12,
                color: '#ccc',
                background: 'rgba(0,0,0,0.5)',
                padding: '2px 6px',
                borderRadius: 4,
                pointerEvents: 'none',
              }}
            >
              x: {hoverImagePoint.x.toFixed(1)}, y: {hoverImagePoint.y.toFixed(1)}
            </div>
          );
        })()}
      </div>
    </div>
  );
});
