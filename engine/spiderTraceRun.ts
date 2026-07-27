/**
 * Spider colour-trace orchestration (v1.4) — the policy layer on top of
 * algorithms/spiderTrace.ts, the sibling of engine/colorTraceRun.ts.
 *
 * The generic colour trace reduces a mask one point per COLUMN, which is a curve
 * tool: on a radar chart it would return the polygon's outline as a sideways
 * scribble, with no idea which axis any of it belonged to. Here the calibrated rays
 * do the reducing — one reading per axis, read where the series crosses that axis,
 * which is the only place a radar chart states a number.
 *
 * ⚑ ASSIST, NEVER SWEEP. This returns one READING per spoke, each carrying why it
 * is or is not offered, and records nothing itself. Where the evidence is ambiguous
 * the reading is null and the runs ride along, so the user is shown what was found
 * instead of being handed a number that merely looks like a measurement.
 */

import { colorFilter, type RGB, type ColorFilterMode, type FilterRegion } from '../algorithms/colorFilter.js';
import { traceSpiderAlongSpokes, type SpiderTraceOptions, type SpokeRun } from '../algorithms/spiderTrace.js';
import type { SpiderAxes } from '../core/axes/spider.js';

export interface SpiderReading {
  /** Spoke index — the slot / table row this reading belongs to. */
  index: number;
  /** The axis's name, for the message. Empty when the figure's was illegible. */
  name: string;
  /** Image pixel to record, or null where nothing is offered. */
  point: { x: number; y: number } | null;
  /** The value that pixel reads on THIS axis's scale — for the report only; the
   * record still derives it from the stored pixel, as every other capture does. */
  value: number | null;
  /** Null when a single unambiguous crossing was found. */
  reason: 'none-found' | 'ambiguous' | 'clipped' | null;
  /** Every stretch of the colour found along the ray, so an ambiguous refusal can
   * show its evidence rather than just saying no. */
  runs: readonly SpokeRun[];
}

export interface SpiderTraceRunSuccess {
  readings: SpiderReading[];
  /** Matched-pixel count, for the same over-broad warning the curve trace gives. */
  matched: number;
}

export type SpiderTraceRunResult = SpiderTraceRunSuccess | { error: string };

const MIN_MATCHED_PIXELS = 3;

/**
 * The bounding box of the calibrated spider, as a FilterRegion: the centre plus
 * every spoke's known point, grown by the overshoot the tracer itself looks
 * through. Radar charts put the axis LABELS outside that box in the same ink the
 * grid uses, so a first pass stays inside the web — and, like the XY plot box, it
 * stays visible and adjustable rather than being applied invisibly.
 */
export function spiderBoxRegion(axes: SpiderAxes | null | undefined, overshoot = 0.15): FilterRegion | null {
  // Takes a possibly-absent axes because the caller's does not exist until the walk
  // is finished, and "no axes yet" is the ordinary state, not a programming error.
  if (!axes?.isCalibrated()) return null;
  const origin = axes.getOrigin();
  const xs = [origin.x];
  const ys = [origin.y];
  for (const spoke of axes.getSpokes()) {
    const reach = spoke.lengthPx * (1 + overshoot);
    xs.push(origin.x + reach * spoke.ux);
    ys.push(origin.y + reach * spoke.uy);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/**
 * Walk every calibrated ray through the colour mask and report what crosses it.
 *
 * Fails with a clear message rather than offering a near-empty trace when almost
 * nothing matched — the same rule runColorTrace follows, and for the same reason:
 * an empty result the user has to interpret is worse than being told to repick.
 */
export function runSpiderTrace(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  axes: SpiderAxes | null | undefined,
  target: RGB,
  tolerance: number,
  mode: ColorFilterMode = 'foreground',
  region?: FilterRegion,
  options?: SpiderTraceOptions
): SpiderTraceRunResult {
  if (!axes?.isCalibrated()) {
    return { error: 'Calibrate the axes first — a trace along the rays needs them.' };
  }
  const { mask, count } = colorFilter(data, width, height, target, tolerance, mode, region);
  if (count < MIN_MATCHED_PIXELS) {
    return { error: 'No pixels matched that colour. Repick the series colour, or raise the tolerance.' };
  }

  const origin = axes.getOrigin();
  const spokes = axes.getSpokes();
  const candidates = traceSpiderAlongSpokes(mask, width, height, origin, spokes, options);

  const readings = candidates.map((candidate): SpiderReading => {
    const spoke = spokes[candidate.index]!;
    const point =
      candidate.atPx == null
        ? null
        : { x: origin.x + candidate.atPx * spoke.ux, y: origin.y + candidate.atPx * spoke.uy };
    return {
      index: candidate.index,
      name: axes.getSpokeLabel(candidate.index),
      point,
      // Read back through the SAME projection the capture path uses, against this
      // spoke -- not computed from atPx here. One route to a value, so the number
      // reported can never drift from the number recorded.
      value: point == null ? null : axes.projectOnSpoke(candidate.index, point.x, point.y)!.value,
      reason: candidate.reason,
      runs: candidate.runs,
    };
  });

  return { readings, matched: count };
}
