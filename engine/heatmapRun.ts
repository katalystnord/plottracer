/**
 * The heatmap capture run — everything the UI needs, kept OUT of the UI
 * (v2.2, phase 3b).
 *
 * ⚑ THE METHOD THAT MADE THE v2.1 SPLIT WORK: the body goes in `engine/`, the
 * hook stays a hook. Mutation testing cannot see `ui/` at all and its only
 * instrument is an 18-minute Electron suite, so anything that can be decided
 * without a DOM is decided here, where a unit test runs it in milliseconds and
 * Stryker can prove the tests notice.
 *
 * Three things the Heatmap card asks for, and nothing else:
 *
 *   1. build the colour key from the four clicks that describe it,
 *   2. propose a grid from the ink,
 *   3. read the matrix and hand back rows a table can render.
 *
 * ⚑ Every refusal here comes back as a SENTENCE, because this is the layer that
 * faces the user. The modules underneath return codes; translating them is this
 * file's job, and each sentence names the requirement as well as the fault.
 *
 * ⚑ THERE IS NO SEPARATE LOAD-PATH CHECK, and that is deliberate. A
 * `checkLoadedStrip` used to sit here claiming to be "the load path's own
 * entrance to the same model"; it had no caller and no test, and the v2.2 audit
 * deleted it. The claim was false in a way that mattered: the strip is
 * RE-SAMPLED from the image on every load rather than stored, so the load path
 * already runs `sampleColorBar` and gets that function's own refusal. A second
 * entrance would only be needed if the colours were stored — and the reason
 * they are not is written on `buildColorScale`.
 */

import { colorAtPosition, sampleColorBar, stripFromCorners, type ColorBarRefusal } from '../algorithms/colorBar.js';
import {
  checkColorScale,
  positionAtValue,
  valueAtPosition,
  type ColorScale,
} from '../algorithms/colorScale.js';
import {
  detectDividers,
  proposeAllDividers,
  proposeDividers,
  reconcileWithCount,
  type PlotBox,
} from '../algorithms/gridDetect.js';
import { readHeatmap, type HeatmapCellReading, type PixelProjector } from '../algorithms/heatmapRead.js';
import { checkDividers, equalDividers, insertDivider, moveDivider, removeDivider } from '../core/heatmapGrid.js';
import type { CategoryOverlayInput } from './categoryTickOverlay.js';
import { labelAt, reindexLabels } from '../core/heatmapLabels.js';
import type { PlacedCalibPoint } from './calibrationSession.js';

/** The image, as the canvas hands it over. */
export interface SourceImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** What a heatmap session needs beyond its axes: the key, and the grid. */
export interface HeatmapState {
  /** Divider coordinates on each axis, in DATA space, ascending. */
  xDividers: readonly number[];
  yDividers: readonly number[];
}

const KEY_STEPS = ['k1', 'k2', 'kv1', 'kv2'] as const;

function stripRefusalSentence(reason: ColorBarRefusal): string {
  switch (reason) {
    case 'not-a-line':
      return 'The colour key’s two ends are too close together to read a ramp between them — click where the coloured strip begins and where it ends, along its length.';
    case 'off-image':
      return 'The colour key’s ends must both be on the image.';
    case 'no-pixels':
      return 'Nothing was found along the colour key — the strip is fully transparent there.';
    case 'no-ramp':
      return 'The colour key reads as one flat colour, so every cell would come out the same. Click along the strip’s LENGTH rather than across its width.';
    case 'discrete':
      // ⚑⚑ NAMES WHY, AND WHAT IT WOULD HAVE COST. The user is being told the
      // tool will not do the thing they asked for, so the sentence has to carry
      // the reason: a banded key maps a colour to a RANGE, and the number we
      // could invent for it — the middle of that range — is one the figure does
      // not contain. In a heatmap the colour IS the value, so that invented
      // number would arrive with no symptom at all.
      return 'This colour key is drawn as a few discrete bands rather than a continuous ramp, so a cell’s colour identifies a BAND — a range — and not a value. PlotTracer will not report a number the figure does not contain: read these cells against the key by eye, or trace a figure whose key is a continuous ramp.';
  }
}

/**
 * Sample the key described by the calibration's last four clicks.
 *
 * ⚑ SAMPLED FROM THE IMAGE EVERY TIME, never stored. A project file keeps the
 * four clicks — which is what the user actually did — and the colours are read
 * back from the image it also keeps. Storing hundreds of RGB triples would be a
 * second copy of something derivable, and the two would eventually disagree;
 * re-sampling also sends the load path through the same refusals as the click
 * path, rather than through a reimplementation of them.
 */
export function buildColorScale(
  placed: Readonly<Record<string, PlacedCalibPoint>>,
  image: SourceImage,
  isLog: boolean
): { scale: ColorScale | null; error: string | null } {
  for (const key of KEY_STEPS) {
    if (placed[key] === undefined) {
      return { scale: null, error: 'The colour key is not calibrated yet — place its two ends and two labelled ticks.' };
    }
  }
  const k1 = placed['k1']!;
  const k2 = placed['k2']!;
  const kv1 = placed['kv1']!;
  const kv2 = placed['kv2']!;

  // ⚑⚑ THE TWO KEY CLICKS ARE OPPOSITE CORNERS OF THE BAR, not two points along
  // a centreline nothing is drawn on. A corner is printed and either hit or
  // missed; the old pair gave the user nothing to aim at (David: *"it is really
  // hard to know where to click on the key"*). The rectangle also MEASURES the
  // strip's thickness, which used to be a hardcoded 5 px.
  const geometry = stripFromCorners({ x: k1.px, y: k1.py }, { x: k2.px, y: k2.py });
  if (geometry === null) {
    return { scale: null, error: stripRefusalSentence('not-a-line') };
  }
  const sampled = sampleColorBar(
    image.data,
    image.width,
    image.height,
    geometry.from,
    geometry.to,
    { thickness: geometry.thickness }
  );
  if (sampled.strip === null) {
    return { scale: null, error: stripRefusalSentence(sampled.reason!) };
  }

  const scale: ColorScale = {
    strip: sampled.strip,
    ticks: [
      { point: { x: kv1.px, y: kv1.py }, value: Number(kv1.values[0]) },
      { point: { x: kv2.px, y: kv2.py }, value: Number(kv2.values[0]) },
    ],
    log: isLog,
  };
  switch (checkColorScale(scale)) {
    case 'tick-not-a-number':
      return { scale: null, error: 'The colour key’s two labelled values must both be numbers.' };
    case 'ticks-equal-value':
      return { scale: null, error: 'The colour key’s two labelled ticks have the same value — they must differ, or every cell reads the same number.' };
    case 'ticks-coincide':
      return { scale: null, error: 'The colour key’s two labelled ticks are at the same place along the strip — click two different positions on it.' };
    case 'log-needs-positive':
      return { scale: null, error: 'A log colour scale cannot pass through zero or go negative — enter positive values (e.g. 1 and 100).' };
    default:
      return { scale, error: null };
  }
}

/**
 * Every cell the Select tool's marquee caught.
 *
 * ⚑⚑ THE SAME RULE THE POINT MARQUEE USES, so Select means one thing in this
 * app. That marquee tests each DATA POINT's pixel against the dragged box; this
 * tests each CELL'S CENTRE pixel against the same box. Nothing new to learn, and
 * a rotated or skewed figure is handled for free because the test happens in
 * PIXEL space after the projection, exactly as it does for points.
 *
 * ⚑ WHY IT IS THE CENTRE and not the cell's overlap with the box: a marquee is
 * a "grab what I dragged over" gesture, and requiring only overlap would grab a
 * whole row from a box clipping its edge. The centre is the same standard a
 * point is held to — the thing itself must be inside.
 *
 * ⚑ B6 asked for this (*"I cannot select a range of cells, or click cells on the
 * heatmap"*) and v2.2 built multi-select in the TABLE only, then called it done.
 */
export function cellKeysInRect(
  rows: readonly HeatmapRow[],
  rect: { x: number; y: number; width: number; height: number },
  toPixel: (x: number, y: number) => { x: number; y: number } | null
): string[] {
  const x0 = Math.min(rect.x, rect.x + rect.width);
  const x1 = Math.max(rect.x, rect.x + rect.width);
  const y0 = Math.min(rect.y, rect.y + rect.height);
  const y1 = Math.max(rect.y, rect.y + rect.height);
  const keys: string[] = [];
  for (const row of rows) {
    const p = toPixel(row.xCentre, row.yCentre);
    if (p === null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) keys.push(cellKey(row.col, row.row));
  }
  return keys;
}

/**
 * Where the colour key's caliper rides, and how thick it is.
 *
 * ⚑⚑ THE SAME LINE THE SAMPLER READS, WHICH IS THE WHOLE POINT. `k1` and `k2`
 * are OPPOSITE CORNERS of the key, so the line between them is the rectangle's
 * DIAGONAL — and the caliper used to be drawn along it. That tilted the glyph by
 * the diagonal's angle and let it drift from one long edge at low values to the
 * other at high ones, which is both of David's complaints about it (*"it does
 * not take the full width of the colour key, and that looks wrong"* … *"And it
 * is a wrong angle too?"*) from a single cause.
 *
 * ⚠️ AND IT WAS THE TRAP THIS PROJECT KEEPS FALLING INTO: `buildColorScale`
 * samples along `stripFromCorners(k1, k2)` — the CENTRELINE — so the position
 * DRAWN and the position SAMPLED were measured along two different lines. The
 * drag already reused `positionOnStrip`; the drawing was hand-rolled beside it.
 * One function for both, so they cannot come apart.
 *
 * ⚑ THE THICKNESS IS MEASURED, not chosen. It comes from the user's own two
 * corner clicks — the same measurement that replaced a hardcoded 5px sampling
 * window — so the caliper spans the bar it is pointing at instead of floating on
 * it as a fixed-size box. ⚠️ It is in IMAGE space; the overlay must scale it by
 * the view's zoom like everything else it draws.
 */
export function keyCursorStrip(
  k1: { px: number; py: number },
  k2: { px: number; py: number }
): { from: { x: number; y: number }; to: { x: number; y: number }; thickness: number } | null {
  return stripFromCorners({ x: k1.px, y: k1.py }, { x: k2.px, y: k2.py });
}

/** The axes surface needed to read a heatmap's frame back — structural, so no
 * `core/axes` import. `XYAxes` satisfies it. */
export interface HeatmapFrameCarrier {
  calibration: { getPoint(index: number): { dx: unknown; dy: unknown } | null } | null;
  getMetadata(): Record<string, unknown>;
}

/** Whether each axis is an ordinal or a measured scale, as the calibration
 * recorded it. */
export interface HeatmapAxisKinds {
  x: 'category' | 'value';
  y: 'category' | 'value';
}

export function heatmapAxisKinds(axes: HeatmapFrameCarrier): HeatmapAxisKinds {
  const meta = axes.getMetadata();
  return {
    x: meta['heatmapXKind'] === 'category' ? 'category' : 'value',
    y: meta['heatmapYKind'] === 'category' ? 'category' : 'value',
  };
}

/**
 * The span the grid lives in, read from the axes' OWN calibration.
 *
 * ⚑⚑ FROM THE CALIBRATION, NOT FROM THE TYPED TEXT, and that is what makes a
 * category axis work at all: its steps ask for a count and an edge, so there is
 * no typed coordinate to read — the frame `buildAxes` derived (0…N) exists only
 * on the axes. Reading the boxes instead left a categorical heatmap with no
 * bounds, therefore no grid, therefore no cells: the feature silently absent.
 * It also removes a second source of truth for something the axes already knows.
 */
export function heatmapBounds(
  axes: HeatmapFrameCarrier
): { xMin: number; xMax: number; yMin: number; yMax: number } | null {
  const cal = axes.calibration;
  if (!cal) return null;
  const at = (index: number, axis: 'dx' | 'dy'): number => Number(cal.getPoint(index)?.[axis] ?? NaN);
  const values = [at(0, 'dx'), at(1, 'dx'), at(2, 'dy'), at(3, 'dy')];
  if (values.some((v) => !Number.isFinite(v))) return null;
  const [x1, x2, y1, y2] = values as [number, number, number, number];
  const meta = axes.getMetadata();
  const counts = heatmapBandCounts(axes);
  /**
   * ⚑⚑ THE CLICKS ARE NOT THE PLOT BOX unless the figure marks boundaries, and
   * that is true of BOTH axis kinds. A centred tick sits half a band inside the
   * edge, so the grid has to reach half a band further out than what was
   * clicked; reading the clicked values as the extent drops half a band off each
   * end and shifts every boundary between them.
   *
   * ⚑ The two kinds differ only in what the numbers ARE. A category axis was
   * given an ordinal frame by `buildAxes`, so its clicks land at 0.5…N-0.5 and
   * the grid is simply 0…N. A value axis keeps the coordinates the user typed,
   * so the half-band is computed from them — and the CALIBRATION is untouched
   * either way: x=0 is still at that pixel, only the grid's extent moves.
   *
   * ⚑ This used to run for category axes ONLY, which is the same wrong branch
   * that gave a measured axis no grid at all (case A1). A value axis has bands,
   * so it has a convention.
   */
  const spanOf = (
    lo: number,
    hi: number,
    kindKey: string,
    tickKey: string,
    count: number
  ): [number, number] | null => {
    const centred = meta[tickKey] === 'centred';
    if (meta[kindKey] === 'category') {
      const width = Math.abs(hi - lo);
      const bands = centred ? Math.round(width) + 1 : Math.round(width);
      return [0, Math.max(1, bands)];
    }
    const min = Math.min(lo, hi);
    const max = Math.max(lo, hi);
    if (!centred) return [min, max];
    // ⚑ REFUSED rather than divided by zero: two centres need two bands, and
    // `checkValues` says so in words before the walk ever gets here. Returning
    // an infinite plot box would be a calibration that cannot fail.
    if (!Number.isInteger(count) || count < 2) return null;
    const halfBand = (max - min) / (count - 1) / 2;
    return [min - halfBand, max + halfBand];
  };
  const xSpan = spanOf(x1, x2, 'heatmapXKind', 'heatmapXTicks', counts.columns);
  const ySpan = spanOf(y1, y2, 'heatmapYKind', 'heatmapYTicks', counts.rows);
  if (!xSpan || !ySpan) return null;
  const [xMin, xMax] = xSpan;
  const [yMin, yMax] = ySpan;
  return { xMin, xMax, yMin, yMax };
}

/**
 * How many bands each axis DECLARES, read from the calibration.
 *
 * ⚑⚑ ONE QUESTION, ONE SLOT, BOTH KINDS. The count lives in `dz` of each axis's
 * second point whether the axis is named or measured — see the heatmap config's
 * `fixedSteps`. It used to live in `dx` for a category axis and nowhere at all
 * for a value axis, which is precisely why a measured axis could not be asked
 * how many columns it had, and therefore never got a grid.
 */
export function heatmapBandCounts(axes: HeatmapFrameCarrier): { columns: number; rows: number } {
  const cal = axes.calibration;
  const at = (index: number): number => {
    const raw = (cal?.getPoint(index) as { dz?: unknown } | null)?.dz ?? '';
    return parseFloat(String(raw));
  };
  return { columns: at(1), rows: at(3) };
}

/**
 * The grid a fresh heatmap starts with: every declared band, on BOTH axes.
 *
 * ⚑⚑ IT DOES NOT ASK WHAT THE AXIS MEANS, and that is the whole correction.
 * This function used to read `HeatmapAxisKinds` and give a VALUE axis
 * `[lo, hi]` — one cell spanning the entire figure, no dividers, nothing to
 * select and nothing to drag. "Is the axis category or value" decides what
 * INDEXES the columns, names or numbers; it never decided whether there are
 * columns. A continuous field is still drawn as a matrix of cells.
 *
 * ⚑ THE COUNT IS A STARTING POINT, NOT A MODEL. What comes out is an ordinary
 * divider list, individually adjustable from the moment it exists, so an
 * unevenly drawn figure stays first-class — nothing downstream can tell an
 * evenly generated grid from a hand-placed one.
 */
export function initialGridFor(
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number },
  counts: { columns: number; rows: number }
): HeatmapState {
  const bandsFor = (lo: number, hi: number, count: number): number[] =>
    equalDividers(lo, hi, count) ?? [lo, hi];
  return {
    xDividers: bandsFor(bounds.xMin, bounds.xMax, counts.columns),
    yDividers: bandsFor(bounds.yMin, bounds.yMax, counts.rows),
  };
}

/**
 * The grid a fresh heatmap starts with: one cell spanning the calibration.
 *
 * ⚑ The outer boundaries are ORDINARY DIVIDERS, adjustable like every other
 * one. They start at the two values the user calibrated because that is the
 * only span the session knows about — not because the figure's plot box is
 * assumed to be there. If the axis was calibrated on two interior ticks, the
 * user drags the outer dividers out to the edges, and nothing special happens
 * when they do.
 */
export function initialGrid(axesBounds: {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}): HeatmapState {
  return {
    xDividers: [axesBounds.xMin, axesBounds.xMax],
    yDividers: [axesBounds.yMin, axesBounds.yMax],
  };
}

/**
 * Where the grid LIVES between sessions: the axes' own metadata.
 *
 * ⚑⚑ THE SAME HOME PIE'S TOTAL AND SWEEP USE, for the same stated reason —
 * the grid has no pixel to ride on, so the axes metadata is its one place in
 * the file. Choosing it over a new project-file field is not a shortcut: axes
 * metadata already rides through `core/plotData.ts`'s serialize/deserialize,
 * which means the grid is saved, reopened AND undone by machinery that is
 * already tested, instead of by three new entrances each needing their own
 * guard. The undo snapshot is a `plotData` serialization too.
 *
 * ⚑ Stored in DATA coordinates, like everything else about the grid, so it
 * survives a re-calibration or an image edit with its meaning intact.
 */
const GRID_METADATA_KEY = 'heatmapGrid';

/** The minimal axes surface this needs — structural, so no `core/axes` import. */
export interface MetadataCarrier {
  getMetadata(): Record<string, unknown>;
  setMetadata(obj: Record<string, unknown>): void;
}

/**
 * Read the grid an axes is carrying, or null when it has none.
 *
 * ⚑ VALIDATED ON THE WAY OUT, not trusted. This is a load-path entrance: the
 * numbers come from a file a user may have edited, from an older build, or from
 * a different tool. `checkDividers` is the same rule the interactive path
 * applies, so a file cannot produce a grid the app would refuse to let you
 * draw.
 */
export function gridFromAxes(axes: MetadataCarrier): HeatmapState | null {
  const raw = axes.getMetadata()[GRID_METADATA_KEY];
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y } = raw as { x?: unknown; y?: unknown };
  if (!Array.isArray(x) || !Array.isArray(y)) return null;
  const xs = checkDividers(x.map(Number)).dividers;
  const ys = checkDividers(y.map(Number)).dividers;
  if (xs === null || ys === null) return null;
  return { xDividers: xs, yDividers: ys };
}

/**
 * Put the grid where a save will find it. A null grid REMOVES the key rather
 * than writing an empty one, so a file never carries a grid that is not a grid.
 */
export function gridToAxes(axes: MetadataCarrier, grid: HeatmapState | null): void {
  const meta = { ...axes.getMetadata() };
  if (grid === null) {
    delete meta[GRID_METADATA_KEY];
  } else {
    meta[GRID_METADATA_KEY] = { x: [...grid.xDividers], y: [...grid.yDividers] };
  }
  axes.setMetadata(meta);
}

/**
 * The names on the two axes, one list per axis, indexed by CELL.
 *
 * ⚑ Empty lists are the norm, not a missing value: a value × value heatmap has
 * nothing to name, and its cells' coordinates are the numbers the calibration
 * already produces. See `core/heatmapLabels.ts` for why the label IS the
 * coordinate on a category axis, and why this is not `core/categoryAxis.ts`.
 */
export interface HeatmapLabels {
  x: readonly string[];
  y: readonly string[];
}

export const NO_HEATMAP_LABELS: HeatmapLabels = { x: [], y: [] };

/** Beside the grid, for the same reason the grid is there: no pixel to ride on,
 * and axes metadata already saves, reopens and undoes through `plotData`. */
const LABELS_METADATA_KEY = 'heatmapLabels';

/**
 * How a cell is named, everywhere: in the selection, in the user's readings, and
 * in the table's own lookups.
 *
 * ⚑ ONE key format, exported rather than re-spelled. `Workspace` had its own
 * `cellKey`, the table had two more inline, and the readings below would have
 * made a fourth — four literals that must agree for a pick to highlight the cell
 * it edits, with nothing to notice if one drifted.
 */
export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

/**
 * The cells the USER read, as positions along the colour key.
 *
 * ⚑⚑ A POSITION, NOT A NUMBER, and that is the whole design. David: *"Heatmaps
 * are a 2.5D graph type. The values are STORED ON THE THIRD AXIS. Changing a
 * value in a cell MOVES THE VALUE on the third axis that records the value, and
 * nothing else!"* So an edited cell travels with the key exactly as a data point
 * travels with its axes: recalibrate the key and every cell in the matrix moves
 * together, ours and theirs. A stored number would sit still and quietly
 * disagree with the rest, and nothing on screen would say which to trust.
 *
 * ⚑ NO PROVENANCE FLAG HERE. The `source` a row carries is WHICH INSTRUMENT
 * read it — colour, OCR, or a person — not declared-versus-measured. All three
 * are measurements; membership of this record IS the answer, so there is nothing
 * extra to store.
 *
 * Keyed by `cellKey`, in the key's own 0..1 frame.
 */
export type HeatmapCellReadings = Readonly<Record<string, number>>;

export const NO_HEATMAP_CELL_READINGS: HeatmapCellReadings = {};

/** Beside the grid and the names, for the same reason both are there. */
const READINGS_METADATA_KEY = 'heatmapCellReadings';

/**
 * Record what the user read in one cell, from what they typed.
 *
 * ⚑ THE REFUSAL IS THE MODEL'S, at the gesture. `positionAtValue` is the third
 * axis's inverse and it answers null for exactly the values the key cannot
 * represent — a log key has no zero and no negative branch — which is the same
 * shape as `dataToPixel` returning NaN for a log X axis asked for −5, refused
 * where the user is looking rather than eight steps later.
 */
export function setCellReading(
  readings: HeatmapCellReadings,
  scale: ColorScale,
  col: number,
  row: number,
  text: string
): { readings: HeatmapCellReadings; error: string | null } {
  const parsed = Number(text);
  if (text.trim() === '' || !Number.isFinite(parsed)) {
    return { readings, error: 'A cell’s value has to be a number.' };
  }
  const t = positionAtValue(scale, parsed);
  if (t === null) {
    return {
      readings,
      error: scale.log
        ? 'A log colour key has no zero and no negative side — enter a positive number.'
        : 'The colour key cannot place that value.',
    };
  }
  return { readings: { ...readings, [cellKey(col, row)]: t }, error: null };
}

/**
 * Record what the user read in one cell, from a POSITION on the key.
 *
 * ⚑⚑ THE PRIMITIVE OF THE PAIR. The record stores a position, so dragging the
 * key's marker writes it outright while a typed number has to be converted
 * first — `setCellReading` is the derived half, not this one. Every other axis
 * in the app has had both gestures since v1.3 ("I should be able to both edit
 * the number OR move the point on the axis"); the third axis had only the typed
 * one until the key grew a marker.
 *
 * ⚑ A POSITION PAST THE LABELLED TICKS IS ACCEPTED, deliberately. The printed
 * labels are almost never at the very ends of the ramp, so most keys extend
 * beyond them — the same reason `valueAtPosition` extrapolates rather than
 * clamping. Refusing here would put the extremes of the figure out of the
 * gesture's reach, and the extremes are usually the point of the figure.
 */
export function setCellReadingAt(
  readings: HeatmapCellReadings,
  col: number,
  row: number,
  t: number
): { readings: HeatmapCellReadings; error: string | null } {
  if (!Number.isFinite(t)) {
    return { readings, error: 'That is not a position on the colour key.' };
  }
  return { readings: { ...readings, [cellKey(col, row)]: t }, error: null };
}

/** Hand the cell back to the colour key. */
export function clearCellReading(
  readings: HeatmapCellReadings,
  col: number,
  row: number
): HeatmapCellReadings {
  const next = { ...readings };
  delete next[cellKey(col, row)];
  return next;
}

/**
 * Read the user's readings an axes is carrying.
 *
 * ⚑ VALIDATED, not trusted — a load-path entrance like `gridFromAxes`. A key
 * that is not `col,row` or a value that is not a finite position is DROPPED
 * rather than defaulted: a bad entry would otherwise land a number on a cell the
 * user never touched, which is the one thing this record must never do.
 */
export function readingsFromAxes(axes: MetadataCarrier): HeatmapCellReadings {
  const raw = axes.getMetadata()[READINGS_METADATA_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return NO_HEATMAP_CELL_READINGS;
  const kept: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+,\d+$/.test(key)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    kept[key] = value;
  }
  return kept;
}

/** Put them where a save will find them. Nothing read means no key at all,
 * rather than a file saying "no readings" in a second way. */
export function readingsToAxes(axes: MetadataCarrier, readings: HeatmapCellReadings): void {
  const meta = { ...axes.getMetadata() };
  if (Object.keys(readings).length === 0) {
    delete meta[READINGS_METADATA_KEY];
  } else {
    meta[READINGS_METADATA_KEY] = { ...readings };
  }
  axes.setMetadata(meta);
}

/**
 * Does cell-index order run OPPOSITE to the way the figure is read?
 *
 * ⚑⚑ MEASURED FROM THE AXES, NEVER ASSUMED — which is the whole reason this is
 * a function and not the constant `{ x: false, y: true }`. On the ordinary
 * upward-y figure, row 0 is `yMin` and sits at the BOTTOM, so a list typed
 * top-down is reversed; on a figure calibrated upside down, or a rotated scan,
 * it is not. The same click that told us which way is out of the plot tells us
 * this: project the grid's two extremes and look at where they land on screen.
 *
 * ⚑ Screen y grows DOWNWARD, so the row whose pixel y is SMALLER is the one
 * higher up the page. Getting that backwards is the defect this fixes, in
 * mirror image.
 */
export function labelOrderReversed(
  grid: HeatmapState,
  axes: PixelProjector
): { x: boolean; y: boolean } {
  const xs = checkDividers(grid.xDividers).dividers;
  const ys = checkDividers(grid.yDividers).dividers;
  if (xs === null || ys === null) return { x: false, y: false };
  const xLo = xs[0]!;
  const xHi = xs[xs.length - 1]!;
  const yLo = ys[0]!;
  const yHi = ys[ys.length - 1]!;
  const left = axes.dataToPixel(xLo, yLo);
  const right = axes.dataToPixel(xHi, yLo);
  const bottom = axes.dataToPixel(xLo, yLo);
  const top = axes.dataToPixel(xLo, yHi);
  return {
    // Columns are read left to right: reversed when the FIRST column sits to the
    // right of the last one on screen.
    x: Number.isFinite(left.x) && Number.isFinite(right.x) ? left.x > right.x : false,
    // Rows are read top to bottom: reversed when the FIRST row (yMin) sits lower
    // on the page than the last, which is the ordinary figure.
    y: Number.isFinite(top.y) && Number.isFinite(bottom.y) ? bottom.y > top.y : false,
  };
}

/**
 * Read the labels an axes is carrying.
 *
 * ⚑ VALIDATED, not trusted — a load-path entrance like `gridFromAxes`. Anything
 * that is not a list of strings is no labels at all rather than a list with
 * holes of some other type in it: `String(undefined)` would put the word
 * "undefined" on a column of a published figure.
 */
export function labelsFromAxes(axes: MetadataCarrier): HeatmapLabels {
  const raw = axes.getMetadata()[LABELS_METADATA_KEY];
  if (typeof raw !== 'object' || raw === null) return NO_HEATMAP_LABELS;
  const { x, y } = raw as { x?: unknown; y?: unknown };
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((s) => (typeof s === 'string' ? s : '')) : [];
  return { x: list(x), y: list(y) };
}

/** Put the labels where a save will find them. Two empty lists REMOVE the key
 * rather than writing an empty record, so a value × value heatmap's file says
 * nothing about names instead of saying nothing twice. */
export function labelsToAxes(axes: MetadataCarrier, labels: HeatmapLabels): void {
  const meta = { ...axes.getMetadata() };
  if (labels.x.length === 0 && labels.y.length === 0) {
    delete meta[LABELS_METADATA_KEY];
  } else {
    meta[LABELS_METADATA_KEY] = { x: [...labels.x], y: [...labels.y] };
  }
  axes.setMetadata(meta);
}

/**
 * The one line the calibration card's fold-down shows when it is CLOSED.
 *
 * ⚑ The grid is part of DEFINING the figure, not of reading it (David: *"it is
 * part of setting up the data definition / calibration. NOT outputs."*), so it
 * lives as a disclosure on the calibration card exactly as the bar chart's
 * category ticks do — and like that one, its summary is on screen the moment
 * the axes are calibrated, so nobody has to know the feature exists to find it.
 */
/**
 * What a count or convention change would cost, said while it can still be
 * avoided — and any disagreement the grid has with the declaration (C3/C4).
 *
 * ⚑⚑ THE SENTENCE IS THE BAR CHART'S, because the situation is. v2.1's category
 * ticks carry `regenerateWarning` with the rule written on it: *"Only ever shown
 * when there is something to lose. A warning that appears when nothing would be
 * discarded teaches the user to ignore it."* Same rule, same shape, no second
 * mechanism.
 *
 * ⚑ NO STORED `_adjusted` FLAG, unlike `BandedAxis`. A bar's ticks can only be
 * generated and then dragged, so "did you adjust them?" is the whole question.
 * A heatmap's grid can also be DETECTED — read off the figure's own rules — and
 * a detected grid is exactly as much of a loss as a dragged one. So the question
 * here is "is there a grid to lose?", which the grid itself answers.
 *
 * ⚑⚑ AND A DISAGREEMENT IS REPORTED, NOT RESOLVED. Changing the declared count
 * leaves the grid describing a frame that no longer exists — five columns of
 * boundaries under a calibration that now says six. Rebuilding silently would
 * throw away measured boundaries; keeping it silently leaves the two disagreeing
 * with nothing on screen saying so. Tenet 9: say what is, and let the user
 * choose. Null when there is nothing to warn about.
 */
export function heatmapRegenerateWarning(
  grid: HeatmapState | null,
  declared: { columns: number; rows: number }
): string | null {
  if (grid === null) return null;
  const columns = Math.max(0, grid.xDividers.length - 1);
  const rows = Math.max(0, grid.yDividers.length - 1);
  const parts = [
    'Changing the number of columns or rows, or the tick convention, rebuilds this grid and discards the boundaries it has.',
  ];
  // ⚑ A count nobody has declared yet is not a disagreement. Mid-walk a value
  // axis has no number at all, and NaN formatted into a sentence would read as
  // "the calibration declares NaN".
  const mismatch = (found: number, want: number, noun: string): string | null =>
    Number.isFinite(want) && want !== found
      ? `The grid has ${found} ${noun} but the calibration declares ${want}.`
      : null;
  const disagreements = [
    mismatch(columns, declared.columns, 'columns'),
    mismatch(rows, declared.rows, 'rows'),
  ].filter((s): s is string => s !== null);
  // The disagreement comes FIRST: it describes what is wrong now, where the
  // caution describes what a future action would cost.
  return [...disagreements, ...parts].join(' ');
}

export function heatmapGridSummary(grid: HeatmapState | null): string {
  // ⚑⚑ B14 — THE PRECONDITION, SAID BEFORE THE WORK IS DONE. A radial heatmap
  // (`holoviews` RadialHeatMap: concentric rings and angular bands, and per its
  // own docs "no rectangular plot box with corners") calibrates as a rectangle
  // without complaint and then reads confident nonsense out of every cell.
  //
  // ⚠️ IT CANNOT BE DETECTED, so it cannot honestly be REFUSED: three clicks on
  // a polar figure are three ordinary points, the transform is non-degenerate,
  // and nothing in the pixels tells it apart from a rotated rectangular plot. A
  // "looks polar to me" test would be interpretation of the kind tenet 9 keeps
  // out, and a wrong one would block real figures. Naming the requirement is the
  // honest half — and it costs a user eight clicks to learn it any other way.
  //
  // ⚑ Only while there is nothing to lose. Once a grid exists this line's job is
  // to report it; a caveat that never goes away is one nobody reads.
  if (grid === null) return 'Grid — needs a rectangular grid of cells; calibrate the axes first';
  const columns = Math.max(0, grid.xDividers.length - 1);
  const rows = Math.max(0, grid.yDividers.length - 1);
  return `Grid — ${columns} × ${rows} cells`;
}

/**
 * The typed lists, lined up with the cells they name.
 *
 * ⚑ ONE PLACE, and everything that touches labels goes through it — attaching
 * them to cells, showing them in the boxes, writing them to the file. The rule
 * (pad, then flip if the figure reads the other way) is only correct if it is
 * applied identically in every direction; two copies of it would disagree the
 * first time an axis was flipped, and the disagreement would look like nothing
 * at all until the export was read.
 */
export function labelsForCells(
  labels: HeatmapLabels,
  grid: HeatmapState,
  axes: PixelProjector
): HeatmapLabels {
  const reversed = labelOrderReversed(grid, axes);
  const columns = Math.max(0, checkDividers(grid.xDividers).dividers!.length - 1);
  const rows = Math.max(0, checkDividers(grid.yDividers).dividers!.length - 1);
  return {
    x: reindexLabels(labels.x, columns, reversed.x),
    y: reindexLabels(labels.y, rows, reversed.y),
  };
}

/**
 * Each axis of the grid, as the SAME overlay a bar chart's category axis draws.
 *
 * ⚑⚑ David, twice: *"We still have points and not selectable tick markers that
 * we said that we were going to reuse from bar tick characterisation."* The
 * heatmap drew its own marker dots outside the plot and borrowed only the
 * COLOUR from v2.1's category ticks — no axis line, no tick marks, a second
 * mechanism for a solved problem. This hands the same geometry to
 * `categoryTickOverlay.ts`, so a boundary looks and behaves like the tick it is.
 *
 * ⚑ THE POINTS SIT ON THE AXIS, not offset. The overlay computes its own
 * standoff along the outward normal — which is also where the retired handles'
 * hardcoded 16px went, and why their offset direction had to be worked out here
 * a second time.
 *
 * ⚑ EVERY divider is a tick and none is an "end". A bar chart freezes its two
 * edges because every tick is a function of them; a heatmap's outer boundaries
 * are ordinary dividers, so `markEnds` is off and they drag like the rest.
 */
export function heatmapAxisOverlays(
  grid: HeatmapState,
  axes: PixelProjector
): { x: CategoryOverlayInput; y: CategoryOverlayInput } {
  const xs = checkDividers(grid.xDividers).dividers;
  const ys = checkDividers(grid.yDividers).dividers;
  const empty: CategoryOverlayInput = { edges: null, tickPoints: [], markEnds: false };
  if (xs === null || ys === null) return { x: empty, y: empty };
  const xLo = xs[0]!;
  const yLo = ys[0]!;
  const xHi = xs[xs.length - 1]!;
  const yHi = ys[ys.length - 1]!;
  const finite = (p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y);

  /**
   * The axis runs along the plot's own edge — but WHICH WAY IS OUT still has to
   * be computed, not assumed.
   *
   * ⚑⚑ `outwardNormal` takes its direction from the edge ORDER: it sends a
   * left-to-right axis's ticks downward, which is where an upright figure prints
   * them. A figure calibrated upside down, or a rotated scan, has its own idea
   * of outward — and marks that ignored it would sit INSIDE the plot on exactly
   * the charts that are hardest to read already. So the edges are ORDERED here
   * against a point known to be inside the figure: if the normal would point at
   * it, they are swapped. Caught by the flipped-figure test, which the retired
   * handles carried and which the shared overlay alone does not.
   */
  const orient = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    inside: { x: number; y: number }
  ): readonly [{ x: number; y: number }, { x: number; y: number }] => {
    const normal = { x: -(b.y - a.y), y: b.x - a.x };
    const towardsInside = normal.x * (inside.x - a.x) + normal.y * (inside.y - a.y);
    return towardsInside > 0 ? [b, a] : [a, b];
  };
  // ⚑⚑ EACH AXIS SITS ON ITS OWN EDGE OF THE PLOT: x along y = yLo, y along
  // x = xLo — the two edges the figure prints its ticks against. Building the y
  // axis at xHi put its handles down the RIGHT-HAND side while the figure's row
  // labels were on the left, which is where David saw them. The interior corner
  // is the OPPOSITE one in each case, so the marks lean away from the cells.
  const insideOfX = axes.dataToPixel(xLo, yHi);
  const insideOfY = axes.dataToPixel(xHi, yLo);
  const xEdges = orient(axes.dataToPixel(xLo, yLo), axes.dataToPixel(xHi, yLo), insideOfX);
  const yEdges = orient(axes.dataToPixel(xLo, yLo), axes.dataToPixel(xLo, yHi), insideOfY);
  const build = (
    edges: readonly [{ x: number; y: number }, { x: number; y: number }],
    points: { x: number; y: number }[],
    prefix: 'hmx' | 'hmy'
  ): CategoryOverlayInput =>
    edges.every(finite) && points.every(finite)
      ? { edges: [edges[0], edges[1]], tickPoints: points, markEnds: false, tickId: (i) => `${prefix}:${i}` }
      : empty;

  return {
    x: build(xEdges, xs.map((x) => axes.dataToPixel(x, yLo)), 'hmx'),
    y: build(yEdges, ys.map((y) => axes.dataToPixel(xLo, y)), 'hmy'),
  };
}

/** Is this a grid handle, as opposed to a data point or a calibration reticle? */
export function isDividerHandle(id: string): boolean {
  return /^hm[xy]:\d+$/.test(id);
}

/**
 * Move the divider a handle belongs to, to where it was dropped.
 *
 * ⚑ ONLY THE COORDINATE THAT MATTERS IS READ. An x-divider takes the drop's x
 * and ignores its y entirely, so the gesture is constrained to the axis without
 * any special drag mode: drag it anywhere and it slides along its own axis.
 *
 * ⚑ RETURNS NULL WHEN THE MOVE IS REFUSED, which is the whole reason the model
 * owns this rule — `moveDivider` will not let a divider cross its neighbour,
 * because re-sorting would renumber every cell past it and file correct values
 * under the wrong column. The handle then springs back to where it was, and the
 * user sees the boundary stop.
 */
export function dragDivider(
  grid: HeatmapState,
  handleId: string,
  data: { x: number; y: number }
): HeatmapState | null {
  const match = /^hm([xy]):(\d+)$/.exec(handleId);
  if (!match) return null;
  const index = Number(match[2]);
  if (match[1] === 'x') {
    const next = moveDivider(grid.xDividers, index, data.x);
    return next === null ? null : { xDividers: next, yDividers: grid.yDividers };
  }
  const next = moveDivider(grid.yDividers, index, data.y);
  return next === null ? null : { xDividers: grid.xDividers, yDividers: next };
}

/**
 * Which divider a handle refers to, and what it currently sits at — so the card
 * can say *which* boundary is selected in the figure's own units rather than in
 * a handle id nobody typed.
 */
export function describeDivider(
  grid: HeatmapState,
  handleId: string
): { axis: 'x' | 'y'; index: number; value: number } | null {
  const match = /^hm([xy]):(\d+)$/.exec(handleId);
  if (!match) return null;
  const axis = match[1] === 'x' ? 'x' : 'y';
  const index = Number(match[2]);
  const dividers = axis === 'x' ? grid.xDividers : grid.yDividers;
  const value = dividers[index];
  return value === undefined ? null : { axis, index, value };
}

/**
 * Add a boundary on one axis, and say which handle it became.
 *
 * ⚑⚑ IT LANDS IN THE MIDDLE OF THE WIDEST CELL, and that is not an arbitrary
 * parking spot — it is where a MISSING boundary almost always belongs. When
 * detection finds six of the seven rules a figure draws, the cell it failed to
 * split is exactly twice its neighbours' width, so the widest cell IS the
 * evidence for where the seventh one goes. `detectGrid` already refuses to fill
 * a miss in and tells the user to place it by hand; this is the hand.
 *
 * ⚑ A STARTING POSITION, NEVER A CLAIM. The midpoint is arithmetic in data
 * coordinates, which on a log axis is not the middle of the drawn cell — and it
 * does not need to be, because nothing is recorded until the user drags it onto
 * the boundary they can see and reads the cells. Making it cleverer would
 * dress a guess up as a measurement (tenets 9 and 10).
 *
 * ⚑ THE NEW HANDLE'S ID COMES BACK so the caller can select it. A boundary that
 * appears somewhere in a twelve-column grid with nothing to say where is a
 * change the user has to hunt for.
 */
export function addDivider(
  grid: HeatmapState,
  axis: 'x' | 'y'
): { grid: HeatmapState; handleId: string } | null {
  const dividers = checkDividers(axis === 'x' ? grid.xDividers : grid.yDividers).dividers;
  if (dividers === null) return null;
  let widest = 0;
  for (let i = 1; i < dividers.length - 1; i++) {
    if (dividers[i + 1]! - dividers[i]! > dividers[widest + 1]! - dividers[widest]!) widest = i;
  }
  const at = (dividers[widest]! + dividers[widest + 1]!) / 2;
  const next = insertDivider(dividers, at);
  if (next === null) return null;
  const index = next.indexOf(at);
  if (index < 0) return null;
  return {
    grid: axis === 'x' ? { ...grid, xDividers: next } : { ...grid, yDividers: next },
    handleId: `hm${axis}:${index}`,
  };
}

/**
 * Remove the boundary a handle belongs to, merging the two cells it separated.
 *
 * ⚑ REFUSES to go below one cell, in the model rather than here: two dividers
 * ARE the grid's outer edges, and a heatmap with no interior is still a heatmap
 * with one cell. The card disables the button and says why, so the refusal is
 * read before it fires rather than after.
 */
export function removeDividerHandle(grid: HeatmapState, handleId: string): HeatmapState | null {
  const found = describeDivider(grid, handleId);
  if (found === null) return null;
  const dividers = found.axis === 'x' ? grid.xDividers : grid.yDividers;
  const next = removeDivider(dividers, found.index);
  if (next === null) return null;
  return found.axis === 'x' ? { ...grid, xDividers: next } : { ...grid, yDividers: next };
}

export interface DetectGridOptions {
  /** How many columns the figure has, if the user has said. A CHECK on the
   * answer, never a target — see `algorithms/gridDetect.ts`. */
  columns?: number;
  rows?: number;
}

export interface DetectGridResult {
  grid: HeatmapState | null;
  /** What to tell the user: agreement, a miss, or why nothing could be read. */
  message: string;
  /** True when a declared count was given and the detector agreed with it. */
  agrees: boolean;
}

/**
 * Propose a grid from the figure's own ink, between the grid's current outer
 * dividers.
 *
 * ⚑ PROPOSES. The result replaces the interior dividers and the user adjusts;
 * nothing is recorded until they read the cells.
 */
export function detectGrid(
  image: SourceImage,
  axes: PixelProjector,
  current: HeatmapState,
  options: DetectGridOptions = {}
): DetectGridResult {
  const xs = checkDividers(current.xDividers).dividers;
  const ys = checkDividers(current.yDividers).dividers;
  if (xs === null || ys === null) {
    return { grid: null, message: 'The grid needs an outer boundary on each axis before it can be filled in.', agrees: false };
  }
  const xMin = xs[0]!;
  const xMax = xs[xs.length - 1]!;
  const yMin = ys[0]!;
  const yMax = ys[ys.length - 1]!;
  const box: PlotBox = [
    axes.dataToPixel(xMin, yMin),
    axes.dataToPixel(xMax, yMin),
    axes.dataToPixel(xMin, yMax),
    axes.dataToPixel(xMax, yMax),
  ];

  const found = {
    x: detectDividers(image.data, image.width, image.height, box, 'x').candidates,
    y: detectDividers(image.data, image.width, image.height, box, 'y').candidates,
  };

  // Positions come back as fractions of the box; the grid speaks data.
  const toData = (fractions: readonly number[], lo: number, hi: number): number[] =>
    fractions.map((f) => lo + f * (hi - lo));

  const notes: string[] = [];
  const axisGrid = (
    axis: 'x' | 'y',
    lo: number,
    hi: number,
    count: number | undefined
  ): number[] | null => {
    const candidates = found[axis];
    const label = axis === 'x' ? 'columns' : 'rows';
    if (count === undefined) {
      notes.push(`${candidates.length} ${axis === 'x' ? 'column' : 'row'} boundaries found.`);
      return toData(proposeAllDividers(candidates), lo, hi);
    }
    const report = reconcileWithCount(candidates, count);
    const proposed = proposeDividers(candidates, count);
    if (proposed === null) {
      // ⚑⚑ THE BOUNDARIES THAT WERE MEASURED ARE KEPT; the missing ones are not
      // invented. This used to return NOTHING, on the argument that *"a grid
      // with a boundary missing looks exactly like a grid, and its cells are
      // silently twice as wide as the figure's."* The argument is right and the
      // remedy was wrong: discarding three correct measurements to avoid an
      // invisible error trades a measurement for a blank. The error is made
      // VISIBLE instead — the grid carries fewer cells than the declared count,
      // and the sentence says how many are missing, so the shortfall is on
      // screen twice over.
      //
      // ⚑ David: *"Why is the detection not working anymore?"* Before a count
      // was declared on every axis (case A1), a value axis took the
      // unconstrained path and proposed everything it found. Making the count
      // universal sent every axis down the checked path, where one faint rule
      // turned a good proposal into nothing at all.
      notes.push(
        `Found ${report.found} of the ${report.expected} boundaries needed for ${count} ${label} — the ${report.found} are placed, add the missing ${report.missing} by hand.`
      );
      return toData(proposeAllDividers(candidates), lo, hi);
    }
    notes.push(
      report.agrees
        ? `${count} ${label}, matching the ${report.found} boundaries found.`
        : `${count} ${label} taken from the ${report.found} boundaries found — check the extra ones.`
    );
    return toData(proposed, lo, hi);
  };

  const xGrid = axisGrid('x', xMin, xMax, options.columns);
  const yGrid = axisGrid('y', yMin, yMax, options.rows);
  if (xGrid === null && yGrid === null) {
    return { grid: null, message: notes.join(' '), agrees: false };
  }
  // ⚑⚑ ONE AXIS FAILING MUST NOT DISCARD THE OTHER. David typed a 6 where the
  // figure has 5 rows; detection found all four COLUMN boundaries, then threw
  // them away because the row count could not be met — leaving a 1 × 5 grid and
  // five cells of nonsense. The refusal was right about the rows and wrong about
  // everything else: a miss is reported per axis, and the axis that succeeded
  // keeps its result. The failed one keeps the dividers it already had, so
  // nothing is invented for it either.
  const keptX = xGrid ?? [...xs];
  const keptY = yGrid ?? [...ys];
  const agrees =
    xGrid !== null &&
    yGrid !== null &&
    (options.columns === undefined || reconcileWithCount(found.x, options.columns).agrees) &&
    (options.rows === undefined || reconcileWithCount(found.y, options.rows).agrees);
  return { grid: { xDividers: keptX, yDividers: keptY }, message: notes.join(' '), agrees };
}

/** One row of the heatmap table, already formatted for display. */
export interface HeatmapRow {
  col: number;
  row: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xCentre: number;
  yCentre: number;
  /** Null when the cell could not be read at all — shown as a dash, never a 0. */
  value: number | null;
  /**
   * The colour actually sampled, so the table can show WHERE the number came
   * from — David: *"Fill our cell with a color if it derived from color, and no
   * color if it is user set or OCR."* The indicator is the evidence itself, and
   * it turns the matrix into a miniature of the figure: a shadowed column shows
   * as a darker band beside numbers that look perfectly reasonable.
   */
  rgb?: readonly [number, number, number];
  /**
   * THE COLOUR THIS CELL IS DRAWN IN — the key's own ink at `keyPosition`.
   *
   * ⚑⚑ NOT `rgb`, AND THE DISTINCTION IS THE WHOLE POINT. David, 2026-08-15:
   * *"We need to have absolute MIRRORING of the colour between the heatmap, the
   * draggable colour key, and the output matrix. That is the ground truth"* —
   * and the direction that makes it reachable: *"the colour / tint ALWAYS == a
   * number… the colour we show is only its REPRESENTATION. Hence that is WHY it
   * is important that the colour follows the value, not the other way around."*
   *
   * So the two fields mean opposite things and neither can stand in for the
   * other. `rgb` is the ink that was MEASURED — evidence, which `colour offset`
   * and `uniformity` report on. `keyRgb` is the ink the key gives this value —
   * representation, and the only one that may be DRAWN.
   *
   * What follows for free:
   *   · a cell a person read (or OCR'd) gets its colour automatically, because
   *     the colour is a function of the number and the number changed. There is
   *     no provenance rule to write; the `[brackets]` carry that.
   *   · the figure, the key's caliper and the matrix cannot disagree, because
   *     all three are the same function of the same number.
   *   · a cell whose ink sat OFF the ramp stops being painted in a colour that
   *     corresponds to no value anywhere on the key — the one case where the old
   *     tint showed something meaningless.
   *
   * Undefined exactly when `keyPosition` is null: with no position there is no
   * colour to give it, and drawing one would invent a reading.
   */
  keyRgb?: readonly [number, number, number];
  /**
   * WHICH INSTRUMENT read this cell.
   *
   * ⚑⚑ All three are measurements and they fail in opposite ways — OCR reads
   * ink as GLYPHS and fails discretely (right, or badly wrong); the colour reads
   * ink as a RAMP and fails continuously (small, silent); the USER sees what
   * both machines are blind to — a hatched cell, an asterisk over the fill, a
   * texture the sampler averages away. A consumer treating an OCR'd 59 and a
   * colour-inverted 58.7 as the same kind of number is wrong about both.
   *
   * ⚑ Not the declared-vs-measured flag: nothing here is invented. This is WHICH
   * MEASUREMENT, which is why it belongs in the record.
   */
  source?: 'colour' | 'user' | 'ocr';
  /**
   * WHERE THIS CELL SITS ON THE COLOUR KEY, in the strip's own 0..1 frame.
   *
   * ⚑⚑ THE THIRD COORDINATE. A row has always carried `xCentre` and `yCentre` —
   * where the cell sits on the first two axes — and reported the third as a
   * NUMBER only. A heatmap is 2.5D: this is a coordinate exactly as those are,
   * and it is the one the whole figure exists to convey. Without it nothing can
   * draw a cell's value as a POSITION, which is what the key's marker needs and
   * what makes "editing a cell moves it along the key" something you can watch.
   *
   * ⚑ One number whichever instrument produced it: a colour-read cell comes back
   * through `positionAtValue` (exact for a monotone scale), a user-read one
   * reports the position that WAS stored — so the marker cannot drift from where
   * the user put it. Null when the cell has no reading to place.
   */
  keyPosition: number | null;
  low: number | null;
  high: number | null;
  /** How far the cell's colour sat off the key's ramp, in RGB units. */
  distance: number | null;
  uniformity: number;
  /** Other values this colour is equally consistent with. Non-empty means the
   * reading is AMBIGUOUS and must not be treated as a number. */
  rivalValues: number[];
  /** The cell's colour is the key's extreme, so the figure may have CLIPPED it —
   * the value could be this or anything beyond it. */
  atKeyLimit: boolean;
  /** The one-line verdict the table shows: what, if anything, is wrong with
   * this cell. Empty for a cell with nothing to report. */
  warning: string;
  /** The names printed on the axes for this cell, or `''` where the figure's
   * axis is a value axis (or the user has not typed that one yet). ⚑ These sit
   * BESIDE the coordinates, never instead of them: the bounds are measured off
   * the pixels and stay measured whatever the axis is called. */
  xLabel: string;
  yLabel: string;
  /** This coordinate is an ORDINAL — a counted position, not a measured one.
   * Rides into the export so a reader cannot mistake band 3 for 3 mm. */
  xIsCategory: boolean;
  yIsCategory: boolean;
}

/** How much of a cell may be something other than its colour before it is worth
 * saying so. Below 1 means SOMETHING is in the cell — a printed number, an
 * asterisk, JPEG noise — and on a real q35 JPEG this is the only signal that
 * caught a wrong reading whose colour sat exactly on the ramp. */
const UNIFORMITY_WORTH_REPORTING = 0.999;

/**
 * What is worth saying about a cell.
 *
 * ⚑⚑ TWO KINDS OF EVIDENCE, and `mine` is what separates them. The rivals, the
 * distance off the ramp and the clipping flag are properties of INVERTING A
 * COLOUR — they say nothing at all once a person has read the cell by eye, and
 * repeating them beside their number would be a machine's doubts attached to
 * someone else's measurement. Uniformity is a property of the CELL'S INK: a
 * hatched cell is still hatched after it is read correctly, and it is the
 * evidence for why the user looked twice rather than something the reading
 * disposes of.
 */
function warningFor(cell: HeatmapCellReading, mine: boolean): string {
  if (cell.samples === 0) return 'Not on the image';
  const parts: string[] = [];
  if (!mine) {
    if (cell.reading === null) return 'No value — the colour key cannot be read';
    if (cell.rivals.length > 0) parts.push(`${cell.rivals.length + 1} possible values`);
    // ⚑ First among the soft warnings, because it is the one nothing else
    // catches: a clipped cell is exact, uniform and wrong.
    if (cell.atKeyLimit) parts.push('at the key’s limit — may be clipped');
    if (cell.reading.distance > 0) parts.push(`colour ${cell.reading.distance.toFixed(1)} off the key`);
  }
  if (cell.uniformity < UNIFORMITY_WORTH_REPORTING) {
    parts.push(`${Math.round(cell.uniformity * 100)}% of the cell`);
  }
  return parts.join('; ');
}

export interface ReadHeatmapCellsResult {
  rows: HeatmapRow[];
  /** A one-line summary for the card: how many cells, and how many need a look. */
  summary: string;
  error: string | null;
}

/**
 * Read every cell, and say plainly how many of them can vouch for themselves.
 *
 * ⚑ THE SUMMARY IS THE POINT OF THE WHOLE FEATURE. In a heatmap the colour IS
 * the value, so a wrong cell has no other symptom — no gap in the trace, no
 * refusal, nothing odd on screen. Measured across three real renders, every
 * cell that reported itself clean was correct and every wrong one said so, but
 * that is only worth anything if the saying reaches the user.
 */
export function readHeatmapCells(
  image: SourceImage,
  axes: PixelProjector,
  grid: HeatmapState,
  scale: ColorScale,
  labels: HeatmapLabels = NO_HEATMAP_LABELS,
  kinds: HeatmapAxisKinds = { x: 'value', y: 'value' },
  /** The cells the user read themselves — positions on the key, applied through
   * the same inverse ours came out of. */
  readings: HeatmapCellReadings = NO_HEATMAP_CELL_READINGS
): ReadHeatmapCellsResult {
  const cells = readHeatmap(
    image.data,
    image.width,
    image.height,
    axes,
    grid.xDividers,
    grid.yDividers,
    scale
  );
  if (cells === null) {
    return { rows: [], summary: '', error: 'The grid needs at least one boundary on each axis.' };
  }
  const rows = cells.map((cell) => {
    // ⚑ THE USER'S READING GOES THROUGH THE SAME TRANSFORM OURS DOES — one
    // `valueAtPosition`, one key. That is what makes their number and ours
    // comparable at all, and what makes both of them move when the key does.
    const t = readings[cellKey(cell.col, cell.row)];
    const mineValue = t === undefined ? null : valueAtPosition(scale, t);
    const mine = mineValue !== null;
    // ⚑ Computed once, here, so the position and the colour drawn for it cannot
    // come from two different places.
    const keyPosition = mine
      ? t!
      : cell.reading === null
        ? null
        : positionAtValue(scale, cell.reading.value);
    const keyRgb = keyPosition === null ? null : colorAtPosition(scale.strip, keyPosition);
    return {
      col: cell.col,
      row: cell.row,
      xMin: cell.xMin,
      xMax: cell.xMax,
      yMin: cell.yMin,
      yMax: cell.yMax,
      xCentre: cell.xCentre,
      yCentre: cell.yCentre,
      value: mine ? mineValue : cell.reading?.value ?? null,
      // ⚑ The stored position exactly where there is one; otherwise back through
      // the same inverse the value came out of, so the two always agree.
      keyPosition,
      // ⚑ EVIDENCE. The ink that was actually there, kept only where the colour
      // WAS the reading — `colour offset` and `uniformity` report on it, and a
      // cell a person read has no measured ink of its own. It is no longer a
      // display input; see `keyRgb`.
      ...(cell.rgb && !mine ? { rgb: [cell.rgb[0], cell.rgb[1], cell.rgb[2]] as const } : {}),
      // ⚑ REPRESENTATION, for every cell that has a position — whichever
      // instrument produced it.
      ...(keyRgb ? { keyRgb: [keyRgb[0], keyRgb[1], keyRgb[2]] as const } : {}),
      source: mine ? ('user' as const) : ('colour' as const),
      // Null, not the typed number twice: a reading by eye has no measured
      // interval, and `low = high = value` would dress a bare number as one.
      low: mine ? null : cell.reading?.low ?? null,
      high: mine ? null : cell.reading?.high ?? null,
      distance: mine ? null : cell.reading?.distance ?? null,
      uniformity: cell.uniformity,
      rivalValues: mine ? [] : cell.rivals.map((r) => r.value),
      atKeyLimit: mine ? false : cell.atKeyLimit,
      warning: warningFor(cell, mine),
      xLabel: labelAt(labels.x, cell.col),
      yLabel: labelAt(labels.y, cell.row),
      xIsCategory: kinds.x === 'category',
      yIsCategory: kinds.y === 'category',
    };
  });
  const flagged = rows.filter((r) => r.warning !== '').length;
  const summary =
    flagged === 0
      ? `${rows.length} cells read, all clean.`
      : `${rows.length} cells read; ${flagged} need a look.`;
  return { rows, summary, error: null };
}
