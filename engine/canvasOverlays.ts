import { polylineRuns, runCoverage } from './seriesLine.js';
import type { CalibStepInfo } from './axesTypeConfigs.js';
import type { PlacedCalibPoint, PointRole } from './calibrationSession.js';
import type { CapHandle } from './calibrationSession.js';

/**
 * WHAT the canvas draws, decided here; HOW it is drawn stays in `ui/ImageCanvas.tsx`.
 *
 * ⚑ WHY THIS MOVED OUT OF `Workspace.tsx` (v2.1, the Workspace split). These
 * memos hold the app's HIT-TESTING rules - which markers Konva may drag, which
 * must leave its hit graph entirely so a press reaches the stage beneath. That
 * is the single most defect-prone region in the project and the one no
 * instrument could reach:
 *
 * - v1.3: a one-day-old `ImageCanvas.tsx` fix took every error cap out of Konva's
 *   hit graph while the e2e stayed green, because it asserted the cap COUNT,
 *   which held either way.
 * - v2.0.1: the datum a cap hangs off was hauled along by the same press that
 *   recorded the cap - silent, and it corrupts a point already placed correctly.
 * - The pie ring's closing click was the one click the figure ignored, because a
 *   draggable marker sits exactly where that click must land and takes the press.
 *
 * Every one of those is a decision about a BOOLEAN on a marker, reachable only
 * through an Electron launch until now. Pure functions over plain records, so
 * the booleans are unit-testable and mutation-visible.
 */

export interface CanvasMarker {
  /** Stable identity passed back to onMarkerDragEnd - not a React key concern. */
  id: string;
  x: number;
  y: number;
  label: string;
  color: string;
  draggable?: boolean;
  /** The selected/"active" data point (checkpoint 58) - drawn with a highlight
   * ring so it stands out on the canvas as the one the trash button will delete. */
  selected?: boolean;
  /**
   * A calibration handle renders as a crosshair reticle rather than a filled
   * dot (checkpoint 59), so axis references read as distinct from data points.
   *
   * ⚑⚑ AND AN `aid` IS NEITHER. A category tick or a heatmap grid boundary is an
   * ADJUSTABLE AID - a divider you are expected to drag until it sits on the
   * figure's own rule - while the reticle was chosen to say "precise reference".
   * Drawing both the same way told the user that a boundary they had nudged by
   * eye carried the authority of a calibration point, and that the calibration
   * point could be dragged as casually as a divider. Both halves are wrong, and
   * it is the TWO-LAYER MODEL made visible: calibration points ARE the axis, the
   * grid DERIVES from them.
   *
   * ⚑ A square, not a smaller circle: a data dot is round and a reticle is
   * round, so roundness is already spoken for. Square reads as a grip, and the
   * difference survives being 4px across.
   */
  /**
   * ⚑⚑ AND A `cap` IS DRAWN BY THE WHISKER, NOT BY THE MARKER LAYER. An error
   * cap's only visible form is the tick at its whisker's end (B1) - this marker
   * exists to be GRABBED, and the renderer gives it a hit area and no fill.
   *
   * ⚑ No new shape had to be invented for it, which was worth checking: round
   * is a data dot and a reticle, square is an `aid`. A cap is neither, and
   * `computeWhiskerGlyph` has always drawn a perpendicular TICK there - the same
   * mark matplotlib's `capsize` draws. The figure's own convention was already
   * in the code.
   */
  kind?: 'calibration' | 'data' | 'aid' | 'cap';
  /**
   * A point in IMAGE coordinates to push this marker's label AWAY from.
   *
   * ⚑ Every label is otherwise drawn up-and-to-the-right at a fixed offset, which is
   * fine on a scatter and wrong on anything radial: a pie's outline handles and its
   * boundary points all sit ON the rim, so their labels all lean the same way and land
   * on each other, on the slice percentages, and on the figure's own category names
   * ("Outline 2" over "PBS" -- David, by screenshot). Given the fitted centre, each
   * label instead leans outward into the white space that is always there, because the
   * rim is by definition the edge of the ink.
   *
   * Purely presentational: it moves TEXT, never the marker, so nothing measured moves.
   */
  labelAway?: { x: number; y: number };
  /**
   * Hang the label BELOW this marker instead of above it.
   *
   * ⚑ The other half of the same problem `labelAway` solves, for a line rather
   * than a rim: a heatmap's four colour-key handles sit along one horizontal
   * strip, so a fixed up-and-right offset prints them on top of each other.
   * Which steps stagger is declared by the axes config, not decided here - only
   * the config knows its own crowding. Presentational: it moves TEXT, never the
   * marker.
   */
  labelBelow?: boolean;
  /** Override the data-dot radius (checkpoint 120): interpolation-assist draws
   * anchors big and derived samples small. Defaults to 5. */
  radius?: number;
  /**
   * The line this marker's drag is confined to, in IMAGE space - an error cap's
   * value axis.
   *
   * ⚑⚑ SO THE GESTURE IS BOUND TO ITS CONSTRAINT ON SCREEN, not only in the
   * record. The model already puts a cap back on its axis on release; without
   * this the drag visibly leans out and snaps back, which teaches the user that
   * a diagonal error bar is a thing they might get. Pattern 4, and the same
   * `dragBoundFunc` projection the colour key's handle already uses.
   *
   * Absent where the axes cannot say which way its value runs, where a free cap
   * is the documented default.
   */
  dragLine?: { origin: { x: number; y: number }; direction: { x: number; y: number } };
}

/** A series drawn as connected polyline(s) under its markers (checkpoint 131) --
 * so a dense traced curve reads as a clean line instead of a furry band of
 * overlapping dots. Image-pixel space, converted at render. `runs` is a list of
 * contiguous point-runs (broken where consecutive points are far apart), so a
 * curve with a genuine gap doesn't get a spurious segment bridged across it; a
 * scatter produces no runs and stays dots. Non-interactive, drawn beneath the
 * markers. See `buildSeriesLines` for how the runs are formed. */
export interface SeriesLine {
  color: string;
  runs: { x: number; y: number }[][];
}

/**
 * What the overlay needs from a series: identity, colour, and PIXELS.
 *
 * ⚑ Deliberately narrower than `DatasetPointsView`, which also carries each
 * point's `data` - the calibrated VALUES. Nothing drawn on the canvas depends on
 * what a point means, only on where it sits, and saying so in the type is what
 * keeps it that way. `DatasetPointsView` satisfies this structurally, so callers
 * pass it unchanged.
 */
export interface OverlaySeries {
  index: number;
  color: readonly [number, number, number];
  active: boolean;
  points: readonly { px: number; py: number }[];
  /**
   * Each point's interpolation role, positionally - the same parallel-array
   * shape `dataPointRoles` already uses for the active series, so the two paths
   * read the record the same way rather than each inventing an access pattern.
   *
   * ⚑ It is a DRAWING concern, which is why it belongs on a type whose header
   * says nothing here depends on what a point MEANS: an anchor and the sample
   * derived between two anchors are different KINDS of mark, and were drawn
   * identically on every series but the one in front of you.
   */
  roles?: readonly (string | null | undefined)[];
}

/** What the overlay needs from the series list: which one is active, and its colour. */
export interface OverlaySeriesInfo {
  active: boolean;
  color: readonly [number, number, number];
}

/** The radius a plain dense series' one visible (selected) dot is drawn at. */
export const SELECTED_DOT_RADIUS = 3.5;

/**
 * How big a data dot is drawn - ONE rule, and every series obeys it.
 *
 * ⚑⚑ IT EXISTS BECAUSE THERE WERE TWO. The active path chose deliberately while
 * the inactive push carried no `radius` at all, so the same interpolated sample
 * was 2.5 on the series you were working on and ImageCanvas's default 5 on every
 * other one - the series you are NOT looking at drawn twice as heavy as the one
 * you are, covering the ink the trace has to be checked against. A size rule
 * that lives in one place cannot disagree with itself.
 *
 * Returns a SPREADABLE object, absent-not-undefined: an ordinary dot has no key
 * at all, so ImageCanvas's default applies (exactOptionalPropertyTypes, the same
 * convention `labelAway` follows).
 */
export function dotRadius(
  role: string | null | undefined,
  plainDense: boolean
): { radius?: number } {
  if (role === 'anchor') return { radius: 6.5 };
  if (role === 'interpolated') return { radius: 2.5 };
  if (plainDense) return { radius: SELECTED_DOT_RADIUS };
  return {};
}

/** Split a series into contiguous runs - the "is this dense enough to draw as a
 * line?" question. No runs means a scatter, which stays dots. */
export function runsForPoints(pts: readonly { px: number; py: number }[]): { x: number; y: number }[][] {
  return polylineRuns(pts.map((p) => ({ x: p.px, y: p.py })));
}

/**
 * The marker id of a data point (or one of its error caps) by pixel index.
 *
 * ⚑ Exported because the WHISKER now names the marker its cap is, so the
 * renderer can redraw it from a live drag position. Two places building the
 * same string by hand is how they drift - and a whisker naming a marker that
 * does not exist would fail silently, as "the cap simply does not follow".
 */
export function dataPointMarkerId(pixelIndex: number): string {
  return `point-${pixelIndex}`;
}

/**
 * What a placed calibration handle says about itself.
 *
 * ⚑⚑ A DECLARED COUNT IS NOT A COORDINATE, and this used to print it as one. A
 * heatmap's second corner collects the X value AND how many COLUMNS the figure
 * has, so the handle read `Cn × R1=24, 5` - which is exactly the shape of a
 * coordinate pair, and on a figure whose other axis is numeric a reader takes it
 * as x=24, y=5. On a CATEGORY axis it was starker: that corner collects only the
 * count, so the label read `C1 × Rn=5`, a bare number presented as the place the
 * corner sits.
 *
 * ⚑ `dz` IS THE TELL, and its own docs say so: *"a slot, not a Z axis"* - spider
 * puts an axis NAME in it, a heatmap puts a band COUNT. Neither is a position,
 * so neither belongs on a mark whose whole job is to say where a point is. The
 * count is not lost: it is declared in the calibration card, next to the field
 * the user typed it into.
 *
 * ⚑ Spider keeps its VALUE-ALONE form for the reason recorded when it was made:
 * six handles each repeating an axis name the figure already prints buried the
 * one thing the handle asserts.
 *
 * ⚠️ Caught by David driving the built app. No test could have seen it - the
 * label is a string nobody was asserting on, which is why the cases above are
 * now pinned by name.
 */
function markerLabel(step: CalibStepInfo, values: readonly string[], axesKind: string): string {
  if (axesKind === 'spider' && values.length > 0) return String(values[0]);
  const coordinates = values.filter((_v, i) => step.valueFields[i]?.field !== 'dz');
  return coordinates.length > 0 ? `${step.label}=${coordinates.join(', ')}` : step.label;
}

function rgb(c: readonly [number, number, number]): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * The point every label on a RADIAL figure should lean away from.
 *
 * A pie's outline handles and its sector boundaries all sit on the rim, and a
 * spider's readings all sit on rays out of the origin -- so with the historical
 * fixed up-and-right offset every label leans the same way, into the ink, and
 * lands on the neighbouring marker's label and on the figure's own text
 * ("Outline 2" over "PBS"). Pushed outward instead, they fan into the white
 * space that is guaranteed to be there, because the rim IS the edge of the
 * drawing.
 *
 * Only where a real centre exists. There is no honest one on an XY plot -- the
 * middle of the axes is not a place labels should flee -- so those keep the
 * fixed offset they have always had.
 *
 * ⚑ Structurally typed rather than taking `CalibratedAxes`: the question is
 * "does this figure have a centre to lean away from", and only PieAxes and
 * SpiderAxes can answer it. Naming the methods is both narrower and honester
 * than the `as unknown as` cast this replaced.
 */
export function radialLabelCentre(axesKind: string, axes: object | null): { x: number; y: number } | undefined {
  if (!axes) return undefined;
  if (axesKind === 'pie') return callPoint(axes, 'getCentre');
  if (axesKind === 'spider') return callPoint(axes, 'getOrigin');
  return undefined;
}

/** Checked, not assumed. Only PieAxes and SpiderAxes carry these methods; asking
 * the object itself is what makes the `as unknown as { getCentre() }` cast this
 * replaced unnecessary, and it cannot throw on a class that has neither. */
function callPoint(axes: object, method: string): { x: number; y: number } | undefined {
  const fn = (axes as Record<string, unknown>)[method];
  return typeof fn === 'function' ? (fn.call(axes) as { x: number; y: number }) : undefined;
}

export interface CanvasMarkerInput {
  /** Calibration steps, in order; a placed one draws a reticle. */
  steps: readonly CalibStepInfo[];
  placedPoints: Readonly<Record<string, PlacedCalibPoint>>;
  /** A calibration pixel awaiting its typed value, drawn as "?". */
  pendingPixel: { px: number; py: number } | null;
  pendingPixelColor: string;
  dataPoints: readonly { px: number; py: number }[];
  dataPointRoles: readonly (PointRole | null)[];
  /** Per ACTIVE-series pixel: the cap it is (role + its drag line), or null for
   * a data point.
   * ⚑ B4 - a datum's caps are pixels of its own series now, so the marker layer
   * has to be able to tell them apart from the readings they belong to.
   * Optional, so every type that has no error passes nothing and behaves
   * exactly as before. */
  capRoles?: readonly (CapHandle | null)[];
  /** Every series, for the inactive-context dots. */
  allDatasetsData: readonly OverlaySeries[];
  datasetInfos: readonly OverlaySeriesInfo[];
  /** Fallback when no dataset is active - should never be reached in practice. */
  fallbackColor: string;
  axesKind: string;
  /** The axes are built. Handles only become draggable once they are. */
  isCalibrated: boolean;
  labelAway: { x: number; y: number } | undefined;
  /** Which data point (if any) closing the pie ring would land on. */
  ringClosingIndex: number | null;
  mode: string;
  activeHandleKey: string | null;
  activePointIndex: number | null;
  selectedPointIndices: readonly number[];
  activeDatasetIndex: number;
  errorTargetIndex: number;
}

export function buildCanvasMarkers(input: CanvasMarkerInput): CanvasMarker[] {
  const {
    steps,
    placedPoints,
    pendingPixel,
    pendingPixelColor,
    dataPoints,
    dataPointRoles,
    capRoles,
    allDatasetsData,
    datasetInfos,
    fallbackColor,
    axesKind,
    isCalibrated,
    labelAway,
    ringClosingIndex,
    mode,
    activeHandleKey,
    activePointIndex,
    selectedPointIndices,
    activeDatasetIndex,
    errorTargetIndex,
  } = input;

  const result: CanvasMarker[] = [];

  /**
   * ⚑⚑ A COMMITTED CALIBRATION STOPS LABELLING THE FIGURE (v2.3).
   *
   * The anchors and their labels used to be drawn unconditionally for the rest of
   * the session. On a heatmap they sit INSIDE the plot rather than on the axes,
   * so six labels and a dozen handles cover the very cells being read - David
   * could not photograph the feature. It helps every type.
   *
   * ⚑ THE LABELS, NOT THE HANDLES, and not a toggle: a visibility control is new
   * capability and a mode to learn, while the handles are what anyone would still
   * want to grab. Once the axes are built the labels have said what they had to
   * say - the walk is over and the values are in the card.
   * ⚑ THEY READ AGAIN IN CALIBRATE MODE, which is the only mode a handle is
   * draggable in, so that is exactly where knowing which one you are nudging
   * matters. It is a mode with a button on screen, not a hidden state.
   */
  const labelsCalibration = !isCalibrated || mode === 'calibrate';

  /**
   * ⚑ TWO ANCHORS ON ONE PIXEL PRINT ONE LABEL.
   *
   * A heatmap's `x1` and `y1` ARE the same click - the shared corner - so both
   * labels landed on one point and overlapped into a smudge (`C1 x R1(0)=0`).
   * Every shared-corner type has it.
   * ⚑ JOINED, not dropped: both anchors are really there and both say something
   * about that pixel, so hiding one would make a real reading invisible rather
   * than merely unreadable.
   */
  const labelsAtPixel = new Map<string, string[]>();
  for (const step of steps) {
    const point = placedPoints[step.key];
    if (!point || !labelsCalibration) continue;
    const text = markerLabel(step, point.values, axesKind);
    if (text === '') continue;
    const key = `${point.px},${point.py}`;
    const existing = labelsAtPixel.get(key);
    if (existing) existing.push(text);
    else labelsAtPixel.set(key, [text]);
  }
  /** Emptied as it is read, so only the FIRST anchor on a pixel prints. */
  const takeLabel = (px: number, py: number): string => {
    const key = `${px},${py}`;
    const texts = labelsAtPixel.get(key);
    if (!texts) return '';
    labelsAtPixel.delete(key);
    return texts.join(' · ');
  };

  for (const step of steps) {
    const point = placedPoints[step.key];
    if (point) {
      result.push({
        id: step.key,
        x: point.px,
        y: point.py,
        // ⚑ Spider labels the handle with its VALUE alone. The generic
        // "<step>=<values>" form rendered as "Axis 5=80, Biodegradation" - six of
        // those sprawled across the plot, repeating axis names the FIGURE already
        // prints and burying the one thing the handle asserts, which is where that
        // value sits. Caught on screen; no test can see a label being cluttered.
        // ⚑ Empty once the calibration has committed, and joined where two
        // anchors share a pixel - see `labelsCalibration` and `takeLabel`.
        label: takeLabel(point.px, point.py),
        color: step.color,
        kind: 'calibration',
        // ⚑ Spread rather than `labelAway,`: under exactOptionalPropertyTypes an
        // ABSENT key means "does not apply" and an explicit `undefined` does not.
        // A non-radial figure has no centre to lean away from, so the key is not
        // there at all - the same rule v2.0 turned on for the record.
        ...(labelAway ? { labelAway } : {}),
        // Spread for the same exactOptionalPropertyTypes reason as labelAway:
        // a step that does not stagger has no key at all.
        ...(step.labelBelow === true ? { labelBelow: true } : {}),
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
        draggable: isCalibrated && mode === 'calibrate',
      });
    }
  }

  if (pendingPixel) {
    result.push({ id: 'pending', x: pendingPixel.px, y: pendingPixel.py, label: '?', color: pendingPixelColor });
  }

  // Every *other* dataset's points render first (so the active one's own
  // points, pushed last below, layer on top) as non-interactive, unlabeled
  // dots in that series' own color -- visible for context, never draggable
  // or clickable, so a click/drag can never land on the wrong series by
  // accident. Checkpoint 30, see this file's header comment.
  allDatasetsData.forEach((ds) => {
    if (ds.active) return;
    // A dense series is drawn as a connecting line (checkpoint 131/132): the
    // line carries the shape, so its per-point dots are dropped -- even tiny
    // ones mush into a furry band, and an inactive series has no selection to
    // preserve. Sparse series keep their normal dots.
    //
    // ⚑⚑ ...but only where there IS a line. A fragment shorter than two points
    // is not a run, so a stray point is covered by nothing; dropping its dot too
    // drew a reading the record HAS with nothing at all. See the shared-corner
    // note above: unreadable is acceptable, invisible is not. Enforced by
    // `a point the line cannot reach keeps its dot`.
    const { dense, strays } = runCoverage(ds.points.map((p) => ({ x: p.px, y: p.py })));
    const color = rgb(ds.color);
    ds.points.forEach((point, i) => {
      if (dense && !strays.has(i)) return;
      // ⚑ The SAME size rule the active series obeys - reuse, not a second
      // opinion. A dense series' strays are the points the line cannot reach,
      // which is not the plain-dense case, so `false` is the honest argument.
      result.push({
        id: `inactive-point-${ds.index}-${i}`,
        x: point.px,
        y: point.py,
        label: '',
        color,
        draggable: false,
        ...dotRadius(ds.roles?.[i], false),
      });
    });
  });

  const activeColorRGB = datasetInfos.find((d) => d.active)?.color;
  const activeColor = activeColorRGB ? rgb(activeColorRGB) : fallbackColor;
  // ⚑⚑ The active series' strays, for the same reason as the inactive one's: a
  // PLAIN point (not an anchor, not an interpolation sample) on a dense series
  // is drawn only by the line, and the line does not reach a one-point fragment.
  // Enforced by `a plain point the line cannot reach keeps its dot`.
  const { dense: activeDense, strays: activeStrays } = runCoverage(
    dataPoints.map((p) => ({ x: p.px, y: p.py }))
  );
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
    // ⚑⚑ IS THIS PIXEL A CAP? Under B4 a datum's error caps live on its own
    // tuple, so they are pixels of the series they belong to - which changes two
    // answers below, and both were wrong the moment the record moved.
    const capRole = capRoles?.[i] ?? null;
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
    const plainDense = activeDense && !isInterp && !isAnchor && !activeStrays.has(i);
    if (plainDense && !selected) return;
    result.push({
      id: dataPointMarkerId(i),
      x: point.px,
      y: point.py,
      // ⚑ A cap carries no ordinal. The label is the point's NUMBER, and a cap
      // is part of a reading rather than another reading - numbering it told the
      // user a one-point series had three points, the same claim the series list
      // was making before `datumCount`.
      label:
        isInterp || capRole
          ? ''
          : i === ringClosingIndex
            ? `${i + 1} - click to close the ring`
            : String(i + 1),
      color: activeColor,
      ...(labelAway ? { labelAway } : {}),
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
      // ⚑ NOT DRAGGABLE WHILE IT IS THE CLOSING TARGET. To close the ring you must
      // click the first boundary -- which has a marker drawn on it, and a draggable
      // marker takes the press for its own drag/select, so the click that closes the
      // ring was the one click the figure ignored. Exactly the trap the error-bar
      // link drag hit, and the fix is the mechanism this file already documents:
      // a non-draggable marker leaves Konva's hit graph entirely, so the press
      // reaches the stage and registers as the next image click. Only while closing
      // is actually on offer, so the point stays correctable the rest of the time.
      // ⚑⚑ A CAP OF THE TARGET SERIES STAYS DRAGGABLE. `isErrorLinkAnchorSeries`
      // was scoped to the target series precisely so a cap - living in a series
      // of its own - stayed correctable. B4 moves the cap onto the datum's
      // record, so it is a pixel of the target series and the same rule froze
      // it: on the built app, dragging the mirrored lower cap did nothing while
      // three on-screen strings promised it would.
      //
      // The DATUM is what must stay inert, for the reason stated above: the cap
      // gesture BEGINS by pressing a datum, and Konva's own drag fires off that
      // same press and hauls the point along to the cap. That has never applied
      // to a cap, which is not where a link drag starts.
      //
      // ⚑ This is B3 ("caps ALWAYS editable") arriving with no exception to the
      // active-series guard - a cap is part of the active series' point, so
      // dragging it already IS editing the active series.
      // ⚑ B1: an error cap has no dot of its own. Its drawn form is the tick at
      // the end of its whisker, and this marker is the hit area over it.
      ...(capRole ? { kind: 'cap' as const } : {}),
      ...(capRole?.line ? { dragLine: capRole.line } : {}),
      draggable:
        i !== ringClosingIndex &&
        mode !== 'pan' &&
        mode !== 'measure' &&
        (!isErrorLinkAnchorSeries || capRole !== null) &&
        !isInterp,
      selected,
      // Absent, not undefined - an ordinary dot takes ImageCanvas's default of 5.
      ...dotRadius(role, plainDense),
    });
  });

  return result;
}

export interface SeriesLineInput {
  /** Grouped types (Box Plot / Histogram) get glyphs, not a curve. */
  hasSlots: boolean;
  allDatasetsData: readonly OverlaySeries[];
  dataPoints: readonly { px: number; py: number }[];
  datasetInfos: readonly OverlaySeriesInfo[];
  fallbackColor: string;
}

/**
 * Connecting polylines drawn beneath the markers (checkpoint 131) -- the fix for
 * a dense auto-trace rendering as a furry band of overlapping dots. Skipped
 * entirely for grouped types (Box Plot / Histogram get glyphs, not a curve) and
 * for sparse/scatter series (polylineRuns returns no runs). Inactive series
 * first so the active one's line layers on top, matching the marker order.
 */
export function buildSeriesLines({
  hasSlots,
  allDatasetsData,
  dataPoints,
  datasetInfos,
  fallbackColor,
}: SeriesLineInput): SeriesLine[] {
  if (hasSlots) return [];
  const lines: SeriesLine[] = [];
  allDatasetsData.forEach((ds) => {
    if (ds.active) return;
    const runs = runsForPoints(ds.points);
    if (runs.length) lines.push({ color: rgb(ds.color), runs });
  });
  const activeRuns = runsForPoints(dataPoints);
  if (activeRuns.length) {
    const c = datasetInfos.find((d) => d.active)?.color;
    lines.push({ color: c ? rgb(c) : fallbackColor, runs: activeRuns });
  }
  return lines;
}
