import type { AxesTypeConfig, CalibratedAxes } from './calibrationSession.js';
import type { ToolMode } from './toolMode.js';

/**
 * The two sentences that tell a first-run user what to do next: the tips bar
 * (`guidanceTip`) and the empty data table's hint (`noPointsHint`).
 *
 * ⚑ WHY THESE ARE HERE AND NOT IN JSX — the same reason `engine/captureProgress.ts`
 * gives at the top of its own file, but this pair has earned it harder. Every
 * defect these two branches have ever had was a CONTRADICTION between two
 * surfaces on screen at once — the tips bar saying "a plain click does nothing"
 * while the table said "click on the image to add data points"; the fallback
 * offering Auto-extract on a type whose rail button is permanently greyed; a
 * tip naming tool 9 after the rail was renumbered. Not one was catchable by any
 * instrument: no unit test could reach them, and the e2e asserts values and
 * counts, never prose. All of them were caught by David reading a screenshot.
 *
 * Pure string-building from a plain record, so the branches are unit-testable
 * and mutation-visible. `ui/` keeps the rendering; it no longer keeps the
 * decision.
 */

/** The subset of the graph type's config these sentences read. */
export type GuidanceConfig = Pick<AxesTypeConfig<CalibratedAxes>, 'id' | 'axesKind' | 'autoExtractKind'>;

/**
 * ⚑ Narrower than `ui/`'s own `MeasureToolId` ON PURPOSE, and the narrowing is
 * the drift alarm: `Workspace.tsx` passes a `MeasureToolId`, so adding a fifth
 * measure tool without teaching this file about it fails to compile at the call
 * site rather than silently falling through to the Area branch.
 */
export type GuidanceMeasureTool = 'distance' | 'angle' | 'area' | 'slope';

export interface GuidanceTipInput {
  canvasHasImage: boolean;
  /**
   * The category-ticks fold-out is waiting for an axis edge.
   *
   * ⚑ While it is, box capture STANDS DOWN and a click on the canvas becomes an
   * axis edge instead of a bar corner. Without this input the tips bar -- the
   * one constant place for contextual guidance -- went on telling the user to
   * "drag from one corner of the bar to the opposite corner", which was false in
   * both halves at that moment (v2.1 audit).
   */
  isMarkingCategoryAxis?: boolean;
  /** A heatmap has a grid on the figure, so its handles are there to be dragged.
   * ⚑ Without this the tips bar kept telling a calibrated heatmap user to go and
   * detect a grid they already had, while the gesture for adjusting it was
   * written only inside a fold-out that is closed by default. */
  heatmapHasGrid?: boolean;
  /**
   * The cells have been READ, so there are values on screen to correct.
   *
   * ⚑ The correction gesture must not be named before it exists. A tips bar
   * telling you to "type over a cell's value" while the table says "no cells
   * yet" is an invisible precondition — the failure the Parallel Universe David
   * test names outright — so the sentence changes when the state does.
   */
  heatmapHasCells?: boolean;
  /**
   * Exactly one cell is picked, so its CALIPER is on the colour key.
   *
   * ⚑⚑ THE NEWEST GESTURE AND THE LEAST GUESSABLE. Dragging a cell along the
   * colour key is how its value is set on the third axis — the exact twin of
   * sliding a data point along x or y — and nothing on screen said so. The tips
   * bar named typing, right-clicking and dragging a boundary, and stopped.
   *
   * ⚑ Conditional rather than appended, because the caliper only EXISTS while a
   * single cell is picked. Naming a gesture whose handle is not on screen is the
   * invisible-precondition failure one step removed, and it keeps the sentence
   * short enough to read.
   */
  heatmapCellPicked?: boolean;
  mode: ToolMode;
  figureCaptured: boolean;
  eyedropper: null | 'grid' | 'series' | 'trace';
  cropMode: boolean;
  /** A crop rectangle has been dragged (its geometry is not read here). */
  hasCropRect: boolean;
  /** A recorded measurement vertex is selected. */
  hasActiveMeasure: boolean;
  settingScale: boolean;
  /** Points placed toward the measurement in hand. */
  pendingMeasureCount: number;
  /** The two set-scale points are down and the real distance is awaited. */
  hasScaleDraft: boolean;
  measureError: string | null;
  measureTool: GuidanceMeasureTool | null;
  /** The measure scale's unit, or null when nothing has set one. */
  measureScaleUnit: string | null;
  /** The axes are built — `session.getAxes()` is non-null. */
  isCalibrated: boolean;
  config: GuidanceConfig;
  isCalibrating: boolean;
  /** A calibration pixel is down and its value is awaited. */
  hasPendingPixel: boolean;
  currentStep: { label: string; prompt: string } | null;
  /** How many values the current step asks for (plural agreement only). */
  pendingValueFieldCount: number;
  /** 0-based index of the calibration step in hand. */
  stepIndex: number;
  /** How many calibration steps this type has. */
  stepCount: number;
  selectedPointCount: number;
  dataPointCount: number;
  activePointIndex: number | null;
  /** The selected data point's role is 'anchor' (interpolate). */
  activePointIsAnchor: boolean;
  /** A calibration handle is selected. */
  hasActiveHandle: boolean;
  hasSlots: boolean;
  currentGroupLabel: string;
  currentTupleIndex: number | null;
  tupleNoun: string;
  /** `describeCaptureProgress(...).text` for this session. */
  captureProgressText: string | null;
}

/**
 * The tips bar sentence BEFORE the slot-aim suffix. Exported for its own tests;
 * `guidanceTip` is what `ui/` renders.
 */
export function guidanceTipBase(input: GuidanceTipInput): string {
  // Checked first: it overrides every capture message, because for as long as it
  // is true no click can capture anything.
  if (input.isMarkingCategoryAxis === true) {
    return 'Marking the category axis — your next click sets where the categories end. Close “Mark category ticks?” to go back to placing bars.';
  }
  const {
    canvasHasImage,
    heatmapHasGrid,
    heatmapHasCells,
    heatmapCellPicked,
    mode,
    figureCaptured,
    eyedropper,
    cropMode,
    hasCropRect,
    hasActiveMeasure,
    settingScale,
    pendingMeasureCount,
    hasScaleDraft,
    measureError,
    measureTool,
    measureScaleUnit,
    isCalibrated,
    config,
    isCalibrating,
    hasPendingPixel,
    currentStep,
    pendingValueFieldCount,
    stepIndex,
    stepCount,
    selectedPointCount,
    dataPointCount,
    activePointIndex,
    activePointIsAnchor,
    hasActiveHandle,
    hasSlots,
    currentGroupLabel,
    currentTupleIndex,
    tupleNoun,
  } = input;

  if (!canvasHasImage) return 'Open an image to begin — or drag-and-drop / paste one onto the canvas.';
  // Before capture, the only real actions are frame (pan/zoom) + Capture. Say
  // so, and state the WYSIWYG model so the framing is deliberate (David).
  if (mode === 'image-edit' && !figureCaptured) return 'Prep the source: rotate, flip, crop or fine-deskew — then press Capture to freeze the cleaned-up figure.';
  // ⚑ Said "(tool 9)" until the v1.3 gate -- 9 is Geometry; Edit image is 2. The
  // rail was renumbered in v1.0.2 and this line, the FIRST one every first-run
  // user reads, kept pointing at the old slot.
  if (!figureCaptured) return 'Frame the whole figure in the window (pan / zoom) — rotate / crop / deskew first if needed (tool 2) — then press Capture. What you see is what you capture.';
  if (eyedropper === 'grid') return 'Eyedropper: click a gridline on the image to sample its colour.';
  if (eyedropper === 'series') return 'Eyedropper: click the series’ curve on the image to take its colour.';
  if (mode === 'image-edit') {
    if (cropMode)
      return hasCropRect
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
    if (hasActiveMeasure && !settingScale && pendingMeasureCount === 0)
      return 'Measurement point selected — ↑ ↓ ← → nudge (Shift = coarse); the value updates live. Or click another point.';
    if (settingScale) {
      if (hasScaleDraft) return 'Set scale — type the real distance between the two points, then Set.';
      return pendingMeasureCount === 1
        ? 'Set scale — click the second point of a known distance.'
        : 'Set scale — click the first point of a known distance.';
    }
    if (measureError) return `⚠ ${measureError}`;
    if (measureTool === 'slope') {
      // ⚑ axesKind, not id. `handleMeasureClick` and the Measure card's own
      // reference both gate on axesKind, so on a calibrated HISTOGRAM the
      // slope tool works and the card agrees -- while this line told the
      // user to "calibrate an XY chart first". The file's own rule:
      // "Which AXES CLASS is this? -> axesKind, NEVER id." (Round-2 audit.)
      if (!isCalibrated || config.axesKind !== 'xy') return 'Slope — calibrate an XY chart first, then click two points on the line.';
      return pendingMeasureCount === 1
        ? 'Slope — click the second point on the line.'
        : 'Slope — click the first point on the line.';
    }
    if (measureTool === 'distance') {
      const where = measureScaleUnit ?? 'pixels — use Set scale for real units';
      return pendingMeasureCount === 1
        ? `Distance — click the second point (measuring in ${where}).`
        : `Distance — click the first point (measuring in ${where}).`;
    }
    if (measureTool === 'angle') {
      return pendingMeasureCount === 0
        ? 'Angle — click the vertex.'
        : pendingMeasureCount === 1
          ? 'Angle — click the first arm.'
          : 'Angle — click the second arm.';
    }
    // area
    return pendingMeasureCount < 3
      ? `Area — click polygon corners (${pendingMeasureCount} placed; need 3+).`
      : `Area — keep clicking corners, then Finish (or Enter) to close (${pendingMeasureCount} placed).`;
  }
  if (isCalibrating) {
    if (hasPendingPixel) {
      return `Enter the ${currentStep!.label} value${pendingValueFieldCount > 1 ? 's' : ''}, then press Confirm.`;
    }
    return `Calibration step ${stepIndex + 1}/${stepCount} — ${currentStep!.label}: ${currentStep!.prompt}`;
  }
  if (isCalibrated) {
    if (mode === 'select') {
      if (selectedPointCount > 0)
        return `${selectedPointCount} point${selectedPointCount > 1 ? 's' : ''} selected — Del removes them, ↑ ↓ ← → nudge (Shift = coarse), Esc clears. Shift-click adds one.`;
      // No points to select yet -- point the user at Add rather than inviting a
      // click on an empty canvas (the post-calibration default is Add, so this is
      // only reached by choosing Select first).
      if (dataPointCount === 0) return 'No points yet — switch to Add points (3) to place some, then come back to Select.';
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
      // ⚑ v2.0: Bar's own message, checked BEFORE the generic hasSlots branch below
      // (Bar now always has slots, so the generic line would otherwise catch it
      // first and say nothing about the drag or why both ends are measured).
      // Both ends of a bar are real, independently measured pixels -- never a
      // click-anywhere-on-the-value-axis reading (the v1.3 midpoint error this
      // wording once guarded against, 59f94a6), and never an assumed baseline --
      // so the SAME gesture and the SAME wording cover an ordinary zero-based bar
      // and a floating/offset one (a tornado chart, a temperature range) alike.
      if (config.id === 'bar' && hasSlots)
        return `Drag from one corner of the bar to the opposite corner — both ends are measured, so this reads a bar that floats above or below its baseline just as well as an ordinary one${currentTupleIndex === null ? ` (starting a new ${tupleNoun})` : ` (${tupleNoun} ${currentTupleIndex + 1}, filling ${currentGroupLabel})`}. A single click still works too, filling one end at a time.`;
      if (hasSlots)
        return `Click to add a point — filling ${currentGroupLabel}${currentTupleIndex === null ? ` (new ${tupleNoun})` : ` (${tupleNoun} ${currentTupleIndex + 1})`}.`;
      // ⚑ Categorical Line is the one bar-family type that stays a plain point per
      // click (v1.3 gate wording, kept): its X is an ordinal position, not an
      // interval, so there is no second end to drag.
      if (config.id === 'categorical')
        return 'Click each category’s marker in turn — where you click on the value axis IS the number recorded.';
      // ⚑ A HEATMAP IS NOT CAPTURED BY CLICKING THE FIGURE, so the default
      // invitation is worse than unhelpful here: a user who follows it drops
      // stray points on the image and concludes nothing is working. Its cells
      // come from a GRID, which is the Heatmap card's job. Same contradiction
      // class as the three already recorded in `noPointsHint` below — two
      // things on screen telling the reader opposite stories — reached at a
      // fourth site, and caught by looking at a screenshot of the finished
      // feature rather than by any test.
      if (config.id === 'heatmap')
        return heatmapHasCells === true
          ? // ⚑⚑ THE WAY BACK IS THE PART THAT NEEDS SAYING. Typing over a value
            // is discoverable — every editable number in this app carries the
            // same dashed underline — but the right-click that hands the cell
            // back to the key is not, and a correction you cannot undo except
            // through Ctrl+Z is a one-way door. This is the app's one constant
            // place for "what do I do now?", so it is where the pair belongs.
            // ⚑⚑ AND WHEN A CELL IS PICKED, ITS CALIPER IS ON THE KEY. That is
            // the third axis's own drag handle — the twin of sliding a point
            // along x or y — and it was the one gesture the bar never named.
            (heatmapCellPicked === true
              ? 'Drag the picked cell’s marker along the colour key to set its value, or type over the value itself; right-click it to go back to the key’s number.'
              : 'Type over a cell’s value to record what you can see; right-click it to go back to the key’s number. Drag a handle beside the figure to move a boundary.')
          : heatmapHasGrid === true
          ? // ⚑⚑ THE GESTURE, SAID WHERE IT IS ALWAYS VISIBLE. The handles beside
            // the figure are draggable in every mode, but nothing on screen said
            // so once the grid fold-down was closed — David: *"you need to know
            // that you can select a point via the point selector, and then move
            // one. Not obvious when you are setting the grids up."* The tips bar
            // is this app's one constant place for "what do I do now?", so the
            // answer belongs here rather than inside a panel you have to open.
            // ⚑⚑ NAME THE ACTION THAT FINISHES THE JOB, FIRST. This sentence
            // told the user how to ADJUST the grid and never mentioned Read
            // cells — so with `Calibrated ✓`, a grid drawn on the figure and a
            // detection report all saying READY, the app's one constant place
            // for "what do I do now?" answered with a side quest. David called
            // the buried button a UI design fault; the tip was the half of it
            // that cost nothing to fix.
            'Press Read cells to record every cell through the colour key. Drag a handle beside the figure to move a boundary, or click a cell to inspect it.'
          : 'Use the Heatmap card to detect the grid and read the cells — a heatmap’s values come from its grid, not from clicking the figure.';
      return 'Click anywhere on the image to add a data point. Hold Space or drag the middle button to pan; scroll to zoom.';
    }
    if (mode === 'calibrate') {
      if (hasActiveHandle)
        return 'Handle selected — ↑ ↓ ← → nudge (Shift = coarse); recalibrates live. Or drag it.';
      return 'Drag a calibration handle to adjust it (or click one, then ↑ ↓ ← → to nudge), or switch to Place Point to add data.';
    }
    if (mode === 'segment-fill') return 'Flood-fill — click a solid, unbroken curve to trace it automatically.';
    // By-colour traces via the Trace button, not a canvas click (v0.8 audit #2:
    // without this the tip fell through to "calibrate the axes" on an already-
    // calibrated chart, and gave no hint that a stray click does nothing).
    // ⚑ On a spider or a bar it does a different job, and the tip has to say so.
    // Spider reads ALONG the calibrated rays, one value per axis, and leaves an
    // axis empty where the evidence is doubtful. Bar (v2.0 Phase 7) reads each
    // detected blob's own BOUNDING BOX -- both ends measured, never a midpoint.
    // Without this, "Trace" reads as the curve tool it is everywhere else, and
    // an axis coming back empty (spider) looks like a bug rather than a refusal.
    if (mode === 'color-trace') {
      if (config.autoExtractKind === 'along-axes')
        return 'By colour — pick the series’ colour (or take it from the image with the pipette), set the tolerance, then press Trace: it reads one value per axis, where the colour crosses each ray. An axis it can’t read is left for you to place.';
      if (config.autoExtractKind === 'bounding-box')
        return `By colour — pick a ${tupleNoun} colour (or take it from the image with the pipette), set the tolerance, then press Trace: it finds every ${tupleNoun} of that colour and records its own bounding box. Drag a box on the image to limit the trace to it; a plain click does nothing.`;
      return 'By colour — pick the series’ colour (or take it from the image with the pipette), set the tolerance, then press Trace. Drag a box on the image to limit the trace to it; a plain click does nothing.';
    }
    if (mode === 'interpolate') {
      if (dataPointCount === 0)
        return 'Interpolate — click a few guide points along one curve; the curve fills in between them.';
      // `activePointIsAnchor` already carries "a point is selected AND its role
      // is anchor" -- re-testing activePointIndex here would be a second copy of
      // the same condition, and one that cannot disagree with it.
      if (activePointIsAnchor)
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
      if (dataPointCount === 0)
        return 'Error bars — place the data points first (tool 3), then drag from a point out to its cap.';
      return 'Error bars — drag from a data point out to its error cap; a cap is placed on each side, the lower one mirrored as a starting position. To move a cap, pick its series under Recorded, then drag the cap.';
    }
    if (mode === 'pan') return 'Pan and zoom only — pick a tool from the left rail to edit.';
  }
  return 'Pick a graph type, then calibrate the axes to begin.';
}

/**
 * The tips bar sentence as rendered — the branch above, plus the capture
 * cursor's slot when that adds information.
 *
 * ⚑ v2.0, 2026-07-30: the sidebar used to carry a SECOND line for this
 * (engine/captureProgress.ts's "Next: {slot} — {tuple} (N of M filled)"),
 * split off from the tips bar in v1.6 specifically because it duplicated
 * it. David, seeing it again on Pie: "Hint should be in the hint bar, not
 * in other places" -- one location, full stop. Folded back in here rather
 * than deleted outright, because it is NOT always a strict duplicate: in
 * Eraser/Select/Pan/etc. the tips bar's own branch says nothing about
 * which slot the capture cursor is aimed at, so that visibility would be
 * lost entirely without this. `base.includes(currentGroupLabel)`
 * is the cheap, robust way to detect "did this branch already say it" --
 * true exactly when mode is place-point with nothing selected (the one
 * branch that interpolates ${currentGroupLabel} into its own sentence),
 * false everywhere else, so the note appears only where it adds
 * information instead of restating the sentence above it. `isCalibrated &&` keeps
 * it off entirely before calibration finishes -- Bar's slots exist (and
 * captureProgress.text is non-null) from the moment the type is picked,
 * so without this guard "Calibration step 1/2 — P1: ..." grew a bogus
 * "— Bar start — new bar (0 of 2 filled)" tacked onto it, caught via a
 * debug script while chasing the Bar e2e timeouts.
 */
export function guidanceTip(input: GuidanceTipInput): string {
  const base = guidanceTipBase(input);
  const slotAimNote =
    input.isCalibrated && input.hasSlots && input.captureProgressText && !base.includes(input.currentGroupLabel)
      ? ` — ${input.captureProgressText.replace(/^Next: /, '')}`
      : '';
  return base + slotAimNote;
}

/**
 * The empty data table's hint, matched to the ACTIVE TOOL.
 *
 * ⚑ It used to say "click on the image to add data points" unconditionally --
 * which directly CONTRADICTED the tips bar in the auto-extract modes, where a
 * plain canvas click is deliberately inert ("a plain click does nothing").
 * Both lines were on screen at once telling the reader opposite things, so
 * following the panel meant clicking the curve repeatedly and concluding the
 * app was broken: the same "I clicked and nothing happened" failure as the
 * card-swallowing-clicks bug, reached by a different route. Caught on David's
 * screenshot test bench while shooting the By-colour gallery image.
 */
export function noPointsHint({ mode, config }: { mode: ToolMode; config: GuidanceConfig }): string {
  // ⚑ Before every mode branch, because it is true in all of them: a heatmap's
  // cells are never placed by hand, so no tool on the rail is the answer and
  // naming one would be the contradiction this function exists to prevent.
  if (config.id === 'heatmap')
    return 'No points yet — a heatmap is read from its grid: use the Heatmap card to detect the grid, then Read cells.';
  if (mode === 'color-trace')
    return 'No points yet — pick the series’ colour, then press Trace. A plain click on the image does nothing here.';
  if (mode === 'segment-fill') return 'No points yet — click the curve on the image to flood-fill it.';
  if (mode === 'interpolate') return 'No points yet — click a few guide points along one curve.';
  // ⚑⚑ A CATEGORICAL LINE HAS NO BARS. It is `axesKind: 'bar'` because it shares
  // BarAxes' calibration — two points on the value axis — and nothing else, so
  // the bar branch below caught it and told a chart of five markers to *"click
  // the end of each bar"*. Seen on the built app while driving the v2.3 Line
  // fix; this function's own header is entirely about hints that name a gesture
  // the type does not have, and this is a fourth instance of it.
  //
  // ⚑ The wording MIRRORS the tips bar, which already had it right for this type
  // (*"Click each category's marker in turn"*). Two sentences describing one
  // gesture must not describe it differently.
  if (config.id === 'categorical')
    return mode === 'place-point'
      ? 'No points yet — click each category’s marker in turn to record its value.'
      : 'No points yet — pick Add points (3) from the tool rail and click each category’s marker.';
  if (mode === 'place-point')
    return config.id === 'bar'
      ? 'No points yet — drag from one corner of a bar to the opposite corner (or click twice) to record it.'
      : config.axesKind === 'bar'
        ? 'No points yet — click the end of each bar to record its value.'
        : 'No points yet — click on the image to add data points.';
  // Pan / Select / Eraser / Measure / Image-edit / Error-bars: a canvas click
  // adds nothing in any of them, so point at the tools that DO capture.
  //
  // ⚑ Auto-extract is permanently greyed for Box Plot/categorical Line
  // (59f94a6), so naming it here put two panels on screen recommending what
  // the other refuses -- a FOURTH instance of the contradiction class this
  // hint was written to kill. Found by the v1.3 gate; reachable with zero
  // points via Select/Pan/Measure/Error-bars/Edit-image on a calibrated
  // chart of either type. Bar itself is the exception (v2.0 Phase 7): its
  // own Auto-extract now finds bars by colour correctly, so this hint
  // names it again for Bar specifically, same as the generic fallback does.
  if (config.id === 'bar') return 'No points yet — drag each bar corner to corner (Add points, 3), or pick Auto-extract (4) to find bars by colour.';
  if (config.axesKind === 'bar') return 'No points yet — pick Add points (3) from the tool rail and click the end of each bar.';
  // ⚑ Only offer Auto-extract where the type HAS it. Pie declares
  // autoExtractKind 'none', so its rail button is disabled and hotkey 4 is a
  // no-op -- and this fallback still told a pie user to pick it. That is the
  // exact contradiction the branch above was written to kill, at a new site.
  // (Round-2 audit.)
  return config.autoExtractKind === 'none'
    ? 'No points yet — pick Add points (3) from the tool rail.'
    : 'No points yet — pick Add points (3) or Auto-extract (4) from the tool rail.';
}
