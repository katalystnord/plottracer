import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import {
  CalibrationSession,
  ALL_AXES_TYPE_CONFIGS,
  XY_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  HEATMAP_AXES_CONFIG,
  calibrationCompatible,
  commonOriginPairs,
  commonOriginReuse,
  type CalibratedAxes,
  type SessionSnapshot,
} from '../../engine/calibrationSession.js';
import { describeCaptureProgress } from '../../engine/captureProgress.js';
import { AUTO_EXTRACT_MODES, autoExtractModesFor, type ToolMode } from '../../engine/toolMode.js';
import { guidanceTip as buildGuidanceTip, noPointsHint as buildNoPointsHint } from '../../engine/guidanceTip.js';
import { buildCanvasMarkers, buildSeriesLines, radialLabelCentre } from '../../engine/canvasOverlays.js';
import {
  categoryAidGlyphs,
  categoryRegenerateWarning,
  categoryStageLine,
  categoryTickIndexFromId,
  categoryTickMarkers,
} from '../../engine/categoryTickOverlay.js';
import { CategoriesCard } from './panels/CategoriesCard.js';
import { OcrReviewCard } from './panels/OcrReviewCard.js';
import { readLabelBand, readRegionAt, isOcrFailure, type OcrProposal } from './ocrClient.js';
import { axisRunsAlong, type QuarterTurn } from '../../engine/ocrRegion.js';
import type { AxesOption } from '../../engine/axesTypeConfigs.js';
import type { AidGlyph } from '../../engine/categoryTickOverlay.js';
import { valueAtPosition, type ColorScale } from '../../algorithms/colorScale.js';
import { type RecordedMeasurement, type MeasureScaleState } from './tools/measureDisplay.js';
import { useMeasure } from './tools/useMeasure.js';
import { colourMeasureReading } from '../../engine/colourMeasure.js';
import type { MeasurementCsvRow } from '../../engine/csvExport.js';
import { resolveKeyDown, isNudgeRelease } from '../../engine/keyboardActions.js';
import { routeCanvasClick, indexOfPlacedPoint } from '../../engine/canvasClickRoute.js';
import { samplePixelRgb } from '../../algorithms/samplePixel.js';
import { exportBaseName as baseNameForExport, EXPORT_FILTER_NAMES } from '../../engine/exportNaming.js';
import {
  colorTraceRefusal,
  spiderTraceReport,
  barTraceReport,
  categoryMissReport,
  swatchHoldBackOffer,
  emptyCategoryNames,
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
import { MeasureCard, type MeasureToolId } from './MeasureCard.js';
import { ImageEditCard } from './ImageEditCard.js';
import { ErrorBarsCard } from './ErrorBarsCard.js';
import { ChallengeOverlay } from './ChallengeOverlay.js';
import { MeasurementsCard } from './panels/MeasurementsCard.js';
import { CurveFitCard } from './panels/CurveFitCard.js';
import { GeometryCard } from './panels/GeometryCard.js';
import { GridRemovalPanel } from './panels/GridRemovalPanel.js';
import { GeometryFlyout } from './panels/GeometryFlyout.js';
import { CurveFitFlyout } from './panels/CurveFitFlyout.js';
import { HelpMenu } from './panels/HelpMenu.js';
import { ExportMenu } from './panels/ExportMenu.js';
import { EditableValue, EditableName } from './panels/EditableCell.js';
import { valueText, valueTitle, suppliedBySource, SuppliedLegend } from './panels/ValueMark.js';
import { editSeed, fmtValue, rgbToHex } from './format.js';
import { reporting } from './asyncAction.js';
import { HistogramBinsTable } from './panels/HistogramBinsTable.js';
import { TupleTable } from './panels/TupleTable.js';
import { BarTable } from './panels/BarTable.js';
import { SpiderTable } from './panels/SpiderTable.js';
import { SpreadsheetTable } from './panels/SpreadsheetTable.js';
import { HeatmapCellsTable } from './panels/HeatmapCellsTable.js';
import { AutoExtractCard, COLOR_TRACE_PREVIEW_RGBA } from './panels/AutoExtractCard.js';
import { SeriesPanel } from './panels/SeriesPanel.js';
import { EXAMPLES, MANUAL_URL } from './examples.js';
import { ExplodedSliceControl } from './ExplodedSliceControl.js';
import { CHALLENGE_META, CHALLENGE_IDS } from './challengeExamples.js';
import { qualifies as scoreQualifies } from './challengeScores.js';
import { type ChallengeExample } from '../../engine/traceChallenge.js';
import { useTraceChallenge, type TraceChallengeHost } from './games/useTraceChallenge.js';
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
import { buildExportJson, buildExportSections, errorColumnsByTuple } from '../../engine/exportAssembly.js';
import { resolveErrorTarget } from '../../engine/errorRelation.js';
import {
  buildSpreadsheetSeries,
  spreadsheetMaxRows as spreadsheetMaxRowCount,
  showsCategoryColumn,
  editsValuesInTable,
} from '../../engine/spreadsheetModel.js';
import { renderTable, TABLE_FORMAT_EXTENSION, type TableFormat } from '../../engine/tableFormats.js';
import { figureSaveInput, sharedProjectSource, sourceDescriptor, figuresForOpenedProject } from '../../engine/projectSaveInputs.js';
import type { PrecisionMode } from '../../core/exportPrecision.js';
import { runSegmentFill } from '../../engine/segmentFillRun.js';
import { runColorTrace, calibrationBoxRegion, tracingADifferentColour } from '../../engine/colorTraceRun.js';
import { runSpiderTrace, spiderBoxRegion } from '../../engine/spiderTraceRun.js';
import type { SpiderAxes } from '../../core/axes/spider.js';
import { runBlobDetect } from '../../engine/blobDetectRun.js';
import { runBarDetect, partitionSwatchSuspects, type DetectedBarBox } from '../../engine/barDetectRun.js';
import { formatLabelList, labelCoverage, parseLabelList } from '../../core/heatmapLabels.js';
import { cellIndexAt, cellsOf } from '../../core/heatmapGrid.js';
import type { SerializedHeatmapLayer } from '../../core/plotData.js';
import {
  addDivider,
  buildColorScale,
  cellKey,
  clearCellReading,
  describeDivider,
  detectGrid,
  heatmapAxisOverlays,
  dragDivider,
  heatmapAxisKinds,
  heatmapBandCounts,
  heatmapGridSummary,
  heatmapRegenerateWarning,
  noteRetiresOnRead,
  type GridNoteKind,
  heatmapBounds as heatmapBounds_,
  initialGridFor,
  isDividerHandle,
  labelsForCells,
  cellKeysInRect,
  heatmapAxisMoved,
  heatmapAxisSpans,
  heatmapAxisStamp,
  heatmapGridToParams,
  resolveHeatmapGrid,
  keyCursorStrip,
  keySpanFromClicks,
  readHeatmapCells,
  removeDividerHandle,
  setCellReading,
  setCellReadingAt,
  NO_HEATMAP_CELL_READINGS,
  type HeatmapAxisKinds,
  type HeatmapCellReadings,
  type HeatmapFrameCarrier,
  type HeatmapLabels,
  type HeatmapRow,
  type HeatmapGridParams,
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
import { measurementValue } from '../../core/measurementValues.js';
import { makeDisplayRounder } from '../../core/displayPrecision.js';
import { theme, glassSurface, endsCardButton } from './theme.js';
import { calibrationCardModel } from '../../engine/calibrationCardModel.js';
import { clampPanelWidth, defaultPanelWidthFor, readStoredPanelWidth, writePanelWidth } from './panelWidth.js';
import { useKeyTips, keyTipLabel, redoKeyTip, KeyTipsContext } from './useKeyTips.js';
import { primaryMod } from './platform.js';
import { HelpOverlay } from './HelpOverlay.js';

/**
 * The digitizing workspace: pick an axes type, load an image, calibrate,
 * then click to place data points. This component is a thin view over
 * engine/calibrationSession.ts's framework-agnostic state machine - all
 * the calibration-flow and point-placement logic lives there, tested
 * directly with vitest rather than only through slow Electron+Playwright
 * launches. CalibrationSession is a plain mutable class, not React state,
 * so it's held in a ref with a version counter forcing re-renders after
 * each mutating call - the same pattern already used for ImageCanvas's
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
 * CLAUDE.md's "Product #1 - rebuild design"): a left tool-mode rail
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
 * based Curve Fit/Geometry windows. Both are XY-axes-only -- BarAxes etc. have
 * no numeric x-coordinate to regress against or working dataToPixel to draw an
 * overlay with -- and each now says so as a DECLARED CAPABILITY on the config
 * (`supportsCurveFit`, `supportsGeometry`) rather than as a `config.id === 'xy'`
 * test at the call site. ⚑ This sentence used to name that id check, and it
 * outlived it by a release: checkpoint 73 converted Curve Fit and left Geometry
 * behind, so the comment described one panel accurately and the other not at
 * all, while reading as though it covered both. Curve Fit's result is persisted in
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


/**
 * ⚑ `RecordedMeasurement` and `MeasureScaleState` live in
 * `ui/src/tools/measureDisplay.ts` now (v2.3, theme G) - with the derivation
 * that reads them. The COLLECTION still lives here, because it is document
 * state: the project file carries it, every figure record stashes it, and each
 * undo snapshot captures it.
 */
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
    ...(m.rgb ? { rgb: m.rgb } : {}),
  }));
}
function toRecordedMeasurements(serialized: readonly SerializedMeasurement[]): RecordedMeasurement[] {
  return serialized.map((m) => ({
    id: m.id,
    tool: m.tool as MeasureToolId,
    overlay: { id: m.id, points: m.points, closed: m.closed, label: m.label, labelAt: m.labelAt },
    ...(m.rgb ? { rgb: m.rgb } : {}),
  }));
}

/** Data-spreadsheet value formatter (checkpoint 57) -- Intl.NumberFormat, the
 * legibility win from the competitor study (plotdigitizer dumps raw 15-digit
 * floats). Up to 6 significant figures, trailing zeros trimmed, no grouping. */


/** Marker radius (screen px) for the SELECTED point on a dense connected series
 *  (checkpoint 132): the other points draw no dot at all -- the line carries the
 *  shape -- but the selected one stays a visible, grabbable dot so you can still
 *  pick a point off the curve. See engine/seriesLine.ts for the curve/scatter rule. */

/** The heatmap grid's one colour, shared by the dashed lines on the canvas and
 * the handles that move them - so the thing you grab is visibly the thing that
 * moves. */
/**
 * ⚑⚑ THE SAME VIOLET THE BAR CHART'S CATEGORY TICKS USE, imported rather than
 * re-chosen. David: *"the points for the grids are difficult to spot, and we
 * should reuse the tick graphics we had for the bar graph"* - and then: *"We had
 * all of this already in the design, and you still went and invented everything
 * again. Why??"* He is right: the settled design says v2.1's category ticks are
 * the structural FOUNDATION for the heatmap grid, and a boundary you place on an
 * axis is the same mechanism whether the figure is a bar chart or a matrix. A
 * paler shade of my own choosing made it a different-looking thing that behaves
 * identically, and it was harder to see into the bargain.
 */


/** Bundled sample figures, one per graph type (checkpoint 46) -- Katalyst
 * Nord's own synthetic images, so free to ship. Opening one loads the image
 * and pre-selects its matching graph type, so a new user has a working
 * calibration target to explore. `axes` matches an ALL_AXES_TYPE_CONFIGS id. */
/** Data-export formats (v0.8): the three original plus PlotDigitizer-parity
 * additions. JSON has its own structured path; XLSX is a binary workbook
 * (engine/xlsxExport.ts); the rest render as text via engine/tableFormats.ts. */
type ExportFormat = 'json' | 'xlsx' | 'ods' | TableFormat;

// ⚑ v2.0: names shortened to drop the redundant "Type - " prefix (David) --
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
  /**
   * How many pictures the canvas has decoded (see `imageEpoch` on ImageCanvas's
   * status report).
   *
   * ⚑⚑ EVERY READING TAKEN OFF THE PIXELS HAS TO RE-RUN WHEN THE PIXELS CHANGE,
   * and until this existed there was nothing to notice that they had. The colour
   * key was memoised over an image it never named as an input, so figure 2's
   * colours were read against figure 1's key; the heatmap's cells were re-read
   * on the way IN to a figure, which is necessarily before its picture has
   * decoded, so the table on screen was sampled from the outgoing figure's ink.
   * Both are the same missing fact - "the picture is a different one now" - and
   * both now read it here. (v2.3 re-audit, F24/F25.)
   */
  const [imageEpoch, setImageEpoch] = useState(0);
  const handleCanvasStatus = useCallback((s: { scale: number; offsetX: number; offsetY: number; hasImage: boolean; imageWidth: number; imageHeight: number; imageEpoch: number }) => {
    imageLoadPendingRef.current = false; // audit M1: a status report means the (switched-to) image has settled
    setImageEpoch(s.imageEpoch);
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
  /** ⚑ LIVE, not captured: read by callbacks that are declared once and must see
   *  the mode the user is in NOW, not the one they were in at mount. */
  const modeRef = useRef<ToolMode>('calibrate');
  modeRef.current = mode;

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
  /** Which datum's Category cell is open in the XY-family spreadsheet (F28) -
   *  by POINT index, the same identity `setPointLabel` takes. */
  const [editingPointLabel, setEditingPointLabel] = useState<number | null>(null);
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
    // ⚑ THE SAME MENU, one more target (B16). A heatmap cell's menu says which
    // instrument read it - and reusing this one means it opens, closes, escapes
    // and anchors exactly like every other right-click in the app.
    | { x: number; y: number; kind: 'heatmap-cell'; col: number; row: number }
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
  // Figure capture (checkpoint 102): whether THIS
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
  /**
   * ⚑ REMEMBERED, not just widened. The rail was already resizable and reset to
   * 320 on every launch, so dragging it wider was work the user redid each
   * session - David: *"make the data out card a little wider by default to
   * accommodate the wider datasets."* A bigger default alone would have left the
   * forgetting intact one size along. `readPanelWidth` clamps, so a hand-edited
   * entry cannot smuggle a width past the drag handle's own limits.
   */
  const [chosenWidth, setChosenWidth] = useState<number | null>(readStoredPanelWidth);
  // ⚑⚑ DERIVED, NOT SET IN AN EFFECT. An unchosen width follows the GRAPH TYPE,
  // and the type is not known at mount - the Graph Type card is the first thing
  // a session does - so this cannot be decided once and stored. Computing it
  // each render makes "no choice yet" a state the rail simply reads, instead of
  // a state something has to remember to update: no effect, no cascading
  // render, and no window where the rail disagrees with the type on screen.
  // ⚑ A CHOSEN width always wins. `writePanelWidth` records a drag on release,
  // so a stored value is the user's own answer, and moving the rail under it
  // would be the app overruling a gesture it can see.
  const sidebarWidth = chosenWidth ?? defaultPanelWidthFor(sessionRef.current.getConfig().outputPanel);
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
      // ⚑ ONE CLAMP, shared with the store - the drag and the saved value cannot
      // disagree about what a legal width is.
      let latest = startWidth;
      const onMove = (ev: MouseEvent) => {
        latest = clampPanelWidth(startWidth + (startX - ev.clientX));
        setChosenWidth(latest);
      };
      const onUp = () => {
        // ⚑ Written on RELEASE, not per pixel: a drag is one decision, and
        // localStorage on every mousemove is a write per frame.
        writePanelWidth(latest);
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
  //
  // ⚑⚑ EMPTY, AND THAT IS THE WHOLE POINT. `engine/errorRelation.ts` refused an
  // `errorKind` field in these words: *"the kind is not in the geometry, it is
  // in the figure's caption, so we could only ask the user to type it, and
  // asking means offering a default, which is LabPlot's ±30 all over again (a
  // value that looks like a measurement and isn't)."* This state then pre-filled
  // 'SD' and the card re-applied it if you cleared the box, so a figure
  // captioned 95% CI recorded as SD unless the user noticed -- the decision was
  // made and the code did the opposite of it.
  //
  // ⚑ B4 raises the stakes rather than creating them: the base name is now the
  // EXPORT COLUMN HEADER (`errorSlotNames` -> 'SD upper'/'SD lower'), so an
  // invented label rides into the file instead of staying on screen.
  /**
   * Which series a cap will be filed under - held BY NAME (v2.3 re-audit, F39).
   *
   * ⚑⚑ AN INDEX IS NOT AN IDENTITY ACROSS A DELETE. This was a raw dataset index
   * and nothing ever revalidated it: delete the series above the one you had
   * chosen and every later index shifts down, so the dropdown went on reading
   * "Series 3" while the next drag filed its cap under what used to be Series 4.
   * A cap on the wrong series is exactly the failure the whole error model is
   * built to make visible, arriving through the one door that could not see it.
   *
   * ⚑ A NAME, for the reason `engine/errorRelation.ts` already gives about the
   * stored relation: it mirrors how a dataset binds to its axes, names are
   * unique (checkpoint 75), and a name survives the delete of an earlier series
   * where an index does not. The same argument, so the same answer - not a
   * second mechanism.
   *
   * ⚑ Null means "the series you are working on", which is what a fresh session
   * means and what a vanished target falls back to.
   */
  const [errorTargetName, setErrorTargetName] = useState<string | null>(null);
  /** Read through a ref by the capture handlers, which are declared long before
   *  `datasetInfos` is. `resolveErrorTarget` is the ONE resolver - see its doc. */
  const errorTargetNameRef = useRef<string | null>(null);
  errorTargetNameRef.current = errorTargetName;
  const errorTargetIndexNow = useCallback(
    () =>
      resolveErrorTarget(
        sessionRef.current.getDatasetInfos(),
        errorTargetNameRef.current,
        sessionRef.current.getActiveDatasetIndex()
      ),
    []
  );
  const [errorBaseName, setErrorBaseName] = useState('');
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
  // ⚑ THE CATEGORY STAGE HAS NO FOLD OF ITS OWN (v2.3). One card, one triangle:
  // `calibExpanded` governs both stages, exactly as it does on a heatmap. The
  // `categoryPanelOpen` flag went with the entry button that used to set it.
  /** The heatmap grid's fold-down on the calibration card. Closed to begin
   * with, like the category-tick panel: its summary line is on screen from the
   * start, so the feature is discoverable without the card growing over the
   * figure before anyone has asked it to. */
  /** Which band's name is being typed, per axis - the same one-at-a-time editor
   * the bar chart's category column uses. */
  /** The cell the user picked, in grid indices - the one thing tying a row of
   * the results to the square it was read from. */
  /**
   * The picked cells, as `col,row` keys.
   *
   * ⚑⚑ A SET, not one cell. David: *"I have no ability to edit or select
   * multiple cells... I cannot select a range of cells, or click cells on the
   * heatmap to select them... I cannot select a whole column for example."* The
   * heatmap had its own single-cell pick while the app has had marquee-drag and
   * Shift-click multi-select for DATA POINTS since v1.2 - a parallel mechanism
   * doing less, which is the pattern this release keeps repeating.
   *
   * ⚑ Kept as keys rather than as `{col,row}` objects so membership is a lookup
   * rather than a scan: a column pick on a large matrix adds hundreds at once.
   */
  const [selectedCells, setSelectedCells] = useState<ReadonlySet<string>>(new Set());
  /**
   * The cells the USER read, as positions on the colour key.
   *
   * ⚑⚑ A POSITION, NOT A NUMBER (B7). David: *"Heatmaps are a 2.5D graph type.
   * The values are STORED ON THE THIRD AXIS. Changing a value in a cell MOVES
   * THE VALUE on the third axis that records the value, and nothing else!"* So
   * an edited cell travels with the key when the key is recalibrated, exactly as
   * a data point travels with its axes - there is nothing here that a
   * recalibration would leave behind disagreeing with its neighbours.
   */
  const [heatmapCellReadings, setHeatmapCellReadings] =
    useState<HeatmapCellReadings>(NO_HEATMAP_CELL_READINGS);
  /**
   * The cell whose value is being typed into. Null unless one is.
   *
   * ⚑⚑ `seed` IS WHAT THE EDITOR OPENED WITH, and it is load-bearing: an editor
   * that opens and closes without a keystroke must record NOTHING. Without it,
   * committing on blur wrote the seeded number back as a reading, so merely
   * looking at a cell stamped it as user-read - a measurement nobody took,
   * indistinguishable in the file from one they did.
   */
  const [editingHeatmapValue, setEditingHeatmapValue] = useState<
    { col: number; row: number; value: string; seed: string } | null
  >(null);
  /**
   * Why the last typed cell value was refused.
   *
   * ⚑ BESIDE THE TABLE, not on the Heatmap card. The card is where the key and
   * the grid are set up; the cell was typed into in the results panel, and a
   * refusal that appears in a fold-out somewhere else is one the user never
   * connects to the thing they just did. Pattern 5 in CLAUDE.md - refusals fire
   * AT the gesture.
   */
  const [heatmapValueError, setHeatmapValueError] = useState<string | null>(null);
  /**
   * The colour under the key's cursor WHILE it is being dragged.
   *
   * ⚑⚑ THE PREVIEW IS AN INSTRUMENT, not decoration. You drag until the swatch
   * matches the cell in the figure - which turns B7's whole justification
   * ("their eye is the better instrument") into a gesture, because an eye
   * comparing two colours is far more sensitive than an eye estimating a number
   * off a ramp.
   * ⚑ It is the ACTUAL INK under the cursor, read straight from the image - not
   * a colour computed from the ramp - so the preview cannot disagree with the
   * key it is sitting on.
   * ⚠️ NEVER ON THE FIGURE. The figure is the immutable record and everything
   * floats above it (David, confirming: *"the preview lands on the table cell
   * and the marker, never on the image"*).
   * ⚑ And only WHILE dragging: at rest a tint means "read from the colour"
   * (B16), so a user-set cell settles back to plain-with-brackets rather than
   * quietly wearing the sampler's badge.
   */
  const [heatmapDragTint, setHeatmapDragTint] = useState<
    { col: number; row: number; rgb: readonly [number, number, number] } | null
  >(null);
  /** The single pick, for everything that still means "the one cell in hand" -
   * the readout, the canvas outline, the value the card names. Null unless
   * exactly one is picked, because "which cell?" has no answer for a range. */
  const selectedCell = useMemo(() => {
    if (selectedCells.size !== 1) return null;
    const [col, row] = [...selectedCells][0]!.split(',').map(Number);
    return { col: col!, row: row! };
  }, [selectedCells]);

  /**
   * Pick cells the way the app already picks points: plain click replaces,
   * Shift adds or removes, and a header takes a whole band.
   */
  const pickCells = useCallback(
    (keys: readonly string[], additive: boolean) => {
      setSelectedCells((prev) => {
        if (!additive) {
          // Clicking the current single pick clears it, as it always has.
          if (keys.length === 1 && prev.size === 1 && prev.has(keys[0]!)) return new Set();
          return new Set(keys);
        }
        const next = new Set(prev);
        // ⚑ A band toggles as a WHOLE: if every cell in it is already picked the
        // gesture removes them, otherwise it adds. Toggling cell-by-cell would
        // make a second Shift-click on a column a no-op for half of it.
        const allIn = keys.every((k) => next.has(k));
        for (const k of keys) {
          if (allIn) next.delete(k);
          else next.add(k);
        }
        return next;
      });
    },
    []
  );
  // ⚑ Keyed by the rendered COPY, not the band - the long form shows a band's
  // name once per cell, and one editor per copy fights itself for focus. See
  // `renderEditableName`'s `editKey`.
  const [editingHeatmapXName, setEditingHeatmapXName] = useState<number | string | null>(null);
  const [editingHeatmapYName, setEditingHeatmapYName] = useState<number | string | null>(null);
  // ⚑⚑ FOUR PIECES OF GESTURE STATE ARE GONE, because the gesture is gone. The
  // category axis was marked by clicking the CANVAS while a fold-out was open,
  // so the component had to remember a half-finished marking (`categoryFirstEdge`),
  // whether the seed was being overridden (`categoryPlaceBothEdges`), why a click
  // had been refused (`categoryMarkError`), and a count typed into a box of its
  // own (`categoryCountInput`). Both ends are calibration steps now, so the walk
  // owns all of it and the canvas needs no special mode.
  // ⛔ `# Series (optional)` stays exactly as it was - parked by standing order.
  const [categorySeriesInput, setCategorySeriesInput] = useState('');

  const [dataValueInputs, setDataValueInputs] = useState<string[]>([]);
  const [projectError, setProjectError] = useState<string | null>(null);
  /** What an import could not carry across, in plain words. NOT an error - the
   * figure opened - so it gets its own surface rather than borrowing the red
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
   * ⚠️ This comment used to say the opposite - that the grid was view state
   * only, lost on Save - and it stayed that way for a commit after persistence
   * shipped. A comment describing a limitation that has been fixed is read as
   * current by the next person; grade the comments against the code, not only
   * the prose.
   *
   * ⚑ Everything the buttons DO is in `engine/heatmapRun.ts`. What is left in
   * this file is which state to set. */
  /**
   * ⚑⚑ THE GRID IS STORED AS PARAMETERS, not data coordinates - David's rule:
   * *"The grid is not absolute, but in relation to the calibrated axis
   * position."* Renamed along with the meaning, so every reader had to be
   * revisited rather than silently keeping a number that now means something
   * else. `heatmapShownGrid` resolves it for everything downstream.
   */
  const [heatmapGridParams, setHeatmapGridParams] = useState<HeatmapGridParams | null>(null);
  /** Which divider handle the user last clicked, so the card can offer to remove
   * THAT boundary. Its own state rather than `activeHandleKey`, which is cleared
   * on anything that is not a placed calibration point (see the guard effect). */
  const [selectedDividerId, setSelectedDividerId] = useState<string | null>(null);
  /**
   * What the figure PRINTS along each axis, as the user typed it.
   *
   * ⚑ THE TEXT is the state and the parsed list is derived, not the other way
   * round: a user mid-way through typing `A, B, ` has a trailing separator that
   * a parse-and-reformat round trip would keep eating under their hands. The
   * record - the parsed list - is written to the axes on every change, so what
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
  /** The colour key's own span, captured when the cells were read - the third
   * axis's extent, which the export carries beside the readings taken on it. */
  const heatmapKeyRef = useRef<{ from: number; to: number; log: boolean } | undefined>(undefined);
  useEffect(() => {
    heatmapCellsRef.current = heatmapCells;
  }, [heatmapCells]);
  /**
   * The line under the grid, and WHICH KIND of claim it makes (v2.3, E1).
   *
   * ⚑ Detection reports an event; the even-grid overlay states a standing fact
   * about the grid. `showsGridNote` decides which of them survives the read, in
   * `engine/` where the case is a unit test rather than a JSX condition.
   */
  const [heatmapGridNote, setHeatmapGridNote] = useState<{ text: string; kind: GridNoteKind } | null>(null);
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
  /**
   * Shapes the last bar trace found and did NOT file - see
   * `partitionSwatchSuspects`.
   *
   * ⚑ THE BOXES THEMSELVES, not a count, for two reasons that are the same
   * reason: the offer has to be able to put them BACK in one gesture, and they
   * are drawn on the figure so the reader can see WHICH shapes were refused. A
   * count would make this a claim to be taken on trust.
   * ⚑ Not re-derivable by re-running the trace, which is how the new-colour offer
   * gets away with holding nothing: that one traces into a FRESH series, while
   * re-running here would file every bar a second time.
   */
  const [heldBackBars, setHeldBackBars] = useState<readonly DetectedBarBox[]>([]);
  // What the coloured pixels ARE (checkpoint 122): a continuous 'curve' (averaging
  // window, one point per column) or 'scatter' markers (blob detector, one point
  // per connected marker = its centroid). Both share the colour filter + preview;
  // only the reduction differs. `colorTraceMinBlob` drops noise specks below that
  // pixel diameter (scatter only).
  const [colorTraceShape, setColorTraceShape] = useState<'curve' | 'scatter'>('curve');
  const [colorTraceMinBlob, setColorTraceMinBlob] = useState(3);
  // B1 - an optional plot-box rectangle (image-pixel space) the trace is limited
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

  // The Trace Challenge's own state lives in ui/src/games/useTraceChallenge.ts
  // (`game`, set up further down once its host's callbacks exist). `game.phase`
  // null = not playing; it's orthogonal to `mode` -- a round runs in place-point.
  // Which datapoint-table value cell is mid-edit (checkpoint 39). Editing a
  // value and moving the point are two views of one thing: on commit the
  // point is repositioned via the axes' inverse transform. Kept as the raw
  // in-progress string so typing doesn't move the point on every keystroke --
  // it applies once, on blur/Enter.
  /**
   * The data value being typed into. Null unless one is.
   *
   * ⚑⚑ `seed` IS WHAT THE EDITOR OPENED WITH - the heatmap's own invariant
   * (`editingHeatmapValue` above), now this table's too, because the job is the
   * same one: an editor that opens and closes without a keystroke must record
   * NOTHING. Without it, blurring committed the seeded number back through
   * `setDataPointValue`, which MOVES the point and marks it as a user reading -
   * so merely looking at a value stamped it as typed, and a seed rounded to
   * three decimals moved the point while doing it (F23).
   */
  const [editingCell, setEditingCell] = useState<
    { index: number; axis: number; value: string; seed: string } | null
  >(null);
  /**
   * Reading category names off the figure (v2.4).
   *
   * ⚑⚑ THREE PIECES OF TRANSIENT STATE AND NOT ONE FIELD IN THE RECORD, which
   * is the whole provenance answer: `ocrArmed` is whether the next drag is a
   * label band, `ocrProposals` is what came back, and neither reaches a
   * category until Apply. A name in the record has therefore always been read
   * and approved by a person (David, 2026-08-30), so there is nothing to mark.
   */
  const [ocrArmed, setOcrArmed] = useState(false);
  const [ocrProposals, setOcrProposals] = useState<OcrProposal[] | null>(null);
  const [ocrBusyIndex, setOcrBusyIndex] = useState<number | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

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
     * matching, which is how the notice expires WITHOUT an effect that clears it -
     * a self-expiring value rather than state to be swept up after. */
    mode: ToolMode;
    seriesIndex: number;
  } | null>(null);

  const session = sessionRef.current;
  const config = session.getConfig();
  // `version` is a deliberately unused dependency of the memos below - it
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
  /**
   * The categorical stage, as three facts. It used to be a state machine with
   * four phases, a prompt, a seed, an escape hatch and a measured note about a
   * span that looked too short - all of it serving a marking gesture that is now
   * two steps of the calibration walk. See `engine/categoryTickOverlay.ts`.
   */
  const categoryStage = useMemo(() => {
    const ca = session.getCategoryAxis();
    return {
      supported: session.supportsCategoryTicks(),
      hasGeometry: ca.hasGeometry(),
      count: ca.getCategoryCount(),
      marked: ca.categoriesMarked(),
      // ⚑ Say what was DECLARED, or say that nothing was. A figure whose walk is
      // unfinished has no count, and printing `0 categories` would be a number
      // nobody typed - see `categoryStageLine`.
      declared: ca.hasDeclaredCount(),
      convention: ca.getConvention(),
      regenerateWarning: categoryRegenerateWarning(ca.hasAdjustments()),
    };
  }, [session, version, axes]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const isCalibrating = currentStep !== null;

  // --- Measure tool state (checkpoint: measure) ------------------------------
  // Active measurement tool (lifted from MeasureCard so canvas clicks route by
  // it), the recorded measurements, and the in-progress click(s). pendingMeasure
  // is mirrored into a ref so handleMeasureClick reads the latest without a stale
  // closure / extra dep churn.
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
  /**
   * THE MEASURE INSTRUMENT (v2.3, theme G) - its state machine and handlers.
   *
   * ⚑⚑ THE HOST IS ALL GETTERS. Passing values would capture them in the hook's
   * closures, and a stale one means the snap radius uses yesterday's zoom or a
   * click routes against the previous axes - a failure no test can see and only
   * a hand can find. Reading through a function means nothing is captured.
   *
   * ⚑ DESTRUCTURED BACK INTO THE SAME NAMES, so not one call site or JSX
   * reference below had to change. The move is behaviour-preserving at every
   * point of use, which is the only way to make a 180-line extraction reviewable.
   *
   * ⚑ The COLLECTION stays out here: measurements and the px->unit scale are
   * DOCUMENT state - the project file carries them, every figure record stashes
   * them, every undo snapshot captures them.
   */
  // ⚑⚑ THE HOST MUST BE STABLE, and finding out why cost a regression. Built as
  // a fresh object literal, it changed identity every render - so every callback
  // in the hook did too, so the keydown effect (which depends on `finishArea`)
  // REMOVED AND RE-ADDED its window listener on every render. A keypress
  // dispatched in that gap is simply lost, which is what the Alt-then-1 key-tip
  // test caught: pressing two keys fast enough landed one of them in the window
  // where nothing was listening.
  //
  // ⚑ So every getter reads a REF, and the object is memoised once. Stable
  // identity AND live values - the two properties the getter design was for, one
  // of which I had quietly given up by rebuilding the object each render.
  const canvasScaleRef = useRef(canvasScale);
  canvasScaleRef.current = canvasScale;
  const versionRef = useRef(version);
  versionRef.current = version;
  const imageEpochRef = useRef(imageEpoch);
  imageEpochRef.current = imageEpoch;
  const commitRef = useRef<() => void>(() => {});
  const measureHost = useMemo(
    () => ({
      session: () => sessionRef.current,
      axes: () => sessionRef.current.getAxes(),
      axesKind: () => sessionRef.current.getConfig().axesKind,
      canvasScale: () => canvasScaleRef.current,
      imageData: () => imageCanvasRef.current?.getImageData(),
      measurements: () => measurementsRef.current,
      applyMeasurements,
      measureScale: () => measureScaleRef.current,
      applyMeasureScale,
      keyInputs: () => ({
        placed: sessionRef.current.getPlacedPoints(),
        isLog: sessionRef.current.getOptions()['isLogValue'] === 'true',
      }),
      calibrationVersion: () => versionRef.current,
      imageEpoch: () => imageEpochRef.current,
      // ⚑ Through a ref, because `commit` is declared below this call AND its
      // identity changes - either alone would be enough to need one.
      commit: () => commitRef.current(),
    }),
    [applyMeasurements, applyMeasureScale]
  );
  const measure = useMeasure(measureHost);
  const {
    measureTool,
    pendingMeasure,
    setPending,
    measureError,
    setMeasureError,
    measureIdRef,
    settingScale,
    setSettingScale,
    scaleDraftPx,
    setScaleDraftPx,
    activeMeasure,
    setActiveMeasure,
    handleMeasureClick,
    selectMeasureTool,
    finishArea,
    measurementViews,
    copyMeasurement,
    deleteMeasurement,
    copyAllMeasurements,
    startSetScale,
    measureReference,
    setScaleDraft,
    colourScale,
  } = measure;

  const clearMeasurements = useCallback(() => {
    applyMeasurements([]);
    setPending([]);
    setMeasureError(null);
    applyMeasureScale(null);
    setSettingScale(false);
    setScaleDraftPx(null);
  }, [setPending, applyMeasurements, applyMeasureScale, setMeasureError, setScaleDraftPx, setSettingScale]);
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
  }, [setPending, setMeasureError, setScaleDraftPx, setSettingScale]);

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
  commitRef.current = commit;

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
  // pipeline, and the design's keystone. The
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
          'Is the ENTIRE figure - plot, axes, tick labels and title - clearly visible in the view? ' +
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
  // ⚑ CORRECTED 2026-07-17 - the paragraph that used to sit here was FALSE, and
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
   * about where the plot box is - they are simply the only span the session
   * knows, and detection fills in between them.
   */
  const heatmapBounds = useCallback((): { xMin: number; xMax: number; yMin: number; yMax: number } | null => {
    const axes = sessionRef.current.getAxes();
    return axes ? heatmapBounds_(axes as unknown as HeatmapFrameCarrier) : null;
  }, []);

  /** Category or value, per axis, as the calibration recorded it. */
  const heatmapKinds = useCallback((): HeatmapAxisKinds => {
    const axes = sessionRef.current.getAxes();
    return axes
      ? heatmapAxisKinds(axes as unknown as HeatmapFrameCarrier)
      : { x: 'value' as const, y: 'value' as const };
  }, []);

  /** Is this a calibrated heatmap with an image to read? The card's buttons are
   * disabled rather than absent when it is not, so nothing appears out of
   * nowhere once the last calibration value is typed. */
  const heatmapActive = axesTypeId === HEATMAP_AXES_CONFIG.id;

  /**
   * The grid as the user sees it: what has been recorded, or - before anything
   * has - the one cell a finished calibration already implies.
   *
   * ⚑⚑ THE GRID CONTROLS WERE AN INVISIBLE PRECONDITION WITHOUT THIS. The
   * overlay, the drag handles and the boundary buttons all appeared only after
   * pressing Detect or Read, and nothing on screen said so - the keystone
   * persona's named failure mode, and worst on exactly the figures that need the
   * grid most: a continuous field draws no cell boundaries at all, so detection
   * has nothing to find and its user could reasonably conclude the grid is
   * something only a drawn-grid figure gets.
   *
   * ⚑ DERIVED, NOT STORED, which is why it is a `useMemo` and not an effect
   * writing state. Nothing goes into the axes' metadata until the user actually
   * changes something: an untouched grid is recoverable from the calibration it
   * came from, and a file that carried it would be storing a copy of something
   * derivable - the same rule that keeps the colour key's SAMPLES out of the
   * project file. Every edit path below records the result.
   */
  /** The record the text boxes stand for - parsed once per render rather than at
   * each of the three places that need it. */
  const heatmapLabels = useMemo<HeatmapLabels>(
    () => ({ x: parseLabelList(heatmapXLabels), y: parseLabelList(heatmapYLabels) }),
    [heatmapXLabels, heatmapYLabels]
  );

  /**
   * The band counts the CALIBRATION declared, per axis.
   *
   * ⚑ David: *"Why do I have to FIRST tell it that there are 5 rows in the
   * calibration, and then 5 again? That should carry over."* It does - the walk
   * asks once, for BOTH axis kinds, and this is the only reader.
   *
   * ⚑⚑ IT NO LONGER RETURNS NULL FOR A VALUE AXIS. That null is what the grid
   * panel's own Columns/Rows boxes existed to fill, which made two places to
   * answer one question - and only one of them was reachable on a numeric axis.
   */
  const heatmapCounts = useCallback((): { columns: number; rows: number } => {
    const axes = sessionRef.current.getAxes();
    if (!axes) return { columns: NaN, rows: NaN };
    return heatmapBandCounts(axes as unknown as HeatmapFrameCarrier);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, version]);

  const heatmapShownGrid = useMemo<HeatmapState | null>(() => {
    if (!heatmapActive) return null;
    if (heatmapGridParams !== null) {
      // ⚑ Resolved against the calibration IN FORCE, every render. Retype a
      // calibration value and the parameters hold, so the grid stays on the ink
      // and its data coordinates change; move a handle and the grid follows the
      // axis. Neither needs a synchronisation pass, which is the whole reason
      // the store is parametric.
      const spans = heatmapAxisSpans(sessionRef.current.getPlacedPoints(), sessionRef.current.getAxes());
      return spans === null ? null : resolveHeatmapGrid(heatmapGridParams, spans);
    }
    if (!session.isCalibrated()) return null;
    // ⚑⚑ NO GRID UNTIL ONE HAS BEEN MEASURED. This used to fall back to an
    // evenly divided lattice the moment the count was known - geometry we
    // INVENTED, drawn as confidently as one we had read off the figure. On any
    // figure whose columns are not evenly spaced (0, 1, 2, 4, 8, 24 is an
    // ordinary time axis) that grid is visibly wrong, and David: *"it will look
    // like we have gotten it wrong every single time. We show it AFTER."*
    //
    // ⚑ Tenet 9, in its plainest form. The COUNT is a declaration the user made;
    // the POSITIONS were ours. Drawing them as one thing said we had measured
    // something we had not. An even lattice is still available for a continuous
    // field - but it is asked for, never asserted.
    return null;
    // `version` is the only signal React has that the ref-held session mutated,
    // so it is listed deliberately even though the body does not read it -
    // without it this would freeze at "not calibrated yet" (see the same note
    // above the memo block further down).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmapActive, heatmapGridParams, session, version]);

  /**
   * Have the axes moved since this grid was recorded?
   *
   * ⚑ Compared against the STAMP the grid carries, not tracked as an event. A
   * calibration point moves from two places (a drag and a keyboard nudge), and a
   * flag set at the call sites would be the "model with more than one entrance"
   * shape that the v2.1 audit found four times in one day. A stamp has one
   * entrance and survives save, load and undo for free.
   */
  const heatmapAxisHasMoved = useMemo(() => {
    if (!heatmapActive || heatmapGridParams === null) return false;
    return heatmapAxisMoved(heatmapGridParams.axisAt, sessionRef.current.getPlacedPoints());
    // `version` is how React learns the ref-held session mutated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmapActive, heatmapGridParams, version]);

  /**
   * Set the grid, and put it where a save and an undo will both find it.
   *
   * ⚑ ONE PLACE, because there are two consumers that must never disagree: the
   * overlay on screen reads the state, and the project file reads the axes'
   * metadata. Writing the state without the metadata gives a grid that vanishes
   * on Save; writing the metadata without the state gives one that is saved and
   * invisible. The undo snapshot serializes the axes, so this is also what makes
   * a grid edit undoable - without any new snapshot field.
   */
  /**
   * Change one part of the heatmap's record, leaving the rest alone.
   *
   * ⚑⚑ ONE PLACE, because the grid, the NAMES and the user's own readings are
   * three parts of ONE layer and three writers used to reach three separate
   * metadata keys. Merging here is what lets a name edit leave the grid alone
   * without every caller knowing the layer's shape.
   * ⚑ It lives on the SESSION, so a Save and an undo both find it through
   * `captureState` - the door `categoryAxis` already uses. It is no longer in
   * axes metadata, so re-calibrating cannot touch it and nothing has to copy it
   * across (David: *"anything detected sits on TOP of the calibration"*).
   */
  const patchHeatmapLayer = useCallback((patch: Partial<SerializedHeatmapLayer>) => {
    const current = sessionRef.current.getHeatmapLayer() ?? {};
    const next: SerializedHeatmapLayer = { ...current, ...patch };
    // An empty layer is NO layer - so a heatmap that has been cleared writes no
    // key at all rather than an empty one, exactly as the grid already does.
    for (const key of Object.keys(next) as (keyof SerializedHeatmapLayer)[]) {
      if (next[key] === undefined) delete next[key];
    }
    sessionRef.current.setHeatmapLayer(Object.keys(next).length > 0 ? next : null);
  }, []);

  const applyHeatmapGrid = useCallback((grid: HeatmapState | null) => {
    // ⚑ Detection reads the INK and a dragged handle lands on a PIXEL, so both
    // arrive in data coordinates. Converting here - at the one writer - is what
    // keeps the store parametric without every caller having to know.
    const placedNow = sessionRef.current.getPlacedPoints();
    const spans = heatmapAxisSpans(placedNow, sessionRef.current.getAxes());
    const base = grid === null || spans === null ? null : heatmapGridToParams(grid, spans);
    // ⚑ Stamped where the axes SIT right now, so the app can later say "these
    // have moved since" - the one thing David's rule 4 needs, and nothing more.
    const stamp = heatmapAxisStamp(placedNow);
    const params = base === null ? null : stamp ? { ...base, axisAt: stamp } : base;
    setHeatmapGridParams(params);
    // ⚑ Copied into plain arrays on the way into the record: the store is
    // readonly by intent, and the serialized shape is what a file holds.
    patchHeatmapLayer({
      grid: params
        ? { x: [...params.x], y: [...params.y], ...(params.axisAt ? { axisAt: params.axisAt } : {}) }
        : undefined,
    });
  }, [patchHeatmapLayer]);

  /**
   * The axis NAMES, recorded where the grid is recorded.
   *
   * ⚑ THE PARSED LIST IS WHAT IS SAVED, never the raw text: the file then holds
   * the record (one name per cell) instead of a punctuation style, and a reopen
   * rebuilds the line from the list. Same axes-metadata home as the grid, so
   * naming a column is saved and undone by machinery that already exists.
   *
   * ⚑ THE CELLS ARE RE-READ so the table shows the name the moment it is typed.
   * The values do not change - a name cannot move a boundary - but a table that
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
      // ordinary upward-y plot - see `labelsForCells`. Storing the typed order
      // verbatim filed every name against the wrong row, silently.
      const typed: HeatmapLabels = { x: parseLabelList(xText), y: parseLabelList(yText) };
      const labels = labelsForCells(typed, grid, axes);
      patchHeatmapLayer({ labels: { x: [...labels.x], y: [...labels.y] } });
      setHeatmapCells((prev) =>
        prev.map((row) => ({
          ...row,
          xLabel: labels.x[row.col] ?? '',
          yLabel: labels.y[row.row] ?? '',
        }))
      );
    },
    [heatmapShownGrid, patchHeatmapLayer]
  );

  /**
   * Take the heatmap's record back OUT of the session - the load path, and the
   * undo path.
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
  /**
   * Read every cell of a given grid, or say it cannot be done.
   *
   * ⚑ EXTRACTED so the FORWARD path and the UNDO path cannot drift apart. They
   * had drifted: a grid edit re-read, and taking the same edit back CLEARED -
   * so one undo cost the whole table. David chose symmetry: *"Re-read, matching
   * the forward path."*
   * ⚑ Takes the readings as an ARGUMENT rather than off state, because the undo
   * path installs them in the same tick and React has not applied them yet.
   */
  const readCellsFor = useCallback(
    (grid: HeatmapState, readings: HeatmapCellReadings) => {
      const axesNow = sessionRef.current.getAxes();
      const img = imageCanvasRef.current?.getImageData();
      if (!axesNow || !img) return null;
      const image = { data: img.data, width: img.width, height: img.height };
      const { scale } = buildColorScale(
        sessionRef.current.getPlacedPoints(),
        image,
        sessionRef.current.getOptions()['isLogValue'] === 'true'
      );
      if (!scale) return null;
      return readHeatmapCells(
        image,
        axesNow,
        grid,
        scale,
        labelsForCells(heatmapLabels, grid, axesNow),
        heatmapKinds(),
        readings
      );
    },
    [heatmapKinds, heatmapLabels]
  );

  const restoreHeatmapGrid = useCallback(() => {
    const axes = sessionRef.current.getAxes();
    // ⚑⚑ ONE READ, of ONE LAYER. This used to be three reads of three axes
    // metadata keys - which is what let a re-calibration empty all three at
    // once. The grid, the names and the user's own readings are one record and
    // they now come back together, from the session rather than from the axes.
    const layer = sessionRef.current.getHeatmapLayer();
    const restoredParams = layer?.grid ?? null;
    setHeatmapGridParams(restoredParams);
    // ⚑ The user's OWN readings come back with it: a cell someone corrected by
    // eye that came back reading the colour again would silently undo a
    // measurement, and look exactly like a file that never held one.
    const restoredReadings = layer?.readings ?? NO_HEATMAP_CELL_READINGS;
    setHeatmapCellReadings(restoredReadings);
    // ⚑ And the names, for the same reason: a reopened heatmap whose columns
    // lost their names would export the index numbers this whole feature exists
    // to replace, silently.
    const stored = layer?.labels ?? { x: [], y: [] };
    // ⚑ The file holds PARAMETERS; the label and read helpers want the resolved
    // data coordinates. Resolving here, once, keeps the single conversion point.
    const restoreSpans = heatmapAxisSpans(sessionRef.current.getPlacedPoints(), sessionRef.current.getAxes());
    const restoredGrid =
      restoredParams && restoreSpans ? resolveHeatmapGrid(restoredParams, restoreSpans) : null;
    const shown = restoredGrid && axes ? labelsForCells(stored, restoredGrid, axes) : stored;
    setHeatmapXLabels(formatLabelList(shown.x));
    setHeatmapYLabels(formatLabelList(shown.y));
    // ⚑⚑ RE-READ, DON'T EMPTY. Undoing a divider nudge used to clear the whole
    // results table, on the sound-sounding principle that a table describing the
    // previous grid measures a figure that no longer exists. But the FORWARD
    // path re-reads, so one undo cost strictly more than the edit it took back -
    // including cells a person had read by hand. David: *"Re-read, matching the
    // forward path."* The readings themselves survive either way (they are
    // stored as positions on the key), but the table they belong to did not.
    // ⚑ Falls back to empty exactly where a read is impossible - no image yet on
    // the load path, or no colour key - which is the old behaviour, kept for the
    // case that actually needed it.
    const reread = restoredGrid ? readCellsFor(restoredGrid, restoredReadings) : null;
    setHeatmapCells(reread?.rows ?? []);
    setHeatmapSummary(reread?.summary ?? '');
    setHeatmapGridNote(null);
    setHeatmapError(null);
  }, [readCellsFor]);

  /**
   * Re-read the cells once a new picture has actually decoded.
   *
   * ⚑⚑ THE OTHER HALF OF `restoreHeatmapGrid`, and the reason it was wrong on
   * its own. The grid comes from the SESSION, so it is restored the instant the
   * session is swapped - necessarily before the incoming figure's image has
   * decoded. So the read that restore does lands on whatever was still on the
   * canvas: the OUTGOING figure's ink, read through the INCOMING figure's grid,
   * filed under the incoming figure's labels. Every number wrong, nothing on
   * screen saying so - a heatmap has no eye-check (CLAUDE.md, "we are never the
   * only instrument", and its warning that colour IS the value).
   *
   * ⚑ Keyed on the picture, not on the figure, so it covers the three ways
   * pixels change under a standing grid: a figure switch, a project opened on
   * top of a live figure, and an image EDIT (grid removal repaints the cells
   * this table measures).
   *
   * ⚑ Through a ref-held read: `readCellsFor` changes identity whenever the
   * label text does, and an effect that re-ran on every keystroke would fight
   * the person typing.
   */
  const rereadCellsRef = useRef<() => void>(() => {});
  rereadCellsRef.current = () => {
    const grid = heatmapShownGrid;
    if (!grid) return;
    const result = readCellsFor(grid, heatmapCellReadings);
    // ⚑⚑ A REFUSED RE-READ CLEARS THE TABLE, it does not leave the old one up
    // (v2.3 audit fleet, A5). Returning silently here was F25's OWN failure
    // surviving in its residual case: if the incoming figure cannot yield a
    // colour key - its key points fall outside a smaller image, say - the
    // numbers `restoreHeatmapGrid` sampled from the OUTGOING figure's ink stayed
    // on screen, filed under the incoming figure's grid and labels. Colour is
    // the value, so there is no eye-check that would catch it.
    // ⚑ Empty is what the restore path already does when a read is impossible;
    // this is the same answer at the same moment, not a new rule.
    if (!result) {
      setHeatmapCells([]);
      setHeatmapSummary('');
      return;
    }
    setHeatmapCells(result.rows);
    setHeatmapSummary(result.summary);
  };
  useEffect(() => {
    if (imageEpoch === 0) return; // no picture has ever arrived
    rereadCellsRef.current();
  }, [imageEpoch]);

  /**
   * A divider was dragged. Move it, or leave everything exactly as it was.
   *
   * ⚑ THE REFUSAL IS THE FEATURE. `dragDivider` will not let a boundary cross
   * its neighbour, and when it refuses, this does nothing at all - React
   * re-renders the handle from unchanged state, so it springs back to where it
   * was and the user sees the divider stop. Re-sorting instead would keep the
   * geometry valid and renumber every cell past it: every value still correct,
   * every one filed under the wrong column.
   *
   * ⚑ THE CELLS ARE RE-READ, not left stale. A table describing the previous
   * grid is a measurement of a figure that no longer exists - the rule the
   * Geometry card already follows. Re-reading only happens once cells exist, so
   * a user adjusting the grid before pressing Read cells is not surprised by a
   * table appearing under their hands.
   */
  /**
   * Record a grid the user just edited, and re-read the cells it moved.
   *
   * ⚑⚑ THE NOTE STAYS UNTIL `Read cells`. Adjusting a boundary used to clear
   * it, on the reasoning that a report the user has overruled is a wrong
   * statement rather than stale wording. David, seeing it go on the first drag:
   * *"You are treating the users like idiots, which they are not otherwise. They
   * can see clearly that something is amiss here, but the text should just stay
   * until they click [Read cells]."*
   *
   * ▶ Dragging a handle IS the adjust-then-look loop. Deleting the sentence the
   * moment it starts takes the reference away exactly when it is being used, and
   * it treats one unfinished adjustment as a decision. `Read cells` is the
   * gesture that means "I am done defining this grid", and that is where the
   * card's guidance retires.
   */
  const applyHeatmapGridEdit = useCallback(
    (next: HeatmapState) => {
      const axesNow = sessionRef.current.getAxes();
      if (!axesNow) return;
      applyHeatmapGrid(next);
      // ⚑ THE SAME CALL THE UNDO PATH MAKES. These two were separate bodies and
      // they drifted - this one re-read, the other emptied the table - so the
      // symmetry is now structural rather than a thing to remember.
      if (heatmapCells.length > 0) {
        const result = readCellsFor(next, heatmapCellReadings);
        if (result) {
          setHeatmapCells(result.rows);
          setHeatmapSummary(result.summary);
        }
      }
      commit();
    },
    [applyHeatmapGrid, commit, heatmapCells.length, heatmapCellReadings, readCellsFor]
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
   * Add a boundary on one axis - the hand `detectGrid` tells the user to use.
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
        setHeatmapError('There is no room for another boundary - the widest cell is already as thin as a boundary.');
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
   * dragged reads out where it is now - and one that stopped existing (undo, a
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
      setHeatmapError('Finish the calibration first - the grid is measured against it.');
      return;
    }
    const start = heatmapShownGrid ?? initialGridFor(bounds, heatmapCounts());
    // ⚑ A declared category count is the check; the box is only for a value axis.
    // ⚑ Detection is CHECKED against the declaration, never a second way to
    // make one: the walk asked how many columns and rows the figure has, and
    // that number is what tells detection when to stop and when to report a
    // miss. Same rule v2.1's category ticks set.
    const declared = heatmapCounts();
    const columns = Number.isInteger(declared.columns) ? declared.columns : undefined;
    const rows = Number.isInteger(declared.rows) ? declared.rows : undefined;
    const result = detectGrid({ data: img.data, width: img.width, height: img.height }, axes, start, {
      ...(columns !== undefined ? { columns } : {}),
      ...(rows !== undefined ? { rows } : {}),
    });
    // ⚑ Held and set AFTER the grid change below, because the edit path CLEARS
    // this - correctly, since an edit invalidates the previous report.
    // Detection's own report is the one thing that survives its own grid change,
    // being a statement about that change.
    const message = result.message;
    // ⚑ A refused detection leaves the PREVIOUS grid alone. Replacing it with
    // nothing would throw away work the user had already accepted, to report a
    // failure the message has already reported.
    // ⚑⚑ AND IT IS AN UNDO STEP. David, on the built package: *"undo removed the
    // whole grid. :-O"* - because detection took no snapshot, so a Ctrl+Z after
    // reading jumped back past the detection to the last calibration step and
    // the grid went with it.
    // ⚑ THE ASYMMETRY WAS THE TELL: EDITING a divider committed, and CREATING
    // the grid did not. Adjusting the record was undoable while making it was
    // invisible - so undo could only ever take back more than the user did.
    if (result.grid !== null) {
      // ⚑⚑ THROUGH THE EDIT PATH, BECAUSE DETECT IS A GRID CHANGE. This called
      // the raw `applyHeatmapGrid`, which stores the grid and nothing else - so
      // a table already read went on describing the grid it was read from.
      // Invisible whenever detection returned the SAME grid, and glaring the
      // moment it did not: David saw "Grid - 5 × 4 cells" beside a matrix of 12.
      // ⚑ The rule was already written on the path that gets it right: *"A report
      // of a measurement that no longer describes the grid is not stale wording,
      // it is a wrong statement."* One rule, two callers, one not using it.
      applyHeatmapGridEdit(result.grid);
    }
    setHeatmapGridNote({ text: message, kind: 'detection' });
  }, [applyHeatmapGridEdit, heatmapBounds, heatmapCounts, heatmapShownGrid]);

  /**
   * Lay an evenly spaced grid over the plot, because the user asked for one.
   *
   * ⚑⚑ THE LATTICE IS NOW A REQUEST. It used to be drawn automatically the
   * moment a count was known, which asserted boundaries nobody had measured -
   * and on a figure with unequal columns it was visibly wrong on every use. What
   * survives is the case that genuinely needs it: a continuous field draws no
   * cell boundaries at all, so a sampling lattice is the honest reading, and the
   * message says plainly that these positions are chosen rather than read.
   */
  const overlayEvenHeatmapGrid = useCallback(() => {
    const bounds = heatmapBounds();
    const counts = heatmapCounts();
    if (!bounds || !Number.isInteger(counts.columns) || !Number.isInteger(counts.rows)) {
      setHeatmapError('Finish the calibration first - an even grid is spaced across it.');
      return;
    }
    setHeatmapError(null);
    applyHeatmapGrid(initialGridFor(bounds, counts));
    // ⚑ Its own undo step, for the same reason detection is one: laying a
    // lattice is a change to the record, so taking it back must not cost more.
    commit();
    setHeatmapGridNote({
      text: `Even ${counts.columns} × ${counts.rows} grid laid over the plot - these boundaries are CHOSEN, not measured from the figure. Drag them onto the cells, or press Detect grid to read the ones the figure draws.`,
      kind: 'provenance',
    });
  }, [applyHeatmapGrid, commit, heatmapBounds, heatmapCounts]);

  /**
   * Read the matrix.
   *
   * ⚑ ONE READ PATH, and the user's own readings are an argument to it rather
   * than a pass over the result. `readHeatmapCells` applies them through the
   * SAME `valueAtPosition` ours come out of, so their number and ours are
   * comparable by construction - patching the rows afterwards would be a second
   * transform, and the two would disagree the first time the key was
   * recalibrated.
   */
  const runHeatmapRead = useCallback((readings: HeatmapCellReadings = heatmapCellReadings) => {
    setHeatmapError(null);
    const img = imageCanvasRef.current?.getImageData();
    const axes = sessionRef.current.getAxes();
    const bounds = heatmapBounds();
    if (!img || !axes || !bounds) {
      setHeatmapError('Finish the calibration first - the cells are read through it.');
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
    // ⚑⚑ NO GRID, NO CELLS. This used to fall back to an evenly divided lattice
    // and read the figure through it - every value filed under boundaries nobody
    // had measured, and the numbers look exactly as trustworthy as measured ones.
    // A heatmap's cells ARE its grid; without one there is nothing to report.
    // ⚑ The key's ENDS are its extent - `vmin`/`vmax` in the generator that drew
    // the figure. Recorded here, where the scale exists, rather than recomputed
    // at export time from something that may have moved.
    const keyFrom = valueAtPosition(scale, 0);
    const keyTo = valueAtPosition(scale, 1);
    heatmapKeyRef.current =
      keyFrom === null || keyTo === null
        ? undefined
        : { from: keyFrom, to: keyTo, log: sessionRef.current.getOptions()['isLogValue'] === 'true' };
    const grid = heatmapShownGrid;
    if (!grid) {
      setHeatmapError(
        'No grid yet - detect the boundaries the figure draws, or overlay an even grid from the Grid fold-out, then read the cells.'
      );
      return;
    }
    const result = readHeatmapCells(
      image,
      axes,
      grid,
      scale,
      labelsForCells(heatmapLabels, grid, axes),
      heatmapKinds(),
      readings
    );
    applyHeatmapGrid(grid);
    setHeatmapCells(result.rows);
    setHeatmapSummary(result.summary);
    setHeatmapError(result.error);
    // ⚑⚑ E1 - DETECTION'S REPORT RETIRES WHEN THE CELLS ARE READ. "5 columns,
    // matching the 4 boundaries found" describes the step BEFORE this one, and
    // `result.summary` beside it describes the figure better ("25 cells read,
    // all clean"). Leaving it up is a card still reporting a proposal after the
    // proposal has been acted on.
    //
    // ⚑ THE SAME RULE ADDING A BOUNDARY ALREADY FOLLOWS, one step later -
    // *"the user overruled the proposal; the proposal stops describing the
    // grid."* Here the user did not overrule it, they USED it, which retires it
    // just as completely.
    //
    // ⚑ It is not tidiness. By this point both fold-outs are collapsed and the
    // message still sits ON the figure, over the plot's top-left corner, with no
    // fold to hide in - so until now there was no way to dismiss it at all.
    // David, on the built package: *"it would be nice to be able to collapse the
    // calibration card more at this stage, when its work is done."*
    //
    // ⚑ In the SHARED read rather than in the button, so the boundary-drag and
    // undo paths retire it too - the same reasoning that put the re-read here.
    //
    // ⚑⚑ AND ONLY WHAT A READ ACTUALLY RETIRES (v2.3). This cleared the line
    // whatever it said, so laying an EVEN grid and then reading it wiped *"these
    // boundaries are CHOSEN, not measured from the figure"* - the one sentence
    // keeping a generated grid from reading exactly like a measured one, deleted
    // to tidy away a report about something else. A report describes the run; the
    // provenance describes the grid, and only the first is over.
    setHeatmapGridNote((note) => (note && noteRetiresOnRead(note.kind) ? null : note));
    return result.error === null && result.rows.length > 0;
  }, [applyHeatmapGrid, heatmapBounds, heatmapCellReadings, heatmapKinds, heatmapLabels, heatmapShownGrid]);

  /**
   * The Grid card's ENDING: read the cells, then close the card.
   *
   * ⚑⚑ ONLY THE BUTTON FOLDS. The same read runs when a boundary is dragged and
   * when a cell is corrected - folding there would shut the card the user is
   * working in, and the adjust-then-look loop is real (a drag re-reads by
   * itself). So the fold belongs to the GESTURE that means "I am finished
   * defining this grid", not to the reading.
   *
   * ⚑ AND ONLY ON SUCCESS. A refusal has to stay on screen beside the button
   * that produced it; folding the card would file the sentence away in a closed
   * fold-out, which is the "refusals fire AT the gesture" failure in mirror
   * image.
   */
  const finishHeatmapGrid = useCallback(() => {
    if (runHeatmapRead()) {
      // ⚑⚑ THE ENDING FOLDS THE CARD, not a fold-out inside it. Read cells is
      // stage 2's ending and the card has ONE fold now, so finishing collapses
      // the whole two-stage card to its single line - which is the behaviour
      // David asked for and, before this, the reason the grid panel had a fold
      // of its own at all.
      setCalibExpanded(false);
      // ⚑⚑ THE READ IS ITS OWN UNDO STEP. It produces the entire table, and it
      // took no snapshot - so undo had nothing to land on between "grid
      // detected" and "calibration finished", and took the grid with it.
      // ⚑ Committed HERE rather than inside `runHeatmapRead`, because that same
      // read runs on every divider drag and every corrected cell, and both of
      // those already commit. One gesture, one entry.
      commit();
    }
  }, [commit, runHeatmapRead]);

  /**
   * Record what the user read in a cell, and put it where a save and an undo
   * will both find it.
   *
   * ⚑ THE SAME SHAPE AS `applyHeatmapGrid`, one line below it in spirit: state
   * for the screen, axes metadata for the file, and the undo snapshot serializes
   * the axes so this is undoable without a new snapshot field.
   */
  const applyHeatmapCellReadings = useCallback(
    (next: HeatmapCellReadings) => {
      setHeatmapCellReadings(next);
      patchHeatmapLayer({ readings: { ...next } });
      runHeatmapRead(next);
      commit();
    },
    [commit, patchHeatmapLayer, runHeatmapRead]
  );

  /**
   * Commit the number the user typed into a cell.
   *
   * ⚑⚑ IT MOVES THE CELL ALONG THE COLOUR KEY - the third axis's inverse - which
   * is the identical gesture to editing a data point's y, where `dataToPixel`
   * repositions the point. `setCellReading` holds the refusal (a log key has no
   * zero and no negative side), so the model refuses at the gesture and the
   * sentence appears beside the table that was typed into.
   */
  const commitHeatmapValueEdit = useCallback(() => {
    const edit = editingHeatmapValue;
    setEditingHeatmapValue(null);
    setHeatmapValueError(null);
    if (!edit) return;
    // ⚑ AN EDITOR THAT WAS OPENED AND CLOSED IS NOT A READING. Nothing was
    // typed, so nothing is recorded, nothing is re-read and no undo entry is
    // made - the alternative silently converted a glance into a measurement.
    if (edit.value === edit.seed) return;
    const img = imageCanvasRef.current?.getImageData();
    const image = img ? { data: img.data, width: img.width, height: img.height } : null;
    const { scale } = image
      ? buildColorScale(
          sessionRef.current.getPlacedPoints(),
          image,
          sessionRef.current.getOptions()['isLogValue'] === 'true'
        )
      : { scale: null };
    // ⚑ SAID, not swallowed. There is no way to place a value on a key that
    // cannot be read, and a typed number that simply vanished would look like
    // the app ignoring the user - the failure mode this whole feature answers.
    if (!scale) {
      setHeatmapValueError(
        'The colour key cannot be read, so there is no scale to place that value on - recalibrate the key first.'
      );
      return;
    }
    const { readings, error } = setCellReading(
      heatmapCellReadings,
      scale,
      edit.col,
      edit.row,
      edit.value
    );
    if (error !== null) {
      setHeatmapValueError(error);
      return;
    }
    applyHeatmapCellReadings(readings);
  }, [applyHeatmapCellReadings, editingHeatmapValue, heatmapCellReadings]);

  /** Hand the cell back to the colour key - the other half of B16's menu.
   * ⚑ NOT `useKeyReadingForCell`: a plain function whose name begins with "use"
   * is a React hook as far as every lint rule and every reader is concerned. */
  const readCellFromKey = useCallback(
    (col: number, row: number) => {
      applyHeatmapCellReadings(clearCellReading(heatmapCellReadings, col, row));
    },
    [applyHeatmapCellReadings, heatmapCellReadings]
  );

  /** Which instrument read this cell - read off the ROW, so the menu can never
   * disagree with the number and the tint the user is looking at. */
  const heatmapCellSourceAt = useCallback(
    (col: number, row: number): 'colour' | 'user' | 'ocr' =>
      heatmapCells.find((c) => c.col === col && c.row === row)?.source ?? 'colour',
    [heatmapCells]
  );

  const handleHeatmapCellContextMenu = useCallback(
    (col: number, row: number, clientX: number, clientY: number) => {
      setCtxMenu({ x: clientX, y: clientY, kind: 'heatmap-cell', col, row });
    },
    []
  );

  /**
   * The picked cell's four corners, for the canvas.
   *
   * ⚑ Built through the axes' own `dataToPixel` like the grid lines are, so a
   * rotated calibration outlines the cell the figure drew rather than a
   * screen-aligned rectangle near it.
   */
  const heatmapSelectionOutline = useMemo(() => {
    if (!heatmapShownGrid || !selectedCell) return null;
    const axes = session.getAxes();
    if (!axes) return null;
    const cells = cellsOf(heatmapShownGrid.xDividers, heatmapShownGrid.yDividers);
    const cell = cells?.find((c) => c.col === selectedCell.col && c.row === selectedCell.row);
    if (!cell) return null;
    return [
      axes.dataToPixel(cell.xMin, cell.yMin),
      axes.dataToPixel(cell.xMax, cell.yMin),
      axes.dataToPixel(cell.xMax, cell.yMax),
      axes.dataToPixel(cell.xMin, cell.yMax),
    ];
  }, [heatmapShownGrid, selectedCell, session]);

  /**
   * The grid drawn on the figure: one line per divider, spanning the grid's own
   * extent on the other axis.
   *
   * ⚑ Built through the axes' `dataToPixel`, so a rotated calibration draws a
   * rotated grid - the lines land on the figure's own cells rather than on the
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
  /** Put the pending flag down WITHOUT an undo entry - what Escape needs.
   *
   * ⚑ Escape restores the value the editor opened with, so by the time it ends
   * nothing has changed and there is nothing to undo. But the restore itself
   * goes through `onChange`, which RAISES the flag, so simply not committing
   * left it set and the next unrelated blur pushed an empty undo step.
   * (v2.3 audit fleet, A7.) */
  const cancelPendingEdit = useCallback(() => {
    pendingEditRef.current = false;
  }, []);
  /** Mark a text edit in progress from a handler declared ABOVE the ref.
   *
   * ⚑ The React Compiler refuses a ref mutation that appears earlier in the
   * component than the `useRef` it belongs to - and it reports the refusal at
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
    // ⚑⚑ ...and the shapes a trace HELD BACK, for the identical reason: an undo
    // rolls the trace itself back, and the offer would then file a legend swatch
    // into a session that no longer holds the bars it was measured against -
    // through the ordinary capture path, so nothing downstream would look wrong.
    setHeldBackBars([]);
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

  /**
   * ⚑⚑ ONE DOOR'S WORTH OF RESET, FOR EVERY DOOR THAT INSTALLS A FIGURE.
   *
   * A figure arrives in this app three ways - opening a project, switching
   * between the figures of a multi-figure session, and undo/redo rolling the
   * session back - and each one had grown its OWN list of what belongs to the
   * outgoing figure and must not survive. THIS SERVES THE FIRST TWO (see the
   * warning below about the third). The lists disagreed, every time:
   * opening a project kept the previous figure's selected point, its marquee
   * selection, its geometry-closed flag and its picked heatmap cells; switching
   * figures kept the previous figure's heatmap grid, its hand-taken cell
   * readings and its category count; only the undo path ever cleared the
   * marquee. Nothing was wrong with any single list. There were three of them.
   *
   * This is the one list. Callers pass the session they have just installed, so
   * everything that is SEEDED (the fold-out inputs, the curve-fit controls)
   * reads the incoming figure rather than being blanked - a switch back to a
   * figure with a saved fit used to show a first-degree polynomial over the
   * curve it actually holds.
   *
   * ⚑ What is NOT here: anything a caller sources differently. The image, the
   * measurements, the provenance and the history are per-door and stay per-door.
   *
   * ⚠️ AND THE UNDO DOOR DELIBERATELY DOES NOT READ THIS ONE - `syncAfterRestore`
   * keeps its own, shorter list, because an undo is not a new figure: it restores
   * measurements and a pending gesture FROM THE SNAPSHOT, and it resolves the
   * mode through a ladder (drop out of an auto-extract mode the restored config
   * does not offer) that this function's blunter `calibrated ? place-point :
   * calibrate` would overwrite. It is named here rather than left implied,
   * because a comment claiming three doors above code serving two is exactly the
   * false evidence of compliance CLAUDE.md's third gate is about.
   *
   * (CLAUDE.md, Key constraints: guards belong in the model, and the model has
   * more than one entrance. v2.3 re-audit F24.)
   */
  const resetPerFigureUI = useCallback(
    (s: CalibrationSession<CalibratedAxes>) => {
      setAxesTypeId(s.getConfig().id);
      // A pending figure-rename belongs to the figure we are leaving.
      setFigureNameDraft(null);
      setFigureNameNotice(null);
      // Selections index into a point set that the incoming figure does not have.
      setActivePointIndex(null);
      setSelectedPointIndices([]);
      setColorTraceRegion(null); // a different figure -> old trace region is stale (audit A1)
      // ⚑ ...and so are shapes the OUTGOING figure's trace held back. They are
      // image pixels of a picture that is no longer on screen, and the offer
      // that takes them back would file them into this figure's record.
      setHeldBackBars([]);
      setProjectNotice(null); // ...and so is a notice about the figure we just left
      setProjectError(null);
      setDataValueInputs([]);
      setSegmentFillError(null);
      setGeometryClosed(false);
      // ⚑⚑ WHETHER TWO AXES MEET IS A FACT ABOUT THE FIGURE IN FRONT OF YOU, so
      // the answer cannot outlive it. This was one session-wide boolean whose
      // only writer was the checkbox itself, so the box opened showing whatever
      // you last left it at on a different chart - David, driving Box Plot:
      // *"it is inconsistent ... Sometimes it is offered checked, and sometimes
      // unchecked."* Back to the offered default with every figure, exactly as
      // the rest of this list does.
      setCommonOrigin(true);
      // ⚑⚑ AND SO IS A READING TAKEN OFF THE OUTGOING FIGURE'S PIXELS (v2.4). An
      // armed band would eat the first drag on the NEW figure; proposals and
      // their thumbnails are crops of a picture that is no longer on screen, and
      // Apply would write the old figure's names onto this one's categories.
      // The whole of OCR's state is per-figure by construction, which is why all
      // four go here rather than one being reset where it happens to be noticed.
      setOcrArmed(false);
      setOcrProposals(null);
      setOcrBusyIndex(null);
      setOcrError(null);
      // Curve Fit's controls are the figure's own, read back off its dataset.
      const cf = getCurveFitState(s.getDataset());
      setCurveFitDegree(cf ? cf.degree : 1);
      setCurveFitModel(cf?.model ?? 'polynomial');
      setCurveFitRestrict(cf ? cf.restrict : false);
      setCurveFitXMinInput(cf && cf.xMin != null ? String(cf.xMin) : '');
      setCurveFitXMaxInput(cf && cf.xMax != null ? String(cf.xMax) : '');
      setCurveFitError(null);
      // ⚑⚑ THE HEATMAP LAYER IS PER-FIGURE AND USED TO WALK ACROSS A SWITCH.
      // Its grid, its labels and the readings a person took BY HAND live on the
      // session; the first thing that wrote them back - a cell edit, a divider
      // nudge - filed the outgoing figure's readings in the incoming figure's
      // record, and a heatmap has no eye-check that would have shown it.
      restoreHeatmapGrid();
      setEditingHeatmapValue(null);
      setHeatmapValueError(null);
      setHeatmapDragTint(null);
      setSelectedCells(new Set());
      setSelectedDividerId(null);
      // ⚑ Nothing to reset for the category stage any more: its count lives in
      // the incoming figure's own calibration and its ticks in that figure's
      // model, so switching figures cannot leave one figure's number beside
      // another figure's marks. Five setters stood here for state the component
      // no longer holds.
      // ⚑ WHICH SERIES GETS THE CAPS is a fact about the figure, and a refusal
      // about the figure you just left must not sit in red over the new one.
      // The base NAME deliberately survives: it is the user's own convention for
      // this session ("SD"), not a property of one figure.
      setErrorTargetName(null);
      setErrorNotice(null);
      // The measure instrument's in-progress state is the outgoing figure's too.
      setSettingScale(false);
      setScaleDraftPx(null);
      setPending([]);
      const calibrated = s.isCalibrated();
      setMode(calibrated ? 'place-point' : 'calibrate');
      setCalibExpanded(!calibrated); // calibrated -> folded; not -> show the steps
    },
    [restoreHeatmapGrid, setPending, setScaleDraftPx, setSettingScale]
  );

  const restoreDoc = useCallback(
    (snapshot: DocSnapshot) => {
      // Undoing across a graph-type change (checkpoint 87): the snapshot was
      // taken under a different config, so rebuild the session with that config
      // BEFORE restoring into it -- restoreState populates data and axes but not
      // the config, and pouring an XY snapshot into a Histogram session would
      if (sessionRef.current.getConfig().id !== snapshot.axesTypeId) {
        const cfg =
          ALL_AXES_TYPE_CONFIGS.find((c) => c.id === snapshot.axesTypeId) ?? XY_AXES_CONFIG;
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

  const cancelArea = useCallback(() => {
    setPending([]);
    setMeasureError(null);
  }, [setPending, setMeasureError]);

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
    // delete on a grouped box/histogram series (remove the whole box/bin) -
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
  }, [axes, session, undo, redo, toggleMeasure, toggleImageEdit, toggleErrorBars, toggleAutoExtract, figureCaptured, canvasHasImage, mode, measureTool, finishArea, activePointIndex, activeHandleKey, activeMeasure, applyMeasurements, canvasScale, bump, commit, removeActivePoint, selectedPointIndices, cropRect, cropMode, applyCrop, cancelCrop, settingScale, pendingMeasure, setPending, ctxMenu, setActiveMeasure, setMeasureError, setScaleDraftPx, setSettingScale]);

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
      // region (the old calibration box, in the old pixel space) is stale - clear
      // it here so every session-swap path is covered, not just resetDocument
      // (2026-07-22 audit A1).
      setColorTraceRegion(null);
      // ⚑ The import notice describes the project that was OPENED. A new session
      // means that figure is gone, and a true sentence about the wrong subject is
      // worse than none -- it read as though the CURRENT figure had lost content.
      setProjectNotice(null);
      // ⚑ The heatmap's grid and its cells describe the figure that just went
      // away. A stale matrix left on screen is a measurement of a figure that no
      // longer exists - the same rule the Geometry card follows, and the reason
      // this clearing belongs in the SHARED swap rather than in one caller.
      setHeatmapGridParams(null);
      setHeatmapCells([]);
      setHeatmapGridNote(null);
      setHeatmapSummary('');
      setHeatmapError(null);
      setDataValueInputs([]);
      setSegmentFillError(null);
      // ⚑ The same rule at the GRAPH-TYPE door: a Box Plot's answer about its
      // own corners says nothing about the XY figure you switch to.
      setCommonOrigin(true);
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
      const nextConfig = ALL_AXES_TYPE_CONFIGS.find((c) => c.id === id) ?? XY_AXES_CONFIG;
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
      swapSession(id, new CalibrationSession(ALL_AXES_TYPE_CONFIGS.find((c) => c.id === id) ?? XY_AXES_CONFIG));
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

  // Everything a game may ask of the workspace, in one place -- see
  // ui/src/games/useTraceChallenge.ts for why the list itself is the point.
  const gameHost = useMemo<TraceChallengeHost>(
    () => ({
      session: () => sessionRef.current,
      resetDocument: (axesConfigId, dataURL) => resetDocument(axesConfigId, dataURL),
      closePdf: () => closePdf(),
      clearFiguresToSingle: () => clearFiguresToSingle(),
      confirmDiscardIfDirty: () => confirmDiscardIfDirty(),
      loadImage: (dataURL, name) => imageCanvasRef.current?.loadImageFromSrc(dataURL, name),
      clearImage: () => imageCanvasRef.current?.clearImage(),
      setFigureCaptured: (captured) => setFigureCaptured(captured),
      setCalibrationExpanded: (expanded) => setCalibExpanded(expanded),
      setMode: (m) => setMode(m),
      bump: () => bump(),
    }),
    [resetDocument, closePdf, clearFiguresToSingle, confirmDiscardIfDirty, bump]
  );

  const game = useTraceChallenge(
    challengePool,
    gameHost,
    (axes as unknown as { dataToPixel(x: number, y: number): { x: number; y: number } } | null) ?? null
  );
  const gamePhase = game.phase;

  // NB: the round timer lives INSIDE the HUD (ChallengeOverlay), ticking off
  // `roundStartMs`, so it re-renders only the HUD -- not the whole Workspace every
  // 100ms, which made canvas clicks feel laggy mid-round.

  /** Every measurement's DERIVED display form (checkpoint 82) - the single
   * source the card, the clipboard and the canvas labels all read. Recomputed
   * when the scale or the calibration changes, which is what makes Set-scale
   * retroactive instead of one-way. */
  /**
   * The calibrated colour key, for colour measurements to be read against.
   *
   * ⚑ BUILT ONLY WHEN SOMETHING NEEDS IT. `buildColorScale` re-samples the key
   * out of the image, which is a full-canvas readback - so a figure with no
   * colour measurement never pays for one, and the memo re-runs when a
   * measurement is taken or the calibration moves (which is what makes a
   * re-calibrated key re-read every colour reading, the Set-scale rule again).
   */
  // ⚑ The export handler is a callback that must not re-create on every scale
  // change, so it reads the key through a ref - the same shape `measureScaleRef`
  // already uses one line up, for the same reason.
  const colourScaleRef = useRef<ColorScale | null>(null);
  colourScaleRef.current = colourScale;


  const handleImageClick = useCallback(
    (px: number, py: number) => {
      // ⚑⚑ THE CANVAS HAS NO CATEGORY-MARKING MODE ANY MORE (v2.3). A branch
      // stood here, ahead of every other route, hijacking any click anywhere in
      // the app while the fold-out was open - in Eraser and Select too - and
      // turning it into an axis edge. The two ends are calibration steps now, so
      // they arrive through the walk's own click handling like every other
      // calibration point, and this special case is deleted rather than guarded.
      const route = routeCanvasClick({ eyedropper, mode, figureCaptured, readsCellsFromAGrid: heatmapActive });
      switch (route.kind) {
        case 'sample-colour': {
          // px/py are native image-pixel coords (same space Segment Fill uses),
          // so they index straight into getImageData().
          const imageData = imageCanvasRef.current?.getImageData();
          if (imageData) {
            // ⚑ One sampler, three callers (v2.3, theme G): this, the Colour
            // measurement, and whatever comes next. The CLAMP is the part that
            // must not be forgotten, and it was written out by hand each time.
            const rgb = samplePixelRgb(imageData, px, py);
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
          setActivePointIndex(indexOfPlacedPoint(pts, px, py, false));
          commit();
          return;
        }
        case 'select-cell': {
          // ⚑ `cellIndexAt` is the MODEL's own answer to "which cell is this?" -
          // the same function the reader uses, so the square that lights up is
          // the square the value came from, and a click outside the grid selects
          // nothing rather than the nearest thing.
          const axesNow = sessionRef.current.getAxes();
          if (!axesNow || !heatmapShownGrid) return;
          const [dx, dy] = axesNow.pixelToData(px, py);
          if (dx === undefined || dy === undefined) return;
          const hit = cellIndexAt(heatmapShownGrid.xDividers, heatmapShownGrid.yDividers, dx, dy);
          // ⚑ A bare canvas click REPLACES the pick, the way clicking one data
          // point does. Shift-adding from the figure needs the modifier, which
          // this route does not carry - the table is where a range is built,
          // and the figure stays "show me this one".
          if (hit) pickCells([cellKey(hit.col, hit.row)], false);
          else setSelectedCells(new Set());
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
          setActivePointIndex(indexOfPlacedPoint(placed, px, py, true));
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
    [session, mode, bump, commit, segmentFillThreshold, eyedropper, handleMeasureClick, figureCaptured, heatmapActive, heatmapShownGrid]
  );

  // Bar capture (v2.0): a drag's two opposite corners become a bar's two
  // measured ends in one gesture -- both real pixels, never a baseline
  // assumed for the near one. A near-zero drag (a plain click) falls back to
  // filling one slot at a time, the same generic mechanism every other
  // slotted type already uses (see the tips-bar copy above for why both work,
  // and boxMode's own gating below for when this fires at all).
  /** The walk is asking for the colour key's first corner, so a drag across the
   * bar means both corners at once. */
  const isDraggingKeyCorners =
    heatmapActive && mode === 'calibrate' && figureCaptured && session.getCurrentStep()?.key === 'k1';

  /**
   * A drag across the colour key: one corner at the press, the opposite at the
   * release.
   *
   * ⚑ A CLICK IS STILL A CLICK. Under 3px of travel is not a drag, so it places
   * the first corner and the walk asks for the second - the gesture is added,
   * not swapped for the one people already know.
   */
  const handleKeyCornerDrag = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const isClick = Math.abs(end.x - start.x) < 3 && Math.abs(end.y - start.y) < 3;
      session.handleCalibrationClick(start.x, start.y);
      if (!isClick) session.handleCalibrationClick(end.x, end.y);
      commit();
    },
    [session, commit]
  );

  const handleBoxRect = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const isClick = Math.abs(end.x - start.x) < 3 && Math.abs(end.y - start.y) < 3;
      // ⚑⚑⚑ A REAL DRAG IS A WHOLE BAR, SO IT STARTS ITS OWN TUPLE. `addDataPoint`
      // fills the next OPEN slot, which is exactly right for the two-click
      // fallback below and wrong for a corner-to-corner drag: a bar abandoned
      // half-way leaves an open slot somewhere on the chart, and this drag's
      // FIRST corner goes into it. The bar that reaches the record then has one
      // end from the stray and one from the drag, and is filed under the stray's
      // category.
      // ⚠️ MEASURED off David's own screen: a stray click above the plot in the
      // GREEN band, then a drag across the RED bar, recorded `Green 7.98 .. 14.19`
      // - the stray's height and the red bar's top, in a category neither is in.
      // ⚑ ONLY THE DRAG. A plain click is the deliberate one-slot-at-a-time path
      // and MUST keep filling the open slot; that is how a bar interrupted
      // half-way is finished on purpose.
      if (!isClick) session.setSlotCursor(null, 0);
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
      // ⚑⚑ ON A MATRIX TYPE THE MARQUEE YIELDS CELLS, NOT POINT INDICES. A
      // heatmap has no data points for a box to catch, so Select's flagship
      // gesture caught nothing at all - the same hidden-mode defect as the bare
      // click, one gesture along. `cellKeysInRect` applies the identical rule
      // this function applies to points, so Select means one thing in this app.
      if (heatmapActive) {
        const axesNow = sessionRef.current.getAxes();
        if (!axesNow) return;
        setSelectedCells(
          new Set(
            cellKeysInRect(heatmapCells, rect, (x, y) =>
              (axesNow as unknown as { dataToPixel?: (a: number, b: number) => { x: number; y: number } })
                .dataToPixel?.(x, y) ?? null
            )
          )
        );
        return;
      }
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
    [heatmapActive, heatmapCells, session]
  );

  // The Select tool's LASSO (v1.1 #6): every active-series DATA point inside the
  // freeform loop becomes selected. Same discipline as the marquee -- data points
  // only, calibration handles are not in getDataPoints() so the loop can't grab
  // them. The polygon arrives in image-pixel space (algorithms/geometry).
  const handleSelectLasso = useCallback(
    (polygon: { x: number; y: number }[]) => {
      // ⚑ The marquee's twin, and it gets the same treatment: on a matrix type a
      // loop encloses CELLS. Leaving one of the two gestures point-only would
      // put the hidden mode back, one tool-option along.
      if (heatmapActive) {
        const axesNow = sessionRef.current.getAxes() as unknown as {
          dataToPixel?: (a: number, b: number) => { x: number; y: number };
        } | null;
        if (!axesNow) return;
        const keys = heatmapCells
          .map((c) => ({ c, p: axesNow.dataToPixel?.(c.xCentre, c.yCentre) }))
          .filter(({ p }) => p !== undefined && Number.isFinite(p.x) && Number.isFinite(p.y))
          .filter(({ p }) => pointInPolygon(p!, polygon))
          .map(({ c }) => cellKey(c.col, c.row));
        setSelectedCells(new Set(keys));
        return;
      }
      const inside: number[] = [];
      session.getDataPoints().forEach((p, i) => {
        if (pointInPolygon({ x: p.px, y: p.py }, polygon)) inside.push(i);
      });
      setSelectedPointIndices(inside);
      setActivePointIndex(null);
    },
    [heatmapActive, heatmapCells, session]
  );

  // Select a recorded measurement's vertex for keyboard nudge (checkpoint 128).
  // Guarded to recorded ids only (the pending overlay isn't nudgeable). Clears the
  // other selections so the arrows drive exactly one thing.
  const handleMeasureVertexClick = useCallback((id: string, vertex: number) => {
    if (!measurementsRef.current.some((m) => m.id === id)) return;
    setActiveMeasure({ id, vertex });
    setActivePointIndex(null);
    setActiveHandleKey(null);
  }, [setActiveMeasure]);

  // --- Error-bar capture (checkpoint 79) -------------------------------------
  // The drag IS the link: press a datum of the target series, drag out to the
  // cap the figure draws, release. Snapping the START to a real datum is what
  // keeps the whisker's datum end honest; the release point is never snapped,
  // because it is the measurement.
  const SNAP_RADIUS_PX = 14;
  const errorLinkSnap = useCallback(
    (x: number, y: number) => session.nearestDatumPixel(errorTargetIndexNow(), { x, y }, SNAP_RADIUS_PX)?.point ?? null,
    [session, errorTargetIndexNow]
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
        targetIndex: errorTargetIndexNow(),
        datumPixel: from,
        capPixel: to,
        baseName: errorBaseName,
      });
      setErrorNotice(refusal);
      if (!refusal) commit();
      else bump();
    },
    [session, errorTargetIndexNow, errorBaseName, commit, bump]
  );


  /** The live calibration value boxes, in field order - so Enter can hand on to
   * the next one. A ref rather than a query: the boxes are rebuilt whenever the
   * step reshapes, and a stale testid lookup would focus a box that is no longer
   * the one being asked for. */
  const valueInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  /** The calibration value being corrected, as raw in-progress text - so typing
   * does not re-run the calibration on every keystroke. Applied on blur/Enter,
   * exactly as `editingCell` does for a data point's value. */
  const [editingCalibValue, setEditingCalibValue] = useState<
    { key: string; index: number; value: string } | null
  >(null);

  const setDataValueInputAt = useCallback((index: number, value: string) => {
    setDataValueInputs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }, []);

  // Common origin: take the shared corner's pixel for whatever reusing step the
  // walk is standing on, and prefill its value, so the user never places or
  // reuses it by hand -- they just confirm. Which steps those are is the TYPE's
  // to declare (config.commonOrigin), not this file's to name.
  //
  // ⚑⚑ IT TAKES `enabled` RATHER THAN READING THE STATE, because the checkbox
  // calls it from its own onChange, where the `commonOrigin` state has not
  // updated yet. Reading the state there would apply the PREVIOUS answer.
  //
  // ⚑⚑ AND IT IS A CALLBACK BECAUSE THERE ARE TWO ENTRANCES, which is the
  // whole defect it fixes. This loop used to live inside `confirmDataValue`, so
  // the only moment the checkbox was ever read was the instant the walk stepped
  // FORWARD onto the reusing step. Tick the box while already standing on that
  // step -- which is where the card puts you, and where David found it -- and
  // nothing was listening: the label went on saying P1 and Cat 1 are the same
  // point while the walk kept asking for the click. Unticking already had its
  // entrance (`withdrawReusedPixels`); ticking had none.
  //
  // ⚑⚑ FOLLOW THE CHAIN, because a type may share more than one pixel. A
  // heatmap shares BOTH corners of its plot box, and the first share
  // (X start & Y start) completes without a value on a category axis - so a
  // single pass placed it and stopped, leaving the second share (X end & Y
  // end) never offered. Each turn of this loop PLACES a point, so it cannot
  // spin; it stops as soon as a step needs something typed, or nothing more
  // is shared.
  const adoptCommonOrigin = useCallback(
    (enabled: boolean): { adopted: boolean; filled: string[] } => {
      let filled: string[] = [];
      let adopted = false;
      for (let guard = 0; guard < 8; guard++) {
        const step = session.getCurrentStep();
        const reuse = commonOriginReuse(
          config,
          enabled,
          step?.key,
          session.getPlacedPoints(),
          // ⚑ The step AS THE WALK CURRENTLY SHAPES IT - a heatmap's category
          // edge takes no typed value, so there is nothing to prefill into it.
          step ?? undefined
        );
        if (!reuse) break;
        // ⚑⚑ `fromOffer` - so unticking takes back what the OFFER placed and
        // nothing the user reused by hand with the `reuse-<step>` button.
        if (!session.reuseStepPixel(reuse.from, true)) break;
        adopted = true;
        if ((step?.valueFields.length ?? 0) > 0) {
          filled = reuse.prefill;
          break;
        }
      }
      return { adopted, filled };
    },
    [session, config]
  );

  const confirmDataValue = useCallback(() => {
    if (session.confirmCalibrationValues(dataValueInputs)) {
      setDataValueInputs(adoptCommonOrigin(commonOrigin).filled);
      commit();
    }
  }, [session, dataValueInputs, commit, commonOrigin, adoptCommonOrigin]);

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
      // ⚑⚑ A HEATMAP READS ITS BOUNDARIES OFF THE FIGURE, HERE. The design said
      // the assist for a drawn-cell figure is *"DETECT the boundaries and
      // PROPOSE the grid; the user adjusts"* - and detection sat behind a
      // fold-out nobody was told about, while an evenly divided lattice was
      // drawn instead. David: *"Why does it not automatically jump towards the
      // detect grid?"* Because nothing made it. Now the calibration that
      // establishes the plot box immediately measures what the box contains.
      //
      // ⚑ It runs AFTER commit so the axes exist to measure against, and it is
      // safe when there is nothing to find: `detectGrid` reports rather than
      // invents, and a figure with no drawn cells simply gets no grid - which is
      // the honest answer until the user asks for a lattice.
      if (heatmapActive) queueMicrotask(() => runHeatmapDetect());
    } else {
      bump();
    }
  }, [session, bump, commit, heatmapActive, runHeatmapDetect]);

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
  /**
   * Apply a corrected calibration value.
   *
   * ⚑ The model owns the rules - `setCalibrationValues` runs the same guard the
   * walk does and re-calibrates live - so this only closes the editor and
   * commits to history. A REFUSED edit leaves the old value standing, which is
   * why the editor closes either way: the card then shows what the model has.
   */
  // ⚑ A plain function, not a `useCallback`. The React Compiler refuses to
  // memoize this one ("existing memoization could not be preserved") and an
  // event handler called from a map has nothing to gain from it - a hook that
  // is not doing its job is worse than no hook, and suppressing the rule would
  // hide the fact that it never was memoized.
  const commitCalibValueEdit = (edit: { key: string; index: number; value: string }) => {
    setEditingCalibValue(null);
    const placedNow = session.getPlacedPoints()[edit.key];
    if (!placedNow) return;
    // ⚑ Built by map rather than spread-then-assign: the compiler cannot keep
    // its memoization across a local mutation of a derived array, and a value
    // this small has no reason to be built by mutating one.
    const next = placedNow.values.map((v, i) => (i === edit.index ? edit.value : v));
    // ⚑ Only a change goes to history. A REFUSED edit alters nothing, and
    // closing the editor already re-renders, so there is nothing to bump.
    if (session.setCalibrationValues(edit.key, next)) commit();
  };

  /**
   * Commit a typed value: the model moves the datum and records whose reading
   * it is (v2.3, A4).
   *
   * ⚑⚑ THE INVERSE USED TO LIVE HERE, one axes-kind branch per type, and with
   * it the rule that a spider reads against the spoke its point was captured
   * on. `session.setDataPointValue` owns both now - the model has more than one
   * entrance, and this one was passing the TABLE ROW where the model wanted a
   * data dimension. They agree on a spider by construction and would not on the
   * first type where a row is not an axis.
   */
  const commitDataPointEdit = useCallback(() => {
    const cell = editingCell;
    if (!cell) return;
    setEditingCell(null);
    // ⚑ AN EDITOR THAT WAS OPENED AND CLOSED IS NOT A READING - the heatmap's
    // rule, word for word, because it is one rule. Committing an untouched seed
    // moves the point (through the axes' inverse, so it lands on the rounded
    // number) and marks it as user-supplied: a glance recorded as a measurement.
    if (cell.value === cell.seed) return;
    const parsed = Number(cell.value);
    if (cell.value.trim() === '' || !Number.isFinite(parsed)) return; // invalid -> leave the reading standing
    // ⚑ A spider's one reading is dim 0; the SPOKE comes from the point's own
    // slot inside the model. Everywhere else the table column IS the dimension.
    const dim = config.axesKind === 'spider' ? 0 : cell.axis;
    if (session.setDataPointValue(cell.index, dim, parsed)) commit();
  }, [editingCell, session, config.axesKind, commit]);

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

  /**
   * ONE BAND DRAG BECOMES ONE PROPOSAL PER CATEGORY (v2.4).
   *
   * ⚑ The band is never read as a whole - a strip is not a region, measured. It
   * is cut at the CATEGORY AXIS's own dividers, which is the half of the answer
   * we measured (their two clicks and their declared count) while the band is
   * the half only they can give (where the labels are printed).
   */
  const readCategoryLabels = useCallback(
    async (band: { x: number; y: number; width: number; height: number }) => {
      setOcrArmed(false);
      setOcrError(null);
      const image = imageCanvasRef.current?.getImageData();
      const edges = session.getCategoryAxis().getAxisEdges();
      if (!image || !edges) {
        setOcrError('Mark the category axis first - its dividers are what split the box you drew.');
        return;
      }
      const dividers = session.getCategoryAxis().getDividerPoints();
      const answer = await readLabelBand(image, band, dividers, axisRunsAlong(edges[0], edges[1]));
      if (isOcrFailure(answer)) {
        setOcrError(answer.error);
        return;
      }
      setOcrProposals(answer.proposals);
    },
    [session]
  );

  /** Read ONE row again, a quarter turn further round - the card's `Rotate`. */
  const rotateProposal = useCallback(
    async (categoryIndex: number) => {
      const current = ocrProposals?.find((p) => p.categoryIndex === categoryIndex);
      const image = imageCanvasRef.current?.getImageData();
      if (!current || !image) return;
      setOcrBusyIndex(categoryIndex);
      const turn = (((current.turn + 1) % 4) as QuarterTurn);
      const answer = await readRegionAt(image, current.rect, categoryIndex, turn);
      setOcrBusyIndex(null);
      if (isOcrFailure(answer)) {
        setOcrError(answer.error);
        return;
      }
      setOcrProposals((rows) =>
        rows ? rows.map((r) => (r.categoryIndex === categoryIndex ? answer : r)) : rows
      );
    },
    [ocrProposals]
  );

  /**
   * Apply the vetted names - the ONE place a reading becomes a record.
   *
   * ⚑ AN EMPTY ROW IS LEFT ALONE, never written through: an empty proposal means
   * "no reading", not "erase the name". A user who clears a row is declining
   * that one, and the category keeps whatever it had.
   * ⚑ ONE undo step for the whole card, because one press was one decision.
   */
  const applyOcrNames = useCallback(() => {
    const rows = ocrProposals ?? [];
    let wrote = false;
    for (const row of rows) {
      const name = row.text.trim();
      if (name === '') continue;
      if (session.renameCategory(row.categoryIndex, name)) wrote = true;
    }
    setOcrProposals(null);
    setOcrError(null);
    if (wrote) commit();
  }, [ocrProposals, session, commit]);

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
  /**
   * Remove a tuple from a NAMED series, switching to it first.
   *
   * ⚑⚑ BECAUSE `crowded` SPANS EVERY SERIES AND `removeTuple` DOES NOT. A
   * crowded reading carries the `seriesIndex` it belongs to, but the plain
   * remove acts on whichever series happens to be ACTIVE - so pressing the
   * conflict row's delete while another series was selected removed a perfectly
   * good bar from THAT one, left the crowded reading exactly where it was, and
   * said nothing. Measured: series 0 `[5,5,5]` became `[5,null,5]` while series
   * 1's doubled band was untouched.
   *
   * ▶ The table's own cells have always guarded this - *"switch AND select, in
   * one click"* - and the conflict block was written without it. Making the
   * series EXPLICIT is stronger than remembering to switch first, because there
   * is then no order to get wrong.
   */
  const removeTupleIn = useCallback(
    (seriesIndex: number, tupleIndex: number) => {
      sessionRef.current.setActiveDataset(seriesIndex);
      sessionRef.current.removeTuple(tupleIndex);
      setActivePointIndex(null);
      commit();
    },
    [commit]
  );

  /** Select several tuples of a NAMED series - see `removeTupleIn` for why the
   * series is explicit rather than assumed to be the active one. */
  const selectTuplesIn = useCallback(
    (seriesIndex: number, tupleIndices: readonly number[]) => {
      sessionRef.current.setActiveDataset(seriesIndex);
      const pixels = tupleIndices.flatMap((t) => sessionRef.current.pixelsOfTuple(t, seriesIndex));
      if (modeRef.current === 'select') {
        setSelectedPointIndices(pixels);
      } else {
        const pixel = pixels[0] ?? null;
        setActivePointIndex(pixel);
        if (pixel !== null) setPickedPointIndex(pixel);
      }
      bump();
    },
    [bump]
  );

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
      // ⚑ WHAT THE BOX IS ASKING FOR CAN CHANGE UNDER WHAT IS TYPED IN IT.
      // Ticking "X is categories" turns X end's field from an X VALUE into a
      // COLUMN COUNT, so a "14" typed as a coordinate would sit there reading as
      // fourteen columns. The pixel is kept (the click was real); the typed text
      // is not, because the question it answered no longer exists.
      const fieldsBefore = JSON.stringify(session.getCurrentStep()?.valueFields.map((f) => f.label));
      session.setOption(key, value);
      const fieldsAfter = JSON.stringify(session.getCurrentStep()?.valueFields.map((f) => f.label));
      if (fieldsBefore !== fieldsAfter) setDataValueInputs([]);
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
   * "Reset calibration" - which, despite its label, clears the whole document.
   *
   * The blast radius is deliberate (slope measurements and every data value
   * are defined *by* the calibration, so keeping them across a re-calibration
   * would leave stale numbers on screen) but it was **undisclosed and
   * unrecoverable** until checkpoint 71: `session.reset()` discards every
   * series and point, `clearMeasurements()` takes the measurements and the
   * Set-scale, and `history.reset()` emptied past *and* future so Ctrl+Z
   * couldn't bring any of it back - while `markClean()` also disarmed the
   * unsaved-work guard. A user who traced 200 points, noticed one handle a few
   * pixels off, and clicked the button that says "Reset calibration" lost
   * everything with no dialog and no undo. Verified: 250 points across 2
   * series -> 0 points, 1 series.
   *
   * Two changes make it honest, both mirroring what WPD already does
   * (`controllers/axesCalibration.js:526,552-575` confirms twice before
   * dropping an axes):
   *  - **confirm first**, but only when there is something to lose - resetting
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
        'Reset calibration will also clear every data point, series and measurement - the values depend on the calibration. This can be undone with Ctrl+Z. Continue?'
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
      setProjectError('electronAPI is not available - this UI must run inside the Electron dev harness (npm run ui:electron).');
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
      // ⚑ WHICH COPY of each figure gets written is `figureSaveInput` in engine/
      // now (v2.3, theme G), where audit H1's rule - the active figure's SESSION
      // is read live, because a page flip swaps it without re-stashing - is a
      // named test rather than a comment beside a ternary.
      // ⚑ WHICH COPY of each figure gets written is `figureSaveInput` in engine/
      // now (v2.3, theme G), where audit H1's rule - the active figure's SESSION
      // is read live, because a page flip swaps it without re-stashing - is a
      // named test rather than a comment beside a ternary.
      // ⚑ Built ONCE: the live state is the same for every figure in the loop,
      // and a FigureRecord already IS the record shape, so neither side needs
      // constructing per iteration.
      const liveNow = {
        session: sessionRef.current,
        imageDataURL: imageCanvasRef.current?.getImageDataURL() ?? undefined,
        imageFileName: imageCanvasRef.current?.getImageFileName() ?? undefined,
        measurements: measurementsRef.current,
        measureScale: measureScaleRef.current,
        provenance: provenanceRef.current,
      };
      const inputs = figs.map((f, i) => {
        const chosen = figureSaveInput({ name: f.name, active: i === activeFigureIndex, record: f, live: liveNow });
        return {
          name: chosen.name,
          session: chosen.session,
          imageDataURL: chosen.imageDataURL,
          imageFileName: chosen.imageFileName,
          measures: { measurements: toSerializedMeasurements(chosen.measurements), scale: chosen.measureScale },
          provenance: chosen.provenance,
        };
      });
      // ⚑ Audit A3's rule, also in engine/ now: the document belongs to the
      // PROJECT, so ANY figure's counts when the active one has none.
      const sharedSource = sharedProjectSource(figs, sourcePdfRef.current);
      const multi = serializeMultiFigureProject(
        inputs,
        activeFigureIndex,
        sourceDescriptor(sharedSource, pagedDocumentFormat),
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
      sourceDescriptor(sourcePdfRef.current, pagedDocumentFormat),
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
   * it - the shared core of opening our own project (JSON) and importing a WPD
   * figure (.tar). Extracted at checkpoint 88 so the two are one path, not a
   * parallel one (the exact smell the tenet audit warns about): they differ only
   * in where the axes/datasets/image come from, not in how they land.
   *
   * `measurements` is empty for a WPD import - WPD has no measurement concept.
   */
  const loadCalibratedFigure = useCallback(
    (fig: {
      configId: string;
      axes: CalibratedAxes;
      datasets: Dataset[];
      categoryAxis?: CategoryAxis;
      /** The heatmap's record, when the file carried one. */
      heatmapLayer?: SerializedHeatmapLayer | null;
      imageDataURL: string;
      imageFileName?: string;
      measurements?: RecordedMeasurement[];
      measureScale?: MeasureScaleState | null;
      provenance?: Provenance;
    }): boolean => {
      const nextConfig = ALL_AXES_TYPE_CONFIGS.find((c) => c.id === fig.configId);
      if (!nextConfig) {
        setProjectError(`Unsupported axes type: ${fig.configId}`);
        return false;
      }
      clearFiguresToSingle(); // a single-figure project / WPD import is one figure
      const newSession = new CalibrationSession(nextConfig);
      newSession.setImageHeight(imageHeightRef.current);
      newSession.loadCalibrated(fig.axes, fig.datasets, fig.categoryAxis, fig.heatmapLayer);
      sessionRef.current = newSession;
      // ⚑ The same reset a figure switch does, from the same list. A saved
      // heatmap reopens with the grid it was saved with, the category fold-out
      // shows the loaded figure's own count, and the previous figure's
      // selections, refusals and curve-fit controls do not survive the load.
      resetPerFigureUI(newSession);

      applyProvenance(fig.provenance ?? {}); // restore where this figure came from
      applyPdfState(null); // a saved project is a baked image, not a live PDF
      closePdf(); // release any PDF that was open before this project loaded (T4)
      setFigureCaptured(true); // a loaded/imported figure IS the figure-of-record (ckpt 103)
      const loadedMeasurements = fig.measurements ?? [];
      applyMeasurements(loadedMeasurements);
      applyMeasureScale(fig.measureScale ?? null);
      // Keep new measurement ids from colliding with loaded ones.
      measureIdRef.current = loadedMeasurements.reduce((max, m) => {
        const n = parseInt(m.id.replace(/^meas-/, ''), 10);
        return Number.isFinite(n) && n > max ? n : max;
      }, 0);
      history.reset(captureDoc(fig.imageDataURL)); // loaded document -> fresh history; reset precedes the load, so name the incoming src

      imageCanvasRef.current?.loadImageFromSrc(fig.imageDataURL, fig.imageFileName);
      markClean(); // a freshly loaded document matches its source
      bump();
      return true;
    },
    [history, bump, markClean, applyMeasurements, applyMeasureScale, resetPerFigureUI, captureDoc, applyProvenance, applyPdfState, closePdf, clearFiguresToSingle, measureIdRef]
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
      // Everything that belonged to the figure we are leaving, from the one list
      // both install doors read.
      resetPerFigureUI(rec.session);
      // Per-figure document state.
      applyProvenance(rec.provenance);
      setFigureCaptured(rec.figureCaptured);
      applyMeasurements(rec.measurements);
      applyMeasureScale(rec.measureScale);
      setSourcePdf(rec.sourcePdf);
      // A restored figure shows its BAKED image, not a live pager -- the source
      // linkback ("Get another figure from the source") re-opens the pager on
      // demand (ckpt 113). So no live pdfState here, but the source is retained.
      applyPdfState(null);
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
    [history, bump, markClean, captureDoc, applyProvenance, applyMeasurements, applyMeasureScale, setSourcePdf, applyPdfState, resetPerFigureUI]
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
   * then flips to the page they want and captures - that capture bakes the new
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
      // filled on the next stash - the live session is the fresh one right now.
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
      const config = ALL_AXES_TYPE_CONFIGS.find((c) => c.id === f.configId) ?? XY_AXES_CONFIG;
      const s = new CalibrationSession(config);
      s.setImageHeight(imageHeightRef.current); // best-effort; corrected when the active figure's image loads
      s.loadCalibrated(f.axes as CalibratedAxes, f.datasets, f.categoryAxis, f.heatmapLayer);
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



  // --- Import a foreign digitizer's project archive (.tar) - checkpoint 88 ------
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
      setProjectError('electronAPI is not available - this UI must run inside the Electron dev harness (npm run ui:electron).');
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
      loadCalibratedFigure({
        configId: imported.configId,
        axes: imported.axes as CalibratedAxes,
        datasets: imported.datasets as Dataset[],
        imageDataURL: imported.imageDataURL ?? '',
        // These formats carry no measurement concept -- nothing to bring across.
      });
      // ⚑⚑ AFTER THE LOAD, because this notice belongs to the figure that just
      // ARRIVED - "this project held 2 coordinate systems; 1 was not imported" -
      // and installing a figure clears the notice about the one being left
      // (`resetPerFigureUI`). Set before the load, it was wiped in the same
      // batch and never reached the eye. ⚠️ Caught by the e2e that exists for
      // exactly this half - v1.5 added it because the notice had no coverage
      // that it ever appears - and it is the second time the ordering has
      // mattered: the first was the notice OUTLIVING its figure.
      setProjectNotice(imported.notes.length > 0 ? imported.notes.join(' ') : null);
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
        // ⚑ Audit B-F6's invariant is `figuresForOpenedProject` in engine/ now
        // (v2.3, theme G): a ONE-figure container is a single-figure session, so
        // `figures` stays empty and the jumper stays hidden. Only a hand-edited
        // file reaches it, which is why nothing could test it here.
        // ⚑ It also refuses an out-of-range active index by restoring the FIRST
        // figure - this used to index past the end and hand `restoreFigure`
        // undefined. A behaviour change, and a deliberate one.
        const install = figuresForOpenedProject(records, multi.activeFigure);
        figuresRef.current = install.figures;
        setActiveFigureIndex(install.active);
        // restoreFigure installs the active figure's session, image, measurements,
        // provenance and (retained) source, and resets undo/dirty (loaded == clean).
        if (install.restore) restoreFigure(install.restore, true); // opened from a file
        return;
      }
      result = deserializeProjectZip(bytes);
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        setProjectError('Could not open project - not a PlotTracer project (.zip) or valid JSON.');
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
      // ⚑⚑ THE HEATMAP'S WHOLE RECORD, and it was missing from this door alone.
      // `loadCalibratedFigure` has always taken it and handed it to
      // `loadCalibrated`; the MULTI-figure open supplied it and this one, the
      // default path, did not - so `heatmapLayer ?? null` nulled the layer and
      // the grid, the axis labels and every cell a person had read by eye were
      // discarded on reopen, while the file on disk still held all of them.
      // One object literal short, under a session comment promising that save,
      // load and undo are one mechanism.
      heatmapLayer: result.heatmapLayer,
      imageDataURL: result.imageDataURL,
      imageFileName: result.imageFileName,
      // Our own file carries measurements (checkpoint 56); no value/note --
      // they are derived (ckpt 82) and a 0.2.0 file's stale string is not read.
      measurements: result.measurements.map((m) => ({
        id: m.id,
        tool: m.tool as MeasureToolId,
        overlay: { id: m.id, points: m.points, closed: m.closed, label: m.label, labelAt: m.labelAt },
        ...(m.rgb ? { rgb: m.rgb } : {}),
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
        setProjectError('electronAPI is not available - this UI must run inside the Electron dev harness (npm run ui:electron).');
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
      const measures = measurementsRef.current.flatMap<MeasurementCsvRow>((m) => {
        // ⚑ A COLOUR reading is not geometry, so it does not go through
        // `measurementValue` - it carries the colour it measured and, where a
        // key could read it, the value that key gives. Ambiguous or keyless,
        // the value is null and the cell is blank: what left the app is exactly
        // what the instrument could say.
        if (m.tool === 'colour') {
          if (!m.rgb) return [];
          const reading = colourMeasureReading(m.rgb, colourScaleRef.current);
          return [{ tool: m.tool, value: reading.value, unit: '', colour: rgbToHex(m.rgb) }];
        }
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
        ...(heatmapKeyRef.current ? { heatmapKey: heatmapKeyRef.current } : {}),
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
        // ⚑ OpenDocument first among the spreadsheet formats - it is the ISO
        // standard (26300), several EU administrations require ODF for public
        // documents, and it costs no dependency: an .ods is a ZIP of three XML
        // parts and this repo already writes ZIPs with fflate for project files.
        if (format === 'ods') {
          const { sectionsToOds } = await import('../../engine/odsExport.js');
          const savedOds = await window.electronAPI.saveFile(
            bytesToBase64(sectionsToOds(sections)),
            `${exportBaseName()}.ods`,
            [
              { name: 'OpenDocument spreadsheet', extensions: ['ods'] },
              { name: 'All Files', extensions: ['*'] },
            ],
            'base64'
          );
          // ⚑ ONLY A REAL WRITE clears the unsaved flag - `saveFile` answers null
          // when the user cancels the dialog. `saveProject` has gated this since the
          // v2.0 round-2 audit and the export path beside it did not, so cancelling
          // an export marked the work saved with nothing written (audit F8).
          if (savedOds) markClean();
          return;
        }
        if (format === 'xlsx') {
          // Lazy-load exceljs (~900 kB) only when XLSX is actually exported, so
          // it stays out of the main bundle (Vite splits it into its own chunk).
          const { sectionsToXlsx } = await import('../../engine/xlsxExport.js');
          const bytes = await sectionsToXlsx(sections);
          const savedXlsx = await window.electronAPI.saveFile(
            bytesToBase64(bytes),
            `${exportBaseName()}.xlsx`,
            [
              { name: 'Excel workbook', extensions: ['xlsx'] },
              { name: 'All Files', extensions: ['*'] },
            ],
            'base64'
          );
          if (savedXlsx) markClean(); // a cancel is not a save (audit F8)
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

      const savedText = await window.electronAPI.saveFile(content, `${exportBaseName()}.${ext}`, [
        { name: EXPORT_FILTER_NAMES[format], extensions: [ext] },
        { name: 'All Files', extensions: ['*'] },
      ]);
      if (savedText) markClean(); // a cancel is not a save (audit F8)
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
      setProjectError('electronAPI is not available - this UI must run inside the Electron dev harness (npm run ui:electron).');
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
        // ⚑⚑ THE KEYBOARD IS AN ENTRANCE TOO (audit F6b). These four are the same
        // file actions the top bar offers, and F6 wrapped only the buttons - so
        // Ctrl+S, the shortcut printed as a KeyTip on the very button that WAS
        // fixed, still dropped a failed save on the floor. `no-misused-promises`
        // cannot see `void fn()`, so the rule's blind spot became the sweep's.
        case 'o':
          if (e.shiftKey) reporting('Could not open the project', openProject, setProjectError)();
          else reporting('Could not open the image', () => canvas?.openImage() ?? Promise.resolve(), setProjectError)();
          break;
        case 's':
          if (e.shiftKey) reporting('Could not export the data', () => exportData('csv'), setProjectError)();
          else reporting('Could not save the project', saveProject, setProjectError)();
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
    // ⚑ REFUSED AT THE GESTURE, not silently substituted (F38). The colour box
    // is free text; an unparseable value used to become black, and "remove every
    // black pixel" erases the curve, the axes and the labels in one press.
    const gridRGB = hexToRGB(gridRemovalColor);
    if (!gridRGB) {
      setGridRemovalError(
        `"${gridRemovalColor}" is not a colour - type a hex value such as #e6e6e6, or use the eyedropper to pick the gridline colour off the figure.`
      );
      return;
    }
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
  // labels - same colour as the curve - so the traced curve "crept" outside the
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
    // On ENTERING By-colour mode, pre-fill the region with the calibration box -
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
    // ⚑ REFUSED AT THE GESTURE (F38). The colour box is free text - it has to
    // be, so a value can be pasted in - and an unparseable one used to become
    // BLACK, which on a scientific figure traces the axis lines, the tick labels
    // and the title. Same door, same answer as grid removal.
    const target = hexToRGB(colorTraceColor);
    if (!target) {
      setColorTraceInfo(
        `"${colorTraceColor}" is not a colour - type a hex value such as #1f77b4, or use the eyedropper to pick the curve's own ink off the figure.`
      );
      return;
    }
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
      // ⚑⚑ WHERE THE BASELINE RUNS, so a legend SWATCH can be told from a bar.
      // A swatch is the series ink exactly, so it matches at any tolerance and is
      // filed as a bar - a phantom reading that exports. It is INSET on most
      // published figures, so a plot-box gate excludes nothing; what separates
      // them is that a bar is anchored at the baseline and a swatch floats.
      const baseline = session.baselinePixelForDetect();
      const result = runBarDetect(data, width, height, target, colorTraceTolerance, 'foreground', colorTraceRegion ?? undefined, { minDiameter: colorTraceMinBlob }, declared ? { dividers: declared.dividers, categoryAxis: declared.categoryAxis, ...(declaredCount !== undefined ? { expected: declaredCount } : {}) } : undefined, baseline ?? undefined);
      if ('error' in result) {
        setColorTraceInfo(result.error);
        return;
      }
      // ⚑⚑ THE SWATCH SUSPECTS ARE HELD BACK RATHER THAN FILED. A phantom bar
      // filed as data looks exactly like a measurement - it has a row, a
      // category and a value, and it exports - so the reader has to be told it
      // is there, find it and delete it. Held back, it is visible by
      // construction and one click from being taken back.
      const { file, holdBack } = partitionSwatchSuspects(result);
      const added = session.addBarDetectBoxes(file);
      setHeldBackBars(holdBack);
      adoptTracedColour();
      // ⚑ Name the categories that came back empty. The split reports them by
      // BAND, which is image order -- `categoryIndexOfBand` maps that back to the
      // category the user declared, which is the axis's own order and runs the
      // other way whenever the axis was marked right-to-left or bottom-to-top.
      const missing = emptyCategoryNames(
        result.expectation?.emptyBands ?? [],
        (band) => session.categoryIndexOfBand(band, declared?.reversed ?? false),
        session.getCategoryAxis().getCategories()
      );
      // ⚑ The held-back shapes are NOT reported here. They are an offer, and the
      // offer says its own sentence beside the button that takes it - see
      // `swatchHoldBackOffer`. Restating the arithmetic in two places is the
      // "says one thing three times" defect through a new door.
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
    // ⚑ No preview for a colour we cannot read - a preview of BLACK would show
    // the axes lit up and read as "this is what your trace will find" (F38).
    const previewTarget = hexToRGB(colorTraceColor);
    if (!previewTarget) return null;
    const { mask, count } = colorFilter(data, width, height, previewTarget, colorTraceTolerance, 'foreground', colorTraceRegion ?? undefined);
    const img = context.createImageData(width, height);
    img.data.set(maskToRGBA(mask, width, height, COLOR_TRACE_PREVIEW_RGBA));
    context.putImageData(img, 0, 0);
    return { canvas, count, pct: (count / (width * height)) * 100 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, colorTraceColor, colorTraceTolerance, colorTraceRegion, canvasHasImage, version]);

  /**
   * Do the readings already in this series come from a DIFFERENT colour?
   *
   * ⚑⚑ TRACING A SECOND COLOUR INTO ONE SERIES IS THE COMMONEST WAY TO RUIN A
   * GROUPED BAR CHART, and until now the tool let it happen in silence and
   * explained afterwards, in the output panel, once every category was doubled.
   * David, having done exactly that and then undone it by hand: *"new colour
   * should automatically suggest a new series."* The offer belongs at the
   * gesture.
   *
   * ⚑ MEASURED FROM WHAT IS ALREADY RECORDED, with no new state. A trace
   * ADOPTS its colour onto the series it fills (`adoptTracedColour`), so a
   * series' own swatch IS the colour that produced its readings - comparing the
   * two is comparing what is there against what is about to be traced.
   *
   * ⚑ AND ONLY WHERE IT MATTERS: a series with nothing in it can take any
   * colour, and re-tracing the SAME colour after nudging the tolerance is the
   * ordinary adjust-and-look loop, which must not be nagged at. The threshold is
   * generous because the question is "is this a different curve", not "is this
   * the same pixel".
   */
  const tracingANewColour = useMemo(() => {
    if (!AUTO_EXTRACT_MODES.includes(mode)) return false;
    const info = session.getDatasetInfos().find((d) => d.active);
    if (!info || info.pointCount === 0) return false;
    const target = hexToRGB(colorTraceColor);
    if (!target) return false;
    return tracingADifferentColour(info.color, target, info.pointCount);
  }, [session, colorTraceColor, mode, version]);

  /**
   * Trace this colour into a series of its own.
   *
   * ⚑ ONE GESTURE, not "add a series, then find the tool again, then trace".
   * The suggestion is only worth making if taking it costs less than the mistake
   * it avoids.
   */
  const traceIntoNewSeries = useCallback(() => {
    session.addDataset();
    setGeometryClosed(false);
    handleColorTrace();
  }, [session, handleColorTrace]);

  /**
   * File the shapes the trace held back, after all.
   *
   * ⚑⚑ THIS IS WHAT MAKES THE HOLD-BACK A REFUSAL RATHER THAN A SILENT DROP, and
   * the standing rule for bar techniques allows one only while the control that
   * undoes it is on screen. Without this button the same code would be deleting
   * measurements without saying so.
   *
   * ⚑ THE SAME DOOR EVERY OTHER BOX WENT THROUGH - `addBarDetectBoxes`, the
   * two-corner path a manual drag-box also uses - so a shape taken back is
   * indistinguishable in the record from one that was never questioned. It is
   * not marked, because "we nearly refused this" is not a measurement.
   */
  const addHeldBackBars = useCallback(() => {
    if (heldBackBars.length === 0) return;
    const added = session.addBarDetectBoxes(heldBackBars);
    const noun = session.getConfig().tupleNoun ?? 'bar';
    setHeldBackBars([]);
    setColorTraceInfo(`Added ${added} held-back ${added === 1 ? noun : `${noun}s`}.`);
    commit();
  }, [session, heldBackBars, commit]);

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
      // ⚑⚑ THE LIVE ERROR TARGET IS HELD BY NAME, SO IT MOVES WITH THE RENAME
      // (v2.3 audit fleet, A3). `renameDataset` already carries the STORED
      // relations across - "or the link silently goes stale" - and the Error
      // bars card's chosen target is the same kind of by-name reference, one
      // layer up. Without this it stopped matching, `resolveErrorTarget` fell
      // back to the ACTIVE series, and the next cap drag was captured against
      // the wrong one with nothing on screen saying the target had changed.
      //
      // ⚠️ F39 replaced an index with a name because "a name survives the delete
      // of an earlier series where an index does not". True, and incomplete: a
      // name does not survive a RENAME. Fixing the delete case and not this one
      // would have traded a silent mis-target on the rarer gesture for a silent
      // mis-target on the commoner one.
      setErrorTargetName((n) => (n === current ? value.trim() : n));
      setNameDraft(null);
      setNameNotice(null);
      commit();
    },
    [session, commit]
  );

  const handleSetDatasetColor = useCallback(
    (index: number, hex: string) => {
      const rgb = hexToRGB(hex);
      if (!rgb) return; // SeriesPanel validates before calling; this is the model's own door
      session.setDatasetColor(index, rgb);
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
  // Which of the active series' pixels are error CAPS (B4) - the marker layer
  // draws and freezes them differently from the readings they hang off.
  const activeCapRoles = useMemo(
    () => session.getCapPixelRoles(session.getActiveDatasetIndex()),
    [session, version]
  );
  const canSortNN = useMemo(() => session.canSortByNearestNeighbour(), [session, version]);
  const placedPoints = useMemo(() => session.getPlacedPoints(), [session, version]);

  /**
   * The key's cursor: where the picked cell sits on the colour key, and the
   * strip it slides along.
   *
   * ⚑ Built from the row's OWN `keyPosition` - the third coordinate the record
   * now carries - so typing a value moves the marker with no sync code at all.
   * One source of truth; the marker cannot drift from the number beside it.
   *
   * ⚑ Null unless exactly one cell is picked, matching the picked-cell line: a
   * range has no single position on the key, and drawing one would name a cell
   * the user did not choose.
   */
  const heatmapKeyCursor = useMemo(() => {
    if (!heatmapActive || !selectedCell) return null;
    const cell = heatmapCells.find((c) => c.col === selectedCell.col && c.row === selectedCell.row);
    if (!cell || cell.keyPosition === null) return null;
    const k1 = placedPoints['k1'];
    const k2 = placedPoints['k2'];
    if (!k1 || !k2) return null;
    // ⚑⚑ THE STRIP, NOT THE CORNERS. `k1`/`k2` are opposite corners, so the line
    // between them is the key's DIAGONAL - drawing on it tilted the caliper and
    // let it drift off the bar, and it is not the line `buildColorScale` samples
    // along. `keyCursorStrip` is that same line, and it measures the thickness.
    const strip = keyCursorStrip(k1, k2);
    if (strip === null) return null;
    return { ...strip, t: cell.keyPosition };
  }, [heatmapActive, selectedCell, heatmapCells, placedPoints]);

  /**
   * WHAT THE COLOUR KEY READS AT ITS TWO ENDS - computed as soon as the key is
   * calibrated, which is the whole point of it.
   *
   * ⚑⚑ THESE NUMBERS ALREADY EXISTED. `heatmapKeyRef` has carried
   * `{ from, to, log }` into every export as the `Colour key` section since
   * v2.2 - but it is filled in `readCellsFor`, i.e. AFTER the cells are read,
   * which is after the damage. The same two calls a few hundred lines up
   * (`valueAtPosition(scale, 0)` / `(scale, 1)`) run here the moment the four
   * key clicks are down, so the extent is on screen while the user is still
   * deciding what the key IS. See ImageCanvas's `keySpan` for the morning that
   * prompted it.
   *
   * ⚑ NO IMAGE, so this is an ordinary memo: `keySpanFromClicks` is pure
   * geometry over the four key clicks, and it uses the same `valueAtParam` the
   * readings come out of. Sampling the ramp is what a READING needs; the ENDS
   * need only where the labelled ticks sit along the strip and what they say.
   * Every decision is in `engine/heatmapRun.ts` where a unit test can reach it -
   * nothing in `ui/` is reachable by anything but an 18-minute Electron run.
   */
  const heatmapKeySpan = useMemo(() => {
    if (!heatmapActive) return null;
    const k1 = placedPoints['k1'];
    const k2 = placedPoints['k2'];
    const kv1 = placedPoints['kv1'];
    const kv2 = placedPoints['kv2'];
    if (!k1 || !k2 || !kv1 || !kv2) return null;
    return keySpanFromClicks(k1, k2, kv1, kv2, session.getOptions()['isLogValue'] === 'true');
  }, [heatmapActive, placedPoints, session, version]);

  /**
   * The cursor moved: show the ink under it, on the TABLE cell.
   *
   * ⚑ One pixel read, not a re-sample of the whole strip - the colour a position
   * on the key is worth IS the ink at that position, so there is nothing to
   * compute and nothing that could disagree with the figure.
   */
  const previewKeyCursor = useCallback(
    (t: number) => {
      if (!selectedCell) return;
      const img = imageCanvasRef.current?.getImageData();
      const k1 = placedPoints['k1'];
      const k2 = placedPoints['k2'];
      if (!img || !k1 || !k2) return;
      const px = Math.round(k1.px + (k2.px - k1.px) * t);
      const py = Math.round(k1.py + (k2.py - k1.py) * t);
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) return;
      const i = (py * img.width + px) * 4;
      setHeatmapDragTint({
        col: selectedCell.col,
        row: selectedCell.row,
        rgb: [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!] as const,
      });
    },
    [placedPoints, selectedCell]
  );

  /**
   * The cursor was dropped: record the position it landed on.
   *
   * ⚑⚑ THE DRAG IS THE PRIMITIVE. The record stores a POSITION on the key, so
   * this writes it outright - where typing a number has to be converted first.
   * It is the same gesture as sliding a data point along its axis, on the axis
   * a heatmap keeps its values on.
   */
  const commitKeyCursor = useCallback(
    (t: number) => {
      setHeatmapDragTint(null);
      if (!selectedCell) return;
      const { readings, error } = setCellReadingAt(
        heatmapCellReadings,
        selectedCell.col,
        selectedCell.row,
        t
      );
      if (error !== null) {
        setHeatmapValueError(error);
        return;
      }
      applyHeatmapCellReadings(readings);
    },
    [applyHeatmapCellReadings, heatmapCellReadings, selectedCell]
  );

  // ⚑ The step list the whole UI walks (v1.4). Memoized here rather than called
  // inline because for a repeating type `getSteps()` BUILDS its array, so a fresh
  // identity every render silently disabled the memoization of everything
  // downstream of it (caught by the compiler lint, not by eye).
  const steps = useMemo(() => session.getSteps(), [session, version]);

  /**
   * WHAT THE CALIBRATION CARD SHOWS - decided in `engine/`, rendered here.
   *
   * ⚑⚑ THE COMPONENT NO LONGER DECIDES. Which stage you are in, what the folded
   * line says and what ends the current stage all come from
   * `calibrationCardModel`, where 24 unit tests reach them in milliseconds. The
   * same decisions as conditions in this file were invisible to mutation testing
   * and reachable only by an 18-minute Electron run - which is why three graph
   * types grew three different second stages.
   *
   * ⚑ `secondStageComplete` is the one fact only this component has: whether the
   * stage has produced anything. A heatmap has cells; a categorical type has tick
   * geometry. Same question, asked of whichever the type declares.
   */
  /**
   * ⚑⚑ THE STAGE'S PRODUCT, NOT ITS FIRST STEP. A marked axis is not the
   * categorical stage's output - the CATEGORIES are, and there are none until a
   * count is declared. Reading `hasGeometry()` alone declared the stage finished
   * the instant the axis was marked, which folded the card away from under the
   * user at the exact moment they were about to type the count: the "flow has no
   * visible NEXT STEP" defect the heatmap's own ending fixed once, arriving
   * through the other door. Caught by an e2e that timed out waiting for a field
   * the card had just hidden.
   */
  const secondStageComplete = heatmapActive
    ? heatmapCells.length > 0
    : session.supportsCategoryTicks()
      ? // ⚑ A DECLARED count, not merely a non-empty name list (v2.3). Two
        // captured bars put two entries in the shared list, and the folded line
        // then read `2 categories ✓` on a chart with four - a count nobody
        // typed, reported as finished work.
        // ⚑⚑ THE ENDING WAS PRESSED, not merely "ticks exist" (v2.3). Since the
        // axis and its count arrive with the calibration walk, ticks exist the
        // instant the walk finishes - so the old test (`hasGeometry &&
        // hasDeclaredCount`) would fold the card at the exact moment the user
        // was about to drag a marker onto the figure's own rule. Same rule the
        // heatmap has always had: its stage ends when `Read cells` produces a
        // record, not when a grid becomes possible.
        session.getCategoryAxis().categoriesMarked()
      : false;
  // ⚑ The heatmap's summary is a count of what was READ; a bar chart's folded
  // line is David's own words for the walk being done, declared on the type
  // (`secondStage.done`) so the component does not assemble it.
  const secondStageSummary = heatmapActive ? `${heatmapCells.length} cells read` : undefined;
  /** The stage's summary line - the sibling of `heatmapGridSummary`. */
  const categoryStageSummary = categoryStageLine(categoryStage.count, categoryStage.marked, categoryStage.declared);
  const cardModel = calibrationCardModel({
    ...(config.secondStage ? { secondStage: config.secondStage } : {}),
    figureCaptured,
    calibrated: !!axes,
    placed: Object.keys(placedPoints).length,
    steps: steps.length,
    secondStageComplete,
    secondStageSummary,
    expanded: calibExpanded,
  });
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
  // Declared by the type when its datum is the TUPLE rather than its members - the
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
    // Top-justified against the card (David) - so on a tall expanded card the
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
  /**
   * ⚑⚑ THE AXIS ENDS ARE NOT MARKED HERE ANY MORE (v2.3). They
   * used to be marked by this overlay - two violet dots labelled `Categories
   * start` and `Categories end` - because they were placed by a fold-out and
   * nothing else on screen owned them. They are CALIBRATION STEPS now (`Cat 1`,
   * `Cat n`), so the walk already draws a handle at each of those pixels, names
   * it in the card's chip row, and lets it be dragged.
   *
   * ▶ Drawing them twice put two markers on one pixel and printed a label across
   * the axis line, which is what David's bench shot shows. With the bar chart's
   * ends owned by the calibration, no caller wanted them marked, so the option
   * went with them - see `CategoryOverlayInput`.
   */
  const categoryOverlay = useMemo(() => {
    const ca = session.getCategoryAxis();
    return { edges: ca.getAxisEdges(), tickPoints: ca.getTickPoints() };
  }, [session, version]);
  const categoryGlyphs = useMemo(() => categoryAidGlyphs(categoryOverlay), [categoryOverlay]);
  const categoryMarkers = useMemo(() => categoryTickMarkers(categoryOverlay), [categoryOverlay]);

  /**
   * A grab handle on every heatmap divider - ORDINARY CANVAS MARKERS, so they
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
  const heatmapOverlays = useMemo(() => {
    if (!heatmapShownGrid) return null;
    const axesNow = session.getAxes();
    return axesNow ? heatmapAxisOverlays(heatmapShownGrid, axesNow) : null;
  }, [heatmapShownGrid, session, version]);

  /**
   * The grid's boundaries as TICK MARKS - the marked axis a bar chart already
   * draws, not a row of dots.
   *
   * ⚑⚑ David, twice: *"We still have points and not selectable tick markers
   * that we said that we were going to reuse from bar tick characterisation.
   * We said that we were going to stop inventing new things and REUSE things
   * that we already have."* The old `dividerHandles` produced bare markers 16px
   * outside the plot and borrowed only the COLOUR from v2.1's category ticks -
   * no axis line, no tick marks, a second mechanism for a solved problem.
   *
   * ⚑ THE SELECTED ONE IS STILL DRAWN BIGGER, because the card names a boundary
   * in data units and the user has to find it among a dozen identical marks.
   */
  const heatmapGridGlyphs = useMemo<AidGlyph[]>(
    () =>
      heatmapOverlays
        ? [...categoryAidGlyphs(heatmapOverlays.x), ...categoryAidGlyphs(heatmapOverlays.y)].map((g) =>
            // ⚑ The picked boundary is drawn bigger and ringed - the same
            // emphasis the marker layer used to apply, moved with the grip it
            // belongs to. The card names a boundary in data units, so the pick
            // has to be findable among a dozen identical marks.
            g.markerId !== null && g.markerId === selectedDividerId
              ? { ...g, gripRadius: 7, selected: true }
              : g
          )
        : [],
    [heatmapOverlays, selectedDividerId]
  );

  const heatmapHandles = useMemo<CanvasMarker[]>(() => {
    if (!heatmapOverlays) return [];
    // ⚑ No radius map any more: an `aid` marker draws nothing, so its size is
    // the GRIP's, and the grip travels with the mark in `heatmapGridGlyphs`.
    return [...categoryTickMarkers(heatmapOverlays.x), ...categoryTickMarkers(heatmapOverlays.y)];
  }, [heatmapOverlays]);
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
  // ⚑ "Picked", not merely "selected" - see pickedPointIndex. Keying this on
  // activePointIndex alone silently broke the highlight's OTHER job: placing a point
  // selects it, so the ray stopped on the axis just filled instead of moving to the
  // next one to fill, which is the drift-prevention the ray exists for. Caught by an
  // e2e test that already asserted the walk round the chart - a reminder that a fix
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
    () => (config.supportsGeometry && axes ? getGeometryState(session.getDataset()) : null),
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
  /** The same answer `errorTargetIndexNow` gives the capture handlers, from the
   *  same resolver - so the card, the canvas and the drag cannot disagree about
   *  which series a cap is going to (F39). */
  const errorTargetIndex = useMemo(
    () => resolveErrorTarget(datasetInfos, errorTargetName, activeDatasetIndex),
    [datasetInfos, errorTargetName, activeDatasetIndex]
  );
  const activeInfo = useMemo(() => datasetInfos.find((d) => d.active) ?? datasetInfos[0], [datasetInfos]);
  // The adaptive multi-series spreadsheet model (checkpoint 57): every series'
  // data values (pixel columns dropped), joined name+color, plus the ragged row
  // count (= the longest series). Rendered as one table with a per-type value-dim
  // column set under each series -- see the Data section below.
  /**
   * How every panel number is rounded before it is printed - see
   * `core/displayPrecision.ts`.
   *
   * ⚑ Memoised on the AXES, because that is what a resolution comes from. A new
   * rounder per render would be harmless arithmetic but would churn every memo
   * that depends on it, which is the shape [[live and stable are separate]]
   * warns about.
   */
  const displayRounder = useMemo(() => makeDisplayRounder(axes), [axes]);

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


  // Check Calibration overlay (v0.8): the calibrated axis box, drawn only while

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
        capRoles: activeCapRoles,
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
    [steps, placedPoints, pendingPixel, dataPoints, dataPointRoles, activeCapRoles, axes, mode, config.axesKind, allDatasetsData, datasetInfos, activePointIndex, activeHandleKey, selectedPointIndices, activeDatasetIndex, errorTargetIndex, labelAway, ringClosingIndex]
  );

  // ⚑ An aid's marker carries the HIT AREA and draws nothing; the mark and its
  // grip are one object in `allAidGlyphs`. They were two, in two layers and two
  // colours, and only the handle could be moved - see `AidGlyph`.
  const allMarkers = useMemo<CanvasMarker[]>(
    () =>
      categoryMarkers.length > 0 || heatmapHandles.length > 0
        ? [...markers, ...categoryMarkers, ...heatmapHandles]
        : markers,
    [markers, categoryMarkers, heatmapHandles]
  );
  /** A histogram's bin glyphs, which is all this layer carries now.
   *
   * ⚠️ THE CATEGORY AXIS AND THE HEATMAP GRID USED TO BE HERE TOO, and that is
   * why their marks came out BLACK and unclickable: this layer paints in
   * `theme.color.overlay.stroke` with `listening={false}`, which is right for a
   * bin's glyph and wrong for something the user is meant to grab. They have
   * their own layer now (`allAidGlyphs`), in their own colour, with their grips
   * attached. */
  const allBinGlyphs = useMemo(() => binGlyphs, [binGlyphs]);
  /** ⚑ ONE AID LAYER, two contributors - a bar chart's marked category axis and
   * a heatmap's grid - because they are the same thing fed a different axis. */
  const allAidGlyphs = useMemo<AidGlyph[]>(
    () => [...categoryGlyphs, ...heatmapGridGlyphs],
    [categoryGlyphs, heatmapGridGlyphs]
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
  }, [activeMeasure, mode, measurements, setActiveMeasure]);

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
  const renderEditableValue = (index: number, axis: number, value: number, supplied: boolean) => {
    const suffix = axis === 0 ? 'x' : 'y';
    // ⚑⚑ THE DISPLAY ROUNDS AND THE SEED DOES NOT. `value` arrives raw, because
    // the commit is what moves the datum; what the cell PRINTS is that number at
    // the figure's own resolution, so the table and the file agree. The two are
    // separate expressions below on purpose - F23 is what one shared expression
    // did (a `toFixed(3)` display feeding the editor turned 0.00042 into 0 on a
    // log axis, silently, on double-click-and-blur).
    const pixel = session.getDataset().getPixel(index) as { x: number; y: number } | undefined;
    const shown =
      pixel === undefined ? value : displayRounder.scalarAtPixel(value, pixel.x, pixel.y, axis);
    return (
      <EditableValue
        editing={editingCell?.index === index && editingCell.axis === axis}
        editValue={editingCell?.value ?? ''}
        // ⚑ The brackets are on the DISPLAY only; the seed is the bare number,
        // so reopening your own value never means deleting punctuation the table
        // added (the heatmap's own rule, now literally shared with it).
        // ⚠️ This comment said "now everyone's" above a `value.toFixed(3)` that
        // was neither the shown number nor the bare one, and that is how a
        // silent value-destroying seed survived review: gate 3 exactly.
        display={valueText(fmtValue(shown), supplied)}
        testIdEdit={`data-edit-${suffix}-${index}`}
        testIdValue={`data-value-${suffix}-${index}`}
        title={valueTitle('Double-click to edit - moves the point on the canvas', supplied)}
        width={56}
        onStartEdit={() => setEditingCell({ index, axis, value: editSeed(value), seed: editSeed(value) })}
        // ⚑ Typing changes the VALUE and never the seed - the seed is what the
        // editor opened with, and rewriting it would make every keystroke look
        // like no change at all.
        onChange={(v) => setEditingCell((c) => (c ? { ...c, value: v } : c))}
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
  const renderEditableSpiderValue = (
    seriesIndex: number,
    pointIndex: number,
    axisIndex: number,
    value: number,
    supplied: boolean
  ) => (
    // ⚑ `display` is rounded to THIS SPOKE's own resolution - a spider's axes each
    // carry their own scale, so the spoke index has to go in. The seed below stays
    // the whole number, because the commit is what moves the datum (F23).
    <EditableValue
      editing={editingCell?.index === pointIndex && editingCell.axis === axisIndex}
      editValue={editingCell?.value ?? ''}
      display={valueText(fmtValue(displayRounder.scalarAtData(value, [axisIndex, value], 0)), supplied)}
      testIdEdit={`spider-edit-${seriesIndex}-${axisIndex}`}
      testIdValue={`spider-value-${seriesIndex}-${axisIndex}`}
      title={valueTitle('Double-click to edit - moves the point along its own axis', supplied)}
      width={64}
      align="right"
      onStartEdit={() =>
        setEditingCell({ index: pointIndex, axis: axisIndex, value: editSeed(value), seed: editSeed(value) })
      }
      onChange={(v) => setEditingCell((c) => (c ? { ...c, value: v } : c))}
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
  /**
   * One calibration option, whatever kind it is. Lifted out of the options block
   * unchanged so that the ARRANGEMENT can be declared per type (see
   * `AxesOptionVisibility.group`) without any control being rendered a second
   * way. There is exactly one place that draws a checkbox, a radio group and a
   * text field, and this is it.
   */
  function renderOptions(opts: readonly AxesOption[]) {
    return opts.map((opt) =>
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
                  /* ⚑⚑ RADIOS, NOT A DROPDOWN - the rule v2.1's category ticks
                     already wrote down: *"both readings have to be visible
                     without a click, because the user is being asked which one
                     their figure prints."* A `<select>` hides the alternative
                     until opened, so the current state reads as a fact rather
                     than as one of two answers. David: *"radio buttons... so
                     that you can clearly see them, and select only one."*

                     ⚑ NO "three or more falls back to a select" BRANCH. Every
                     `choice` in the config table has exactly two options, so
                     that branch could not fire - and a guard that cannot fire is
                     the shape this codebase has been bitten by five times. When
                     a third option first appears, it can be decided with a real
                     case in front of us.

                     ⚑ The `name` scopes exclusivity to this option, which is
                     what keeps X and Y independent: an axis is Values OR
                     Categories, but BOTH axes may be Categories - that is the
                     commonest heatmap there is. */
                  <span key={opt.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span>{opt.label}</span>
                    {/* ⚑ THE GROUP keeps `calib-option-<key>`, because that is how
                        every option kind is identified and how the
                        "each type offers its own options" inventory finds them.
                        The individual radios take their own prefix rather than
                        `calib-option-<key>-<value>`, which would make one option
                        answer that inventory two or three times - and the values
                        themselves contain hyphens (`bottom-left`), so the key
                        could not be recovered by trimming. */}
                    <fieldset
                      data-testid={`calib-option-${opt.key}`}
                      style={{ border: 'none', margin: 0, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 10 }}
                    >
                      {opt.choices.map((c) => (
                        <label key={c.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`calib-option-${opt.key}`}
                            data-testid={`calib-choice-${opt.key}-${c.value}`}
                            checked={(axesOptions[opt.key] ?? opt.default) === c.value}
                            onChange={() => setAxesOption(opt.key, c.value)}
                          />
                          <span style={{ whiteSpace: 'nowrap' }}>{c.label}</span>
                        </label>
                      ))}
                    </fieldset>
                  </span>
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
    );
  }

  /** What the open name editor started with - see `EditableName.onCancel`. */
  const nameSeedRef = useRef('');

  function renderEditableName(
    index: number,
    rawName: string,
    editingIndex: number | string | null,
    setEditingIndex: (i: never) => void,
    onChange: (index: number, name: string) => void,
    testId: string,
    placeholder: string,
    title: string,
    width: number,
    /** What an UNNAMED one reads as at rest, where a dash would leave the row
     * unidentifiable - see `EditableNameProps.emptyDisplay`. */
    emptyDisplay?: string,
    /**
     * Which RENDERED COPY this is, when one thing appears in more than one place.
     *
     * ⚑⚑ THE LONG FORM REPEATS A BAND'S NAME ONCE PER CELL, so keying the editor
     * on the band alone mounted one `autoFocus` input per copy - each blurring
     * the last, and `onBlur` closes the editor. The name became impossible to
     * open the moment a band spanned more than one row, which is every heatmap
     * now that a MEASURED axis has bands too (case A1). Identity is the copy;
     * the edit still writes to the band.
     */
    editKey: number | string = index
  ) {
    return (
      <EditableName
        editing={editingIndex === editKey}
        name={rawName}
        {...(emptyDisplay === undefined ? {} : { emptyDisplay })}
        testId={testId}
        placeholder={placeholder}
        title={title}
        width={width}
        onStartEdit={() => {
          // ⚑ THE NAME THE EDITOR OPENED WITH, so Escape has something to put
          // back (F40). A name is written through on every keystroke - that is
          // what keeps the table live - so backing out means restoring, not
          // withholding. Same shape as `editSeed` for a value (F23).
          nameSeedRef.current = rawName;
          setEditingIndex(editKey as never);
        }}
        onChange={(name) => onChange(index, name)}
        onFinish={() => {
          setEditingIndex(null as never);
          commitPendingEdit();
        }}
        onCancel={() => {
          onChange(index, nameSeedRef.current);
          setEditingIndex(null as never);
          // ⚑ No `commitPendingEdit`: nothing was decided, so nothing goes on
          // the undo stack. The seed write is the same value the store already
          // held when the editor opened.
          // ⚑⚑ BUT THE PENDING FLAG MUST BE PUT BACK DOWN (audit fleet, A7).
          // `onChange` raises `pendingEditRef` on its way through - that is what
          // makes a text edit ONE undo step on blur - so backing out and skipping
          // the commit left it stuck true, and the next unrelated blur (another
          // cell, a colour picker closing) fired a commit for a change nobody
          // made. The original comment reasoned about the undo stack and stopped
          // one line short of the flag that drives it.
          cancelPendingEdit();
        }}
      />
    );
  }

  /**
   * A DATUM's own name, in the XY-family spreadsheet - categorical Line's
   * Category column (F28).
   *
   * ⚑ Keyed on the point index rather than a row: the table is ragged and only
   * the active series' cells open, so the pixel index is the one identity that
   * is unambiguous across a re-sort or a deletion.
   */
  const renderEditablePointLabel = (pointIndex: number, rawName: string, testId: string) =>
    renderEditableName(
      pointIndex, rawName, editingPointLabel, setEditingPointLabel, setPointLabel,
      testId, 'name…',
      'Double-click to name this category, as the figure prints it', 90
    );

  /**
   * Select a whole ROW of a tuple panel, and show it on the figure (F30).
   *
   * ⚑⚑ THE SAME SELECTION EVERY OTHER PANEL MAKES, not a fourth kind of
   * highlight. The XY spreadsheet and the spider table both answer a row click
   * with `setActivePointIndex` + `setPickedPointIndex`, and the canvas rings
   * whatever that names - so Bar, Box Plot, Pie and the histogram's bins get the
   * behaviour by joining in rather than by growing their own. Before this, four
   * of the seven output panels had no way at all to ask "which one on the figure
   * is this row?", which is the first question anyone reading a table of twenty
   * bars has.
   *
   * ⚑ `firstPixelOfTuple` is the model's answer, so a half-captured tuple - one
   * corner down, the other not - is still selectable.
   */
  const selectTuple = useCallback(
    (tupleIndex: number) => {
      // ⚑⚑ IN SELECT MODE THE WHOLE TUPLE LIGHTS UP, because that is what Select
      // mode's highlight IS - `selectedPointIndices`, which the canvas draws
      // instead of the active point there. The XY spreadsheet's own row click
      // has always made this distinction (`onSelectMarquee` vs `onSelectPoint`);
      // without it a row click in Select mode set a selection the renderer was
      // not looking at, and nothing happened on the figure at all. Mirroring
      // means mirroring the branch too, not only the happy path.
      const pixels = sessionRef.current.pixelsOfTuple(tupleIndex);
      if (modeRef.current === 'select') {
        setSelectedPointIndices(pixels);
        return;
      }
      const pixel = pixels[0] ?? null;
      setActivePointIndex(pixel);
      if (pixel !== null) setPickedPointIndex(pixel);
    },
    []
  );
  /**
   * Which tuple row the current selection is standing on, so the table can show
   * it - the inverse of `selectTuple`, and the reason a canvas click highlights
   * the row as well as the other way round.
   *
   * ⚑⚑ IT HAS TO ASK THE MODE, exactly as `selectTuple` does. Select mode's
   * selection IS `selectedPointIndices`; Place Point's is `activePointIndex`.
   * `selectTuple` learned that branch and this did not, so in Select mode a row
   * click lit the FIGURE and left the ROW unhighlighted - the panel and the
   * canvas disagreeing about what is selected, which is the precise thing the
   * mirroring was added to prevent. `SpreadsheetTable` has always asked the mode
   * here; the three panels that just joined it were reading a value that only
   * answered for one of the two modes. (Found by the v2.3 audit fleet, G5 - a
   * same-cycle companion to the fix that created it.)
   */
  const activeTupleIndex = useMemo(
    () =>
      mode === 'select'
        ? session.tupleIndexOfPixel(selectedPointIndices[0] ?? null)
        : session.tupleIndexOfPixel(activePointIndex),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, version, activePointIndex, selectedPointIndices, mode]
  );

  const renderEditableAxisName = (axisIndex: number, rawName: string) =>
    renderEditableName(
      axisIndex, rawName, editingAxisName, setEditingAxisName, setSpokeName,
      `spider-axis-name-${axisIndex}`, `Axis ${axisIndex + 1}`,
      'Double-click to name this axis, as the figure prints it', 150
    );

  // Bar's category (v2.0): position (the row's own place in the table) is the
  // only identity the app itself needs (autoLabelTuple no longer invents a
  // "Bar0"-style name -- see engine/calibrationSession.ts) -- the name is
  // purely for the human reading the table.
  const renderEditableCategoryName = (categoryIndex: number, rawName: string) =>
    renderEditableName(
      categoryIndex, rawName, editingCategoryName, setEditingCategoryName, renameCategory,
      `bar-category-name-${categoryIndex}`, `Category ${categoryIndex + 1}`,
      'Double-click to name this category, as the figure prints it', 120
    );

  // The generic tuple table's category name (Pie's sector, Box Plot's box) --
  // the PLAIN per-tuple metadata.label mechanism (setTupleLabel's
  // non-categoryAxis branch), since Pie has no cross-series category identity
  // to share. tupleNoun gives a nicer, type-specific placeholder ("Sector 1",
  // "Box 1") than a generic "Category N" would.
  /**
   * Rename one heatmap CATEGORY, from the cell the user clicked.
   *
   * ⚑⚑ THE TABLE WORKS IN CELL INDICES AND THE BOXES WORK IN READING ORDER, so
   * the edit is applied in cell space and converted back - through the SAME
   * `labelsForCells`, which is its own inverse. Writing the cell index straight
   * into the typed text would put the name on the mirror-image band on any
   * ordinary upward-y figure, which is the exact defect the audit found this
   * morning, re-introduced from the other end.
   */
  const setHeatmapCategoryName = useCallback(
    (axis: 'x' | 'y', bandIndex: number, name: string) => {
      const axesNow = sessionRef.current.getAxes();
      if (!axesNow || !heatmapShownGrid) return;
      const cellOrdered = labelsForCells(heatmapLabels, heatmapShownGrid, axesNow);
      const next = [...(axis === 'x' ? cellOrdered.x : cellOrdered.y)];
      while (next.length <= bandIndex) next.push('');
      next[bandIndex] = name;
      const edited = axis === 'x' ? { x: next, y: cellOrdered.y } : { x: cellOrdered.x, y: next };
      const typed = labelsForCells(edited, heatmapShownGrid, axesNow);
      applyHeatmapLabels(formatLabelList(typed.x), formatLabelList(typed.y));
    },
    [applyHeatmapLabels, heatmapLabels, heatmapShownGrid]
  );

  /**
   * ⚑ AN UNNAMED BAND STILL HAS TO BE IDENTIFIABLE. The name column is the only
   * thing distinguishing one categorical row from another, so a bare dash - the
   * right answer where a bar's value sits beside it - turned five rows into five
   * dashes. It falls back to the ORDINAL CENTRE, which is what the record holds
   * and what the export writes, so the table agrees with the file before anyone
   * types a thing.
   */
  const renderHeatmapXName = (bandIndex: number, name: string, ordinal: number, copy?: string) =>
    renderEditableName(
      bandIndex, name, editingHeatmapXName, setEditingHeatmapXName,
      (i, v) => setHeatmapCategoryName('x', i, v),
      `heatmap-x-name-${bandIndex}`, `Column ${bandIndex + 1}`,
      'Double-click to name this column, as the figure prints it', 90,
      // ⚑⚑ NO ORDINAL AS THE EMPTY DISPLAY (E4). An unnamed band used to read
      // `0.4991` - its band-centre ordinal to four decimals - which is
      // indistinguishable from a MEASURED coordinate, on the one type where
      // that distinction has no other symptom. David read it as the value axis
      // having lost its numbers. The header already says `C1`, so the decimal
      // identified nothing and impersonated something.
      // ⚑ It also made the heatmap the only type doing this: spider axes and bar
      // categories have always shown the shared em dash when unnamed.
      undefined, copy ?? bandIndex
    );

  const renderHeatmapYName = (bandIndex: number, name: string, ordinal: number, copy?: string) =>
    renderEditableName(
      bandIndex, name, editingHeatmapYName, setEditingHeatmapYName,
      (i, v) => setHeatmapCategoryName('y', i, v),
      `heatmap-y-name-${bandIndex}`, `Row ${bandIndex + 1}`,
      'Double-click to name this row, as the figure prints it', 90,
      // ⚑⚑ NO ORDINAL AS THE EMPTY DISPLAY (E4). An unnamed band used to read
      // `0.4991` - its band-centre ordinal to four decimals - which is
      // indistinguishable from a MEASURED coordinate, on the one type where
      // that distinction has no other symptom. David read it as the value axis
      // having lost its numbers. The header already says `R1`, so the decimal
      // identified nothing and impersonated something.
      // ⚑ It also made the heatmap the only type doing this: spider axes and bar
      // categories have always shown the shared em dash when unnamed.
      undefined, copy ?? bandIndex
    );

  /**
   * One heatmap cell's VALUE - click to edit, exactly as the XY and spider
   * tables' values have been since v1.3.
   *
   * ⚑⚑ THE TYPED TWIN OF A MEASUREMENT, and the same component that serves the
   * other two: a person who can read a hatched cell we can only average is
   * taking a reading, and it goes into the record the way ours does. The dashed
   * underline is the whole affordance - nothing has to be known in advance for
   * it to be found.
   *
   * ⚑ The seed is the number AS SHOWN, without its brackets: a user reopening
   * their own value should not have to delete punctuation the table added.
   */
  const renderHeatmapValue = (cell: HeatmapRow, display: string) => {
    const editing =
      editingHeatmapValue?.col === cell.col && editingHeatmapValue.row === cell.row;
    const seed = editSeed(cell.value);
    return (
      <EditableValue
        editing={editing}
        editValue={editingHeatmapValue?.value ?? ''}
        display={display}
        testIdEdit={`heatmap-value-edit-${cell.col}-${cell.row}`}
        testIdValue={`heatmap-value-${cell.col}-${cell.row}`}
        title="Double-click to edit - moves this cell along the colour key"
        width={64}
        align="right"
        onStartEdit={() =>
          setEditingHeatmapValue({ col: cell.col, row: cell.row, value: seed, seed })
        }
        onChange={(v) =>
          setEditingHeatmapValue({ col: cell.col, row: cell.row, value: v, seed })
        }
        onCommit={commitHeatmapValueEdit}
        onCancel={() => setEditingHeatmapValue(null)}
      />
    );
  };

  const renderEditableTupleLabel = (tupleIndex: number, rawLabel: string) =>
    renderEditableName(
      tupleIndex, rawLabel, editingTupleLabel, setEditingTupleLabel, setTupleLabel,
      `tuple-label-${tupleIndex}`, `${tupleNoun.charAt(0).toUpperCase()}${tupleNoun.slice(1)} ${tupleIndex + 1}`,
      `Double-click to name this ${tupleNoun}, as the figure prints it`, 100
    );

  // The single contextual "what do I do now?" line shown in the bottom tips bar
  // (checkpoint 50) -- the one constant place for guidance, so it no longer
  // pops in and out of the right panel.
  const guidanceTip = buildGuidanceTip({
    canvasHasImage,
    heatmapHasGrid: heatmapShownGrid !== null,
    heatmapHasCells: heatmapCells.length > 0,
    // ⚑ The caliper is drawn only for a SINGLE picked cell, and the tip names it
    // only when it is there to be dragged - same source of truth as the marker.
    heatmapCellPicked: selectedCell !== null,
    // ⚑ There is no marking MODE any more - the category axis is two steps of
    // the calibration walk, so the tips bar shows their step prompts like any
    // other calibration step.
    categoryAxisUnplaced: session.categoryAxisIncomplete(),
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
    // ⚑ Whether a colour reading can give a VALUE as well as a colour. Asked of
    // the CALIBRATION rather than of the graph type: a key is a key, and the
    // tool refuses to belong to one type (theme C).
    hasColourKey: colourScale !== null,
    measureScaleUnit: measureScale ? measureScale.unit : null,
    isCalibrated: axes !== null,
    config,
    isCalibrating,
    hasPendingPixel: pendingPixel !== null,
    // ⚑⚑ D2: whether this step's pending pixel arrived by `commonOrigin` REUSE
    // rather than by a click, so the tip can stop telling the user to click a
    // corner the app already placed for them.
    //
    // ⚑ DERIVED, not remembered. `confirmDataValue` knows `reuse.from` at the
    // moment it applies it, but storing that is state which can go stale against
    // the walk; asking the same pure function the same question cannot. A reuse
    // is offered exactly while the `from` step is placed and the `to` step is
    // not, which is precisely the window in which its pixel is pending.
    ...(() => {
      if (!currentStep || pendingPixel === null) return {};
      const reuse = commonOriginReuse(config, commonOrigin, currentStep.key, session.getPlacedPoints(), currentStep);
      if (!reuse) return {};
      return { pixelReusedFrom: steps.find((st) => st.key === reuse.from)?.label ?? reuse.from };
    })(),
    currentStep: currentStep
      ? {
          label: currentStep.label,
          prompt: currentStep.prompt,
          ...(currentStep.reusedPrompt ? { reusedPrompt: currentStep.reusedPrompt } : {}),
        }
      : null,
    pendingValueFieldCount: pendingValueFields.length,
    stepIndex: session.getStepIndex(),
    stepCount: steps.length,
    selectedPointCount: selectedPointIndices.length,
    dataPointCount: dataPoints.length,
    activePointIndex,
    // ⚑ So the tip names the READING, not the pixel - a cap is a pixel of its
    // datum's own series (B4), and this sentence prints the same number the
    // figure label does.
    capRoles: activeCapRoles,
    activePointIsAnchor: activePointIndex != null && dataPointRoles[activePointIndex] === 'anchor',
    // Boolean(), not `!== null`: the branch this feeds was written as
    // `if (activeHandleKey)`, and the two answers differ on the empty string.
    // No step key is empty, so nothing changes today - but the translation
    // should not be the thing you have to reason about to know that.
    hasActiveHandle: Boolean(activeHandleKey),
    hasSlots,
    currentGroupLabel,
    currentTupleIndex,
    tupleNoun,
    captureProgressText: captureProgress.text,
  });

  const noPointsHint = buildNoPointsHint({ mode, config, heatmapHasGrid: heatmapShownGrid !== null });

  // The Measure card's reference line is tool-aware: Slope reads the chart axes;
  // Distance/Area read the Set-scale px->unit; Angle is degrees (no reference).

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
      visible={!!config.supportsGeometry}
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
        {/* Clear all points - top-left, matching Ketcher's "new/clear document"
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
            title="Open an image or PDF to digitize - PNG, JPG, GIF, BMP, WEBP, SVG, PDF (or drag-and-drop / paste one)"
            // ⚑ audit F6b: the empty-state Open Image was wrapped and this one,
            // the top-bar twin of the same action, was not.
            onClick={reporting(
              'Could not open the image',
              () => imageCanvasRef.current?.openImage() ?? Promise.resolve(),
              setProjectError
            )}
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
            options={ALL_AXES_TYPE_CONFIGS}
            value={axesTypeId}
            onChange={(id) => {
              if (id !== axesTypeId && confirmDiscardIfDirty()) changeAxesType(id);
            }}
          />
        </TopBarGroup>

        {/* Project file I/O group. */}
        <TopBarGroup>
          <TopBarButton
            type="button"
            data-testid="open-project"
            title="Open a saved project"
            // ⚑ A rejected IPC returned to onClick goes nowhere (audit F6).
            onClick={reporting('Could not open the project', openProject, setProjectError)}
          >
            <OpenIcon /> Open Project
            {keyTips && <KeyTip>{keyTipLabel('O', true)}</KeyTip>}
          </TopBarButton>
          <TopBarButton
            type="button"
            data-testid="save-project"
            title="Save the whole project - image, calibration and points - as a PlotTracer project file you can reopen later"
            // ⚑⚑ THE SILENT-DATA-LOSS ONE (audit F6): the write throws in main,
            // the IPC rejects, and without this the screen says the save worked.
            onClick={reporting('Could not save the project', saveProject, setProjectError)}
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
            // ⚑ audit F6b: both write files through the same IPC that F6 showed
            // can reject, and both dropped it.
            onExport={(fmt, target) =>
              reporting('Could not export the data', () => exportData(fmt, target), setProjectError)()
            }
            onSaveImage={reporting('Could not save the image', saveImage, setProjectError)}
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
            onStartChallenge={game.start}
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
          {/* Figure jumper (checkpoint 110, design §8) - ◀ ▶ flanking the
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
            {/* ⚑⚑ THE SECOND STAGE'S OWN STATUS, on the same line. David's
                design: a finished card is ONE row - "Calibration · Calibrated ✓
                · 20 cells read ✓ · Reset calibration". It appears only once the
                stage has actually produced a reading, so the line never claims
                work that has not happened. */}
            {cardModel.foldedLine.secondStage && (
              <span
                data-testid="second-stage-status"
                style={{
                  fontSize: theme.font.size.small,
                  whiteSpace: 'nowrap',
                  color: theme.color.primary.main,
                }}
              >
                {cardModel.foldedLine.secondStage}
              </span>
            )}
            {!isCalibrating && !axes && (
              // ⛑ THE SAME TEAL AS THE OTHER TWO. This ends the calibration
              // walk and auto-folds its card (checkpoint 86) - the identical
              // role Done and Read cells play - and it was the plainest control
              // in the panel while being the one every extracted value depends
              // on. David spotted the inconsistency from the other end.
              <button
                type="button"
                data-testid="run-calibration"
                onClick={runCalibration}
                style={{ marginLeft: 'auto', ...endsCardButton() }}
              >
                Calibrate
              </button>
            )}
            <button
              type="button"
              data-testid="reset-calibration"
              onClick={reset}
              style={{ marginLeft: !isCalibrating && !axes ? 6 : 'auto', fontSize: 12, whiteSpace: 'nowrap' }}
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
                // ⚑ NOT `!axes`: a figure can arrive CALIBRATED with steps
                // nobody placed (a WPD import, a pre-v2.3 project), and the chip
                // it is asking for has to light up like any other. A finished
                // walk has no such step, so nothing changes for it.
                const active = i === session.getStepIndex() && currentStep !== null;
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
                      <span style={{ color: theme.color.text.legend }}>{placed ? 'placed' : active ? 'click image' : '-'}</span>
                    ) : editing ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {pendingValueFields.map((vf, vi) => (
                          <input
                            key={vf.key}
                            ref={(el) => {
                              valueInputRefs.current[vi] = el;
                            }}
                            data-testid={vi === 0 ? 'data-value-input' : `data-value-input-${vi}`}
                            value={dataValueInputs[vi] ?? ''}
                            onChange={(e) => setDataValueInputAt(vi, e.target.value)}
                            /* ⚑⚑ ENTER MOVES TO THE NEXT BOX, and only confirms on
                               the last one. David: *"when I just pressed enter, I
                               want it to jump to the box... I can press tab (do
                               not remove that capability) but it is not as
                               intuitive."* A step with two fields - a heatmap
                               axis's coordinate and its band count, a polar
                               point's r and θ - used to swallow Enter entirely:
                               `confirmDataValue` refuses while a required field
                               is blank, so the key did nothing at all and the
                               only way on was a reach for Tab or the mouse.
                               ⚑ Tab is untouched; this adds a second way, it
                               does not replace one.
                               ⚑ The text is SELECTED on arrival, so typing
                               overwrites a prefilled value rather than appending
                               to it - a shared corner arrives with its number
                               already there. */
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter') return;
                              e.preventDefault();
                              const next = valueInputRefs.current[vi + 1];
                              if (next) next.select();
                              else confirmDataValue();
                            }}
                            autoFocus={vi === 0}
                            placeholder={vf.label}
                            title={vf.label}
                            style={{ width: 46 }}
                          />
                        ))}
                        <button type="button" data-testid="confirm-data-value" onClick={confirmDataValue} style={{ fontSize: 11, padding: '0 5px' }}>
                          ✓
                        </button>
                      </span>
                    ) : placed ? (
                      /* ⚑⚑ EDITABLE WHERE IT IS SHOWN. This was plain text, so a
                         mistyped calibration number could only be corrected by
                         Reset calibration - discarding the whole walk. David,
                         staring at a log colour key that refused his 0 and told
                         him to enter a positive value: *"And I don't see how I
                         can edit the points at this point during the calibration
                         even?"* There was no way; the app asked for something it
                         did not let him do.
                         ⚑ Every other value in the app is editable where it is
                         displayed - a data point's value in the table, a
                         category's name. The calibration value, which everything
                         else is measured against, was the exception. */
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {placed.values.map((v, vi) => (
                          <EditableValue
                            key={`${step.key}-${vi}`}
                            editing={
                              editingCalibValue?.key === step.key && editingCalibValue.index === vi
                            }
                            editValue={editingCalibValue?.value ?? v}
                            display={v}
                            testIdEdit={`calib-edit-${step.key}-${vi}`}
                            testIdValue={`calib-value-${step.key}-${vi}`}
                            title="Double-click to edit - re-reads every value through the corrected calibration"
                            width={52}
                            onStartEdit={() =>
                              setEditingCalibValue({ key: step.key, index: vi, value: v })
                            }
                            onChange={(next: string) =>
                              setEditingCalibValue({ key: step.key, index: vi, value: next })
                            }
                            onCommit={() => editingCalibValue && commitCalibValueEdit(editingCalibValue)}
                            onCancel={() => setEditingCalibValue(null)}
                          />
                        ))}
                      </span>
                    ) : (
                      <span style={{ color: theme.color.text.legend }}>{active ? 'click image' : '-'}</span>
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
                  pie's outline read "3 axes - add one for every axis the chart draws",
                  which is wrong twice over. The config has always declared the noun
                  (`repeatingStep.noun`); the two buttons either side of this already
                  use it. Caught by the pie e2e. */}
              <span data-testid="repeat-count" style={{ color: theme.color.text.legend }}>
                {session.getRepeatCount()}{' '}
                {session.getRepeatCount() === 1 ? repeatingStep.noun : repeatingStep.nounPlural} -{' '}
                {repeatingStep.hint}
              </span>
            </div>
          )}
          {/* ⚑⚑ NOT OFFERED WHERE IT IS ALWAYS ON (B12). A heatmap's two axes
              span exactly one rectangle, so three of its corners carry the whole
              transform - three points are the AFFINE MINIMUM. The checkbox
              existed to fold a fourth click away; where three is the only
              sensible walk, unticking it can only ask for a worse one, and an
              option nobody should choose is an option that should not be there.
              ⚑ XY keeps it: that type really does have figures whose axes do not
              meet, so there it is a genuine question. */}
          {figureCaptured && calibExpanded && config.commonOrigin && !config.commonOriginAlways && !axes && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.color.text.secondary, cursor: 'pointer' }}>
              <input
                type="checkbox"
                data-testid="common-origin"
                checked={commonOrigin}
                onChange={(e) => {
                  setCommonOrigin(e.target.checked);
                  // ⚑⚑ UNTICKING TAKES THE OFFER BACK. David: *"If you do not
                  // unclick the common origin BEFORE you get to that point, you
                  // have no way to revert it... That should revert when you
                  // unclick the box."* Without this the box was a decision you
                  // could only make in advance, and the only exit afterwards was
                  // `Reset calibration` - which throws the whole walk away, and
                  // is exactly the "way out that loses your work" this project
                  // has ruled against before.
                  // ⚑ Only what the OFFER placed: a pixel clicked by hand is
                  // never touched. See `withdrawReusedPixels`.
                  if (!e.target.checked) {
                    if (session.withdrawReusedPixels()) commit();
                  } else {
                    // ⚑⚑ TICKING IT ON THE STEP ITSELF ADOPTS THE PIXEL NOW.
                    // The walk does not step forward again on its own, so
                    // without this the tick was inert wherever the user had
                    // already arrived. Enforced by `ticking common origin while
                    // standing on the reusing step adopts the pixel`.
                    //
                    // ⚑⚑ AND IT MIRRORS THE UNTICK BRANCH: nothing is written
                    // unless something was actually adopted. Unconditional was
                    // wrong twice over - on a step where no pair applies it
                    // blanked the value box, so Confirm went silently inert
                    // (`confirmCalibrationValues` refuses a values array shorter
                    // than the step's fields), and it pushed a history entry for
                    // a document that had not changed, which cleared the redo
                    // branch and marked the project dirty from a checkbox.
                    // Enforced by `ticking common origin where nothing is shared
                    // leaves your typed value alone`.
                    const { adopted, filled } = adoptCommonOrigin(true);
                    if (adopted) {
                      setDataValueInputs(filled);
                      commit();
                    }
                  }
                }}
              />
              {/* ⚑ BUILT FROM THE PAIRINGS THE TYPE DECLARES, not written out
                  here: a heatmap shares BOTH corners of its plot box, so a
                  sentence naming only X1 & Y1 would be describing half of what
                  the checkbox does. The step LABELS are used, so a category
                  axis reads "First row" rather than "Y1". */}
              {(() => {
                const pairs = commonOriginPairs(config as never);
                const labelOf = (key: string) => steps.find((st) => st.key === key)?.label ?? key;
                const shared = pairs.map((p) => `${labelOf(p.from)} & ${labelOf(p.to)}`).join(', ');
                return pairs.length > 1
                  ? `Shared corners - ${shared} are the same points`
                  : `Common origin - ${shared} are the same point`;
              })()}
            </label>
          )}
          {/* ⚑⚑ STAGE 2, AND IT IS THE HEATMAP'S STAGE 2 (v2.3). David, with the
              two cards side by side: *"So it is a two stage fold out card,
              mirroring exactly heatmaps, and when we unfold from a calibrated
              state, then we show both card content at the same time, exact
              mirroring heatmaps."*

              ⚠️ WHAT STOOD HERE, 380 lines of it, and why none of it survives.
              The categorical stage was a FOLD-OUT INSIDE the card, with its own
              chevron-free toggle, its own bordered section, a teal `Mark
              categories` entry button, a prompt, a step line, a measured
              short-span note, a count box, a tick-style control in its own
              vocabulary, `Re-place axis`, `Remove ticks`, an ending at the
              bottom, and a `<details>` arguing the case for the feature. Beside
              the heatmap's stage 2 it read as a different feature by a different
              author - and it was, which is exactly the failure CLAUDE.md's own
              reuse rule names.

              ▶ Now: a SUMMARY LINE with the stage's ENDING beside it, then the
              stage's controls, gated on `cardModel.showsSecondStage`. Character
              for character the arrangement `heatmap-grid-panel` uses fifty lines
              below, because it is the same card. */}
          {gamePhase === null && categoryStage.supported && cardModel.showsSecondStageHeader && (
            <div
              data-testid="category-ticks-panel"
              style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: theme.color.text.secondary }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* ⚑ NO SECOND TRIANGLE. One card, one fold - and this line is
                    now plain text rather than a button, because there is nothing
                    left for it to open. */}
                <span data-testid="category-ticks-summary" style={{ color: theme.color.text.secondary }}>
                  {categoryStageSummary}
                </span>
                {/* ⚑⚑ THE ENDING, ON THE SUMMARY ROW, in exactly the place and
                    with exactly the gating `heatmap-read` has. It used to sit at
                    the END of an opened fold-out, which is the arrangement the
                    heatmap already had to abandon: everything on screen said
                    READY while the one action that finishes the job was inside a
                    closed fold-out inside a closed card. David: *"that is a UI
                    design fault."*
                    ⚑ DISABLED, NEVER ABSENT, with the reason on it - a greyed
                    control says "this is what comes next", a missing one says
                    nothing at all.
                    ⚑ And ONLY in the second stage: during stage 1 the ending is
                    "Calibrate", so gating on `ending !== null` alone would give
                    this button stage 1's word and stage 2's handler. */}
                {cardModel.ending !== null && cardModel.stage !== 'calibrating' && (
                  <button
                    type="button"
                    data-testid="category-read"
                    onClick={() => {
                      if (session.markCategories()) commit();
                      setCalibExpanded(false);
                    }}
                    disabled={!categoryStage.hasGeometry}
                    title={
                      categoryStage.hasGeometry
                        ? 'Accept these ticks as the figure\u2019s category boundaries and finish this step'
                        : // ⚑⚑ A REASON THAT NAMES AN ACTION THE SCREEN ACTUALLY OFFERS.
                          // The button only renders past stage 1, so "finish
                          // calibrating" is not the case here - a calibrated
                          // bar-family figure has its axis by construction, and
                          // the ONLY way to be here without one is a project
                          // saved before the category axis joined the walk.
                          // ⚑ The first draft said "calibrate the category axis
                          // first" - true, and describing nothing the user can
                          // do, because the walk is over. A message naming an
                          // action the interface does not offer is the
                          // keystone-persona failure this project keeps finding.
                          'This figure was calibrated before the category axis was part of the walk. Press Reset calibration to place it - the values will need re-reading.'
                    }
                    style={endsCardButton(categoryStage.hasGeometry)}
                  >
                    {cardModel.ending}
                  </button>
                )}
              </div>
              {/* ⚑⚑ THE STAGE'S CONTROLS FOLLOW THE STAGE; the row above only
                  NAMES it - the heatmap's rule, in the heatmap's own words.
                  While you are still calibrating, the stage is named and its
                  ending is disabled, and its controls wait. */}
              {cardModel.showsSecondStage && (
                <CategoriesCard
                  declared={categoryStage.declared ? categoryStage.count : null}
                  convention={categoryStage.convention}
                  onConventionChange={(c) => {
                    if (session.setCategoryTickConvention(c)) commit();
                  }}
                  regenerateWarning={categoryStage.regenerateWarning}
                  seriesInput={categorySeriesInput}
                  onSeriesInputChange={setCategorySeriesInput}
                  onReadLabels={() => {
                    setOcrError(null);
                    setOcrArmed((armed) => !armed);
                  }}
                  readingArmed={ocrArmed}
                />
              )}
            </div>
          )}
          {/* Per-axes calibration options (checkpoint 68) - log scales,
              orientations, units. WPD has always offered these; we hardcoded
              them to literals across 6 of 7 axes types, which the parity
              re-audit ranked its biggest finding (log axes, table stakes for
              scientific figures, were unreachable).

              ⚑ POST-CALIBRATION GATE REMOVED (checkpoint 86). This block used to
              carry `!axes`, so once you calibrated the options VANISHED - notice
              Y is log after tracing 200 points and the only way to say so was a
              destructive Reset that discards every point (a tenet-1 violation:
              the workflow trapped you). The engine always handled it
              (session.setOption re-calibrates live when `this.axes` exists); only
              the UI hid the control. Now it renders whenever the card is
              expanded, and the card AUTO-FOLDS on calibrate (see runCalibration),
              so the footprint stays a thin chip by default and the tall state is
              opt-in - which is what keeps this from bringing back ckpt 68's
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
              {(() => {
                // ⚑⚑ ONE ROW PER AXIS, WHERE THE TYPE ASKS FOR IT. A heatmap has
                // three axes and each has the same kind of properties, so the
                // card says so: the row IS the axis, and everything on it
                // belongs to that axis. Types that declare no `group` keep the
                // single flowing row they have today - nothing else moves.
                //
                // ⚑ Rendering is unchanged per control; only the arrangement is
                // read from the declaration. The grouping is a fact about the
                // FIGURE, so the type owns it.
                const shown = config.options!.filter(
                  (opt) => opt.onlyWhen === undefined || axesOptions[opt.onlyWhen] === 'true'
                );
                const groups = [...new Set(shown.map((o) => o.group).filter(Boolean))] as string[];
                if (groups.length === 0) return renderOptions(shown);
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
                    {groups.map((g) => {
                      // ⚑ A group is one or more LINES: `newRow` starts a new one.
                      // The first carries the axis name; the rest are indented by
                      // a spacer of the same width, so the continuation reads as
                      // belonging to the axis above it without repeating it.
                      const lines: AxesOption[][] = [];
                      for (const opt of shown.filter((o) => o.group === g)) {
                        if (opt.newRow || lines.length === 0) lines.push([opt]);
                        else lines[lines.length - 1]!.push(opt);
                      }
                      const slug = g.replace(/\s+/g, '-').toLowerCase();
                      return lines.map((line, i) => (
                        <div key={`${g}-${i}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                          <span
                            {...(i === 0 ? { 'data-testid': `axes-option-group-${slug}` } : {})}
                            style={{ minWidth: 74, fontWeight: i === 0 ? 600 : 400 }}
                          >
                            {i === 0 ? g : ''}
                          </span>
                          {renderOptions(line)}
                        </div>
                      ));
                    })}
                    {shown.some((o) => !o.group) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                        {renderOptions(shown.filter((o) => !o.group))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          {/* ⚑⚑ STAGE 2 COMES AFTER STAGE 1, because a review view should read
              in the order the work was done: calibrate the axes, then read what
              those axes make readable. It used to render ABOVE the axis options
              that belong to stage 1, so an unfolded card showed the second step
              before the first one's settings. */}
          {heatmapActive && cardModel.showsSecondStageHeader && (
            <div
              data-testid="heatmap-grid-panel"
              style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: theme.color.text.secondary }}
            >
              {/* ⚑⚑ THE ACTION TRAVELS WITH THE GRID, exactly as its provenance
                  does one block below. David, on the built 2.2.0: *"You now have
                  to know that to HAVE to open the 'lower part' of the calibration
                  card to be able to read the cells, even though everything looks
                  ready. That is a UI design fault."* The screen said `Calibrated
                  ✓`, `▶ Grid - 5 × 5 cells` and detection's own "5 columns,
                  matching the 4 boundaries found" - everything reads READY - and
                  the one action that finishes the job was inside a closed
                  fold-out inside a closed card.
                  ⚠️ AND THE "ENDING" FIX MADE IT WORSE: Read cells FOLDS the card
                  behind it, so the second read was buried too. Fixing "the flow
                  has no ending" created "the flow has no visible NEXT STEP", and
                  the fix has to keep both properties at once.
                  ⚑ SO: THE SAME ACTION, IN THE SAME WORDS, IN TWO PLACES - which
                  is this feature's own established answer to an undiscoverable
                  gesture, not a new one. `Reset to key` is already offered both
                  on the picked-cell line and in the right-click menu, in the same
                  words, because right-click alone could not be found. One handler,
                  one label, one style; the fold-out keeps its ending and the
                  header line carries the next step. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* ⚑⚑ NO SECOND TRIANGLE. The card has ONE fold - David's design: the
                  whole two-stage process folds to one row, and unfolding it shows
                  both stages at once. A nested fold-out meant the user had to open
                  two things to see what one card had recorded, and it is how the
                  bulk name boxes came to be hidden behind a fold nobody opened. */}
              <span
                data-testid="heatmap-grid-summary"
                style={{ color: theme.color.text.secondary }}
              >
                {heatmapGridSummary(heatmapShownGrid)}
              </span>
              {/* ⚑ Only once there IS a grid to read - the same gate the button
                  inside the fold-out uses, so the two cannot get out of step. */}
              {/* ⚠️ DISABLED, NEVER ABSENT, when there is no grid to read yet.
                  Gating this on `heatmapShownGrid` removed the button entirely
                  before detection had found anything - which is the very defect
                  this button exists to fix: the flow lost its visible next step
                  again, one state earlier. A greyed control says "this is what
                  comes next"; a missing one says nothing at all.
                  ⚑ Same semantics the button inside the fold-out had (it was
                  always rendered, `disabled={!canRead}`) - moving a control must
                  not quietly change when it exists. */}
                            {/* ⚑⚑ THE MODEL DECIDES WHETHER THERE IS ANYTHING TO END. A card
                  whose cells are already read offers no "Read cells" - the
                  ending belongs to the stage you are IN, and on a finished card
                  you are past it. Wired to `cardModel.ending` rather than to a
                  condition of its own, so the button and the model that governs
                  it cannot drift apart. */}
              {/* ⚑⚑ ONLY IN THE SECOND STAGE. Gating on `ending !== null` was
                  wrong and the screenshot said so: during stage 1 the ending is
                  "Calibrate", so this button borrowed stage 1's word AND kept
                  stage 2's handler - a control labelled for one step that
                  performed another. The stage is the gate; the ending is only
                  its label. */}
              {cardModel.ending !== null && cardModel.stage !== 'calibrating' && (
                <button
                  type="button"
                  data-testid="heatmap-read"
                  onClick={() => finishHeatmapGrid()}
                  disabled={!heatmapShownGrid}
                  title={
                    heatmapShownGrid
                      ? 'Read every cell through the colour key - the cells appear in the Cells panel'
                      : 'Detect the grid first, or overlay an even one - there are no cells to read yet'
                  }
                  style={endsCardButton(!!heatmapShownGrid)}
                >
                  {cardModel.ending}
                </button>
              )}
              </div>
              {/* ⚑⚑ WHERE THE GRID CAME FROM, BESIDE THE GRID - outside the
                  fold-out, because it is the answer to "did you measure this or
                  make it up?" and that question is live the moment a grid
                  appears. It sat INSIDE the fold-out, so a detected grid and an
                  overlaid one looked identical unless you went looking. Same
                  rule as drawing nothing until something is measured: the
                  provenance travels with the thing, or it is not provenance. */}
              {heatmapGridNote && (
                <span
                  data-testid="heatmap-detect-message"
                  style={{ fontSize: 12, color: theme.color.text.secondary, paddingLeft: 18 }}
                >
                  {heatmapGridNote.text}
                </span>
              )}
              {/* ⚑⚑ THE AXIS MOVED UNDER THE GRID - David's rule 4: *"should the
                  axis underneath it change so drastically that a new grid
                  detection needs to take place, then we should warn the user of
                  that, and ask for a new grid detection to take place, and not
                  make abstract models around it."*
                  ⚑ It states the FACT (the axes moved), the CONSEQUENCE (the
                  grid came with them, which is what a parametric store does) and
                  the ACTION - and deliberately does NOT claim to know whether
                  the grid still lines up. That judgement is the abstract model,
                  and only the person looking at the figure can make it.
                  ⚑ Outside the fold-out, beside the detect message, for the same
                  reason that one is: it describes the grid, and the user may
                  never open the card. */}
              {heatmapAxisHasMoved && (
                <span
                  data-testid="heatmap-axis-moved"
                  style={{ fontSize: 12, color: theme.color.text.secondary, paddingLeft: 18 }}
                >
                  The axes have moved since this grid was recorded, so the grid moved with them.
                  Detect the grid again if it no longer lines up with the figure.
                </span>
              )}
              {/* ⚑⚑ THE STAGE'S CONTROLS follow the STAGE; the row above only
                  NAMES it. While you are still calibrating the grid is named and
                  disabled - "this is what comes next" - and its controls wait.
                  Removing the name entirely is the defect this card already
                  fixed once: *"the flow lost its visible next step again."* */}
              {cardModel.showsSecondStage && (
              <HeatmapCard
                gridSize={
                  heatmapShownGrid
                    ? {
                        columns: Math.max(0, heatmapShownGrid.xDividers.length - 1),
                        rows: Math.max(0, heatmapShownGrid.yDividers.length - 1),
                      }
                    : null
                }
                onDetect={runHeatmapDetect}
                onOverlayEvenGrid={overlayEvenHeatmapGrid}
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
                regenerateWarning={heatmapRegenerateWarning(heatmapShownGrid)}
                declared={heatmapCounts()}
                xLabelCoverage={labelCoverage(heatmapLabels.x, Math.max(0, (heatmapShownGrid?.xDividers.length ?? 1) - 1))}
                yLabelCoverage={labelCoverage(heatmapLabels.y, Math.max(0, (heatmapShownGrid?.yDividers.length ?? 1) - 1))}
                error={heatmapError}
                canRead={session.isCalibrated()}
              />

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
            // Plot, categorical Line, Heatmap and Pie remain refused: none has
            // anything a colour trace could read as its own record (five
            // letter-values; an ordinal click; a cell whose value IS its colour;
            // a slice measured by its two edges). ⚑ Each says so ITSELF now, via
            // `autoExtractRefusal` -- this comment is description, not the gate.
            disabled={!axes || (config.autoExtractKind ?? 'curve') === 'none'}
            disabledReason={
              !axes
                ? 'Calibrate the axes first'
                : // The type says why it refuses -- see `autoExtractRefusal`. This
                  // was a `config.id === …` cascade in which a new type joined the
                  // contentless generic branch by default.
                  (config.autoExtractRefusal ?? 'Not available for this graph type')
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
                label={`Select - ${active.label}: ${active.hint}. Click for more modes; Del removes, arrows nudge.`}
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
            // ⚑ The TYPE says whether it can carry error, and says why when it
            // cannot - the same shape as `autoExtractRefusal` three buttons up,
            // and for the same reason: an id cascade lets a new type join the
            // default branch silently.
            disabled={config.errorBarsRefusal !== undefined || !datasetInfos.some((d) => d.pointCount > 0)}
            disabledReason={config.errorBarsRefusal ?? 'Add data points first'}
            onClick={toggleErrorBars}
            foldout
          />
          {/* Eraser (David 2026-07-22): a discoverable click-to-remove-a-point
              tool. UNNUMBERED -- it's destructive and Del already removes the
              selected point, so it stays out of the 0-9 run and reads apart. */}
          <IconButton
            testId="mode-eraser"
            icon={<EraseIcon />}
            label="Erase a point - click a point to remove it"
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
                    title={`${label} - ${hint}`}
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
              newColourForThisSeries={tracingANewColour}
              onTraceIntoNewSeries={traceIntoNewSeries}
              heldBackOffer={swatchHoldBackOffer(heldBackBars.length)}
              onAddHeldBackBars={addHeldBackBars}
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
                // ⚑ Stored by NAME - see `errorTargetName` (F39).
                setErrorTargetName(datasetInfos.find((d) => d.index === i)?.name ?? null);
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
          aidGlyphs={allAidGlyphs}
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
          challengeReveal={game.reveal}
          gridOverlay={heatmapOverlay}
          gridSelection={heatmapSelectionOutline}
          keyCursor={heatmapKeyCursor}
          keySpan={heatmapKeySpan}
          onKeyCursorDrag={previewKeyCursor}
          onKeyCursorDragEnd={commitKeyCursor}
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
          // ⚑ Only while the tool that produced them is open. The offer lives in
          // the Auto-extract card, so outlines drawn with that card shut would
          // point at something with nothing on screen to act on them.
          heldBackRects={
            mode === 'color-trace'
              ? heldBackBars.map((b) => ({
                  x: Math.min(b.start.x, b.end.x),
                  y: Math.min(b.start.y, b.end.y),
                  width: Math.abs(b.end.x - b.start.x),
                  height: Math.abs(b.end.y - b.start.y),
                }))
              : null
          }
          // Bar capture (v2.0): live whenever Add points is active on a plain Bar
          // series, except while the eyedropper is armed -- same exception
          // regionMode makes above, same reason (that click samples a colour).
          boxMode={
            // ⚑ Bar capture is a DRAG-BOX, so in boxMode a plain click is one
            // CORNER of a bar and never reaches onImageClick at all.
            // ⚑ The category-axis exception is GONE with the mode it guarded: the
            // fold-out used to hijack canvas clicks to place an axis edge, so box
            // capture had to stand down for exactly that moment. Both ends are
            // calibration steps now, and calibration clicks never reached this
            // path anyway.
            (mode === 'place-point' && !!config.capturesAsBox && eyedropper === null) ||
            // ⚑⚑ THE COLOUR KEY IS DRAGGED CORNER TO CORNER (v2.2), and it is the
            // SAME gesture as a bar's box for the same reason: two opposite
            // corners of a rectangle, with the rubber band showing what you have
            // while you have it. David: *"I would also like to add the ability to
            // click and drag to the other corner of the color key, with visual
            // feedback."* A plain click still works and places one corner, so the
            // two-click route is not taken away from anyone who prefers it.
            isDraggingKeyCorners
          }
          onBoxRect={isDraggingKeyCorners ? handleKeyCornerDrag : handleBoxRect}
          // ⚑ Reading category names (v2.4). Armed only from the Categories
          // card's own button - but `boxMode` above IS live at the same time on
          // a bar chart, so which one wins is settled by the routing order in
          // ImageCanvas's `endDrag`, where it cannot be got wrong by a caller.
          bandMode={ocrArmed}
          onBandRect={(r) => void readCategoryLabels(r)}
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
          // ⚑⚑ NOT WRAPPED, AND NOT AN INLINE ARROW (v2.3 re-audit). F6 wrapped
          // this and both halves of that were wrong. `openPdf` already wraps its
          // entire body in try/catch and reports its own sentence, so the
          // wrapper could never fire - and being an inline arrow it was a new
          // function identity on EVERY Workspace render, which invalidated
          // `loadImageFile` in ImageCanvas and made the window `paste` listener
          // unsubscribe and resubscribe on every render of a 9,000-line
          // component. A Ctrl+V dispatched in that gap is lost. That is exactly
          // the churn `feedback_live_and_stable_are_separate` was written about,
          // reintroduced by the commit that cited it.
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
            // ⚑⚑ ASKS WHETHER AN EDITOR WILL ACTUALLY RENDER, not merely what
            // kind of axes this is (F29). `axesKind === 'xy'` includes histogram
            // and heatmap, neither of which shows the value spreadsheet - so
            // this offered "Edit value…" on a histogram, set the edit state, and
            // nothing appeared. One function answers for the menu and for the
            // table, so they cannot disagree about which cells are editable.
            ...(editsValuesInTable(config.axesKind, config.outputPanel, hasSlots) &&
            dataPointRoles[ctxMenu.index] !== 'interpolated'
              ? [
                  <MenuItem
                    key="edit"
                    data-testid="ctx-edit-value"
                    onClick={() => {
                      const p = session.getDataPoints()[ctxMenu.index];
                      setActivePointIndex(ctxMenu.index);
                      if (p?.data)
                        setEditingCell({
                          index: ctxMenu.index,
                          axis: 0,
                          value: editSeed(p.data[0]!),
                          seed: editSeed(p.data[0]!),
                        });
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
          {/* ⚑⚑ B16 - WHICH INSTRUMENT READ THIS CELL. All three sources are
              MEASUREMENTS and they fail in opposite ways, so this is a choice of
              instrument, not a declared-versus-measured flag. Two entries today;
              OCR lands as a THIRD one in v2.3 rather than as a retrofit of some
              other mechanism.
              ⚑ The menu CHANGES the source - the cell already SHOWS it, tinted
              with the colour it was read from or bracketed where a person read
              it, so nothing here has to be discovered to know what is going on. */}
          {ctxMenu?.kind === 'heatmap-cell' && [
            <MenuItem
              key="key"
              data-testid="ctx-heatmap-use-key"
              // The current source is offered but not actionable: you cannot
              // change a reading to the one it already is.
              disabled={heatmapCellSourceAt(ctxMenu.col, ctxMenu.row) !== 'user'}
              onClick={() => {
                readCellFromKey(ctxMenu.col, ctxMenu.row);
                setCtxMenu(null);
              }}
            >
              Reset to key
            </MenuItem>,
            <MenuItem
              key="mine"
              data-testid="ctx-heatmap-use-mine"
              onClick={() => {
                const cell = heatmapCells.find(
                  (c) => c.col === ctxMenu.col && c.row === ctxMenu.row
                );
                // ⚑ SET, not `pickCells`. A plain pick TOGGLES - clicking the
                // one cell already picked clears it - which is right for a click
                // on the table and wrong here: the menu names this cell, so
                // choosing an entry from it can only ever mean "this one".
                setSelectedCells(new Set([cellKey(ctxMenu.col, ctxMenu.row)]));
                const seed = editSeed(cell?.value);
                setEditingHeatmapValue({ col: ctxMenu.col, row: ctxMenu.row, value: seed, seed });
                setCtxMenu(null);
              }}
            >
              {heatmapCellSourceAt(ctxMenu.col, ctxMenu.row) === 'user'
                ? 'Edit my value…'
                : 'Use my value…'}
            </MenuItem>,
          ]}
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
              ? 'Pipette armed - click a gridline on the image to sample its colour'
              : eyedropper === 'trace'
              ? 'Pipette armed - click the curve on the image to sample the colour to trace'
              : 'Pipette armed - click the series’ curve on the image to take its colour'}
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
        // ⚑ A heatmap's record is CELLS, not points - see the prop.
        // ⚑⚑ THE QUESTION IS "DOES THIS TYPE'S RECORD COUNT POINTS", not "is
        // this a heatmap". Written as the name check in v2.3 it fixed the one
        // type that had been looked at and left every other type whose datum is
        // not a point: the histogram read `Series 1 (20)` over TEN bins and bar
        // `Series 1 (30)` over FIFTEEN bars, because two corners make one
        // reading. Found re-shooting the website gallery.
        // ⚑ `getExportShape()` is the one thing that can answer it - the shape
        // is DYNAMIC (a Bar session carrying box-plot groups exports as tuples),
        // which is why its own doc says never to read the config field directly.
        showPointCount={session.getExportShape() === 'flat'}
        nameDraft={nameDraft}
        nameNotice={nameNotice}
        colorAnchor={colorAnchor}
        onColorAnchorChange={setColorAnchor}
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
          data-testid="calib-reuse-pixel"
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
              {/* ⚑ v2.0, 2026-07-30: the visible "Next: {slot} - {tuple} (N of M
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
              {/* Which ray is drawn as the live one - the axis the cursor fills. */}
              <span data-testid="calib-preview-emphasis" style={{ display: 'none' }}>
                {calibPreview.segments.findIndex((s) => s.emphasis)}
              </span>
            </p>
          )}
          {/* ⚑ Addressable, because WHERE a type's record renders is an
              invariant worth asserting: the rail redesign puts every type's
              output here, and v2.2's heatmap quietly put its cells in a card
              instead. A test can only check that if the panel can be named. */}
          <SidebarSection data-testid="data-points-panel">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <SidebarHeading data-testid="data-points-heading">
                  {isHistogram ? 'Bins' : heatmapActive ? 'Cells' : 'Data points'}
                </SidebarHeading>
                {/* Konva overlay isn't DOM-inspectable, so the number of connecting-
                    line runs is mirrored here for e2e coverage (checkpoint 131) --
                    same precedent as box-plot-glyph-count. >0 for a dense trace, 0
                    for a sparse/scatter series. */}
                {/* ⚑ The canvas outline is Konva and not DOM-inspectable, so the
                    picked cell is mirrored here for e2e - the same precedent as
                    series-line-runs and box-plot-glyph-count beside it. */}
                <span data-testid="heatmap-selected-cell" style={{ display: 'none' }}>
                  {selectedCell ? `${selectedCell.col},${selectedCell.row}` : ''}
                </span>
                {/* ⚑ How MANY are picked, which the single-cell readout above
                    cannot say: "which cell?" has no answer for a range. */}
                {/* ⚑ The key's cursor is Konva, so nothing else can assert it
                    exists or where it sits - the same precedent as
                    series-line-runs and calib-preview-segments beside it. Its
                    POSITION is what a test needs, because the handle sits
                    wherever the picked cell's own reading puts it. */}
                <span data-testid="heatmap-key-cursor" style={{ display: 'none' }}>
                  {heatmapKeyCursor ? heatmapKeyCursor.t.toFixed(4) : ''}
                </span>
                <span data-testid="heatmap-selected-count" style={{ display: 'none' }}>
                  {selectedCells.size > 1 ? `${selectedCells.size} cells` : ''}
                </span>
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
                    title="Reorder points into a continuous path (nearest-neighbour) - for scattered or out-of-order points"
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
                  with nothing on screen offering the rest - while the v2.0
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
          {config.outputPanel === 'heatmap' ? (
            /* ⚑ A heatmap's record goes where every other type's record goes.
               It first lived inside the Heatmap card, which left the panel a
               user actually looks at saying "No points yet" while the real
               output sat somewhere no other type puts one (David: "we DO want
               the output in the same place as for the other graphs… else it
               becomes very confusing for the users, and extremely
               inconsistent"). The card keeps the INPUTS. */
            <>
            {/* ⚑⚑ THE COUNT LIVES WITH THE RECORD, not with the card that made
                it. Read cells now FOLDS the Grid card, so a summary rendered
                inside it would be filed away in a closed fold-out at the exact
                moment it becomes true - and "20 cells read; 3 need a look" is
                the one line that says whether to trust any of these numbers. It
                is a statement about the OUTPUT, so it belongs where the output
                is: the same input/output split the rail redesign settled and
                this feature has now honoured three times.
                ⚑ The ERROR stays on the card, because a refusal must sit beside
                the button that produced it - and the card does not fold when
                the read fails. */}
            {heatmapSummary && (
              <p
                data-testid="heatmap-cells-summary"
                style={{
                  color: theme.color.text.secondary,
                  fontSize: theme.font.size.small,
                  margin: '0 0 4px',
                }}
              >
                {heatmapSummary}
              </p>
            )}
            {heatmapValueError && (
              <p
                data-testid="heatmap-value-error"
                style={{ color: theme.color.error, fontSize: theme.font.size.small, margin: '0 0 4px' }}
              >
                {heatmapValueError}
              </p>
            )}
            <HeatmapCellsTable
              cells={heatmapCells}
              noCellsHint={noPointsHint}
              renderXName={renderHeatmapXName}
              renderYName={renderHeatmapYName}
              selectedCell={selectedCell}
              selectedCells={selectedCells}
              onPickCells={pickCells}
              renderValue={renderHeatmapValue}
              onCellContextMenu={handleHeatmapCellContextMenu}
              dragTint={heatmapDragTint}
              onResetCell={readCellFromKey}
            />
            </>
          ) : config.outputPanel === 'bins' ? (
            <HistogramBinsTable
              rows={tupleRows}
              display={displayRounder}
              bins={histogramBins}
              tupleNoun={tupleNoun}
              onRemoveTuple={removeTuple}
              onSelectTuple={selectTuple}
              activeTupleIndex={activeTupleIndex}
              noPointsHint={noPointsHint}
              // ⚑ The SAME function the export asks, so the table and the file
              // cannot report different columns (F27) - and the BY-TUPLE
              // alignment, because a bins row IS a tuple (F41).
              error={errorColumnsByTuple(session, activeDatasetIndex).error}
            />
          ) : config.outputPanel === 'spider' && axes ? (
            <SpiderTable
              table={spiderTable}
              display={displayRounder}
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
              // ⚑ The empty state every other calibrated panel has. Spider was
              // the one without it (audit fleet, G9).
              noPointsHint={noPointsHint}
            />
          ) : config.outputPanel === 'bar' && axes ? (
            <BarTable
              table={barTable}
              display={displayRounder}
              activeSeriesIndex={activeDatasetIndex}
              tupleNoun={tupleNoun}
              onSelectSeries={handleSelectDataset}
              missingSlotIndexOf={(tupleIndex) => session.getDataset().getTuple(tupleIndex).indexOf(null)}
              onAimSlot={(tupleIndex, slotIndex) => {
                session.setSlotCursor(tupleIndex, slotIndex);
                bump();
              }}
              onRemoveTuple={removeTuple}
              onSelectTuple={selectTuple}
              onSelectTuples={selectTuplesIn}
              onRemoveTupleIn={removeTupleIn}
              activeTupleIndex={activeTupleIndex}
              renderCategoryName={renderEditableCategoryName}
              // ⚑ PER SERIES, from the SAME accessor the export asks - a bar
              // chart is the type that most often carries error bars, and this
              // was the panel that would not show them (F44).
              errorForSeries={(seriesIndex) => errorColumnsByTuple(session, seriesIndex).error}
              noPointsHint={noPointsHint}
            />
          ) : hasSlots ? (
            <TupleTable
              rows={tupleRows}
              display={displayRounder}
              slotNames={pointGroupNames}
              derivedColumn={derivedTupleColumn}
              // ⚑ A bar's two ends are `Min`/`Max` in the record; see the prop.
              {...(config.intervalSlots ? { intervalSlots: config.intervalSlots } : {})}
              tupleNoun={tupleNoun}
              onRemoveTuple={removeTuple}
              onSelectTuple={selectTuple}
              activeTupleIndex={activeTupleIndex}
              // ⚑ The SAME accessor the export asks, so a cap cannot be in the
              // file and missing from the panel (F43).
              error={errorColumnsByTuple(session, activeDatasetIndex).error}
              renderLabel={renderEditableTupleLabel}
              noPointsHint={noPointsHint}
            />
          ) : (
            <SpreadsheetTable
              series={spreadsheetSeries}
              maxRows={spreadsheetMaxRows}
              dataDim={config.dataDim}
              axesKind={config.axesKind}
              outputPanel={config.outputPanel}
              showCategoryColumn={showCategoryColumn}
              hasSlots={hasSlots}
              valueLabels={tableValueLabels}
              dateFormats={tableDateFormats}
              mode={mode}
              activePointIndex={activePointIndex}
              selectedPointIndices={selectedPointIndices}
              // ⚑ ROWS, not pixels: a datum's caps are pixels of its own series
              // now, so `dataPoints.length` counts them and would make rows past
              // the last datum selectable in Select mode.
              activeSeriesPointCount={spreadsheetSeries.find((s) => s.active)?.values.length ?? 0}
              onSelectPoint={(index, seriesIndex) => {
                // ⚑⚑ A2: THE CELL NAMES ITS SERIES, so switch to it before
                // selecting. Every operation the selection unlocks - the canvas
                // ring, arrow-nudge, Del, the trash button, the value editor -
                // addresses the ACTIVE series, so a selection whose series is
                // not active is a selection you cannot act on. Selecting the
                // cell you clicked and then acting on a different one is exactly
                // the defect (David: *"I have no way of knowing what is
                // happening when I think that I am selecting the original point
                // value"*).
                //
                // ⚑ It also hands back editing: `isCellEditable` allows only the
                // ACTIVE series' cells, so a non-active column was read-only and
                // there was no visible way to make it otherwise except the
                // dropdown. Clicking into a column is a plain statement of which
                // series you are working on, and the dropdown shows it happen.
                //
                // ⚑ `handleSelectDataset` clears the selection (it is per
                // series), so the order matters: switch first, then select.
                if (seriesIndex !== undefined && seriesIndex !== activeDatasetIndex) {
                  handleSelectDataset(seriesIndex);
                }
                setActivePointIndex(index);
                if (index !== null) setPickedPointIndex(index);
              }}
              onSelectMarquee={(indices, seriesIndex) => {
                // ⚑⚑ SWITCH FIRST, THEN SELECT - the same order and the same
                // reason as `onSelectPoint` above: `handleSelectDataset` clears
                // the selection, because a selection belongs to one series.
                if (seriesIndex !== undefined && seriesIndex !== activeDatasetIndex) {
                  handleSelectDataset(seriesIndex);
                }
                setSelectedPointIndices(indices);
              }}
              renderValue={renderEditableValue}
              // ⚑ The SAME `EditableName` Spider's axis, Bar's category and
              // Pie/Box Plot's label already use - one click selects the row, a
              // double click opens the editor (F28).
              renderCategoryName={renderEditablePointLabel}
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
          {/* ⚑⚑ THE KEY TO THE `[BRACKETS]` (v2.3, A4), for whichever table is
              showing - the heatmap's matrix, the spider's axes, the XY
              spreadsheet. ONE line, in one place, because it is one fact: this
              number did not come off the pixels.
              ⚑ HERE rather than inside each table, and that placement is the
              derived legend's own lesson above: an explanation that lives inside
              the scrolling table sits below the fold in real use while the marks
              it explains are on screen from the first row. It was learnt on a
              screenshot bench, and it applies to every legend, not to that one. */}
          <SuppliedLegend
            shown={
              heatmapCells.some((c) => suppliedBySource(c.source)) ||
              spiderTable.columns.some((c) => c.supplied.some(Boolean)) ||
              spreadsheetSeries.some((s) => s.supplied.some((dims) => dims.length > 0))
            }
          />
          {/* Wrong-axis notice (v1.4, Spider) - shown as the click happens, and
              deliberately NOT stored.

              ⚑ It has to be captured at click time because the point is SNAPPED
              onto its axis: afterwards the stored pixel is on its ray and there is
              no "off" left to measure. That snap is the right trade - once the dot
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
              {captureNotice.capturedOnLabel} axis and nearer {captureNotice.nearestLabel} - it was
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


      <GeometryCard
        enabled={geometryState !== null}
        result={geometryResult}
        error={geometryError}
        seriesName={activeInfo?.name ?? 'Series'}
        tableOpen={geometryTableOpen}
        onToggleTable={() => setGeometryTableOpen((v) => !v)}
      />
      </RightSidebar>

      {/* ⚑⚑ THE OFFER WINDOW (v2.4). Proposals live here and nowhere else until
          Apply, so the record only ever receives names a person has read and
          approved - see OcrReviewCard's header for why that answers the
          provenance question rather than deferring it. */}
      {ocrProposals && (
        <OcrReviewCard
          proposals={ocrProposals}
          currentNames={session.getCategoryAxis().getCategories()}
          busyIndex={ocrBusyIndex}
          onEditText={(categoryIndex, text) =>
            setOcrProposals((rows) =>
              rows ? rows.map((r) => (r.categoryIndex === categoryIndex ? { ...r, text } : r)) : rows
            )
          }
          onRotate={(categoryIndex) => void rotateProposal(categoryIndex)}
          onApply={applyOcrNames}
          onCancel={() => {
            setOcrProposals(null);
            setOcrError(null);
          }}
        />
      )}

      {/* Full-width status bar (checkpoint 47/50). Left: the one constant place
          for contextual guidance ("what do I do now?") -- calibration steps,
          mode hints, eyedropper/segment-fill prompts -- so the user always
          knows where to look. Right: zoom %, live view-state probe (kept for
          e2e), and calibrated status. */}
      <BottomBar>
        <span data-testid="tips-bar" style={{ display: 'flex', alignItems: 'center', gap: 6, color: theme.color.text.primary, minWidth: 0 }}>
          <span aria-hidden style={{ opacity: 0.7 }}>💡</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {/* ⚑⚑ THE GESTURE IS PROMPTED WHERE EVERY OTHER GESTURE IS (v2.4).
                Gate 4: a walkthrough may only click what a prompt on screen
                tells it to click, so arming the band read has to say what to
                drag and where. A refusal replaces it in the same place, because
                a refusal is about the gesture just made. */}
            {ocrError ?? (ocrArmed ? 'Drag a box round the row of category labels on the figure' : guidanceTip)}
          </span>
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
            ⚠ {activeInfo?.name ?? 'Series'} · geometry can’t recompute - {geometryError}
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
              This project holds {wpdFigures.length} calibrated figures on one image. Import one - you
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
      {game.phase && (
        <ChallengeOverlay
          phase={game.phase}
          roundIndex={game.roundIndex}
          roundCount={game.roundCount}
          instruction={game.instruction}
          roundStartMs={game.roundStartMs}
          lastScore={game.lastScore}
          totalAdjusted={game.totalAdjusted}
          highScores={game.highScores}
          qualifies={game.phase === 'results' && scoreQualifies(game.totalAdjusted, game.highScores)}
          onConfirmStart={game.begin}
          onCancel={game.finish}
          onDone={game.finishRound}
          onNext={game.nextRound}
          onSaveHighScore={game.saveHighScore}
          onFinish={game.finish}
        />
      )}
    </AppShell>
    </KeyTipsContext.Provider>
  );
}
