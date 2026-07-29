import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import {
  CalibrationSession,
  XY_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  BAR_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  POLAR_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
  MAP_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
  SPIDER_AXES_CONFIG,
  PIE_AXES_CONFIG,
  SERIES_COLOR_PALETTE,
  calibrationCompatible,
  type AxesTypeConfig,
  type CalibratedAxes,
  type SessionSnapshot,
} from '../../engine/calibrationSession.js';
import { History } from '../../engine/history.js';
import { datasetNameError, uniqueDatasetName } from '../../engine/seriesNames.js';
import { ImageCanvas, type CanvasMarker, type ImageCanvasHandle, type MeasureOverlay, type SeriesLine, type SelectGesture } from './ImageCanvas.js';
import { polylineRuns } from '../../engine/seriesLine.js';
import type { AvoidRect } from '../../engine/loupePosition.js';
import { Popover, Menu, MenuItem, Divider } from '@mui/material';
import { IconButton } from './IconButton.js';
import { AxesTypeSelect } from './AxesTypeSelect.js';
import { FloatingPanel } from './FloatingPanel.js';
import {
  AppShell,
  TopBar,
  TopBarButton,
  KeyTip,
  TopBarGroup,
  BottomBar,
  BottomBarButton,
  LeftRail,
  RailGroup,
  CanvasRegion,
  RightSidebar,
  ResizeHandle,
  SidebarSection,
  SidebarHeading,
} from './layout.js';
import {
  HandIcon,
  PlusIcon,
  CalibrateIcon,
  DeleteIcon,
  EraseIcon,
  SelectBoxIcon,
  SelectLassoIcon,
  SelectSeriesIcon,
  SelectPointIcon,
  AutoTraceIcon,
  UndoIcon,
  RedoIcon,
  OpenIcon,
  ImageIcon,
  SaveIcon,
  ExportIcon,
  GridRemovalIcon,
  CameraIcon,
  CurveFitIcon,
  GeometryIcon,
  HelpIcon,
  ChevronDownIcon,
  EyedropperIcon,
  MeasureIcon,
  ImageEditIcon,
  ErrorBarsIcon,
} from './icons.js';
import { MeasureCard, measureIcons, type MeasureRef, type MeasureToolId, type Measurement, type SetScaleDraft } from './MeasureCard.js';
import { ImageEditCard } from './ImageEditCard.js';
import { ErrorBarsCard } from './ErrorBarsCard.js';
import { ChallengeOverlay, type ChallengePhase } from './ChallengeOverlay.js';
import { CHALLENGE_META, CHALLENGE_IDS } from './challengeExamples.js';
import { readHighScores, qualifies as scoreQualifies, insertHighScore, type HighScore } from './challengeScores.js';
import {
  drawRounds,
  calibrationInputsFromAnchors,
  truthAxisRanges,
  truthValueRange,
  truthSeriesPoints,
  truthHistogramPoints,
  truthBarValues,
  truthBoxValues,
  valueToPy,
  type ChallengeExample,
} from '../../engine/traceChallenge.js';
import { scoreRound, scoreOrderedRound, type RoundScore } from '../../algorithms/challengeScore.js';
import {
  applyImageEditOp,
  cropImage,
  clampCropRect,
  rotateImageByAngle,
  straightenAngleFromPoints,
  type ImageEditOp,
  type ImageEditResult,
  type CropRect,
} from '../../engine/imageEdit.js';
import xySample from '../../samples/xy-stress-strain.png';
import xyMultiSample from '../../samples/xy-multiseries-modulus.png';
import scatterSample from '../../samples/scatter-crosslink-modulus.png';
import dashedReleaseSample from '../../samples/xy-dashed-release.png';
import histogramSample from '../../samples/histogram-pore-size.png';
import errorBarSample from '../../samples/errorbar-tensile-cure.png';
import barSample from '../../samples/bar-tensile-strength.png';
import categoricalSample from '../../samples/categorical-fibre-modulus.png';
import barBoxSample from '../../samples/bar-box-plot-tensile-strength.png';
import polarSample from '../../samples/polar-diffusion-rate.png';
import spiderSample from '../../samples/spider-material-profile.png';
import ternarySample from '../../samples/ternary-blend-composition.png';
import mapSample from '../../samples/map-collection-sites.png';
import ccrSample from '../../samples/circular-temperature-recording.png';
// A real multi-page PDF (checkpoint 114): one figure per page, so the user can
// exercise the multi-figure flow (open -> capture -> Extract another -> flip page
// -> capture) directly. `?url` forces Vite to emit an asset URL we fetch as bytes.
import multipagePdfSample from '../../samples/multipage-figures.pdf?url';
import { ZoomControls } from './ZoomControls.js';
import {
  serializeProject,
  deserializeProject,
  serializeMultiFigureProject,
  type Provenance,
  type ProvenanceCrop,
  type SerializedMeasurement,
  type DeserializedFigure,
} from '../../engine/projectFile.js';
// Type-only: erased at compile, so it does NOT pull in any renderer runtime (which
// constructs a pdf.js worker / UTIF on import). The runtime loaders (loadPdf /
// loadTiff) are dynamically imported only when that format is actually opened (see
// openPdf), so a session that never touches a paged document loads neither. B7:
// LoadedDocument is the shared shape for PDF and TIFF alike (ui/src/pagedDocument.ts).
import type { LoadedDocument } from './pagedDocument.js';
import { pagedDocumentFormat } from '../../engine/pdfDetect.js';
import {
  serializeProjectZip,
  deserializeProjectZip,
  serializeMultiFigureZip,
  deserializeMultiFigureZip,
  isMultiFigureContainer,
  isZipContainer,
  base64ToBytes,
  bytesToBase64,
} from '../../engine/projectContainer.js';
import { readWpdArchive, listWpdFigures, importWpdFigure, type WpdFigure } from '../../engine/wpdImport.js';
import { identifyProject, unsupportedFileMessage } from '../../engine/importRegistry.js';
import { exportOmissionNote, formatLimitationNote } from '../../engine/exportCapability.js';
import type { PlotData } from '../../core/plotData.js';
import type { Dataset } from '../../core/dataset.js';
import { buildExportJson, buildExportSections } from '../../engine/exportAssembly.js';
import {
  buildSpreadsheetSeries,
  spreadsheetMaxRows as spreadsheetMaxRowCount,
  showsCategoryColumn,
  isDerivedAt,
  isCellEditable,
} from '../../engine/spreadsheetModel.js';
import { renderTable, TABLE_FORMAT_EXTENSION, type TableFormat } from '../../engine/tableFormats.js';
import type { PrecisionMode } from '../../core/exportPrecision.js';
import { formatDateNumber } from '../../core/dateConversion.js';
import { calibrationCheckBox } from '../../engine/calibrationCheck.js';
import { runSegmentFill } from '../../engine/segmentFillRun.js';
import { runColorTrace, calibrationBoxRegion } from '../../engine/colorTraceRun.js';
import { runSpiderTrace, spiderBoxRegion } from '../../engine/spiderTraceRun.js';
import type { SpiderAxes } from '../../core/axes/spider.js';
import { runBlobDetect } from '../../engine/blobDetectRun.js';
import { colorFilter, maskToRGBA, type FilterRegion } from '../../algorithms/colorFilter.js';
import {
  runCurveFit,
  getCurveFitState,
  setCurveFitState as saveCurveFitState,
  sampleCurveFitLine,
  formatCurveFitEquation,
  type CurveFitModelId,
} from '../../engine/curveFitPanel.js';
import { runGeometry, getGeometryState, setGeometryState } from '../../engine/geometryPanel.js';
import { CURVE_FIT_MAX_DEGREE } from '../../algorithms/curveFit.js';
import { FIT_MODELS } from '../../algorithms/nonlinearFit.js';
import { pointInPolygon } from '../../algorithms/geometry.js';
import { removeGridLinesOp, hexToRGB } from '../../algorithms/gridRemoval.js';
import type { AnyAxes } from '../../core/plotData.js';
import {
  measurementValue,
  slopeDeltas,
  measurementPixelValue,
} from '../../core/measurementValues.js';
import { theme, glassSurface } from './theme.js';
import { useKeyTips, keyTipLabel, redoKeyTip, KeyTipsContext } from './useKeyTips.js';
import { primaryMod } from './platform.js';

/**
 * The digitizing workspace: pick an axes type, load an image, calibrate,
 * then click to place data points. This component is a thin view over
 * engine/calibrationSession.ts's framework-agnostic state machine — all
 * the calibration-flow and point-placement logic lives there, tested
 * directly with vitest rather than only through slow Electron+Playwright
 * launches. CalibrationSession is a plain mutable class, not React state,
 * so it's held in a ref with a version counter forcing re-renders after
 * each mutating call — the same pattern already used for ImageCanvas's
 * engine/canvasView.ts functions, just applied to a stateful class
 * instead of pure functions.
 *
 * Since checkpoint 13, the session is config-driven (XY or Bar so far)
 * rather than XY-only; switching axes type replaces the session ref
 * outright (a fresh session per axes type, not a shared/mutated one).
 *
 * Since checkpoint 17, an explicit Pan/Calibrate/Place Point tool mode
 * decides what an image click does -- engine/calibrationSession.ts's
 * handleImageClick was split into handleCalibrationClick (Calibrate mode
 * only) and addDataPoint (Place Point mode only) so the two can no longer
 * be silently conflated the way the old implicit dispatch (by
 * isCalibrated()) did. Pan mode makes clicks and marker dragging fully
 * inert, for panning/inspecting a busy image without any risk of nudging
 * a handle or adding a stray point. Successfully running calibration
 * auto-advances to Place Point, matching the old implicit behavior as the
 * common-case default; switching back to Calibrate afterward is still
 * useful on its own, to drag calibration handles without an errant click
 * elsewhere adding a data point.
 *
 * Since checkpoint 18 (Polar axes), a calibration step can collect zero,
 * one, or two typed values per click (CalibStepInfo.valueFields) instead
 * of always exactly one -- Polar's origin needs no value at all (click,
 * place, advance immediately) and its P1/P2 points each need r AND θ from
 * one click. `dataValueInputs` is an array sized to the current step's
 * valueFields, rendered as one input per field.
 *
 * Since checkpoint 19 (Ternary and Map axes), Workspace.tsx itself needed
 * no further changes -- both fit entirely inside the valueFields shape
 * checkpoint 18 introduced (Ternary: every step is value-less; Map: only
 * its second step needs one value).
 *
 * Since checkpoint 20 (Circular Chart Recorder), a config can also declare
 * `globalFields` -- values entered once after every click-step is placed,
 * not tied to any one of them (CCR's "Chart Start Time"). Rendered as a
 * small form between the click-walk and the "Calibrate" button, gated on
 * `!isCalibrating && !axes` the same way the button itself already was.
 * See calibrationSession.ts's header comment for the full shape.
 *
 * Since checkpoint 21 (Box Plot / Point Groups), a dataset can carry
 * calibrationSession.ts's slot cursor. Checkpoint 107 made "Box
 * Plot" a first-class graph type whose datasets get the Min/Q1/Median/Q3/Max
 * groups from the start (BOX_PLOT_AXES_CONFIG.defaultSlots), and
 * checkpoint 109 retired the old hidden "Box Plot Groups" toggle that used to
 * opt a plain Bar chart into them -- one discoverable path now, not two. Once
 * groups are active, the points table switches from a flat per-point list to
 * one row per tuple/category (getTupleRows), and a small status line shows
 * which group the next Place Point click will fill.
 *
 * Since checkpoint 22, session.getBoxPlotGlyphs() (image-pixel-space
 * segment geometry, computed by engine/boxPlotGlyph.ts) is passed straight
 * through to ImageCanvas as the boxPlotGlyphs prop, which converts to
 * screen space and renders it as non-interactive Konva Lines layered on
 * top of the point markers.
 *
 * Since checkpoint 23, the tuple table's first data column is an
 * always-editable "Category" text input (session.getTupleLabel/
 * setTupleLabel) instead of real WPD's shift-click label-editor popup --
 * see calibrationSession.ts's header comment for why. Applied immediately
 * on every keystroke (bump() re-renders from the session), same pattern
 * as the global-field inputs above.
 *
 * Since checkpoint 24, the flat `<p>`/`<button>` tool-mode row (checkpoint
 * 17) and the "Remove last point"/"Clear points" buttons are replaced by
 * real icon buttons (IconButton.tsx, icons.tsx -- Ketcher-derived SVGs
 * from the top-level icons/ directory, see icons.tsx's own header
 * comment) laid out as two thin vertical rails flanking the canvas
 * ("Canvas-dominant layout, two thin icon-only vertical tool rails",
 * CLAUDE.md's "Product #1 — rebuild design"): a left tool-mode rail
 * (Pan/Calibrate/Place Point) and a right point-action rail (Remove
 * last point/Clear points, shown once calibrated). Every icon button
 * carries a numbered keyboard shortcut (1/2/3 for the tool modes, "no
 * exceptions" per the same design doc) wired via a single window
 * keydown listener, ignored while a text input has focus so it doesn't
 * steal digits from the data-value/category-label inputs elsewhere on
 * this page. The axes-type `<select>` and "Box Plot Groups" button move
 * into a thin top bar above the rails/canvas row. Everything below the
 * canvas row (calibration prompts, the points/tuple table, "Reset
 * calibration") is unchanged -- richer contextual right-panel guidance
 * is still a separate, not-yet-scoped backlog item.
 *
 * Since checkpoint 25 (project save/load + CSV export, see CLAUDE.md), a
 * small top-bar file row holds "Save Project"/"Open Project"/"Export CSV"
 * buttons. Save/Open go through engine/projectFile.ts's serializeProject/
 * deserializeProject (a thin wrapper around core/plotData.ts's own
 * serialize/deserialize, plus the currently loaded image as an embedded
 * data URL) and window.electronAPI's saveFile/openProject IPC calls,
 * mirroring how "Choose Image…" already talks to the main process.
 * ImageCanvas is now held via a ref (ImageCanvasHandle) instead of only
 * rendered, so Open Project can load a project's embedded image
 * programmatically and Save Project can read back whichever image is
 * currently loaded. Export CSV picks buildFlatDataCSV or buildTupleDataCSV
 * (engine/csvExport.ts) based on whether slots are active, the same
 * branch the points table below already makes.
 *
 * Since checkpoint 26 (Segment Fill auto-trace, see CLAUDE.md and
 * engine/segmentFillRun.ts), a 4th tool mode ("segment-fill", shortcut 4)
 * lets a single click flood-fill trace an entire curve instead of placing
 * one point at a time. `handleImageClick`'s segment-fill branch reads
 * native-resolution pixel data via ImageCanvas's `getImageData()` handle
 * (checkpoint 25 added the ref; this checkpoint adds this second accessor
 * on it), runs the pure engine/segmentFillRun.ts orchestration with the
 * user-adjustable `segmentFillThreshold`, and bulk-adds the resulting
 * points via session.addSegmentFillPoints. Disabled (rail button + keyboard
 * shortcut) once slots are active (Box Plot etc.) -- a continuous
 * curve trace has no group slot to file into, same reasoning as
 * addSegmentFillPoints itself.
 *
 * Since checkpoint 27 (Curve Fit & Geometry panels, see CLAUDE.md,
 * engine/curveFitPanel.ts and engine/geometryPanel.ts), two collapsible
 * panels appear below the points table once calibrated --
 * "inline collapsible sections... not floating popups" per the Product #1
 * design doc, fixing the "bolted-on" feel of the current app's own popup-
 * based Curve Fit/Geometry windows. Both are XY-axes-only (gated on
 * `config.id === 'xy'`, matching the current app's own restriction --
 * BarAxes etc. have no numeric x-coordinate to regress against or working
 * dataToPixel to draw an overlay with). Curve Fit's result is persisted in
 * the dataset's own metadata (engine/curveFitPanel.ts's getCurveFitState/
 * setCurveFitState, read into `curveFitState` below) rather than local
 * component state, which means it survives an axes-type round-trip through
 * Save/Open Project for free -- core/plotData.ts already serializes a
 * dataset's whole getMetadata() object generically. The fitted curve
 * overlay (`curveFitOverlay`, sampled in data-space by
 * engine/curveFitPanel.ts's sampleCurveFitLine then converted to pixel
 * space here via the axes' own dataToPixel) is passed to ImageCanvas as a
 * new `curveFitLine` prop. Geometry is a read-only, recompute-on-click
 * report (`geometryResult` is plain component state, not persisted --
 * matches the current app's own Geometry window, which never saves its
 * output either).
 *
 * Since checkpoint 28 (Grid Line Removal, see CLAUDE.md and
 * algorithms/gridRemoval.ts), a third always-visible collapsible panel
 * (not axes-type-gated -- it operates on the loaded image itself, not a
 * calibrated dataset, so it's useful before calibrating too) lets a color
 * + tolerance pair mask out grid-line pixels. Unlike Curve Fit/Geometry,
 * this calls algorithms/gridRemoval.ts directly rather than through an
 * engine/ wrapper -- there's no real run policy to extract (tolerance and
 * a native `<input type=color>` are always valid; the only failure mode,
 * no image loaded, is a one-line check identical in shape to Segment
 * Fill's own), matching the precedent already set by importing
 * formatPolynomial straight from algorithms/curveFit.ts above. The
 * replacement color is hardcoded to white -- the current app uses the
 * auto-detector's stored background color when available, but
 * AutoDetectionData was explicitly out of Step 1's port scope (see
 * core/plotData.ts's header comment), so there's no smarter color to read
 * yet; white is that function's own fallback path, faithfully preserved.
 * ImageCanvas's new applyImageTransform (see its own header comment)
 * replaces the loaded image in place, preserving the current zoom/pan.
 *
 * Since checkpoint 36 (see CLAUDE.md and Panel.tsx), all three of these
 * collapsible panels are MUI `Accordion`s (via Panel/PanelSummary/
 * PanelDetails) rather than native `<details>`/`<summary>` -- a straight
 * 1:1 swap of the disclosure mechanism, no change to what's inside them.
 *
 * Since checkpoint 30 (multi-dataset/series support, see CLAUDE.md and
 * engine/calibrationSession.ts's own header comment), an always-visible
 * series-list row (below the top bar) lists every dataset under the
 * current calibration -- color swatch, editable name, point count, click
 * to select, × to remove (hidden for the last remaining one) -- plus an
 * "+ Add Series" button, disabled pre-calibration like Place Point/
 * Segment Fill already were. Every existing per-dataset accessor
 * (dataPoints, hasSlots, curveFitState, CSV export, etc.) already
 * meant "for the active dataset" after engine/calibrationSession.ts's own
 * refactor, so none of that code needed to change here -- only markers
 * did: `dataPoints`' points (the active dataset, unchanged) render in
 * that dataset's own assigned color instead of the old hardcoded
 * fallback red, and `allDatasetsData` supplies every *other* dataset's
 * points as non-interactive, unlabeled colored dots layered underneath --
 * visible for context, not draggable, so a drag/click can never land on
 * the wrong series' point by accident (same "look but don't touch"
 * precedent Pan mode already established for a different reason).
 */

// 'segment-fill' | 'color-trace' | 'interpolate' are the three AUTO-EXTRACT
// mechanisms (v0.8): one rail tool ("Auto-extract", the wand) fronts all three,
// and its fold-out card switches between them. They stay distinct MODES so each
// keeps its own canvas behaviour (flood on click / colour pick + Trace / guide
// points) unchanged -- the umbrella is a presentation wrapper, not a rewrite.
type ToolMode = 'pan' | 'calibrate' | 'place-point' | 'select' | 'eraser' | 'segment-fill' | 'color-trace' | 'measure' | 'image-edit' | 'error-bars' | 'interpolate';

/** The three modes fronted by the single Auto-extract rail tool. */
const AUTO_EXTRACT_MODES: readonly ToolMode[] = ['segment-fill', 'color-trace', 'interpolate'];

/** The Select tool's four sub-modes (v1.1 #6, mirroring Ketcher's select
 * multi-tool). All select DATA points only (never calibration handles) and feed
 * the same downstream (Del removes, arrows nudge, Esc clears). The rail Select
 * button shows the active sub-mode's icon; its fold-out card is this list.
 * 'rectangle' is the default (a click selects the point under the cursor, a drag
 * boxes -- the 2026-07-21 unified Select), so first-use behaviour is unchanged. */
const SELECT_MODES: readonly {
  id: SelectGesture;
  label: string;
  hint: string;
  icon: () => React.JSX.Element;
}[] = [
  { id: 'rectangle', label: 'Rectangle', hint: 'Click a point, or drag a box', icon: SelectBoxIcon },
  { id: 'lasso', label: 'Lasso', hint: 'Drag a freeform loop around points', icon: SelectLassoIcon },
  { id: 'series', label: 'Whole series', hint: 'Click any point → select the whole series', icon: SelectSeriesIcon },
  { id: 'point', label: 'Point', hint: 'Click a single point', icon: SelectPointIcon },
];

/** The colour-match preview overlay's paint colour (checkpoint 121): a bright,
 * semi-transparent magenta that reads clearly over the black/blue/red-on-white of
 * typical scientific figures and isn't easily mistaken for a series colour. */
const COLOR_TRACE_PREVIEW_RGBA: readonly [number, number, number, number] = [255, 0, 200, 150];

/** A recorded measurement plus the geometry to draw it. Kept OUT of the series
 * datasets and (for v1) OUT of undo/history and the project file -- a separate
 * collection (docs/competitor-data-panel-study.md §5). Only Slope is wired so
 * far. */
interface RecordedMeasurement {
  id: string;
  tool: MeasureToolId;
  overlay: MeasureOverlay;
}

/**
 * A measurement's display form, DERIVED (checkpoint 82).
 *
 * **`value`/`note` used to be stored on the record**, and that was the defect:
 * `fmtNum` is `toPrecision(4)`, so the rounded string was the only copy of the
 * number — the raw double never reached the record, the project file or the
 * CSV, and a slope of 1.23456789 was destroyed at capture. Worse, being frozen
 * at capture is what made Set-scale one-way: a distance measured before a scale
 * existed kept its "12.5 px" text forever.
 *
 * Now the record is the pixels (`overlay.points`) plus the tool, and everything
 * else is computed here from `core/measurementValues.ts`. One source of truth,
 * so screen, card and export cannot drift; and a later Set-scale or
 * re-calibration re-derives every measurement for free, exactly as
 * re-calibrating an axis re-derives every data point.
 */
function measureDisplay(
  m: RecordedMeasurement,
  ctx: { scale?: MeasureScaleState | null; axes?: { pixelToData(px: number, py: number): number[] } | null }
): { value: string; note?: string } {
  const raw = measurementValue(m.tool, m.overlay.points, ctx);
  if (!raw) return { value: '—' };
  const n = raw.values[0]!;
  if (m.tool === 'slope') {
    const d = slopeDeltas(m.overlay.points, ctx.axes);
    return {
      value: Number.isFinite(n) ? `slope ${fmtNum(n)}` : 'slope ∞ (vertical)',
      note: d ? `Δy ${fmtNum(d.dy)} · Δx ${fmtNum(d.dx)}` : undefined,
    };
  }
  const value = raw.unit ? `${fmtNum(n)} ${raw.unit}`.replace(' °', '°') : fmtNum(n);
  if (m.tool === 'angle') return { value };
  // Distance/Area: show the pixel magnitude alongside when a scale is in play,
  // and prompt for one when it isn't -- the same two notes as before, now
  // derived rather than frozen.
  const px = measurementPixelValue(m.tool, m.overlay.points);
  return {
    value,
    note: ctx.scale
      ? `${fmtNum(px ?? 0)} px${m.tool === 'area' ? '²' : ''}`
      : 'set a scale for real units',
  };
}

/** A px->real-world-unit scale (Set-scale), independent of the chart axes. */
interface MeasureScaleState {
  unitPerPx: number;
  unit: string;
}

/** One undo/redo snapshot of the whole document (checkpoint 56): the session's
 * own state plus the Measure collection, which lives in React state rather than
 * the session -- so both roll back together on Ctrl+Z. */
interface DocSnapshot {
  session: SessionSnapshot;
  measurements: RecordedMeasurement[];
  scale: MeasureScaleState | null;
  /** The graph type this snapshot was taken under (checkpoint 87). A graph-type
   * change is now undoable, and undo must restore the TYPE, not just the data --
   * so the snapshot carries it and restoreDoc rebuilds the session when it
   * differs from what is live. */
  axesTypeId: string;
  /** The baked image src (a PNG data URL) this document state was captured
   * against, so an image edit (rotate/flip/crop/deskew/grid-removal) is UNDOABLE:
   * restoreDoc reloads it when it differs from what's on the canvas. Stored as
   * the (compressed) data URL rather than the raw pixel buffer; every non-image
   * commit between two edits shares the SAME string, so the undo stack holds one
   * copy per distinct image, not one per action. Null before any image loads.
   * (The deferred audit #4 item: image edits used to history.reset() because the
   * snapshot restored points but not the raster, so undo would strand points on
   * the wrong image.) */
  imageSrc: string | null;
  /** Crop/PDF-source provenance (checkpoint 95), so undoing a crop also rolls
   * back its provenance entry rather than leaving a phantom "cropped from …". */
  provenance: Provenance;
}

/**
 * One figure in a multi-figure session (checkpoint 110, design §1/§8). The unit
 * of work is a FIGURE = one image + one calibration + N series + measurements;
 * the session can hold several, and the figure jumper switches which is active.
 *
 * The ACTIVE figure's mutable state IS the live sessionRef / measurements / image
 * (in ImageCanvas); the other figures are stashed here and swapped in on switch.
 * `session` is the live object (so mutations to the active figure's session are
 * reflected without copying); the rest are value snapshots refreshed at the
 * moment we stash (see stashActiveInto / restoreFigure).
 *
 * The array is empty while there is only one figure -- the live refs simply ARE
 * that figure, and the jumper is hidden -- so a single-figure session pays
 * nothing for this (design §0). It populates only when a second figure is born.
 */
interface FigureRecord {
  /** Stable id for React keys / addressing, independent of array position. */
  id: number;
  /** The figure's name (design §5a) -- its address in the jumper and the default
   * export filename. Auto-derived from the source for now. */
  name: string;
  session: CalibrationSession<CalibratedAxes>;
  axesTypeId: string;
  imageDataURL: string;
  imageFileName?: string;
  measurements: RecordedMeasurement[];
  measureScale: MeasureScaleState | null;
  provenance: Provenance;
  figureCaptured: boolean;
  /** Linkback to the paged source this figure was captured from (design §8) --
   * what "Get another figure from the source" returns to. Null for a plain single
   * image (the baked figure is its own source). Format-generic in intent (PDF
   * today; TIFF/DjVu are future decoders behind the same shape). */
  sourcePdf: { bytes: Uint8Array; name?: string } | null;
  /** The source page this figure was captured from (1-based), or null. */
  sourcePage: number | null;
}

/** ~4 significant figures, trailing zeros trimmed. */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  return String(Number(n.toPrecision(4)));
}

/** The RecordedMeasurement <-> SerializedMeasurement mapping, shared by the
 * single- and multi-figure save/open paths (checkpoint 115): a measurement's
 * geometry (points/closed/label) lives on `overlay`; the file stores it flat. */
function toSerializedMeasurements(recorded: readonly RecordedMeasurement[]): SerializedMeasurement[] {
  return recorded.map((m) => ({
    id: m.id,
    tool: m.tool,
    points: m.overlay.points,
    closed: m.overlay.closed,
    label: m.overlay.label,
    labelAt: m.overlay.labelAt,
  }));
}
function toRecordedMeasurements(serialized: readonly SerializedMeasurement[]): RecordedMeasurement[] {
  return serialized.map((m) => ({
    id: m.id,
    tool: m.tool as MeasureToolId,
    overlay: { id: m.id, points: m.points, closed: m.closed, label: m.label, labelAt: m.labelAt },
  }));
}

/** Data-spreadsheet value formatter (checkpoint 57) -- Intl.NumberFormat, the
 * legibility win from the competitor study (plotdigitizer dumps raw 15-digit
 * floats). Up to 6 significant figures, trailing zeros trimmed, no grouping. */
const VALUE_FMT = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6, useGrouping: false });
/** For extreme magnitudes, plain decimal is an unreadable wall of zeros: a point
 * sitting on the calibration origin derives (via pixelToData float arithmetic) to
 * ~2e-15, not exactly 0, and printed as "0.00000000000000222045". Switch to
 * scientific notation only at the extremes, so the normal range -- including small
 * log-axis values like 0.0012 -- stays plain decimal. Pure presentation; the
 * record is untouched (tenet 9), and export rounds to pixel resolution separately. */
const VALUE_FMT_SCI = new Intl.NumberFormat('en-US', { notation: 'scientific', maximumSignificantDigits: 6 });
function fmtValue(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-4 || a >= 1e9)) return VALUE_FMT_SCI.format(n);
  return VALUE_FMT.format(n);
}

/** [r,g,b] -> "#rrggbb", for the series list's colour swatches + hex field
 * (checkpoint 89; hex is what the field and swatch keys use). Canvas markers
 * don't need this: Konva's fill/stroke accept a plain "rgb(r,g,b)" string
 * directly. */
function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Marker radius (screen px) for the SELECTED point on a dense connected series
 *  (checkpoint 132): the other points draw no dot at all -- the line carries the
 *  shape -- but the selected one stays a visible, grabbable dot so you can still
 *  pick a point off the curve. See engine/seriesLine.ts for the curve/scatter rule. */
const SELECTED_DOT_RADIUS = 3.5;
/** Adapt a series' {px,py} points to the {x,y} the pure polylineRuns expects. */
function runsForPoints(pts: readonly { px: number; py: number }[]): { x: number; y: number }[][] {
  return polylineRuns(pts.map((p) => ({ x: p.px, y: p.py })));
}

/** The per-row delete control on the grouped-type tables (checkpoint 129) --
 * removes a whole Box Plot box / Histogram bin. Kept as a small component so the
 * histogram and box-plot tables share one styling/labelling; the noun (box/bin)
 * comes from the config's tupleNoun, so the title reads "Delete bin 3" on a
 * histogram and "Delete box 3" on a box plot. */
function TupleDeleteButton({
  tupleIndex,
  noun,
  onDelete,
}: {
  tupleIndex: number;
  noun: string;
  onDelete: (tupleIndex: number) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`tuple-remove-${tupleIndex}`}
      title={`Delete ${noun} ${tupleIndex + 1}`}
      aria-label={`Delete ${noun} ${tupleIndex + 1}`}
      onClick={() => onDelete(tupleIndex)}
      style={{
        fontSize: theme.font.size.small,
        lineHeight: 1,
        padding: '2px 6px',
        cursor: 'pointer',
        color: theme.color.text.legend,
        background: 'none',
        border: 'none',
      }}
    >
      ✕
    </button>
  );
}

// Typed explicitly as AxesTypeConfig<CalibratedAxes>[] (not inferred via
// `as const`) so .find() below returns a single covariant type instead of
// a union of each config's own axes type -- see CalibratedAxes's doc
// comment in engine/calibrationSession.ts for why that covariance holds.
const AXES_TYPE_CONFIGS: readonly AxesTypeConfig<CalibratedAxes>[] = [
  XY_AXES_CONFIG,
  // Sits next to XY because it *is* XY underneath (checkpoint 66) -- and
  // directly above Bar because that adjacency is the point: a histogram looks
  // like bars, so Bar is the tempting pick, but BarAxes yields a typed label
  // plus one magnitude and no numeric x, silently losing the axis that makes a
  // histogram a histogram. Offering the right entry by name is what stops that
  // choice being a trap.
  HISTOGRAM_AXES_CONFIG,
  // Error bars are rail tool 7, not a graph type (checkpoint 79): you trace a
  // curve and THEN add error to it. As a graph type the choice came *before* you
  // started -- trace an XY curve, then want error, and you started over -- the
  // first of the four problems docs/error-bars-design.md lists against the tuple
  // model. The retired config was deleted outright in v1.5; see that commit.
  BAR_AXES_CONFIG,
  // Categorical-X line/scatter (checkpoint 101): BarAxes underneath (value-only
  // calibration = "X is not numeric"), captured as points. Sits by Bar because
  // it shares Bar's calibration; differs in that it plots points, not bars.
  CATEGORICAL_LINE_CONFIG,
  // Box Plot as a first-class type (checkpoint 107). BarAxes underneath, like
  // the two above, and grouped with them for that reason. Was a hidden "Box Plot
  // Groups" toggle on Bar (checkpoints 21-23) -- invisible to a first-time user,
  // which CLAUDE.md flags as a keystone failure; promoting it to a named entry is
  // correctness, not polish. Datasets auto-carry the Min/Q1/Median/Q3/Max groups.
  BOX_PLOT_AXES_CONFIG,
  POLAR_AXES_CONFIG,
  // Spider/radar (v1.4). Sits beside Polar because both are read outwards from a
  // shared centre, and differs in the way that matters: Polar has ONE radial scale
  // and a continuously measured angle, while a spider has N independent 1-D axes
  // and no angle at all. Grouping them makes that the visible question at the
  // moment of choosing -- the same job the Histogram/Bar adjacency does above.
  SPIDER_AXES_CONFIG,
  // Pie / donut (v1.6). Completes the radial group, and belongs here rather than
  // beside Bar even though its RECORD is bar-shaped -- a category plus one
  // magnitude. Someone arriving with a pie is looking for a circle, not thinking
  // about what the record turns out to be; the dropdown answers "what does my
  // figure look like?", which is why Histogram sits by Bar and Spider by Polar.
  PIE_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
  MAP_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
];

/** Bundled sample figures, one per graph type (checkpoint 46) -- Katalyst
 * Nord's own synthetic images, so free to ship. Opening one loads the image
 * and pre-selects its matching graph type, so a new user has a working
 * calibration target to explore. `axes` matches an AXES_TYPE_CONFIGS id. */
/** Data-export formats (v0.8): the three original plus PlotDigitizer-parity
 * additions. JSON has its own structured path; XLSX is a binary workbook
 * (engine/xlsxExport.ts); the rest render as text via engine/tableFormats.ts. */
type ExportFormat = 'json' | 'xlsx' | 'ods' | TableFormat;

/** Where the manual lives. Stated rather than linked -- see the Help card. */
const MANUAL_URL = 'https://github.com/katalystnord/plottracer/blob/master/MANUAL.md';

// Small inline glyphs for the per-row "copy to clipboard" affordance in the
// Export menu (v1.1 #4) -- the overlapping-cards copy mark, swapped for a tick
// on success. Kept local (like MeasureCard's own copy glyph) rather than routed
// through the file-backed icons.tsx set.
const CopyGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 11 V3.5 A1.5 1.5 0 0 1 4.5 2 H11" />
  </svg>
);
const CheckGlyph = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8.5 L6.5 12 L13 4" />
  </svg>
);

const EXAMPLES: readonly { id: string; name: string; src: string; axes: string; pdf?: boolean }[] = [
  { id: 'xy', name: 'XY — stress–strain curve', src: xySample, axes: 'xy' },
  { id: 'xy-multi', name: 'XY Multiseries — 4 curves', src: xyMultiSample, axes: 'xy' },
  // A scatter of single-colour markers (checkpoint 123) -- the shape the Blob
  // Detector exists for: Auto-trace by colour ▸ Scattered points reduces each
  // marker to one centroid. XY axes underneath (scatter is plain XY).
  { id: 'scatter', name: 'XY Scatter — modulus vs. crosslinker (Auto-trace ▸ Scattered points)', src: scatterSample, axes: 'xy' },
  // A monochrome technical drawing whose 4 curves differ ONLY by dash style
  // (checkpoint: v0.8, David) -- the case Interpolation-assist exists for. All
  // black, so Auto-trace by colour can't separate them; dashed, so Segment Fill
  // has no unbroken path to flood -- you drop guide points on the dashed curve
  // you're following and let the spline fill between (tool 8). Plain XY axes.
  { id: 'dashed', name: 'XY Dashed curves — dash-coded release (Interpolate ▸ press 8)', src: dashedReleaseSample, axes: 'xy' },
  // Error bars sit with the XY family (all axes:'xy'), above Histogram (David).
  // Opens as XY, not as the retired 'errorbar' graph type (finding C3, fixed
  // ckpt 85): error is captured on an ordinary series via rail tool 7 now, so
  // the example must demonstrate the path that exists. Left declaring
  // 'errorbar', changeAxesType silently fell back to XY while the dropdown's
  // state was still set to a type it no longer lists -- so the Select rendered
  // BLANK. The name says "press 7" because an example whose point is a tool you
  // cannot see is not an example (CLAUDE.md's keystone: he can only use what he
  // sees on screen).
  { id: 'errorbar', name: 'XY Error bars — tensile strength ± SD (press 7)', src: errorBarSample, axes: 'xy' },
  { id: 'histogram', name: 'Histogram — pore size distribution', src: histogramSample, axes: 'histogram' },
  { id: 'bar', name: 'Bar — tensile strength', src: barSample, axes: 'bar' },
  // Line (categorical X) needs an example of its own so a first-time user can
  // see what "X is a category, not a number" means (David) -- a line over
  // discrete fibre types, the shape the type exists for (checkpoint 101).
  { id: 'categorical', name: 'Line (categorical X) — fibre modulus', src: categoricalSample, axes: 'categorical' },
  // Opens as the first-class 'boxplot' type (checkpoint 107), not 'bar' + the
  // hidden toggle -- so the example demonstrates the discoverable path.
  { id: 'boxplot', name: 'Box plot — tensile strength', src: barBoxSample, axes: 'boxplot' },
  { id: 'polar', name: 'Polar — diffusion rate', src: polarSample, axes: 'polar' },
  // Spider (v1.4). Three series in distinct colours and, deliberately, SIX AXES
  // WITH SIX DIFFERENT RANGES (tensile 0-120 MPa beside a cost index 0-5) sharing
  // a centre of 0 -- the per-axis-scale case the only prior art excludes by
  // assuming one shared scale, and the thing placing a known point on every spoke
  // exists to buy. Line-only polygons: filled radar shapes blend into new colours
  // where they overlap, and every vertex has to stay clickable.
  { id: 'spider', name: 'Spider / Radar — material performance profile', src: spiderSample, axes: 'spider' },
  { id: 'ternary', name: 'Ternary — blend composition', src: ternarySample, axes: 'ternary' },
  { id: 'map', name: 'Map — collection sites', src: mapSample, axes: 'map' },
  { id: 'ccr', name: 'Circular chart — temperature', src: ccrSample, axes: 'ccr' },
  // A multi-page PDF (checkpoint 114) -- opens the PDF (not a single image), so
  // the page flipper appears and you can capture a figure per page. Demonstrates
  // the whole multi-figure workflow end to end.
  { id: 'multipage-pdf', name: 'Multi-page PDF — 3 figures (flip pages, extract each)', src: multipagePdfSample, axes: 'xy', pdf: true },
];

export function Workspace() {
  const [axesTypeId, setAxesTypeId] = useState(XY_AXES_CONFIG.id);
  const sessionRef = useRef<CalibrationSession<CalibratedAxes>>(new CalibrationSession(XY_AXES_CONFIG));
  /** Last image height reported by the canvas -- see handleCanvasStatus. Every
   * newly-constructed session must be handed this, or MapAxes silently flips y
   * against a height of 0. */
  const imageHeightRef = useRef(0);
  const imageCanvasRef = useRef<ImageCanvasHandle>(null);
  // The canvas region + the rail/card row, measured so the loupe and cursor
  // readout can hop clear of an open fold-out card (David: "overlay + dodge").
  // The row holds only the rail (one child) until a left card mounts (two), so
  // childElementCount > 1 is the exact "a card is open" signal.
  const canvasRegionRef = useRef<HTMLDivElement>(null);
  const railRowRef = useRef<HTMLDivElement>(null);
  // Rail fold-out anchoring (v1.1 step 1): the rail column (for the card's left
  // offset) and the single wrapper that holds whichever card is open (measured to
  // centre it on its button). cardPos is that wrapper's absolute position within
  // the (position:relative) rail row.
  const railColRef = useRef<HTMLDivElement>(null);
  const cardWrapRef = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [avoidRect, setAvoidRect] = useState<AvoidRect | null>(null);
  // The open card's OWN rect (no rail union) -- the loupe hides while the cursor
  // is over it (click-through cards leak hover to the canvas).
  const [cardRect, setCardRect] = useState<AvoidRect | null>(null);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Measure the rail/card row in canvas-region-local coords (the loupe's own
  // coordinate space -- ImageCanvas fills the region at its origin). Null unless
  // a left fold-out card is open (row has more than the rail as a child). The
  // functional setState keeps the object identity stable when nothing moved, so
  // the frequent ResizeObserver / version ticks don't churn a re-render.
  const measureAvoid = useCallback(() => {
    const region = canvasRegionRef.current;
    const row = railRowRef.current;
    const wrap = cardWrapRef.current;
    // A card is open iff the (now absolutely-positioned) wrapper has real content.
    const cardOpen = !!wrap && wrap.offsetHeight > 0;
    if (!region || !row || !cardOpen) {
      setAvoidRect((prev) => (prev === null ? prev : null));
      setCardRect((prev) => (prev === null ? prev : null));
      return;
    }
    const rr = region.getBoundingClientRect();
    // The card is absolute, so it doesn't extend the row's own rect -- avoid the
    // UNION of the rail column and the open card so the loupe dodges both.
    const rowR = row.getBoundingClientRect();
    const cardR = wrap!.getBoundingClientRect();
    const left = Math.min(rowR.left, cardR.left);
    const top = Math.min(rowR.top, cardR.top);
    const right = Math.max(rowR.right, cardR.right);
    const bottom = Math.max(rowR.bottom, cardR.bottom);
    const next: AvoidRect = { left: left - rr.left, top: top - rr.top, width: right - left, height: bottom - top };
    setAvoidRect((prev) =>
      prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height
        ? prev
        : next
    );
    // The card's OWN rect (no rail union) -- for hiding the loupe while over it.
    const card: AvoidRect = { left: cardR.left - rr.left, top: cardR.top - rr.top, width: cardR.width, height: cardR.height };
    setCardRect((prev) =>
      prev && prev.left === card.left && prev.top === card.top && prev.width === card.width && prev.height === card.height
        ? prev
        : card
    );
  }, []);


  // Live zoom scale + image-loaded state, pushed up from ImageCanvas
  // (checkpoint 42) so the top bar can own the Choose Image button and the
  // zoom control -- the canvas still owns the view state, this just mirrors it.
  const [canvasScale, setCanvasScale] = useState(1);
  const [canvasHasImage, setCanvasHasImage] = useState(false);
  // Current image dimensions, mirrored for e2e (a rotate swaps them, so undo can
  // be verified by dimensions reverting). Konva/canvas pixels aren't DOM-readable.
  const [canvasImageDims, setCanvasImageDims] = useState({ w: 0, h: 0 });
  const [canvasView, setCanvasView] = useState({ scale: 1, offsetX: 0, offsetY: 0 });
  // True while a figure's image is decoding after a switch (audit M1). The switch
  // stash must NOT grab the on-canvas image while this is set -- getImageDataURL
  // would return the PREVIOUS figure's image (loadImageFromSrc updates it only in
  // img.onload). Cleared by the canvas status callback below once the image settles.
  const imageLoadPendingRef = useRef(false);
  const handleCanvasStatus = useCallback((s: { scale: number; offsetX: number; offsetY: number; hasImage: boolean; imageWidth: number; imageHeight: number }) => {
    imageLoadPendingRef.current = false; // audit M1: a status report means the (switched-to) image has settled
    setCanvasScale(s.scale);
    setCanvasHasImage(s.hasImage);
    setCanvasImageDims({ w: s.imageWidth, h: s.imageHeight });
    setCanvasView({ scale: s.scale, offsetX: s.offsetX, offsetY: s.offsetY });
    // MapAxes's bottom-left origin measures up from the image floor, so the
    // session needs the height before any calibration runs (checkpoint 68).
    // Cached as well as pushed: a graph-type change *replaces* the session, and
    // a fresh one starting at height 0 would silently mirror every map y value
    // until the next view change happened to re-report it.
    imageHeightRef.current = s.imageHeight;
    sessionRef.current.setImageHeight(s.imageHeight);
  }, []);

  // Alt key-tips (v1.6): hold Alt and every control shows the accelerator it
  // actually answers to. This is the half that made removing the native menu a trade
  // rather than a regression -- see ui/src/useKeyTips.ts.
  const keyTips = useKeyTips();

  const [mode, setMode] = useState<ToolMode>('calibrate');

  // Keep the loupe/readout avoid-rect in sync: observers catch card mount and
  // rail growth (size) and region resize (which moves the centered rail); the
  // mode/version tick re-measures synchronously after a card opens or closes.
  useEffect(() => {
    measureAvoid();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureAvoid());
    if (canvasRegionRef.current) ro.observe(canvasRegionRef.current);
    if (railRowRef.current) ro.observe(railRowRef.current);
    if (cardWrapRef.current) ro.observe(cardWrapRef.current);
    window.addEventListener('resize', measureAvoid);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measureAvoid);
    };
  }, [measureAvoid]);
  useEffect(() => {
    measureAvoid();
  }, [mode, version, measureAvoid]);


  // The selected/"active" data point index in the active series (checkpoint 58):
  // the one the trash button deletes, ring-highlighted on canvas and in the
  // spreadsheet. Set to the last-placed point on placement; a canvas dot click or
  // a spreadsheet row click re-selects; null when there's no selection.
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);
  // ⚑ WHY THE SELECTION IS NOT ENOUGH ON ITS OWN. Placing a point selects it, so
  // "a point is selected" is true almost all the time and cannot mean "the user
  // picked this one to look at". A spider's live axis ray needs that distinction:
  // while stepping round the chart the highlight must name the axis about to be
  // FILLED (that is the whole drift-prevention mechanism), but once the user picks
  // a recorded point it must name the axis that point sits ON, or it asserts
  // something false about the selection (David, 2026-07-27).
  //
  // So this records which point was picked DELIBERATELY -- by a marker click, a
  // table cell, Q/W stepping or the context menu -- and capture clears it. It is
  // only ever honoured while it still equals activePointIndex, so every existing
  // "clear the selection" site invalidates it for free, which is what keeps a
  // second piece of selection state from drifting out of step with the first.
  const [pickedPointIndex, setPickedPointIndex] = useState<number | null>(null);
  /** Which axis name is being typed into, or null. Click-to-edit, like a value cell
   * -- the name is optional, so it must not sit there as a box demanding input. */
  const [editingAxisName, setEditingAxisName] = useState<number | null>(null);
  // The Select tool's multi-selection (David 2026-07-21): a set of active-series
  // DATA-point indices, filled by a marquee box or single/Shift clicks. Kept
  // separate from activePointIndex (single-select, used by Place Point) so the
  // existing single-select paths stay untouched. Never contains calibration
  // handles -- the Select tool only ever selects data points.
  const [selectedPointIndices, setSelectedPointIndices] = useState<readonly number[]>([]);
  // The Select tool's active sub-mode (v1.1 #6) + whether its fold-out picker card
  // is open. Rectangle is the default so first-use behaviour matches the old
  // unified Select (click a point OR drag a box). Picking a sub-mode folds the
  // card in and swaps the rail icon (see the Select rail button + card below).
  const [selectSubMode, setSelectSubMode] = useState<SelectGesture>('rectangle');
  const [selectFoldoutOpen, setSelectFoldoutOpen] = useState(false);

  // Position the open fold-out card: vertically CENTRED on its trigger button and
  // clamped to the window (v1.1 step 1). Absolute within the position:relative rail
  // row, so it never grows the row / fights LeftRail's vertical centring. Which
  // button a card belongs to is fixed by the active mode.
  const positionCard = useCallback(() => {
    const row = railRowRef.current;
    const col = railColRef.current;
    const wrap = cardWrapRef.current;
    if (!row || !col || !wrap) return;
    const triggerId =
      mode === 'select' && selectFoldoutOpen
        ? 'mode-select'
        : mode === 'measure'
        ? 'mode-measure'
        : mode === 'image-edit'
        ? 'mode-image-edit'
        : mode === 'error-bars'
        ? 'mode-error-bars'
        : AUTO_EXTRACT_MODES.includes(mode)
        ? 'mode-auto-extract'
        : null;
    if (!triggerId) return; // no card open -> leave the last position (it's hidden anyway)
    const btn = row.querySelector<HTMLElement>(`[data-testid="${triggerId}"]`);
    const cardH = wrap.offsetHeight;
    if (!btn || cardH === 0) return;
    const rowRect = row.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const MARGIN = 8;
    // Centre on the button, then clamp so the whole card stays on screen.
    let topVp = btnRect.top + btnRect.height / 2 - cardH / 2;
    topVp = Math.max(MARGIN, Math.min(topVp, window.innerHeight - cardH - MARGIN));
    const next = { top: topVp - rowRect.top, left: col.offsetWidth + 8 };
    setCardPos((prev) => (prev.top === next.top && prev.left === next.left ? prev : next));
  }, [mode, selectFoldoutOpen]);

  // Keep the open card centred on its button: re-run on a card open/close (mode /
  // fold-out change) and whenever the card or the rail resizes (a card that grows,
  // e.g. Measure gaining a row, must re-centre). useLayoutEffect so it lands before
  // paint -- no first-frame flash at the top of the rail.
  useLayoutEffect(() => {
    positionCard();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => positionCard());
    if (cardWrapRef.current) ro.observe(cardWrapRef.current);
    if (railRowRef.current) ro.observe(railRowRef.current);
    window.addEventListener('resize', positionCard);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', positionCard);
    };
  }, [positionCard]);

  // Dismiss the Select sub-mode strip on an outside click (v1.1 fast-follow). The
  // fly-outs autoclose via their MUI Popover, but this plain-div strip had no
  // click-away, so it lingered until an explicit toggle. Ignore clicks inside the
  // strip itself and on its Select trigger (whose own onClick already toggles it).
  useEffect(() => {
    if (mode !== 'select' || !selectFoldoutOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('[data-testid="select-foldout-card"]') || t?.closest('[data-testid="mode-select"]')) return;
      setSelectFoldoutOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [mode, selectFoldoutOpen]);

  // Canvas right-click quick menu (mouse model, David 2026-07-20). Target-sensitive:
  // a data point, a measurement, or empty canvas. `x`/`y` are viewport coordinates
  // for MUI's anchorPosition. Null = closed.
  const [ctxMenu, setCtxMenu] = useState<
    | { x: number; y: number; kind: 'point'; index: number }
    | { x: number; y: number; kind: 'measure'; id: string }
    | { x: number; y: number; kind: 'empty' }
    | null
  >(null);
  // The selected calibration handle (checkpoint 127): its step key (e.g. 'x1'),
  // set by clicking a placed handle in Calibrate mode so the arrow keys can nudge
  // it for precise placement -- calibration accuracy propagates to every extracted
  // value (tenet 1), so the handles deserve the same keyboard precision the data
  // points got in ckpt 106. Mutually exclusive with activePointIndex.
  const [activeHandleKey, setActiveHandleKey] = useState<string | null>(null);
  // The selected measurement vertex (checkpoint 128): which recorded measurement
  // and which of its points, so the arrow keys can nudge it in Measure mode. The
  // measurement's value is DERIVED from the pixels (ckpt 82), so moving a vertex
  // re-derives it live. Mutually exclusive with the point/handle selections.
  const [activeMeasure, setActiveMeasure] = useState<{ id: string; vertex: number } | null>(null);
  // Figure capture (checkpoint 102, docs/figure-capture-design.md): whether THIS
  // document's figure-of-record has been established -- the user framed the whole
  // figure and captured it as the working image. Reset with the document.
  const [figureCaptured, setFigureCaptured] = useState(false);
  // Multi-figure session (checkpoint 110, design §1/§8). `figuresRef` holds every
  // figure IN ORDER when there is more than one; it stays empty while there is a
  // single figure (the live refs simply ARE it), so a single-figure session is
  // untouched by this. `activeFigureIndex` points at the live one. The figure
  // jumper (the ◀ ▶ buttons flanking the calibration card) appears only when
  // figuresRef holds ≥2 (design §0). `figureIdRef` hands out stable ids.
  const figuresRef = useRef<FigureRecord[]>([]);
  const [activeFigureIndex, setActiveFigureIndex] = useState(0);
  const figureIdRef = useRef(0);
  // Re-entrancy guard for "Extract another graph" (audit M2) -- its async body
  // must not overlap with itself (a double-click would spawn a phantom figure).
  const extractingRef = useRef(false);
  // Mirror of figureCaptured so the figure-switch stash reads the current value
  // without a stale closure (measurements/scale/provenance already have refs).
  const figureCapturedRef = useRef(figureCaptured);
  figureCapturedRef.current = figureCaptured;
  /** Drop back to a single-figure session (empty the array, hide the jumper).
   * Called at every FRESH-document entry point (new image, single project,
   * example, a freshly opened PDF) so a prior multi-figure session doesn't leak
   * its jumper -- but NOT inside resetForNewImage, which getAnotherFigureFromSource
   * reuses to spawn a sibling (that path manages the array itself). */
  const clearFiguresToSingle = useCallback(() => {
    figuresRef.current = [];
    setActiveFigureIndex(0);
  }, []);
  // Figure-name rename draft (checkpoint 113), mirroring the series-name pattern
  // (checkpoint 75): a draft keeps the input editable through an invalid value,
  // and a notice says why a rejected name reverted rather than silently dropping.
  const [figureNameDraft, setFigureNameDraft] = useState<string | null>(null);
  const [figureNameNotice, setFigureNameNotice] = useState<string | null>(null);
  // Crop (checkpoint 63): armed by the Image card's Crop button; cropRect is the
  // pixel rectangle the canvas drag reports, shown until Apply/Cancel.
  const [cropMode, setCropMode] = useState(false);
  // Live deskew preview angle (checkpoint 64): the fine-angle slider / auto-
  // straighten set this; it CSS-rotates the canvas for feedback and is baked
  // into pixels only on Apply.
  const [previewAngle, setPreviewAngle] = useState(0);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  // Resizable right sidebar (checkpoint 60): the drag handle on its left edge
  // adjusts this width (fed to the shell grid as a CSS variable), clamped so it
  // can't swallow the canvas or shrink below the controls' minimum.
  const [sidebarWidth, setSidebarWidth] = useState(320);
  // CSV export scope (checkpoint 60): the active series only (flat pixel-free
  // rows / Box Plot tuples) or every series side by side (spreadsheet columns).
  const [exportScope, setExportScope] = useState<'active' | 'all'>('active');
  // Export precision: 'auto' rounds each value to the figure's own resolution
  // (~half a pixel in data units, core/exportPrecision.ts); 'full' emits every
  // computed digit for a user who wants to judge precision themselves. Default
  // auto -- the honest, lossless-for-small-magnitudes rule.
  const [exportFullPrecision, setExportFullPrecision] = useState(false);
  // The Export format dropdown's anchor (checkpoint 61) -- null when closed.
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  // Which format was just copied to the clipboard, for a transient "Copied"
  // tick beside its row (v1.1 #4). Cleared on a timer / when the menu reopens.
  const [copiedFmt, setCopiedFmt] = useState<ExportFormat | null>(null);
  // The series-colour picker lives in a Popover off a single swatch button
  // (checkpoint 91), so the series row keeps its width for the NAME field
  // instead of a swatch strip + eyedropper + hex crowding it out.
  const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
  const startSidebarResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      const onMove = (ev: MouseEvent) => setSidebarWidth(Math.max(260, Math.min(760, startWidth + (startX - ev.clientX))));
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [sidebarWidth]
  );
  // The tool the ruler was toggled ON from, so pressing it again restores what
  // you were doing rather than dumping you into an arbitrary mode. Measure is a
  // press-again-to-close toggle, unlike the mutually-exclusive digitizing tools.
  // (toggleMeasure itself is defined below, after the measure state it clears.)
  const preMeasureModeRef = useRef<ToolMode>('calibrate');
  // Same press-again-to-close toggle for the Image-editing card (checkpoint 62).
  const preImageEditModeRef = useRef<ToolMode>('calibrate');
  // ...and for the Error-bars card (checkpoint 79). The rail tool IS the design:
  // it lets you trace a curve and THEN add error to it, which the retired
  // "Error Bars" graph type could not (you had to choose before you started).
  const preErrorBarsModeRef = useRef<ToolMode>('calibrate');
  // The series the caps will record error FOR, and the base name they take
  // ("SD" -> "SD upper"/"SD lower"). The name is the ONLY meaning we record --
  // no error kind, deliberately (docs/error-bars-design.md).
  const [errorTargetIndex, setErrorTargetIndex] = useState(0);
  const [errorBaseName, setErrorBaseName] = useState('SD');
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  // The in-progress link drag: the datum it snapped to, and where the cursor is
  // now. Drives the live overlay -- the line you drag IS the relationship.
  const [errorDrag, setErrorDrag] = useState<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(
    null
  );
  const errorDragRef = useRef<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  // True while an arrow-key nudge burst is in flight; the commit is deferred to
  // keyup so a held key / rapid taps collapse to ONE undo step (see the keyboard
  // handler). A ref, not state -- it must not trigger a re-render.
  const nudgePendingRef = useRef(false);
  const toggleImageEdit = useCallback(() => {
    setCropMode(false); // leaving/re-entering the card abandons an in-progress crop
    setCropRect(null);
    setPreviewAngle(0); // and abandons an un-applied deskew preview
    setMode((m) => {
      if (m === 'image-edit') return preImageEditModeRef.current;
      preImageEditModeRef.current = m;
      return 'image-edit';
    });
  }, []);
  // The top foldable calibration card (checkpoint 50): expanded shows the full
  // point matrix overlaid on the chart's (usually empty) top strip; collapsed
  // is a thin chip bar. Defaults open while calibrating.
  const [calibExpanded, setCalibExpanded] = useState(true);
  // "Common origin" (XY): X1 (X=0) and Y1 (Y=0) share one physical point (the
  // axis crossing) -- the overwhelmingly common case. When ticked, placing X1
  // auto-reuses that pixel for Y1 so you never place or reuse it by hand.
  const [commonOrigin, setCommonOrigin] = useState(true);

  const [dataValueInputs, setDataValueInputs] = useState<string[]>([]);
  const [projectError, setProjectError] = useState<string | null>(null);
  /** What an import could not carry across, in plain words. NOT an error — the
   * figure opened — so it gets its own surface rather than borrowing the red
   * one. A foreign project that quietly loses half its content is the failure
   * this codebase has killed more than once, so these are shown, not logged. */
  const [projectNotice, setProjectNotice] = useState<string | null>(null);
  const [segmentFillThreshold, setSegmentFillThreshold] = useState(40);
  const [segmentFillError, setSegmentFillError] = useState<string | null>(null);
  const [curveFitDegree, setCurveFitDegree] = useState(1);
  const [curveFitModel, setCurveFitModel] = useState<CurveFitModelId>('polynomial');
  const [curveFitRestrict, setCurveFitRestrict] = useState(false);
  const [curveFitXMinInput, setCurveFitXMinInput] = useState('');
  const [curveFitXMaxInput, setCurveFitXMaxInput] = useState('');
  const [curveFitError, setCurveFitError] = useState<string | null>(null);
  // Geometry's `closed` choice is UI state; whether geometry is ON for a series
  // (and its result) is now DERIVED from the dataset's stored GeometryState +
  // current points (v1.1), so it recomputes-on-edit -- see geometryState/geometryRun
  // below. `geometryTableOpen` toggles the per-point table in the output panel.
  const [geometryClosed, setGeometryClosed] = useState(false);
  const [geometryTableOpen, setGeometryTableOpen] = useState(false);
  // Default tuned to the light grey most plotting libraries (matplotlib et al.)
  // draw gridlines in (~#e6e6e6), with a forgiving tolerance, so "Remove" does
  // something visible out of the box instead of silently matching nothing (the
  // old #c8c8c8/30 default missed typical grids entirely). The eyedropper below
  // is the real answer for arbitrary images.
  const [gridRemovalColor, setGridRemovalColor] = useState('#e6e6e6');
  const [gridRemovalTolerance, setGridRemovalTolerance] = useState(40);
  const [gridRemovalError, setGridRemovalError] = useState<string | null>(null);
  // Auto-trace by colour (checkpoint 118, v0.6): pick the curve's colour (the
  // eyedropper's 'trace' target), a tolerance, and trace EVERY matching pixel --
  // so a dashed / marker-only / crossed curve extracts in one pass, which Segment
  // Fill's connectivity structurally cannot. Default black: technical figures are
  // often B&W. `colorTraceInfo` carries the match count (or an error) as feedback.
  const [colorTraceColor, setColorTraceColor] = useState('#000000');
  const [colorTraceTolerance, setColorTraceTolerance] = useState(60);
  const [colorTraceInfo, setColorTraceInfo] = useState<string | null>(null);
  // What the coloured pixels ARE (checkpoint 122): a continuous 'curve' (averaging
  // window, one point per column) or 'scatter' markers (blob detector, one point
  // per connected marker = its centroid). Both share the colour filter + preview;
  // only the reduction differs. `colorTraceMinBlob` drops noise specks below that
  // pixel diameter (scatter only).
  const [colorTraceShape, setColorTraceShape] = useState<'curve' | 'scatter'>('curve');
  const [colorTraceMinBlob, setColorTraceMinBlob] = useState(3);
  // B1 — an optional plot-box rectangle (image-pixel space) the trace is limited
  // to, so a legend swatch / axis label of the same colour outside it is ignored.
  // Drawn by a DIRECT marquee drag on the image (v1.2): no arm-first toggle -- the
  // drag is live whenever By-colour is active (bar the eyedropper), unifying it
  // with the Select tool's box gesture. Cleared via the ✕ button.
  const [colorTraceRegion, setColorTraceRegion] = useState<FilterRegion | null>(null);
  // Live colour-match PREVIEW (checkpoint 121): while the Auto-trace panel is
  // open, an overlay on the canvas shows exactly which pixels the current colour +
  // tolerance would capture, so the user sees a grid/axis grab BEFORE tracing --
  // the suite's most tenet-1-relevant affordance. `colorTraceMask` holds the
  // painted offscreen canvas + its matched-pixel count/percentage; it is shown
  // whenever the Auto-extract card's "By colour" mechanism is active (mode ===
  // 'color-trace'), so no separate panel-open flag is needed (v0.8).
  // Eyedropper (checkpoint 90 generalized it): the next canvas click samples
  // that pixel's colour, for the GRID-removal colour or the active SERIES'
  // colour, instead of its usual tool action. One mechanism, two targets --
  // both a crash-free replacement for the native <input type="color"> dialog,
  // which crashes this Electron build on Linux. The series eyedropper matches a
  // series to the colour the figure actually draws it in; the swatches/hex
  // beside it are for figures whose series ARE'NT distinguished by colour (line
  // style, markers), where eyedropping would give two series one colour.
  const [eyedropper, setEyedropper] = useState<null | 'grid' | 'series' | 'trace'>(null);
  // --- Trace Challenge (v1.2 game). `gamePhase` null = not playing; it's
  // orthogonal to `mode` (a round runs in place-point mode). Round setup +
  // scoring live in the callbacks below; the UI is ./ChallengeOverlay.tsx. ---
  const [gamePhase, setGamePhase] = useState<ChallengePhase | null>(null);
  const [roundQueue, setRoundQueue] = useState<ChallengeExample[]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundStartMs, setRoundStartMs] = useState(0);
  const [roundScores, setRoundScores] = useState<RoundScore[]>([]);
  const [highScores, setHighScores] = useState<HighScore[]>([]);
  // Which datapoint-table value cell is mid-edit (checkpoint 39). Editing a
  // value and moving the point are two views of one thing: on commit the
  // point is repositioned via the axes' inverse transform. Kept as the raw
  // in-progress string so typing doesn't move the point on every keystroke --
  // it applies once, on blur/Enter.
  const [editingCell, setEditingCell] = useState<{ index: number; axis: number; value: string } | null>(null);
  // The wrong-axis notice for the click just made (v1.4, Spider) -- transient UI
  // state, never part of the record. Every capture click overwrites it (with null
  // when the click was fine), and the effect below clears it whenever the tool or
  // the active series changes, so it can never outlive the click it describes.
  // ⚑ That clearing was CLAIMED by this comment before it was written: driving the
  // app left the notice standing after a series switch, describing a click made in
  // a different context entirely. A comment is not an implementation.
  const [captureNotice, setCaptureNotice] = useState<{
    capturedOnLabel: string;
    nearestLabel: string;
    offRayPx: number;
    /** The tool and series it was raised under. Rendering is gated on these still
     * matching, which is how the notice expires WITHOUT an effect that clears it —
     * a self-expiring value rather than state to be swept up after. */
    mode: ToolMode;
    seriesIndex: number;
  } | null>(null);

  const session = sessionRef.current;
  const config = session.getConfig();
  // `version` is a deliberately unused dependency of the memos below — it
  // exists only to force recomputation after a mutation to the ref-held
  // session, which React can't see on its own.
  void version;

  // ⚑ THE STEP LIST COMES FROM THE SESSION, never from `config.steps` (v1.4).
  // For the eight fixed-shape graph types the two are identical, which is exactly
  // what makes a stray `config.steps` read dangerous: it keeps working everywhere
  // except on a Spider, where the config holds only the centre step and the whole
  // calibration card would render as a one-step chart with its axes missing.
  const repeatingStep = session.getRepeatingStepInfo();

  const currentStep = session.getCurrentStep();
  const pendingPixel = session.getPendingPixel();
  const axes = session.getAxes();
  const isCalibrating = currentStep !== null;

  // --- Measure tool state (checkpoint: measure) ------------------------------
  // Active measurement tool (lifted from MeasureCard so canvas clicks route by
  // it), the recorded measurements, and the in-progress click(s). pendingMeasure
  // is mirrored into a ref so handleMeasureClick reads the latest without a stale
  // closure / extra dep churn.
  const [measureTool, setMeasureTool] = useState<MeasureToolId | null>('slope');
  // Measurements + scale are mirrored into refs so commit()/captureDoc() (undo,
  // checkpoint 56) read the latest value synchronously right after an update,
  // without a stale closure. Always mutate through applyMeasurements/
  // applyMeasureScale so the ref and state never diverge.
  const [measurements, setMeasurements] = useState<RecordedMeasurement[]>([]);
  const measurementsRef = useRef<RecordedMeasurement[]>([]);
  const applyMeasurements = useCallback((next: RecordedMeasurement[]) => {
    measurementsRef.current = next;
    setMeasurements(next);
  }, []);
  // Provenance -- where the figure came from (checkpoint 95). A ref mirror like
  // measurements above, so saveProject reads the latest synchronously. Crops are
  // the only recorded entry today; a crop resets history (applyPixelTransform),
  // so provenance never needs to ride the undo snapshot -- nothing undoes across
  // a crop. Set on load, appended on crop, cleared on a genuinely new document.
  const [provenance, setProvenance] = useState<Provenance>({});
  const provenanceRef = useRef<Provenance>({});
  // The opened image's filename (v0.8) -- see exportBaseName. A ref, not state:
  // it only feeds an on-demand default filename, never a render.
  const imageNameRef = useRef<string | null>(null);
  const applyProvenance = useCallback((next: Provenance) => {
    provenanceRef.current = next;
    setProvenance(next);
  }, []);

  // PDF state (checkpoint 96): non-null only while a live PDF is open and one of
  // its rendered pages is the current image. The parsed document lives in a ref
  // (kept open so flipping pages doesn't re-parse); the flipper reads name/page/
  // count. Both mirror to a ref so goToPdfPage reads the current value without a
  // stale closure. Cleared whenever a non-PDF source replaces the image (a new
  // image, an opened project) -- see resetDocument / loadCalibratedFigure.
  const [pdfState, setPdfState] = useState<{ name?: string; pageCount: number; page: number } | null>(null);
  const pdfStateRef = useRef<{ name?: string; pageCount: number; page: number } | null>(null);
  // Holds the open paged document (PDF or multipage TIFF -- B7). The `pdf*` names
  // are historical; the value is any LoadedDocument.
  const pdfDocRef = useRef<LoadedDocument | null>(null);
  // The raw SOURCE PDF bytes (checkpoint 104), kept so Save Project can bundle
  // the source into the archive -- the evidence travels with the record (§5).
  // Same lifecycle as pdfDocRef: set when a PDF opens, cleared when a non-PDF
  // source replaces it (closePdf); survives page flips and figure capture, since
  // the captured figure still came from that PDF. Also restored from a project
  // that carried its source.
  const sourcePdfRef = useRef<{ bytes: Uint8Array; name?: string } | null>(null);
  // Reactive mirror of sourcePdfRef, just for the disclosure chip (§5: the user
  // should SEE that the saved project carries the source PDF -- e.g. before
  // pushing a project with a paywalled paper inside). Always set via setSourcePdf.
  const [sourcePdfBundled, setSourcePdfBundled] = useState(false);
  const setSourcePdf = useCallback((src: { bytes: Uint8Array; name?: string } | null) => {
    sourcePdfRef.current = src;
    setSourcePdfBundled(src !== null);
  }, []);
  const applyPdfState = useCallback((next: { name?: string; pageCount: number; page: number } | null) => {
    pdfStateRef.current = next;
    setPdfState(next);
  }, []);
  const [pendingMeasure, setPendingMeasure] = useState<{ x: number; y: number }[]>([]);
  const pendingMeasureRef = useRef<{ x: number; y: number }[]>([]);
  const setPending = useCallback((pts: { x: number; y: number }[]) => {
    pendingMeasureRef.current = pts;
    setPendingMeasure(pts);
  }, []);
  const [measureError, setMeasureError] = useState<string | null>(null);
  const measureIdRef = useRef(0);
  // Set-scale: a px->real-world-unit reference independent of the chart axes, so
  // Distance/Area measure real lengths on any image (drawings, micrographs). null
  // until defined. `settingScale` arms the next two clicks; once placed, their
  // pixel separation becomes `scaleDraftPx` and the card shows the value+unit form.
  const [measureScale, setMeasureScale] = useState<MeasureScaleState | null>(null);
  const measureScaleRef = useRef<MeasureScaleState | null>(null);
  const applyMeasureScale = useCallback((next: MeasureScaleState | null) => {
    measureScaleRef.current = next;
    setMeasureScale(next);
  }, []);
  const [settingScale, setSettingScale] = useState(false);
  const [scaleDraftPx, setScaleDraftPx] = useState<number | null>(null);
  const [scaleValueInput, setScaleValueInput] = useState('');
  const [scaleUnitInput, setScaleUnitInput] = useState('mm');
  const clearMeasurements = useCallback(() => {
    applyMeasurements([]);
    setPending([]);
    setMeasureError(null);
    applyMeasureScale(null);
    setSettingScale(false);
    setScaleDraftPx(null);
  }, [setPending, applyMeasurements, applyMeasureScale]);
  // Toggle the ruler tool: entering measure remembers the prior tool (so a second
  // press restores it) and abandons any stale in-progress measurement; leaving
  // returns to that prior tool. Measure is only ever entered through here, so
  // clearing pending here covers every enter/leave without a setState-in-effect.
  const toggleMeasure = useCallback(() => {
    setPending([]);
    setMeasureError(null);
    setSettingScale(false);
    setScaleDraftPx(null);
    setMode((m) => {
      if (m === 'measure') return preMeasureModeRef.current;
      preMeasureModeRef.current = m;
      return 'measure';
    });
  }, [setPending]);

  // Toggle the error-bars tool (checkpoint 79) -- same press-again-to-close
  // shape as Measure/Image Edit. Abandons any half-made drag on the way in or
  // out, since the card is the only way to reach the mode.
  const toggleErrorBars = useCallback(() => {
    setErrorNotice(null);
    errorDragRef.current = null;
    setErrorDrag(null);
    setMode((m) => {
      if (m === 'error-bars') return preErrorBarsModeRef.current;
      preErrorBarsModeRef.current = m;
      return 'error-bars';
    });
  }, []);

  // Auto-extract (v0.8) -- the single wand tool fronting the three tracing
  // mechanisms. Toggling enters the last-used mechanism (default flood-fill) and
  // opens its card; toggling again restores the prior tool. `setAutoExtractMech`
  // is the card's mechanism switcher. Mirrors the Measure/Error-bars toggle.
  const preAutoExtractModeRef = useRef<ToolMode>('pan');
  const lastAutoExtractMechRef = useRef<ToolMode>('segment-fill');
  const toggleAutoExtract = useCallback(() => {
    // The rail button greys out for bar-family types; the `4` hotkey is the other
    // door, so the rule lives here where both converge. Auto-extract's mechanisms
    // are curve tools and would record a bar's MIDPOINT as its value.
    if ((session.getConfig().autoExtractKind ?? 'curve') === 'none') return;
    // ⚑ A spider has exactly ONE mechanism: the axis-aware colour trace. Flood-fill
    // and Guide points are curve tools with nowhere to file their output (a spider's
    // slots are its axes), so they are not offered -- and this is where the card is
    // ENTERED, so without it the last-used mechanism could open a card whose button
    // would silently do nothing.
    if (session.getConfig().autoExtractKind === 'along-axes') lastAutoExtractMechRef.current = 'color-trace';
    setSegmentFillError(null);
    setColorTraceInfo(null);
    setMode((m) => {
      if (AUTO_EXTRACT_MODES.includes(m)) {
        lastAutoExtractMechRef.current = m;
        return preAutoExtractModeRef.current;
      }
      preAutoExtractModeRef.current = m;
      return lastAutoExtractMechRef.current;
    });
  }, [session]);
  const setAutoExtractMech = useCallback((mech: ToolMode) => {
    setSegmentFillError(null);
    setColorTraceInfo(null);
    lastAutoExtractMechRef.current = mech;
    setMode(mech);
  }, []);

  // Undo/redo (checkpoint 38, see CLAUDE.md). Snapshot-based: the session
  // knows how to capture/restore its whole state (calibrationSession.ts's
  // captureState/restoreState), and this generic stack (engine/history.ts)
  // holds those snapshots. Held in a ref for the same reason the session is
  // -- it's mutable state React doesn't own; every commit/undo/redo is paired
  // with a bump() so canUndo/canRedo (read live off it during render) stay
  // current. Created once via useState's lazy initializer (not useRef with a
  // render-body assignment, which the React Compiler's
  // preserve-manual-memoization rule rejects as a render-phase mutation) with
  // the fresh session's snapshot as the baseline present, so the first real
  // action has something to undo back to. `history` is stable for the
  // component's life -- never re-set -- so its own mutation via
  // commit/undo/redo is a plain method call, not React state.
  const [history] = useState(
    () =>
      new History<DocSnapshot>({
        session: sessionRef.current.captureState(),
        measurements: [],
        scale: null,
        axesTypeId: sessionRef.current.getConfig().id,
        imageSrc: null,
        provenance: {},
      })
  );
  // A full-document snapshot (session + Measure collection + image) for the undo
  // stack. `imageSrcOverride` is passed only where a reset runs BEFORE its image
  // has loaded (openExample / loadCalibratedFigure / restoreFigure all reset then
  // loadImageFromSrc) -- otherwise the on-canvas src (getImageDataURL, now a
  // synchronous mirror) is already current.
  const captureDoc = useCallback(
    (imageSrcOverride?: string | null): DocSnapshot => ({
      session: sessionRef.current.captureState(),
      measurements: measurementsRef.current,
      scale: measureScaleRef.current,
      axesTypeId: sessionRef.current.getConfig().id,
      imageSrc: imageSrcOverride !== undefined ? imageSrcOverride : imageCanvasRef.current?.getImageDataURL() ?? null,
      provenance: provenanceRef.current,
    }),
    []
  );

  // Record a snapshot of the just-mutated session as a new undoable state.
  // Discrete actions (place/move/remove point, calibration step, add/remove
  // series, curve fit) call this instead of bump(); text/color edits bump()
  // live and commit once on blur (see commitPendingEdit) so a rename isn't one
  // undo entry per keystroke.
  // Unsaved-work tracking (data-loss guard): any finalized mutation flows
  // through commit(), so that's the one place to flag "there is work here that
  // hasn't been saved or exported." Cleared whenever the document is persisted
  // (Save/Export) or replaced by a fresh one (new image, Open Project, axes-type
  // change, Reset). A destructive action confirms before discarding while dirty.
  const dirtyRef = useRef(false);
  const markClean = useCallback(() => {
    dirtyRef.current = false;
  }, []);
  const confirmDiscardIfDirty = useCallback(() => {
    if (!dirtyRef.current) return true;
    return window.confirm(
      'You have unsaved work (calibration and/or data points) that has not been saved or exported. Continue and discard it?'
    );
  }, []);

  const commit = useCallback(() => {
    history.commit(captureDoc());
    dirtyRef.current = true;
    bump();
  }, [history, captureDoc, bump]);

  // The OS window-close button / Cmd+Q is the one destructive door that used to
  // bypass the unsaved-work guard (v1.0.1 audit B1) -- it hit app.quit()
  // directly. The main process now intercepts the close and asks us here; run
  // the SAME confirm every other door uses and reply. notifyCloseGuardReady lets
  // main know the handler is mounted, so it only traps a close once we're
  // actually handling it (a still-loading/crashed renderer stays closable).
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onCloseRequest || !api.confirmClose || !api.notifyCloseGuardReady) return;
    const unsubscribe = api.onCloseRequest(() => {
      api.confirmClose(confirmDiscardIfDirty());
    });
    api.notifyCloseGuardReady();
    return unsubscribe;
  }, [confirmDiscardIfDirty]);

  // Rotate/flip the image (checkpoint 62). The pixel op runs on the native-
  // resolution buffer, and the SAME coordinate map moves every calibration
  // handle, data point and measurement overlay, so the whole document stays
  // aligned (re-runs calibration inside transformAllPixels; ops are isometries,
  // so Set-scale + measurement values are preserved). Treated as a document-level
  // change: history is reset (a later undo can't restore points misaligned with
  // the edited raster), and the view re-fits when the dimensions swap (rotate).
  // Shared tail for every image edit (rotate/flip/crop/deskew): push the
  // transformed raster to the canvas, carry all document pixels through mapPoint,
  // record an UNDOABLE step (the snapshot now carries the baked image src, so
  // Ctrl+Z reloads the pre-edit raster with the pre-edit points -- deferred audit
  // #4), and refit if the dimensions changed. `undoable=false` for figure
  // Capture, which is the start of the session and history-resets like a fresh
  // document (and whose figureCaptured gate isn't in the snapshot).
  const applyPixelTransform = useCallback(
    (result: ImageEditResult, refit: boolean, undoable = true) => {
      const { data, width, height, mapPoint } = result;
      imageCanvasRef.current?.applyImageTransform(data, width, height, refit);
      sessionRef.current.transformAllPixels(mapPoint);
      applyMeasurements(
        measurementsRef.current.map((m) => ({
          ...m,
          overlay: {
            ...m.overlay,
            points: m.overlay.points.map((p) => mapPoint(p.x, p.y)),
            labelAt: mapPoint(m.overlay.labelAt.x, m.overlay.labelAt.y),
          },
        }))
      );
      setActivePointIndex(null);
      // A crop/rotate/flip/deskew changes the pixel space, so the By-colour trace
      // region (in the OLD pixels, and not even axis-aligned after a rotate) is
      // stale -- clear it so the next trace re-derives it (2026-07-22 audit C).
      setColorTraceRegion(null);
      // captureDoc reads the just-baked src via getImageDataURL's synchronous
      // mirror (applyImageTransform set it above), so the new snapshot records the
      // EDITED image while the prior present still holds the pre-edit one.
      if (undoable) history.commit(captureDoc());
      else history.reset(captureDoc());
      dirtyRef.current = true;
      bump();
    },
    [history, captureDoc, applyMeasurements, bump]
  );

  const applyImageEdit = useCallback(
    (op: ImageEditOp) => {
      const img = imageCanvasRef.current?.getImageData();
      if (!img) return;
      setCropMode(false); // a rotate/flip cancels any in-progress crop
      setCropRect(null);
      applyPixelTransform(applyImageEditOp(op, img.data, img.width, img.height), op === 'rotate-cw' || op === 'rotate-ccw');
    },
    [applyPixelTransform]
  );

  // Crop (checkpoint 63): a canvas drag-rectangle (reported via handleCropRect)
  // then Apply.
  const startCrop = useCallback(() => {
    setCropMode(true);
    setCropRect(null);
  }, []);
  const cancelCrop = useCallback(() => {
    setCropMode(false);
    setCropRect(null);
  }, []);
  const applyCrop = useCallback(() => {
    const img = imageCanvasRef.current?.getImageData();
    if (!img || !cropRect) return;
    // Record the CLAMPED rect (what is actually cropped) against the pre-crop
    // dimensions -- provenance (checkpoint 95). cropImage clamps internally and
    // returns null for a degenerate rect; guard on the same clamp so a no-op
    // drag records nothing. Append after the transform so a failed crop can't
    // leave a phantom entry.
    const clamped = clampCropRect(cropRect, img.width, img.height);
    const result = cropImage(img.data, img.width, img.height, cropRect);
    setCropMode(false);
    setCropRect(null);
    if (result && clamped) {
      // Provenance BEFORE the transform: applyPixelTransform captures the undoable
      // snapshot, so the crop entry must already be in provenanceRef for the
      // post-crop snapshot to carry it (and for redo to restore it). Spread the
      // existing provenance so cropping a PDF page keeps its source (checkpoint 97).
      const entry: ProvenanceCrop = { fromWidth: img.width, fromHeight: img.height, rect: clamped };
      applyProvenance({ ...provenanceRef.current, crops: [...(provenanceRef.current.crops ?? []), entry] });
      applyPixelTransform(result, true);
    }
  }, [cropRect, applyPixelTransform, applyProvenance]);

  // Capture figure (checkpoint 102) -- the first step of the calibration
  // pipeline, and the design's keystone (docs/figure-capture-design.md). The
  // user has framed the whole figure in the view (which they do anyway to see
  // the axes); this crops the SOURCE to exactly that framing, at native
  // resolution, and makes it the working image they then calibrate and trace on.
  // So "the screen grab is the same as what was calibrated" holds by
  // construction. The single human-judgment confirm is the whole cleverness --
  // no CV, no calibration-geometry guessing. Reuses the crop machinery + the
  // ckpt-95 provenance path, so autosave (when it lands) persists the captured
  // figure as ordinary session state, no special case.
  const captureFigure = useCallback(() => {
    const img = imageCanvasRef.current?.getImageData();
    const rect = imageCanvasRef.current?.getViewImageRect();
    if (!img || !rect) {
      setProjectError('Load an image before capturing the figure.');
      return;
    }
    if (
      !window.confirm(
        'Capture the figure to work from.\n\n' +
          'Is the ENTIRE figure — plot, axes, tick labels and title — clearly visible in the view? ' +
          'Zoom or pan first if any of it is off-screen or too small.\n\n' +
          'The captured figure becomes the image you calibrate and trace on.'
      )
    ) {
      return;
    }
    const clamped = clampCropRect(rect, img.width, img.height);
    if (!clamped) return;
    // If the framed view IS the whole image (the loaded image already is the
    // figure), the capture is a no-op crop: just establish the figure-of-record,
    // don't re-crop or record a provenance entry (nothing was actually cropped).
    // Only a sub-region capture crops the source and records where it came from.
    const isWholeImage = clamped.x === 0 && clamped.y === 0 && clamped.width === img.width && clamped.height === img.height;
    if (!isWholeImage) {
      const result = cropImage(img.data, img.width, img.height, rect);
      if (!result) return;
      // Provenance before the transform (see applyCrop), so capture's history-
      // reset baseline records where the figure was cropped from. Capture is the
      // start of the session (its figureCaptured gate is React state, not in the
      // snapshot), so it resets rather than adding an undoable step -- unlike the
      // Image Edit card's rotate/flip/crop/deskew.
      const entry: ProvenanceCrop = { fromWidth: img.width, fromHeight: img.height, rect: clamped };
      applyProvenance({ ...provenanceRef.current, crops: [...(provenanceRef.current.crops ?? []), entry] });
      applyPixelTransform(result, true, false);
    }
    setFigureCaptured(true);
    // Hand off to the now-unlocked next step (v1.0 audit B3): if the user prepped
    // the source in Image-edit mode, capturing there would otherwise strand them in
    // it with tips still saying "rotate / flip", not "now calibrate". Advancing to
    // Calibrate mirrors how a finished calibration auto-advances to Place Point.
    setMode('calibrate');
    setProjectError(null);
  }, [applyPixelTransform, applyProvenance]);

  // Deskew (checkpoint 64): the fine-angle slider previews live via previewAngle;
  // Apply bakes an arbitrary-angle rotation (grows the canvas to the rotated
  // bounds) through the same document-aligning path as rotate/flip/crop.
  //
  // ⚑ CORRECTED 2026-07-17 — the paragraph that used to sit here was FALSE, and
  // it was this feature's whole justification. It read: "WPD's XY calibration is
  // built with noRotation=true ... it reads x from pixel-x and y from pixel-y
  // assuming screen-aligned axes ... which is exactly the point of a deskew: you
  // straighten a tilted scan so its axes become horizontal/vertical, and the
  // re-projected values are then MORE correct."
  //
  // Both halves are wrong. WPD's control is "Skip rotation correction", shipped
  // UNCHECKED, so upstream has always corrected tilt; and since checkpoint 68 so
  // do we -- `skipRotation` is a real per-axes option defaulting to false
  // (calibrationSession.ts:533,555). **Verified by execution:** on a chart whose
  // axes are tilted ~11 degrees, X2 reads [10, 0] with the default and [10, 2]
  // only if you tick Skip rotation. The calibration is not mis-projecting, so
  // there is no mis-projection for a deskew to fix.
  //
  // **What deskew is, therefore: a VISUAL aid, not an accuracy tool.** It makes a
  // crooked scan easier to read and trace. It buys no correctness on XY -- and
  // "Auto-straighten" is redundant by construction, since it levels the image off
  // the X1->X2 handles whose tilt the calibration already corrects.
  //
  // **And it is the one image edit that RESAMPLES the record** (bilinear, in
  // engine/imageEdit.ts): 90/flip/crop are isometries and lose nothing, while an
  // arbitrary rotation degrades the source pixels every trace is read from. So
  // the cost is real and the accuracy benefit is nil -- do NOT extend this on
  // accuracy grounds, and prefer letting the calibration handle tilt (tenets
  // 9/10: don't degrade the evidence; carry the least modeling).
  //
  // It still changes already-calibrated values, because the pixels move; history
  // is reset either way (below).
  const applyDeskew = useCallback(
    (deg: number) => {
      setPreviewAngle(0);
      if (!deg) return; // nothing to bake at 0°
      const img = imageCanvasRef.current?.getImageData();
      if (!img) return;
      applyPixelTransform(rotateImageByAngle(img.data, img.width, img.height, deg), true);
    },
    [applyPixelTransform]
  );

  // "Auto-straighten" (XY): the two X-axis calibration handles (X1, X2) are meant
  // to lie on the horizontal axis, so the pixel angle between them IS the scan's
  // tilt -- level it directly, no line detection needed (the shortcut CLAUDE.md's
  // Engauge assessment #6 describes). Returns null when it can't apply (not XY,
  // or the two handles aren't both placed).
  const autoStraightenAngle = useCallback((): number | null => {
    // Capability, not identity (ckpt 73): Histogram and Error Bars place the
    // same X1/X2 handles this reads, so they can be auto-straightened too.
    // Read through the ref, as the next line already does: this callback is
    // keyed on axesTypeId (a graph-type change replaces the session), so
    // capturing `session` itself would be a stale reference waiting to happen.
    if (sessionRef.current.getConfig().axesKind !== 'xy') return null;
    const placed = sessionRef.current.getPlacedPoints();
    const x1 = placed['x1'];
    const x2 = placed['x2'];
    if (!x1 || !x2) return null;
    return straightenAngleFromPoints({ x: x1.px, y: x1.py }, { x: x2.px, y: x2.py });
    // No deps: everything is read through sessionRef at call time, so the
    // callback is always fresh and its identity need never change. Callers
    // invoke it during render, so a graph-type change is picked up anyway.
  }, []);

  // A text/color field edit is "pending" between its first keystroke and the
  // blur that ends it -- tracked so commitPendingEdit only pushes an undo
  // entry when something actually changed, not on a bare focus+blur.
  const pendingEditRef = useRef(false);
  const commitPendingEdit = useCallback(() => {
    if (!pendingEditRef.current) return;
    pendingEditRef.current = false;
    commit();
  }, [commit]);

  // Re-sync React-held UI state to a session that was just replaced wholesale
  // by an undo/redo restore -- the same shape of resync openProject does after
  // a load. Transient errors and the derived geometry result are cleared;
  // Curve Fit's input controls are re-read from the restored active dataset's
  // own metadata; and a point-placing mode is dropped back to calibrate if the
  // restore rolled back past calibration.
  const syncAfterRestore = useCallback(() => {
    const s = sessionRef.current;
    setDataValueInputs([]);
    setProjectError(null);
    setSegmentFillError(null);
    setCurveFitError(null);
    setGridRemovalError(null);
    setActivePointIndex(null); // the restored point set may differ -- clear the selection
    setSelectedPointIndices([]); // ...and the marquee selection: its indices refer to a point set that may no longer exist
    const cf = getCurveFitState(s.getDataset());
    setCurveFitDegree(cf ? cf.degree : 1);
    setCurveFitModel(cf?.model ?? 'polynomial');
    setCurveFitRestrict(cf ? cf.restrict : false);
    setCurveFitXMinInput(cf && cf.xMin != null ? String(cf.xMin) : '');
    setCurveFitXMaxInput(cf && cf.xMax != null ? String(cf.xMax) : '');
    // If the restore rolled back past calibration, only the axes-dependent tools
    // (Place Point / Segment Fill) must drop back to Calibrate. Pan and Measure
    // work fine uncalibrated (Measure's Distance/Set-scale need no axes), so a
    // measurement undo shouldn't kick the user out of the Measure card.
    setMode((m) => (!s.getAxes() && (m === 'place-point' || m === 'eraser' || m === 'segment-fill' || m === 'color-trace' || m === 'interpolate') ? 'calibrate' : m));
    // ⚑ An auto-extract mode must also drop when the restored config is bar-family:
    // its mechanisms record a bar's MIDPOINT (59f94a6 closed the rail button and
    // the `4` hotkey, but not this door). Undoing back across a graph-type change
    // rebuilds the session under the snapshot's config while the MODE is untouched,
    // so a bar chart could be left sitting in segment-fill with the fold-out open
    // and the stage handler live -- confidently wrong numbers. Found by the v1.3
    // gate. openProject/restoreFigure already reset the mode; this path did not.
    setMode((m) => (s.getConfig().axesKind === 'bar' && AUTO_EXTRACT_MODES.includes(m) ? 'place-point' : m));
  }, []);

  const restoreDoc = useCallback(
    (snapshot: DocSnapshot) => {
      // Undoing across a graph-type change (checkpoint 87): the snapshot was
      // taken under a different config, so rebuild the session with that config
      // BEFORE restoring into it -- restoreState populates data and axes but not
      // the config, and pouring an XY snapshot into a Histogram session would
      if (sessionRef.current.getConfig().id !== snapshot.axesTypeId) {
        const cfg =
          AXES_TYPE_CONFIGS.find((c) => c.id === snapshot.axesTypeId) ?? XY_AXES_CONFIG;
        sessionRef.current = new CalibrationSession(cfg);
        sessionRef.current.setImageHeight(imageHeightRef.current);
        setAxesTypeId(snapshot.axesTypeId);
      }
      sessionRef.current.restoreState(snapshot.session);
      applyMeasurements(snapshot.measurements);
      applyMeasureScale(snapshot.scale);
      applyProvenance(snapshot.provenance); // roll a crop's provenance back with it
      setPending([]); // any in-progress measurement is abandoned by the restore
      // Undo/redo across an IMAGE edit (rotate/flip/crop/deskew/grid-removal):
      // reload the snapshot's baked raster, but only when it actually differs, so
      // an ordinary point/calibration undo never reloads the image or refits the
      // view. loadImageFromSrc keeps the filename and doesn't fire onImageOpened,
      // so it won't re-trigger a document reset.
      const currentSrc = imageCanvasRef.current?.getImageDataURL() ?? null;
      if (snapshot.imageSrc && snapshot.imageSrc !== currentSrc) {
        imageCanvasRef.current?.loadImageFromSrc(snapshot.imageSrc, imageCanvasRef.current?.getImageFileName() ?? undefined);
      }
      syncAfterRestore();
      bump();
    },
    [applyMeasurements, applyMeasureScale, applyProvenance, setPending, syncAfterRestore, bump]
  );
  const undo = useCallback(() => {
    const snapshot = history.undo();
    if (snapshot) restoreDoc(snapshot);
  }, [history, restoreDoc]);
  const redo = useCallback(() => {
    const snapshot = history.redo();
    if (snapshot) restoreDoc(snapshot);
  }, [history, restoreDoc]);

  // Close the in-progress Area polygon (via the card's Finish button or Enter):
  // shoelace pixel area, scaled to unit² if a Set-scale exists, recorded as one
  // undoable action. Defined after commit so it can push an undo entry, but
  // before the keydown effect that binds Enter to it.
  const finishArea = useCallback(() => {
    const pts = pendingMeasureRef.current;
    if (pts.length < 3) {
      setMeasureError('Place at least 3 points to close an area.');
      return;
    }
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x;
      cy += p.y;
    }
    // The AREA is derived (core/measurementValues.ts) -- only the centroid is
    // still computed here, because that is geometry (where the label hangs),
    // not a value.
    const id = `meas-${(measureIdRef.current += 1)}`;
    const overlay: MeasureOverlay = { id, points: pts, closed: true, label: '', labelAt: { x: cx / pts.length, y: cy / pts.length } };
    applyMeasurements([{ id, tool: 'area', overlay }, ...measurementsRef.current]);
    setPending([]);
    setMeasureError(null);
    commit();
  }, [setPending, applyMeasurements, commit]);
  const cancelArea = useCallback(() => {
    setPending([]);
    setMeasureError(null);
  }, [setPending]);

  // Delete the active point (or, if none is selected, the last one -- so the
  // trash button still behaves like the old "remove last"). The newest remaining
  // point becomes active, so repeated clicks peel points off predictably.
  // Declared above the keyboard effect that binds Del/Backspace onto it (a later
  // const would sit in the temporal dead zone when the effect's deps evaluate).
  const removeActivePoint = useCallback(() => {
    const count = session.getDataPoints().length;
    if (count === 0) return;
    const target = activePointIndex != null && activePointIndex < count ? activePointIndex : count - 1;
    // Route through the series-kind-aware removeDataPoints for: error-bar series
    // (cascade the parent's caps / remove the whole cap pair), AND a MID-sequence
    // delete on a grouped box/histogram series (remove the whole box/bin) —
    // matching the Eraser, Select+Del and right-click doors (2026-07-22 audits:
    // this door orphaned caps AND peeled one member off a completed tuple). The
    // LAST point still uses removeLastPoint below, whose group-cursor walk-back
    // Box Plot construction relies on (Del peels the just-placed member).
    if (
      session.getErrorRelation(session.getActiveDatasetIndex()) ||
      session.activeHasErrorSeries() ||
      (session.hasSlots() && target !== count - 1)
    ) {
      session.removeDataPoints([target]);
    } else if (target === count - 1) {
      session.removeLastPoint();
    } else {
      session.removeDataPointAt(target);
    }
    // Land the selection on a still-selectable point, never a derived
    // interpolation sample (those can't be nudged or deleted, and deleting an
    // anchor refits the fill anyway -- checkpoint 120). For an ordinary series
    // every point is selectable, so this is the last remaining point, exactly
    // as before (checkpoint 58).
    const roles = session.getDataPointRoles();
    let next: number | null = null;
    for (let i = 0; i < roles.length; i++) if (roles[i] !== 'interpolated') next = i;
    setActivePointIndex(next);
    commit();
  }, [session, activePointIndex, commit]);

  // Delete a specific point by index (the canvas context menu's "Delete point").
  // Mirrors removeActivePoint's careful last-vs-mid handling and selection reland,
  // but for an explicitly named index rather than the active one.
  const removeDataPointByIndex = useCallback(
    (index: number) => {
      const count = session.getDataPoints().length;
      if (index < 0 || index >= count) return;
      // removeDataPoints routes by series kind (2026-07-22): an error-cap pair,
      // a parent-point cascade (take its error bar too), a box-plot/histogram
      // tuple, or a plain single-point removal. So the Eraser and the right-click
      // "Delete point" never orphan a cap or leave a partial box.
      session.removeDataPoints([index]);
      const roles = session.getDataPointRoles();
      let next: number | null = null;
      for (let i = 0; i < roles.length; i++) if (roles[i] !== 'interpolated') next = i;
      setActivePointIndex(next);
      commit();
    },
    [session, commit]
  );

  // --- Canvas context-menu targeting (mouse model) ---------------------------
  // Each maps a right-clicked object to the menu state. The canvas stays ignorant
  // of what an id means (linkSnap's pattern): only active-series `point-*` markers
  // and recorded measurements open a menu; anything else falls through.
  const handlePointContextMenu = useCallback((id: string, clientX: number, clientY: number) => {
    if (!id.startsWith('point-')) return; // calibration handles / inactive series: no menu
    setCtxMenu({ x: clientX, y: clientY, kind: 'point', index: Number(id.slice('point-'.length)) });
  }, []);
  const handleMeasureContextMenu = useCallback((id: string, clientX: number, clientY: number) => {
    if (!measurementsRef.current.some((m) => m.id === id)) return;
    setCtxMenu({ x: clientX, y: clientY, kind: 'measure', id });
  }, []);
  const handleCanvasContextMenu = useCallback((clientX: number, clientY: number) => {
    setCtxMenu({ x: clientX, y: clientY, kind: 'empty' });
  }, []);

  // Numbered single-key tool-mode shortcuts (1/2/3), "no exceptions" per
  // CLAUDE.md's Product #1 design notes -- ignored while a text input has
  // focus so a digit typed into a data-value or category-label field
  // doesn't get silently intercepted as a tool switch.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      // Inside a text field, let the browser's own text undo/redo and typed
      // digits win -- both the numbered tool shortcuts and app-level undo are
      // suppressed here, deliberately (a rename field's own Ctrl+Z should undo
      // typing, not roll back the whole digitization).
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // Undo/redo (checkpoint 38): Ctrl/Cmd+Z, and Ctrl/Cmd+Shift+Z or
      // Ctrl/Cmd+Y for redo -- the exact bindings Ketcher's own undo action
      // uses (see the reference survey in CLAUDE.md's checkpoint 38 notes).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      // Any OTHER primary-modified key (Ctrl/Cmd + anything except the undo/redo
      // handled above) belongs to the native menu accelerators, NOT to the
      // renderer tool/nav shortcuts below -- so bail here. This is what makes
      // KEYBOARD ZOOM work: the View menu already binds CmdOrCtrl+Equal/-/0/1 to
      // menu:zoom-in/out/fit/100 (electron-menu.cjs), wired to the canvas in
      // ImageCanvas (onMenuEvent). A renderer copy of those bindings would
      // DOUBLE-fire (menu accelerator + this keydown) and, worse, the modified
      // digit would fall through to the bare-digit tool chain below (Ctrl+1 ->
      // Calibrate, Ctrl+3 -> delete a point). Guarding here fixes both.
      if (primaryMod(e)) return;
      // Enter = accept/confirm the current step's primary action (David, mouse+
      // keyboard theme). Value-in-a-box Enter is handled by each input's own
      // onKeyDown (and this global handler already returned above when a text
      // field has focus) -- this branch is the "highlighted box": the primary
      // button of whatever step is on screen. Precedence is innermost-first.
      if (e.key === 'Enter') {
        // A drawn crop rectangle awaiting its "Apply" bar.
        if (cropRect) {
          e.preventDefault();
          applyCrop();
          return;
        }
        // An in-progress Area polygon: Enter finishes it (its own "Finish" button).
        if (mode === 'measure' && measureTool === 'area') {
          finishArea();
          return;
        }
        // A fully-placed-but-not-yet-run calibration: Enter is the "Calibrate"
        // button. Triggered through the button itself (like the 7/8 fly-outs
        // below) rather than calling runCalibration directly -- runCalibration is
        // declared later in the component, so a direct reference here would be a
        // temporal-dead-zone crash in this effect's dependency list. The button
        // is only in the DOM when a run is actually available (!isCalibrating &&
        // !axes), so this can only ever advance a ready calibration.
        if (figureCaptured && !axes) {
          const btn = document.querySelector('[data-testid="run-calibration"]') as HTMLElement | null;
          if (btn) {
            e.preventDefault();
            btn.click();
          }
          return;
        }
        return;
      }
      // Esc = back out of the current step (David), innermost-first. Each branch
      // undoes exactly one layer of in-progress state, so repeated Esc walks back
      // out: pending gesture -> selection -> (nothing). It never discards recorded
      // data -- only abandons half-made input or clears a selection. (Open MUI
      // popovers/menus close on Escape via their own onClose before this runs.)
      if (e.key === 'Escape') {
        // The canvas quick menu is open: close it and stop (MUI also closes it on
        // Escape, but handle it here so Esc doesn't ALSO clear a selection).
        if (ctxMenu !== null) {
          e.preventDefault();
          setCtxMenu(null);
          return;
        }
        // A crop being drawn/awaiting-Apply: cancel it (unarms crop mode too).
        if (cropMode || cropRect) {
          e.preventDefault();
          cancelCrop();
          return;
        }
        // A half-made measurement or an armed Set-scale: abandon the pending clicks.
        if (settingScale || pendingMeasure.length > 0) {
          e.preventDefault();
          setPending([]);
          setSettingScale(false);
          setScaleDraftPx(null);
          setMeasureError(null);
          return;
        }
        // Otherwise clear whatever single thing is selected. Only one of these is
        // ever set at a time (each self-clears on mode change), so order is moot.
        // The Select tool's marquee selection is a set, cleared the same way.
        if (mode === 'select' && selectedPointIndices.length > 0) {
          e.preventDefault();
          setSelectedPointIndices([]);
          return;
        }
        if (activePointIndex != null) {
          e.preventDefault();
          setActivePointIndex(null);
          return;
        }
        if (activeHandleKey != null) {
          e.preventDefault();
          setActiveHandleKey(null);
          return;
        }
        if (activeMeasure != null) {
          e.preventDefault();
          setActiveMeasure(null);
          return;
        }
        return;
      }
      // Keyboard CALIBRATION-HANDLE adjustment (checkpoint 127): nudge the selected
      // handle with the arrows, same zoom-scaled step + keyup-coalesced undo as the
      // data-point nudge below. updateCalibPointPixel re-runs calibration live, so
      // every data value updates as the handle moves -- the reason handle precision
      // matters more than any single point's (tenet 1). Checked before the
      // data-point branch since the two selections are mutually exclusive.
      if (
        activeHandleKey != null &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        const h = session.getPlacedPoints()[activeHandleKey];
        if (h) {
          e.preventDefault();
          const step = (e.shiftKey ? 5 : 0.5) / (canvasScale || 1);
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          session.updateCalibPointPixel(activeHandleKey, h.px + dx, h.py + dy);
          nudgePendingRef.current = true;
          bump();
        }
        return;
      }
      // Keyboard MEASUREMENT-VERTEX adjustment (checkpoint 128): nudge the selected
      // measurement point; its value re-derives from the pixels (ckpt 82), so the
      // card and on-canvas label update live. Same zoom-scaled step + keyup-
      // coalesced undo. The label anchor follows the points' centroid so it stays
      // attached to the measurement as a vertex moves.
      if (
        activeMeasure != null &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        e.preventDefault();
        const step = (e.shiftKey ? 5 : 0.5) / (canvasScale || 1);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        applyMeasurements(
          measurementsRef.current.map((m) => {
            if (m.id !== activeMeasure.id) return m;
            const points = m.overlay.points.map((p, i) => (i === activeMeasure.vertex ? { x: p.x + dx, y: p.y + dy } : p));
            const labelAt = {
              x: points.reduce((s, p) => s + p.x, 0) / points.length,
              y: points.reduce((s, p) => s + p.y, 0) / points.length,
            };
            return { ...m, overlay: { ...m.overlay, points, labelAt } };
          })
        );
        nudgePendingRef.current = true;
        return;
      }
      // Data-point arrow-nudge and Del are gated to the modes where you actually
      // EDIT data points -- Place Point and Interpolate -- and only there does the
      // tips bar advertise them. Without this gate a data-point selection lingering
      // from Place Point would be silently nudged/deleted by arrows/Del while the
      // user is in Measure/Calibrate/etc. aiming at something else (a silent
      // wrong-target edit; the calibration-handle and measurement selections each
      // already self-clear on mode change, and this is the same discipline for the
      // data-point selection). Release-gate audit finding, v0.6.0.
      // The Select tool acts on the whole marquee SELECTION (David 2026-07-21):
      // arrows nudge every selected point together, Del removes them all as ONE
      // undo step, Esc clears the selection. Gated on select mode + a non-empty
      // selection, so a stale selection never acts from another mode.
      if (mode === 'select' && selectedPointIndices.length > 0) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const step = (e.shiftKey ? 5 : 0.5) / (canvasScale || 1);
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          const pts = session.getDataPoints();
          for (const i of selectedPointIndices) {
            const p = pts[i];
            if (p) session.updateDataPointPixel(i, p.px + dx, p.py + dy);
          }
          nudgePendingRef.current = true;
          bump();
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          session.removeDataPoints(selectedPointIndices);
          setSelectedPointIndices([]);
          setActivePointIndex(null);
          commit();
          return;
        }
        // (Escape clears the marquee selection in the main Escape ladder above.)
      }
      const dataPointEditing = mode === 'place-point' || mode === 'interpolate';
      // Keyboard point adjustment -- the precision path WPD leans on. Nudge the
      // SELECTED data point with the arrow keys; the step is scaled to zoom so one
      // press is ~0.5 SCREEN px at any magnification (WPD's 0.5/zoomRatio), Shift
      // for a coarse 10x. We move the PIXEL and let the value derive (tenet 9),
      // through the very method a drag uses. Commit is deferred to keyup so a
      // burst -- or a held key auto-repeating -- collapses to ONE undo step.
      if (
        dataPointEditing &&
        activePointIndex != null &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        const p = session.getDataPoints()[activePointIndex];
        if (p) {
          e.preventDefault();
          const step = (e.shiftKey ? 5 : 0.5) / (canvasScale || 1);
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          session.updateDataPointPixel(activePointIndex, p.px + dx, p.py + dy);
          nudgePendingRef.current = true;
          bump();
        }
        return;
      }
      // Delete the selected point -- only when one is EXPLICITLY selected AND in a
      // data-editing mode, so a stray Backspace never silently peels off a point
      // while you are aiming at a measurement or a calibration handle.
      if (dataPointEditing && (e.key === 'Delete' || e.key === 'Backspace') && activePointIndex != null) {
        e.preventDefault();
        removeActivePoint();
        return;
      }
      // Del also removes the active *measurement* -- the on-canvas "line" (David:
      // "remove currently active point or line"). Gated on the measure mode + an
      // explicit active selection, the same discipline as the point delete above,
      // so a stale selection from another mode is never silently removed. The
      // active-measure selection self-clears on mode change (ckpt 128), so this
      // can only ever target the measurement the user is actually pointing at.
      if (mode === 'measure' && activeMeasure != null && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        applyMeasurements(measurementsRef.current.filter((m) => m.id !== activeMeasure.id));
        setActiveMeasure(null);
        commit();
        return;
      }
      // Q / W walk the active selection between points -- previous (Q), next (W) --
      // so a point placed earlier is reachable by keyboard, not only by clicking.
      // Derived interpolation samples are skipped (you never nudge those), so on an
      // interpolation-assist curve this steps anchor-to-anchor; in Interpolate mode
      // a click ADDS a new anchor, so Q/W is the only way to re-select an existing
      // one to nudge or delete it. Wraps around. Ignored with no points to walk.
      if (axes && (e.key === 'q' || e.key === 'Q' || e.key === 'w' || e.key === 'W')) {
        const roles = session.getDataPointRoles();
        const selectable: number[] = [];
        for (let i = 0; i < roles.length; i++) if (roles[i] !== 'interpolated') selectable.push(i);
        if (selectable.length === 0) return;
        e.preventDefault();
        const dir = e.key === 'w' || e.key === 'W' ? 1 : -1;
        const cur = activePointIndex != null ? selectable.indexOf(activePointIndex) : -1;
        const nextPos =
          cur === -1 ? (dir === 1 ? 0 : selectable.length - 1) : (cur + dir + selectable.length) % selectable.length;
        setActivePointIndex(selectable[nextPos]!);
        setPickedPointIndex(selectable[nextPos]!);
        return;
      }
      // Digit hotkeys mirror the rail order (v0.8, 0-based). Each guard matches
      // its button's `disabled` so a key can't do what the greyed button can't.
      // Hotkeys 0-9 run straight down the rail (2026-07-22 redesign): 0 Pan ·
      // 1 Calibrate · 2 Edit img · 3 Add · 4 Auto-extract · 5 Select · 6 Error
      // bars · 7 Measure · 8 Curve fit · 9 Geometry. Curve Fit (8) / Geometry (9)
      // are fly-out panels: open them by triggering their rail button (skipped
      // when disabled). Clear-all (top bar) and the Eraser have NO key -- both
      // destructive, kept out of the 0-9 run.
      if (e.key === '0') setMode('pan');
      else if (e.key === '1' && figureCaptured) setMode('calibrate');
      else if (e.key === '2' && canvasHasImage) toggleImageEdit();
      else if (e.key === '3' && axes) setMode('place-point');
      else if (e.key === '4' && axes && (session.getConfig().autoExtractKind ?? 'curve') !== 'none') toggleAutoExtract();
      // Hotkey 5 activates Select with the current sub-mode but does NOT open the
      // picker (that's the rail button / its arrow); reset so a stale-open card
      // from an earlier session can't re-appear (v1.1 #6).
      else if (e.key === '5' && axes) { setMode('select'); setSelectFoldoutOpen(false); }
      else if (e.key === '6' && session.getDatasetInfos().some((d) => d.pointCount > 0)) toggleErrorBars();
      else if (e.key === '7' && figureCaptured) toggleMeasure();
      else if (e.key === '8') (document.querySelector('[data-testid="curve-fit-trigger"]:not([disabled])') as HTMLElement | null)?.click();
      else if (e.key === '9') (document.querySelector('[data-testid="geometry-trigger"]:not([disabled])') as HTMLElement | null)?.click();
    }
    // Commit the nudge once, on release -- one undo step per gesture, not per event.
    function onKeyUp(e: KeyboardEvent) {
      if (
        nudgePendingRef.current &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        nudgePendingRef.current = false;
        commit();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [axes, session, undo, redo, toggleMeasure, toggleImageEdit, toggleErrorBars, toggleAutoExtract, figureCaptured, canvasHasImage, mode, measureTool, finishArea, activePointIndex, activeHandleKey, activeMeasure, applyMeasurements, canvasScale, bump, commit, removeActivePoint, selectedPointIndices, cropRect, cropMode, applyCrop, cancelCrop, settingScale, pendingMeasure, setPending, ctxMenu]);

  // Shared internals of swapping to a fresh session under config `id` and
  // clearing every per-figure panel. Does NOT touch history or the dirty flag --
  // the two callers below differ precisely on that, which is the whole point of
  // splitting them.
  const swapSession = useCallback(
    (id: string, session: CalibrationSession<CalibratedAxes>) => {
      sessionRef.current = session;
      sessionRef.current.setImageHeight(imageHeightRef.current);
      setActivePointIndex(null);
      setAxesTypeId(id);
      // A replaced session means a new figure/calibration, so the By-colour trace
      // region (the old calibration box, in the old pixel space) is stale — clear
      // it here so every session-swap path is covered, not just resetDocument
      // (2026-07-22 audit A1).
      setColorTraceRegion(null);
      // ⚑ The import notice describes the project that was OPENED. A new session
      // means that figure is gone, and a true sentence about the wrong subject is
      // worse than none -- it read as though the CURRENT figure had lost content.
      setProjectNotice(null);
      setDataValueInputs([]);
      setSegmentFillError(null);
      setCurveFitDegree(1);
      setCurveFitModel('polynomial');
      setCurveFitRestrict(false);
      setCurveFitXMinInput('');
      setCurveFitXMaxInput('');
      setCurveFitError(null);
      setGeometryClosed(false);
    },
    []
  );

  /**
   * The graph-type dropdown (checkpoint 87). On the SAME image, so it preserves
   * as much as it honestly can and is fully undoable.
   *
   * - **Calibration is KEPT when the new type reads the same clicks** (XY <->
   *   Histogram share `XY_AXES_CONFIG.steps`) -- re-placing four handles to
   *   relabel the graph was pure waste. Data is not carried: the fresh session
   *   has the right empty structure, and whether last type's *points* mean
   *   anything under the new one is a question about the data, which differs by
   *   type.
   * - **commit(), NOT history.reset()** -- Ctrl+Z brings the whole old document
   *   back (calibration, points, measurements, AND type). `history.reset` made a
   *   graph-type change UNRECOVERABLE: checkpoint 71's exact bug class, still live
   *   in this one button. The dropdown's confirmDiscardIfDirty warned but could
   *   not be taken back.
   */
  const changeAxesType = useCallback(
    (id: string) => {
      const nextConfig = AXES_TYPE_CONFIGS.find((c) => c.id === id) ?? XY_AXES_CONFIG;
      const oldSession = sessionRef.current;
      const keep = oldSession.isCalibrated() && calibrationCompatible(oldSession.getConfig(), nextConfig);
      const inputs = keep ? oldSession.getCalibrationInputs() : null;

      clearMeasurements(); // measurements belong to the old figure; clear before snapshotting
      const next = new CalibrationSession(nextConfig);
      if (inputs) next.adoptCalibration(inputs);
      swapSession(id, next);
      setMode(keep ? 'place-point' : 'calibrate');
      setCalibExpanded(!keep); // a kept calibration is done -> stay folded (ckpt 86)
      commit();
    },
    [commit, clearMeasurements, swapSession]
  );

  /** Start a genuinely CLEAN document under config `id` -- a freshly opened image
   * or example. Unlike the dropdown: never inherits the old image's calibration
   * (it would be misaligned to different pixels), and resets history + the dirty
   * flag because this is a new document, not an edit of the current one. */
  const resetDocument = useCallback(
    // `imageSrc` is passed by callers that reset BEFORE their new image finishes
    // loading (openExample), so the fresh baseline snapshot records the incoming
    // image rather than the outgoing one. Omitted where the image is already on
    // the canvas (drop/paste/dialog/PDF-page all loadImageFromSrc first).
    (id: string, imageSrc?: string | null) => {
      clearMeasurements();
      applyProvenance({}); // a new figure has its own (empty) origin
      setFigureCaptured(false); // a new document's figure-of-record isn't captured yet (ckpt 102)
      applyPdfState(null); // a genuinely new document is not a live PDF page (openPdf re-sets it after)
      swapSession(id, new CalibrationSession(AXES_TYPE_CONFIGS.find((c) => c.id === id) ?? XY_AXES_CONFIG));
      setMode('calibrate');
      setCalibExpanded(true);
      history.reset(captureDoc(imageSrc));
      markClean();
      bump();
    },
    [history, bump, markClean, clearMeasurements, captureDoc, swapSession, applyProvenance, applyPdfState]
  );

  const resetForNewImage = useCallback(() => {
    resetDocument(axesTypeId);
  }, [resetDocument, axesTypeId]);

  // Release the parsed pdf.js document and forget it (checkpoint 100, audit T4).
  // Called when a NON-PDF source replaces the image (a plain image, an opened
  // project) -- NOT on a page flip, which keeps the doc alive. Without this the
  // document leaked: destroy() was only called when the *next* PDF was opened.
  // pdfState is cleared separately by resetDocument/loadCalibratedFigure.
  const closePdf = useCallback(() => {
    pdfDocRef.current?.destroy();
    pdfDocRef.current = null;
    setSourcePdf(null); // a non-PDF source has no bundled source (ckpt 104)
  }, [setSourcePdf]);

  // Fired by ImageCanvas after a non-PDF image is opened (dialog/drop/paste).
  // ImageCanvas never fires this for a PDF page (loadPdfPageAsImage calls
  // resetForNewImage directly), so closing the PDF here is safe -- it only runs
  // when a genuinely different, non-PDF source arrives (checkpoint 100, T4).
  const handleImageOpened = useCallback((name?: string) => {
    imageNameRef.current = name ?? null;
    closePdf();
    clearFiguresToSingle(); // a freshly opened image is a new, single-figure document
    resetForNewImage();
  }, [closePdf, resetForNewImage, clearFiguresToSingle]);

  // The opened image's filename (v0.8), for the default export filename -- a user
  // extracting `figure3.png` gets `figure3.csv`, not a generic `data.csv`. The
  // PDF source name and the active figure name are fallbacks (a PDF page, or a
  // pasted image with no filename, still gets a sensible base).
  const exportBaseName = useCallback((): string => {
    const raw = imageNameRef.current || provenanceRef.current.source?.name || null;
    if (!raw) return 'data';
    const base = raw.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
    return base || 'data';
  }, []);

  // --- PDF loading (checkpoint 96, see ui/src/pdfRender.ts) ---------------------
  // A PDF can't be decoded by <img>, so ImageCanvas hands us its bytes; we render
  // a page to a PNG (pdf.js) and feed it in like any other image. A page is an
  // INPUT and a figure is an OUTPUT (design §3), so loading a page starts a fresh
  // document (resetForNewImage) -- but the PDF stays open (pdfDocRef) so the pager
  // can flip pages without re-parsing. resetForNewImage clears pdfState, so we set
  // it AFTER (both synchronous).
  const loadPdfPageAsImage = useCallback(
    async (doc: LoadedDocument, page: number, name?: string) => {
      const png = await doc.renderPage(page);
      imageCanvasRef.current?.loadImageFromSrc(png, name);
      resetForNewImage(); // clears provenance/pdfState; we re-set both below
      applyPdfState({ name, pageCount: doc.pageCount, page });
      // Record where this figure came from: the PDF + its page (checkpoint 97).
      // The rendered page's image name would otherwise lose the page number.
      applyProvenance({ source: name != null ? { name, page } : { page } });
      setProjectError(null);
    },
    [resetForNewImage, applyPdfState, applyProvenance]
  );

  // Open a paged document (PDF, or TIFF / multipage TIFF -- B7). The right renderer
  // is dynamically imported by format, so the pdf.js worker / UTIF is loaded only
  // when that format is actually opened, not at app load (see the type-only import
  // up top). ImageCanvas routes any browser-undecodable bytes here.
  const openPdf = useCallback(
    async (bytes: Uint8Array, name?: string) => {
      const fmt = pagedDocumentFormat(bytes);
      try {
        let doc: LoadedDocument;
        if (fmt === 'tiff') {
          const { loadTiff } = await import('./tiffRender.js');
          doc = loadTiff(bytes);
        } else {
          // PDF (the default; ImageCanvas only routes PDF/TIFF bytes here).
          const { loadPdf } = await import('./pdfRender.js');
          doc = await loadPdf(bytes);
        }
        pdfDocRef.current?.destroy(); // release any previously open document
        pdfDocRef.current = doc;
        clearFiguresToSingle(); // a freshly opened document starts a new session (getAnotherFigure uses loadPdfPageAsImage, not this)
        setSourcePdf({ bytes, name }); // keep the source for Save Project (ckpt 104)
        await loadPdfPageAsImage(doc, 1, name);
      } catch {
        setProjectError(fmt === 'tiff' ? 'Could not open that TIFF.' : 'Could not open that PDF.');
      }
    },
    [loadPdfPageAsImage, setSourcePdf, clearFiguresToSingle]
  );

  const goToPdfPage = useCallback(
    async (page: number) => {
      const doc = pdfDocRef.current;
      const st = pdfStateRef.current;
      if (!doc || !st || page < 1 || page > doc.pageCount || page === st.page) return;
      // Flipping to another page discards the current page's work, exactly like
      // opening a different image -- guard it the same way.
      if (!confirmDiscardIfDirty()) return;
      try {
        await loadPdfPageAsImage(doc, page, st.name);
      } catch {
        setProjectError('Could not render that PDF page.');
      }
    },
    [confirmDiscardIfDirty, loadPdfPageAsImage]
  );

  // Open a bundled example (checkpoint 46): load its image and pre-select its
  // graph type. The asset is re-encoded as a data URL so a project saved from
  // an example stays self-contained (loadImageFromSrc keeps whatever src it's
  // given, and an asset URL wouldn't survive a save/reopen elsewhere).
  const openExample = useCallback(
    async (example: { name: string; src: string; axes: string; pdf?: boolean }) => {
      if (!confirmDiscardIfDirty()) return;
      clearFiguresToSingle(); // an example is a fresh, single-figure document (openPdf also clears, harmlessly)
      // A PDF example opens through the pdf.js path (checkpoint 114): openPdf
      // handles the fresh-document reset, renders page 1, and retains the source,
      // so the page flipper appears and you can capture a figure per page -- the
      // multi-figure showcase, driven from Help > Open example.
      if (example.pdf) {
        const res = await fetch(example.src);
        const buf = await res.arrayBuffer();
        await openPdf(new Uint8Array(buf), example.name);
        return;
      }
      const dataURL = await fetch(example.src)
        .then((r) => r.blob())
        .then(
          (blob) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            })
        );
      // resetDocument, not changeAxesType: an example is a fresh figure, so it
      // starts clean (no inherited calibration, reset history) rather than an
      // undoable edit of whatever was on screen.
      //
      // closePdf FIRST (post-v0.4 audit D1): loadImageFromSrc goes straight to
      // the ref and never fires onImageOpened, so -- unlike the drop/paste/dialog
      // paths -- handleImageOpened's closePdf never runs. Without this, opening an
      // example while a PDF was open left sourcePdfRef pointing at that PDF (chip
      // still "source PDF included") and the parsed pdfDocRef leaked; Save Project
      // would then bundle the unrelated (possibly paywalled) PDF as this example's
      // source.pdf. resetDocument alone clears pdfState but not the source bytes,
      // and the clear must NOT move into resetDocument -- loadPdfPageAsImage relies
      // on it to preserve the open PDF across page flips.
      closePdf();
      resetDocument(example.axes, dataURL); // reset runs before the load; hand it the incoming src
      imageCanvasRef.current?.loadImageFromSrc(dataURL, example.name);
    },
    [resetDocument, confirmDiscardIfDirty, closePdf, openPdf, clearFiguresToSingle]
  );

  // --- Trace Challenge (v1.2 game) --------------------------------------------
  // The eligible examples, joined to their EXAMPLES entry (image src + axes id).
  const challengePool = useMemo<ChallengeExample[]>(
    () =>
      CHALLENGE_IDS.flatMap((id) => {
        const meta = CHALLENGE_META[id];
        const ex = EXAMPLES.find((e) => e.id === id);
        return meta && ex
          ? [{ id, name: ex.name, family: meta.family, instruction: meta.instruction, truth: meta.truth, axesConfigId: ex.axes, imageSrc: ex.src }]
          : [];
      }),
    []
  );

  // Load one round: fetch the example image, PRE-CALIBRATE from its committed
  // anchors (the player never clicks the axes), drop into place-point, start the
  // clock. Manual-only tracing is enforced by the rail gate + this mode.
  const loadRound = useCallback(
    async (ex: ChallengeExample) => {
      setRoundStartMs(0); // clock reads 0:00 while this round loads; real start stamped at the end
      const dataURL = await fetch(ex.imageSrc)
        .then((r) => r.blob())
        .then(
          (blob) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            })
        );
      closePdf();
      resetDocument(ex.axesConfigId, dataURL); // fresh session (swapSession updates sessionRef); sets figureCaptured=false
      sessionRef.current.adoptCalibration(calibrationInputsFromAnchors(ex.truth.calibration));
      imageCanvasRef.current?.loadImageFromSrc(dataURL, ex.name);
      // The example IS the whole figure-of-record: capture it (a no-op crop) so the
      // player can place points -- without this, capture stays pending and every
      // click is blocked ("Frame the whole figure... press Capture").
      setFigureCaptured(true);
      setCalibExpanded(false); // the player didn't calibrate -- don't clutter/occlude with the calib card
      setMode('place-point');
      setRoundStartMs(Date.now());
      bump();
    },
    [resetDocument, closePdf, bump]
  );

  const startChallenge = useCallback(() => {
    if (!confirmDiscardIfDirty()) return;
    const rounds = drawRounds(challengePool, 5);
    if (rounds.length === 0) return;
    setRoundQueue(rounds);
    setRoundIndex(0);
    setRoundScores([]);
    setHighScores(readHighScores());
    setGamePhase('intro');
  }, [confirmDiscardIfDirty, challengePool]);

  const beginRounds = useCallback(() => {
    setRoundIndex(0);
    setRoundScores([]);
    setGamePhase('playing');
    if (roundQueue[0]) void loadRound(roundQueue[0]);
  }, [roundQueue, loadRound]);

  const finishRound = useCallback(() => {
    const ex = roundQueue[roundIndex];
    if (!ex) return;
    const rawSeconds = Math.max(0, (Date.now() - roundStartMs) / 1000);
    const session = sessionRef.current;
    // Read the player's extraction in DATA space (the same values the CSV export
    // carries) per family, and score it against truth.
    let score: RoundScore;
    if (ex.family === 'curve' || ex.family === 'scatter') {
      const userSeries = session
        .getAllDatasetsData()
        .map((ds) => ds.points.filter((p) => p.data).map((p) => ({ x: p.data![0]!, y: p.data![1]! })))
        .filter((s) => s.length > 0); // empty series aren't spurious curves
      score = scoreRound(ex.family, userSeries, truthSeriesPoints(ex.truth), truthAxisRanges(ex.truth), rawSeconds);
    } else if (ex.family === 'histogram') {
      // Each captured bin -> (bin-centre, value); scored as a scatter (has an x axis).
      const userPts = session
        .getHistogramBins()
        .flatMap((b) => (b ? [{ x: (b.binStart + b.binEnd) / 2, y: b.value }] : []));
      score = scoreRound('scatter', [userPts], [truthHistogramPoints(ex.truth)], truthAxisRanges(ex.truth), rawSeconds);
    } else if (ex.family === 'bar') {
      // One value per bar, ranked left-to-right (no x calibration -> order is identity).
      const items =
        session
          .getAllDatasetsData()[0]
          ?.points.filter((p) => p.data)
          .slice()
          .sort((a, b) => a.px - b.px)
          .map((p) => [p.data![0]!]) ?? [];
      score = scoreOrderedRound(items, truthBarValues(ex.truth), truthValueRange(ex.truth), rawSeconds);
    } else {
      // box: complete 5-point tuples only (Min,Q1,Median,Q3,Max order), ranked by px.
      const tuples = session
        .getTupleRows()
        .map((t) =>
          t.points.some((p) => !p || !p.data)
            ? null
            : { px: t.points.reduce((s, p) => s + p!.px, 0) / t.points.length, vals: t.points.map((p) => p!.data![0]!) }
        )
        .filter((x): x is { px: number; vals: number[] } => x !== null)
        .sort((a, b) => a.px - b.px);
      score = scoreOrderedRound(tuples.map((t) => t.vals), truthBoxValues(ex.truth), truthValueRange(ex.truth), rawSeconds);
    }
    setRoundScores((prev) => [...prev, score]);
    setGamePhase('reveal');
  }, [roundQueue, roundIndex, roundStartMs]);

  const nextRound = useCallback(() => {
    const next = roundIndex + 1;
    if (next < roundQueue.length) {
      setRoundIndex(next);
      setGamePhase('playing');
      if (roundQueue[next]) void loadRound(roundQueue[next]);
    } else {
      setGamePhase('results');
    }
  }, [roundIndex, roundQueue, loadRound]);

  const saveHighScore = useCallback(
    (name: string) => {
      const total = roundScores.reduce((s, r) => s + r.adjustedSeconds, 0);
      setHighScores(insertHighScore(name, total));
    },
    [roundScores]
  );

  const finishChallenge = useCallback(() => {
    setGamePhase(null);
    setRoundQueue([]);
    setRoundIndex(0);
    setRoundScores([]);
    clearFiguresToSingle();
    resetDocument(XY_AXES_CONFIG.id);
    imageCanvasRef.current?.clearImage(); // back to the blank "Open an image" opening state
  }, [clearFiguresToSingle, resetDocument]);

  // NB: the round timer lives INSIDE the HUD (ChallengeOverlay), ticking off
  // `roundStartMs`, so it re-renders only the HUD -- not the whole Workspace every
  // 100ms, which made canvas clicks feel laggy mid-round.

  // Route a measure-mode canvas click. Set-scale intercepts first (arming a
  // px->unit reference); then the active tool. Slope reports Δy/Δx in the chart's
  // data units (via pixelToData, log-correct if axes are ever set to log); Distance
  // reports a real length via the Set-scale reference (or pixels if none is set).
  const handleMeasureClick = useCallback(
    (px: number, py: number) => {
      // Snap the measurement vertex to a nearby active-series DATA point (v1.1):
      // "measure from one identified point" -- if the click lands within ~12
      // screen px of a plotted point, anchor exactly on it. Threshold is in image
      // pixels (the click's space), so divide the screen tolerance by the zoom.
      const snapThresh = 12 / Math.max(canvasScale, 1e-4);
      let sx = px;
      let sy = py;
      let bestD = snapThresh;
      for (const p of session.getDataPoints()) {
        const d = Math.hypot(p.px - px, p.py - py);
        if (d < bestD) {
          bestD = d;
          sx = p.px;
          sy = p.py;
        }
      }
      px = sx;
      py = sy;
      const pts = [...pendingMeasureRef.current, { x: px, y: py }];
      const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const nextId = () => `meas-${(measureIdRef.current += 1)}`;

      // Set-scale: two clicks a known real distance apart -> the value+unit form.
      if (settingScale) {
        if (pts.length < 2) {
          setPending(pts);
          return;
        }
        const a = pts[0]!;
        const b = pts[1]!;
        setPending(pts); // keep both dots visible beneath the form
        setScaleDraftPx(Math.hypot(b.x - a.x, b.y - a.y));
        return;
      }

      if (measureTool === 'slope') {
        if (!axes || config.axesKind !== 'xy') {
          setMeasureError('Calibrate an XY chart first to measure a slope.');
          return;
        }
        setMeasureError(null);
        if (pts.length < 2) {
          setPending(pts);
          return;
        }
        const a = pts[0]!;
        const b = pts[1]!;
        const d1 = axes.pixelToData(a.x, a.y);
        const d2 = axes.pixelToData(b.x, b.y);
        const dx = d2[0]! - d1[0]!;
        const dy = d2[1]! - d1[1]!;
        const slope = dy / dx;
        const finite = Number.isFinite(slope);
        const id = nextId();
        // `label` is a placeholder: the canvas label is DERIVED at render
        // (see the measureOverlays memo), so a later re-calibration updates it.
        const overlay: MeasureOverlay = { id, points: pts, label: finite ? fmtNum(slope) : '∞', labelAt: mid(a, b) };
        applyMeasurements([{ id, tool: 'slope', overlay }, ...measurementsRef.current]);
        setPending([]);
        commit();
        return;
      }

      if (measureTool === 'distance') {
        setMeasureError(null);
        if (pts.length < 2) {
          setPending(pts);
          return;
        }
        const a = pts[0]!;
        const b = pts[1]!;
        const id = nextId();
        const overlay: MeasureOverlay = { id, points: pts, label: '', labelAt: mid(a, b) };
        applyMeasurements([{ id, tool: 'distance', overlay }, ...measurementsRef.current]);
        setPending([]);
        commit();
        return;
      }

      if (measureTool === 'angle') {
        setMeasureError(null);
        if (pts.length < 3) {
          setPending(pts);
          return;
        }
        // Clicks arrive vertex-first; the record stores [arm, vertex, arm], the
        // order both the canvas and measurementValue() read.
        const v = pts[0]!;
        const a = pts[1]!;
        const b = pts[2]!;
        const id = nextId();
        const overlay: MeasureOverlay = { id, points: [a, v, b], label: '', labelAt: v };
        applyMeasurements([{ id, tool: 'angle', overlay }, ...measurementsRef.current]);
        setPending([]);
        commit();
        return;
      }

      // Area: accumulate polygon vertices; the card's Finish button / Enter closes it.
      setMeasureError(null);
      setPending(pts);
    },
    [axes, config.axesKind, measureTool, settingScale, setPending, applyMeasurements, commit, canvasScale, session]
  );

  const selectMeasureTool = useCallback(
    (t: MeasureToolId) => {
      setMeasureTool(t);
      setPending([]); // abandon a half-placed measurement when switching tools
      setMeasureError(null);
      setSettingScale(false); // and any in-progress Set-scale
      setScaleDraftPx(null);
    },
    [setPending]
  );
  /** Every measurement's DERIVED display form (checkpoint 82) — the single
   * source the card, the clipboard and the canvas labels all read. Recomputed
   * when the scale or the calibration changes, which is what makes Set-scale
   * retroactive instead of one-way. */
  const measurementViews = useMemo(
    () =>
      measurements.map((m) => ({
        id: m.id,
        tool: m.tool,
        ...measureDisplay(m, { scale: measureScale, axes }),
      })),
    [measurements, measureScale, axes]
  );

  const copyMeasurement = useCallback((m: Measurement) => {
    void navigator.clipboard?.writeText(m.note ? `${m.value} (${m.note})` : m.value).catch(() => {});
  }, []);
  const deleteMeasurement = useCallback(
    (id: string) => {
      applyMeasurements(measurementsRef.current.filter((x) => x.id !== id));
      commit();
    },
    [applyMeasurements, commit]
  );
  const copyAllMeasurements = useCallback(() => {
    const text = measurementViews.map((m) => (m.note ? `${m.value} (${m.note})` : m.value)).join('\n');
    void navigator.clipboard?.writeText(text).catch(() => {});
  }, [measurementViews]);

  // Set-scale flow: arm two clicks (startSetScale), then confirm turns their pixel
  // separation + the typed known distance into a px->unit ratio.
  const startSetScale = useCallback(() => {
    setSettingScale(true);
    setScaleDraftPx(null);
    setPending([]);
    setMeasureError(null);
  }, [setPending]);
  const cancelSetScale = useCallback(() => {
    setSettingScale(false);
    setScaleDraftPx(null);
    setPending([]);
  }, [setPending]);
  const confirmSetScale = useCallback(() => {
    const known = parseFloat(scaleValueInput);
    if (scaleDraftPx == null || !Number.isFinite(known) || known <= 0) {
      setMeasureError('Enter a positive known distance to set the scale.');
      return;
    }
    applyMeasureScale({ unitPerPx: known / scaleDraftPx, unit: scaleUnitInput.trim() || 'unit' });
    setSettingScale(false);
    setScaleDraftPx(null);
    setPending([]);
    setMeasureError(null);
    commit();
  }, [scaleValueInput, scaleUnitInput, scaleDraftPx, setPending, applyMeasureScale, commit]);

  const handleImageClick = useCallback(
    (px: number, py: number) => {
      // Eyedropper intercepts the click before any tool action -- px/py are
      // native image-pixel coords (same space Segment Fill uses), so they index
      // straight into getImageData(). One sampler, routed by target (ckpt 90).
      if (eyedropper) {
        const imageData = imageCanvasRef.current?.getImageData();
        if (imageData) {
          const x = Math.max(0, Math.min(imageData.width - 1, Math.round(px)));
          const y = Math.max(0, Math.min(imageData.height - 1, Math.round(py)));
          const o = (y * imageData.width + x) * 4;
          const rgb = [imageData.data[o]!, imageData.data[o + 1]!, imageData.data[o + 2]!] as [number, number, number];
          if (eyedropper === 'grid') {
            setGridRemovalColor(rgbToHex(rgb));
          } else if (eyedropper === 'trace') {
            setColorTraceColor(rgbToHex(rgb)); // the curve colour to auto-trace (ckpt 118)
            setColorTraceInfo(null);
          } else {
            // Session directly, and the active index read FROM the session (the
            // memo'd activeDatasetIndex is defined later -> TDZ if used in this
            // callback's deps). commit(): an eyedrop click has no blur to trigger
            // the pending-edit commit, and it should be undoable.
            session.setDatasetColor(session.getActiveDatasetIndex(), rgb);
            commit();
          }
        }
        setEyedropper(null);
        return;
      }
      if (mode === 'pan') return;
      // Error bars are captured by dragging, not clicking (checkpoint 79). An
      // explicit branch, because place-point is this router's FALLTHROUGH -- a
      // stray click here would otherwise silently drop a data point into the
      // active series while the user was aiming at a cap.
      if (mode === 'error-bars') return;
      // Auto-extract ▸ By colour traces via the Trace button, NOT a canvas click
      // (v0.8). Same fallthrough hazard as error-bars: a stray click on the curve
      // -- natural, since the sibling Flood-fill mechanism DOES trace by clicking
      // the curve -- would otherwise fabricate a raw data point in the active
      // series, poisoning the record invisibly until export (tenet 1/9). The
      // eyedropper path above (setEyedropper('trace')) already returned, so this
      // only guards a bare click while "By colour" is active.
      if (mode === 'color-trace') return;
      // Select tool (David 2026-07-21): NEVER adds a point. This is a DEFENSIVE
      // no-add guard, the same shape as the color-trace guard above -- it stops a
      // rail-wired mode from ever falling through to addDataPoint (the v0.8
      // color-trace bug). In practice a select-mode press is intercepted by the
      // marquee drag in ImageCanvas, so onImageClick rarely fires here; when it
      // does (or ever would), we clear rather than place. The USER-facing clear
      // paths are Esc and an empty-space marquee (both advertised in the tips bar);
      // single-select is a marker click (handleMarkerClick), range a drag
      // (handleSelectRect).
      if (mode === 'select') {
        setSelectedPointIndices([]);
        setActivePointIndex(null);
        return;
      }
      // Eraser removes a point on a MARKER click (handleMarkerClick); a bare
      // canvas click must not fall through to addDataPoint (same no-add guard
      // shape as select/color-trace above).
      if (mode === 'eraser') return;
      if (mode === 'image-edit') return; // image-edit tools are card buttons, not canvas clicks
      if (mode === 'measure') {
        handleMeasureClick(px, py);
        return;
      }
      if (mode === 'calibrate') {
        // Capture is mandatory step 1 (checkpoint 103): you cannot place an axis
        // point until the figure-of-record is established, so autosave always has
        // a stable figure and it can't shift mid-work (David). The Capture button
        // is on the calibration card ("Capture figure first", v0.8).
        if (!figureCaptured) {
          setProjectError('Capture the figure first — frame the whole figure in the window, then press “Capture figure”. What you see is what you capture.');
          return;
        }
        const result = session.handleCalibrationClick(px, py);
        if (result === 'awaiting-value') {
          const step = session.getCurrentStep();
          // Seed from each field's declared default (v1.4: Spider's centre value,
          // 0). ⚑ `defaultValue` was declared on the field and read by NOTHING --
          // the config's own comment promised a prefilled 0 that never appeared, so
          // the value had to be typed every time. A default only exists once
          // something fills it in.
          setDataValueInputs(step ? step.valueFields.map((f) => f.defaultValue ?? '') : []);
          bump(); // a pending pixel, not a finalized point -- commit on confirm
        } else if (result === 'point-placed') {
          commit(); // value-less step (e.g. Polar's origin) is placed outright
        } else {
          bump();
        }
        return;
      }
      if (mode === 'segment-fill') {
        const imageData = imageCanvasRef.current?.getImageData();
        if (!imageData) {
          setSegmentFillError('No image loaded.');
          return;
        }
        const result = runSegmentFill(imageData.data, imageData.width, imageData.height, px, py, segmentFillThreshold);
        if ('error' in result) {
          setSegmentFillError(result.error);
          return;
        }
        setSegmentFillError(null);
        session.addSegmentFillPoints(result.points);
        commit();
        return;
      }
      if (mode === 'interpolate') {
        // Interpolation-assist (checkpoint 120): each click drops an anchor and
        // the curve between the anchors redraws live (session.rebuildInterpolation).
        session.addAnchorPoint(px, py);
        // Select the anchor we just placed. The series is now stored in CURVE order
        // (anchors interleaved with the fill), so the newest anchor is no longer the
        // "last anchor" index -- find it by its exact clicked pixel instead.
        const pts = session.getDataPoints();
        const idx = pts.findIndex((p) => p.px === px && p.py === py);
        setActivePointIndex(idx >= 0 ? idx : null);
        commit();
        return;
      }
      // ⚑ ASKED BEFORE THE POINT IS ADDED (v1.4, Spider). The click is snapped onto
      // the axis the cursor is filling, which is what makes the dot land on the ray
      // -- and which erases the offset this check reads. Afterwards there is
      // nothing left to notice, so it has to happen here. Null for every other
      // graph type, and for a click already nearest the axis it is filling.
      const notice = session.previewSpiderCapture(px, py);
      setCaptureNotice(notice ? { ...notice, mode, seriesIndex: session.getActiveDatasetIndex() } : null);
      session.addDataPoint(px, py);
      // Insert-in-place (v1.1 #1) may splice the new point into the middle of the
      // curve, so the newest is no longer the last index -- find it by its clicked
      // pixel, the same way the interpolation-anchor branch above does. A snapped
      // spider point is NOT at the clicked pixel, and falls through to the
      // last-index fallback, which is correct: the grouped path always appends.
      const placed = session.getDataPoints();
      const newIdx = placed.findIndex((p) => p.px === px && p.py === py);
      setActivePointIndex(newIdx >= 0 ? newIdx : placed.length - 1);
      // Placing a point selects it, but the user did not PICK it to look at -- they
      // are stepping round the chart, and the guidance they need is the next slot.
      // Cleared explicitly rather than left alone: with points deleted, the new
      // index can coincide with a previously picked one.
      setPickedPointIndex(null);
      commit();
    },
    [session, mode, bump, commit, segmentFillThreshold, eyedropper, handleMeasureClick, figureCaptured]
  );

  // Click a data dot to make it the active point (checkpoint 58). Only the active
  // series' own markers carry the `point-` id; inactive series aren't selectable
  // (select the series in the dropdown first).
  const handleMarkerClick = useCallback((id: string, shiftKey?: boolean) => {
    if (id.startsWith('point-')) {
      const idx = Number(id.slice('point-'.length));
      if (mode === 'eraser') {
        // Eraser tool (David 2026-07-22): clicking a data point removes it. Reuses
        // the same per-point delete as Del / the right-click menu; Del still works.
        removeDataPointByIndex(idx);
        return;
      }
      if (mode === 'select') {
        if (selectSubMode === 'series') {
          // Whole-series pick (v1.1 #6): clicking any point selects EVERY point of
          // the active series for a bulk Del / nudge. Shift adds the series to the
          // set rather than replacing it.
          const all = session.getDataPoints().map((_, i) => i);
          setSelectedPointIndices((prev) => (shiftKey ? Array.from(new Set([...prev, ...all])) : all));
        } else {
          // Rectangle / Point / Lasso: a marker click joins the selection -- Shift
          // toggles one in/out, a plain click makes it the sole selection.
          setSelectedPointIndices((prev) =>
            shiftKey ? (prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]) : [idx]
          );
        }
        setActivePointIndex(null);
        setActiveHandleKey(null);
        return;
      }
      setActivePointIndex(idx);
      setPickedPointIndex(idx);
      setActiveHandleKey(null);
    } else {
      // A calibration handle (its id is the step key). Only listening/clickable in
      // Calibrate mode post-calibration, so selecting it here is unambiguous.
      setActiveHandleKey(id);
      setActivePointIndex(null);
    }
  }, [mode, removeDataPointByIndex, selectSubMode, session]);

  // The Select tool's marquee (David 2026-07-21): every active-series DATA point
  // whose pixel falls inside the dragged box becomes selected. Only data points --
  // calibration handles are not in getDataPoints(), so a box over the origin or an
  // axis handle never grabs it (David: especially when selecting several).
  const handleSelectRect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const x0 = rect.x;
      const y0 = rect.y;
      const x1 = rect.x + rect.width;
      const y1 = rect.y + rect.height;
      const inside: number[] = [];
      session.getDataPoints().forEach((p, i) => {
        if (p.px >= x0 && p.px <= x1 && p.py >= y0 && p.py <= y1) inside.push(i);
      });
      setSelectedPointIndices(inside);
      setActivePointIndex(null);
    },
    [session]
  );

  // The Select tool's LASSO (v1.1 #6): every active-series DATA point inside the
  // freeform loop becomes selected. Same discipline as the marquee -- data points
  // only, calibration handles are not in getDataPoints() so the loop can't grab
  // them. The polygon arrives in image-pixel space (algorithms/geometry).
  const handleSelectLasso = useCallback(
    (polygon: { x: number; y: number }[]) => {
      const inside: number[] = [];
      session.getDataPoints().forEach((p, i) => {
        if (pointInPolygon({ x: p.px, y: p.py }, polygon)) inside.push(i);
      });
      setSelectedPointIndices(inside);
      setActivePointIndex(null);
    },
    [session]
  );

  // Select a recorded measurement's vertex for keyboard nudge (checkpoint 128).
  // Guarded to recorded ids only (the pending overlay isn't nudgeable). Clears the
  // other selections so the arrows drive exactly one thing.
  const handleMeasureVertexClick = useCallback((id: string, vertex: number) => {
    if (!measurementsRef.current.some((m) => m.id === id)) return;
    setActiveMeasure({ id, vertex });
    setActivePointIndex(null);
    setActiveHandleKey(null);
  }, []);

  // --- Error-bar capture (checkpoint 79) -------------------------------------
  // The drag IS the link: press a datum of the target series, drag out to the
  // cap the figure draws, release. Snapping the START to a real datum is what
  // keeps the whisker's datum end honest; the release point is never snapped,
  // because it is the measurement.
  const SNAP_RADIUS_PX = 14;
  const errorLinkSnap = useCallback(
    (x: number, y: number) => session.nearestDatumPixel(errorTargetIndex, { x, y }, SNAP_RADIUS_PX)?.point ?? null,
    [session, errorTargetIndex]
  );

  const handleLinkDragMove = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const next = { from, to };
    errorDragRef.current = next;
    setErrorDrag(next);
  }, []);

  const handleLinkDragCancel = useCallback(() => {
    errorDragRef.current = null;
    setErrorDrag(null);
  }, []);

  const handleLinkDrag = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      errorDragRef.current = null;
      setErrorDrag(null);
      const refusal = session.captureErrorCap({
        targetIndex: errorTargetIndex,
        datumPixel: from,
        capPixel: to,
        baseName: errorBaseName,
      });
      setErrorNotice(refusal);
      if (!refusal) commit();
      else bump();
    },
    [session, errorTargetIndex, errorBaseName, commit, bump]
  );


  const setDataValueInputAt = useCallback((index: number, value: string) => {
    setDataValueInputs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  const confirmDataValue = useCallback(() => {
    if (session.confirmCalibrationValues(dataValueInputs)) {
      // Common origin (XY): as soon as the walk reaches Y1, auto-reuse X1's
      // pixel (the shared origin) and pre-fill Y1's value with 0, so the user
      // never places or reuses it by hand -- they just confirm.
      const next = session.getCurrentStep();
      const placed = session.getPlacedPoints();
      if (commonOrigin && config.supportsCommonOrigin && next?.key === 'y1' && placed['x1'] && !placed['y1']) {
        session.reuseStepPixel('x1');
        setDataValueInputs(['0']);
      } else {
        setDataValueInputs([]);
      }
      commit();
    }
  }, [session, dataValueInputs, commit, commonOrigin, config.supportsCommonOrigin]);

  const runCalibration = useCallback(() => {
    if (session.runCalibration()) {
      setMode('place-point');
      // Fold the card on success (checkpoint 86). The card overlays the canvas,
      // and post-calibration the user is placing points -- a thin chip bar keeps
      // the figure clear. Options/global fields now render inside the EXPANDED
      // card (the !axes gate is gone), so folding is also what keeps that from
      // reintroducing checkpoint 68's click-swallow: the tall state is opt-in,
      // reached by unfolding when you actually want to change Log Y or the like.
      setCalibExpanded(false);
      commit();
    } else {
      bump();
    }
  }, [session, bump, commit]);

  const setGlobalField = useCallback(
    (key: string, value: string) => {
      session.setGlobalFieldValue(key, value);
      pendingEditRef.current = true; // text edit -- commit on blur, not per keystroke
      bump();
    },
    [session, bump]
  );
  // commitPendingEdit (the blur handler) already commits the text edit to
  // history, so a post-calibration global-field change is undoable via that
  // path -- no separate commit() here, unlike setAxesOption's checkbox toggle
  // which has no blur.

  const reuseStepPixel = useCallback(
    (fromKey: string) => {
      if (session.reuseStepPixel(fromKey)) {
        const step = session.getCurrentStep();
        // Reusing a pixel means the two steps share one physical location
        // (e.g. X1 and Y1 both on the origin), so the reused point's already-
        // entered value is almost always the right default here too (origin =
        // X=0 shared by Y=0). Pre-fill it from the source; the user can still
        // overwrite. Matched slot-for-slot, padded with '' if the step shapes
        // differ.
        const source = session.getPlacedPoints()[fromKey];
        const n = step ? step.valueFields.length : 0;
        setDataValueInputs(Array.from({ length: n }, (_, i) => source?.values[i] ?? ''));
        commit();
      }
    },
    [session, commit]
  );

  const handleMarkerDragEnd = useCallback(
    (id: string, x: number, y: number) => {
      if (id.startsWith('point-')) {
        session.updateDataPointPixel(Number(id.slice('point-'.length)), x, y);
      } else {
        session.updateCalibPointPixel(id, x, y);
      }
      commit();
    },
    [session, commit]
  );

  // Apply an in-progress datapoint value edit (checkpoint 39): re-derive the
  // point's pixel from the edited data value via the axes' inverse transform
  // and reposition it, so the canvas marker moves to match. XY and SPIDER only --
  // the other axes types' dataToPixel is an unimplemented stub (see core/axes/
  // bar.ts's note; the same reason Curve Fit/Geometry are XY-only), so their
  // cells stay read-only and this never runs for them.
  const commitDataPointEdit = useCallback(() => {
    const cell = editingCell;
    if (!cell) return;
    setEditingCell(null);
    const point = session.getDataPoints()[cell.index];
    if (!point || !axes) return;
    // The model-side rule, at the one point every edit entrance converges on: a
    // spline-DERIVED sample is not writable, because rebuildInterpolation
    // regenerates it from the anchors and the write would be silently undone the
    // next time one moves. The UI above already declines to OFFER the edit (the
    // cell renders read-only, the derived marker isn't in the hit graph), so this
    // catches only a path that gets here another way -- which is exactly the
    // "guards belong in the model, and the model has more than one entrance"
    // lesson this codebase keeps relearning.
    if (isDerivedAt(session.getDataPointRoles(), cell.index)) return;
    const parsed = Number(cell.value);
    if (cell.value.trim() === '' || !Number.isFinite(parsed)) return; // invalid -> revert to derived

    let pixel: { x: number; y: number };
    if (config.axesKind === 'spider') {
      // ⚑ On a spider `cell.axis` is the SPOKE the point was CAPTURED against --
      // its row in the table, i.e. its slot in the slot -- not a data
      // dimension. That is the same rule the table's reading and the export
      // follow, and for the same reason: the nearest ray agrees for a good click
      // and diverges exactly when the user mis-clicked, so inverting against it
      // would slide the point onto a DIFFERENT axis's scale while the row it sat
      // in still named this one. dataToPixel here is a real inverse of the
      // projection that produced the number being edited, so the round trip is
      // exact; a value with no pixel (a log axis asked for <= 0) answers NaN and
      // is refused below rather than landing at the image's top-left corner.
      pixel = (axes as unknown as { dataToPixel(index: number, value: number): { x: number; y: number } }).dataToPixel(
        cell.axis,
        parsed
      );
    } else if (config.axesKind === 'xy') {
      if (!point.data) return;
      const nextData = [...point.data];
      nextData[cell.axis] = parsed;
      pixel = (axes as unknown as { dataToPixel(x: number, y: number): { x: number; y: number } }).dataToPixel(
        nextData[0]!,
        nextData[1]!
      );
    } else {
      return;
    }
    if (!Number.isFinite(pixel.x) || !Number.isFinite(pixel.y)) return; // e.g. log axis, non-positive input
    session.updateDataPointPixel(cell.index, pixel.x, pixel.y);
    commit();
  }, [editingCell, session, axes, config.axesKind, commit]);

  const setTupleLabel = useCallback(
    (tupleIndex: number, label: string) => {
      session.setTupleLabel(tupleIndex, label);
      pendingEditRef.current = true; // category-name text edit -- commit on blur
      bump();
    },
    [session, bump]
  );

  // Rename a spider AXIS from the spreadsheet (David, 2026-07-27). The name is the
  // one transcribed thing on that row, and it belongs to the calibration rather
  // than to any point -- session.setSpokeName re-derives, so the table, the capture
  // slots, the tips line and the export all move together. Text edit, so it commits
  // on blur as one undo step (setTupleLabel's rule), not one per keystroke.
  const setSpokeName = useCallback(
    (axisIndex: number, name: string) => {
      if (!session.setSpokeName(axisIndex, name)) return;
      pendingEditRef.current = true;
      bump();
    },
    [session, bump]
  );

  // Name one point's category in the spreadsheet (v1.3 #9) -- the Bar /
  // categorical-line counterpart of setTupleLabel above, and it commits the same
  // way: a text edit is one undo step on blur, not one per keystroke.
  const setPointLabel = useCallback(
    (pointIndex: number, label: string) => {
      session.setPointLabel(pointIndex, label);
      pendingEditRef.current = true;
      bump();
    },
    [session, bump]
  );

  // Delete a whole tuple -- a Box Plot box / a Histogram bin -- from the tuple
  // table (checkpoint 129). The trash button removes one point at a time; this
  // drops the entire category. Unconfirmed but undoable, matching the trash and
  // series-delete precedents (all one Ctrl+Z away). The selection is cleared
  // because point indices shift when a tuple's pixels are spliced out.
  const removeTuple = useCallback(
    (tupleIndex: number) => {
      session.removeTuple(tupleIndex);
      setActivePointIndex(null);
      commit();
    },
    [session, commit]
  );

  /** Set a per-axes calibration option (checkpoint 68). Committed like any
   * other discrete action: the session re-calibrates on change, so this moves
   * every derived value and must be undoable as one step. */
  const setAxesOption = useCallback(
    (key: string, value: string) => {
      session.setOption(key, value);
      commit();
    },
    [session, commit]
  );

  const clearPoints = useCallback(() => {
    // Confirm a whole-series wipe, matching Reset/Remove-figure. Only asks when
    // there is something to lose, and (like Reset) says it is undoable.
    if (
      session.getDataPoints().length > 0 &&
      !window.confirm(
        'Clear all points removes every point in the active series. This can be undone with Ctrl+Z. Continue?'
      )
    ) {
      return;
    }
    session.clearPoints();
    setActivePointIndex(null);
    commit();
  }, [session, commit]);

  // Reorder the active series into a continuous nearest-neighbour path
  // (checkpoint 130). Selection is cleared because point indices are permuted.
  // Undoable like any point edit; the session gates it (no-op for grouped /
  // interpolation / <3-point series).
  const sortNearestNeighbour = useCallback(() => {
    session.sortByNearestNeighbour();
    setActivePointIndex(null);
    commit();
  }, [session, commit]);

  /**
   * "Reset calibration" — which, despite its label, clears the whole document.
   *
   * The blast radius is deliberate (slope measurements and every data value
   * are defined *by* the calibration, so keeping them across a re-calibration
   * would leave stale numbers on screen) but it was **undisclosed and
   * unrecoverable** until checkpoint 71: `session.reset()` discards every
   * series and point, `clearMeasurements()` takes the measurements and the
   * Set-scale, and `history.reset()` emptied past *and* future so Ctrl+Z
   * couldn't bring any of it back — while `markClean()` also disarmed the
   * unsaved-work guard. A user who traced 200 points, noticed one handle a few
   * pixels off, and clicked the button that says "Reset calibration" lost
   * everything with no dialog and no undo. Verified: 250 points across 2
   * series -> 0 points, 1 series.
   *
   * Two changes make it honest, both mirroring what WPD already does
   * (`controllers/axesCalibration.js:526,552-575` confirms twice before
   * dropping an axes):
   *  - **confirm first**, but only when there is something to lose — resetting
   *    a half-placed calibration with no data must stay a free action, or the
   *    dialog becomes noise the user learns to dismiss.
   *  - **commit, don't reset the history**, so Ctrl+Z restores everything. The
   *    old `history.reset()` was right for a genuinely *new* document (a new
   *    image), which is a different action and keeps its own reset.
   */
  const reset = useCallback(() => {
    const hasData = session.getDatasetInfos().some((d) => d.pointCount > 0);
    const losesWork = hasData || measurementsRef.current.length > 0;
    // Resetting nothing must DO nothing: now that this commits (below) rather
    // than wiping history, an unconditional reset would push a pointless entry
    // and light up Undo on a fresh document, which reads as "there is something
    // to undo" when there isn't.
    const hasAnythingToReset =
      losesWork || session.isCalibrated() || Object.keys(session.getPlacedPoints()).length > 0;
    if (!hasAnythingToReset) return;
    if (
      losesWork &&
      !window.confirm(
        'Reset calibration will also clear every data point, series and measurement — the values depend on the calibration. This can be undone with Ctrl+Z. Continue?'
      )
    ) {
      return;
    }
    session.reset();
    setDataValueInputs([]);
    setMode('calibrate');
    // Re-expand the card (checkpoint 86). Calibrate auto-folds it, so without
    // this a Reset would leave you back in calibrate mode with the value inputs
    // still hidden -- unable to enter the calibration you just asked to redo.
    setCalibExpanded(true);
    setSegmentFillError(null);
    setCurveFitError(null);
    clearMeasurements(); // slope measurements depend on the calibration being cleared
    commit(); // NOT history.reset() -- this must stay undoable
    bump();
  }, [session, commit, bump, clearMeasurements]);

  // Write zip bytes to a project file (binary saveFile path, checkpoint 93).
  const saveProjectZipBytes = useCallback(async (zip: Uint8Array, stem: string) => {
    // `project_<stem>.zip` (§5a): the prefix sorts projects together and tells a
    // project apart from an export `.zip` for humans; the stem gives it a real
    // identity instead of a hardcoded, collision-prone default. Strip path-
    // breaking characters from a figure name that came from the user.
    const safe = stem.replace(/[/\\]+/g, '_') || 'figures';
    await window.electronAPI!.saveFile(
      bytesToBase64(zip),
      `project_${safe}.zip`,
      [
        { name: 'PlotTracer Project', extensions: ['zip'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      'base64'
    );
  }, []);

  const saveProject = useCallback(async () => {
    if (!window.electronAPI) {
      setProjectError('electronAPI is not available — this UI must run inside the Electron dev harness (npm run ui:electron).');
      return;
    }

    // Who wrote this file, and when (engine/projectFile.ts's ProjectStamp).
    // Built HERE because `__APP_VERSION__` is a Vite define that only exists in
    // ui/ -- engine/ is framework-agnostic and takes it as a parameter, which
    // also keeps its tests deterministic. Diagnostics only: nothing in the load
    // path branches on it, that is what `plotTracerProject` is for.
    const stamp = { appVersion: __APP_VERSION__, savedAt: new Date().toISOString() };

    // --- Multi-figure project (checkpoint 115): save every captured figure. ---
    // The active figure's mutable state lives in the live refs (its record's copy
    // is a stale stash); the inactive figures use their records. Its session IS
    // the record's session object either way, so no stash is needed here.
    const figs = figuresRef.current;
    if (figs.length >= 2) {
      const inputs = figs.map((f, i) => {
        const active = i === activeFigureIndex;
        return {
          name: f.name,
          // The active figure's live session is sessionRef.current, which a page
          // flip (goToPdfPage) can swap WITHOUT re-stashing into the record -- so
          // read it live, never the record's possibly-stale copy (audit H1). Only
          // the active figure can desync this way; inactive ones were stashed on
          // switch.
          session: active ? sessionRef.current : f.session,
          imageDataURL: active ? imageCanvasRef.current?.getImageDataURL() ?? f.imageDataURL : f.imageDataURL,
          imageFileName: active ? imageCanvasRef.current?.getImageFileName() ?? f.imageFileName : f.imageFileName,
          measures: {
            measurements: toSerializedMeasurements(active ? measurementsRef.current : f.measurements),
            scale: active ? measureScaleRef.current : f.measureScale,
          },
          provenance: active ? provenanceRef.current : f.provenance,
        };
      });
      // The shared source: the active figure's live source, or ANY figure's if the
      // active one has none (audit A3 -- a project-wide document threaded through a
      // single figure's ref would otherwise drop on re-save).
      const sharedSource = sourcePdfRef.current ?? figs.map((f) => f.sourcePdf).find((s) => s != null) ?? null;
      const multi = serializeMultiFigureProject(
        inputs,
        activeFigureIndex,
        sharedSource
          ? { name: sharedSource.name, mime: pagedDocumentFormat(sharedSource.bytes) === 'tiff' ? 'image/tiff' : 'application/pdf', bytes: sharedSource.bytes }
          : undefined,
        stamp
      );
      if ('error' in multi) {
        setProjectError(multi.error);
        return;
      }
      const zip = serializeMultiFigureZip(multi);
      if ('error' in zip) {
        setProjectError(zip.error);
        return;
      }
      setProjectError(null);
      await saveProjectZipBytes(zip, figs[activeFigureIndex]?.name ?? 'figures');
      markClean();
      return;
    }

    // --- Single figure (checkpoint 94's path, unchanged). ---
    const imageDataURL = imageCanvasRef.current?.getImageDataURL();
    if (!imageDataURL) {
      setProjectError('Load an image before saving a project.');
      return;
    }
    const result = serializeProject(
      session,
      imageDataURL,
      imageCanvasRef.current?.getImageFileName() ?? undefined,
      { measurements: toSerializedMeasurements(measurementsRef.current), scale: measureScaleRef.current },
      provenanceRef.current,
      sourcePdfRef.current
        ? { name: sourcePdfRef.current.name, mime: pagedDocumentFormat(sourcePdfRef.current.bytes) === 'tiff' ? 'image/tiff' : 'application/pdf', bytes: sourcePdfRef.current.bytes }
        : undefined,
      stamp
    );
    if ('error' in result) {
      setProjectError(result.error);
      return;
    }
    const zip = serializeProjectZip(result);
    if ('error' in zip) {
      setProjectError(zip.error);
      return;
    }
    setProjectError(null);
    const stem = (imageCanvasRef.current?.getImageFileName() ?? 'figure.png').replace(/\.[^.]+$/, '');
    await saveProjectZipBytes(zip, stem);
    markClean(); // persisted -> no longer unsaved
  }, [session, markClean, activeFigureIndex, saveProjectZipBytes]);

  /**
   * Load a calibrated figure into a fresh session and reset the document around
   * it — the shared core of opening our own project (JSON) and importing a WPD
   * figure (.tar). Extracted at checkpoint 88 so the two are one path, not a
   * parallel one (the exact smell the tenet audit warns about): they differ only
   * in where the axes/datasets/image come from, not in how they land.
   *
   * `measurements` is empty for a WPD import — WPD has no measurement concept.
   */
  const loadCalibratedFigure = useCallback(
    (fig: {
      configId: string;
      axes: CalibratedAxes;
      datasets: Dataset[];
      imageDataURL: string;
      imageFileName?: string;
      measurements?: RecordedMeasurement[];
      measureScale?: MeasureScaleState | null;
      provenance?: Provenance;
    }): boolean => {
      const nextConfig = AXES_TYPE_CONFIGS.find((c) => c.id === fig.configId);
      if (!nextConfig) {
        setProjectError(`Unsupported axes type: ${fig.configId}`);
        return false;
      }
      clearFiguresToSingle(); // a single-figure project / WPD import is one figure
      const newSession = new CalibrationSession(nextConfig);
      newSession.setImageHeight(imageHeightRef.current);
      newSession.loadCalibrated(fig.axes, fig.datasets);
      sessionRef.current = newSession;
      setColorTraceRegion(null); // new figure's pixel space -> old trace region is stale (audit A1)

      applyProvenance(fig.provenance ?? {}); // restore where this figure came from
      applyPdfState(null); // a saved project is a baked image, not a live PDF
      closePdf(); // release any PDF that was open before this project loaded (T4)
      setFigureCaptured(true); // a loaded/imported figure IS the figure-of-record (ckpt 103)
      const loadedMeasurements = fig.measurements ?? [];
      applyMeasurements(loadedMeasurements);
      applyMeasureScale(fig.measureScale ?? null);
      setSettingScale(false);
      setScaleDraftPx(null);
      setPending([]);
      // Keep new measurement ids from colliding with loaded ones.
      measureIdRef.current = loadedMeasurements.reduce((max, m) => {
        const n = parseInt(m.id.replace(/^meas-/, ''), 10);
        return Number.isFinite(n) && n > max ? n : max;
      }, 0);
      history.reset(captureDoc(fig.imageDataURL)); // loaded document -> fresh history; reset precedes the load, so name the incoming src
      setAxesTypeId(fig.configId);
      setDataValueInputs([]);
      setMode('place-point');
      setCalibExpanded(false); // arrives calibrated -> folded, like post-calibrate (ckpt 86)
      setProjectError(null);
      setCurveFitError(null);

      // Sync the Curve Fit panel to a persisted fit's own parameters. Reads
      // datasets[0]: loadCalibrated always makes the first loaded dataset active.
      const loadedCurveFit = getCurveFitState(fig.datasets[0]!);
      setCurveFitDegree(loadedCurveFit?.degree ?? 1);
      setCurveFitModel(loadedCurveFit?.model ?? 'polynomial');
      setCurveFitRestrict(loadedCurveFit?.restrict ?? false);
      setCurveFitXMinInput(loadedCurveFit && loadedCurveFit.xMin != null ? String(loadedCurveFit.xMin) : '');
      setCurveFitXMaxInput(loadedCurveFit && loadedCurveFit.xMax != null ? String(loadedCurveFit.xMax) : '');

      imageCanvasRef.current?.loadImageFromSrc(fig.imageDataURL, fig.imageFileName);
      markClean(); // a freshly loaded document matches its source
      bump();
      return true;
    },
    [history, bump, markClean, applyMeasurements, applyMeasureScale, setPending, captureDoc, applyProvenance, applyPdfState, closePdf, clearFiguresToSingle]
  );

  // === Multi-figure session (checkpoint 110, design §1/§8) ===

  /** Install a stashed FigureRecord as the live figure. The sibling of
   * loadCalibratedFigure, but from an already-live session OBJECT (no
   * re-deserialize): the figure's calibration and points travel unchanged. Resets
   * the same per-panel UI swapSession does, restores the figure's document state,
   * and pushes its baked image to the canvas. Undo history resets to the restored
   * state (per-figure undo is a later refinement). */
  const restoreFigure = useCallback(
    (rec: FigureRecord) => {
      sessionRef.current = rec.session;
      setAxesTypeId(rec.axesTypeId);
      // A pending figure-rename belongs to the figure we're leaving.
      setFigureNameDraft(null);
      setFigureNameNotice(null);
      // Per-panel UI reset (mirrors swapSession) -- these belong to whatever
      // figure was active, never carry across.
      setActivePointIndex(null);
      setColorTraceRegion(null); // a different figure -> old trace region is stale (audit A1)
      setProjectNotice(null); // ...and so is a notice about the figure we just left
      setDataValueInputs([]);
      setSegmentFillError(null);
      setCurveFitDegree(1);
      setCurveFitModel('polynomial');
      setCurveFitRestrict(false);
      setCurveFitXMinInput('');
      setCurveFitXMaxInput('');
      setCurveFitError(null);
      setGeometryClosed(false);
      // Per-figure document state.
      applyProvenance(rec.provenance);
      setFigureCaptured(rec.figureCaptured);
      applyMeasurements(rec.measurements);
      applyMeasureScale(rec.measureScale);
      setSettingScale(false);
      setScaleDraftPx(null);
      setPending([]);
      setSourcePdf(rec.sourcePdf);
      // A restored figure shows its BAKED image, not a live pager -- the source
      // linkback ("Get another figure from the source") re-opens the pager on
      // demand (ckpt 113). So no live pdfState here, but the source is retained.
      applyPdfState(null);
      const calibrated = rec.session.isCalibrated();
      setMode(calibrated ? 'place-point' : 'calibrate');
      setCalibExpanded(!calibrated); // calibrated -> folded; not -> show the steps
      history.reset(captureDoc(rec.imageDataURL)); // reset precedes the load; name the figure's own baked src
      imageLoadPendingRef.current = true; // audit M1: block a re-entrant switch from stashing this mid-load image
      imageCanvasRef.current?.loadImageFromSrc(rec.imageDataURL, rec.imageFileName);
      markClean();
      bump();
    },
    [history, bump, markClean, captureDoc, applyProvenance, applyMeasurements, applyMeasureScale, setPending, setSourcePdf, applyPdfState]
  );

  /** Switch the active figure. Stashes the live state back into the current slot
   * (grabbing the on-canvas image bytes), then restores the target. No-op if the
   * target is out of range or already active. */
  const switchToFigure = useCallback(
    (targetIndex: number) => {
      const figs = figuresRef.current;
      const current = figs[activeFigureIndex];
      const target = figs[targetIndex];
      if (!current || !target || targetIndex === activeFigureIndex) return;
      figs[activeFigureIndex] = {
        ...current,
        session: sessionRef.current,
        axesTypeId: sessionRef.current.getConfig().id,
        // Don't grab the on-canvas image while a prior switch's image is still
        // decoding (audit M1) -- it would be the WRONG figure's picture. Keep the
        // record's own image in that case (it was correct before this rapid switch).
        imageDataURL: imageLoadPendingRef.current ? current.imageDataURL : imageCanvasRef.current?.getImageDataURL() ?? current.imageDataURL,
        imageFileName: imageLoadPendingRef.current ? current.imageFileName : imageCanvasRef.current?.getImageFileName() ?? current.imageFileName,
        measurements: measurementsRef.current,
        measureScale: measureScaleRef.current,
        provenance: provenanceRef.current,
        figureCaptured: figureCapturedRef.current,
        sourcePdf: sourcePdfRef.current,
        sourcePage: pdfStateRef.current?.page ?? current.sourcePage,
      };
      setActiveFigureIndex(targetIndex);
      restoreFigure(target);
    },
    [activeFigureIndex, restoreFigure]
  );

  /** The live figure's mutable fields, for stashing into a FigureRecord. Grabs
   * the on-canvas image bytes -- so it must run BEFORE anything replaces the
   * live image. */
  const liveFigureFields = useCallback(
    () => ({
      session: sessionRef.current,
      axesTypeId: sessionRef.current.getConfig().id,
      imageDataURL: imageCanvasRef.current?.getImageDataURL() ?? '',
      imageFileName: imageCanvasRef.current?.getImageFileName() ?? undefined,
      measurements: measurementsRef.current,
      measureScale: measureScaleRef.current,
      provenance: provenanceRef.current,
      figureCaptured: figureCapturedRef.current,
      sourcePdf: sourcePdfRef.current,
      sourcePage: pdfStateRef.current?.page ?? null,
    }),
    []
  );

  /** "Get another figure from the source" (design §8): go back to the retained
   * paged source (a PDF today) and start a fresh figure from it, keeping the
   * current one. Stashes the live figure into the array (registering it as
   * figure 1 the first time we split), re-enters the source's page flipper as a
   * clean document, and makes the new (still-uncaptured) figure active. The user
   * then flips to the page they want and captures — that capture bakes the new
   * figure in place. Only reachable when a source is retained (no ceremony for a
   * plain single image). */
  const getAnotherFigureFromSource = useCallback(async () => {
    if (extractingRef.current) return; // re-entrancy guard (audit M2): a double-click must not spawn two figures
    const src = sourcePdfRef.current;
    if (!src) return;
    extractingRef.current = true;
    try {
      let doc = pdfDocRef.current;
      if (!doc) {
        // Reopened project (audit H2): the source BYTES are retained but not
        // parsed (closePdf ran on load). Re-parse on demand so "Extract another"
        // works after any reopen instead of being a dead button. Routed by format
        // so a bundled TIFF source re-opens as well as a PDF (B7).
        const fmt = pagedDocumentFormat(src.bytes);
        try {
          if (fmt === 'tiff') {
            const { loadTiff } = await import('./tiffRender.js');
            doc = loadTiff(src.bytes);
          } else {
            const { loadPdf } = await import('./pdfRender.js');
            doc = await loadPdf(src.bytes);
          }
          pdfDocRef.current = doc;
        } catch {
          setProjectError(fmt === 'tiff' ? 'Could not reopen the source TIFF.' : 'Could not reopen the source PDF.');
          return;
        }
      }
      const figs = figuresRef.current;
      // Stash the current live figure (grabs its image before we replace it).
      const fields = liveFigureFields();
      if (figs.length === 0) {
        figs.push({ id: ++figureIdRef.current, name: 'Figure 1', ...fields });
      } else {
        const cur = figs[activeFigureIndex];
        if (cur) figs[activeFigureIndex] = { ...cur, ...fields };
      }
      // Re-enter the retained doc as a fresh document (loadPdfPageAsImage runs
      // resetForNewImage). The current figure is already stashed, so wiping the
      // live refs is safe. Its image loads async; the new record's imageDataURL is
      // filled on the next stash — the live session is the fresh one right now.
      await loadPdfPageAsImage(doc, 1, src.name);
      figs.push({
        id: ++figureIdRef.current,
        // Unique even if a figure was renamed onto the default name (audit B-F4),
        // the same rule series names use (checkpoint 75).
        name: uniqueDatasetName(`Figure ${figs.length + 1}`, figs.map((f) => f.name)),
        session: sessionRef.current,
        axesTypeId: sessionRef.current.getConfig().id,
        imageDataURL: '',
        imageFileName: undefined,
        measurements: [],
        measureScale: null,
        provenance: provenanceRef.current, // loadPdfPageAsImage set the source provenance
        figureCaptured: false,
        sourcePdf: src,
        sourcePage: 1,
      });
      setActiveFigureIndex(figs.length - 1);
    } finally {
      extractingRef.current = false;
    }
  }, [activeFigureIndex, liveFigureFields, loadPdfPageAsImage]);

  /** Remove the active figure (checkpoint 112, David's #1+#2): both "delete a
   * captured figure" and "back out of Extract another graph" (which just leaves
   * you on a fresh figure you can now remove). Switches to an adjacent figure;
   * removing the second-to-last drops back to single-figure mode (array emptied,
   * jumper hidden). Confirms only when the figure has work to lose, so cancelling
   * a just-created empty figure doesn't nag. */
  const removeActiveFigure = useCallback(() => {
    const figs = figuresRef.current;
    if (figs.length < 2) return;
    const hasWork =
      sessionRef.current.isCalibrated() ||
      sessionRef.current.getDataPoints().length > 0 ||
      measurementsRef.current.length > 0;
    if (hasWork && !window.confirm('Remove this figure? Its calibration, points and measurements will be discarded.')) {
      return;
    }
    const removeIndex = activeFigureIndex;
    figs.splice(removeIndex, 1);
    if (figs.length === 1) {
      // Back to one figure: leave the array empty so the jumper disappears and a
      // single-figure session pays nothing (design §0). The survivor goes live.
      const sole = figs[0]!;
      figuresRef.current = [];
      setActiveFigureIndex(0);
      restoreFigure(sole);
    } else {
      const target = Math.min(removeIndex, figs.length - 1); // stay near where you were
      setActiveFigureIndex(target);
      restoreFigure(figs[target]!);
    }
  }, [activeFigureIndex, restoreFigure]);

  // Figure rename (checkpoint 113, David's #6). §5a: a figure's name is its
  // address -- in the jumper, and (later) the default export filename -- and must
  // be unique, so it reuses seriesNames.ts's rules (checkpoint 75) against the
  // OTHER figures' names.
  const handleFigureRenameDraft = useCallback(
    (name: string) => {
      setFigureNameDraft(name);
      const others = figuresRef.current.filter((_, i) => i !== activeFigureIndex).map((f) => f.name);
      setFigureNameNotice(datasetNameError(name, others));
    },
    [activeFigureIndex]
  );

  /** Apply the typed name if unique/non-empty, else revert and say why (mirrors
   * handleCommitRename). Reads the value from the blur event, not a closure, for
   * the same fast-type-then-leave reason series names hit. */
  const handleCommitFigureRename = useCallback(
    (value: string) => {
      const rec = figuresRef.current[activeFigureIndex];
      const trimmed = value.trim();
      if (!rec || trimmed === rec.name) {
        setFigureNameDraft(null);
        setFigureNameNotice(null);
        return;
      }
      const others = figuresRef.current.filter((_, i) => i !== activeFigureIndex).map((f) => f.name);
      const error = datasetNameError(trimmed, others);
      if (error) {
        setFigureNameDraft(null);
        setFigureNameNotice(`${error} Kept the previous name.`);
        return;
      }
      rec.name = trimmed;
      setFigureNameDraft(null);
      setFigureNameNotice(null);
      bump();
    },
    [activeFigureIndex, bump]
  );

  /** Build a live FigureRecord from a deserialized figure (checkpoint 115) -- the
   * multi-figure counterpart of loadCalibratedFigure's session install. */
  const buildFigureRecordFromDeserialized = useCallback(
    (f: DeserializedFigure, sharedSource: { bytes: Uint8Array; name?: string } | null): FigureRecord => {
      const config = AXES_TYPE_CONFIGS.find((c) => c.id === f.configId) ?? XY_AXES_CONFIG;
      const s = new CalibrationSession(config);
      s.setImageHeight(imageHeightRef.current); // best-effort; corrected when the active figure's image loads
      s.loadCalibrated(f.axes as CalibratedAxes, f.datasets);
      return {
        id: ++figureIdRef.current,
        name: f.name,
        session: s,
        axesTypeId: f.configId,
        imageDataURL: f.imageDataURL,
        imageFileName: f.imageFileName,
        measurements: toRecordedMeasurements(f.measurements),
        measureScale: f.measureScale,
        provenance: f.provenance,
        figureCaptured: true,
        // Only figures that actually came from the shared source claim it, so a
        // plain-image figure alongside PDF figures doesn't falsely bundle it.
        sourcePdf: f.provenance.source && sharedSource ? sharedSource : null,
        sourcePage: f.provenance.source?.page ?? null,
      };
    },
    []
  );



  // --- Import a foreign digitizer's project archive (.tar) — checkpoint 88 ------
  // The migration route off the old app (tenet 6: interop happens at the file
  // level). The engine was ported at checkpoint 74 (engine/wpdImport.ts) with
  // zero callers; this is the wiring. A `.tar` holds N figures on one image, so
  // a single supported figure opens directly and several raise a picker.
  const [wpdFigures, setWpdFigures] = useState<WpdFigure[] | null>(null); // non-null => picker open
  const wpdHeldRef = useRef<{ plotData: PlotData; figures: WpdFigure[]; imageDataURL: string } | null>(null);

  const importWpdFigureAt = useCallback(
    (index: number) => {
      const held = wpdHeldRef.current;
      if (!held) return;
      const imported = importWpdFigure(held.plotData, held.figures, index);
      if ('error' in imported) {
        setProjectError(imported.error);
        return;
      }
      setWpdFigures(null); // close the picker if it was open
      loadCalibratedFigure({
        configId: imported.configId,
        axes: imported.axes as CalibratedAxes,
        datasets: imported.datasets as Dataset[],
        imageDataURL: held.imageDataURL,
        imageFileName: held.figures[index]?.name,
        // WPD has no measurement concept -- nothing to carry.
      });
    },
    [loadCalibratedFigure]
  );

  /** Import a foreign digitizer's `.tar` archive, once Open Project has sniffed it
   * out of the bytes. Takes the bytes rather than owning a dialog of its own:
   * there is ONE Open Project, and the FILE says which format it is. */
  const importTarProject = useCallback(async (bytes: Uint8Array) => {
    const archive = readWpdArchive(bytes);
    if ('error' in archive) {
      setProjectError(archive.error);
      return;
    }
    const listed = listWpdFigures(archive.wpdJson);
    if ('error' in listed) {
      setProjectError(listed.error);
      return;
    }
    if (archive.images.length === 0) {
      setProjectError('This project bundles no image.');
      return;
    }
    const img = archive.images[0]!;
    // PDF-bundled projects wait on the PDF loader (roadmap v0.4) -- Chromium's
    // <img> cannot decode a PDF, so surface it rather than fail blank (ckpt 65).
    if (img.mime === 'application/pdf') {
      setProjectError("This project's image is a PDF, which PlotTracer can't open yet.");
      return;
    }
    const imageDataURL = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([img.bytes as BlobPart], { type: img.mime }));
    });

    const { plotData, figures } = listed;
    wpdHeldRef.current = { plotData, figures, imageDataURL };
    const supported = figures.filter((f) => f.configId !== null);
    if (supported.length === 0) {
      setProjectError('No figure in this project can be opened yet.');
      return;
    }
    // One openable figure -> open it. Several -> let the user choose, showing the
    // unopenable ones disabled-with-reason rather than hiding what's there.
    if (supported.length === 1 && figures.length === 1) {
      importWpdFigureAt(supported[0]!.index);
    } else {
      setProjectError(null);
      setWpdFigures(figures);
    }
  }, [importWpdFigureAt]);

  const openProject = useCallback(async () => {
    if (!window.electronAPI) {
      setProjectError('electronAPI is not available — this UI must run inside the Electron dev harness (npm run ui:electron).');
      return;
    }
    if (!confirmDiscardIfDirty()) return;
    const opened = await window.electronAPI.openProject();
    if (!opened) return; // dialog was cancelled

    // Checkpoint 94: a project file arrives as bytes now. A `.zip` container
    // (this version's format) is detected by its magic bytes and read by the
    // zip path; anything else is a legacy JSON project (checkpoints 25-93) and
    // is decoded to text -- detect by CONTENT, never the filename, since users
    // rename files (engine/projectContainer.ts). Old projects keep opening.
    const bytes = base64ToBytes(opened.base64);
    setProjectNotice(null);
    // ⚑ ONE Open Project, and the FILE says which format it is. Every format we
    // read enters through this one door -- no tool gets a menu item, a dialog or
    // a file filter of its own (tenet 5), and adding the next digitizer is a new
    // entry in engine/importRegistry.ts and NO change here. The registry also
    // sniffs INSIDE containers, which it must: a StarryDigitizer project is a zip
    // holding project.json and image.png, exactly like ours.
    const format = identifyProject(bytes);
    if (!format) {
      // Never a generic failure: say what this app CAN open.
      setProjectError(unsupportedFileMessage());
      return;
    }
    if (format.open) {
      // A format that reads straight through to one calibrated figure.
      const imported = format.open(bytes);
      if ('error' in imported) {
        setProjectError(imported.error);
        return;
      }
      setProjectError(null);
      setProjectNotice(imported.notes.length > 0 ? imported.notes.join(' ') : null);
      loadCalibratedFigure({
        configId: imported.configId,
        axes: imported.axes as CalibratedAxes,
        datasets: imported.datasets as Dataset[],
        imageDataURL: imported.imageDataURL ?? '',
        // These formats carry no measurement concept -- nothing to bring across.
      });
      return;
    }
    // The two formats that need a flow of their own: an archive that can hold
    // several figures on one image (the user chooses), and our own projects
    // (which restore far more than a single figure -- measurements, provenance,
    // a bundled source document, multiple figures).
    if (format.id === 'wpd') {
      await importTarProject(bytes);
      return;
    }
    let result;
    if (isZipContainer(bytes)) {
      // Multi-figure project (checkpoint 115): load every figure into figuresRef
      // and restore the one that was active. Detected by CONTENT (does
      // project.json carry a `figures` array), never the filename.
      if (isMultiFigureContainer(bytes)) {
        const multi = deserializeMultiFigureZip(bytes);
        if ('error' in multi) {
          setProjectError(multi.error);
          return;
        }
        // Destroy any stale parsed PDF (audit H2): a project is a baked load, not
        // a live pager. Its retained SOURCE bytes are restored per-figure below;
        // getAnotherFigureFromSource re-parses them on demand. Without this, the
        // previously-open doc leaked AND "Extract another" could render the wrong PDF.
        closePdf();
        const shared = multi.sourceDocument
          ? { bytes: multi.sourceDocument.bytes, name: multi.sourceDocument.name }
          : null;
        const records = multi.figures.map((f) => buildFigureRecordFromDeserialized(f, shared));
        setProjectError(null);
        if (records.length === 1) {
          // A 1-figure container (only reachable via a hand-edited file -- Save
          // never writes one) is a SINGLE-figure session: keep figuresRef empty so
          // the jumper stays hidden and the design-§0 invariant holds (audit B-F6).
          figuresRef.current = [];
          setActiveFigureIndex(0);
          restoreFigure(records[0]!);
        } else {
          figuresRef.current = records;
          setActiveFigureIndex(multi.activeFigure);
          // restoreFigure installs the active figure's session, image, measurements,
          // provenance and (retained) source, and resets undo/dirty (loaded == clean).
          restoreFigure(records[multi.activeFigure]!);
        }
        return;
      }
      result = deserializeProjectZip(bytes);
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        setProjectError('Could not open project — not a PlotTracer project (.zip) or valid JSON.');
        return;
      }
      result = deserializeProject(parsed);
    }
    if ('error' in result) {
      setProjectError(result.error);
      return;
    }
    loadCalibratedFigure({
      configId: result.configId,
      axes: result.axes as CalibratedAxes,
      datasets: result.datasets,
      imageDataURL: result.imageDataURL,
      imageFileName: result.imageFileName,
      // Our own file carries measurements (checkpoint 56); no value/note --
      // they are derived (ckpt 82) and a 0.2.0 file's stale string is not read.
      measurements: result.measurements.map((m) => ({
        id: m.id,
        tool: m.tool as MeasureToolId,
        overlay: { id: m.id, points: m.points, closed: m.closed, label: m.label, labelAt: m.labelAt },
      })),
      measureScale: result.measureScale,
      provenance: result.provenance, // where this figure came from (checkpoint 95)
    });
    // Restore a bundled source document AFTER loadCalibratedFigure (which calls
    // closePdf, clearing the ref), so a project that carried its source PDF keeps
    // carrying it on the next Save (checkpoint 104).
    setSourcePdf(result.sourceDocument
      ? { bytes: result.sourceDocument.bytes, name: result.sourceDocument.name }
      : null);
  }, [confirmDiscardIfDirty, loadCalibratedFigure, setSourcePdf, buildFigureRecordFromDeserialized, restoreFigure, closePdf]);


  const exportData = useCallback(
    // target 'clipboard' (v1.1 #4) copies the very same rendered text a file
    // export would write, in the chosen text format, rather than opening the
    // save dialog. Binary formats (xlsx/png) never call it.
    async (format: ExportFormat, target: 'file' | 'clipboard' = 'file') => {
      if (!window.electronAPI) {
        setProjectError('electronAPI is not available — this UI must run inside the Electron dev harness (npm run ui:electron).');
        return;
      }
      const exportAxes = session.getAxes();
      if (!exportAxes) {
        setProjectError('Calibrate the axes before exporting data.');
        return;
      }
      setProjectError(null);
      // Copying leaves the menu open so its "Copied" tick is visible and a
      // second format can be grabbed; a file export dismisses it as before.
      if (target === 'file') setExportAnchor(null);

      // Precision: round each value to the figure's own resolution unless the
      // user asked for full precision (v1.0). Only the CHOICE is made here --
      // the assembly turns it into a rounder and applies it (the flat/JSON
      // paths round inside valueAtPixel, the type-specific sections take the
      // rounder itself; see core/exportPrecision.ts).
      const mode: PrecisionMode = exportFullPrecision ? 'full' : 'auto';

      // Raw numbers + their unit (checkpoint 82), never the card's formatted
      // string -- core/measurementValues.ts is the one place a value is decided.
      // Resolved HERE because only the component holds the recorded overlays
      // and the measure scale; everything downstream of this is plain data.
      const measures = measurementsRef.current.flatMap((m) => {
        const raw = measurementValue(m.tool, m.overlay.points, { scale: measureScaleRef.current, axes });
        return raw ? [{ tool: m.tool, value: raw.values[0]!, unit: raw.unit }] : [];
      });

      // ⚑ WHAT A FILE IS MADE OF now lives in engine/exportAssembly.ts -- which
      // sections exist, what each holds, and the rules that keep a derived thing
      // (a fit, a geometry run) in its OWN block rather than mixed into the
      // record (David; tenet 9). It came out of this component so it could be
      // tested without launching Electron. What stays here is the part that is
      // genuinely the component's: where the bytes end up.
      const assembly = {
        session,
        axes: exportAxes,
        configId: config.id,
        scope: exportScope,
        precision: mode,
        measures,
      };

      let content: string;
      let ext: string;
      if (format === 'json') {
        ext = 'json';
        content = buildExportJson(assembly);
      } else {
        // Every non-JSON format (csv/tsv/latex/matlab/python AND xlsx) renders
        // the SAME section list. Text formats go through
        // engine/tableFormats.ts; the two spreadsheet formats turn each section
        // into a worksheet.
        const sections = buildExportSections(assembly);
        // XLSX is a binary workbook: build the bytes and save through the same
        // base64 IPC path the .zip project save uses (checkpoint 93), then done.
        // ⚑ OpenDocument first among the spreadsheet formats — it is the ISO
        // standard (26300), several EU administrations require ODF for public
        // documents, and it costs no dependency: an .ods is a ZIP of three XML
        // parts and this repo already writes ZIPs with fflate for project files.
        if (format === 'ods') {
          const { sectionsToOds } = await import('../../engine/odsExport.js');
          await window.electronAPI.saveFile(
            bytesToBase64(sectionsToOds(sections)),
            `${exportBaseName()}.ods`,
            [
              { name: 'OpenDocument spreadsheet', extensions: ['ods'] },
              { name: 'All Files', extensions: ['*'] },
            ],
            'base64'
          );
          markClean();
          return;
        }
        if (format === 'xlsx') {
          // Lazy-load exceljs (~900 kB) only when XLSX is actually exported, so
          // it stays out of the main bundle (Vite splits it into its own chunk).
          const { sectionsToXlsx } = await import('../../engine/xlsxExport.js');
          const bytes = await sectionsToXlsx(sections);
          await window.electronAPI.saveFile(
            bytesToBase64(bytes),
            `${exportBaseName()}.xlsx`,
            [
              { name: 'Excel workbook', extensions: ['xlsx'] },
              { name: 'All Files', extensions: ['*'] },
            ],
            'base64'
          );
          markClean();
          return;
        }
        ext = TABLE_FORMAT_EXTENSION[format];
        content = renderTable(sections, format);
      }

      // Clipboard (v1.1 #4): hand the same rendered text to the OS clipboard
      // instead of a file. Not a persisted artifact, so it does NOT clear the
      // unsaved-work guard (unlike a file export below). The tick beside the row
      // is the confirmation; it self-clears after a moment.
      if (target === 'clipboard') {
        try {
          await navigator.clipboard.writeText(content);
          setCopiedFmt(format);
          window.setTimeout(() => setCopiedFmt((f) => (f === format ? null : f)), 1500);
        } catch {
          setProjectError('Could not copy to the clipboard.');
        }
        return;
      }

      const filterNames: Record<'json' | TableFormat, string> = {
        json: 'JSON', csv: 'CSV', tsv: 'TSV', latex: 'LaTeX', matlab: 'MATLAB', python: 'Python', r: 'R',
      };
      await window.electronAPI.saveFile(content, `${exportBaseName()}.${ext}`, [
        { name: filterNames[format], extensions: [ext] },
        { name: 'All Files', extensions: ['*'] },
      ]);
      markClean(); // data exported -> treat as no longer unsaved
    },
    // `axes` is a real dependency since ckpt 82: a slope's value is derived
    // from it at export time rather than read off a frozen string, so an export
    // captured with a stale axes would write stale numbers.
    [session, markClean, exportScope, exportFullPrecision, axes, exportBaseName, config]
  );

  // Checkpoint 93: save a PNG snapshot of the figure with the digitization
  // drawn on it -- the first consumer of the binary IPC write path (base64 ->
  // real bytes, see ui/electron-ipc.cjs). Unlike Export (data), this needs no
  // calibration: it captures whatever is on the canvas, so it works for a
  // freshly cropped/straightened image too. The default filename is derived
  // from the source image (`figure.png` -> `figure-annotated.png`) so batching
  // a folder doesn't collide the way the hardcoded `data.csv` does -- and the
  // `-annotated` suffix keeps it from overwriting the source image beside it.
  const saveImage = useCallback(async () => {
    if (!window.electronAPI) {
      setProjectError('electronAPI is not available — this UI must run inside the Electron dev harness (npm run ui:electron).');
      return;
    }
    const dataUrl = imageCanvasRef.current?.getCompositePngDataURL();
    if (!dataUrl) {
      setProjectError('Open an image before saving a snapshot.');
      return;
    }
    setProjectError(null);
    setExportAnchor(null);
    // Strip the `data:image/png;base64,` prefix -- the main process wants the
    // raw base64 payload, which it decodes to bytes.
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const source = imageCanvasRef.current?.getImageFileName() ?? 'figure.png';
    const stem = source.replace(/\.[^.]+$/, '');
    await window.electronAPI.saveFile(
      base64,
      `${stem}-annotated.png`,
      [
        { name: 'PNG image', extensions: ['png'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      'base64'
    );
  }, []);

  /**
   * Application accelerators, renderer-side (v1.6).
   *
   * ⚑ These were the native menu's `accelerator` fields until the menu was
   * removed so Alt could carry the key-tips. Rebinding them is not optional
   * housekeeping: `Menu.setApplicationMenu` is what registered them, so removing
   * the menu without this is a regression disguised as a feature -- Ctrl+O,
   * Ctrl+S and, less obviously, all four ZOOM keys simply stop responding.
   *
   * ⚑ The zoom keys are the ones worth calling out. They were NEVER bound in the
   * renderer: the tool-shortcut handler above deliberately bails on any
   * primary-modified key it does not own, and its comment explains why -- a
   * second copy would double-fire against the menu, and a modified digit falling
   * through to the bare-digit chain meant `Ctrl+1` selecting Calibrate and
   * `Ctrl+3` DELETING A POINT (the v1.0 audit's find). Both hazards are handled
   * here by construction: the menu that would have double-fired is gone, and
   * every branch below preventDefaults and stops. That bail remains as the
   * second line of defence.
   *
   * Bound in its own listener rather than in that handler for two reasons. It
   * must fire REGARDLESS OF FOCUS -- a menu accelerator never cared whether you
   * were typing, so Ctrl+S saved while you were naming a series, and folding it
   * into a handler that bails inside text fields would quietly narrow it. And
   * openProject/saveProject/exportData are declared after that effect, so they
   * cannot enter its dependency array without a TDZ error during render.
   *
   * Ctrl+W is deliberately NOT rebound (David's call): the titlebar close, Alt+F4
   * and Cmd+Q all still run the unsaved-work guard, and a fresh IPC channel to
   * duplicate the window manager was not worth its own key badge.
   */
  useEffect(() => {
    function onAccelerator(e: KeyboardEvent) {
      // ⚑ F1 = Help, the universal convention, and the last control in the window with
      // no keyboard route at all (David). Handled before the modifier check because F1
      // carries no modifier, and it drives the trigger BUTTON rather than reaching into
      // FloatingPanel's own anchor state -- pressing the key does exactly what pressing
      // the button does, which is the honest meaning of a shortcut and keeps one code
      // path for opening the panel.
      if (e.key === 'F1') {
        e.preventDefault();
        document.querySelector<HTMLElement>('[data-testid="help-trigger"]')?.click();
        return;
      }
      // Alt-modified combos are left alone -- Alt belongs to the key-tips now.
      if (!primaryMod(e) || e.altKey) return;
      const canvas = imageCanvasRef.current;
      let handled = true;
      switch (e.key.toLowerCase()) {
        case 'o':
          if (e.shiftKey) void openProject();
          else canvas?.openImage();
          break;
        case 's':
          if (e.shiftKey) void exportData('csv');
          else void saveProject();
          break;
        // Electron's `CmdOrCtrl+Equal` is the '=' key; '+' is the same key held
        // with Shift, which is what a user reaching for "zoom in" actually presses.
        case '=':
        case '+':
          canvas?.zoomIn();
          break;
        case '-':
          canvas?.zoomOut();
          break;
        case '0':
          canvas?.zoomFit();
          break;
        case '1':
          canvas?.zoom100();
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    }
    window.addEventListener('keydown', onAccelerator);
    return () => window.removeEventListener('keydown', onAccelerator);
  }, [openProject, saveProject, exportData]);

  const handleRunCurveFit = useCallback(() => {
    if (!axes) return;
    const xMin = curveFitXMinInput.trim() === '' ? undefined : Number(curveFitXMinInput);
    const xMax = curveFitXMaxInput.trim() === '' ? undefined : Number(curveFitXMaxInput);
    const result = runCurveFit(session.getDataset(), axes as unknown as AnyAxes, {
      model: curveFitModel,
      degree: curveFitDegree,
      restrict: curveFitRestrict,
      xMin,
      xMax,
    });
    if ('error' in result) {
      setCurveFitError(result.error);
      return;
    }
    setCurveFitError(null);
    saveCurveFitState(session.getDataset(), result.curveFit);
    commit();
  }, [session, axes, curveFitModel, curveFitDegree, curveFitRestrict, curveFitXMinInput, curveFitXMaxInput, commit]);

  const handleClearCurveFit = useCallback(() => {
    saveCurveFitState(session.getDataset(), null);
    setCurveFitError(null);
    commit();
  }, [session, commit]);

  // Opening a rail fly-out (Curve Fit / Geometry) closes any open docked tool card
  // so two fold-outs are never up at once (David: "autoclose cards when they lose
  // focus"). The fly-out's own Popover already closes on an outside click; this is
  // the other direction -- dropping the mode card (and the Select picker) the
  // moment a fly-out takes focus.
  const closeDockedCardsOnFlyout = useCallback((open: boolean) => {
    if (open) {
      setMode('pan');
      setSelectFoldoutOpen(false);
    }
  }, []);

  // Click the fitted curve on canvas to edit it (v1.1, David): opens the Curve Fit
  // fold-out (same door hotkey 8 uses). Only offered in inspect modes (pan/select)
  // so it never steals a canvas click that's placing points or measuring.
  const openCurveFitPanel = useCallback(() => {
    (document.querySelector('[data-testid="curve-fit-trigger"]:not([disabled])') as HTMLElement | null)?.click();
  }, []);

  // Compute = turn geometry ON for the active series (store the request). The
  // result is derived live from the current points (geometryRun below), so it
  // updates as the series is edited. A failed compute (e.g. < 2 points) still
  // turns it on -- the output panel + tips bar then surface the stale/broken state.
  const handleRunGeometry = useCallback(() => {
    if (!axes) return;
    setGeometryState(session.getDataset(), { closed: geometryClosed });
    commit();
  }, [session, axes, geometryClosed, commit]);

  const handleClearGeometry = useCallback(() => {
    setGeometryState(session.getDataset(), null);
    commit();
  }, [session, commit]);

  const handleRemoveGridLines = useCallback(() => {
    const imageData = imageCanvasRef.current?.getImageData();
    if (!imageData) {
      setGridRemovalError('No image loaded.');
      return;
    }
    const gridRGB = hexToRGB(gridRemovalColor);
    const result = removeGridLinesOp(imageData.data, imageData.width, imageData.height, gridRGB, [255, 255, 255], gridRemovalTolerance);
    imageCanvasRef.current?.applyImageTransform(result.data, result.width, result.height);
    // A same-dimensions pixel filter: no coordinate remap, but now an UNDOABLE
    // step like the other image edits. This also keeps grid removal from
    // entangling with the shared image src -- without its own snapshot, undoing a
    // LATER action would reload a pre-grid-removal raster (the snapshots on either
    // side would disagree on the image). commit() captures the just-baked src via
    // getImageDataURL's synchronous mirror.
    commit();
    setGridRemovalError(null);
  }, [gridRemovalColor, gridRemovalTolerance, commit]);

  // Default the By-colour trace region to the calibration box (2026-07-22
  // walkthrough: a whole-image trace grabbed the title, axis lines and tick
  // labels — same colour as the curve — so the traced curve "crept" outside the
  // plot). XY only: for polar/ternary the calibration-point bbox is not the plot
  // area, so leave those unrestricted.
  const defaultTraceRegion = useCallback((): FilterRegion | null => {
    // A spider's box is the web itself (centre + every spoke tip, plus the overshoot
    // the tracer looks through). Worth having for the same reason as the XY one:
    // radar charts print the axis NAMES just outside the outermost ring, often in
    // the same ink as the grid.
    if (session.getConfig().axesKind === 'spider') {
      return spiderBoxRegion(session.getAxes() as unknown as SpiderAxes | null);
    }
    if (session.getConfig().axesKind !== 'xy') return null;
    return calibrationBoxRegion(session.getPlacedPoints());
  }, [session]);

  useEffect(() => {
    if (mode !== 'color-trace') return;
    // On ENTERING By-colour mode, pre-fill the region with the calibration box —
    // only when nothing is set yet, so a user-drawn or deliberately cleared
    // region wins. It renders as the existing, adjustable "Restrict to a box".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setColorTraceRegion((cur) => cur ?? defaultTraceRegion());
  }, [mode, defaultTraceRegion]);

  // Auto-trace the active series by colour (checkpoint 118; scatter mode 122).
  // Needs a calibrated axes (the points are only meaningful once pixels map to
  // values) and an ungrouped series (a box-plot/error tuple has no place for a
  // bulk trace). 'curve' reduces the colour mask one-point-per-column; 'scatter'
  // reduces it one-point-per-marker (blob centroid) -- same filter, same preview.
  const handleColorTrace = useCallback(() => {
    if (!session.getAxes()) {
      setColorTraceInfo('Calibrate the axes first — traced points need a coordinate system.');
      return;
    }
    if ((config.autoExtractKind ?? 'curve') === 'none' || (session.hasSlots() && config.autoExtractKind !== 'along-axes')) {
      setColorTraceInfo('Auto-trace adds ordinary points; it does not apply to a Box Plot / Error Bar series.');
      return;
    }
    const imageData = imageCanvasRef.current?.getImageData();
    if (!imageData) {
      setColorTraceInfo('No image loaded.');
      return;
    }
    const { data, width, height } = imageData;
    const target = hexToRGB(colorTraceColor);
    // ⚑ THE SERIES ADOPTS THE COLOUR IT WAS TRACED FROM (David, 2026-07-27). The
    // series colour's whole job is to say WHICH series this is, on the canvas and
    // in the table -- and after a By-colour trace the strongest possible answer is
    // the ink the figure itself drew it in. Without this, series are coloured in
    // creation order, so a green-swatched "Series 3" ends up sitting on the red
    // curve: markers that contradict the picture underneath them.
    //
    // Display only. Nothing about the record moves (tenet 9), it rides the same
    // commit as the trace, and one Ctrl+Z takes it back with the points.
    const adoptTracedColour = () => session.setDatasetColor(session.getActiveDatasetIndex(), target);
    // Warn on an over-broad match: the colour likely grabbed the grid/axes/text,
    // not just the series (the live preview overlay shows exactly what — ckpt 121).
    const overBroad = (matched: number) => {
      const pct = (matched / (width * height)) * 100;
      const warn = pct > 25 ? ' — that is a lot of the image; if it grabbed the grid/axes, lower the tolerance or run Grid Removal first.' : '';
      return { pct, warn };
    };
    // ⚑ THE SPIDER TRACE, and why it is offered where the bar one is refused. Every
    // other mechanism here is a curve tool: it reduces the mask by column or by
    // blob, which on a filled bar returns the MIDDLE of a shape whose value is its
    // end -- a number that was never the datum (`59f94a6`). On a radar chart the
    // datum IS where the series crosses an axis, and a crossing is what this
    // measures, along rays the user calibrated. It records one value per axis, into
    // that axis's own slot, and REFUSES the rays whose evidence is ambiguous rather
    // than picking one -- those axes are left empty and the capture cursor lands on
    // them, so the refusals become the worklist.
    if (config.autoExtractKind === 'along-axes') {
      const result = runSpiderTrace(
        data,
        width,
        height,
        session.getAxes() as unknown as SpiderAxes | null,
        target,
        colorTraceTolerance,
        'foreground',
        colorTraceRegion ?? undefined
      );
      if ('error' in result) {
        setColorTraceInfo(result.error);
        return;
      }
      const offered = result.readings.filter((r) => r.point != null).length;
      const placed = session.addSpiderTracePoints(result.readings.map((r) => r.point));
      const named = (list: typeof result.readings) =>
        list.map((r) => r.name || `Axis ${r.index + 1}`).join(', ');
      const ambiguous = result.readings.filter((r) => r.reason === 'ambiguous');
      const missing = result.readings.filter((r) => r.reason === 'none-found');
      const parts = [
        `Read ${placed} of ${result.readings.length} ${result.readings.length === 1 ? 'axis' : 'axes'}.`,
      ];
      // Say what was NOT done, by name. A count alone leaves the user hunting for
      // which rows are still empty -- and the whole design here is that a refusal is
      // information, not a failure.
      if (ambiguous.length)
        parts.push(`${named(ambiguous)}: the colour crosses that ray more than once, so nothing was recorded — place ${ambiguous.length === 1 ? 'it' : 'them'} yourself.`);
      if (missing.length) parts.push(`Nothing of that colour crosses ${named(missing)}.`);
      // ⚑ Clipped is NOT "nothing found" — the colour was still there when the
      // search stopped, so the crossing is beyond the axis's labelled range and the
      // reading would have been the search window's own limit. Say which, and say
      // what to check, because the usual cause is a known point calibrated on an
      // inner ring rather than the axis's end.
      const clipped = result.readings.filter((r) => r.reason === 'clipped');
      if (clipped.length)
        parts.push(`${named(clipped)}: the colour runs past the end of that axis, so nothing was recorded — check the axis's known point, or place ${clipped.length === 1 ? 'it' : 'them'} yourself.`);
      if (offered > placed)
        parts.push(`${offered - placed} ${offered - placed === 1 ? 'axis' : 'axes'} already had a point and ${offered - placed === 1 ? 'was' : 'were'} left alone.`);
      const { pct, warn } = overBroad(result.matched);
      parts.push(`${result.matched.toLocaleString()} matching pixels (${pct.toFixed(1)}% of the image).${warn}`);
      setColorTraceInfo(parts.join(' '));
      if (placed > 0) {
        adoptTracedColour();
        commit();
      }
      return;
    }
    if (colorTraceShape === 'scatter') {
      const result = runBlobDetect(data, width, height, target, colorTraceTolerance, 'foreground', colorTraceRegion ?? undefined, { minDiameter: colorTraceMinBlob });
      if ('error' in result) {
        setColorTraceInfo(result.error);
        return;
      }
      session.addSegmentFillPoints(result.points);
      adoptTracedColour();
      const { pct, warn } = overBroad(result.matched);
      setColorTraceInfo(
        `Placed ${result.blobs} point${result.blobs === 1 ? '' : 's'} (one per marker) from ${result.matched.toLocaleString()} matching pixels (${pct.toFixed(1)}% of the image).${warn}`
      );
      commit();
      return;
    }
    const result = runColorTrace(data, width, height, target, colorTraceTolerance, 'foreground', colorTraceRegion ?? undefined);
    if ('error' in result) {
      setColorTraceInfo(result.error);
      return;
    }
    session.addSegmentFillPoints(result.points);
    adoptTracedColour();
    const { pct, warn } = overBroad(result.matched);
    setColorTraceInfo(`Traced ${result.points.length} points from ${result.matched.toLocaleString()} matching pixels (${pct.toFixed(1)}% of the image).${warn}`);
    commit();
  }, [session, config.autoExtractKind, colorTraceColor, colorTraceTolerance, colorTraceShape, colorTraceMinBlob, colorTraceRegion, commit]);

  // Live colour-match preview (checkpoint 121): while the Auto-trace panel is
  // open, filter the native-resolution pixels by the current colour + tolerance
  // and paint the matches onto an offscreen canvas the size of the image, which
  // ImageCanvas scales onto the base image. Derived, so it recomputes as
  // colour/tolerance change (and when the image is edited, via `version`) and is
  // null when the panel is closed or no image is loaded -- the overlay never
  // lingers. `version` forces recompute after an in-place image edit; the rest of
  // the reads are refs/module functions the linter can't (and needn't) track.
  const colorTraceMask = useMemo<{ canvas: HTMLCanvasElement; count: number; pct: number } | null>(() => {
    if (mode !== 'color-trace' || !canvasHasImage) return null;
    const imageData = imageCanvasRef.current?.getImageData();
    if (!imageData) return null;
    const { width, height, data } = imageData;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    const { mask, count } = colorFilter(data, width, height, hexToRGB(colorTraceColor), colorTraceTolerance, 'foreground', colorTraceRegion ?? undefined);
    const img = context.createImageData(width, height);
    img.data.set(maskToRGBA(mask, width, height, COLOR_TRACE_PREVIEW_RGBA));
    context.putImageData(img, 0, 0);
    return { canvas, count, pct: (count / (width * height)) * 100 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, colorTraceColor, colorTraceTolerance, colorTraceRegion, canvasHasImage, version]);

  const handleAddDataset = useCallback(() => {
    session.addDataset();
    setGeometryClosed(false); // a fresh series has no geometry -- don't inherit the prior series' toggle
    // Stay in the current TRACING tool across "+ Add" -- place-point OR an
    // auto-extract mechanism (By-colour / Flood-fill / Guide points). Tracing a
    // multi-curve figure means adding a series per curve; kicking back to
    // place-point each time forced re-opening the tool for every curve (David,
    // playtest). Only fall back to place-point from a non-tracing mode.
    if (axes && mode !== 'place-point' && !AUTO_EXTRACT_MODES.includes(mode)) setMode('place-point');
    commit();
  }, [session, axes, commit, mode]);

  // Renaming keeps its in-progress text HERE rather than in the session, so the
  // session never holds a duplicate or blank name (see seriesNames.ts on why
  // uniqueness is now load-bearing). Writing every keystroke into the session
  // and cleaning up on blur would leave it briefly invalid, and would need
  // renameDataset to accept names it should refuse -- which is exactly the
  // "permissive core, guards elsewhere" shape checkpoint 69 caught. The draft
  // is null whenever the field isn't being edited.
  //
  // Declared above the callbacks that clear it: a useState referenced by a
  // useCallback defined earlier in the body still works at runtime (the closure
  // resolves later) but the React Compiler can't preserve the memoization
  // across it, and lint fails. Same family as checkpoint 38's useState-vs-useRef
  // gotcha -- the compiler wants the declaration first.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameNotice, setNameNotice] = useState<string | null>(null);

  const handleSelectDataset = useCallback(
    (index: number) => {
      // Changing the active series is navigation, not an edit -- deliberately
      // not its own undo entry (matches how editors don't undo selection). The
      // new active index still rides along in the next real action's snapshot.
      session.setActiveDataset(index);
      setActivePointIndex(null); // selection is per-series; clear on switch
      setSelectedPointIndices([]); // the marquee set indexes the OLD series -- clear it, or Del would act on the new one
      setNameDraft(null); // a half-typed name belongs to the series it was typed on
      setNameNotice(null);
      // The Closed-curve toggle is per-series: reload it from the new series'
      // committed geometry (or false when it has none) so it can't leak the
      // previous series' value into a series that has no geometry yet.
      setGeometryClosed(getGeometryState(session.getDataset())?.closed ?? false);
      bump();
    },
    [session, bump]
  );

  const handleRenameDraft = useCallback(
    (index: number, name: string) => {
      setNameDraft(name);
      // Live, so the reason appears at the keystroke that causes it rather than
      // only once the user looks away.
      setNameNotice(session.datasetNameError(index, name));
    },
    [session]
  );

  /** Applies the typed name if we'd accept it, reverts if we wouldn't. Reverting
   * is the only correct outcome for a name that can't be used -- but it says so,
   * rather than silently dropping what was typed.
   *
   * Takes the value from the blur event rather than reading `nameDraft` from a
   * closure: a fast type-then-leave runs this handler from the render BEFORE
   * setNameDraft lands, so the closure still holds null and the rename was
   * silently skipped. Caught by e2e, where fill()+blur() are back-to-back; a
   * human would usually out-wait it, which is what would have made it a rare
   * "sometimes my rename doesn't stick" bug instead of a red test. The input's
   * value IS the draft, so there's nothing to synchronise. */
  const handleCommitRename = useCallback(
    (index: number, value: string) => {
      const current = session.getDatasets()[index]?.name;
      // Focused and left without typing, or typed the name back as it was --
      // not an edit, so no history entry and nothing to report.
      if (current === undefined || value.trim() === current) {
        setNameDraft(null);
        setNameNotice(null);
        return;
      }
      const error = session.datasetNameError(index, value);
      if (error) {
        setNameDraft(null);
        setNameNotice(`${error} Kept the previous name.`);
        return;
      }
      session.renameDataset(index, value);
      setNameDraft(null);
      setNameNotice(null);
      commit();
    },
    [session, commit]
  );

  const handleSetDatasetColor = useCallback(
    (index: number, hex: string) => {
      session.setDatasetColor(index, hexToRGB(hex));
      pendingEditRef.current = true; // color-picker edit -- commit on blur (picker close)
      bump();
    },
    [session, bump]
  );

  const handleRemoveDataset = useCallback(
    (index: number) => {
      // Confirm deleting a whole series, matching Reset/Remove-figure. Only asks
      // when the series actually holds points; an empty series deletes silently.
      const info = session.getDatasetInfos().find((i) => i.index === index);
      if (
        info &&
        info.pointCount > 0 &&
        !window.confirm(
          `Delete series "${info.name}" and its ${info.pointCount} point${info.pointCount === 1 ? '' : 's'}? This can be undone with Ctrl+Z.`
        )
      ) {
        return;
      }
      session.removeDataset(index);
      commit();
    },
    [session, commit]
  );

  // `version` is listed deliberately in each dependency array below even
  // though the memo bodies don't read it directly -- it's the only signal
  // React has that the ref-held session mutated, so omitting it (which
  // exhaustive-deps would otherwise suggest) would silently freeze these
  // values after the first render.
  /* eslint-disable react-hooks/exhaustive-deps */
  const dataPoints = useMemo(() => session.getDataPoints(), [session, version]);
  const dataPointRoles = useMemo(() => session.getDataPointRoles(), [session, version]);
  const canSortNN = useMemo(() => session.canSortByNearestNeighbour(), [session, version]);
  const placedPoints = useMemo(() => session.getPlacedPoints(), [session, version]);
  // ⚑ The step list the whole UI walks (v1.4). Memoized here rather than called
  // inline because for a repeating type `getSteps()` BUILDS its array, so a fresh
  // identity every render silently disabled the memoization of everything
  // downstream of it (caught by the compiler lint, not by eye).
  const steps = useMemo(() => session.getSteps(), [session, version]);
  // The spider table: one ROW per axis, one COLUMN per series (David, 2026-07-27).
  const spiderTable = useMemo(() => session.getSpiderTable(), [session, version]);
  // Spider points sitting nearer another axis than the one they were captured on.
  // Recomputed on the same tick, so dragging a stray point back onto its ray
  // clears its warning as you drop it.

  const reusableSteps = useMemo(() => session.getReusableSteps(), [session, version]);
  // Memoized (not read directly off currentStep) so the .map() below over
  // it stays inside React Compiler's supported analysis -- mapping JSX
  // straight off an un-memoized session.getCurrentStep() call, even after
  // extracting it to a local const, reliably broke "preserve-manual-
  // memoization" during this checkpoint; wrapping it here (same pattern as
  // dataPoints/placedPoints/reusableSteps above) fixed it.
  const pendingValueFields = useMemo(() => session.getCurrentStep()?.valueFields ?? [], [session, version]);
  const globalFieldValues = useMemo(() => session.getGlobalFieldValues(), [session, version]);
  const hasSlots = useMemo(() => session.hasSlots(), [session, version]);
  const pointGroupNames = useMemo(() => session.getSlotNames(), [session, version]);
  const tupleRows = useMemo(() => session.getTupleRows(), [session, version]);
  const axesOptions = useMemo(() => session.getOptions(), [session, version]);
  const isHistogram = axesTypeId === HISTOGRAM_AXES_CONFIG.id;
  // The graph type names its own tuples; Box Plot's "box" is only the default
  // because it got here first (see AxesTypeConfig.tupleNoun).
  const tupleNoun = session.getConfig().tupleNoun ?? 'box';
  const histogramBins = useMemo(() => session.getHistogramBins(), [session, version]);
  const currentGroupLabel = useMemo(() => session.getCurrentSlotLabel(), [session, version]);
  const currentTupleIndex = useMemo(() => session.getCurrentTupleIndex(), [session, version]);
  const currentGroupIndex = useMemo(() => session.getCurrentSlotIndex(), [session, version]);
  const boxPlotGlyphs = useMemo(() => session.getBoxPlotGlyphs(), [session, version]);
  // Multi-figure (checkpoint 110). figuresRef is a ref, but every figure op ends
  // in setActiveFigureIndex, so this reads fresh on the re-render that follows.
  // The jumper (top, flanking the calibration card) shows only at ≥2 figures (§0).
  const figures = figuresRef.current;
  const hasMultipleFigures = figures.length >= 2;
  const activeFigure = figures[activeFigureIndex];
  // "Extract another graph from the source" (bottom, with the page flipper) is
  // reachable whenever a paged source is retained (design §8).
  const sourceRetained = sourcePdfBundled;
  const figureNavButtonStyle: React.CSSProperties = {
    // Top-justified against the card (David) — so on a tall expanded card the
    // arrows sit up by its header rather than floating at its vertical middle.
    alignSelf: 'flex-start',
    background: theme.color.background.primary,
    border: `1px solid ${theme.color.border.regular}`,
    borderRadius: 6,
    boxShadow: '0 1px 4px rgba(103, 104, 132, 0.18)',
    cursor: 'pointer',
    fontSize: 13,
    lineHeight: 1,
    padding: '6px 8px',
  };
  const binGlyphs = useMemo(() => session.getHistogramBinGlyphs(), [session, version]);
  // The recorded relations, drawn (checkpoint 79). Concatenated with the tuple
  // glyphs above rather than replacing them: both are error bars on the canvas,
  // and they never coexist (the tuple ones only exist on a project saved under
  // the retired "Error Bars" graph type).
  const errorWhiskers = useMemo(() => session.getErrorWhiskers(), [session, version]);
  // ⚑ The live ray follows a PICKED point, falling back to the capture cursor
  // otherwise (David, 2026-07-27). Selecting a recorded point on another spoke used
  // to leave the highlight where the NEXT capture would go, so it pointed at one
  // axis while the selection sat on another.
  //
  // ⚑ "Picked", not merely "selected" — see pickedPointIndex. Keying this on
  // activePointIndex alone silently broke the highlight's OTHER job: placing a point
  // selects it, so the ray stopped on the axis just filled instead of moving to the
  // next one to fill, which is the drift-prevention the ray exists for. Caught by an
  // e2e test that already asserted the walk round the chart — a reminder that a fix
  // can be the defect, and that the suite has to run before the commit, not after.
  const calibPreview = useMemo(
    () =>
      session.getCalibrationPreview(
        config.axesKind === 'spider' && activePointIndex != null && pickedPointIndex === activePointIndex
          ? session.getSpokeIndexOfPoint(activePointIndex)
          : undefined
      ),
    [session, version, config.axesKind, activePointIndex, pickedPointIndex]
  );
  const curveFitState = useMemo(
    () => (config.supportsCurveFit && axes ? getCurveFitState(session.getDataset()) : null),
    [session, version, config, axes]
  );
  // Geometry (v1.1): whether it's ON for the active series is the stored request;
  // the RESULT is derived live from the current points, so editing the series
  // recomputes it (or surfaces a stale/broken error) automatically -- `version`
  // bumps on every point change, the same dep curveFitState uses.
  const geometryState = useMemo(
    () => (config.id === 'xy' && axes ? getGeometryState(session.getDataset()) : null),
    [session, version, config, axes]
  );

  /**
   * What the export would contain, for the disclosure in the Export menu.
   *
   * ⚑ ERRS TOWARD SILENCE ON PURPOSE. Each signal below DEFINITELY produces
   * what it claims -- several series means a series-name column, a measurement
   * means a tool name, a fit means an equation string -- so the note can never
   * assert a limitation the file does not actually have. It may occasionally
   * stay quiet when it could have spoken (a single categorical series carries
   * text this does not detect), and that is the right way round: a false
   * warning is the defect this whole disclosure exists to avoid.
   */
  const exportContent = useMemo(() => {
    const seriesCount = session.getDatasetInfos().length;
    const extraBlocks =
      (measurements.length > 0 ? 1 : 0) + (curveFitState ? 1 : 0) + (geometryState ? 1 : 0);
    return {
      sectionCount: 1 + extraBlocks,
      hasTextCells: seriesCount > 1 || measurements.length > 0 || curveFitState != null,
      hasSourceDocument: sourcePdfBundled,
    };
  }, [session, version, measurements, curveFitState, geometryState, sourcePdfBundled]);
  const geometryRun = useMemo(
    () => (geometryState && axes ? runGeometry(session.getDataset(), axes as unknown as AnyAxes, geometryState.closed) : null),
    [session, version, config, axes, geometryState]
  );
  const geometryResult = geometryRun && 'geometry' in geometryRun ? geometryRun.geometry : null;
  const geometryError = geometryRun && 'error' in geometryRun ? geometryRun.error : null;
  const datasetInfos = useMemo(() => session.getDatasetInfos(), [session, version]);
  const allDatasetsData = useMemo(() => session.getAllDatasetsData(), [session, version]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Every series that already records error for something -- the card's own
  // list, and the visible proof a relation was stored (an unshown link fails
  // "he can only use what he sees").
  const errorSeriesRows = useMemo(
    () =>
      datasetInfos.flatMap((d) => {
        const relation = session.getErrorRelation(d.index);
        return relation
          ? [{ index: d.index, name: d.name, color: rgbToHex(d.color), role: relation.role, of: relation.of, pointCount: d.pointCount }]
          : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, datasetInfos, version]
  );

  const activeDatasetIndex = useMemo(() => datasetInfos.find((d) => d.active)?.index ?? 0, [datasetInfos]);
  const activeInfo = useMemo(() => datasetInfos.find((d) => d.active) ?? datasetInfos[0], [datasetInfos]);
  // The adaptive multi-series spreadsheet model (checkpoint 57): every series'
  // data values (pixel columns dropped), joined name+color, plus the ragged row
  // count (= the longest series). Rendered as one table with a per-type value-dim
  // column set under each series -- see the Data section below.
  const spreadsheetSeries = useMemo(
    () => buildSpreadsheetSeries(allDatasetsData, datasetInfos, session),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allDatasetsData, datasetInfos, session, version]
  );
  // Value-column headers from the axes itself (checkpoint 92), so the table's
  // column names match the exported file's -- was config.valueLabels, which had
  // diverged (CCR t/value vs Time/Magnitude; Ternary A/B/C vs a/b/c). Falls back
  // to config.valueLabels before calibration (no axes to ask yet).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tableValueLabels = useMemo(() => session.getTableValueLabels(), [session, version, config]);
  // Date format per value column (or null) so a date-calibrated column shows a
  // real date in the table, matching the export, not a raw serial (v1.2 #16).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tableDateFormats = useMemo(() => session.getTableDateFormats(), [session, version, config]);
  const spreadsheetMaxRows = useMemo(() => spreadsheetMaxRowCount(spreadsheetSeries), [spreadsheetSeries]);
  const showCategoryColumn = showsCategoryColumn(config.axesKind, hasSlots);

  const curveFitOverlay = useMemo(() => {
    if (!curveFitState || config.id !== 'xy' || !axes) return undefined;
    const xyAxes = axes as unknown as { dataToPixel(x: number, y: number): { x: number; y: number } };
    return sampleCurveFitLine(curveFitState).map((p) => xyAxes.dataToPixel(p.x, p.y));
  }, [curveFitState, config, axes]);

  // Geometry canvas overlay (v1.1): draws the derived result ON the figure, like
  // the fit line. Enclosed-area shaded fill (closed only) + a ring on the point of
  // max curvature. Pixel-space; the series' own points, in order -- perPoint's
  // index maps 1:1 to getDataPoints() (same order computeGeometry read them in).
  const geometryOverlay = useMemo(() => {
    if (!geometryResult || !geometryState || config.id !== 'xy') return undefined;
    const pts = session.getDataPoints().map((p) => ({ x: p.px, y: p.py }));
    if (pts.length < 2) return undefined;
    // The PATH is what geometry actually measures -- the points connected in
    // their stored ORDER. Drawing it makes arc length / curvature legible (and
    // makes it obvious when a scatter isn't in curve order). `closed` shades the
    // enclosed area; the ring marks the sharpest bend.
    return {
      path: pts,
      closed: geometryState.closed,
      maxCurvature: pts[geometryResult.maxCurvature.index],
    };
  }, [geometryResult, geometryState, config, session]);

  // Trace Challenge reveal (v1.2): the round's TRUE answer projected to pixels for
  // the on-figure overlay. Curves -> dashed polylines; scatter -> hollow markers.
  const challengeReveal = useMemo(() => {
    if (gamePhase !== 'reveal') return null;
    const ex = roundQueue[roundIndex];
    if (!ex) return null;
    // Curve/scatter/histogram have an x axis -> project the truth via dataToPixel.
    if (ex.family === 'curve' || ex.family === 'scatter' || ex.family === 'histogram') {
      if (!axes) return null;
      const xy = axes as unknown as { dataToPixel(x: number, y: number): { x: number; y: number } };
      if (ex.family === 'histogram') {
        return { curves: [], markers: truthHistogramPoints(ex.truth).map((p) => xy.dataToPixel(p.x, p.y)) };
      }
      const seriesPx = ex.truth.series.map((s) => s.points.map((p) => xy.dataToPixel(Number(p.x), Number(p.y))));
      return ex.family === 'scatter' ? { curves: [], markers: seriesPx.flat() } : { curves: seriesPx, markers: [] };
    }
    // bar/box have no x calibration -> draw the true values as horizontal lines
    // from the value-axis anchors (bar: each value; box: each median).
    const cal = ex.truth.calibration;
    const x0 = cal.anchors.p1?.px ?? 0;
    const x1 = cal.imageWidth - 20;
    const hline = (value: number) => [
      { x: x0, y: valueToPy(cal, value) },
      { x: x1, y: valueToPy(cal, value) },
    ];
    const curves =
      ex.family === 'bar'
        ? truthBarValues(ex.truth).map((v) => hline(v[0]!))
        : truthBoxValues(ex.truth).map((v) => hline(v[2]!)); // box: median line
    return { curves, markers: [] };
  }, [gamePhase, roundQueue, roundIndex, axes]);

  // Check Calibration overlay (v0.8): the calibrated axis box, drawn only while
  // the toggle is on. `version` is a dep so dragging a calibration handle (which
  // re-runs calibration) re-projects the box live. Whether these axes CAN
  // produce a box (XY only) is decided by calibrationCheckBox returning null,
  // which also gates the toggle button below (a capability gate, not `id==='xy'`
  // -- histogram/error-bar build a real XYAxes and check just fine).
  // v0.8 audit #4 (checkCalib persists across Reset) was CONSIDERED and left as
  // is: the overlay is already null while !axes, so nothing wrong shows; and if
  // the toggle stays on, re-calibrating simply draws the NEW calibration's box,
  // which is a useful verify, not a bug. Cosmetic, no data impact -- deliberate.
  const [checkCalib, setCheckCalib] = useState(false);
  const calibrationCheckOverlay = useMemo(
    () => (checkCalib && axes ? calibrationCheckBox(axes) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checkCalib, axes, version]
  );
  // Whether a calibration-check box is possible at all (XY-underlying axes) --
  // gates the toggle button so it never appears where it can only do nothing.
  const canCheckCalibration = useMemo(
    () => !!axes && calibrationCheckBox(axes) !== null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [axes, version]
  );

  // Committed measurement drawings, plus the in-progress one (a lone dot after
  // the first click) while the ruler tool is active.
  const measureOverlays = useMemo<MeasureOverlay[]>(() => {
    // The on-canvas label is DERIVED too (checkpoint 82). `overlay.label` is a
    // placeholder written at capture; reading it here would re-freeze the very
    // string this checkpoint stopped storing, so a later Set-scale would update
    // the card and leave the canvas showing px.
    const list = measurements.map((m, i) => ({ ...m.overlay, label: measurementViews[i]?.value ?? '' }));
    if (mode === 'measure' && pendingMeasure.length > 0) {
      list.push({ id: 'measure-pending', points: pendingMeasure, label: '', labelAt: pendingMeasure[0]! });
    }
    // The in-flight error link (checkpoint 79). The line you drag IS the
    // relationship, so it has to be visible while you drag it -- reusing the
    // measure-overlay channel, which already draws a polyline + vertices in
    // image-pixel space. Teal rather than measure's amber: this is becoming
    // series data, not a measurement.
    if (mode === 'error-bars' && errorDrag) {
      list.push({
        id: 'error-link-pending',
        points: [errorDrag.from, errorDrag.to],
        label: '',
        labelAt: errorDrag.from,
        color: theme.color.primary.main,
      });
    }
    return list;
  }, [measurements, measurementViews, pendingMeasure, mode, errorDrag]);

  const markers = useMemo<CanvasMarker[]>(() => {
    const result: CanvasMarker[] = [];
    for (const step of steps) {
      const point = placedPoints[step.key];
      if (point) {
        result.push({
          id: step.key,
          x: point.px,
          y: point.py,
          // ⚑ Spider labels the handle with its VALUE alone. The generic
          // "<step>=<values>" form rendered as "Axis 5=80, Biodegradation" — six of
          // those sprawled across the plot, repeating axis names the FIGURE already
          // prints and burying the one thing the handle asserts, which is where that
          // value sits. Caught on screen; no test can see a label being cluttered.
          label:
            config.axesKind === 'spider' && point.values.length > 0
              ? String(point.values[0])
              : point.values.length > 0
                ? `${step.label}=${point.values.join(', ')}`
                : step.label,
          color: step.color,
          kind: 'calibration',
          // Selected for keyboard nudge (checkpoint 127) -- highlighted so you can
          // see which handle the arrow keys will move.
          selected: activeHandleKey === step.key,
          // Interactive *only* in Calibrate mode. Mid-walk (axes === null) a
          // click that lands exactly on an already-placed handle (e.g. X1 and
          // Y1 sharing the same origin pixel, a common real calibration
          // pattern) must still register as the *next* step's click, not start
          // a drag. Once calibrated, the handles stay inert in Place Point mode
          // too -- otherwise a handle sitting on the origin swallows the click
          // meant to drop a *data point* right there (a real reported bug); you
          // switch to Calibrate to nudge a handle, to Place Point to add data.
          draggable: axes !== null && mode === 'calibrate',
        });
      }
    }
    if (pendingPixel) {
      result.push({ id: 'pending', x: pendingPixel.px, y: pendingPixel.py, label: '?', color: theme.color.overlay.pendingMarkerFill });
    }
    // Every *other* dataset's points render first (so the active one's own
    // points, pushed last below, layer on top) as non-interactive, unlabeled
    // dots in that series' own color -- visible for context, never draggable
    // or clickable, so a click/drag can never land on the wrong series by
    // accident. Checkpoint 30, see this file's header comment.
    allDatasetsData.forEach((ds) => {
      if (ds.active) return;
      // A dense series is drawn as a connecting line (checkpoint 131/132): the
      // line carries the shape, so its per-point dots are dropped entirely --
      // even tiny ones mush into a furry band, and an inactive series has no
      // selection to preserve. Sparse series keep their normal dots.
      if (runsForPoints(ds.points).length > 0) return;
      const color = `rgb(${ds.color[0]}, ${ds.color[1]}, ${ds.color[2]})`;
      ds.points.forEach((point, i) => {
        result.push({ id: `inactive-point-${ds.index}-${i}`, x: point.px, y: point.py, label: '', color, draggable: false });
      });
    });
    const activeColorRGB = datasetInfos.find((d) => d.active)?.color;
    const activeColor = activeColorRGB ? `rgb(${activeColorRGB[0]}, ${activeColorRGB[1]}, ${activeColorRGB[2]})` : theme.color.error;
    const activeDense = runsForPoints(dataPoints).length > 0;
    // In Error-bars mode the markers that must be inert are exactly the ones a
    // link drag can START from -- and `errorLinkSnap` answers only for points of
    // the TARGET series. Scoping it that way is what keeps a CAP correctable:
    // select a cap series under Recorded and its own markers stay draggable, the
    // contract ImageCanvas documents ("how caps stay freely adjustable"). A
    // blanket `mode !== 'error-bars'` also froze the caps, so the only way to
    // move a cap was to leave the tool -- and the lower cap is MIRRORED by the
    // app, so an uncorrectable cap means exporting a symmetry the figure never
    // showed. Caught by the v1.3 release-gate audit.
    const isErrorLinkAnchorSeries = mode === 'error-bars' && activeDatasetIndex === errorTargetIndex;
    dataPoints.forEach((point, i) => {
      // Interpolation-assist (checkpoint 120): anchors are the RECORD, drawn big
      // and labelled; the derived samples between them are small unlabelled dots,
      // and not hand-draggable (a drag would just be wiped on the next rebuild).
      const role = dataPointRoles[i];
      const isInterp = role === 'interpolated';
      const isAnchor = role === 'anchor';
      // In the Select tool, every marquee-selected point is highlighted; otherwise
      // it's the single active point (Place Point's selection).
      const selected = mode === 'select' ? selectedPointIndices.includes(i) : i === activePointIndex;
      // On a dense connected plain series the LINE carries the shape (checkpoint
      // 131/132): draw NO per-point dot -- even tiny ones mush into a furry band
      // -- except the SELECTED one, kept visible and grabbable so you can still
      // pick a point off the curve (click a table row to select it). Anchors and
      // interpolation samples always draw (they aren't the furry-band case).
      const plainDense = activeDense && !isInterp && !isAnchor;
      if (plainDense && !selected) return;
      result.push({
        id: `point-${i}`,
        x: point.px,
        y: point.py,
        label: isInterp ? '' : String(i + 1),
        color: activeColor,
        // Inert in Measure mode (v1.1): a measurement click must pass THROUGH a
        // data marker to place the vertex (and snap to it), never get eaten by the
        // marker's own select/drag -- which used to let a measure click grab and
        // move a data point. Also inert in Pan.
        //
        // ⚑ And inert in Error-bars, for the same reason, found the same way --
        // by driving the app. The cap gesture BEGINS by pressing a datum ("drag
        // from a data point out to its error cap"), and the stage handler
        // deliberately pre-empts the landed-on-a-marker bail so that press starts
        // the link. But Konva's built-in drag fires off the marker's OWN
        // mousedown, so the same press did both: it recorded the cap AND hauled
        // the datum along to wherever the drag ended -- i.e. onto the cap. Silent,
        // and it corrupts a point the user had already placed correctly. The
        // datum is the anchor a cap hangs off; capturing the cap must not move it.
        // Scoped to the TARGET series only -- see isErrorLinkAnchorSeries above.
        draggable: mode !== 'pan' && mode !== 'measure' && !isErrorLinkAnchorSeries && !isInterp,
        selected,
        radius: isAnchor ? 6.5 : isInterp ? 2.5 : plainDense ? SELECTED_DOT_RADIUS : undefined,
      });
    });
    return result;
  }, [steps, placedPoints, pendingPixel, dataPoints, dataPointRoles, axes, mode, config.axesKind, allDatasetsData, datasetInfos, activePointIndex, activeHandleKey, selectedPointIndices, activeDatasetIndex, errorTargetIndex]);

  // Connecting polylines drawn beneath the markers (checkpoint 131) -- the fix for
  // a dense auto-trace rendering as a furry band of overlapping dots. Skipped
  // entirely for grouped types (Box Plot / Histogram get glyphs, not a curve) and
  // for sparse/scatter series (polylineRuns returns no runs). Inactive series
  // first so the active one's line layers on top, matching the marker order.
  const seriesLines = useMemo<SeriesLine[]>(() => {
    if (hasSlots) return [];
    const lines: SeriesLine[] = [];
    allDatasetsData.forEach((ds) => {
      if (ds.active) return;
      const runs = runsForPoints(ds.points);
      if (runs.length) lines.push({ color: `rgb(${ds.color[0]}, ${ds.color[1]}, ${ds.color[2]})`, runs });
    });
    const activeRuns = runsForPoints(dataPoints);
    if (activeRuns.length) {
      const c = datasetInfos.find((d) => d.active)?.color;
      lines.push({ color: c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : theme.color.error, runs: activeRuns });
    }
    return lines;
  }, [hasSlots, allDatasetsData, dataPoints, datasetInfos]);

  // Drop a stale calibration-handle selection (checkpoint 127): the nudge only
  // makes sense in Calibrate mode on a handle that still exists, so clear it when
  // the mode changes away or a reset/reload removes that handle -- otherwise a
  // re-placed handle of the same key would appear pre-selected out of nowhere.
  useEffect(() => {
    // Synchronizing a selection to an external condition (React's own sanctioned
    // use of setState-in-effect); guarded so it only ever sets null, never loops.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeHandleKey && (mode !== 'calibrate' || !placedPoints[activeHandleKey])) setActiveHandleKey(null);
  }, [activeHandleKey, mode, placedPoints]);

  // Drop a stale measurement-vertex selection (checkpoint 128): only valid in
  // Measure mode on a measurement that still exists (and a vertex it still has).
  useEffect(() => {
    if (!activeMeasure) return;
    const m = measurements.find((x) => x.id === activeMeasure.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mode !== 'measure' || !m || activeMeasure.vertex >= m.overlay.points.length) setActiveMeasure(null);
  }, [activeMeasure, mode, measurements]);

  // Drop a stale marquee selection (Select tool): its indices are only meaningful
  // in Select mode, against the CURRENT active series. Leaving Select mode is the
  // one entrance the series-switch/undo clears above don't cover -- without this,
  // a selection made in Select mode would linger, and re-entering Select (or a Del
  // from another mode's stray binding) could act on a point set that has since
  // changed. Same family as the activeHandleKey/activeMeasure guards above, and the
  // reason all three exist: a selection must be cleared at EVERY entrance, not one.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mode !== 'select' && selectedPointIndices.length) setSelectedPointIndices([]);
  }, [mode, selectedPointIndices]);

  // One data-value in the XY datapoint table: a text span at rest (so the cell
  // still reads "(x, y)"), swapping to a focused input while it's the cell
  // being edited (checkpoint 39). Committing repositions the point via
  // commitDataPointEdit.
  const renderEditableValue = (index: number, axis: number, value: number) => {
    const suffix = axis === 0 ? 'x' : 'y';
    if (editingCell?.index === index && editingCell.axis === axis) {
      return (
        <input
          data-testid={`data-edit-${suffix}-${index}`}
          autoFocus
          value={editingCell.value}
          onChange={(e) => setEditingCell({ index, axis, value: e.target.value })}
          onBlur={commitDataPointEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDataPointEdit();
            else if (e.key === 'Escape') setEditingCell(null);
          }}
          style={{ width: 56 }}
        />
      );
    }
    return (
      <span
        data-testid={`data-value-${suffix}-${index}`}
        onClick={() => setEditingCell({ index, axis, value: value.toFixed(3) })}
        title="Click to edit — moves the point on the canvas"
        style={{ cursor: 'text', borderBottom: `1px dashed ${theme.color.border.hover}` }}
      >
        {fmtValue(value)}
      </span>
    );
  };

  // One value in the spider table. The same click-to-edit affordance as the XY
  // table, keyed by the SPOKE the point was captured on rather than by a data
  // dimension -- committing runs it back through SpiderAxes.dataToPixel and slides
  // the marker along that ray. This is the typed twin of dragging the marker,
  // which locks to the axis and already worked (David: "I should be able to both
  // edit the number OR move the point on the axis").
  //
  // The span sits inside the cell whose click SELECTS the point, so opening the
  // editor selects it too -- which is what makes the live ray highlight the axis
  // being typed into while the dot slides along it.
  // (`seriesIndex` names the cell for the tests, matching the enclosing
  // `spider-cell-<series>-<axis>`; the EDIT itself is keyed by point index, which is
  // per-series, which is why only the active series renders this.)
  const renderEditableSpiderValue = (seriesIndex: number, pointIndex: number, axisIndex: number, value: number) => {
    if (editingCell?.index === pointIndex && editingCell.axis === axisIndex) {
      return (
        <input
          data-testid={`spider-edit-${seriesIndex}-${axisIndex}`}
          autoFocus
          value={editingCell.value}
          onChange={(e) => setEditingCell({ index: pointIndex, axis: axisIndex, value: e.target.value })}
          onBlur={commitDataPointEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitDataPointEdit();
            else if (e.key === 'Escape') setEditingCell(null);
          }}
          style={{ width: 64, textAlign: 'right' }}
        />
      );
    }
    return (
      <span
        data-testid={`spider-value-${seriesIndex}-${axisIndex}`}
        onClick={() => setEditingCell({ index: pointIndex, axis: axisIndex, value: value.toFixed(3) })}
        title="Click to edit — moves the point along its own axis"
        style={{ cursor: 'text', borderBottom: `1px dashed ${theme.color.border.hover}` }}
      >
        {fmtValue(value)}
      </span>
    );
  };

  // The axis's name in the spreadsheet: plain text at rest, an input while it is
  // the cell being edited — the same click-to-edit affordance the value cells use.
  //
  // ⚑ NOT a permanent boxed field (David, 2026-07-27): "now a user thinks he HAS to
  // add something". The name is optional — an axis whose label the figure prints
  // illegibly is still a real axis — so an unnamed one reads as a dash, exactly
  // like a value nobody recorded, and looks like the rest of the table until you
  // click it.
  const renderEditableAxisName = (axisIndex: number, rawName: string) => {
    if (editingAxisName === axisIndex) {
      return (
        <input
          data-testid={`spider-axis-name-${axisIndex}`}
          autoFocus
          value={rawName}
          placeholder={`Axis ${axisIndex + 1}`}
          onChange={(e) => setSpokeName(axisIndex, e.target.value)}
          onBlur={() => {
            setEditingAxisName(null);
            commitPendingEdit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
          }}
          onClick={(e) => e.stopPropagation()}
          style={{ width: 150, fontSize: 12.5 }}
        />
      );
    }
    return (
      <span
        data-testid={`spider-axis-name-${axisIndex}`}
        onClick={() => setEditingAxisName(axisIndex)}
        title="Click to name this axis, as the figure prints it"
        style={{ cursor: 'text', borderBottom: `1px dashed ${theme.color.border.hover}` }}
      >
        {rawName === '' ? <span style={{ color: theme.color.text.legend }}>—</span> : rawName}
      </span>
    );
  };

  // The single contextual "what do I do now?" line shown in the bottom tips bar
  // (checkpoint 50) -- the one constant place for guidance, so it no longer
  // pops in and out of the right panel.
  const guidanceTip = (() => {
    if (!canvasHasImage) return 'Open an image to begin — or drag-and-drop / paste one onto the canvas.';
    // Before capture, the only real actions are frame (pan/zoom) + Capture. Say
    // so, and state the WYSIWYG model so the framing is deliberate (David).
    if (mode === 'image-edit' && !figureCaptured) return 'Prep the source: rotate, flip, crop or fine-deskew — then press Capture to freeze the cleaned-up figure.';
    // ⚑ Said "(tool 9)" until the v1.3 gate -- 9 is Geometry; Edit image is 2. The
    // rail was renumbered in v1.0.2 and this line, the FIRST one every first-run
    // user reads, kept pointing at the old slot.
    if (!figureCaptured) return 'Frame the whole figure in the window (pan / zoom) — rotate / crop / deskew first if needed (tool 2) — then press Capture. What you see is what you capture.';
    if (eyedropper === 'grid') return 'Eyedropper: click a gridline on the image to sample its colour.';
    if (eyedropper === 'series') return 'Eyedropper: click the series\u2019 curve on the image to take its colour.';
    if (mode === 'image-edit') {
      if (cropMode)
        return cropRect
          ? 'Crop — Apply to keep the selected area (calibration and points move with it), or adjust the rectangle / Cancel.'
          : 'Crop — drag a rectangle over the area to keep.';
      return 'Image — rotate or flip; calibration and points move with the image.';
    }
    // Measure takes priority over an in-progress calibration: if the ruler is
    // active, the user wants measurement guidance, not the calibration step.
    if (mode === 'measure') {
      // A selected recorded vertex wins: surface the keyboard precision path so
      // it's not a shortcut-only path (keystone). Only while nothing new is being
      // placed (no pending points, no scale-setting).
      if (activeMeasure && !settingScale && pendingMeasure.length === 0)
        return 'Measurement point selected — ↑ ↓ ← → nudge (Shift = coarse); the value updates live. Or click another point.';
      if (settingScale) {
        if (scaleDraftPx != null) return 'Set scale — type the real distance between the two points, then Set.';
        return pendingMeasure.length === 1
          ? 'Set scale — click the second point of a known distance.'
          : 'Set scale — click the first point of a known distance.';
      }
      if (measureError) return `⚠ ${measureError}`;
      if (measureTool === 'slope') {
        if (!axes || config.id !== 'xy') return 'Slope — calibrate an XY chart first, then click two points on the line.';
        return pendingMeasure.length === 1
          ? 'Slope — click the second point on the line.'
          : 'Slope — click the first point on the line.';
      }
      if (measureTool === 'distance') {
        const where = measureScale ? measureScale.unit : 'pixels — use Set scale for real units';
        return pendingMeasure.length === 1
          ? `Distance — click the second point (measuring in ${where}).`
          : `Distance — click the first point (measuring in ${where}).`;
      }
      if (measureTool === 'angle') {
        return pendingMeasure.length === 0
          ? 'Angle — click the vertex.'
          : pendingMeasure.length === 1
            ? 'Angle — click the first arm.'
            : 'Angle — click the second arm.';
      }
      // area
      return pendingMeasure.length < 3
        ? `Area — click polygon corners (${pendingMeasure.length} placed; need 3+).`
        : `Area — keep clicking corners, then Finish (or Enter) to close (${pendingMeasure.length} placed).`;
    }
    if (isCalibrating) {
      if (pendingPixel) {
        return `Enter the ${currentStep!.label} value${pendingValueFields.length > 1 ? 's' : ''}, then press Confirm.`;
      }
      return `Calibration step ${session.getStepIndex() + 1}/${steps.length} — ${currentStep!.label}: ${currentStep!.prompt}`;
    }
    if (axes) {
      if (mode === 'select') {
        if (selectedPointIndices.length > 0)
          return `${selectedPointIndices.length} point${selectedPointIndices.length > 1 ? 's' : ''} selected — Del removes them, ↑ ↓ ← → nudge (Shift = coarse), Esc clears. Shift-click adds one.`;
        // No points to select yet -- point the user at Add rather than inviting a
        // click on an empty canvas (the post-calibration default is Add, so this is
        // only reached by choosing Select first).
        if (dataPoints.length === 0) return 'No points yet — switch to Add points (3) to place some, then come back to Select.';
        return 'Click a point to select it, or drag a box to select a range. Then Del removes, arrows nudge. (Data points only — calibration handles are safe.)';
      }
      if (mode === 'place-point') {
        // With a point selected, surface the keyboard precision path -- otherwise
        // arrow-nudge/Del would be a shortcut-only path the user can't see (the
        // keystone rule: he can only use what's on screen).
        if (activePointIndex != null)
          return `Point ${activePointIndex + 1} selected — ↑ ↓ ← → nudge (Shift = coarse), Q/W step points, Del removes it. Or click to add another.`;
        // ⚑ Spider, for the same reason the bar branch below exists: WHERE you
        // click decides the number. On a spider the value is how far out along
        // THAT axis's ray the click sits, so the generic slot line ("click
        // to add a point, filling Strength") would leave a first-run user to infer
        // that the ray matters at all — and a click off the ray still records,
        // projected, with only the off-axis warning to hint at it. Naming the axis
        // the cursor is on is also the only on-screen thing that says the order is
        // guidance rather than a rule.
        if (config.axesKind === 'spider' && hasSlots)
          return `Click where the shape crosses the ${currentGroupLabel} axis — how far out along that ray you click IS the number recorded${currentTupleIndex === null ? ` (starting a new ${tupleNoun})` : ` (${tupleNoun} ${currentTupleIndex + 1})`}.`;
        if (hasSlots)
          return `Click to add a point — filling ${currentGroupLabel}${currentTupleIndex === null ? ` (new ${tupleNoun})` : ` (${tupleNoun} ${currentTupleIndex + 1})`}.`;
        // ⚑ On a bar-family figure WHERE you click decides the number: the value is
        // read off the click's position on the value axis, so "click anywhere"
        // invited the very midpoint error 59f94a6 blocked on the automated path --
        // by hand, one click at a time. Auto-extract is greyed out here, so Add
        // points is the ONLY capture tool, and this is the only place the app can
        // say where to aim. The Trace Challenge already used the right words
        // ("click the top of each bar"); the main workflow never did. v1.3 gate.
        // Wording stays orientation-agnostic ("end", not "top"): a rotated
        // horizontal-bar chart grows sideways, and the option isn't plumbed here.
        if (config.axesKind === 'bar')
          return config.id === 'categorical'
            ? 'Click each category’s marker in turn — where you click on the value axis IS the number recorded.'
            : 'Click the END of each bar in turn — where you click on the value axis IS the number recorded, so aim at the bar’s end, never its middle.';
        return 'Click anywhere on the image to add a data point. Hold Space or drag the middle button to pan; scroll to zoom.';
      }
      if (mode === 'calibrate') {
        if (activeHandleKey)
          return 'Handle selected — ↑ ↓ ← → nudge (Shift = coarse); recalibrates live. Or drag it.';
        return 'Drag a calibration handle to adjust it (or click one, then ↑ ↓ ← → to nudge), or switch to Place Point to add data.';
      }
      if (mode === 'segment-fill') return 'Flood-fill — click a solid, unbroken curve to trace it automatically.';
      // By-colour traces via the Trace button, not a canvas click (v0.8 audit #2:
      // without this the tip fell through to "calibrate the axes" on an already-
      // calibrated chart, and gave no hint that a stray click does nothing).
      // ⚑ On a spider it does a different job, and the tip has to say so: it reads
      // ALONG the calibrated rays, one value per axis, and leaves an axis empty
      // where the evidence is doubtful. Without that, "Trace" reads as the curve
      // tool it is everywhere else, and an axis coming back empty looks like a bug
      // rather than the refusal it is.
      if (mode === 'color-trace')
        return config.autoExtractKind === 'along-axes'
          ? 'By colour — pick the series’ colour (or take it from the image with the pipette), set the tolerance, then press Trace: it reads one value per axis, where the colour crosses each ray. An axis it can’t read is left for you to place.'
          : 'By colour — pick the series’ colour (or take it from the image with the pipette), set the tolerance, then press Trace. Drag a box on the image to limit the trace to it; a plain click does nothing.';
      if (mode === 'interpolate') {
        if (dataPoints.length === 0)
          return 'Interpolate — click a few guide points along one curve; the curve fills in between them.';
        if (activePointIndex != null && dataPointRoles[activePointIndex] === 'anchor')
          return 'Anchor selected — ↑ ↓ ← → nudge (Shift = coarse), Q/W step anchors, Del removes it — the curve refits. Or click to add another.';
        return 'Interpolate — click to add a guide point (Q/W to step between anchors); the fill redraws as you go.';
      }
      if (mode === 'eraser') return 'Eraser — click a data point to remove it.';
      // ⚑ Error bars had NO branch here, so a calibrated chart in this mode fell
      // through to the uncalibrated fallback below and told the user to "calibrate
      // the axes to begin" -- while the calibration card beside it said Calibrated ✓
      // and the status bar agreed. The one tool whose whole job is a two-ended drag
      // was also the one with no guidance for it. Caught on the screenshot bench.
      if (mode === 'error-bars') {
        if (dataPoints.length === 0)
          return 'Error bars — place the data points first (tool 3), then drag from a point out to its cap.';
        return 'Error bars — drag from a data point out to its error cap; a cap is placed on each side, the lower one mirrored as a starting position. To move a cap, pick its series under Recorded, then drag the cap.';
      }
      if (mode === 'pan') return 'Pan and zoom only — pick a tool from the left rail to edit.';
    }
    return 'Pick a graph type, then calibrate the axes to begin.';
  })();

  // The empty data table's hint, matched to the ACTIVE TOOL.
  //
  // ⚑ It used to say "click on the image to add data points" unconditionally --
  // which directly CONTRADICTED the tips bar in the auto-extract modes, where a
  // plain canvas click is deliberately inert ("a plain click does nothing").
  // Both lines were on screen at once telling the reader opposite things, so
  // following the panel meant clicking the curve repeatedly and concluding the
  // app was broken: the same "I clicked and nothing happened" failure as the
  // card-swallowing-clicks bug, reached by a different route. Caught on David's
  // screenshot test bench while shooting the By-colour gallery image.
  const noPointsHint = (() => {
    if (mode === 'color-trace')
      return 'No points yet — pick the series’ colour, then press Trace. A plain click on the image does nothing here.';
    if (mode === 'segment-fill') return 'No points yet — click the curve on the image to flood-fill it.';
    if (mode === 'interpolate') return 'No points yet — click a few guide points along one curve.';
    if (mode === 'place-point')
      return config.axesKind === 'bar'
        ? 'No points yet — click the end of each bar to record its value.'
        : 'No points yet — click on the image to add data points.';
    // Pan / Select / Eraser / Measure / Image-edit / Error-bars: a canvas click
    // adds nothing in any of them, so point at the tools that DO capture.
    //
    // ⚑ Auto-extract is permanently greyed for the bar family (59f94a6), so naming
    // it here put two panels on screen recommending what the other refuses -- a
    // FOURTH instance of the contradiction class this hint was written to kill.
    // Found by the v1.3 gate; reachable with zero points via Select/Pan/Measure/
    // Error-bars/Edit-image on a calibrated bar chart.
    if (config.axesKind === 'bar') return 'No points yet — pick Add points (3) from the tool rail and click the end of each bar.';
    return 'No points yet — pick Add points (3) or Auto-extract (4) from the tool rail.';
  })();

  // The Measure card's reference line is tool-aware: Slope reads the chart axes;
  // Distance/Area read the Set-scale px->unit; Angle is degrees (no reference).
  const measureReference: MeasureRef =
    measureTool === 'slope'
      ? axes && config.axesKind === 'xy'
        ? { kind: 'chart' }
        : { kind: 'none' }
      : measureTool === 'distance' || measureTool === 'area'
        ? measureScale
          ? { kind: 'scale', perPx: `1 px = ${fmtNum(measureScale.unitPerPx)} ${measureScale.unit}` }
          : { kind: 'none' }
        : { kind: 'degrees' }; // angle
  const setScaleDraft: SetScaleDraft | null =
    settingScale && scaleDraftPx != null
      ? {
          px: scaleDraftPx,
          value: scaleValueInput,
          unit: scaleUnitInput,
          onValueChange: setScaleValueInput,
          onUnitChange: setScaleUnitInput,
          onConfirm: confirmSetScale,
          onCancel: cancelSetScale,
        }
      : null;

  // Curve Fit + Geometry rail fly-outs (v0.8), moved off the overflowing top
  // bar. Extracted to consts so their rail placement is a one-liner -- Curve Fit
  // sits ABOVE the interpolate tool and Geometry BELOW it (David), the three
  // curve tools clustering around interpolate.
  //
  // VISIBILITY is gated on the chart TYPE's capability (a two-level model David
  // caught): Curve Fit shows on any curve-fit-capable axes, Geometry only on XY
  // (runGeometry rejects grouped data, so showing it elsewhere would open a
  // panel that can only error). ENABLEMENT is gated on `axes` (calibration) via
  // `disabled`, NOT visibility -- so they appear GREYED before calibration, the
  // same convention as Add points (#3) and the Auto-extract mechanisms (#5).
  // Hiding them until calibrated (the old behaviour) made interpolate look like
  // it appeared "before" its sibling curve tools; now all three show together.
  const curveFitFlyout =
    config.supportsCurveFit ? (
      <FloatingPanel placement="rail" label="Curve Fit" icon={<CurveFitIcon />} testId="curve-fit" shortcut="8" disabled={!axes} onOpenChange={closeDockedCardsOnFlyout}>
        {/* Single input row (v1.1 step 2): Degree · Restrict · Fit · Clear. The
            x-range inputs drop in below only while Restrict is on; the RESULT
            (equation, R², RMS, n) lives in the output panel's Curve fit section. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* The SHAPE comes first, because it decides whether Degree means
              anything. Each option carries its own form (y = a·e^(b·x)) so the
              list can be READ rather than recognised — but the closed control is
              width-capped, because a <select> sizes itself to its widest option
              and an un-capped one made this fold-out wide enough to cover the
              figure it sits over. The chosen form is repeated below the row, so
              nothing is hidden by that cap. */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Model
            <select
              data-testid="curve-fit-model"
              value={curveFitModel}
              onChange={(e) => setCurveFitModel(e.target.value as CurveFitModelId)}
              style={{ maxWidth: 120 }}
            >
              <option value="polynomial">Polynomial</option>
              {FIT_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — {m.form}
                </option>
              ))}
            </select>
          </label>
          {/* Degree belongs to the polynomial alone. Showing it greyed for the
              others would imply it still applies to them. */}
          {curveFitModel === 'polynomial' && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Degree
              <select
                data-testid="curve-fit-degree"
                value={curveFitDegree}
                onChange={(e) => setCurveFitDegree(Number(e.target.value))}
              >
                {Array.from({ length: CURVE_FIT_MAX_DEGREE }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              data-testid="curve-fit-restrict"
              checked={curveFitRestrict}
              onChange={(e) => setCurveFitRestrict(e.target.checked)}
            />
            Restrict
          </label>
          <button type="button" data-testid="curve-fit-run" onClick={handleRunCurveFit}>
            Fit
          </button>
          <button type="button" data-testid="curve-fit-clear" onClick={handleClearCurveFit} disabled={!curveFitState}>
            Clear
          </button>
        </div>
        {/* The chosen model's form, spelled out. The select above is width-capped
            so the card cannot cover the figure, and this is what makes that cap
            cost nothing: the form is on screen either way. */}
        {curveFitModel !== 'polynomial' && (
          <div
            data-testid="curve-fit-model-form"
            style={{ marginTop: 4, fontSize: theme.font.size.small, color: theme.color.text.secondary }}
          >
            {FIT_MODELS.find((m) => m.id === curveFitModel)?.form}
          </div>
        )}
        {curveFitRestrict && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: theme.font.size.small, color: theme.color.text.secondary }}>
            X min
            <input
              type="number"
              data-testid="curve-fit-xmin"
              value={curveFitXMinInput}
              onChange={(e) => setCurveFitXMinInput(e.target.value)}
              style={{ width: 70 }}
            />
            X max
            <input
              type="number"
              data-testid="curve-fit-xmax"
              value={curveFitXMaxInput}
              onChange={(e) => setCurveFitXMaxInput(e.target.value)}
              style={{ width: 70 }}
            />
          </div>
        )}
        {curveFitError && (
          <p data-testid="curve-fit-error" style={{ color: theme.color.error, marginBottom: 0 }}>
            {curveFitError}
          </p>
        )}
      </FloatingPanel>
    ) : null;

  const geometryFlyout =
    config.id === 'xy' ? (
      <FloatingPanel placement="rail" label="Geometry" icon={<GeometryIcon />} testId="geometry" shortcut="9" disabled={!axes} onOpenChange={closeDockedCardsOnFlyout}>
        {/* Single input row (v1.1 step 2): Closed curve · Compute · Clear. The
            RESULT (arc length, area, curvature + per-point table) lives in the
            output panel's Geometry section; it recomputes as the series is edited. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              data-testid="geometry-closed"
              checked={geometryState ? geometryState.closed : geometryClosed}
              onChange={(e) => {
                const v = e.target.checked;
                setGeometryClosed(v);
                // If geometry is already on, re-derive live with the new setting.
                if (geometryState) {
                  setGeometryState(session.getDataset(), { closed: v });
                  commit();
                }
              }}
            />
            Closed curve
          </label>
          <button type="button" data-testid="geometry-run" onClick={handleRunGeometry}>
            Compute
          </button>
          <button type="button" data-testid="geometry-clear" onClick={handleClearGeometry} disabled={!geometryState}>
            Clear
          </button>
        </div>
      </FloatingPanel>
    ) : null;

  return (
    // Key-tips are published to the whole tree so every IconButton -- the rail's tools
    // included -- lights up together when Alt is held, rather than the top bar alone.
    <KeyTipsContext.Provider value={keyTips}>
    <AppShell style={{ ['--sidebar-width' as string]: `${sidebarWidth}px` } as CSSProperties}>
      <TopBar>
        {/* Clear all points — top-left, matching Ketcher's "new/clear document"
            position (David 2026-07-22). Icon-only; still confirms before wiping
            the series. The per-point Eraser lives on the rail. */}
        <TopBarGroup>
          <TopBarButton
            type="button"
            data-testid="clear-points"
            title="Clear all points in the active series"
            disabled={dataPoints.length === 0}
            onClick={clearPoints}
          >
            <DeleteIcon />
          </TopBarButton>
        </TopBarGroup>
        {/* Grouped into "chrome" cards (checkpoint 44, mirroring Ketcher's
            toolbar). Open Image leads -- it's the default first action; "Open
            Project" vs "Open Image" are spelled out because the icons alone
            weren't obvious. */}
        <TopBarGroup>
          <TopBarButton
            type="button"
            data-testid="open-image-button"
            title="Open an image or PDF to digitize — PNG, JPG, GIF, BMP, WEBP, SVG, PDF (or drag-and-drop / paste one)"
            onClick={() => imageCanvasRef.current?.openImage()}
          >
            <ImageIcon /> Open Image
            {keyTips && <KeyTip>{keyTipLabel('O')}</KeyTip>}
          </TopBarButton>
          <AxesTypeSelect
            options={AXES_TYPE_CONFIGS}
            value={axesTypeId}
            onChange={(id) => {
              if (id !== axesTypeId && confirmDiscardIfDirty()) changeAxesType(id);
            }}
          />
        </TopBarGroup>

        {/* Project file I/O group. */}
        <TopBarGroup>
          <TopBarButton type="button" data-testid="open-project" title="Open a saved project" onClick={openProject}>
            <OpenIcon /> Open Project
            {keyTips && <KeyTip>{keyTipLabel('O', true)}</KeyTip>}
          </TopBarButton>
          <TopBarButton
            type="button"
            data-testid="save-project"
            title="Save the whole project — image, calibration and points — as a PlotTracer project file you can reopen later"
            onClick={saveProject}
          >
            <SaveIcon /> Save Project
            {keyTips && <KeyTip>{keyTipLabel('S')}</KeyTip>}
          </TopBarButton>
        </TopBarGroup>

        {/* ⚑ Export gets its own card. Open Project and Save Project are two halves of
            ONE function -- project I/O -- and belong tight together (David); Export
            writes data OUT in nine other formats and is a different job. Separating
            them by card rather than by widening the group's gap keeps the pair that
            belongs together looking like it does. */}
        <TopBarGroup>
          <TopBarButton
            type="button"
            data-testid="export-csv"
            title="Export the extracted data (CSV/TSV/JSON) or a PNG snapshot of the figure"
            onClick={(e) => { setCopiedFmt(null); setExportAnchor(e.currentTarget); }}
            // Enabled once there is anything to export: a calibrated chart for
            // the data formats, or just a loaded image for the PNG snapshot
            // (checkpoint 93 -- which needs no calibration, so a cropped or
            // straightened image can be saved before any axes are placed).
            disabled={!axes && !canvasHasImage}
          >
            <ExportIcon /> Export <ChevronDownIcon />
            {/* ⚑ Badged here AND on the CSV row inside, which is not two homes for one
                fact: the trigger says "there is a keyboard route to exporting", the row
                says "and it gives you this format". Unlike the zoom control -- where
                Ctrl+0 does one of four things in the menu and naming it on the trigger
                would be arbitrary -- every item here IS an export, so Ctrl+Shift+S is
                the fast path through this menu rather than a different action wearing
                its badge. Leaving the trigger bare cost the one accelerator people
                actually reach for its only visible home. */}
            {keyTips && <KeyTip>{keyTipLabel('S', true)}</KeyTip>}
          </TopBarButton>
          <Popover
            open={Boolean(exportAnchor)}
            anchorEl={exportAnchor}
            onClose={() => setExportAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          >
            <div data-testid="export-menu" style={{ display: 'flex', flexDirection: 'column', padding: 4, minWidth: 150 }}>
              {/* Precision opt-in (v1.0): default rounds each value to the figure's
                  own resolution; ticked, emits every computed digit. Toggling must
                  not close the popover or trigger an export, so it's a plain label
                  above the format list. */}
              <label
                data-testid="export-full-precision"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', fontSize: theme.font.size.small, color: theme.color.text.secondary, cursor: 'pointer' }}
                title="Off: round each value to the figure's own resolution (~half a pixel). On: export every computed digit."
              >
                <input
                  type="checkbox"
                  checked={exportFullPrecision}
                  onChange={(e) => setExportFullPrecision(e.target.checked)}
                />
                Full precision
              </label>
              <div style={{ height: 1, background: theme.color.border.regular, margin: '2px 0' }} />
              {/* Each text format saves to a file on the label; the trailing
                  copy button (v1.1 #4) puts the SAME rendered text on the
                  clipboard. Excel is a binary workbook, so it has no clipboard
                  action (copyable: false). */}
              {/* ⚑ What an export does NOT carry, said BEFORE the user picks a
                  format rather than discovered afterwards (David, 2026-07-28).
                  Every claim is verified against the writers in
                  engine/exportCapability.ts -- announcing a loss that does not
                  happen would be the same defect as hiding one that does, which
                  is why roles, categories, measurements and fits are NOT listed:
                  they are carried. It ends by naming what does keep them, so the
                  warning has a door out. */}
              <p
                data-testid="export-omission-note"
                style={{
                  margin: '2px 6px 6px',
                  color: theme.color.text.secondary,
                  fontSize: theme.font.size.small,
                  maxWidth: 260,
                }}
              >
                {exportOmissionNote(exportContent)}
              </p>
              {([
                { fmt: 'csv', label: 'CSV (.csv)', copyable: true },
                { fmt: 'tsv', label: 'TSV (.tsv)', copyable: true },
                { fmt: 'json', label: 'JSON (.json)', copyable: true },
                { fmt: 'ods', label: 'OpenDocument (.ods)', copyable: false },
                { fmt: 'xlsx', label: 'Excel (.xlsx)', copyable: false },
                { fmt: 'latex', label: 'LaTeX table (.tex)', copyable: true },
                { fmt: 'matlab', label: 'MATLAB (.m)', copyable: true },
                { fmt: 'python', label: 'Python (.py)', copyable: true },
                { fmt: 'r', label: 'R (.R)', copyable: true },
              ] as const).map(({ fmt, label, copyable }) => (
                <div key={fmt} style={{ display: 'flex', alignItems: 'stretch', gap: 2 }}>
                  <TopBarButton
                    type="button"
                    data-testid={`export-format-${fmt}`}
                    // What THIS format does to THIS project, when there is
                    // anything true to say -- empty otherwise, because padding
                    // every format with a generic caveat teaches the user to
                    // ignore the line.
                    title={formatLimitationNote(fmt, exportContent) || undefined}
                    onClick={() => void exportData(fmt)}
                    style={{ justifyContent: 'flex-start', flex: 1 }}
                  >
                    {label}
                    {/* The accelerator sits beside the action it performs, not on the
                        menu that contains it. Only CSV has one. */}
                    {fmt === 'csv' && keyTips && <KeyTip>{keyTipLabel('S', true)}</KeyTip>}
                  </TopBarButton>
                  {copyable && (
                    <TopBarButton
                      type="button"
                      data-testid={`export-copy-${fmt}`}
                      title={copiedFmt === fmt ? 'Copied to clipboard' : `Copy ${label.replace(/ \(.*\)$/, '')} to the clipboard`}
                      onClick={() => void exportData(fmt, 'clipboard')}
                      style={{ flex: '0 0 auto', padding: '0 8px', color: copiedFmt === fmt ? theme.color.primary.main : undefined }}
                    >
                      {copiedFmt === fmt ? <CheckGlyph /> : <CopyGlyph />}
                    </TopBarButton>
                  )}
                </div>
              ))}
              {/* PNG snapshot (checkpoint 93): the image with the digitization
                  drawn on it, not the extracted data. Sits with the data formats
                  because "Export" is where the user looks to save any output
                  artifact, but its own handler (needs only an image, not axes).

                  ⚑ SEPARATED from them deliberately (v1.5 audit): the note above
                  says "these formats ... do not carry the figure image", and this
                  button carries exactly that and nothing else. With no boundary
                  it read as one more data format the note covered, so the two
                  contradicted each other on one screen. The rule gets a visible
                  edge, and the heading says which side this is. */}
              <div
                style={{
                  borderTop: `1px solid ${theme.color.border}`,
                  margin: '6px 0 2px',
                  paddingTop: 6,
                  fontSize: 11,
                  color: theme.color.text.secondary,
                }}
              >
                The figure itself, not the numbers
              </div>
              <TopBarButton type="button" data-testid="export-format-png" onClick={() => void saveImage()} style={{ justifyContent: 'flex-start' }}>
                PNG image (.png)
              </TopBarButton>
            </div>
          </Popover>
        </TopBarGroup>

        {/* Analysis group (checkpoint 40) -- floating Popovers. Grid Removal is
            always available (image prep); Curve Fit and Geometry are XY-only +
            calibrated. */}
        <TopBarGroup>
        <FloatingPanel label="Grid Removal" icon={<GridRemovalIcon />} testId="grid-removal">
          {(close) => (
            <>
              <p style={{ marginTop: 0, color: theme.color.text.secondary }}>
                Whites-out gridline-colored pixels so auto-tracing (Segment Fill) follows the
                data, not the grid. Pick the grid color, then Remove.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>Grid color:</span>
                <span
                  data-testid="grid-removal-swatch"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    border: `1px solid ${theme.color.border.regular}`,
                    background: gridRemovalColor,
                    flex: '0 0 auto',
                  }}
                />
                <input
                  type="text"
                  data-testid="grid-removal-color"
                  value={gridRemovalColor}
                  onChange={(e) => setGridRemovalColor(e.target.value)}
                  spellCheck={false}
                  style={{ width: 84 }}
                />
                <button
                  type="button"
                  data-testid="grid-removal-eyedropper"
                  onClick={() => {
                    close();
                    setEyedropper('grid');
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                >
                  <EyedropperIcon />
                  Pick from image
                </button>
              </div>
              <p style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>Tolerance:</span>
                <input
                  type="number"
                  data-testid="grid-removal-tolerance"
                  min={1}
                  max={255}
                  value={gridRemovalTolerance}
                  onChange={(e) => setGridRemovalTolerance(Math.max(1, Math.min(255, Number(e.target.value) || 1)))}
                  style={{ width: 60 }}
                />
                <button type="button" data-testid="grid-removal-run" onClick={handleRemoveGridLines}>
                  Remove grid lines
                </button>
              </p>
              {gridRemovalError && (
                <p data-testid="grid-removal-error" style={{ color: theme.color.error }}>
                  {gridRemovalError}
                </p>
              )}
            </>
          )}
        </FloatingPanel>

        {/* Curve Fit + Geometry moved to the LEFT RAIL (v0.8) -- with these two
            here, four analysis panels overflowed the top bar into two lanes at
            standard window width. They are now rail fly-out cards (search
            `curve-fit-trigger` / `geometry-trigger`), consistent with the
            Measure/Image-Edit cards; the top bar keeps only the image-prep
            panels (Grid Removal, Auto-trace by colour). */}
        </TopBarGroup>

        {/* View group (zoom) + Edit group (undo/redo), right-aligned
            (checkpoint 44). Zoom is driven through the ImageCanvas ref; the
            canvas owns the view, this mirrors its live scale. */}
        <TopBarGroup style={{ marginLeft: 'auto' }}>
          <ZoomControls
            scale={canvasScale}
            disabled={!canvasHasImage}
            onZoomIn={() => imageCanvasRef.current?.zoomIn()}
            onZoomOut={() => imageCanvasRef.current?.zoomOut()}
            onZoomFit={() => imageCanvasRef.current?.zoomFit()}
            onZoom100={() => imageCanvasRef.current?.zoom100()}
            onZoomTo={(s) => imageCanvasRef.current?.zoomTo(s)}
          />
        </TopBarGroup>
        <TopBarGroup>
          <IconButton
            testId="undo"
            icon={<UndoIcon />}
            keyTip={keyTips ? keyTipLabel('Z') : undefined}
            label="Undo (Ctrl+Z)"
            disabled={!history.canUndo()}
            onClick={undo}
          />
          <IconButton
            testId="redo"
            icon={<RedoIcon />}
            keyTip={keyTips ? redoKeyTip() : undefined}
            label="Redo (Ctrl+Y or Ctrl+Shift+Z)"
            disabled={!history.canRedo()}
            onClick={redo}
          />
        </TopBarGroup>

        {/* Help dropdown (checkpoint 46): open an example graph (one per type)
            plus the upstream/licence attribution -- which needs a home now the
            native menu (its Help > About) is hidden. */}
        <TopBarGroup>
          <FloatingPanel label="Help" icon={<HelpIcon />} hideLabel testId="help" shortcut="F1">
            {(close) => (
              <>
                <div
                  style={{
                    fontSize: theme.font.size.small,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                    color: theme.color.text.legend,
                    marginBottom: 4,
                  }}
                >
                  Open example
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 220 }}>
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.id}
                      type="button"
                      data-testid={`example-${ex.id}`}
                      onClick={() => {
                        close(); // dismiss the dropdown when an example is chosen
                        void openExample(ex);
                      }}
                      style={{
                        textAlign: 'left',
                        background: 'transparent',
                        border: 'none',
                        padding: '5px 6px',
                        borderRadius: theme.border.radius.regular,
                        cursor: 'pointer',
                        fontSize: theme.font.size.regular,
                        color: theme.color.text.primary,
                      }}
                    >
                      {ex.name}
                    </button>
                  ))}
                </div>
                <div style={{ height: 1, background: theme.color.border.regular, margin: '8px 0' }} />
                <button
                  type="button"
                  data-testid="challenge-start"
                  onClick={() => {
                    close();
                    startChallenge();
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'center',
                    padding: '8px 10px',
                    borderRadius: theme.border.radius.regular,
                    border: `1px solid ${theme.color.primary.main}`,
                    background: theme.color.primary.clicked,
                    color: theme.color.background.primary,
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: theme.font.size.regular,
                  }}
                  title="Race the clock tracing 5 pre-calibrated example figures — scored against their true values"
                >
                  🎯 Take The Trace Challenge
                </button>
                <div style={{ height: 1, background: theme.color.border.regular, margin: '8px 0' }} />
                {/* ⚑ The manual is TOLD, not linked (David). The app must work fully
                    offline, so a link that silently fails on a plane is worse than a
                    sentence that stays true -- and a URL nobody can act on is worse
                    than one they can copy, which the clipboard already gives us with no
                    new IPC. Deliberately not a bundled viewer: this states where the
                    manual is and gets out of the way, which is all that was asked for.
                    ⚠️ Removing the native menu also took its Report Issue and
                    Documentation links, and the renderer still has no openExternal --
                    so this is currently the ONLY route from the app to anything online. */}
                <div
                  data-testid="help-manual"
                  style={{ fontSize: theme.font.size.small, color: theme.color.text.secondary, lineHeight: 1.5, maxWidth: 260 }}
                >
                  More detail — every tool, every export format, the calibration steps —
                  is in the online manual:
                  {/* ⚑ No Copy button, deliberately (David): one on a URL announces
                      that the link does not work, and reads as friction rather than
                      help. The address is selectable text -- anyone who wants it can
                      take it the way they take any other text. */}
                  <div style={{ marginTop: 4 }}>
                    <code style={{ fontSize: theme.font.size.small, wordBreak: 'break-all' }}>
                      {MANUAL_URL}
                    </code>
                  </div>
                </div>
                <div style={{ height: 1, background: theme.color.border.regular, margin: '8px 0' }} />
                <div style={{ fontSize: theme.font.size.small, color: theme.color.text.secondary, lineHeight: 1.5, maxWidth: 260 }}>
                  <strong>PlotTracer</strong> <span data-testid="app-version">v{__APP_VERSION__}</span> — a
                  desktop plot digitizer based on{' '}
                  <strong>WebPlotDigitizer</strong> by Ankit Rohatgi, distributed under
                  AGPL-3.0. Several algorithms are clean-room reimplementations of{' '}
                  <strong>Engauge Digitizer</strong> ideas (GPL-2.0); the icon set derives
                  from <strong>Ketcher</strong> by EPAM Systems (Apache-2.0). Developed by
                  Katalyst Nord AB, Stockholm.
                </div>
              </>
            )}
          </FloatingPanel>
        </TopBarGroup>
      </TopBar>

      <CanvasRegion ref={canvasRegionRef}>
        {/* Foldable calibration card-bar (checkpoint 50), anchored to the TOP of
            the canvas and overlaid on the chart -- most charts keep their plot
            (and the calibration points) in the lower/left region, so the top
            strip is the safe place to cover. Collapsed = a thin chip bar;
            expanded = the full point matrix. Hidden until an image is loaded
            (David): there is nothing to calibrate on the empty "Open an image"
            state, so the card (and the figure jumper) would just be noise. */}
        {canvasHasImage && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 4,
            maxWidth: 'calc(100% - 16px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {/* Figure jumper (checkpoint 110, design §8) — ◀ ▶ flanking the
              calibration card (top-justified), with the "Figure X of Y" counter
              BELOW the card (David). Shown only at ≥2 figures (§0). Jumping to a
              figure lands your eye on its calibration state. */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, maxWidth: '100%' }}>
            {hasMultipleFigures && (
              <button
                type="button"
                data-testid="figure-prev"
                title="Previous figure"
                disabled={activeFigureIndex === 0}
                onClick={() => switchToFigure(activeFigureIndex - 1)}
                style={figureNavButtonStyle}
              >
                ◀
              </button>
            )}
            <div
              data-testid="calibration-bar"
              style={{
                position: 'relative',
                maxWidth: 'calc(100% - 16px)',
                // Frosted glass ONLY once calibration is locked in (axes built) --
                // then it's a status chip floating over the figure. During
                // calibration it's the working surface, so it stays solid so the
                // point matrix reads clearly (David, 2026-07-20).
                ...(axes ? glassSurface : { background: theme.color.background.primary }),
                border: `1px solid ${theme.color.border.regular}`,
                borderRadius: 8,
                boxShadow: '0 2px 8px rgba(103, 104, 132, 0.22)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '5px 10px',
              }}
            >
          {/* Pre-capture, this card is the CAPTURE step, not the calibration
              step. It must not present calibration as available -- doing so was
              an invisible precondition (you're "ready to calibrate" but clicks
              silently capture instead, with no on-screen why), the exact keystone
              fail. So pre-capture it names the precondition, states the WYSIWYG
              capture model, and carries the Capture button itself (David: the
              left rail is a toolbox, not a catch-all -- capture belongs in the
              capture/calibration card). Post-capture it becomes the calibration
              card. The Capture button only ever exists here pre-capture and
              vanishes on capture, so it can never grow the card over a
              calibration click (the ckpt-102 reason it was in the bottom bar). */}
          {!figureCaptured && (
            <div data-testid="capture-prompt" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <strong style={{ fontSize: theme.font.size.regular, whiteSpace: 'nowrap' }}>Capture figure first</strong>
                <span style={{ fontSize: theme.font.size.small, color: theme.color.text.secondary, whiteSpace: 'nowrap' }}>
                  What you see in the window is what you capture.
                </span>
              </div>
              <BottomBarButton
                type="button"
                data-variant="primary"
                data-testid="capture-figure"
                onClick={captureFigure}
                title="Frame the whole figure (plot, axes, tick labels, title) in the window, then capture it as the image you calibrate and trace on"
              >
                <CameraIcon /> Capture figure
              </BottomBarButton>
            </div>
          )}
          {/* Header row: fold toggle, title, status, reset. */}
          {figureCaptured && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              data-testid="calib-fold"
              onClick={() => setCalibExpanded((v) => !v)}
              title={calibExpanded ? 'Fold calibration' : 'Unfold calibration'}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', color: theme.color.icon.active, padding: 2 }}
            >
              <span style={{ display: 'inline-block', transform: calibExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>
                <ChevronDownIcon />
              </span>
            </button>
            <strong style={{ fontSize: theme.font.size.regular, whiteSpace: 'nowrap' }}>Calibration</strong>
            <span
              data-testid="calibrated-status"
              style={{
                marginLeft: 8,
                fontSize: theme.font.size.small,
                whiteSpace: 'nowrap',
                color: axes ? theme.color.primary.main : theme.color.text.legend,
              }}
            >
              {axes ? 'Calibrated ✓' : `${Object.keys(placedPoints).length}/${steps.length} set`}
            </span>
            {!isCalibrating && !axes && (
              <button type="button" data-testid="run-calibration" onClick={runCalibration} style={{ marginLeft: 'auto', fontSize: 12, whiteSpace: 'nowrap' }}>
                Calibrate
              </button>
            )}
            {/* Check calibration (v0.8): toggle the magenta calibrated-axis-box
                overlay. Shown once calibrated on XY-underlying axes -- a visual
                verify ("does the box hug the plot's frame?"), no data touched. */}
            {axes && canCheckCalibration && (
              <button
                type="button"
                data-testid="check-calibration"
                onClick={() => setCheckCalib((v) => !v)}
                aria-pressed={checkCalib}
                title="Draw the calibrated axis box on the image — it should line up with the plot's own axes. Toggle off to hide."
                style={{
                  marginLeft: 'auto',
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  border: `1px solid ${checkCalib ? theme.color.primary.main : theme.color.border.regular}`,
                  borderRadius: theme.border.radius.regular,
                  background: checkCalib ? theme.color.primary.main : theme.color.background.primary,
                  color: checkCalib ? '#fff' : theme.color.text.primary,
                  cursor: 'pointer',
                  padding: '2px 8px',
                }}
              >
                Check calibration
              </button>
            )}
            <button
              type="button"
              data-testid="reset-calibration"
              onClick={reset}
              style={{ marginLeft: axes && canCheckCalibration ? 6 : !isCalibrating && !axes ? 6 : 'auto', fontSize: 12, whiteSpace: 'nowrap' }}
            >
              Reset calibration
            </button>
          </div>
          )}
          {/* Point matrix: laid out as a grid with 2 columns, so an XY graph
              reads as one row per axis (X1 X2 / Y1 Y2). Values are entered right
              here in the card, not the right panel -- the active point (after
              its pixel is clicked) shows an inline input. */}
          {figureCaptured && calibExpanded && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, auto)', gap: '5px 16px' }}>
              {steps.map((step, i) => {
                const placed = placedPoints[step.key];
                const active = !axes && i === session.getStepIndex();
                const editing = active && !!pendingPixel && step.valueFields.length > 0;
                return (
                  <div key={step.key} data-testid={`calib-chip-${step.key}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span
                      style={{
                        minWidth: 22,
                        textAlign: 'center',
                        padding: '1px 7px',
                        borderRadius: 9,
                        border: `1.5px solid ${step.color}`,
                        background: placed ? step.color : 'transparent',
                        color: placed ? '#fff' : theme.color.text.secondary,
                        fontWeight: active ? 700 : 600,
                        boxShadow: active ? `0 0 0 2px ${theme.color.primary.main}` : 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {step.label}
                    </span>
                    {step.valueFields.length === 0 ? (
                      <span style={{ color: theme.color.text.legend }}>{placed ? 'placed' : active ? 'click image' : '—'}</span>
                    ) : editing ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {pendingValueFields.map((vf, vi) => (
                          <input
                            key={vf.key}
                            data-testid={vi === 0 ? 'data-value-input' : `data-value-input-${vi}`}
                            value={dataValueInputs[vi] ?? ''}
                            onChange={(e) => setDataValueInputAt(vi, e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && confirmDataValue()}
                            autoFocus={vi === 0}
                            placeholder={vf.label}
                            style={{ width: 46 }}
                          />
                        ))}
                        <button type="button" data-testid="confirm-data-value" onClick={confirmDataValue} style={{ fontSize: 11, padding: '0 5px' }}>
                          ✓
                        </button>
                      </span>
                    ) : placed ? (
                      <span style={{ fontWeight: 600 }}>{placed.values.join(', ')}</span>
                    ) : (
                      <span style={{ color: theme.color.text.legend }}>{active ? 'click image' : '—'}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Add/remove an axis (v1.4, Spider) -- the control that makes a
              variable-length calibration usable.

              ⚑ VISIBLE FROM THE START, not revealed once the last axis is placed.
              A spider has as many axes as its author drew, and the user is the only
              one who can say how many; an affordance that appears only after you
              finish the third axis is an invisible precondition -- you would have to
              already know it exists to wait for it. The count and the floor are
              stated in words for the same reason, so nothing about the shape has to
              be inferred from whether a button happens to be greyed. */}
          {figureCaptured && calibExpanded && repeatingStep && !axes && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <button
                type="button"
                data-testid="add-repeat-step"
                onClick={() => {
                  if (session.addRepeat()) commit();
                }}
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
              >
                + Add {repeatingStep.noun}
              </button>
              <button
                type="button"
                data-testid="remove-repeat-step"
                disabled={session.getRepeatCount() <= repeatingStep.min}
                title={
                  session.getRepeatCount() <= repeatingStep.min
                    ? `A spider chart needs at least ${repeatingStep.min} axes.`
                    : `Remove the last ${repeatingStep.noun}, and anything placed for it.`
                }
                onClick={() => {
                  if (session.removeRepeat()) commit();
                }}
                style={{ fontSize: 12, whiteSpace: 'nowrap' }}
              >
                − Remove {repeatingStep.noun}
              </button>
              <span data-testid="repeat-count" style={{ color: theme.color.text.legend }}>
                {session.getRepeatCount()} axes — add one for every axis the chart draws
              </span>
            </div>
          )}
          {figureCaptured && calibExpanded && config.supportsCommonOrigin && !axes && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.color.text.secondary, cursor: 'pointer' }}>
              <input
                type="checkbox"
                data-testid="common-origin"
                checked={commonOrigin}
                onChange={(e) => setCommonOrigin(e.target.checked)}
              />
              Common origin — X1 &amp; Y1 are the same point
            </label>
          )}
          {/* Per-axes calibration options (checkpoint 68) — log scales,
              orientations, units. WPD has always offered these; we hardcoded
              them to literals across 6 of 7 axes types, which the parity
              re-audit ranked its biggest finding (log axes, table stakes for
              scientific figures, were unreachable).

              ⚑ POST-CALIBRATION GATE REMOVED (checkpoint 86). This block used to
              carry `!axes`, so once you calibrated the options VANISHED — notice
              Y is log after tracing 200 points and the only way to say so was a
              destructive Reset that discards every point (a tenet-1 violation:
              the workflow trapped you). The engine always handled it
              (session.setOption re-calibrates live when `this.axes` exists); only
              the UI hid the control. Now it renders whenever the card is
              expanded, and the card AUTO-FOLDS on calibrate (see runCalibration),
              so the footprint stays a thin chip by default and the tall state is
              opt-in — which is what keeps this from bringing back ckpt 68's
              real, e2e-caught problem: options row makes the card taller, taller
              card covers where you click on the figure. Same reasoning applies
              to Common origin above, which stays `!axes` deliberately: it is
              about the click WALK (X1 and Y1 share a pixel), which only happens
              while placing calibration points, so post-calibration it has
              nothing to do. */}
          {figureCaptured && calibExpanded && (config.options?.length ?? 0) > 0 && (
            <div
              data-testid="axes-options"
              style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 12, color: theme.color.text.secondary }}
            >
              {config.options!.map((opt) =>
                opt.kind === 'checkbox' ? (
                  <label key={opt.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      data-testid={`calib-option-${opt.key}`}
                      checked={axesOptions[opt.key] === 'true'}
                      onChange={(e) => setAxesOption(opt.key, String(e.target.checked))}
                    />
                    {opt.label}
                  </label>
                ) : opt.kind === 'choice' ? (
                  <label key={opt.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {opt.label}
                    <select
                      data-testid={`calib-option-${opt.key}`}
                      value={axesOptions[opt.key] ?? opt.default}
                      onChange={(e) => setAxesOption(opt.key, e.target.value)}
                      style={{ fontSize: 12 }}
                    >
                      {opt.choices.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label key={opt.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {opt.label}
                    <input
                      type="text"
                      data-testid={`calib-option-${opt.key}`}
                      value={axesOptions[opt.key] ?? ''}
                      placeholder={opt.placeholder}
                      onChange={(e) => setAxesOption(opt.key, e.target.value)}
                      style={{ fontSize: 12, width: 70 }}
                    />
                  </label>
                )
              )}
            </div>
          )}
          {/* Global calibration fields (e.g. Circular Chart Recorder's "Chart
              Start Time") live on the card now (checkpoint 59b), not the data-only
              right panel -- they're calibration inputs. Also reachable
              post-calibration now (checkpoint 86): the `!axes` gate is gone for
              the same reason as the options above, and setGlobalFieldValue grew
              the matching live-re-calibrate branch (it was the one that "looked
              unintentional" beside setOption). `!isCalibrating` stays: while you
              are still clicking calibration points, the field belongs in the step
              flow, not floating alongside it. */}
          {figureCaptured && calibExpanded && !isCalibrating && config.globalFields.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12, color: theme.color.text.secondary }}>
              {config.globalFields.map((gf) => (
                <label key={gf.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {gf.label}:
                  <input
                    data-testid={`global-field-${gf.key}`}
                    value={globalFieldValues[gf.key] ?? ''}
                    onChange={(e) => setGlobalField(gf.key, e.target.value)}
                    onBlur={commitPendingEdit}
                    style={{ width: 130 }}
                  />
                </label>
              ))}
            </div>
          )}
            </div>
            {hasMultipleFigures && (
              <button
                type="button"
                data-testid="figure-next"
                title="Next figure"
                disabled={activeFigureIndex === figures.length - 1}
                onClick={() => switchToFigure(activeFigureIndex + 1)}
                style={figureNavButtonStyle}
              >
                ▶
              </button>
            )}
          </div>
          {hasMultipleFigures && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div
                  data-testid="figure-jumper-status"
                  style={{
                    fontSize: 11,
                    color: theme.color.text.secondary,
                    background: theme.color.background.primary,
                    border: `1px solid ${theme.color.border.regular}`,
                    borderRadius: 6,
                    padding: '1px 8px',
                    boxShadow: '0 1px 4px rgba(103, 104, 132, 0.18)',
                  }}
                >
                  Figure {activeFigureIndex + 1} of {figures.length}
                </div>
                {/* Name this figure (checkpoint 113, §5a) -- its address in the
                    jumper and (later) the default export filename. Pre-filled with
                    the auto-name "Figure N" until you give it a real one; the name
                    is unique among the figures (seriesNames.ts rules). This is also
                    what makes the counter above non-redundant (David's #5): the
                    name lives in its own editable field, not repeated in the
                    counter. */}
                <input
                  type="text"
                  data-testid="figure-name"
                  value={figureNameDraft ?? activeFigure?.name ?? ''}
                  onChange={(e) => handleFigureRenameDraft(e.target.value)}
                  onBlur={(e) => handleCommitFigureRename(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  title="Name this figure"
                  style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    width: 150,
                    border: `1px solid ${figureNameNotice ? theme.color.error : theme.color.border.regular}`,
                    borderRadius: 6,
                    background: theme.color.background.primary,
                    color: theme.color.text.primary,
                  }}
                />
                {/* Remove this figure (checkpoint 112) -- also how you back out of
                    "Extract another graph": remove the fresh figure it made. */}
                <button
                  type="button"
                  data-testid="figure-remove"
                  title="Remove this figure"
                  onClick={removeActiveFigure}
                  style={{
                    fontSize: 11,
                    lineHeight: 1,
                    cursor: 'pointer',
                    color: theme.color.text.secondary,
                    background: theme.color.background.primary,
                    border: `1px solid ${theme.color.border.regular}`,
                    borderRadius: 6,
                    padding: '2px 7px',
                    boxShadow: '0 1px 4px rgba(103, 104, 132, 0.18)',
                  }}
                >
                  ✕ Remove
                </button>
              </div>
              {figureNameNotice && (
                <div
                  data-testid="figure-name-notice"
                  style={{ fontSize: 10, color: theme.color.error, maxWidth: 340, textAlign: 'center' }}
                >
                  {figureNameNotice}
                </div>
              )}
            </div>
          )}
        </div>
        )}
        {/* One floating rail card (checkpoint 47), overlaid on the canvas
            (checkpoint 48b) and vertically centered -- sized to its content, so
            the point actions join it (below a divider) once calibrated. */}
        <LeftRail>
          {/* A horizontal row so the Measure card (checkpoint: measure) can fold
              out to the RIGHT of the rail, anchored to the ruler button, without
              displacing the rail. pointerEvents:none passes gaps through; the
              rail card and the Measure card each re-enable it themselves. */}
          <div ref={railRowRef} style={{ position: 'relative', display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 8, pointerEvents: 'none' }}>
          {/* Rail redesign (David 2026-07-22, Ketcher-style separated cards):
              each functional band is its own bordered card, spaced 6px, and the
              hotkeys run 0-9 straight down so position = number. Cards:
              [view + set up] · [get + refine points] · [analyze]. Clear-all moved
              to the top bar; per-point delete is the Eraser (unnumbered: it's
              destructive and Del already does it, so it stays out of the 0-9 run).
              Each tool greys until it can do its job (a toolbox, not a catch-all). */}
          <div ref={railColRef} style={{ display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none' }}>
          {/* View & set up: Pan · Calibrate · Edit image. Image prep is available
              BEFORE capture too (rotate a sideways scan, crop, fine-deskew) and
              THEN capture; enabled whenever there's an image. */}
          <RailGroup data-testid="tool-rail">
          <IconButton
            testId="mode-pan"
            icon={<HandIcon />}
            label="Pan"
            shortcut="0"
            pressed={mode === 'pan'}
            onClick={() => setMode('pan')}
          />
          <IconButton
            testId="mode-calibrate"
            icon={<CalibrateIcon />}
            label="Calibrate"
            shortcut="1"
            pressed={mode === 'calibrate'}
            disabled={!figureCaptured}
            disabledReason={canvasHasImage ? 'Capture the figure first' : 'Open an image first'}
            onClick={() => setMode('calibrate')}
          />
          <IconButton
            testId="mode-image-edit"
            icon={<ImageEditIcon />}
            label="Edit image (rotate / flip)"
            shortcut="2"
            pressed={mode === 'image-edit'}
            disabled={!canvasHasImage}
            disabledReason="Open an image first"
            onClick={toggleImageEdit}
            foldout
          />
          </RailGroup>
          {/* Get data points onto the plot, then refine them: Add + Auto-extract
              are the two ways to GET points; Select + Eraser refine them; Error
              bars attach uncertainty. */}
          <RailGroup>
          <IconButton
            testId="mode-place-point"
            icon={<PlusIcon />}
            label="Add points"
            shortcut="3"
            pressed={mode === 'place-point'}
            disabled={!axes}
            disabledReason="Calibrate the axes first"
            onClick={() => setMode('place-point')}
          />
          <IconButton
            testId="mode-auto-extract"
            icon={<AutoTraceIcon />}
            label="Auto-extract (flood-fill / by colour / guide points)"
            shortcut="4"
            pressed={AUTO_EXTRACT_MODES.includes(mode)}
            // ⚑ Bar-family types are excluded, and this is a CORRECTNESS gate, not a
            // missing feature. Every auto-extract mechanism here is a CURVE tool:
            // pointsFromColumnRuns records the MIDDLE of each column run and the blob
            // detector records a region's centroid. On a curve that is the curve. On a
            // filled bar it is the bar's midpoint -- so a bar of true value 10 was
            // silently recorded as 5 (verified against the algorithms, 2026-07-25).
            // Point-group types (Box Plot / Histogram) were already excluded; plain Bar
            // and Line (categorical X) were not, which left a reachable path to
            // confidently wrong numbers -- the tenet-1 defect, worse than the tool
            // simply being absent. A bar-aware capture is a model change, not a new
            // shape on the colour trace: see the bar design pass.
            // ⚑ Spider is the one slot type auto-extract IS offered for, and
            // the exception is a correctness one too: its slots ARE the axes the
            // trace searches, so every reading has a home the tool measured it
            // against. The Box Plot / Error Bar refusal stands -- a Min/Q1/Median
            // slot is not something a colour trace can identify.
            disabled={!axes || (config.autoExtractKind ?? 'curve') === 'none'}
            disabledReason={
              !axes
                ? 'Calibrate the axes first'
                : config.axesKind === 'bar'
                ? 'Auto-extract follows curves — on bars it would record the middle of each bar, not its end. Place points on the bar ends instead.'
                : 'Not available for this graph type'
            }
            onClick={toggleAutoExtract}
            foldout
          />
          {/* Select multi-tool (v1.1 #6, Ketcher): the rail face shows the active
              sub-mode's icon; clicking enters Select and opens the picker (a
              second click toggles it). Picking a mode in the card folds it in and
              swaps this icon. */}
          {(() => {
            const active = SELECT_MODES.find((m) => m.id === selectSubMode) ?? SELECT_MODES[0]!;
            const ActiveIcon = active.icon;
            return (
              <IconButton
                testId="mode-select"
                icon={<ActiveIcon />}
                label={`Select — ${active.label}: ${active.hint}. Click for more modes; Del removes, arrows nudge.`}
                shortcut="5"
                pressed={mode === 'select'}
                disabled={!axes}
                disabledReason="Calibrate the axes first"
                foldout
                onClick={() => {
                  // Ketcher's two-stage face: a first click ACTIVATES the current
                  // sub-mode (no card, so you can box-drag straight away); clicking
                  // the button again while already in Select opens the picker to
                  // switch modes. The corner arrow advertises that second step.
                  if (mode !== 'select') {
                    setMode('select');
                    setSelectFoldoutOpen(false);
                  } else {
                    setSelectFoldoutOpen((open) => !open);
                  }
                }}
              />
            );
          })()}
          {/* Error bars are a PROPERTY of a point (ckpt 79, David) -- greyed
              until a series has data to attach to. */}
          <IconButton
            testId="mode-error-bars"
            icon={<ErrorBarsIcon />}
            label="Error bars (add to a traced series)"
            shortcut="6"
            pressed={mode === 'error-bars'}
            disabled={!datasetInfos.some((d) => d.pointCount > 0)}
            disabledReason="Add data points first"
            onClick={toggleErrorBars}
            foldout
          />
          {/* Eraser (David 2026-07-22): a discoverable click-to-remove-a-point
              tool. UNNUMBERED -- it's destructive and Del already removes the
              selected point, so it stays out of the 0-9 run and reads apart. */}
          <IconButton
            testId="mode-eraser"
            icon={<EraseIcon />}
            label="Erase a point — click a point to remove it"
            pressed={mode === 'eraser'}
            disabled={dataPoints.length === 0}
            disabledReason="Add data points first"
            onClick={() => setMode('eraser')}
          />
          </RailGroup>
          {/* Analyze (downstream / derived -- Tenet 9): Measure + the Curve Fit /
              Geometry fly-outs (8, 9). */}
          <RailGroup>
          <IconButton
            testId="mode-measure"
            icon={<MeasureIcon />}
            label="Measure"
            shortcut="7"
            pressed={mode === 'measure'}
            disabled={!figureCaptured}
            disabledReason={canvasHasImage ? 'Capture the figure first' : 'Open an image first'}
            onClick={toggleMeasure}
            foldout
          />
          {curveFitFlyout}
          {geometryFlyout}
          </RailGroup>
          </div>
          {/* All fold-out cards live in ONE absolutely-positioned wrapper (v1.1
              step 1), anchored beside the rail and vertically CENTRED on their
              trigger button (positionCard). Absolute so a tall card never grows
              the row and fights LeftRail's centring. Only one renders at a time. */}
          <div ref={cardWrapRef} style={{ position: 'absolute', top: cardPos.top, left: cardPos.left, pointerEvents: 'none' }}>
          {/* Select fold-out picker (v1.1 #6, Ketcher): a COMPACT horizontal strip
              of the four sub-modes -- icon-only with a tooltip each (David: match
              Ketcher's strip, not a big labelled card). Picking one folds the strip
              in and swaps the rail icon. Opened by clicking the already-active
              Select button (its corner arrow advertises this). */}
          {mode === 'select' && selectFoldoutOpen && (
            <div
              data-testid="select-foldout-card"
              style={{
                ...glassSurface,
                border: `1px solid ${theme.color.border.regular}`,
                borderRadius: 8,
                boxShadow: '0 2px 8px rgba(103, 104, 132, 0.22)',
                padding: 4,
                display: 'flex',
                flexDirection: 'row',
                gap: 4,
                pointerEvents: 'auto',
              }}
            >
              {SELECT_MODES.map(({ id, label, hint, icon: ModeIcon }) => {
                const on = selectSubMode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    data-testid={`select-mode-${id}`}
                    aria-pressed={on}
                    title={`${label} — ${hint}`}
                    onClick={() => {
                      setSelectSubMode(id);
                      setSelectFoldoutOpen(false);
                    }}
                    style={{
                      width: 34,
                      height: 34,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: theme.border.radius.regular,
                      cursor: 'pointer',
                      border: `1px solid ${on ? theme.color.primary.main : theme.color.border.regular}`,
                      background: on ? theme.color.primary.clicked : theme.color.background.primary,
                      color: on ? theme.color.background.primary : theme.color.icon.active,
                    }}
                  >
                    <ModeIcon />
                  </button>
                );
              })}
            </div>
          )}
          {/* Auto-extract umbrella card (v0.8, David) -- one wand tool fronting
              the three tracing mechanisms. The selector switches MODE (each keeps
              its own canvas behaviour) and shows that mechanism's controls, which
              used to live in three places (sidebar / top-bar panel / tips). */}
          {AUTO_EXTRACT_MODES.includes(mode) && (
            <div
              data-testid="auto-extract-card"
              style={{
                // The card floats over the figure but must NOT swallow canvas
                // clicks meant to place points UNDER it (Guide points / Flood-fill
                // work by clicking the curve; the region marquee drags on the
                // image). So the container is click-THROUGH and only its actual
                // controls (below) re-enable pointer events. Fixes "I clicked to
                // place a point and nothing happened" in the card's footprint.
                pointerEvents: 'none',
                // Frosted glass: floats over the immutable figure (glassSurface).
                ...glassSurface,
                border: `1px solid ${theme.color.border.regular}`,
                borderRadius: 8,
                boxShadow: '0 2px 8px rgba(103, 104, 132, 0.22)',
                padding: '8px 10px',
                width: 288,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                fontSize: theme.font.size.regular,
              }}
            >
              <strong style={{ fontSize: theme.font.size.regular }}>Auto-extract</strong>
              {/* Mechanism selector: pick the one that fits how the curve is
                  drawn (not the graph type -- the app can't tell solid from
                  dashed). */}
              <div style={{ display: 'flex', gap: 4 }}>
                {([
                  { m: 'segment-fill' as ToolMode, id: 'flood', label: 'Flood-fill', hint: 'solid line' },
                  { m: 'color-trace' as ToolMode, id: 'colour', label: 'By colour', hint: 'dashed / coloured' },
                  { m: 'interpolate' as ToolMode, id: 'guide', label: 'Guide points', hint: 'by eye' },
                ])
                  // ⚑ A spider gets ONE mechanism. The other two are curve tools that
                  // produce ordinary points, and a spider series has no slot for one:
                  // they would have run and recorded nothing, which reads as a broken
                  // button rather than as a tool that does not apply here.
                  .filter(({ m }) => config.autoExtractKind !== 'along-axes' || m === 'color-trace')
                  .map(({ m, id, label }) => (
                  <button
                    key={id}
                    type="button"
                    data-testid={`auto-extract-${id}`}
                    aria-pressed={mode === m}
                    onClick={() => setAutoExtractMech(m)}
                    style={{
                      pointerEvents: 'auto', // container is click-through; controls opt back in
                      flex: 1,
                      fontSize: theme.font.size.small,
                      padding: '4px 2px',
                      borderRadius: theme.border.radius.regular,
                      cursor: 'pointer',
                      border: `1px solid ${mode === m ? theme.color.primary.main : theme.color.border.regular}`,
                      background: mode === m ? theme.color.primary.main : theme.color.background.primary,
                      color: mode === m ? '#fff' : theme.color.text.primary,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {mode === 'segment-fill' && (
                <div data-testid="segment-fill-controls" style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 6, color: theme.color.text.secondary }}>
                  <span>Click a solid, unbroken curve to flood-fill along it.</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Colour distance threshold:
                    <input
                      type="number"
                      data-testid="segment-fill-threshold"
                      min={1}
                      max={255}
                      value={segmentFillThreshold}
                      onChange={(e) => setSegmentFillThreshold(Math.max(1, Math.min(255, Number(e.target.value) || 1)))}
                      style={{ width: 60 }}
                    />
                  </label>
                  {segmentFillError && (
                    <span data-testid="segment-fill-error" style={{ color: theme.color.error }}>{segmentFillError}</span>
                  )}
                </div>
              )}

              {mode === 'color-trace' && (
                <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 6, color: theme.color.text.secondary }}>
                  <span>
                    {config.autoExtractKind === 'along-axes' ? (
                      <>
                        Walks each calibrated axis outward and records the value where the
                        series&rsquo; colour crosses it — one reading per axis. A ray the colour
                        crosses more than once is left EMPTY for you to place, and named below.
                        The highlighted pixels show what the trace reads.
                      </>
                    ) : (
                      <>
                        Selects every pixel of a series&rsquo; colour — a dashed or marker-only line
                        extracts in one pass. Pick the colour, choose curve or scattered points, then Trace.
                        The highlighted pixels show what the trace reads.
                      </>
                    )}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>Colour:</span>
                    <span
                      data-testid="color-trace-swatch"
                      style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${theme.color.border.regular}`, background: colorTraceColor, flex: '0 0 auto' }}
                    />
                    <input
                      type="text"
                      data-testid="color-trace-color"
                      value={colorTraceColor}
                      onChange={(e) => setColorTraceColor(e.target.value)}
                      spellCheck={false}
                      style={{ width: 84 }}
                    />
                    <button
                      type="button"
                      data-testid="color-trace-eyedropper"
                      onClick={() => setEyedropper('trace')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <EyedropperIcon />
                      Pick from image
                    </button>
                  </div>
                  {/* No shape to choose on a spider: the rays decide where to read, so
                      curve-vs-scatter has nothing to select between. */}
                  <div style={{ display: config.autoExtractKind === 'along-axes' ? 'none' : 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>Shape:</span>
                    <select
                      data-testid="color-trace-shape"
                      value={colorTraceShape}
                      onChange={(e) => setColorTraceShape(e.target.value as 'curve' | 'scatter')}
                    >
                      <option value="curve">Curve (line)</option>
                      <option value="scatter">Scattered points</option>
                    </select>
                    {colorTraceShape === 'scatter' && (
                      <>
                        <span>Min marker &empty;:</span>
                        <input
                          type="number"
                          data-testid="color-trace-min-blob"
                          min={0}
                          max={200}
                          value={colorTraceMinBlob}
                          onChange={(e) => setColorTraceMinBlob(Math.max(0, Math.min(200, Number(e.target.value) || 0)))}
                          style={{ width: 52 }}
                        />
                        <span>px</span>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>Tolerance:</span>
                    <input
                      type="number"
                      data-testid="color-trace-tolerance"
                      min={1}
                      max={255}
                      value={colorTraceTolerance}
                      onChange={(e) => setColorTraceTolerance(Math.max(1, Math.min(255, Number(e.target.value) || 1)))}
                      style={{ width: 60 }}
                    />
                    <button
                      type="button"
                      data-testid="color-trace-run"
                      onClick={handleColorTrace}
                      style={{
                        background: theme.color.primary.main,
                        color: '#fff',
                        border: `1px solid ${theme.color.primary.main}`,
                        borderRadius: theme.border.radius.regular,
                        padding: '3px 16px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Trace
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* B1 — restrict the trace to a rectangle drawn DIRECTLY on the
                        image (v1.2). No arm-first toggle: the hint tells the user
                        the gesture exists (so it's discoverable, not tribal), and
                        the ✕ clears it back to the whole image. */}
                    {colorTraceRegion ? (
                      <button
                        type="button"
                        data-testid="color-trace-region-clear"
                        onClick={() => setColorTraceRegion(null)}
                        title="Clear the region — trace the whole image again"
                      >
                        Region {Math.round(colorTraceRegion.width)}×{Math.round(colorTraceRegion.height)} px ✕
                      </button>
                    ) : (
                      <span
                        data-testid="color-trace-region-hint"
                        style={{ fontSize: theme.font.size.small, color: theme.color.text.legend }}
                        title="Limit the trace to a box you draw (e.g. the plot area), so a same-coloured legend swatch outside it is ignored"
                      >
                        Drag a box on the image to restrict the trace
                      </span>
                    )}
                  </div>
                  {colorTraceMask && (
                    <span data-testid="color-trace-preview" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 2, background: `rgb(${COLOR_TRACE_PREVIEW_RGBA[0]}, ${COLOR_TRACE_PREVIEW_RGBA[1]}, ${COLOR_TRACE_PREVIEW_RGBA[2]})`, flex: '0 0 auto' }} />
                      {colorTraceMask.count === 0
                        ? 'No pixels match — repick the colour or raise the tolerance.'
                        : `${colorTraceMask.count.toLocaleString()} px highlighted (${colorTraceMask.pct.toFixed(1)}% of the image)${colorTraceMask.pct > 25 ? ' — a lot; if it grabbed the grid/axes, lower the tolerance or run Grid Removal first.' : '.'}`}
                    </span>
                  )}
                  {colorTraceInfo && (
                    <span data-testid="color-trace-info">{colorTraceInfo}</span>
                  )}
                </div>
              )}

              {mode === 'interpolate' && (
                <div style={{ color: theme.color.text.secondary }}>
                  Click a few guide points along one curve; the curve fills in between them. Q/W step between anchors, arrow keys nudge the selected one.
                </div>
              )}
            </div>
          )}
          {/* The Measure card folds out to the right of the rail while the ruler
              tool is active. Docked (not free-floating); gone when inactive.
              Measurements list is empty until canvas measuring is wired. */}
          {mode === 'measure' && (
            <MeasureCard
              activeTool={measureTool}
              onSelectTool={selectMeasureTool}
              onStartSetScale={startSetScale}
              setScaleDraft={setScaleDraft}
              areaPointCount={measureTool === 'area' ? pendingMeasure.length : 0}
              onFinishArea={finishArea}
              onCancelArea={cancelArea}
            />
          )}
          {mode === 'image-edit' && (
            <ImageEditCard
              onEdit={applyImageEdit}
              disabled={!canvasHasImage}
              onStartCrop={startCrop}
              cropArmed={cropMode}
              cropPending={cropRect ? { width: cropRect.width, height: cropRect.height } : null}
              onApplyCrop={applyCrop}
              onCancelCrop={cancelCrop}
              angle={previewAngle}
              onAngleChange={setPreviewAngle}
              onApplyAngle={applyDeskew}
              onRequestAutoAngle={autoStraightenAngle}
              // While drawing the crop rectangle (armed, none drawn yet), let the
              // drag start anywhere by passing pointer events through the card
              // (v1.0 audit: a crop couldn't start under a fold-out card). Once a
              // rectangle exists, the card is interactive again for Apply/Cancel;
              // Esc cancels during the draw (global key).
              interactive={!(cropMode && !cropRect)}
            />
          )}
          {mode === 'error-bars' && (
            <ErrorBarsCard
              targets={datasetInfos.map((d) => ({ index: d.index, name: d.name }))}
              targetIndex={errorTargetIndex}
              onTargetChange={(i) => {
                setErrorTargetIndex(i);
                setErrorNotice(null);
              }}
              baseName={errorBaseName}
              onBaseNameChange={(n) => {
                setErrorBaseName(n);
                setErrorNotice(null);
              }}
              existing={errorSeriesRows}
              onSelectSeries={handleSelectDataset}
              notice={errorNotice}
              calibrated={axes !== null}
              targetHasPoints={(datasetInfos.find((d) => d.index === errorTargetIndex)?.pointCount ?? 0) > 0}
            />
          )}
          </div>
        </div>
        </LeftRail>
        <ImageCanvas
          ref={imageCanvasRef}
          points={markers}
          seriesLines={seriesLines}
          calibrationPreview={calibPreview}
          boxPlotGlyphs={boxPlotGlyphs}
          binGlyphs={binGlyphs}
          errorBarGlyphs={errorWhiskers}
          curveFitLine={curveFitOverlay}
          onCurveFitClick={curveFitState && (mode === 'pan' || mode === 'select') ? openCurveFitPanel : undefined}
          geometryOverlay={geometryOverlay}
          challengeReveal={challengeReveal}
          calibrationCheckBox={calibrationCheckOverlay}
          measureOverlays={measureOverlays}
          onMeasureVertexClick={mode === 'measure' ? handleMeasureVertexClick : undefined}
          selectedMeasureVertex={activeMeasure}
          maskOverlay={eyedropper ? null : (colorTraceMask?.canvas ?? null)}
          onImageClick={handleImageClick}
          onMarkerDragEnd={handleMarkerDragEnd}
          onMarkerClick={handleMarkerClick}
          leftButtonPans={mode === 'pan' && eyedropper === null}
          onPointContextMenu={handlePointContextMenu}
          onMeasureContextMenu={handleMeasureContextMenu}
          onCanvasContextMenu={handleCanvasContextMenu}
          linkSnap={mode === 'error-bars' ? errorLinkSnap : null}
          onLinkDragMove={handleLinkDragMove}
          onLinkDrag={handleLinkDrag}
          onLinkDragCancel={handleLinkDragCancel}
          cropMode={cropMode}
          onCropRect={(r) => setCropRect(r)}
          cropRect={cropRect}
          // Direct marquee (v1.2): the region drag is live whenever By-colour is
          // active, EXCEPT while the eyedropper is armed (that click samples a
          // colour). A bare click in this mode is already a no-op (see
          // handleImageClick), so an always-live drag clobbers nothing.
          regionMode={mode === 'color-trace' && eyedropper === null}
          onRegionRect={(r) => {
            // Ignore a click / tiny drag (a zero-area region would match nothing).
            if (r.width < 3 || r.height < 3) return;
            setColorTraceRegion(r);
          }}
          regionRect={mode === 'color-trace' ? colorTraceRegion : null}
          selectMode={mode === 'select' ? selectSubMode : null}
          onSelectRect={(r) => {
            // A tiny drag is a click, not a marquee -- handleImageClick already
            // cleared the selection for that, so ignore a zero-area box here.
            if (r.width < 3 && r.height < 3) return;
            handleSelectRect(r);
          }}
          onSelectLasso={handleSelectLasso}
          previewRotationDeg={previewAngle}
          onStatusChange={handleCanvasStatus}
          beforeOpenImage={confirmDiscardIfDirty}
          onImageOpened={handleImageOpened}
          onPdfBytes={openPdf}
          crosshairCursor={mode !== 'pan' || eyedropper !== null}
          avoidRect={avoidRect}
          loupeHideRect={cardRect}
        />
        {/* Canvas right-click quick menu (mouse model). Anchored at the click via
            anchorPosition; closes on outside-click / Escape (MUI's own onClose).
            Every item surfaces an already-existing capability -- no interpretation
            is added here (tenet 9). */}
        <Menu
          open={ctxMenu !== null}
          onClose={() => setCtxMenu(null)}
          anchorReference="anchorPosition"
          anchorPosition={ctxMenu ? { top: ctxMenu.y, left: ctxMenu.x } : undefined}
          // "Edit value…" opens an autofocused input in the sidebar. MUI's focus
          // management (auto-focus, enforce-focus trap, and restore-on-close) all
          // fight that input -- blurring it, whose onBlur commits and exits edit
          // mode before you can type. Make the menu focus-passive: it's mouse-
          // driven (Escape still closes it via onClose), so it needs none of them.
          disableAutoFocus
          disableEnforceFocus
          disableRestoreFocus
          data-testid="canvas-context-menu"
        >
          {ctxMenu?.kind === 'point' && [
            <MenuItem
              key="active"
              data-testid="ctx-set-active"
              onClick={() => {
                setActivePointIndex(ctxMenu.index);
                setPickedPointIndex(ctxMenu.index);
                setCtxMenu(null);
              }}
            >
              Set as active
            </MenuItem>,
            // Belt-and-braces for a spline-derived sample. Today it can't even get
            // here -- a derived marker is non-draggable, so ImageCanvas keeps it out
            // of the hit graph (`listening={point.draggable}`) and the right-click
            // falls through to the empty-canvas menu. The guard states the rule where
            // the menu is built, so re-enabling those markers (to make them
            // selectable, say) can't quietly restore an Edit value that no longer
            // renders an editor. Anchors keep the action -- moving one IS the edit.
            ...(config.axesKind === 'xy' && dataPointRoles[ctxMenu.index] !== 'interpolated'
              ? [
                  <MenuItem
                    key="edit"
                    data-testid="ctx-edit-value"
                    onClick={() => {
                      const p = session.getDataPoints()[ctxMenu.index];
                      setActivePointIndex(ctxMenu.index);
                      if (p?.data) setEditingCell({ index: ctxMenu.index, axis: 0, value: p.data[0]!.toFixed(3) });
                      setCtxMenu(null);
                    }}
                  >
                    Edit value…
                  </MenuItem>,
                ]
              : []),
            <MenuItem
              key="delete"
              data-testid="ctx-delete-point"
              onClick={() => {
                removeDataPointByIndex(ctxMenu.index);
                setCtxMenu(null);
              }}
            >
              {hasSlots && config.tupleMembers !== 'independent' ? `Delete ${tupleNoun}` : 'Delete point'}
            </MenuItem>,
            ...(datasetInfos.length > 1
              ? [
                  <Divider key="div" />,
                  <MenuItem
                    key="delseries"
                    data-testid="ctx-delete-series"
                    onClick={() => {
                      handleRemoveDataset(activeDatasetIndex);
                      setCtxMenu(null);
                    }}
                  >
                    Delete series “{datasetInfos.find((d) => d.index === activeDatasetIndex)?.name ?? ''}”
                  </MenuItem>,
                ]
              : []),
          ]}
          {ctxMenu?.kind === 'measure' && (
            <MenuItem
              data-testid="ctx-delete-measurement"
              onClick={() => {
                applyMeasurements(measurementsRef.current.filter((m) => m.id !== ctxMenu.id));
                if (activeMeasure?.id === ctxMenu.id) setActiveMeasure(null);
                commit();
                setCtxMenu(null);
              }}
            >
              Delete measurement
            </MenuItem>
          )}
          {ctxMenu?.kind === 'empty' && [
            <MenuItem
              key="fit"
              data-testid="ctx-fit-view"
              onClick={() => {
                imageCanvasRef.current?.zoomFit();
                setCtxMenu(null);
              }}
            >
              Fit to view
            </MenuItem>,
            <MenuItem
              key="reset"
              data-testid="ctx-reset-zoom"
              onClick={() => {
                imageCanvasRef.current?.zoom100();
                setCtxMenu(null);
              }}
            >
              Reset zoom (100%)
            </MenuItem>,
          ]}
        </Menu>
        {eyedropper !== null && (
          <div
            data-testid="eyedropper-hint"
            style={{
              position: 'absolute',
              top: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 3,
              padding: '6px 12px',
              borderRadius: 6,
              background: theme.color.primary.main,
              color: '#fff',
              fontSize: theme.font.size.small,
              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            {eyedropper === 'grid'
              ? 'Pipette armed — click a gridline on the image to sample its colour'
              : eyedropper === 'trace'
              ? 'Pipette armed — click the curve on the image to sample the colour to trace'
              : 'Pipette armed — click the series’ curve on the image to take its colour'}
            <button
              type="button"
              data-testid="eyedropper-cancel"
              onClick={() => setEyedropper(null)}
              style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.6)', borderRadius: 4, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        )}
      </CanvasRegion>

      <RightSidebar>
      <ResizeHandle data-testid="sidebar-resize" title="Drag to resize the panel" onMouseDown={startSidebarResize} />

      {projectError && (
        <p data-testid="project-error" style={{ color: theme.color.error }}>
          {projectError}
        </p>
      )}

      {projectNotice && (
        <p data-testid="project-notice" style={{ color: theme.color.text.secondary }}>
          {projectNotice}
        </p>
      )}

      <SidebarSection>
        <SidebarHeading>Series</SidebarHeading>
        {/* A dropdown to pick the active series (scales to many series, unlike
            the old chip row), with the active series' own controls beside it:
            recolor, rename, delete. New points/actions apply to the active
            series; the spreadsheet below shows every series at once. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <select
            data-testid="series-select"
            value={activeDatasetIndex}
            onChange={(e) => handleSelectDataset(Number(e.target.value))}
            style={{
              flex: '1 1 120px',
              minWidth: 120,
              height: 30,
              fontSize: theme.font.size.regular,
              fontFamily: theme.font.family,
              color: theme.color.text.primary,
              background: theme.color.background.primary,
              border: `1px solid ${theme.color.border.regular}`,
              borderRadius: theme.border.radius.regular,
              padding: '0 6px',
            }}
          >
            {datasetInfos.map((info) => (
              <option key={info.index} value={info.index} data-testid={`series-option-${info.index}`}>
                {info.name} ({info.pointCount})
              </option>
            ))}
          </select>
          <button type="button" data-testid="add-series" onClick={handleAddDataset} disabled={!axes} title="Add a new series">
            + Add
          </button>
        </div>
        {activeInfo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Series-colour picker (checkpoint 91). A single swatch button
                showing the current colour -- the compact one-square footprint
                the old native <input type="color"> had, so the NAME field keeps
                its width -- opening a Popover with the full crash-free control:
                palette swatches, the image eyedropper, and a hex field. (Ckpts
                89/90 built those controls native-dialog-free; ckpt 91 just stops
                them crowding out the name.) */}
            <button
              type="button"
              data-testid="series-color-button"
              title="Series colour"
              onClick={(e) => setColorAnchor(e.currentTarget)}
              style={{
                width: 22,
                height: 22,
                flex: '0 0 auto',
                padding: 0,
                borderRadius: 4,
                background: rgbToHex(activeInfo.color),
                cursor: 'pointer',
                border: `1px solid rgba(0,0,0,0.25)`,
              }}
            />
            <Popover
              open={Boolean(colorAnchor)}
              anchorEl={colorAnchor}
              onClose={() => setColorAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            >
              <div data-testid="series-color-menu" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, width: 176 }}>
                <div data-testid="series-swatches" style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 3 }}>
                  {SERIES_COLOR_PALETTE.map((rgb) => {
                    const hex = rgbToHex(rgb);
                    const selected = rgbToHex(activeInfo.color).toLowerCase() === hex.toLowerCase();
                    return (
                      <button
                        key={hex}
                        type="button"
                        data-testid={`series-swatch-${hex.slice(1)}`}
                        title={hex}
                        onClick={() => handleSetDatasetColor(activeDatasetIndex, hex)}
                        style={{
                          width: 18,
                          height: 18,
                          padding: 0,
                          borderRadius: 3,
                          background: hex,
                          cursor: 'pointer',
                          border: selected ? `2px solid ${theme.color.text.primary}` : '1px solid rgba(0,0,0,0.2)',
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    // Uncontrolled + keyed so a swatch click or a series switch
                    // remounts it with the new colour; only a full #rrggbb applies,
                    // so typing one out works without the native picker.
                    key={`${activeDatasetIndex}-${rgbToHex(activeInfo.color)}`}
                    type="text"
                    data-testid="series-color"
                    title="Series colour (hex, e.g. #1f77b4)"
                    defaultValue={rgbToHex(activeInfo.color)}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      if (/^#[0-9a-fA-F]{6}$/.test(v)) handleSetDatasetColor(activeDatasetIndex, v);
                    }}
                    onBlur={commitPendingEdit}
                    style={{ width: 84, fontSize: theme.font.size.small, fontFamily: 'monospace' }}
                  />
                  {/* Eyedropper: take the colour the FIGURE draws this series in
                      (checkpoint 90) -- the safe on-canvas sampler, never the OS
                      screen-picker that crashed. Closes the popover so the canvas
                      click that follows lands on the image, not the backdrop. */}
                  <button
                    type="button"
                    data-testid="series-eyedropper"
                    title={canvasHasImage ? 'Take this series’ colour from the image' : 'Open an image first'}
                    disabled={!canvasHasImage}
                    onClick={() => {
                      setColorAnchor(null);
                      setEyedropper('series');
                    }}
                    style={{
                      width: 26,
                      height: 26,
                      flex: '0 0 auto',
                      cursor: canvasHasImage ? 'pointer' : 'default',
                      opacity: canvasHasImage ? 1 : 0.4,
                      border: `1px solid ${theme.color.border.regular}`,
                      borderRadius: 4,
                      background: theme.color.background.primary,
                      color: theme.color.text.primary,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {/* The same pipette as the two Auto-extract pickers (David,
                        2026-07-27). It wore a ⌖ reticle, which is what Place Point
                        means on the rail -- so the one glyph said "aim a point" in
                        one place and "sample a colour" in another. */}
                    <EyedropperIcon />
                  </button>
                </div>
                <span style={{ fontSize: theme.font.size.small, color: theme.color.text.legend, lineHeight: 1.3 }}>
                  Swatch or hex for a distinct colour; the pipette takes it from the figure.
                </span>
              </div>
            </Popover>
            <input
              data-testid="series-name"
              title="Rename series"
              value={nameDraft ?? activeInfo.name}
              onChange={(e) => handleRenameDraft(activeDatasetIndex, e.target.value)}
              onBlur={(e) => handleCommitRename(activeDatasetIndex, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur(); // commit, same as looking away
              }}
              aria-invalid={nameDraft !== null && nameNotice !== null}
              style={{ flex: '1 1 auto', minWidth: 80 }}
            />
            {datasetInfos.length > 1 && (
              <button
                type="button"
                data-testid="series-remove"
                title="Delete this series"
                onClick={() => handleRemoveDataset(activeDatasetIndex)}
              >
                Delete
              </button>
            )}
          </div>
        )}
        {nameNotice && (
          <p data-testid="series-name-error" style={{ margin: '4px 0 0', color: theme.color.error, fontSize: 12 }}>
            {nameNotice}
          </p>
        )}
      </SidebarSection>



      {/* Segment-fill controls (threshold/error) moved into the Auto-extract
          umbrella card (v0.8); they no longer live in the right sidebar. */}

      {/* The calibration step text lives in the top card + the bottom tips bar
          now (checkpoint 57) -- only the reuse-pixel shortcut remains here, and
          only when there's actually a placed pixel to reuse. */}
      {isCalibrating && mode === 'calibrate' && !pendingPixel && reusableSteps.length > 0 && (
        <div
          data-testid="calib-prompt"
          style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, fontSize: theme.font.size.small }}
        >
          <span style={{ color: theme.color.text.legend }}>Reuse a placed pixel:</span>
          {reusableSteps.map((s) => (
            <button key={s.key} data-testid={`reuse-${s.key}`} onClick={() => reuseStepPixel(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Value entry, the Calibrate button, and the global calibration fields all
          live on the top calibration card now (checkpoints 50 / 59b). */}

      {session.getCalibrationError() && (
        <p data-testid="calibration-error" style={{ color: theme.color.error }}>
          {session.getCalibrationError()}
        </p>
      )}

      {axes && (
        <>
          {/* "Calibrated." prose removed (checkpoint 59b) -- the card's
              "Calibrated ✓" status and the bottom tips bar already say it. */}
          {hasSlots && (
            <p data-testid="slot-status">
              Next point fills: {currentGroupLabel}{' '}
              {currentTupleIndex === null ? `(new ${tupleNoun})` : `(${tupleNoun} ${currentTupleIndex + 1})`}
              {/* Konva-rendered glyphs aren't DOM-inspectable -- this readout
                  exists purely so e2e coverage can assert on it, same
                  precedent as ImageCanvas's own "view-state" testid. */}
              <span data-testid="box-plot-glyph-count" style={{ display: 'none' }}>
                {boxPlotGlyphs.length}
              </span>
              {/* Same reason, for the calibrated axis rays a spider is aimed at:
                  Konva draws them, so nothing else can assert they are on screen. */}
              <span data-testid="calib-preview-segments" style={{ display: 'none' }}>
                {calibPreview.segments.length}
              </span>
              {/* Which ray is drawn as the live one — the axis the cursor fills. */}
              <span data-testid="calib-preview-emphasis" style={{ display: 'none' }}>
                {calibPreview.segments.findIndex((s) => s.emphasis)}
              </span>
            </p>
          )}
          <SidebarSection>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <SidebarHeading>{isHistogram ? 'Bins' : 'Data points'}</SidebarHeading>
                {/* Konva overlay isn't DOM-inspectable, so the number of connecting-
                    line runs is mirrored here for e2e coverage (checkpoint 131) --
                    same precedent as box-plot-glyph-count. >0 for a dense trace, 0
                    for a sparse/scatter series. */}
                <span data-testid="series-line-runs" style={{ display: 'none' }}>
                  {seriesLines.reduce((n, l) => n + l.runs.length, 0)}
                </span>
                {/* Current image dimensions, mirrored for e2e (image-edit undo):
                    a rotate swaps them, so undo is verified by them reverting. */}
                <span data-testid="image-dims" style={{ display: 'none' }}>
                  {canvasImageDims.w}×{canvasImageDims.h}
                </span>
                {/* Reorder into a continuous nearest-neighbour path (checkpoint
                    130). Shown only when it applies (plain ungrouped series, 3+
                    points, no interpolation samples) -- see
                    session.canSortByNearestNeighbour. Undoable. */}
                {canSortNN && (
                  <button
                    type="button"
                    data-testid="sort-nn"
                    title="Reorder points into a continuous path (nearest-neighbour) — for scattered or out-of-order points"
                    onClick={sortNearestNeighbour}
                    style={{ fontSize: theme.font.size.small, padding: '1px 8px', cursor: 'pointer' }}
                  >
                    Sort ↝ nearest
                  </button>
                )}
              </div>
              {/* CSV export scope (checkpoint 60): active series vs all series.
                  Hidden for Box Plot (its export is always the tuple table). */}
              {/* Offered exactly where the scope means something: a flat export
                  honours it, the tuple/bin/error-bar tables do not. */}
              {session.getExportShape() === 'flat' && (
                <div data-testid="export-scope" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: theme.font.size.small, color: theme.color.text.legend }}>
                  Export:
                  {(['active', 'all'] as const).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      data-testid={`export-scope-${scope}`}
                      onClick={() => setExportScope(scope)}
                      style={{
                        fontSize: theme.font.size.small,
                        padding: '1px 7px',
                        borderRadius: theme.border.radius.regular,
                        cursor: 'pointer',
                        border: `1px solid ${exportScope === scope ? theme.color.primary.main : theme.color.border.regular}`,
                        background: exportScope === scope ? theme.color.primary.main : theme.color.background.primary,
                        color: exportScope === scope ? '#fff' : theme.color.text.primary,
                      }}
                    >
                      {scope === 'active' ? 'Active' : 'All series'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          {isHistogram ? (
            // Bins, not the corner clicks that produced them -- the same call
            // buildHistogramCSV makes for export, so what's on screen is what
            // lands in the file. No Category column: a bin is identified by its
            // interval, unlike a Box Plot tuple which needs a name.
            <table data-testid="points-table" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', paddingRight: 16 }}>#</th>
                  <th style={{ textAlign: 'left', paddingRight: 16 }}>Bin start</th>
                  <th style={{ textAlign: 'left', paddingRight: 16 }}>Bin end</th>
                  <th style={{ textAlign: 'left', paddingRight: 16, color: theme.color.primary.main }}>Value</th>
                  <th aria-hidden />
                </tr>
              </thead>
              <tbody>
                {tupleRows.map((row) => {
                  const bin = histogramBins[row.tupleIndex] ?? null;
                  return (
                    <tr key={row.tupleIndex} data-testid={`bin-row-${row.tupleIndex}`}>
                      <td style={{ paddingRight: 16 }}>{row.tupleIndex + 1}</td>
                      {/* A half-captured bin reads as "—" rather than showing its
                          one placed corner: which edge a lone click is isn't known
                          until the second corner decides the ordering, so naming it
                          "Bin start" would be a guess. The group-cursor line above
                          says which corner is next. */}
                      <td style={{ paddingRight: 16 }}>{bin ? fmtValue(bin.binStart) : '—'}</td>
                      <td style={{ paddingRight: 16 }}>{bin ? fmtValue(bin.binEnd) : '—'}</td>
                      <td style={{ paddingRight: 16, color: theme.color.primary.main }}>
                        {bin ? fmtValue(bin.value) : '—'}
                      </td>
                      <td>
                        <TupleDeleteButton tupleIndex={row.tupleIndex} noun={tupleNoun} onDelete={removeTuple} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : config.axesKind === 'spider' && axes ? (
            /* Spider (v1.4): `# | Category | Series 1 | Series 2 | …` — one row per
               AXIS, one column per series.

               ⚑ The slot table this replaces showed the ACTIVE series only,
               so adding a second series made the first one's readings disappear off
               the screen. Every ungrouped type already shows all series at once, so
               that table was the outlier — caught by driving the app, not by a test.
               Rows-as-axes is also how radar data is normally published, and it
               stays compact as series are added rather than growing sideways by a
               whole block of axis columns each time.

               The alignment is REAL: row k is axis k for every series, because each
               series has exactly one slot per axis by construction. The same layout
               LIED for error bars, where the pairing was never stored. */
            <table data-testid="points-table" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'right', paddingRight: 10, color: theme.color.text.legend }}>#</th>
                  <th style={{ textAlign: 'left', paddingRight: 16 }}>Category</th>
                  {spiderTable.columns.map((col) => (
                    <th
                      key={`${col.seriesIndex}-${col.profileIndex}`}
                      data-testid={`spider-col-${col.seriesIndex}-${col.profileIndex}`}
                      style={{
                        textAlign: 'right',
                        paddingRight: 16,
                        borderLeft: `1px solid ${theme.color.border.regular}`,
                        paddingLeft: 10,
                        fontWeight: 600,
                        color: col.seriesIndex === activeDatasetIndex ? theme.color.primary.main : theme.color.text.primary,
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spiderTable.axisNames.map((axisName, axisIndex) => (
                  <tr key={axisName + String(axisIndex)}>
                    <td style={{ textAlign: 'right', paddingRight: 10, color: theme.color.text.legend }}>{axisIndex + 1}</td>
                    <td style={{ paddingRight: 16 }}>
                      {renderEditableAxisName(axisIndex, spiderTable.axisRawNames[axisIndex] ?? '')}
                    </td>
                    {spiderTable.columns.map((col) => {
                      const value = col.values[axisIndex];
                      const pointIndex = col.pointIndices[axisIndex];
                      return (
                        <td
                          key={`${col.seriesIndex}-${col.profileIndex}`}
                          data-testid={`spider-cell-${col.seriesIndex}-${axisIndex}`}
                          // ⚑ Clicking a cell SELECTS that point, switching the
                          // active series if it belongs to another one. Points of an
                          // inactive series are deliberately inert on the canvas (so
                          // a click can never land on the wrong series), which left
                          // the table as the only possible route to them — and it
                          // wasn't wired, so they could not be reached at all.
                          onClick={() => {
                            if (col.seriesIndex !== activeDatasetIndex) handleSelectDataset(col.seriesIndex);
                            // ⚑ An EMPTY cell aims the capture cursor at that slot
                            // (David: "Can I make an empty slot active again, so
                            // that I can re-add a point that is missing?"). The
                            // cursor otherwise walks to the FIRST gap, which cannot
                            // reach the second one until the first is filled — and
                            // gaps are normal here: the axis-aware trace leaves one
                            // wherever it refused a ray. Clicking the dash is how
                            // that refusal list becomes a worklist.
                            if (pointIndex == null) {
                              session.setSlotCursor(
                                col.profileIndex < session.getDataset().getAllTuples().length ? col.profileIndex : null,
                                axisIndex
                              );
                              setActivePointIndex(null);
                              bump();
                              return;
                            }
                            setActivePointIndex(pointIndex);
                            setPickedPointIndex(pointIndex);
                            bump();
                          }}
                          title={
                            pointIndex == null
                              ? `Click to fill ${axisName} next`
                              : 'Click to select this point'
                          }
                          style={{
                            textAlign: 'right',
                            paddingRight: 16,
                            paddingLeft: 10,
                            borderLeft: `1px solid ${theme.color.border.regular}`,
                            cursor: 'pointer',
                            background:
                              pointIndex != null &&
                              pointIndex === activePointIndex &&
                              col.seriesIndex === activeDatasetIndex
                                ? theme.color.background.canvas
                                // ⚑ The slot the NEXT click fills is marked here too,
                                // not only in the "Next point fills" line: this is the
                                // table you are reading when you notice a gap, so it is
                                // where the answer to "which one am I about to fill?"
                                // has to be visible.
                                : pointIndex == null &&
                                  col.seriesIndex === activeDatasetIndex &&
                                  axisIndex === currentGroupIndex &&
                                  (currentTupleIndex === null
                                    ? col.profileIndex >= session.getDataset().getAllTuples().length
                                    : col.profileIndex === currentTupleIndex)
                                ? theme.color.background.canvas
                                : undefined,
                          }}
                        >
                          {/* An axis this series has not reached reads as a dash, not
                              a zero — nothing was measured there.

                              ⚑ Typing is offered on the ACTIVE series only, the same
                              rule the XY table follows — and it has to be, because the
                              editor is keyed by (point index, axis) and point indices
                              are per-series, so two columns would otherwise open an
                              editor on the same keystroke. One click on another
                              column makes it active (above); its cells then read as
                              editable. */}
                          {value == null || pointIndex == null ? (
                            <span style={{ color: theme.color.text.legend }}>—</span>
                          ) : col.seriesIndex === activeDatasetIndex ? (
                            renderEditableSpiderValue(col.seriesIndex, pointIndex, axisIndex, value)
                          ) : (
                            fmtValue(value)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : hasSlots ? (
            <table data-testid="points-table" style={{ borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', paddingRight: 16 }}>#</th>
                  <th style={{ textAlign: 'left', paddingRight: 16 }}>Category</th>
                  {pointGroupNames.map((name) => (
                    <th key={name} style={{ textAlign: 'left', paddingRight: 16 }}>
                      {name}
                    </th>
                  ))}
                  <th aria-hidden />
                </tr>
              </thead>
              <tbody>
                {tupleRows.map((row) => (
                  <tr key={row.tupleIndex}>
                    <td style={{ paddingRight: 16 }}>{row.tupleIndex + 1}</td>
                    <td style={{ paddingRight: 16 }}>
                      <input
                        data-testid={`tuple-label-${row.tupleIndex}`}
                        value={row.label}
                        onChange={(e) => setTupleLabel(row.tupleIndex, e.target.value)}
                        onBlur={commitPendingEdit}
                        style={{ width: 100 }}
                      />
                    </td>
                    {row.points.map((point, gi) => (
                      <td key={gi} style={{ paddingRight: 16 }}>
                        {point && point.data ? fmtValue(point.data[0]!) : '—'}
                      </td>
                    ))}
                    <td>
                      <TupleDeleteButton tupleIndex={row.tupleIndex} noun={tupleNoun} onDelete={removeTuple} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            // The adaptive multi-series spreadsheet (checkpoint 57): every series
            // side by side, one column set per series (this graph type's value
            // dims -- XY: X,Y; Bar: value; Polar: r,θ; Ternary: A,B,C; CCR:
            // t,value). Rows are ragged (row i = the i-th point of each series,
            // blank where a series is shorter). Pixel columns dropped by design.
            // Scrolls both ways for many series / many points; the # column and
            // header rows stay pinned. The active XY series' cells stay
            // click-to-edit (moves the point on canvas); other cells are read-only.
            <div
              data-testid="data-spreadsheet"
              style={{ maxHeight: 360, overflow: 'auto', border: `1px solid ${theme.color.border.regular}`, borderRadius: 6 }}
            >
              <table data-testid="points-table" style={{ borderCollapse: 'collapse', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                <thead>
                  <tr>
                    <th
                      rowSpan={2}
                      style={{ position: 'sticky', left: 0, top: 0, zIndex: 3, background: theme.color.background.panel, textAlign: 'right', padding: '3px 8px', color: theme.color.text.legend }}
                    >
                      #
                    </th>
                    {spreadsheetSeries.map((s) => (
                      <th
                        key={s.index}
                        colSpan={config.dataDim + (showCategoryColumn ? 1 : 0)}
                        data-testid={`series-col-${s.index}`}
                        style={{
                          position: 'sticky',
                          top: 0,
                          zIndex: 1,
                          background: theme.color.background.panel,
                          textAlign: 'left',
                          padding: '3px 8px',
                          borderLeft: `1px solid ${theme.color.border.regular}`,
                          fontWeight: 600,
                          color: s.active ? theme.color.primary.main : theme.color.text.primary,
                        }}
                      >
                        <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: rgbToHex(s.color), marginRight: 5, verticalAlign: 'middle' }} />
                        {s.name}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {spreadsheetSeries.map((s) => {
                      const headCell = (key: string, label: string, first: boolean) => (
                        <th
                          key={key}
                          style={{
                            position: 'sticky',
                            top: 24,
                            zIndex: 1,
                            background: theme.color.background.panel,
                            textAlign: 'left',
                            padding: '2px 8px',
                            color: theme.color.text.legend,
                            fontWeight: 500,
                            borderLeft: first ? `1px solid ${theme.color.border.regular}` : 'none',
                          }}
                        >
                          {label}
                        </th>
                      );
                      // Category leads the series' columns: an independent variable
                      // comes before the dependent one. ⚑ This claimed to match "the
                      // export's own Label-first convention" while the CATEGORICAL
                      // export actually appended Category last -- screen and file
                      // disagreed on order until David caught it (2026-07-26). Both
                      // are now Position, Category, Value.
                      return [
                        ...(showCategoryColumn ? [headCell(`${s.index}-cat`, 'Category', true)] : []),
                        ...tableValueLabels.map((label, d) =>
                          headCell(`${s.index}-${d}`, label, d === 0 && !showCategoryColumn)
                        ),
                      ];
                    })}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: spreadsheetMaxRows }, (_, i) => {
                    // In Select mode the row must mirror the MARQUEE selection (the
                    // set Del acts on), not activePointIndex (which the marquee forces
                    // to null); a row-click joins that set. Everywhere else the row
                    // tracks the single active point (the canvas-click counterpart).
                    const isActive = mode === 'select' ? selectedPointIndices.includes(i) : i === activePointIndex;
                    const rowBg = isActive ? '#dff0f2' : undefined; // opaque light teal for the selected point's row
                    // A ragged multi-series table can render rows past the ACTIVE
                    // series' point count; in Select mode only a real active-series
                    // point is selectable (the marquee only ever holds those too).
                    // ⚑ A DERIVED row is not selectable. Selecting it made it the
                    // nudge/Del target, so an italic read-only row could still be
                    // moved with an arrow key or deleted -- the v1.3 gate's way
                    // around the read-only cells. A derived sample has no
                    // independent existence: the next anchor move rebuilds it.
                    const isDerivedRow = isDerivedAt(dataPointRoles, i);
                    const selectRow = () => {
                      // ⚑ CLEAR rather than ignore. Merely refusing the selection left
                      // the PREVIOUS one active, so the arrow keys then nudged a point
                      // the user was no longer looking at -- and moving an anchor
                      // rebuilds the fill, so the derived row they clicked shifted
                      // anyway. Same class as the v0.6 audit's lingering-selection
                      // nudge. Caught by this test's own first run.
                      if (isDerivedRow) {
                        setActivePointIndex(null);
                        setSelectedPointIndices([]);
                        return;
                      }
                      if (mode === 'select') {
                        if (i < dataPoints.length) setSelectedPointIndices([i]);
                        return;
                      }
                      setActivePointIndex(i);
                      setPickedPointIndex(i);
                    };
                    return (
                      <tr key={i} data-testid={`point-row-${i}`} aria-selected={isActive} onClick={selectRow} style={{ cursor: 'pointer', background: rowBg }}>
                        <td style={{ position: 'sticky', left: 0, background: rowBg ?? theme.color.background.primary, textAlign: 'right', padding: '1px 8px', color: theme.color.text.legend }}>
                          {i + 1}
                        </td>
                        {spreadsheetSeries.map((s) => {
                          const data = s.values[i];
                          // The category cell: a text input on the ACTIVE series
                          // (the same "you edit the series you're working on" rule
                          // the value cells follow), plain text elsewhere so a
                          // grouped chart still shows every series' names.
                          const categoryCell = showCategoryColumn ? (
                            <td
                              key={`${s.index}-cat`}
                              style={{ padding: '1px 8px', borderLeft: `1px solid ${theme.color.border.regular}` }}
                            >
                              {i < s.values.length ? (
                                s.active ? (
                                  <input
                                    data-testid={`category-${s.index}-${i}`}
                                    value={s.labels[i] ?? ''}
                                    placeholder="name…"
                                    onChange={(e) => setPointLabel(i, e.target.value)}
                                    onBlur={commitPendingEdit}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ width: 90, fontSize: 12.5 }}
                                  />
                                ) : (
                                  <span data-testid={`category-${s.index}-${i}`}>{s.labels[i] ?? ''}</span>
                                )
                              ) : (
                                ''
                              )}
                            </td>
                          ) : null;
                          // A spline-DERIVED sample is not the user's number to type over:
                          // the next rebuild regenerates it from the anchors, so an edit
                          // here looked like it took and was silently wiped (v0.6 audit).
                          // It reads muted + italic and refuses the edit, pointing at the
                          // anchors -- which ARE editable, and which the curve follows.
                          const derived = isDerivedAt(s.roles, i);
                          const editable = isCellEditable(config.axesKind, s.active, derived);
                          return [
                            ...(categoryCell ? [categoryCell] : []),
                            ...tableValueLabels.map((_label, d) => {
                              const dateFmt = tableDateFormats[d];
                              return (
                                <td
                                  key={`${s.index}-${d}`}
                                  data-testid={derived ? `derived-cell-${s.index}-${i}-${d}` : undefined}
                                  title={derived ? 'Derived by the spline from your guide points — move an anchor to change it' : undefined}
                                  style={{
                                    padding: '1px 8px',
                                    borderLeft: d === 0 && !showCategoryColumn ? `1px solid ${theme.color.border.regular}` : 'none',
                                    fontVariantNumeric: 'tabular-nums',
                                    ...(derived ? { color: theme.color.text.legend, fontStyle: 'italic' } : {}),
                                  }}
                                >
                                  {data
                                    ? dateFmt != null
                                      ? // Date-calibrated column: show the formatted date, like the
                                        // export (not editable inline -- move the point on canvas).
                                        formatDateNumber(data[d]!, dateFmt)
                                      : editable
                                      ? renderEditableValue(i, d, data[d]!)
                                      : fmtValue(data[d]!)
                                    : ''}
                                </td>
                              );
                            }),
                          ];
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* Empty-state message lives outside <tbody> so a "no data points"
                  check can still count tbody rows (== points placed). */}
              {spreadsheetMaxRows === 0 && (
                <div data-testid="no-points" style={{ padding: 8, color: theme.color.text.legend, fontSize: 12.5 }}>
                  {noPointsHint}
                </div>
              )}
            </div>
          )}
          {/* What the italic cells MEAN, on screen rather than in a tooltip: a reader
              who never placed a guide point still has to be able to tell which of
              these numbers came off the figure and which the spline invented.
              ⚑ OUTSIDE the scrolling table container, deliberately. It first sat
              inside, below the rows -- which reads fine in a test with five points
              and is INVISIBLE in real use: a guide-points trace is ~180 rows, so the
              explanation sat a full table-scroll below the fold while the italics it
              explains were on screen from the first row. Caught on David's screenshot
              test bench, not by the e2e (whose table was short enough to fit).
              Shown only when a visible series actually has derived points. */}
          {spreadsheetSeries.some((s) => s.roles.some((r) => r === 'interpolated')) && (
            <div data-testid="derived-legend" style={{ padding: '4px 2px 0', color: theme.color.text.legend, fontSize: 12 }}>
              <i>Italic</i> = derived by the spline between your guide points, not read off the
              figure. Move an anchor to change it; exports mark these <code>interpolated</code>.
            </div>
          )}
          {/* Wrong-axis notice (v1.4, Spider) — shown as the click happens, and
              deliberately NOT stored.

              ⚑ It has to be captured at click time because the point is SNAPPED
              onto its axis: afterwards the stored pixel is on its ray and there is
              no "off" left to measure. That snap is the right trade — once the dot
              visibly sits on the axis the user stops aiming perpendicular-accurately,
              correctly, so a stored perpendicular offset would look like an error
              signal while actually recording that the app told them not to care.
              No other graph type records such a thing either.

              Sits outside the table's scroll container, like the derived legend
              above: an explanation that scrolls out of view is one nobody reads. */}
          {captureNotice && captureNotice.mode === mode && captureNotice.seriesIndex === activeDatasetIndex && (
            <div
              data-testid="off-axis-warning"
              style={{ padding: '4px 2px 0', color: theme.color.error, fontSize: 12 }}
            >
              That click was {Math.round(captureNotice.offRayPx)} px off the{' '}
              {captureNotice.capturedOnLabel} axis and nearer {captureNotice.nearestLabel} — it was
              recorded on {captureNotice.capturedOnLabel}, the axis the cursor was filling. Undo if
              you meant {captureNotice.nearestLabel}.
            </div>
          )}
          </SidebarSection>
        </>
      )}

      {/* Measurements OUTPUT (v1.1 step 2): the recorded measurements moved here
          from the Measure fold-out -- a tool fold-out holds inputs only, results
          live in the output panel (bound with the series data, copyable, exported
          as their own block). Shown while measuring OR whenever any exist, with the
          reference frame in effect (chart calibration vs a real-world Set-scale). */}
      {(mode === 'measure' || measurementViews.length > 0) && (
        <SidebarSection>
          <SidebarHeading>Measurements</SidebarHeading>
          <div data-testid="measurements-panel" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: theme.font.size.small }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: theme.color.text.secondary }}>
              <span data-testid="measure-ref">
                {measureReference.kind === 'chart' && <>Ref: <b>chart axes</b>{measureReference.units ? ` (${measureReference.units})` : ''}</>}
                {measureReference.kind === 'scale' && <>Scale: <b>{measureReference.perPx}</b></>}
                {measureReference.kind === 'degrees' && <>Measured in <b>degrees</b></>}
                {measureReference.kind === 'none' && <span style={{ color: theme.color.text.legend }}>Pixels (set a scale or calibrate)</span>}
              </span>
              {measurementViews.length > 0 && (
                <button
                  type="button"
                  data-testid="measure-copy-all"
                  title="Copy all as text"
                  onClick={copyAllMeasurements}
                  style={{ marginLeft: 'auto', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: theme.color.primary.main, textDecoration: 'underline', fontSize: theme.font.size.small }}
                >
                  Copy all
                </button>
              )}
            </div>
            {measurementViews.length === 0 ? (
              <span style={{ color: theme.color.text.legend }}>No measurements yet.</span>
            ) : (
              measurementViews.map((m) => (
                <div
                  key={m.id}
                  data-testid={`measure-row-${m.id}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', borderBottom: `1px solid ${theme.color.background.canvas}` }}
                >
                  <span style={{ display: 'inline-flex', flex: '0 0 auto', color: theme.color.icon.active }}>{measureIcons[m.tool]}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{m.value}</b>
                    {m.note && <span style={{ color: theme.color.text.legend }}> · {m.note}</span>}
                  </span>
                  <button type="button" title="Copy value" onClick={() => copyMeasurement(m)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: theme.color.text.legend }}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 11 V3.5 A1.5 1.5 0 0 1 4.5 2 H11" /></svg>
                  </button>
                  <button type="button" title="Delete" onClick={() => deleteMeasurement(m.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: theme.color.text.legend }}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4 L12 12 M12 4 L4 12" /></svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </SidebarSection>
      )}

      {/* Curve fit OUTPUT (v1.1 step 2): the fit result moved here from the Curve
          Fit fold-out (inputs only). Bound to the active series; already stored on
          the dataset + exported as its own derived block. */}
      {curveFitState && (
        <SidebarSection>
          <SidebarHeading>Curve fit</SidebarHeading>
          <div data-testid="curve-fit-output" style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: theme.font.size.small }}>
            <span style={{ color: theme.color.text.secondary }}>{activeInfo?.name ?? 'Series'}</span>
            <code data-testid="curve-fit-equation" style={{ fontSize: theme.font.size.small, wordBreak: 'break-word' }}>{formatCurveFitEquation(curveFitState)}</code>
            <span style={{ fontVariantNumeric: 'tabular-nums', color: theme.color.text.secondary }}>
              R² = {curveFitState.rSquared === undefined ? '—' : curveFitState.rSquared.toFixed(5)} · RMS = {curveFitState.rms.toPrecision(5)} · n = {curveFitState.n}
            </span>
            {/* ⚑ R² is undefined when the series is flat: it is the fraction of the
                data's variation that the model accounts for, and a flat series has
                none. This used to read 1.00000 -- a written-in default where the
                formula divides by zero -- so a flat baseline looked like a PERFECT
                fit, sometimes beside the red "did not settle" below. Say why it is
                blank rather than leaving a dash to be puzzled over. */}
            {curveFitState.rSquared === undefined && (
              <span data-testid="curve-fit-no-r2" style={{ color: theme.color.text.secondary }}>
                R² needs variation to measure against, and every value in this series is the same — so it has none here. Read the RMS instead: it is in the data's own units.
              </span>
            )}
            {/* ⚑ A nonlinear solver can run out of iterations and still leave a
                drawn curve behind, and a drawn curve is read as an answer. When
                it did not settle, SAY so beside the numbers rather than let the
                line speak for itself. Absent for a polynomial, which is solved
                directly and has nothing to converge. */}
            {curveFitState.converged === false && (
              <span data-testid="curve-fit-not-converged" style={{ color: theme.color.error }}>
                This fit did not settle — the curve is where the solver stopped, not a result. Try another model or a restricted x-range.
              </span>
            )}
          </div>
        </SidebarSection>
      )}

      {/* Geometry OUTPUT (v1.1 step 2 + 4): the derived stats moved here from the
          fold-out (inputs only). Summary always; the big per-point table is
          collapsed. Recomputes live as the series is edited; if it can't (points
          deleted below 2) the stale/broken state shows here AND in the tips bar. */}
      {geometryState && (
        <SidebarSection>
          <SidebarHeading>Geometry</SidebarHeading>
          <div data-testid="geometry-output" style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: theme.font.size.small }}>
            <span style={{ color: theme.color.text.secondary }}>{activeInfo?.name ?? 'Series'}</span>
            {geometryResult ? (
              <>
                <div data-testid="geometry-summary" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  Arc length = {geometryResult.arcLength.toPrecision(6)}
                  <br />
                  {geometryResult.areaLabel} = {geometryResult.area.toPrecision(6)}
                  <br />
                  Max curvature = {geometryResult.maxCurvature.value.toPrecision(6)} at point {geometryResult.maxCurvature.index + 1}
                </div>
                <button
                  type="button"
                  data-testid="geometry-table-toggle"
                  onClick={() => setGeometryTableOpen((v) => !v)}
                  style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: theme.color.primary.main, textDecoration: 'underline', fontSize: theme.font.size.small }}
                >
                  {geometryTableOpen ? 'Hide per-point table' : `Per-point table (${geometryResult.perPoint.length})`}
                </button>
                {geometryTableOpen && (
                  <div style={{ maxHeight: 220, overflow: 'auto' }}>
                    <table data-testid="geometry-table" style={{ borderCollapse: 'collapse', fontSize: theme.font.size.small, fontVariantNumeric: 'tabular-nums' }}>
                      <thead>
                        <tr style={{ color: theme.color.text.legend, textAlign: 'left' }}>
                          <th style={{ paddingRight: 10 }}>#</th>
                          <th style={{ paddingRight: 10 }}>x</th>
                          <th style={{ paddingRight: 10 }}>y</th>
                          <th style={{ paddingRight: 10 }}>len</th>
                          <th>κ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {geometryResult.perPoint.map((p, i) => (
                          <tr key={i}>
                            <td style={{ paddingRight: 10 }}>{i + 1}</td>
                            <td style={{ paddingRight: 10 }}>{p.x.toPrecision(5)}</td>
                            <td style={{ paddingRight: 10 }}>{p.y.toPrecision(5)}</td>
                            <td style={{ paddingRight: 10 }}>{p.cumulativeLength.toPrecision(5)}</td>
                            <td>{p.curvature.toPrecision(5)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <span data-testid="geometry-stale" style={{ color: theme.color.error }}>
                ⚠ Can’t compute — {geometryError}
              </span>
            )}
          </div>
        </SidebarSection>
      )}
      </RightSidebar>

      {/* Full-width status bar (checkpoint 47/50). Left: the one constant place
          for contextual guidance ("what do I do now?") -- calibration steps,
          mode hints, eyedropper/segment-fill prompts -- so the user always
          knows where to look. Right: zoom %, live view-state probe (kept for
          e2e), and calibrated status. */}
      <BottomBar>
        <span data-testid="tips-bar" style={{ display: 'flex', alignItems: 'center', gap: 6, color: theme.color.text.primary, minWidth: 0 }}>
          <span aria-hidden style={{ opacity: 0.7 }}>💡</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{guidanceTip}</span>
        </span>
        {/* ⚑ THE KEY-TIPS' OWN AFFORDANCE (v1.6). Badges that appear on Alt are only
            discoverable if something on screen says Alt does anything -- otherwise the
            cure for shortcut-only paths is itself a shortcut-only path, which is the
            exact failure the keystone names. So the hint is permanent, sits in the one
            place the app already uses for "what can I do now?", and steps aside while
            the badges are actually showing (it has served its purpose at that point,
            and the row is narrow). */}
        <span
          data-testid="keytips-hint"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginLeft: 12,
            flex: '0 0 auto',
            whiteSpace: 'nowrap',
            fontSize: theme.font.size.small,
            color: theme.color.text.legend,
            opacity: keyTips ? 0 : 1,
            transition: 'opacity 120ms',
          }}
        >
          Hold <kbd style={{ fontFamily: theme.font.family, border: `1px solid ${theme.color.border.regular}`, borderRadius: 3, padding: '0 4px', fontSize: theme.font.size.small }}>Alt</kbd> for shortcuts
        </span>
        {/* Recompute-on-edit stale callout (v1.1, David): geometry re-derives live,
            but when an edit makes it impossible (points deleted below 2) the user
            gets a clear warning here in the bottom row -- recompute or clear it. */}
        {geometryState && geometryError && (
          <span data-testid="geometry-stale-callout" style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 12, color: theme.color.error, flex: '0 0 auto', whiteSpace: 'nowrap' }}>
            ⚠ {activeInfo?.name ?? 'Series'} · geometry can’t recompute — {geometryError}
          </span>
        )}
        {/* Capture figure moved to the "Capture figure first" prompt IN the
            calibration card (v0.8, David: the card is the capture+calibrate step;
            the bottom bar was a "read here, act down there" split). Safe now
            because that button exists only pre-capture and vanishes on capture,
            so it can't grow the card over a calibration click (the ckpt-102
            reason it was ever down here). */}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, color: theme.color.text.legend, flex: '0 0 auto' }}>
          {/* PDF page navigator (checkpoint 96): a transient control shown only
              while a MULTI-page PDF is open (design §3 -- a page is a browsable
              input, absent for a single page). Flipping a page loads it as a
              fresh figure. */}
          {pdfState && pdfState.pageCount > 1 && (
            <span data-testid="pdf-pager" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                data-testid="pdf-prev"
                onClick={() => void goToPdfPage(pdfState.page - 1)}
                disabled={pdfState.page <= 1}
                title="Previous PDF page"
                style={{ cursor: pdfState.page <= 1 ? 'default' : 'pointer', padding: '0 4px' }}
              >
                ◀
              </button>
              <span data-testid="pdf-page-label">Page {pdfState.page} / {pdfState.pageCount}</span>
              <button
                type="button"
                data-testid="pdf-next"
                onClick={() => void goToPdfPage(pdfState.page + 1)}
                disabled={pdfState.page >= pdfState.pageCount}
                title="Next PDF page"
                style={{ cursor: pdfState.page >= pdfState.pageCount ? 'default' : 'pointer', padding: '0 4px' }}
              >
                ▶
              </button>
            </span>
          )}
          {/* "Extract another graph from the source" (checkpoint 110, design §8).
              A SOURCE action, so it lives with the page flipper (bottom) rather
              than the figure jumper (top). Shown only when a paged source is
              retained -- no ceremony for a plain single image. Re-enters the
              source's pages as a fresh figure, keeping the current one; the next
              capture bakes it. */}
          {sourceRetained && (
            <BottomBarButton
              type="button"
              data-testid="extract-another-figure"
              onClick={() => void getAnotherFigureFromSource()}
              title="Go back to the source document and capture another figure from it"
            >
              + Extract another graph
            </BottomBarButton>
          )}
          {/* Provenance: where the figure came from -- the source document
              (checkpoint 97: "paper.pdf · p.4") and/or a baked crop (checkpoint
              95). Shown only when there is something to cite, so it never
              clutters the common case, and its appearance/absence doesn't reflow
              the bar. */}
          {(() => {
            // Build the citation from the source (a PDF name and/or page) and
            // any crop. A source with only a page and no name (a pasted PDF that
            // carried no filename) still shows "p.N" -- checkpoint 98 (T7): it was
            // recorded but previously never displayed.
            const s = provenance.source;
            const sourceLabel = s?.name
              ? `${s.name}${s.page != null ? ` · p.${s.page}` : ''}`
              : s?.page != null
              ? `p.${s.page}`
              : '';
            const nCrops = provenance.crops?.length ?? 0;
            const cropLabel =
              nCrops > 0
                ? `cropped from ${provenance.crops![0]!.fromWidth}×${provenance.crops![0]!.fromHeight}${nCrops > 1 ? ` (${nCrops} crops)` : ''}`
                : '';
            const text = [sourceLabel, cropLabel].filter(Boolean).join(' · ');
            return text ? (
              <span data-testid="provenance" title="Where this figure came from">
                {text}
              </span>
            ) : null;
          })()}
          {/* Source-PDF disclosure (checkpoint 104): the saved project carries the
              source PDF, so the user SEES it before, say, pushing a project with a
              paywalled paper inside (§5). */}
          {sourcePdfBundled && (
            <span data-testid="source-pdf-bundled" title="The source PDF is bundled into the saved project">
              📄 source PDF included
            </span>
          )}
          <span>{Math.round(canvasScale * 100)}%</span>
          <span data-testid="view-state">
            scale: {canvasView.scale.toFixed(3)}, offset: ({canvasView.offsetX.toFixed(1)}, {canvasView.offsetY.toFixed(1)})
          </span>
          <span data-testid="calib-status">
            {axes ? 'Calibrated' : 'Not calibrated'}
            {canvasHasImage ? '' : ' · no image loaded'}
          </span>
        </span>
      </BottomBar>
      {wpdFigures && (
        <div
          data-testid="wpd-picker"
          onClick={() => setWpdFigures(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: theme.color.background.primary,
              border: `1px solid ${theme.color.border.regular}`,
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
              padding: 18,
              width: 420,
              maxHeight: '70vh',
              overflow: 'auto',
              fontFamily: theme.font.family,
              color: theme.color.text.primary,
            }}
          >
            <strong style={{ fontSize: theme.font.size.regular, fontWeight: 700 }}>Choose a figure to import</strong>
            <p style={{ fontSize: theme.font.size.small, color: theme.color.text.legend, margin: '6px 0 12px' }}>
              This project holds {wpdFigures.length} calibrated figures on one image. Import one — you
              can open the project again to import another.
            </p>
            {wpdFigures.map((fig) => {
              const openable = fig.configId !== null;
              return (
                <button
                  key={fig.index}
                  type="button"
                  data-testid={`wpd-figure-${fig.index}`}
                  disabled={!openable}
                  onClick={() => importWpdFigureAt(fig.index)}
                  title={openable ? `Import "${fig.name}"` : (fig.unsupportedReason ?? undefined)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    marginBottom: 6,
                    borderRadius: 6,
                    border: `1px solid ${theme.color.border.regular}`,
                    background: theme.color.background.primary,
                    color: openable ? theme.color.text.primary : theme.color.text.legend,
                    cursor: openable ? 'pointer' : 'not-allowed',
                    font: 'inherit',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {fig.name} <span style={{ color: theme.color.text.legend, fontWeight: 400 }}>· {fig.axesType}</span>
                  </div>
                  <div style={{ fontSize: theme.font.size.small, color: theme.color.text.legend }}>
                    {openable
                      ? fig.datasetNames.length > 0
                        ? fig.datasetNames.join(', ')
                        : 'no data series'
                      : fig.unsupportedReason}
                  </div>
                </button>
              );
            })}
            <button
              type="button"
              data-testid="wpd-picker-cancel"
              onClick={() => setWpdFigures(null)}
              style={{ marginTop: 6, fontSize: theme.font.size.small }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {gamePhase && (
        <ChallengeOverlay
          phase={gamePhase}
          roundIndex={roundIndex}
          roundCount={roundQueue.length}
          instruction={roundQueue[roundIndex]?.instruction ?? ''}
          roundStartMs={roundStartMs}
          lastScore={roundScores[roundScores.length - 1] ?? null}
          totalAdjusted={roundScores.reduce((s, r) => s + r.adjustedSeconds, 0)}
          highScores={highScores}
          qualifies={gamePhase === 'results' && scoreQualifies(roundScores.reduce((s, r) => s + r.adjustedSeconds, 0), highScores)}
          onConfirmStart={beginRounds}
          onCancel={finishChallenge}
          onDone={finishRound}
          onNext={nextRound}
          onSaveHighScore={saveHighScore}
          onFinish={finishChallenge}
        />
      )}
    </AppShell>
    </KeyTipsContext.Provider>
  );
}
