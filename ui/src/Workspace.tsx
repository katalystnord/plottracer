import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import {
  CalibrationSession,
  XY_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  HEATMAP_AXES_CONFIG,
  BAR_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  POLAR_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
  MAP_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
  SPIDER_AXES_CONFIG,
  PIE_AXES_CONFIG,
  calibrationCompatible,
  commonOriginReuse,
  type AxesTypeConfig,
  type CalibratedAxes,
  type SessionSnapshot,
} from '../../engine/calibrationSession.js';
import { describeCaptureProgress } from '../../engine/captureProgress.js';
import { AUTO_EXTRACT_MODES, autoExtractModesFor, type ToolMode } from '../../engine/toolMode.js';
import { guidanceTip as buildGuidanceTip, noPointsHint as buildNoPointsHint } from '../../engine/guidanceTip.js';
import { buildCanvasMarkers, buildSeriesLines, radialLabelCentre } from '../../engine/canvasOverlays.js';
import {
  CATEGORY_PANEL_HINT,
  CATEGORY_TICK_DRAG_HINT,
  CONVENTION_LABELS,
  categoryAxisGlyphs,
  categoryPanelSummary,
  categoryPanelView,
  categoryTickIndexFromId,
  categoryTickMarkers,
  categoryMarkMessage,
  isMarkingCategoryAxis,
  type CategoryMarkError,
} from '../../engine/categoryTickOverlay.js';
import type { TickConvention } from '../../core/categoryAxis.js';
import { resolveKeyDown, isNudgeRelease } from '../../engine/keyboardActions.js';
import { routeCanvasClick } from '../../engine/canvasClickRoute.js';
import { resolveMeasureClick, snapToNearestPoint } from '../../engine/measureCapture.js';
import { exportBaseName as baseNameForExport, EXPORT_FILTER_NAMES } from '../../engine/exportNaming.js';
import {
  colorTraceRefusal,
  spiderTraceReport,
  barTraceReport,
  categoryMissReport,
  blobTraceReport,
  curveTraceReport,
} from '../../engine/colorTraceReport.js';
import { History } from '../../engine/history.js';
import { datasetNameError, uniqueDatasetName } from '../../engine/seriesNames.js';
import { ImageCanvas, type CanvasMarker, type ImageCanvasHandle, type MeasureOverlay, type SeriesLine, type SelectGesture } from './ImageCanvas.js';
import type { AvoidRect } from '../../engine/loupePosition.js';
import { Menu, MenuItem, Divider } from '@mui/material';
import { IconButton } from './IconButton.js';
import { GraphTypeCardPicker } from './GraphTypeCardPicker.js';
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
  CameraIcon,
  ChevronDownIcon,
  MeasureIcon,
  ImageEditIcon,
  ErrorBarsIcon,
} from './icons.js';
import { MeasureCard, type MeasureRef, type MeasureToolId, type Measurement, type SetScaleDraft } from './MeasureCard.js';
import { ImageEditCard } from './ImageEditCard.js';
import { ErrorBarsCard } from './ErrorBarsCard.js';
import { ChallengeOverlay, type ChallengePhase } from './ChallengeOverlay.js';
import { MeasurementsCard } from './panels/MeasurementsCard.js';
import { CurveFitCard } from './panels/CurveFitCard.js';
import { GeometryCard } from './panels/GeometryCard.js';
import { GridRemovalPanel } from './panels/GridRemovalPanel.js';
import { GeometryFlyout } from './panels/GeometryFlyout.js';
import { CurveFitFlyout } from './panels/CurveFitFlyout.js';
import { HelpMenu } from './panels/HelpMenu.js';
import { ExportMenu } from './panels/ExportMenu.js';
import { EditableValue, EditableName } from './panels/EditableCell.js';
import { fmtNum, fmtValue, rgbToHex } from './format.js';
import { HistogramBinsTable } from './panels/HistogramBinsTable.js';
import { TupleTable } from './panels/TupleTable.js';
import { BarTable } from './panels/BarTable.js';
import { SpiderTable } from './panels/SpiderTable.js';
import { SpreadsheetTable } from './panels/SpreadsheetTable.js';
import { AutoExtractCard, COLOR_TRACE_PREVIEW_RGBA } from './panels/AutoExtractCard.js';
import { SeriesPanel } from './panels/SeriesPanel.js';
import { EXAMPLES, MANUAL_URL } from './examples.js';
import { ExplodedSliceControl } from './ExplodedSliceControl.js';
import { CHALLENGE_META, CHALLENGE_IDS } from './challengeExamples.js';
import { readHighScores, qualifies as scoreQualifies, insertHighScore, type HighScore } from './challengeScores.js';
import {
  drawGradedRounds,
  calibrationInputsFromAnchors,
  truthAxisRanges,
  truthValueRange,
  truthSeriesPoints,
  truthHistogramPoints,
  truthBarValues,
  truthSpiderPoints,
  spiderUserPoints,
  spiderAxisRanges,
  spiderPointAt,
  truthPieValues,
  derivedTupleItems,
  pieRevealRays,
  singleAnchor,
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
// A real multi-page PDF (checkpoint 114): one figure per page, so the user can
// exercise the multi-figure flow (open -> capture -> Extract another -> flip page
// -> capture) directly. `?url` forces Vite to emit an asset URL we fetch as bytes.
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
import type { PlotData } from '../../core/plotData.js';
import type { Dataset } from '../../core/dataset.js';
import type { CategoryAxis } from '../../core/categoryAxis.js';
import { buildExportJson, buildExportSections } from '../../engine/exportAssembly.js';
import {
  buildSpreadsheetSeries,
  spreadsheetMaxRows as spreadsheetMaxRowCount,
  showsCategoryColumn,
  isDerivedAt,
} from '../../engine/spreadsheetModel.js';
import { renderTable, TABLE_FORMAT_EXTENSION, type TableFormat } from '../../engine/tableFormats.js';
import type { PrecisionMode } from '../../core/exportPrecision.js';
import { calibrationCheckBox } from '../../engine/calibrationCheck.js';
import { runSegmentFill } from '../../engine/segmentFillRun.js';
import { runColorTrace, calibrationBoxRegion } from '../../engine/colorTraceRun.js';
import { runSpiderTrace, spiderBoxRegion } from '../../engine/spiderTraceRun.js';
import type { SpiderAxes } from '../../core/axes/spider.js';
import { runBlobDetect } from '../../engine/blobDetectRun.js';
import { runBarDetect } from '../../engine/barDetectRun.js';
import { formatLabelList, labelCoverage, parseLabelList } from '../../core/heatmapLabels.js';
import {
  addDivider,
  buildColorScale,
  describeDivider,
  detectGrid,
  dividerHandles,
  dragDivider,
  gridFromAxes,
  gridToAxes,
  initialGrid,
  isDividerHandle,
  labelsForCells,
  labelsFromAxes,
  labelsToAxes,
  type MetadataCarrier,
  readHeatmapCells,
  removeDividerHandle,
  type HeatmapLabels,
  type HeatmapRow,
  type HeatmapState,
} from '../../engine/heatmapRun.js';
import { HeatmapCard } from './panels/HeatmapCard.js';
import { colorFilter, maskToRGBA, type FilterRegion } from '../../algorithms/colorFilter.js';
import {
  runCurveFit,
  getCurveFitState,
  setCurveFitState as saveCurveFitState,
  sampleCurveFitLine,
  type CurveFitModelId,
} from '../../engine/curveFitPanel.js';
import { runGeometry, getGeometryState, setGeometryState } from '../../engine/geometryPanel.js';
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
import { HelpOverlay } from './HelpOverlay.js';

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


/** Marker radius (screen px) for the SELECTED point on a dense connected series
 *  (checkpoint 132): the other points draw no dot at all -- the line carries the
 *  shape -- but the selected one stays a visible, grabbable dot so you can still
 *  pick a point off the curve. See engine/seriesLine.ts for the curve/scatter rule. */

// Typed explicitly as AxesTypeConfig<CalibratedAxes>[] (not inferred via
// `as const`) so .find() below returns a single covariant type instead of
// a union of each config's own axes type -- see CalibratedAxes's doc
// comment in engine/calibrationSession.ts for why that covariance holds.
/** The heatmap grid's one colour, shared by the dashed lines on the canvas and
 * the handles that move them — so the thing you grab is visibly the thing that
 * moves. */
const HEATMAP_GRID_COLOR = '#a87fd4';

const AXES_TYPE_CONFIGS: readonly AxesTypeConfig<CalibratedAxes>[] = [
  XY_AXES_CONFIG,
  // Sits next to XY because it *is* XY underneath (checkpoint 66) -- and
  // directly above Bar because that adjacency is the point: a histogram looks
  // like bars, so Bar is the tempting pick, but BarAxes yields a typed label
  // plus one magnitude and no numeric x, silently losing the axis that makes a
  // histogram a histogram. Offering the right entry by name is what stops that
  // choice being a trap.
  HISTOGRAM_AXES_CONFIG,
  // Error bars are rail tool 6, not a graph type (checkpoint 79): you trace a
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
  // Heatmap (v2.2), closing the rectangular group rather than joining the bar
  // family. The picker answers "what does my figure look like?", and a heatmap
  // looks like neither a bar chart nor a scatter -- it is a grid of coloured
  // cells. What it shares with everything above it is the FRAME: two ordinary
  // axes at right angles, which is what it calibrates. So it sits last among
  // the rectangular charts and first before the radial ones, which is exactly
  // where a reader scanning for "mine has a colour key" stops looking.
  HEATMAP_AXES_CONFIG,
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

// ⚑ v2.0: names shortened to drop the redundant "Type — " prefix (David) --
// the Open Example card grid now shows the graph-type ICON per row (the
// same glyph GraphTypeCardPicker.tsx uses, keyed off `axes`), so restating
// the type in the label is now the icon's job.
//
// ⚑ 2026-07-30: went further and dropped every parenthetical TOOL hint too
// ("(press 6)", "(Auto-extract ▸ Guide points)", "(Exploded slice)", ...) --
// David: "if we want to give hints -> hint bar!". They were also drifting
// out of sync with the actual UI (three were caught stale in the same pass:
// a wrong hotkey number, a renamed button, a checkbox label that had
// changed). The tips bar (guidanceTip, below) plus each rail button's own
// visible shortcut badge already teach the relevant tool once an example is
// open and the right mode is active -- that is the ONE place this kind of
// guidance belongs, not restated (and liable to rot) in a menu label. A
// name here still names what the FIGURE is (an example whose point is a
// feature you can't tell apart from any other pie is not an example --
// CLAUDE.md's keystone), just not how to operate the tool.


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
  /** Which bar-table CATEGORY row is being typed into, or null -- the same
   * click-to-edit affordance as editingAxisName above, keyed by categoryIndex
   * instead of spoke index (v2.0). */
  const [editingCategoryName, setEditingCategoryName] = useState<number | null>(null);
  /** Which tuple's plain per-tuple label (Pie's sector name, Box Plot's box
   * name) is being typed into, or null -- same click-to-edit affordance,
   * keyed by tupleIndex, for the generic `hasSlots` table's Category column.
   * v2.0, 2026-07-30: this table used to render a PERMANENT input box
   * pre-filled with an invented "Slice0"/"Slice1" -- the same defect found
   * on Bar, caught live on Pie (David: "Same fix here too!!"). */
  const [editingTupleLabel, setEditingTupleLabel] = useState<number | null>(null);
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
  // v2.1 category ticks. `categoryFirstEdge` holds the first click of a two-click
  // axis marking -- gesture state, not document state, so it lives here rather
  // than in the session: there is nothing to undo about half a gesture.
  const [categoryPanelOpen, setCategoryPanelOpen] = useState(false);
  const [categoryFirstEdge, setCategoryFirstEdge] = useState<{ x: number; y: number } | null>(null);
  const [categoryCountInput, setCategoryCountInput] = useState('');
  const [categoryMarkError, setCategoryMarkError] = useState<CategoryMarkError>(null);
  // Set by "Re-place axis": the next marking gesture asks for BOTH ends rather
  // than reusing P1, which is the only way to correct an axis whose start P1 got
  // wrong. Cleared once an axis is marked.
  const [categoryPlaceBothEdges, setCategoryPlaceBothEdges] = useState(false);
  const [categorySeriesInput, setCategorySeriesInput] = useState('');

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

  /* ── Heatmap capture (v2.2) ──────────────────────────────────────────────
   *
   * ⚑ The grid is MIRRORED here, not owned here. Its home is the axes' own
   * metadata (`gridToAxes` / `gridFromAxes`), which is what makes it survive a
   * Save and an undo without any new project-file or snapshot field; this state
   * exists so the overlay and the card can read it during a render. Every write
   * goes through `applyHeatmapGrid`, so the two cannot drift.
   *
   * ⚠️ This comment used to say the opposite — that the grid was view state
   * only, lost on Save — and it stayed that way for a commit after persistence
   * shipped. A comment describing a limitation that has been fixed is read as
   * current by the next person; grade the comments against the code, not only
   * the prose.
   *
   * ⚑ Everything the buttons DO is in `engine/heatmapRun.ts`. What is left in
   * this file is which state to set. */
  const [heatmapGrid, setHeatmapGrid] = useState<HeatmapState | null>(null);
  /** Which divider handle the user last clicked, so the card can offer to remove
   * THAT boundary. Its own state rather than `activeHandleKey`, which is cleared
   * on anything that is not a placed calibration point (see the guard effect). */
  const [selectedDividerId, setSelectedDividerId] = useState<string | null>(null);
  const [heatmapColumns, setHeatmapColumns] = useState('');
  const [heatmapRows, setHeatmapRows] = useState('');
  /**
   * What the figure PRINTS along each axis, as the user typed it.
   *
   * ⚑ THE TEXT is the state and the parsed list is derived, not the other way
   * round: a user mid-way through typing `A, B, ` has a trailing separator that
   * a parse-and-reformat round trip would keep eating under their hands. The
   * record — the parsed list — is written to the axes on every change, so what
   * is SAVED is always the list and never the punctuation.
   */
  const [heatmapXLabels, setHeatmapXLabels] = useState('');
  const [heatmapYLabels, setHeatmapYLabels] = useState('');
  const [heatmapCells, setHeatmapCells] = useState<HeatmapRow[]>([]);
  /** ⚑ Read through a ref by the export, which is a `useCallback` shared by
   * nine formats: making it depend on the cells state would rebuild it on every
   * read, and an export that captured a stale array would write the previous
   * figure's numbers. */
  const heatmapCellsRef = useRef<HeatmapRow[]>([]);
  useEffect(() => {
    heatmapCellsRef.current = heatmapCells;
  }, [heatmapCells]);
  const [heatmapDetectMessage, setHeatmapDetectMessage] = useState('');
  const [heatmapSummary, setHeatmapSummary] = useState('');
  const [heatmapError, setHeatmapError] = useState<string | null>(null);
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
  // F1 / the Help card's own button both open this. See HelpOverlay.tsx for why
  // it is reachable two ways rather than one.
  const [helpOverlayOpen, setHelpOverlayOpen] = useState(false);

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
  // v2.1: the fold-out's state machine and the drawn axis both live in
  // engine/categoryTickOverlay.ts, so their branching is mutation-testable
  // rather than reachable only through a 20-minute Electron run.
  // `version` is a dependency for the same reason the memo block further down
  // documents: it is the only signal React has that the ref-held session
  // mutated, and dropping it would freeze the fold-out on its first render.
  /* eslint-disable react-hooks/exhaustive-deps */
  const categoryPanel = useMemo(
    () =>
      categoryPanelView({
        supported: session.supportsCategoryTicks(),
        isCalibrated: axes !== null,
        open: categoryPanelOpen,
        hasGeometry: session.getCategoryAxis().hasGeometry(),
        seedPixel: session.categoryTickOriginPixel(),
        edgesPlaced: categoryFirstEdge ? 1 : 0,
        placeBothEdges: categoryPlaceBothEdges,
        hasAdjustments: session.getCategoryAxis().hasAdjustments(),
      }),
    [session, version, axes, categoryPanelOpen, categoryFirstEdge]
  );
  /* eslint-enable react-hooks/exhaustive-deps */

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
    // The rail button greys out for Box Plot/categorical Line; the `4` hotkey is
    // the other door, so the rule lives here where both converge. Every OTHER
    // mechanism here is a curve tool and would record one of these types' own
    // datum wrong (a box's whiskers, an ordinal click) -- Histogram used to be
    // refused here too, until its own bounding-box path landed (2026-07-30).
    if ((session.getConfig().autoExtractKind ?? 'curve') === 'none') return;
    // ⚑ A spider or a bar has exactly ONE mechanism: the axis-aware colour trace
    // for a spider, the bounding-box colour trace for a bar. Flood-fill and Guide
    // points are curve tools with nowhere sensible to file their output (a
    // spider's slots are its axes; a bar's two slots are its measured ends, not
    // a curve to follow), so they are not offered -- and this is where the card
    // is ENTERED, so without this the last-used mechanism could open a card
    // whose button would silently do nothing.
    if (autoExtractModesFor(session.getConfig().autoExtractKind).length === 1) lastAutoExtractMechRef.current = 'color-trace';
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

  /**
   * The heatmap's own bounds, taken from what the user calibrated.
   *
   * ⚑ The grid starts as ONE cell spanning the calibration, and its outer
   * boundaries are ordinary dividers from that moment on. They are not a claim
   * about where the plot box is — they are simply the only span the session
   * knows, and detection fills in between them.
   */
  const heatmapBounds = useCallback((): { xMin: number; xMax: number; yMin: number; yMax: number } | null => {
    const placed = sessionRef.current.getPlacedPoints();
    const values = ['x1', 'x2', 'y1', 'y2'].map((k) => Number(placed[k]?.values[0]));
    if (values.some((v) => !Number.isFinite(v))) return null;
    const [x1, x2, y1, y2] = values as [number, number, number, number];
    return {
      xMin: Math.min(x1, x2),
      xMax: Math.max(x1, x2),
      yMin: Math.min(y1, y2),
      yMax: Math.max(y1, y2),
    };
  }, []);

  /** Is this a calibrated heatmap with an image to read? The card's buttons are
   * disabled rather than absent when it is not, so nothing appears out of
   * nowhere once the last calibration value is typed. */
  const heatmapActive = axesTypeId === HEATMAP_AXES_CONFIG.id;

  const declaredCount = (raw: string): number | undefined => {
    const n = Number(raw.trim());
    return raw.trim() !== '' && Number.isInteger(n) && n > 0 ? n : undefined;
  };

  /**
   * The grid as the user sees it: what has been recorded, or — before anything
   * has — the one cell a finished calibration already implies.
   *
   * ⚑⚑ THE GRID CONTROLS WERE AN INVISIBLE PRECONDITION WITHOUT THIS. The
   * overlay, the drag handles and the boundary buttons all appeared only after
   * pressing Detect or Read, and nothing on screen said so — the keystone
   * persona's named failure mode, and worst on exactly the figures that need the
   * grid most: a continuous field draws no cell boundaries at all, so detection
   * has nothing to find and its user could reasonably conclude the grid is
   * something only a drawn-grid figure gets.
   *
   * ⚑ DERIVED, NOT STORED, which is why it is a `useMemo` and not an effect
   * writing state. Nothing goes into the axes' metadata until the user actually
   * changes something: an untouched grid is recoverable from the calibration it
   * came from, and a file that carried it would be storing a copy of something
   * derivable — the same rule that keeps the colour key's SAMPLES out of the
   * project file. Every edit path below records the result.
   */
  /** The record the text boxes stand for — parsed once per render rather than at
   * each of the three places that need it. */
  const heatmapLabels = useMemo<HeatmapLabels>(
    () => ({ x: parseLabelList(heatmapXLabels), y: parseLabelList(heatmapYLabels) }),
    [heatmapXLabels, heatmapYLabels]
  );

  const heatmapShownGrid = useMemo<HeatmapState | null>(() => {
    if (!heatmapActive) return null;
    if (heatmapGrid !== null) return heatmapGrid;
    if (!session.isCalibrated()) return null;
    const bounds = heatmapBounds();
    return bounds === null ? null : initialGrid(bounds);
    // `version` is the only signal React has that the ref-held session mutated,
    // so it is listed deliberately even though the body does not read it —
    // without it this would freeze at "not calibrated yet" (see the same note
    // above the memo block further down).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmapActive, heatmapBounds, heatmapGrid, session, version]);

  /**
   * Set the grid, and put it where a save and an undo will both find it.
   *
   * ⚑ ONE PLACE, because there are two consumers that must never disagree: the
   * overlay on screen reads the state, and the project file reads the axes'
   * metadata. Writing the state without the metadata gives a grid that vanishes
   * on Save; writing the metadata without the state gives one that is saved and
   * invisible. The undo snapshot serializes the axes, so this is also what makes
   * a grid edit undoable — without any new snapshot field.
   */
  const applyHeatmapGrid = useCallback((grid: HeatmapState | null) => {
    setHeatmapGrid(grid);
    const axes = sessionRef.current.getAxes();
    if (axes) gridToAxes(axes as unknown as MetadataCarrier, grid);
  }, []);

  /**
   * The axis NAMES, recorded where the grid is recorded.
   *
   * ⚑ THE PARSED LIST IS WHAT IS SAVED, never the raw text: the file then holds
   * the record (one name per cell) instead of a punctuation style, and a reopen
   * rebuilds the line from the list. Same axes-metadata home as the grid, so
   * naming a column is saved and undone by machinery that already exists.
   *
   * ⚑ THE CELLS ARE RE-READ so the table shows the name the moment it is typed.
   * The values do not change — a name cannot move a boundary — but a table that
   * kept showing bare indices while the card said the axis was named would be
   * the same self-contradiction the detect message was.
   */
  const applyHeatmapLabels = useCallback(
    (xText: string, yText: string) => {
      setHeatmapXLabels(xText);
      setHeatmapYLabels(yText);
      const axes = sessionRef.current.getAxes();
      const grid = heatmapShownGrid;
      if (!axes || !grid) return;
      // ⚑⚑ TYPED IN READING ORDER, STORED PER CELL. The first row name belongs
      // to the row at the TOP of the figure, which is the LAST cell index on an
      // ordinary upward-y plot — see `labelsForCells`. Storing the typed order
      // verbatim filed every name against the wrong row, silently.
      const typed: HeatmapLabels = { x: parseLabelList(xText), y: parseLabelList(yText) };
      const labels = labelsForCells(typed, grid, axes);
      labelsToAxes(axes as unknown as MetadataCarrier, labels);
      setHeatmapCells((prev) =>
        prev.map((row) => ({
          ...row,
          xLabel: labels.x[row.col] ?? '',
          yLabel: labels.y[row.row] ?? '',
        }))
      );
    },
    [heatmapShownGrid]
  );

  /**
   * Take the grid back OUT of the axes — the load path, and the undo path.
   *
   * ⚑ TWO ENTRANCES, ONE CALL. A project file and an undo snapshot both arrive
   * as a serialized axes, so both restore the grid the same way. Without this
   * the metadata would be written faithfully, saved faithfully, and never read:
   * a grid that survives the round trip and does not come back on screen is
   * indistinguishable from one that was never saved.
   *
   * ⚑ `gridFromAxes` VALIDATES rather than trusts, so a hand-edited or
   * older-build file cannot install a grid the app would refuse to draw.
   */
  const restoreHeatmapGrid = useCallback(() => {
    const axes = sessionRef.current.getAxes();
    setHeatmapGrid(axes ? gridFromAxes(axes as unknown as MetadataCarrier) : null);
    // ⚑ The names come back with the grid, through the same door. A reopened
    // heatmap whose columns lost their names would export the index numbers this
    // whole feature exists to replace — and it would do it silently.
    const stored = axes ? labelsFromAxes(axes as unknown as MetadataCarrier) : { x: [], y: [] };
    // Back through the SAME mapping, which is its own inverse: the boxes show
    // the figure's reading order, the file holds the cell order.
    const restoredGrid = axes ? gridFromAxes(axes as unknown as MetadataCarrier) : null;
    const shown = restoredGrid && axes ? labelsForCells(stored, restoredGrid, axes) : stored;
    setHeatmapXLabels(formatLabelList(shown.x));
    setHeatmapYLabels(formatLabelList(shown.y));
    setHeatmapCells([]);
    setHeatmapSummary('');
    setHeatmapDetectMessage('');
    setHeatmapError(null);
  }, []);

  /**
   * A divider was dragged. Move it, or leave everything exactly as it was.
   *
   * ⚑ THE REFUSAL IS THE FEATURE. `dragDivider` will not let a boundary cross
   * its neighbour, and when it refuses, this does nothing at all — React
   * re-renders the handle from unchanged state, so it springs back to where it
   * was and the user sees the divider stop. Re-sorting instead would keep the
   * geometry valid and renumber every cell past it: every value still correct,
   * every one filed under the wrong column.
   *
   * ⚑ THE CELLS ARE RE-READ, not left stale. A table describing the previous
   * grid is a measurement of a figure that no longer exists — the rule the
   * Geometry card already follows. Re-reading only happens once cells exist, so
   * a user adjusting the grid before pressing Read cells is not surprised by a
   * table appearing under their hands.
   */
  /**
   * Record a grid the user just edited, and re-read the cells it moved.
   *
   * ⚑⚑ DETECTION'S REPORT IS CLEARED, and a screenshot is what caught this: the
   * card read *"Grid: 6 × 4 cells"* directly above *"5 columns, matching the 4
   * boundaries found"*. The sentence was true when it was written and describes
   * a proposal the user has since overruled — a panel contradicting itself about
   * the same figure, which is the fourth-and-counting instance of the class
   * `engine/guidanceTip.ts` exists to document. A report of a measurement that no
   * longer describes the grid is not stale wording, it is a wrong statement.
   */
  const applyHeatmapGridEdit = useCallback(
    (next: HeatmapState) => {
      const axesNow = sessionRef.current.getAxes();
      if (!axesNow) return;
      setHeatmapDetectMessage('');
      applyHeatmapGrid(next);
      const img = imageCanvasRef.current?.getImageData();
      if (heatmapCells.length > 0 && img) {
        const image = { data: img.data, width: img.width, height: img.height };
        const { scale } = buildColorScale(
          sessionRef.current.getPlacedPoints(),
          image,
          sessionRef.current.getOptions()['isLogValue'] === 'true'
        );
        if (scale) {
          const result = readHeatmapCells(image, axesNow, next, scale, labelsForCells(heatmapLabels, next, axesNow));
          setHeatmapCells(result.rows);
          setHeatmapSummary(result.summary);
        }
      }
      commit();
    },
    [applyHeatmapGrid, commit, heatmapCells.length, heatmapLabels]
  );

  const moveHeatmapDivider = useCallback(
    (id: string, px: number, py: number) => {
      const axesNow = sessionRef.current.getAxes();
      if (!heatmapShownGrid || !axesNow) return;
      const [dx, dy] = axesNow.pixelToData(px, py);
      if (dx === undefined || dy === undefined || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
      const next = dragDivider(heatmapShownGrid, id, { x: dx, y: dy });
      if (next === null) return; // refused: the handle springs back
      applyHeatmapGridEdit(next);
    },
    [applyHeatmapGridEdit, heatmapShownGrid]
  );

  /**
   * Add a boundary on one axis — the hand `detectGrid` tells the user to use.
   *
   * ⚑ THE NEW BOUNDARY IS SELECTED IMMEDIATELY. It lands in the middle of the
   * widest cell, which is where a missed rule usually is but not always where
   * this user wants it; selecting it puts its position in the card in the
   * figure's own units, so a change that could otherwise be hunted for is
   * announced.
   */
  const addHeatmapDivider = useCallback(
    (axis: 'x' | 'y') => {
      if (!heatmapShownGrid) return;
      const added = addDivider(heatmapShownGrid, axis);
      if (added === null) {
        setHeatmapError('There is no room for another boundary — the widest cell is already as thin as a boundary.');
        return;
      }
      setHeatmapError(null);
      setSelectedDividerId(added.handleId);
      applyHeatmapGridEdit(added.grid);
    },
    [applyHeatmapGridEdit, heatmapShownGrid]
  );

  /** Remove the boundary whose handle is selected, merging its two cells. The
   * model refuses to take an axis below one cell; the button is disabled for
   * that case, so the refusal is read before it can fire. */
  const removeHeatmapDivider = useCallback(() => {
    if (!heatmapShownGrid || !selectedDividerId) return;
    const next = removeDividerHandle(heatmapShownGrid, selectedDividerId);
    if (next === null) return;
    setSelectedDividerId(null);
    applyHeatmapGridEdit(next);
  }, [applyHeatmapGridEdit, heatmapShownGrid, selectedDividerId]);

  /** What the card shows about the picked boundary. Recomputed from the GRID
   * rather than remembered at click time, so a boundary that has since been
   * dragged reads out where it is now — and one that stopped existing (undo, a
   * reopened file, a fresh detection) stops being offered for removal. */
  const selectedBoundary = useMemo(() => {
    if (!heatmapShownGrid || !selectedDividerId) return null;
    const found = describeDivider(heatmapShownGrid, selectedDividerId);
    return found === null ? null : { axis: found.axis, value: found.value };
  }, [heatmapShownGrid, selectedDividerId]);

  const runHeatmapDetect = useCallback(() => {
    setHeatmapError(null);
    const img = imageCanvasRef.current?.getImageData();
    const axes = sessionRef.current.getAxes();
    const bounds = heatmapBounds();
    if (!img || !axes || !bounds) {
      setHeatmapError('Finish the calibration first — the grid is measured against it.');
      return;
    }
    const start = heatmapShownGrid ?? initialGrid(bounds);
    const result = detectGrid({ data: img.data, width: img.width, height: img.height }, axes, start, {
      ...(declaredCount(heatmapColumns) !== undefined ? { columns: declaredCount(heatmapColumns)! } : {}),
      ...(declaredCount(heatmapRows) !== undefined ? { rows: declaredCount(heatmapRows)! } : {}),
    });
    setHeatmapDetectMessage(result.message);
    // ⚑ A refused detection leaves the PREVIOUS grid alone. Replacing it with
    // nothing would throw away work the user had already accepted, to report a
    // failure the message has already reported.
    if (result.grid !== null) applyHeatmapGrid(result.grid);
  }, [applyHeatmapGrid, heatmapBounds, heatmapShownGrid, heatmapColumns, heatmapRows]);

  const runHeatmapRead = useCallback(() => {
    setHeatmapError(null);
    const img = imageCanvasRef.current?.getImageData();
    const axes = sessionRef.current.getAxes();
    const bounds = heatmapBounds();
    if (!img || !axes || !bounds) {
      setHeatmapError('Finish the calibration first — the cells are read through it.');
      return;
    }
    const image = { data: img.data, width: img.width, height: img.height };
    const { scale, error } = buildColorScale(
      sessionRef.current.getPlacedPoints(),
      image,
      sessionRef.current.getOptions()['isLogValue'] === 'true'
    );
    if (scale === null) {
      setHeatmapError(error);
      setHeatmapCells([]);
      setHeatmapSummary('');
      return;
    }
    const grid = heatmapShownGrid ?? initialGrid(bounds);
    const result = readHeatmapCells(image, axes, grid, scale, labelsForCells(heatmapLabels, grid, axes));
    applyHeatmapGrid(grid);
    setHeatmapCells(result.rows);
    setHeatmapSummary(result.summary);
    setHeatmapError(result.error);
  }, [applyHeatmapGrid, heatmapBounds, heatmapLabels, heatmapShownGrid]);

  /**
   * The grid drawn on the figure: one line per divider, spanning the grid's own
   * extent on the other axis.
   *
   * ⚑ Built through the axes' `dataToPixel`, so a rotated calibration draws a
   * rotated grid — the lines land on the figure's own cells rather than on the
   * screen's rows and columns.
   */
  const heatmapOverlay = useMemo(() => {
    if (!heatmapShownGrid) return null;
    const axes = session.getAxes();
    if (!axes) return null;
    const xs = heatmapShownGrid.xDividers;
    const ys = heatmapShownGrid.yDividers;
    if (xs.length < 2 || ys.length < 2) return null;
    const yLo = ys[0]!;
    const yHi = ys[ys.length - 1]!;
    const xLo = xs[0]!;
    const xHi = xs[xs.length - 1]!;
    return [
      ...xs.map((x) => [axes.dataToPixel(x, yLo), axes.dataToPixel(x, yHi)]),
      ...ys.map((y) => [axes.dataToPixel(xLo, y), axes.dataToPixel(xHi, y)]),
    ];
  }, [heatmapShownGrid, session]);

  // A text/color field edit is "pending" between its first keystroke and the
  // blur that ends it -- tracked so commitPendingEdit only pushes an undo
  // entry when something actually changed, not on a bare focus+blur.
  const pendingEditRef = useRef(false);
  const commitPendingEdit = useCallback(() => {
    if (!pendingEditRef.current) return;
    pendingEditRef.current = false;
    commit();
  }, [commit]);
  /** Mark a text edit in progress from a handler declared ABOVE the ref.
   *
   * ⚑ The React Compiler refuses a ref mutation that appears earlier in the
   * component than the `useRef` it belongs to — and it reports the refusal at
   * every OTHER mutation site, eight of them, in code that had not changed.
   * Same unmasking trap the v2.1 split hit: the compiler stops at its first
   * bailout, so one new one makes a pile of latent ones visible at once. */
  const markPendingEdit = useCallback(() => {
    pendingEditRef.current = true;
  }, []);

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
    // ⚑ An auto-extract mode must also drop when it is not one the RESTORED
    // config actually offers (59f94a6 closed the rail button and the `4`
    // hotkey, but not this door). Undoing back across a graph-type change
    // rebuilds the session under the snapshot's config while the MODE is
    // untouched, so e.g. a Box Plot could be left sitting in segment-fill with
    // the fold-out open and the stage handler live -- confidently wrong
    // numbers (a box's whiskers, not a curve to flood-fill). Found by the v1.3
    // gate. openProject/restoreFigure already reset the mode; this path did
    // not. Generalized (v2.0 Phase 7) off autoExtractModesFor rather than
    // "any bar-family type": Bar itself now offers color-trace (bounding-box
    // detection), so it alone must NOT be kicked out of that one mechanism.
    setMode((m) => (AUTO_EXTRACT_MODES.includes(m) && !autoExtractModesFor(s.getConfig().autoExtractKind).includes(m) ? 'place-point' : m));
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
      restoreHeatmapGrid(); // the grid rides in the axes metadata the snapshot carries
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
        // v2.0 pre-launch audit: every FORWARD image-changing path (crop/
        // rotate/flip/deskew) already clears the By-colour trace region here
        // (audit C, 2026-07-22) because it's stored in raw pixel coordinates
        // that are meaningless against a different image -- restoreDoc, the
        // one function ALL undo/redo goes through across an image edit, was
        // the one entrance that didn't. Undo/redo back across an edit left a
        // stale region that silently searched the wrong pixel space on the
        // next By-colour trace.
        setColorTraceRegion(null);
      }
      syncAfterRestore();
      bump();
    },
    [applyMeasurements, applyMeasureScale, applyProvenance, restoreHeatmapGrid, setPending, setColorTraceRegion, syncAfterRestore, bump]
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
      const resolved = resolveKeyDown(
        {
          key: e.key,
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          targetIsTextField: !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable),
        },
        {
          mode,
          measureTool,
          figureCaptured,
          canvasHasImage,
          isCalibrated: axes !== null,
          hasCropRect: cropRect !== null,
          cropMode,
          ctxMenuOpen: ctxMenu !== null,
          settingScale,
          pendingMeasureCount: pendingMeasure.length,
          selectedPointCount: selectedPointIndices.length,
          activePointIndex,
          activeHandleKey,
          hasActiveMeasure: activeMeasure != null,
          canvasScale,
          // Suppliers: only Q/W and the `6` key need these, and building them
          // on every keydown would walk every point of a dense trace once per
          // keystroke typed into a rename field. See KeyboardState's own note.
          dataPointRoles: () => session.getDataPointRoles(),
          autoExtractKind: session.getConfig().autoExtractKind,
          hasAnyPoints: () => session.getDatasetInfos().some((d) => d.pointCount > 0),
        }
      );
      if (!resolved) return;
      const { action, preventDefault } = resolved;
      // `'if-present'` branches preventDefault themselves, once they know their
      // target exists -- the one thing the pure resolver cannot see.
      if (preventDefault === true) e.preventDefault();

      switch (action.type) {
        case 'undo': undo(); return;
        case 'redo': redo(); return;
        case 'apply-crop': applyCrop(); return;
        case 'finish-area': finishArea(); return;
        case 'cancel-crop': cancelCrop(); return;
        case 'close-context-menu': setCtxMenu(null); return;
        case 'abandon-pending-measure':
          setPending([]);
          setSettingScale(false);
          setScaleDraftPx(null);
          setMeasureError(null);
          return;
        case 'clear-marquee': setSelectedPointIndices([]); return;
        case 'clear-active-point': setActivePointIndex(null); return;
        case 'clear-active-handle': setActiveHandleKey(null); return;
        case 'clear-active-measure': setActiveMeasure(null); return;
        case 'nudge-handle': {
          const h = session.getPlacedPoints()[action.handleKey];
          if (!h) return;
          e.preventDefault();
          session.updateCalibPointPixel(action.handleKey, h.px + action.dx, h.py + action.dy);
          nudgePendingRef.current = true;
          bump();
          return;
        }
        case 'nudge-measure': {
          if (!activeMeasure) return;
          // The label anchor follows the points' centroid so it stays attached
          // to the measurement as a vertex moves.
          applyMeasurements(
            measurementsRef.current.map((m) => {
              if (m.id !== activeMeasure.id) return m;
              const points = m.overlay.points.map((p, i) =>
                i === activeMeasure.vertex ? { x: p.x + action.dx, y: p.y + action.dy } : p
              );
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
        case 'nudge-selection': {
          const pts = session.getDataPoints();
          for (const i of selectedPointIndices) {
            const p = pts[i];
            if (p) session.updateDataPointPixel(i, p.px + action.dx, p.py + action.dy);
          }
          nudgePendingRef.current = true;
          bump();
          return;
        }
        case 'nudge-point': {
          const p = session.getDataPoints()[action.index];
          if (!p) return;
          e.preventDefault();
          session.updateDataPointPixel(action.index, p.px + action.dx, p.py + action.dy);
          nudgePendingRef.current = true;
          bump();
          return;
        }
        case 'delete-selection':
          session.removeDataPoints(selectedPointIndices);
          setSelectedPointIndices([]);
          setActivePointIndex(null);
          commit();
          return;
        case 'delete-point': removeActivePoint(); return;
        case 'delete-measurement':
          if (!activeMeasure) return;
          applyMeasurements(measurementsRef.current.filter((m) => m.id !== activeMeasure.id));
          setActiveMeasure(null);
          commit();
          return;
        case 'select-point':
          setActivePointIndex(action.index);
          setPickedPointIndex(action.index);
          return;
        case 'set-mode': setMode(action.mode); return;
        case 'select-tool': setMode('select'); setSelectFoldoutOpen(false); return;
        case 'toggle-image-edit': toggleImageEdit(); return;
        case 'toggle-auto-extract': toggleAutoExtract(); return;
        case 'toggle-error-bars': toggleErrorBars(); return;
        case 'toggle-measure': toggleMeasure(); return;
        case 'click': {
          const btn = document.querySelector(action.selector) as HTMLElement | null;
          if (!btn) return;
          if (preventDefault === 'if-present') e.preventDefault();
          btn.click();
          return;
        }
        case 'consume': return;
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (isNudgeRelease(e.key, nudgePendingRef.current)) {
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
      // ⚑ The heatmap's grid and its cells describe the figure that just went
      // away. A stale matrix left on screen is a measurement of a figure that no
      // longer exists — the same rule the Geometry card follows, and the reason
      // this clearing belongs in the SHARED swap rather than in one caller.
      setHeatmapGrid(null);
      setHeatmapCells([]);
      setHeatmapDetectMessage('');
      setHeatmapSummary('');
      setHeatmapError(null);
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
  const exportBaseName = useCallback(
    (): string => baseNameForExport(imageNameRef.current, provenanceRef.current.source?.name),
    []
  );

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
          ? [{ id, name: ex.name, family: meta.family, grade: meta.grade, instruction: meta.instruction, truth: meta.truth, axesConfigId: ex.axes, imageSrc: ex.src }]
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
      const inputs = calibrationInputsFromAnchors(ex.truth.calibration);
      // ⚑ Grow the REPEATING step first. A spider's six spokes and a pie's four
      // outline points are steps that do not exist until asked for, and a session
      // sitting at the step minimum silently keeps only the first three placed
      // points -- a calibration that looks adopted and is a different figure.
      while (sessionRef.current.getRepeatCount() < (inputs.repeatCount ?? 0)) {
        if (!sessionRef.current.addRepeat()) break;
      }
      // ⚑ The boolean matters. A truth file whose anchors no longer calibrate
      // yields a round that LOOKS playable, records points with no data, and
      // scores as all-misses -- with the one surface carrying the reason
      // (`getCalibrationError`) folded away on the next line.
      const adopted = sessionRef.current.adoptCalibration(inputs);
      if (!adopted) setCalibExpanded(true);
      imageCanvasRef.current?.loadImageFromSrc(dataURL, ex.name);
      // The example IS the whole figure-of-record: capture it (a no-op crop) so the
      // player can place points -- without this, capture stays pending and every
      // click is blocked ("Frame the whole figure... press Capture").
      setFigureCaptured(true);
      // the player didn't calibrate -- don't clutter/occlude with the calib card,
      // unless the adoption failed, in which case that card is the explanation
      if (adopted) setCalibExpanded(false);
      setMode('place-point');
      setRoundStartMs(Date.now());
      bump();
    },
    [resetDocument, closePdf, bump]
  );

  const startChallenge = useCallback(() => {
    if (!confirmDiscardIfDirty()) return;
    // ⚑ WEIGHTED, not uniform (David, 2026-08-10): two easy, one medium, one
    // hard. The pool spans a factor of ten in clicks -- 61 for the stress-strain
    // curve against 6 for a spider -- and the scoring currency is TIME, so a
    // uniform draw made one playthrough's score incomparable with another's.
    const rounds = drawGradedRounds(challengePool, (r) => r.grade);
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
    } else if (ex.family === 'spider') {
      // ⚑ Scored as a SCATTER over (spoke index, value as a fraction of that
      // spoke). The index is the x coordinate, so a spoke left empty is a MISS on
      // that spoke instead of shifting every later reading onto the wrong axis --
      // see truthSpiderPoints for why the ordered scorer is wrong here.
      const values = session.getSpiderTable().columns[0]?.values ?? [];
      score = scoreRound(
        'scatter',
        [spiderUserPoints(values, ex.truth)],
        [truthSpiderPoints(ex.truth)],
        spiderAxisRanges(ex.truth),
        rawSeconds
      );
    } else if (ex.family === 'pie') {
      // The slice's value is DERIVED from its two boundaries, so the tuple's own
      // `derived` is the reading -- neither member is the number being scored.
      // Order is capture order, which the instruction pins to 12 o'clock.
      const items = derivedTupleItems(session.getTupleRows(), 'capture');
      score = scoreOrderedRound(items, truthPieValues(ex.truth), truthValueRange(ex.truth), rawSeconds);
    } else if (ex.family === 'bar') {
      // ⚑ One value per TUPLE, ranked left-to-right -- not one per PIXEL. A bar
      // is a two-slot interval captured as a drag-box, so the dataset holds two
      // corners per bar and the reading is the tuple's derived value. Reading
      // pixels charged ~193 seconds on a flawless six-bar trace and only scored
      // "right" for a player who single-clicked, which captures no bar at all.
      const items = derivedTupleItems(session.getTupleRows(), 'left-to-right');
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
      const snapped = snapToNearestPoint(px, py, session.getDataPoints(), canvasScale);
      const result = resolveMeasureClick({
        point: snapped,
        pending: pendingMeasureRef.current,
        settingScale,
        tool: measureTool,
        slopeReady: !!axes && config.axesKind === 'xy',
        toData: axes ? (x, y) => axes.pixelToData(x, y) : null,
      });
      switch (result.kind) {
        case 'refuse':
          setMeasureError(result.message);
          return;
        case 'collect':
          if (!settingScale) setMeasureError(null);
          setPending(result.points);
          return;
        case 'scale-draft':
          setPending(result.points);
          setScaleDraftPx(result.distancePx);
          return;
        case 'record': {
          setMeasureError(null);
          const id = `meas-${(measureIdRef.current += 1)}`;
          // `label` is a placeholder: the canvas label is DERIVED at render (see
          // the measureOverlays memo), so a later re-calibration updates it.
          // ⚑ fmtNum already returns '∞' for a non-finite number, so the old
          // `finite ? fmtNum(slope) : '∞'` ternary was a second copy of that rule.
          const overlay: MeasureOverlay = {
            id,
            points: result.points,
            label: result.slope !== undefined ? fmtNum(result.slope) : '',
            labelAt: result.labelAt,
          };
          applyMeasurements([{ id, tool: result.tool, overlay }, ...measurementsRef.current]);
          setPending([]);
          commit();
          return;
        }
      }
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
      // v2.1: while the fold-out is asking for the category axis, a click places
      // an edge and nothing else -- checked BEFORE the ordinary routing, so a
      // marking click cannot also drop a data point.
      if (isMarkingCategoryAxis(categoryPanel)) {
        const seed = session.categoryTickOriginPixel();
        const first =
          categoryFirstEdge ?? (categoryPanel.canReuseSeed && seed ? { x: seed.px, y: seed.py } : null);
        if (!first) {
          setCategoryFirstEdge({ x: px, y: py });
          return;
        }
        if (session.markCategoryAxis(first, { x: px, y: py })) {
          setCategoryFirstEdge(null);
          setCategoryMarkError(null);
          setCategoryPlaceBothEdges(false);
          setCategoryCountInput(String(session.getCategoryAxis().getCategoryCount() || ''));
          commit();
        } else {
          // ⚑ Say why. The only way this refuses is a zero-length axis -- the
          // second click landing on the first edge -- and without this the click
          // did nothing, the prompt was unchanged, and the app simply appeared
          // to ignore the user.
          setCategoryMarkError('too-close');
        }
        return;
      }
      const route = routeCanvasClick({ eyedropper, mode, figureCaptured });
      switch (route.kind) {
        case 'sample-colour': {
          // px/py are native image-pixel coords (same space Segment Fill uses),
          // so they index straight into getImageData().
          const imageData = imageCanvasRef.current?.getImageData();
          if (imageData) {
            const x = Math.max(0, Math.min(imageData.width - 1, Math.round(px)));
            const y = Math.max(0, Math.min(imageData.height - 1, Math.round(py)));
            const o = (y * imageData.width + x) * 4;
            const rgb = [imageData.data[o]!, imageData.data[o + 1]!, imageData.data[o + 2]!] as [number, number, number];
            if (route.target === 'grid') {
              setGridRemovalColor(rgbToHex(rgb));
            } else if (route.target === 'trace') {
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
        case 'ignore':
          return;
        case 'clear-selection':
          setSelectedPointIndices([]);
          setActivePointIndex(null);
          return;
        case 'measure':
          handleMeasureClick(px, py);
          return;
        case 'capture-first':
          setProjectError(route.message);
          return;
        case 'calibrate': {
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
        case 'segment-fill': {
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
        case 'interpolate': {
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
        case 'add-point': {
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
          return;
        }
      }
    },
    [session, mode, bump, commit, segmentFillThreshold, eyedropper, handleMeasureClick, figureCaptured, categoryPanel, categoryFirstEdge]
  );

  // Bar capture (v2.0): a drag's two opposite corners become a bar's two
  // measured ends in one gesture -- both real pixels, never a baseline
  // assumed for the near one. A near-zero drag (a plain click) falls back to
  // filling one slot at a time, the same generic mechanism every other
  // slotted type already uses (see the tips-bar copy above for why both work,
  // and boxMode's own gating below for when this fires at all).
  const handleBoxRect = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const isClick = Math.abs(end.x - start.x) < 3 && Math.abs(end.y - start.y) < 3;
      session.addDataPoint(start.x, start.y);
      if (!isClick) session.addDataPoint(end.x, end.y);
      const placed = session.getDataPoints();
      setActivePointIndex(placed.length - 1);
      setPickedPointIndex(null);
      commit();
    },
    [session, commit]
  );

  // Click a data dot to make it the active point (checkpoint 58). Only the active
  // series' own markers carry the `point-` id; inactive series aren't selectable
  // (select the series in the dropdown first).
  const handleMarkerClick = useCallback((id: string, shiftKey?: boolean) => {
    // A grid handle is not a calibration point and not a datum: clicking one
    // picks the BOUNDARY, which is what the Heatmap card then offers to remove.
    if (isDividerHandle(id)) {
      setSelectedDividerId(id);
      setActivePointIndex(null);
      setActiveHandleKey(null);
      return;
    }
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
      // Common origin: on arriving at the reusing step, take the shared corner's
      // pixel and prefill its value, so the user never places or reuses it by
      // hand -- they just confirm. Which steps those are is the TYPE's to
      // declare (config.commonOrigin), not this file's to name.
      const reuse = commonOriginReuse(
        config,
        commonOrigin,
        session.getCurrentStep()?.key,
        session.getPlacedPoints()
      );
      if (reuse) {
        session.reuseStepPixel(reuse.from);
        setDataValueInputs(reuse.prefill);
      } else {
        setDataValueInputs([]);
      }
      commit();
    }
  }, [session, dataValueInputs, commit, commonOrigin, config]);

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
      if (isDividerHandle(id)) {
        moveHeatmapDivider(id, x, y);
        return;
      }
      const tickIndex = categoryTickIndexFromId(id);
      if (tickIndex !== null) {
        // The model clamps it between its neighbours, so a tick can never cross
        // another and silently reassign two categories.
        session.moveCategoryTick(tickIndex, { x, y });
        commit();
        return;
      }
      if (id.startsWith('point-')) {
        session.updateDataPointPixel(Number(id.slice('point-'.length)), x, y);
      } else {
        session.updateCalibPointPixel(id, x, y);
      }
      commit();
    },
    [session, commit, moveHeatmapDivider]
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

  // Rename a bar CATEGORY from the shared table (v2.0) -- the bar-table
  // counterpart of setSpokeName above. Renames the canonical CategoryAxis
  // entry directly (session.renameCategory), so every series sharing this
  // category picks up the new name at once. Same text-edit-commits-on-blur
  // rule as every other spreadsheet field here.
  const renameCategory = useCallback(
    (categoryIndex: number, name: string) => {
      if (!session.renameCategory(categoryIndex, name)) return;
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
    // ⚑ Returns the chosen path, or NULL when the user cancels the OS dialog.
    // Callers use this to decide whether anything was actually persisted --
    // marking the document clean on a cancel loses the work silently, with no
    // file written and no prompt on the next close. (v2.0 audit, round 2.)
    return await window.electronAPI!.saveFile(
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
      const savedPath = await saveProjectZipBytes(zip, figs[activeFigureIndex]?.name ?? 'figures');
      if (savedPath) markClean(); // only a real write clears the unsaved flag
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
    const savedPath = await saveProjectZipBytes(zip, stem);
    if (savedPath) markClean(); // persisted -> no longer unsaved; a cancel is not a save
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
      categoryAxis?: CategoryAxis;
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
      newSession.loadCalibrated(fig.axes, fig.datasets, fig.categoryAxis);
      sessionRef.current = newSession;
      setColorTraceRegion(null); // new figure's pixel space -> old trace region is stale (audit A1)
      // ⚑ The fold-out's own inputs are per-figure too. Without this the
      // Categories box showed the PREVIOUS figure's number (or nothing) beside
      // the ticks the loaded one actually has, and a stale "same point" refusal
      // from ten minutes ago sat there in red (v2.1 audit).
      restoreHeatmapGrid(); // a saved heatmap reopens with the grid it was saved with
      setCategoryCountInput(String(newSession.getCategoryAxis().getCategoryCount() || ''));
      setCategoryFirstEdge(null);
      setCategoryMarkError(null);
      setCategoryPlaceBothEdges(false);
      setCategoryPanelOpen(false);

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
    [history, bump, markClean, applyMeasurements, applyMeasureScale, restoreHeatmapGrid, setPending, captureDoc, applyProvenance, applyPdfState, closePdf, clearFiguresToSingle]
  );

  // === Multi-figure session (checkpoint 110, design §1/§8) ===

  /** Install a stashed FigureRecord as the live figure. The sibling of
   * loadCalibratedFigure, but from an already-live session OBJECT (no
   * re-deserialize): the figure's calibration and points travel unchanged. Resets
   * the same per-panel UI swapSession does, restores the figure's document state,
   * and pushes its baked image to the canvas. Undo history resets to the restored
   * state (per-figure undo is a later refinement). */
  const restoreFigure = useCallback(
    (rec: FigureRecord, fromPersistedSource = false) => {
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
      // ⚑ ONLY a genuine load matches its source. This function is also the
      // body of a figure SWITCH, where nothing has been persisted -- the
      // outgoing figure's work has merely been stashed in memory. Marking
      // clean there let a whole multi-figure session close with no
      // unsaved-work prompt and both figures discarded, because dirtyRef is
      // re-armed in only two places and neither runs on a switch.
      // (v2.0 audit, round 2.)
      if (fromPersistedSource) markClean();
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
      s.loadCalibrated(f.axes as CalibratedAxes, f.datasets, f.categoryAxis);
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
    // ⚑ `setWpdFigures` is a useState setter and therefore stable, so listing it
    // changes nothing at runtime -- but the React Compiler infers it as a
    // dependency, and a manual array that disagrees with the inferred one makes
    // it skip optimizing the WHOLE component. Both errors were latent: the
    // compiler stops at its first bailout, and an earlier one was masking these
    // until the guidance-tip extraction removed it.
    [loadCalibratedFigure, setWpdFigures]
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
  }, [importWpdFigureAt, setWpdFigures]);

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
          restoreFigure(records[0]!, true); // opened from a file -> matches its source
        } else {
          figuresRef.current = records;
          setActiveFigureIndex(multi.activeFigure);
          // restoreFigure installs the active figure's session, image, measurements,
          // provenance and (retained) source, and resets undo/dirty (loaded == clean).
          restoreFigure(records[multi.activeFigure]!, true); // opened from a file
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
      categoryAxis: result.categoryAxis,
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
        // ⚑ Resolved here for the same reason `measures` is: a heatmap's cells
        // are read from the IMAGE through the grid, and neither the image nor
        // the reading lives in the session. Empty until the user has pressed
        // Read cells, which the export reports as an empty table rather than
        // inventing one.
        heatmapCells: heatmapCellsRef.current,
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

      await window.electronAPI.saveFile(content, `${exportBaseName()}.${ext}`, [
        { name: EXPORT_FILTER_NAMES[format], extensions: [ext] },
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
      // ⚑ F1 OPENS THE "HOW TO USE" CARD, not the Help dropdown (David, v2.0:
      // "something you can call up with F1... things to help you directly in
      // the moment"). It used to click the Help trigger, which was right when
      // that dropdown was the only help surface -- but the dropdown holds
      // examples and attribution, and neither is what you want mid-calibration.
      //
      // The Help dropdown loses its key and keeps its BUTTON, which is a
      // labelled, visible control in the top bar, so nothing became
      // undiscoverable. The overlay is reachable from that same dropdown, so
      // the key is a shortcut to something you can also find by looking.
      if (e.key === 'F1') {
        e.preventDefault();
        setHelpOverlayOpen(true);
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
    const refusal = colorTraceRefusal({
      isCalibrated: session.getAxes() !== null,
      autoExtractKind: config.autoExtractKind,
      hasSlots: session.hasSlots(),
      hasImage: !!imageCanvasRef.current?.getImageData(),
    });
    if (refusal) {
      setColorTraceInfo(refusal);
      return;
    }
    const imageData = imageCanvasRef.current!.getImageData()!;
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
      const placed = session.addSpiderTracePoints(result.readings.map((r) => r.point));
      setColorTraceInfo(spiderTraceReport({ readings: result.readings, placed, matched: result.matched, width, height }));
      if (placed > 0) {
        adoptTracedColour();
        commit();
      }
      return;
    }
    // ⚑ THE BAR TRACE (v2.0 Phase 7, extended to Histogram bins 2026-07-30) --
    // the direct fix for the defect the spider comment above describes: every
    // mechanism below this point reduces the colour mask to a column-average
    // or a blob CENTROID, either of which reads the MIDDLE of a filled shape,
    // never its end (`59f94a6`). A blob's own bounding box IS its measured
    // ends, so nothing here is averaged away -- see engine/barDetectRun.ts.
    // One box per detected shape, filed through the identical two-corner path
    // a manual drag-box uses (addBarDetectBoxes), which is also what decides
    // opposite-corners-vs-top-corners per type -- this handler stays type-
    // agnostic. `noun` names whichever the active type actually captures.
    if (config.autoExtractKind === 'bounding-box') {
      const noun = config.tupleNoun ?? 'bar';
      // v2.1: hand the declared category geometry to the detector, so a merged
      // run of touching same-coloured bars is cut at the dividers the user
      // marked. Null when nothing is declared, which is exactly the pre-v2.1
      // call -- the un-ticked path is unchanged.
      const declared = session.categoryDividersForDetect();
      // ⚑ `expected` only when a count was actually DECLARED. Passing the plain
      // category count made it 0 on an axis marked without one, and "0 expected"
      // is not a claim anybody made.
      const declaredCount = session.getCategoryAxis().hasDeclaredCount()
        ? session.getCategoryAxis().getCategoryCount()
        : undefined;
      const result = runBarDetect(data, width, height, target, colorTraceTolerance, 'foreground', colorTraceRegion ?? undefined, { minDiameter: colorTraceMinBlob }, declared ? { dividers: declared.dividers, categoryAxis: declared.categoryAxis, ...(declaredCount !== undefined ? { expected: declaredCount } : {}) } : undefined);
      if ('error' in result) {
        setColorTraceInfo(result.error);
        return;
      }
      const added = session.addBarDetectBoxes(result.boxes);
      adoptTracedColour();
      // ⚑ Name the categories that came back empty. The split reports them by
      // BAND, which is image order -- `categoryIndexOfBand` maps that back to the
      // category the user declared, which is the axis's own order and runs the
      // other way whenever the axis was marked right-to-left or bottom-to-top.
      const missing = (result.expectation?.emptyBands ?? []).map((band) => {
        const idx = session.categoryIndexOfBand(band, declared?.reversed ?? false);
        const name = session.getCategoryAxis().getCategories()[idx];
        return name && name.length > 0 ? name : `Category ${idx + 1}`;
      });
      setColorTraceInfo(
        barTraceReport(added, noun, result.matched, width, height) + categoryMissReport(missing)
      );
      commit();
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
      setColorTraceInfo(blobTraceReport(result.blobs, result.matched, width, height));
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
    setColorTraceInfo(curveTraceReport(result.points.length, result.matched, width, height));
    commit();
  }, [session, config.autoExtractKind, config.tupleNoun, colorTraceColor, colorTraceTolerance, colorTraceShape, colorTraceMinBlob, colorTraceRegion, commit]);

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

  // ⚑ See handleSelectDataset for the requirement this mirrors: per-series
  // draft state must not leak into the series that takes its place.
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
      // v2.0 pre-launch audit: unlike handleSelectDataset, this never cleared
      // the point selection. removeDataset can reassign which series is
      // active (session.removeDataset's own fallback logic), so a stale
      // activePointIndex/selectedPointIndices left pointing at the OLD
      // active series' point silently acts on a point in the NEW active
      // series instead -- the next Delete/Backspace or arrow-key nudge
      // mutates data in a series the user never selected. Only clear when
      // the removed series WAS the active one: removing a different series
      // leaves the active one's own points untouched, so its selection is
      // still valid and must not be disturbed (same care as
      // switchActiveDataset's own no-op-preserve fix at the engine layer).
      const removingActive = index === session.getActiveDatasetIndex();
      session.removeDataset(index);
      if (removingActive) {
        setActivePointIndex(null);
        setSelectedPointIndices([]);
        // ⚑ The SAME per-series draft state handleSelectDataset clears, and for
        // its stated reason: a half-typed name belongs to the series it was
        // typed on, and the Closed-curve toggle must not leak into a series
        // that has no geometry. Removing the active series is at least as much
        // of a switch as selecting one. (Round-2 audit.)
        setNameDraft(null);
        setNameNotice(null);
        setGeometryClosed(getGeometryState(session.getDataset())?.closed ?? false);
      }
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
  // The bar table: one ROW per category, one COLUMN per series (v2.0), the
  // same shape spiderTable uses above, replacing Bar's own per-series
  // switching table (David: "we need to store them, series by series, as
  // columns. Like this [spider's table]").
  const barTable = useMemo(() => session.getBarCategoryTable(), [session, version]);
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
  // Declared by the type when its datum is the TUPLE rather than its members — the
  // pie's slice value, which lives in the difference between its two boundaries.
  const derivedTupleColumn = config.derivedTupleValue ?? null;
  const axesOptions = useMemo(() => session.getOptions(), [session, version]);
  const isHistogram = axesTypeId === HISTOGRAM_AXES_CONFIG.id;
  // The graph type names its own tuples; Box Plot's "box" is only the default
  // because it got here first (see AxesTypeConfig.tupleNoun).
  const tupleNoun = session.getConfig().tupleNoun ?? 'box';
  const histogramBins = useMemo(() => session.getHistogramBins(), [session, version]);
  const currentGroupLabel = useMemo(() => session.getCurrentSlotLabel(), [session, version]);
  const currentTupleIndex = useMemo(() => session.getCurrentTupleIndex(), [session, version]);
  const currentGroupIndex = useMemo(() => session.getCurrentSlotIndex(), [session, version]);
  const captureProgress = useMemo(
    () =>
      describeCaptureProgress({
        slotLabel: currentGroupLabel,
        tupleIndex: currentTupleIndex,
        tupleNoun,
        dataset: session.getDataset(),
      }),
    [session, version, currentGroupLabel, currentTupleIndex, tupleNoun]
  );
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
  const categoryOverlay = useMemo(() => {
    const ca = session.getCategoryAxis();
    return { edges: ca.getAxisEdges(), tickPoints: ca.getTickPoints() };
  }, [session, version]);
  const categoryGlyphs = useMemo(() => categoryAxisGlyphs(categoryOverlay), [categoryOverlay]);
  const categoryMarkers = useMemo(() => categoryTickMarkers(categoryOverlay), [categoryOverlay]);

  /**
   * A grab handle on every heatmap divider — ORDINARY CANVAS MARKERS, so they
   * inherit dragging, hit-testing and the zoom/pan transform from the machinery
   * every other handle already uses. The category ticks took the same route for
   * the same reason.
   *
   * ⚑ No label. A divider's identity is its POSITION, which the line already
   * shows; twelve captions reading "hmx:3" across the bottom of a figure would
   * be noise over the one thing the user is trying to look at.
   *
   * ⚑ THE SELECTED HANDLE IS DRAWN BIGGER, because the card names a boundary in
   * data units and the user has to find it among a dozen identical squares. The
   * card and the canvas are one gesture, so the pick has to be visible in both.
   */
  const heatmapHandles = useMemo<CanvasMarker[]>(() => {
    if (!heatmapShownGrid) return [];
    const axesNow = session.getAxes();
    if (!axesNow) return [];
    return dividerHandles(heatmapShownGrid, axesNow).map((h) => ({
      id: h.id,
      x: h.x,
      y: h.y,
      label: '',
      color: HEATMAP_GRID_COLOR,
      draggable: true,
      kind: 'calibration' as const,
      radius: h.id === selectedDividerId ? 7 : 4,
    }));
  }, [heatmapShownGrid, selectedDividerId, session]);
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
    // ⚑ Spider and pie are revealed from RECORDED PIXELS in the truth file, not
    // from a projection: a spoke's true point interpolates between the two
    // anchors it was calibrated from, and a pie's true edges are stored outright.
    if (ex.family === 'spider') {
      const pts = (ex.truth.series[0]?.points ?? []).map((p, i) =>
        spiderPointAt(ex.truth.calibration, ex.truth, i, Number(p.value))
      );
      const ring = pts.filter((q): q is { x: number; y: number } => q !== null);
      // The closed profile, plus each true reading as its own marker -- the ring
      // shows the shape, the markers show where each answer sat on its axis.
      return { curves: ring.length > 1 ? [[...ring, ring[0]!]] : [], markers: ring };
    }
    if (ex.family === 'pie') {
      const slices = ex.truth.calibration.slices ?? [];
      return { curves: pieRevealRays(slices), markers: [] };
    }
    // bar/box have no x calibration -> draw the true values as horizontal lines
    // from the value-axis anchors (bar: each value; box: each median).
    const cal = ex.truth.calibration;
    const x0 = singleAnchor(cal, 'p1')?.px ?? 0;
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

  // ⚑ THE CLOSING CLICK, SHOWN. Recognising a click on the first boundary is worth
  // nothing if only its author knows it is possible -- that is the "shortcut-only
  // path" the keystone rule names as a failure. So while closing is available the
  // first boundary says so on the figure itself, in the place the click has to go,
  // and stops saying it the moment it stops being true.
  const ringClosingIndex = useMemo(() => {
    if (config.axesKind !== 'pie' || !axes) return null;
    const first = dataPoints[0];
    if (!first) return null;
    return session.ringClosingPixel(first.px, first.py) === 0 ? 0 : null;
  }, [session, config.axesKind, axes, dataPoints]);

  const labelAway = useMemo(
    () => radialLabelCentre(config.axesKind, axes),
    [config.axesKind, axes]
  );

  const markers = useMemo<CanvasMarker[]>(
    () =>
      buildCanvasMarkers({
        steps,
        placedPoints,
        pendingPixel,
        pendingPixelColor: theme.color.overlay.pendingMarkerFill,
        dataPoints,
        dataPointRoles,
        allDatasetsData,
        datasetInfos,
        fallbackColor: theme.color.error,
        axesKind: config.axesKind,
        isCalibrated: axes !== null,
        labelAway,
        ringClosingIndex,
        mode,
        activeHandleKey,
        activePointIndex,
        selectedPointIndices,
        activeDatasetIndex,
        errorTargetIndex,
      }),
    [steps, placedPoints, pendingPixel, dataPoints, dataPointRoles, axes, mode, config.axesKind, allDatasetsData, datasetInfos, activePointIndex, activeHandleKey, selectedPointIndices, activeDatasetIndex, errorTargetIndex, labelAway, ringClosingIndex]
  );

  // v2.1: the category axis and its ticks draw through the SAME two props the
  // rest of the overlay uses -- segments for the marks, markers for the drag
  // handles -- so ImageCanvas needed no new render path for any of this.
  const allMarkers = useMemo<CanvasMarker[]>(
    () =>
      categoryMarkers.length > 0 || heatmapHandles.length > 0
        ? [...markers, ...categoryMarkers, ...heatmapHandles]
        : markers,
    [markers, categoryMarkers, heatmapHandles]
  );
  const allBinGlyphs = useMemo(
    () => (categoryGlyphs.length > 0 ? [...binGlyphs, ...categoryGlyphs] : binGlyphs),
    [binGlyphs, categoryGlyphs]
  );

  const seriesLines = useMemo<SeriesLine[]>(
    () =>
      buildSeriesLines({
        hasSlots,
        allDatasetsData,
        dataPoints,
        datasetInfos,
        fallbackColor: theme.color.error,
      }),
    [hasSlots, allDatasetsData, dataPoints, datasetInfos]
  );

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
    return (
      <EditableValue
        editing={editingCell?.index === index && editingCell.axis === axis}
        editValue={editingCell?.value ?? ''}
        display={fmtValue(value)}
        testIdEdit={`data-edit-${suffix}-${index}`}
        testIdValue={`data-value-${suffix}-${index}`}
        title="Click to edit — moves the point on the canvas"
        width={56}
        onStartEdit={() => setEditingCell({ index, axis, value: value.toFixed(3) })}
        onChange={(v) => setEditingCell({ index, axis, value: v })}
        onCommit={commitDataPointEdit}
        onCancel={() => setEditingCell(null)}
      />
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
  const renderEditableSpiderValue = (seriesIndex: number, pointIndex: number, axisIndex: number, value: number) => (
    <EditableValue
      editing={editingCell?.index === pointIndex && editingCell.axis === axisIndex}
      editValue={editingCell?.value ?? ''}
      display={fmtValue(value)}
      testIdEdit={`spider-edit-${seriesIndex}-${axisIndex}`}
      testIdValue={`spider-value-${seriesIndex}-${axisIndex}`}
      title="Click to edit — moves the point along its own axis"
      width={64}
      align="right"
      onStartEdit={() => setEditingCell({ index: pointIndex, axis: axisIndex, value: value.toFixed(3) })}
      onChange={(v) => setEditingCell({ index: pointIndex, axis: axisIndex, value: v })}
      onCommit={commitDataPointEdit}
      onCancel={() => setEditingCell(null)}
    />
  );

  // One click-to-edit name field, shared by every "name this row" column in the
  // app: plain text at rest (a dash when unnamed), an input only while it's the
  // cell being typed into. Three call sites used to each hand-roll this exact
  // span/input pair (Spider's axis name, Bar's CategoryAxis-backed category,
  // Pie/Box Plot's plain per-tuple label) -- consolidated 2026-07-30, David:
  // "a lot of ... duplicate or near duplicate code for things that should
  // really be almost the same code." They differ only in which state tracks
  // "currently editing", which callback commits the change, and their
  // testid/placeholder/title/width strings.
  //
  // ⚑ NOT a permanent boxed field (David, 2026-07-27, re Spider): "now a user
  // thinks he HAS to add something". A name is optional everywhere this is
  // used -- an axis/category/box the figure prints illegibly is still real --
  // so unnamed reads as a dash, exactly like a value nobody recorded, and
  // looks like the rest of the table until clicked.
  function renderEditableName(
    index: number,
    rawName: string,
    editingIndex: number | null,
    setEditingIndex: (i: number | null) => void,
    onChange: (index: number, name: string) => void,
    testId: string,
    placeholder: string,
    title: string,
    width: number
  ) {
    return (
      <EditableName
        editing={editingIndex === index}
        name={rawName}
        testId={testId}
        placeholder={placeholder}
        title={title}
        width={width}
        onStartEdit={() => setEditingIndex(index)}
        onChange={(name) => onChange(index, name)}
        onFinish={() => {
          setEditingIndex(null);
          commitPendingEdit();
        }}
      />
    );
  }

  const renderEditableAxisName = (axisIndex: number, rawName: string) =>
    renderEditableName(
      axisIndex, rawName, editingAxisName, setEditingAxisName, setSpokeName,
      `spider-axis-name-${axisIndex}`, `Axis ${axisIndex + 1}`,
      'Click to name this axis, as the figure prints it', 150
    );

  // Bar's category (v2.0): position (the row's own place in the table) is the
  // only identity the app itself needs (autoLabelTuple no longer invents a
  // "Bar0"-style name -- see engine/calibrationSession.ts) -- the name is
  // purely for the human reading the table.
  const renderEditableCategoryName = (categoryIndex: number, rawName: string) =>
    renderEditableName(
      categoryIndex, rawName, editingCategoryName, setEditingCategoryName, renameCategory,
      `bar-category-name-${categoryIndex}`, `Category ${categoryIndex + 1}`,
      'Click to name this category, as the figure prints it', 120
    );

  // The generic tuple table's category name (Pie's sector, Box Plot's box) --
  // the PLAIN per-tuple metadata.label mechanism (setTupleLabel's
  // non-categoryAxis branch), since Pie has no cross-series category identity
  // to share. tupleNoun gives a nicer, type-specific placeholder ("Sector 1",
  // "Box 1") than a generic "Category N" would.
  const renderEditableTupleLabel = (tupleIndex: number, rawLabel: string) =>
    renderEditableName(
      tupleIndex, rawLabel, editingTupleLabel, setEditingTupleLabel, setTupleLabel,
      `tuple-label-${tupleIndex}`, `${tupleNoun.charAt(0).toUpperCase()}${tupleNoun.slice(1)} ${tupleIndex + 1}`,
      `Click to name this ${tupleNoun}, as the figure prints it`, 100
    );

  // The single contextual "what do I do now?" line shown in the bottom tips bar
  // (checkpoint 50) -- the one constant place for guidance, so it no longer
  // pops in and out of the right panel.
  const guidanceTip = buildGuidanceTip({
    canvasHasImage,
    isMarkingCategoryAxis: isMarkingCategoryAxis(categoryPanel),
    mode,
    figureCaptured,
    eyedropper,
    cropMode,
    hasCropRect: cropRect !== null,
    hasActiveMeasure: activeMeasure !== null,
    settingScale,
    pendingMeasureCount: pendingMeasure.length,
    hasScaleDraft: scaleDraftPx != null,
    measureError,
    measureTool,
    measureScaleUnit: measureScale ? measureScale.unit : null,
    isCalibrated: axes !== null,
    config,
    isCalibrating,
    hasPendingPixel: pendingPixel !== null,
    currentStep: currentStep ? { label: currentStep.label, prompt: currentStep.prompt } : null,
    pendingValueFieldCount: pendingValueFields.length,
    stepIndex: session.getStepIndex(),
    stepCount: steps.length,
    selectedPointCount: selectedPointIndices.length,
    dataPointCount: dataPoints.length,
    activePointIndex,
    activePointIsAnchor: activePointIndex != null && dataPointRoles[activePointIndex] === 'anchor',
    // Boolean(), not `!== null`: the branch this feeds was written as
    // `if (activeHandleKey)`, and the two answers differ on the empty string.
    // No step key is empty, so nothing changes today — but the translation
    // should not be the thing you have to reason about to know that.
    hasActiveHandle: Boolean(activeHandleKey),
    hasSlots,
    currentGroupLabel,
    currentTupleIndex,
    tupleNoun,
    captureProgressText: captureProgress.text,
  });

  const noPointsHint = buildNoPointsHint({ mode, config });

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
  const curveFitFlyout = (
    <CurveFitFlyout
      visible={!!config.supportsCurveFit}
      disabled={!axes}
      model={curveFitModel}
      onModelChange={setCurveFitModel}
      degree={curveFitDegree}
      onDegreeChange={setCurveFitDegree}
      restrict={curveFitRestrict}
      onRestrictChange={setCurveFitRestrict}
      xMin={curveFitXMinInput}
      onXMinChange={setCurveFitXMinInput}
      xMax={curveFitXMaxInput}
      onXMaxChange={setCurveFitXMaxInput}
      error={curveFitError}
      hasFit={curveFitState !== null}
      onRun={handleRunCurveFit}
      onClear={handleClearCurveFit}
      onOpenChange={closeDockedCardsOnFlyout}
    />
  );

  const geometryFlyout = (
    <GeometryFlyout
      visible={config.id === 'xy'}
      disabled={!axes}
      closed={geometryState ? geometryState.closed : geometryClosed}
      onClosedChange={(v) => {
        setGeometryClosed(v);
        // If geometry is already on, re-derive live with the new setting.
        if (geometryState) {
          setGeometryState(session.getDataset(), { closed: v });
          commit();
        }
      }}
      active={geometryState !== null}
      onRun={handleRunGeometry}
      onClear={handleClearGeometry}
      onOpenChange={closeDockedCardsOnFlyout}
    />
  );

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
        </TopBarGroup>

        {/* ⚑ ITS OWN GROUP, which is what TopBarGroup's own comment prescribes: "when
            something needs air, give it its own TopBarGroup rather than loosening this".
            Sharing a card with Open Image made "Open Image" and "Graph type" read as one
            phrase, and the 8px margin that was tried first could not fix it -- inside one
            card they are still one card, and a gap between two runs of plain dark text is
            a weak signal next to a boundary. The card supplies padding, background and
            shadow, so the seam is now visible rather than merely wider.

            It is also the honest grouping: every other member of this bar is an ACTION,
            and this is a SETTING that governs how the axes are read. */}
        <TopBarGroup>
          <GraphTypeCardPicker
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
          <ExportMenu
            enabled={!!axes || canvasHasImage}
            keyTips={keyTips}
            anchor={exportAnchor}
            onAnchorChange={setExportAnchor}
            copiedFmt={copiedFmt}
            onCopiedFmtChange={setCopiedFmt}
            fullPrecision={exportFullPrecision}
            onFullPrecisionChange={setExportFullPrecision}
            content={exportContent}
            onExport={(fmt, target) => void exportData(fmt, target)}
            onSaveImage={() => void saveImage()}
          />
        </TopBarGroup>

        {/* Analysis group (checkpoint 40) -- floating Popovers. Grid Removal is
            image prep, so it needs only an image (Curve Fit and Geometry are
            XY-only + calibrated) -- but it DOES need one: it used to open on an
            empty canvas with a Remove button that could only ever answer 'No
            image loaded.' */}
        <TopBarGroup>
        <GridRemovalPanel
          color={gridRemovalColor}
          onColorChange={setGridRemovalColor}
          tolerance={gridRemovalTolerance}
          onToleranceChange={setGridRemovalTolerance}
          error={gridRemovalError}
          onRun={handleRemoveGridLines}
          onPickFromImage={() => setEyedropper('grid')}
          enabled={canvasHasImage}
        />

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
          <HelpMenu
            onOpenHelpOverlay={() => setHelpOverlayOpen(true)}
            onOpenExample={(ex) => void openExample(ex)}
            onStartChallenge={startChallenge}
            appVersion={__APP_VERSION__}
          />
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
              {/* ⚑ The type's OWN noun, not "axes". Written when spider was the only
                  variable-length calibration, so the wording was simply spider's: a
                  pie's outline read "3 axes — add one for every axis the chart draws",
                  which is wrong twice over. The config has always declared the noun
                  (`repeatingStep.noun`); the two buttons either side of this already
                  use it. Caught by the pie e2e. */}
              <span data-testid="repeat-count" style={{ color: theme.color.text.legend }}>
                {session.getRepeatCount()}{' '}
                {session.getRepeatCount() === 1 ? repeatingStep.noun : repeatingStep.nounPlural} —{' '}
                {repeatingStep.hint}
              </span>
            </div>
          )}
          {figureCaptured && calibExpanded && config.commonOrigin && !axes && (
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
          {/* v2.1 CATEGORY TICKS. A fold-out on the calibration card, not a step
              in the walk: a bar chart still calibrates in two clicks, a
              single-series chart never needs any of this, and nobody has to know
              the feature exists to find it -- the summary line is on screen the
              moment the axes are calibrated. Every branch below comes from
              `categoryPanelView`, which is pure and unit-tested. */}
          {/* ⚑ Not during a Challenge round: opening it mid-round turns the
              player's bar clicks into category-axis edges while the clock runs
              (v2.1 audit). */}
          {gamePhase === null && categoryPanel.phase !== 'unavailable' && (
            <div
              data-testid="category-ticks-panel"
              style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: theme.color.text.secondary }}
            >
              {/* ⚑ A DISCLOSURE, with the same rotating chevron the calibration
                  card itself uses. Underlined text alone said "I am a link" and
                  nothing said "I am how you close this again" -- so the only
                  exits a reader could see were the two that destroy work. */}
              <button
                type="button"
                data-testid="category-ticks-toggle"
                onClick={() => setCategoryPanelOpen((open) => !open)}
                title={categoryPanelOpen ? 'Close category ticks' : 'Open category ticks'}
                style={{
                  alignSelf: 'flex-start',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  font: 'inherit',
                  color: theme.color.text.secondary,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    // Grey, matching its own label rather than the card's teal
                    // chevron above it: this is a sub-disclosure, and it should
                    // read as quieter than the card it sits inside.
                    color: theme.color.text.secondary,
                    transform: categoryPanelOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    transition: 'transform 0.15s',
                  }}
                >
                  <ChevronDownIcon />
                </span>
                <span data-testid="category-ticks-summary">
                  {categoryPanelSummary(
                    session.getCategoryAxis().hasGeometry(),
                    session.getCategoryAxis().getCategoryCount()
                  )}
                </span>
              </button>
              {categoryPanelOpen && (
                // Its own bounded section, not more rows in the calibration list.
                // Unbounded, it read as three extra calibration settings -- the
                // reader had no way to see where "the category thing" stopped and
                // "Log scale / Horizontal bars" began.
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    alignItems: 'center',
                    columnGap: 10,
                    rowGap: 7,
                    padding: '8px 10px',
                    marginBottom: 2,
                    borderLeft: `2px solid ${theme.color.primary.main}`,
                    background: theme.color.background.primary,
                    borderRadius: 3,
                  }}
                >
                  {/* The case FOR opening it is only worth making while it is
                      still shut in spirit -- once an axis is marked the user has
                      already been persuaded, and the paragraph is just noise
                      sitting on top of the figure. */}
                  {!session.getCategoryAxis().hasGeometry() && (
                    <div style={{ gridColumn: '1 / -1', color: theme.color.text.legend }}>
                      {CATEGORY_PANEL_HINT}
                    </div>
                  )}
                  {categoryMarkMessage(categoryMarkError) && (
                    <div
                      data-testid="category-mark-error"
                      style={{ gridColumn: '1 / -1', color: theme.color.error }}
                    >
                      {categoryMarkMessage(categoryMarkError)}
                    </div>
                  )}
                  {categoryPanel.prompt && (
                    <div
                      data-testid="category-ticks-prompt"
                      style={{ gridColumn: '1 / -1', color: theme.color.text.primary }}
                    >
                      {categoryPanel.prompt}
                    </div>
                  )}
                  {categoryPanel.phase === 'mark-axis' && (
                    // ⚑ A VISIBLE WAY OUT. In this phase the panel rendered only
                    // a prompt -- no Done, no Cancel -- while every canvas click
                    // anywhere in the app was being captured as an axis edge,
                    // including in Eraser and Select. The only exit was
                    // re-clicking the summary chevron, and nothing said so
                    // (v2.1 audit).
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 2 }}>
                      <button
                        type="button"
                        data-testid="category-cancel-mark"
                        onClick={() => {
                          setCategoryFirstEdge(null);
                          setCategoryMarkError(null);
                          setCategoryPlaceBothEdges(false);
                          setCategoryPanelOpen(false);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  {categoryPanel.phase === 'declaring' && (
                    <>
                      <div
                        data-testid="category-drag-hint"
                        style={{ gridColumn: '1 / -1', color: theme.color.text.legend, fontSize: 12 }}
                      >
                        {CATEGORY_TICK_DRAG_HINT}
                      </div>
                      <label htmlFor="category-count-input">Categories</label>
                      <span>
                        <input
                          id="category-count-input"
                          type="number"
                          min={1}
                          data-testid="category-count"
                          value={categoryCountInput}
                          // ⚑ GROWING COMMITS AS YOU TYPE; SHRINKING WAITS FOR
                          // BLUR OR ENTER.
                          //
                          // `setCategoryCount` shrinks by TRUNCATION, dropping
                          // the trailing categories names and all -- so with the
                          // whole field selected, retyping 12 over a 5 passed
                          // through the intermediate "1" and silently deleted
                          // four named categories on the way (v2.1 audit).
                          //
                          // ⚑ But committing only on blur was WORSE: the ticks
                          // stopped appearing as the number was typed, and that
                          // live redraw is the entire feedback loop this panel
                          // is built around -- you type a count and SEE whether
                          // the marks land on the figure. Caught by the e2e.
                          // Growing can never destroy a name, so it stays
                          // instant; only the destructive direction waits.
                          onChange={(e) => {
                            setCategoryCountInput(e.target.value);
                            const n = Number(e.target.value);
                            const current = session.getCategoryAxis().getCategoryCount();
                            if (Number.isInteger(n) && n >= 1 && n >= current && session.setCategoryCount(n))
                              commit();
                          }}
                          onBlur={() => {
                            const n = Number(categoryCountInput);
                            if (Number.isInteger(n) && n >= 1 && session.setCategoryCount(n)) commit();
                            else setCategoryCountInput(String(session.getCategoryAxis().getCategoryCount() || ''));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          style={{ width: 56 }}
                        />
                      </span>
                      {/* Two RADIOS, not a select: both readings have to be visible
                          without a click, because the user is being asked which one
                          their figure prints -- and flipping it moves the marks on
                          screen, which is the whole answer. */}
                      <span>Ticks are</span>
                      <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                        {(['centred', 'edge'] as TickConvention[]).map((c) => (
                          <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="category-convention"
                              data-testid={`category-convention-${c}`}
                              checked={session.getCategoryAxis().getConvention() === c}
                              onChange={() => {
                                if (session.setCategoryTickConvention(c)) commit();
                              }}
                            />
                            <span style={{ whiteSpace: 'nowrap' }}>{CONVENTION_LABELS[c]}</span>
                          </label>
                        ))}
                      </fieldset>
                      <label htmlFor="category-series-input"># Series (optional)</label>
                      <span>
                        <input
                          id="category-series-input"
                          type="number"
                          min={1}
                          data-testid="category-series-count"
                          value={categorySeriesInput}
                          onChange={(e) => setCategorySeriesInput(e.target.value)}
                          style={{ width: 56 }}
                        />
                      </span>
                      {categoryPanel.regenerateWarning && (
                        <div
                          data-testid="category-regenerate-warning"
                          style={{ gridColumn: '1 / -1', color: theme.color.error }}
                        >
                          {categoryPanel.regenerateWarning}
                        </div>
                      )}
                      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 2 }}>
                        {/* ⚑ FIRST, and safe. Without it the only exits on screen
                            were "Re-place axis" and "Remove ticks" -- both
                            destructive. The way out must never be the way to lose
                            your work (David, reading the screenshot). */}
                        <button
                          type="button"
                          data-testid="category-done"
                          onClick={() => setCategoryPanelOpen(false)}
                          style={{
                            fontSize: 12,
                            border: `1px solid ${theme.color.primary.main}`,
                            borderRadius: theme.border.radius.regular,
                            background: theme.color.primary.main,
                            color: '#fff',
                            padding: '2px 12px',
                            cursor: 'pointer',
                          }}
                        >
                          Done
                        </button>
                        <button
                          type="button"
                          data-testid="category-replace-axis"
                          title="Re-place axis — click both ends of the category axis again. Any ticks you moved are lost."
                          onClick={() => {
                            // ⚑ BOTH ends, which is what the label says. Reusing
                            // P1 here made the start impossible to correct: P1 is
                            // "a known bar value (e.g. 0)", so a figure calibrated
                            // on a gridline mid-plot anchored the category axis in
                            // the middle of the figure for good.
                            session.clearCategoryAxisGeometry();
                            setCategoryFirstEdge(null);
                            setCategoryMarkError(null);
                            setCategoryPlaceBothEdges(true);
                            commit();
                          }}
                        >
                          Re-place axis
                        </button>
                        <button
                          type="button"
                          data-testid="category-remove-ticks"
                          title="Remove ticks — drop the marks and the empty categories they created. Named categories and captured bars are kept."
                          onClick={() => {
                            // Takes back the empty categories the declaration
                            // created; keeps any that were named or have a bar.
                            session.removeCategoryTicks();
                            setCategoryFirstEdge(null);
                            setCategoryMarkError(null);
                            setCategoryPlaceBothEdges(false);
                            setCategoryPanelOpen(false);
                            commit();
                          }}
                        >
                          Remove ticks
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
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
          {/* ⚑ Shown WHENEVER the card is open, including after calibrating (David).
              A total is a transcription, and it is often only discovered once you
              have looked properly at the figure -- the 2500 printed in a donut's
              hole. Gating it on !isCalibrating meant the one way to correct it was
              to throw the calibration away and start again. setGlobalFieldValue
              already re-runs the calibration live, so editing it here re-reads every
              slice immediately. */}
          {figureCaptured && calibExpanded && config.globalFields.length > 0 && (
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
            // against. v2.0 Phase 7 makes Bar a SECOND correctness exception: a
            // bar blob's own bounding box IS its two ends (engine/barDetectRun.ts),
            // so it no longer belongs in this refused bucket at all -- see
            // BAR_AXES_CONFIG's autoExtractKind. Histogram joined it 2026-07-30 --
            // a bin's bounding box is the same shape, just read as top corners
            // rather than opposite ones (addBarDetectBoxes's own comment). Box
            // Plot / categorical Line remain refused: neither has anything a
            // colour trace could read as its own record (five letter-values; an
            // ordinal click).
            disabled={!axes || (config.autoExtractKind ?? 'curve') === 'none'}
            disabledReason={
              !axes
                ? 'Calibrate the axes first'
                : config.id === 'boxplot'
                ? 'Auto-extract can’t find a box’s five values from its colour — place its Min/Q1/Median/Q3/Max points by hand.'
                : config.id === 'categorical'
                ? 'Auto-extract has nothing to trace here — each category is one click, not a curve or a blob. Place points by hand.'
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
            <AutoExtractCard
              mode={mode}
              config={config}
              tupleNoun={tupleNoun}
              onSetMechanism={setAutoExtractMech}
              segmentFillThreshold={segmentFillThreshold}
              onSegmentFillThresholdChange={setSegmentFillThreshold}
              segmentFillError={segmentFillError}
              colorTraceColor={colorTraceColor}
              onColorTraceColorChange={setColorTraceColor}
              colorTraceTolerance={colorTraceTolerance}
              onColorTraceToleranceChange={setColorTraceTolerance}
              colorTraceShape={colorTraceShape}
              onColorTraceShapeChange={setColorTraceShape}
              colorTraceMinBlob={colorTraceMinBlob}
              onColorTraceMinBlobChange={setColorTraceMinBlob}
              colorTraceRegion={colorTraceRegion}
              onClearRegion={() => setColorTraceRegion(null)}
              colorTraceInfo={colorTraceInfo}
              colorTraceMask={colorTraceMask}
              onTrace={handleColorTrace}
              onArmEyedropper={setEyedropper}
            />
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
          points={allMarkers}
          seriesLines={seriesLines}
          calibrationPreview={calibPreview}
          boxPlotGlyphs={boxPlotGlyphs}
          binGlyphs={allBinGlyphs}
          errorBarGlyphs={errorWhiskers}
          curveFitLine={curveFitOverlay}
          // ⚑ PAN ONLY. The fitted curve is drawn AFTER the data points and
          // carries a 12px hit stroke, and Konva resolves hits from the last
          // child drawn -- so in Select mode, where markers ARE listening, a
          // curve fitted TO those points passes within a few px of nearly all
          // of them and ate every point click: the panel opened instead of the
          // point being selected, and a marquee could not even start on the
          // curve. That is the "an overlay drawn where the user must click
          // eats the press" trap this file has hit twice before. In Pan mode
          // markers are non-listening, so there is no clash and the shortcut
          // stays. (v2.0 audit, round 2.)
          onCurveFitClick={curveFitState && mode === 'pan' ? openCurveFitPanel : undefined}
          geometryOverlay={geometryOverlay}
          challengeReveal={challengeReveal}
          gridOverlay={heatmapOverlay}
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
          cropMode={mode === 'image-edit' ? cropMode : false}
          // v2.0 pre-launch audit: a stray click used to set a 0x0 pending
          // rect here (no guard at all, unlike onRegionRect/onSelectRect's
          // own, inconsistent ones) -- applyCrop then silently no-op'd with
          // no message explaining why Apply did nothing. ImageCanvas.tsx's
          // endDrag now applies one click-vs-drag guard for all three.
          onCropRect={(r) => setCropRect(r)}
          cropRect={mode === 'image-edit' ? cropRect : null}
          // Direct marquee (v1.2): the region drag is live whenever By-colour is
          // active, EXCEPT while the eyedropper is armed (that click samples a
          // colour). A bare click in this mode is already a no-op (see
          // handleImageClick), so an always-live drag clobbers nothing.
          regionMode={mode === 'color-trace' && eyedropper === null}
          // v2.0 pre-launch audit: the click-vs-drag guard (a zero-area region
          // would match nothing) is now ImageCanvas.tsx's own job, consolidated
          // with crop/select's identical guard -- see its endDrag comment.
          onRegionRect={(r) => setColorTraceRegion(r)}
          regionRect={mode === 'color-trace' ? colorTraceRegion : null}
          // Bar capture (v2.0): live whenever Add points is active on a plain Bar
          // series, except while the eyedropper is armed -- same exception
          // regionMode makes above, same reason (that click samples a colour).
          boxMode={
            // ⚑ Bar capture is a DRAG-BOX, so in boxMode a plain click is one
            // CORNER of a bar and never reaches onImageClick at all. While the
            // fold-out is asking for a category-axis edge, that click has to BE
            // the edge -- so box capture stands down for exactly that moment.
            // Caught by the e2e; no unit test could have seen it.
            mode === 'place-point' &&
            config.id === 'bar' &&
            eyedropper === null &&
            !isMarkingCategoryAxis(categoryPanel)
          }
          onBoxRect={handleBoxRect}
          selectMode={mode === 'select' ? selectSubMode : null}
          // v2.0 pre-launch audit: same consolidated guard as onRegionRect
          // above -- a tiny drag is a click, and handleImageClick already
          // cleared the selection for that.
          onSelectRect={(r) => handleSelectRect(r)}
          onSelectLasso={handleSelectLasso}
          // ⚑ MODE-GATED, like regionRect/selectMode/boxMode above. Passed
          // unconditionally, a deskew preview left behind by leaving
          // Edit-image via a rail button or a digit hotkey kept the canvas
          // CSS-rotated while `screenToImage` stayed a pure translate+scale
          // with no rotation term -- so every click afterwards recorded a
          // pixel several px from where the user clicked, silently, into the
          // record. A fine deskew is subtle by definition, so nothing looked
          // wrong. (v2.0 audit, round 2.)
          previewRotationDeg={mode === 'image-edit' ? previewAngle : 0}
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
        {/* ⚑ ON THE FIGURE, not in the sidebar. Only while a pie is actually being
            captured: before calibration there is no sector to call exploded, and
            offering it then would be a control that does nothing. */}
        {session.getConfig().axesKind === 'pie' && axes !== null && mode === 'place-point' && (
          <ExplodedSliceControl
            stage={session.getExplodedStage()}
            edgesPlaced={session.getExplodedEdgesPlaced()}
            onToggle={() => {
              if (session.getExplodedStage() === 'off') {
                session.setNextSectorExploded(true);
                bump();
              } else {
                // Cancelling can discard already-placed edges, so it goes through
                // history like any other point removal -- undo puts them back.
                session.cancelExplodedSector();
                commit();
              }
            }}
          />
        )}
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

      <SeriesPanel
        infos={datasetInfos}
        activeInfo={activeInfo}
        activeIndex={activeDatasetIndex}
        isBar={config.id === 'bar'}
        nameDraft={nameDraft}
        nameNotice={nameNotice}
        colorAnchor={colorAnchor}
        onColorAnchorChange={setColorAnchor}
        stackGroupOf={(index) => session.getDatasetStackGroup(index)}
        onSetStackGroup={(index, group) => {
          session.setDatasetStackGroup(index, group);
          pendingEditRef.current = true;
          bump();
        }}
        onAdd={handleAddDataset}
        onSelect={handleSelectDataset}
        onRemove={handleRemoveDataset}
        onRenameDraft={handleRenameDraft}
        onCommitRename={handleCommitRename}
        onSetColor={handleSetDatasetColor}
        canAddSeries={!!axes}
        canvasHasImage={canvasHasImage}
        onCommitPendingEdit={commitPendingEdit}
        onArmEyedropper={setEyedropper}
      />



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
              {/* ⚑ v2.0, 2026-07-30: the visible "Next: {slot} — {tuple} (N of M
                  filled)" sentence that used to live here (a v1.6 split from the
                  tips bar, on the theory that it was STATE rather than an
                  instruction) is GONE -- David, seeing "Slice0"/"Slice1" on Pie
                  reopened the question and settled it further: "Hint should be in
                  the hint bar, not in other places," full stop. Its content
                  (including the "N incomplete" nudge) now lives in guidanceTip's
                  own slotAimNote suffix instead -- see that comment for why it
                  folds in only where the tips bar doesn't already say it (mode ===
                  'place-point' with nothing selected covers itself; every other
                  mode gets the note appended). This element survives ONLY to hold
                  the display:none e2e readouts below (Konva glyphs are not
                  DOM-inspectable) -- it renders no visible text of its own now. */}
              <span data-testid="marker-labels" style={{ display: 'none' }}>
                {markers.map((m) => m.label).filter(Boolean).join(' | ')}
              </span>
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
              {/* ⚑ Tuple shapes get the toggle too (round-2 audit). Hidden for
                  them, a grouped Bar chart exported one series to every format
                  with nothing on screen offering the rest — while the v2.0
                  shared table showed them all. Bins stay single-series: a
                  histogram has one. */}
              {(session.getExportShape() === 'flat' || session.getExportShape() === 'tuples') && (
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
            <HistogramBinsTable
              rows={tupleRows}
              bins={histogramBins}
              tupleNoun={tupleNoun}
              onRemoveTuple={removeTuple}
            />
          ) : config.axesKind === 'spider' && axes ? (
            <SpiderTable
              table={spiderTable}
              activeSeriesIndex={activeDatasetIndex}
              activePointIndex={activePointIndex}
              cursorAxisIndex={currentGroupIndex}
              cursorTupleIndex={currentTupleIndex}
              tupleCount={session.getDataset().getAllTuples().length}
              onSelectSeries={handleSelectDataset}
              onSelectPoint={(pointIndex) => {
                setActivePointIndex(pointIndex);
                setPickedPointIndex(pointIndex);
                bump();
              }}
              onAimSlot={(tupleIndex, axisIndex) => {
                session.setSlotCursor(tupleIndex, axisIndex);
                setActivePointIndex(null);
                bump();
              }}
              renderAxisName={renderEditableAxisName}
              renderValue={renderEditableSpiderValue}
            />
          ) : config.id === 'bar' && axes ? (
            <BarTable
              table={barTable}
              activeSeriesIndex={activeDatasetIndex}
              tupleNoun={tupleNoun}
              onSelectSeries={handleSelectDataset}
              missingSlotIndexOf={(tupleIndex) => session.getDataset().getTuple(tupleIndex).indexOf(null)}
              onAimSlot={(tupleIndex, slotIndex) => {
                session.setSlotCursor(tupleIndex, slotIndex);
                bump();
              }}
              onRemoveTuple={removeTuple}
              renderCategoryName={renderEditableCategoryName}
              noPointsHint={noPointsHint}
            />
          ) : hasSlots ? (
            <TupleTable
              rows={tupleRows}
              slotNames={pointGroupNames}
              derivedColumn={derivedTupleColumn}
              tupleNoun={tupleNoun}
              onRemoveTuple={removeTuple}
              renderLabel={renderEditableTupleLabel}
              noPointsHint={noPointsHint}
            />
          ) : (
            <SpreadsheetTable
              series={spreadsheetSeries}
              maxRows={spreadsheetMaxRows}
              dataDim={config.dataDim}
              axesKind={config.axesKind}
              showCategoryColumn={showCategoryColumn}
              valueLabels={tableValueLabels}
              dateFormats={tableDateFormats}
              mode={mode}
              activePointIndex={activePointIndex}
              selectedPointIndices={selectedPointIndices}
              activeSeriesPointCount={dataPoints.length}
              dataPointRoles={dataPointRoles}
              onSelectPoint={(index) => {
                setActivePointIndex(index);
                if (index !== null) setPickedPointIndex(index);
              }}
              onSelectMarquee={setSelectedPointIndices}
              onSetPointLabel={setPointLabel}
              onCommitPendingEdit={commitPendingEdit}
              renderValue={renderEditableValue}
              noPointsHint={noPointsHint}
            />
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
      {/* The three OUTPUT cards (v1.1 step 2): results live in the sidebar, so
          each rail fold-out holds INPUTS only. Their own files under panels/ --
          they were the three sections self-contained enough to move without
          turning into prop lists longer than the markup they replace. */}
      <MeasurementsCard
        visible={mode === 'measure' || measurementViews.length > 0}
        views={measurementViews}
        reference={measureReference}
        onCopyAll={copyAllMeasurements}
        onCopy={copyMeasurement}
        onDelete={deleteMeasurement}
      />

      <CurveFitCard state={curveFitState} seriesName={activeInfo?.name ?? 'Series'} />

      {heatmapActive && (
        <HeatmapCard
          columns={heatmapColumns}
          rows={heatmapRows}
          onColumnsChange={setHeatmapColumns}
          onRowsChange={setHeatmapRows}
          gridSize={
            heatmapShownGrid
              ? {
                  columns: Math.max(0, heatmapShownGrid.xDividers.length - 1),
                  rows: Math.max(0, heatmapShownGrid.yDividers.length - 1),
                }
              : null
          }
          onDetect={runHeatmapDetect}
          onRead={runHeatmapRead}
          onAddColumnBoundary={() => addHeatmapDivider('x')}
          onAddRowBoundary={() => addHeatmapDivider('y')}
          selectedBoundary={selectedBoundary}
          onRemoveBoundary={removeHeatmapDivider}
          canRemoveBoundary={
            selectedBoundary !== null &&
            heatmapShownGrid !== null &&
            (selectedBoundary.axis === 'x' ? heatmapShownGrid.xDividers : heatmapShownGrid.yDividers).length > 2
          }
          xLabels={heatmapXLabels}
          yLabels={heatmapYLabels}
          onLabelsChange={(x, y) => {
            // ⚑ A text edit: marked pending here and committed on blur, the same
            // rule every other text field follows. Without it the names were in
            // no snapshot at all, and an undo of an unrelated action discarded
            // everything typed, with no redo to get it back.
            markPendingEdit();
            applyHeatmapLabels(x, y);
          }}
          onCommitPendingEdit={commitPendingEdit}
          xLabelCoverage={labelCoverage(heatmapLabels.x, Math.max(0, (heatmapShownGrid?.xDividers.length ?? 1) - 1))}
          yLabelCoverage={labelCoverage(heatmapLabels.y, Math.max(0, (heatmapShownGrid?.yDividers.length ?? 1) - 1))}
          detectMessage={heatmapDetectMessage}
          summary={heatmapSummary}
          error={heatmapError}
          cells={heatmapCells}
          canRead={session.isCalibrated()}
        />
      )}

      <GeometryCard
        enabled={geometryState !== null}
        result={geometryResult}
        error={geometryError}
        seriesName={activeInfo?.name ?? 'Series'}
        tableOpen={geometryTableOpen}
        onToggleTable={() => setGeometryTableOpen((v) => !v)}
      />
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
      {helpOverlayOpen && <HelpOverlay onClose={() => setHelpOverlayOpen(false)} manualUrl={MANUAL_URL} />}
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
