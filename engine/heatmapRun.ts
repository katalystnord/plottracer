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

import { sampleColorBar, type ColorBarRefusal } from '../algorithms/colorBar.js';
import { checkColorScale, type ColorScale } from '../algorithms/colorScale.js';
import {
  detectDividers,
  proposeAllDividers,
  proposeDividers,
  reconcileWithCount,
  type PlotBox,
} from '../algorithms/gridDetect.js';
import { readHeatmap, type HeatmapCellReading, type PixelProjector } from '../algorithms/heatmapRead.js';
import { checkDividers, insertDivider, moveDivider, removeDivider } from '../core/heatmapGrid.js';
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
  isLog: boolean,
  thickness = 5
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

  const sampled = sampleColorBar(
    image.data,
    image.width,
    image.height,
    { x: k1.px, y: k1.py },
    { x: k2.px, y: k2.py },
    { thickness }
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
 * A draggable handle for one divider, in image pixels.
 *
 * ⚑ THE HANDLES SIT OUTSIDE THE PLOT, on the axis the divider belongs to. Put
 * them on the line itself and they cover the cells the user is trying to read —
 * and a heatmap is nothing BUT the thing they would cover. Off the edge, the
 * grid stays legible while it is being adjusted, which is the only time its
 * exact position matters.
 */
export interface DividerHandle {
  /** `hmx:3` / `hmy:0` — the axis and the index, so a drag knows what it moved. */
  id: string;
  x: number;
  y: number;
}

/** How far outside the plot box a handle sits, in pixels. */
const HANDLE_OFFSET_PX = 16;

/**
 * Where to draw a grab handle for every divider.
 *
 * ⚑ The offset direction is COMPUTED from the axes rather than assumed to be
 * "down" and "left": a figure calibrated upside down, or a rotated scan, has its
 * own idea of which way is out of the plot, and handles that ignored it would
 * sit inside the figure on exactly the charts that are hardest to read already.
 */
export function dividerHandles(grid: HeatmapState, axes: PixelProjector): DividerHandle[] {
  const xs = checkDividers(grid.xDividers).dividers;
  const ys = checkDividers(grid.yDividers).dividers;
  if (xs === null || ys === null) return [];
  const [yLo, yHi] = [ys[0]!, ys[ys.length - 1]!];
  const [xLo, xHi] = [xs[0]!, xs[xs.length - 1]!];

  const outward = (from: { x: number; y: number }, towards: { x: number; y: number }) => {
    const dx = from.x - towards.x;
    const dy = from.y - towards.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!Number.isFinite(len) || len === 0) return { x: 0, y: 0 };
    return { x: (dx / len) * HANDLE_OFFSET_PX, y: (dy / len) * HANDLE_OFFSET_PX };
  };

  const handles: DividerHandle[] = [];
  const xOut = outward(axes.dataToPixel(xLo, yLo), axes.dataToPixel(xLo, yHi));
  xs.forEach((x, i) => {
    const p = axes.dataToPixel(x, yLo);
    handles.push({ id: `hmx:${i}`, x: p.x + xOut.x, y: p.y + xOut.y });
  });
  const yOut = outward(axes.dataToPixel(xLo, yLo), axes.dataToPixel(xHi, yLo));
  ys.forEach((y, i) => {
    const p = axes.dataToPixel(xLo, y);
    handles.push({ id: `hmy:${i}`, x: p.x + yOut.x, y: p.y + yOut.y });
  });
  return handles.filter((h) => Number.isFinite(h.x) && Number.isFinite(h.y));
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
      // ⚑ A miss is REPORTED, never filled in. A grid with a boundary missing
      // looks exactly like a grid, and its cells are silently twice as wide as
      // the figure's.
      notes.push(
        `Found ${report.found} of the ${report.expected} boundaries needed for ${count} ${label} — place the missing ones by hand.`
      );
      return null;
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
  if (xGrid === null || yGrid === null) {
    return { grid: null, message: notes.join(' '), agrees: false };
  }
  const agrees =
    (options.columns === undefined || reconcileWithCount(found.x, options.columns).agrees) &&
    (options.rows === undefined || reconcileWithCount(found.y, options.rows).agrees);
  return { grid: { xDividers: xGrid, yDividers: yGrid }, message: notes.join(' '), agrees };
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
}

/** How much of a cell may be something other than its colour before it is worth
 * saying so. Below 1 means SOMETHING is in the cell — a printed number, an
 * asterisk, JPEG noise — and on a real q35 JPEG this is the only signal that
 * caught a wrong reading whose colour sat exactly on the ramp. */
const UNIFORMITY_WORTH_REPORTING = 0.999;

function warningFor(cell: HeatmapCellReading): string {
  if (cell.samples === 0) return 'Not on the image';
  if (cell.reading === null) return 'No value — the colour key cannot be read';
  const parts: string[] = [];
  if (cell.rivals.length > 0) parts.push(`${cell.rivals.length + 1} possible values`);
  // ⚑ First among the soft warnings, because it is the one nothing else catches:
  // a clipped cell is exact, uniform and wrong.
  if (cell.atKeyLimit) parts.push('at the key’s limit — may be clipped');
  if (cell.reading.distance > 0) parts.push(`colour ${cell.reading.distance.toFixed(1)} off the key`);
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
  labels: HeatmapLabels = NO_HEATMAP_LABELS
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
  const rows = cells.map((cell) => ({
    col: cell.col,
    row: cell.row,
    xMin: cell.xMin,
    xMax: cell.xMax,
    yMin: cell.yMin,
    yMax: cell.yMax,
    xCentre: cell.xCentre,
    yCentre: cell.yCentre,
    value: cell.reading?.value ?? null,
    low: cell.reading?.low ?? null,
    high: cell.reading?.high ?? null,
    distance: cell.reading?.distance ?? null,
    uniformity: cell.uniformity,
    rivalValues: cell.rivals.map((r) => r.value),
    atKeyLimit: cell.atKeyLimit,
    warning: warningFor(cell),
    xLabel: labelAt(labels.x, cell.col),
    yLabel: labelAt(labels.y, cell.row),
  }));
  const flagged = rows.filter((r) => r.warning !== '').length;
  const summary =
    flagged === 0
      ? `${rows.length} cells read, all clean.`
      : `${rows.length} cells read; ${flagged} need a look.`;
  return { rows, summary, error: null };
}
