import type { MeasureTool, Point2D } from '../core/measurementValues.js';

/**
 * What a click in the Measure tool DOES: keep collecting, or close a
 * measurement. Recording it, and formatting anything, stay in `ui/`.
 *
 * ⚑ THE ONE RULE THIS FILE MUST NOT BREAK, from `core/measurementValues.ts`:
 * *"formatting stays in ui/ - a core/ module that returned `"45.0°"` would be
 * re-committing the defect."* A measurement's record is its PIXELS plus which
 * tool made it; every value is derived on demand, which is what makes Set-scale
 * retroactive. So `record` hands back points and, for a slope, a raw NUMBER -
 * never a display string.
 */

export interface MeasureClickInput {
  /** The clicked point, already snapped (see `snapToNearestPoint`). */
  point: Point2D;
  /** Points already down for the measurement in hand. */
  pending: readonly Point2D[];
  /** Set-scale is armed: two clicks a known real distance apart. */
  settingScale: boolean;
  /** Null behaves as Area - accumulate until the user closes it. */
  tool: MeasureTool | null;
  /** A slope needs a calibrated XY chart; nothing else does. */
  slopeReady: boolean;
  /** Pixel → data, for the slope only. */
  toData: ((x: number, y: number) => readonly (number | null)[]) | null;
}

export type MeasureClickResult =
  /** Not enough points yet - hold these and wait. */
  | { kind: 'collect'; points: Point2D[] }
  /** Both set-scale points are down; the value+unit form takes over. */
  | { kind: 'scale-draft'; points: Point2D[]; distancePx: number }
  | { kind: 'refuse'; message: string }
  /** Close the measurement. `slope` is the raw quotient, for the slope tool only. */
  | { kind: 'record'; tool: MeasureTool; points: Point2D[]; labelAt: Point2D; slope?: number };

const mid = (a: Point2D, b: Point2D): Point2D => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Snap a measurement vertex onto a nearby active-series DATA point (v1.1) -
 * David's *"measure from one identified point"*.
 *
 * ⚑ The threshold is ~12 SCREEN px, converted into the click's own space by
 * dividing by the zoom, so the snap feels the same at every magnification
 * rather than growing as you zoom in. Ties keep the first point found, and a
 * click with nothing near it is returned untouched - snapping is an assist, so
 * it must never move a vertex the user placed deliberately in open space.
 */
export function snapToNearestPoint(
  px: number,
  py: number,
  points: readonly { px: number; py: number }[],
  canvasScale: number
): Point2D {
  const snapThresh = 12 / Math.max(canvasScale, 1e-4);
  let best = snapThresh;
  let out: Point2D = { x: px, y: py };
  for (const p of points) {
    const d = Math.hypot(p.px - px, p.py - py);
    if (d < best) {
      best = d;
      out = { x: p.px, y: p.py };
    }
  }
  return out;
}

export function resolveMeasureClick({
  point,
  pending,
  settingScale,
  tool,
  slopeReady,
  toData,
}: MeasureClickInput): MeasureClickResult {
  const points = [...pending, point];

  // Set-scale outranks the tool: two clicks a known real distance apart.
  if (settingScale) {
    if (points.length < 2) return { kind: 'collect', points };
    const [a, b] = points as [Point2D, Point2D];
    // Both dots stay visible beneath the form.
    return { kind: 'scale-draft', points, distancePx: Math.hypot(b.x - a.x, b.y - a.y) };
  }

  if (tool === 'slope') {
    // ⚑ axesKind, not id - a calibrated HISTOGRAM is XY underneath and measures
    // a slope perfectly well. Resolved by the caller and passed as a capability.
    if (!slopeReady || !toData) return { kind: 'refuse', message: 'Calibrate an XY chart first to measure a slope.' };
    if (points.length < 2) return { kind: 'collect', points };
    const [a, b] = points as [Point2D, Point2D];
    const d1 = toData(a.x, a.y);
    const d2 = toData(b.x, b.y);
    const slope = (d2[1]! - d1[1]!) / (d2[0]! - d1[0]!);
    return { kind: 'record', tool: 'slope', points, labelAt: mid(a, b), slope };
  }

  if (tool === 'distance') {
    if (points.length < 2) return { kind: 'collect', points };
    const [a, b] = points as [Point2D, Point2D];
    return { kind: 'record', tool: 'distance', points, labelAt: mid(a, b) };
  }

  if (tool === 'angle') {
    if (points.length < 3) return { kind: 'collect', points };
    // ⚑ Clicks arrive VERTEX-FIRST; the record stores [arm, vertex, arm], the
    // order both the canvas and measurementValue() read. Getting this wrong
    // measures the angle at an arm instead of at the vertex the user aimed at,
    // and the number still looks plausible.
    const [v, a, b] = points as [Point2D, Point2D, Point2D];
    return { kind: 'record', tool: 'angle', points: [a, v, b], labelAt: v };
  }

  // Area (and a tool not yet chosen): accumulate polygon vertices; the card's
  // Finish button / Enter closes it.
  return { kind: 'collect', points };
}
