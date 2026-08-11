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
 */

import {
  checkStripSamples,
  sampleColorBar,
  type ColorBarRefusal,
  type ColorBarStrip,
} from '../algorithms/colorBar.js';
import { checkColorScale, type ColorScale } from '../algorithms/colorScale.js';
import {
  detectDividers,
  proposeAllDividers,
  proposeDividers,
  reconcileWithCount,
  type PlotBox,
} from '../algorithms/gridDetect.js';
import { readHeatmap, type HeatmapCellReading, type PixelProjector } from '../algorithms/heatmapRead.js';
import { checkDividers } from '../core/heatmapGrid.js';
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

/** Re-check a strip that arrived from somewhere other than `sampleColorBar` —
 * the load path's own entrance to the same model. */
export function checkLoadedStrip(strip: ColorBarStrip): string | null {
  const reason = checkStripSamples(strip.samples);
  return reason === null ? null : stripRefusalSentence(reason);
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
  /** The one-line verdict the table shows: what, if anything, is wrong with
   * this cell. Empty for a cell with nothing to report. */
  warning: string;
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
  scale: ColorScale
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
    warning: warningFor(cell),
  }));
  const flagged = rows.filter((r) => r.warning !== '').length;
  const summary =
    flagged === 0
      ? `${rows.length} cells read, all clean.`
      : `${rows.length} cells read; ${flagged} need a look.`;
  return { rows, summary, error: null };
}
