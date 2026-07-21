/**
 * What a measurement IS, numerically — the fourth "dataProviders" defect
 * (checkpoint 82), and the file `core/exportValues.ts:31` has been pointing at
 * since checkpoint 76 without it existing.
 *
 * **The defect this closes is tenet 9, not a missing port.** Measurements were
 * recorded as *formatted display strings*: `"45.0°"`, `"slope 1.234"`,
 * `"12.5 mm²"`. Two losses in one, and the second is the worse:
 *
 *  1. The glyph was baked into the value, so a consumer had to re-parse our own
 *     display format to get a number back.
 *  2. **`fmtNum` is `Number(n.toPrecision(4))`, and that string was the ONLY
 *     copy.** The raw double was never stored — not in the record, not in the
 *     project file, not in the CSV. A slope of `1.23456789` was destroyed at
 *     capture and unrecoverable from a saved project. The interpretation *was*
 *     the recording, which is the exact inversion tenet 9 exists to prevent.
 *
 * **The fix is not "store the number too" — it is to stop storing a value at
 * all.** A measurement's record is its **pixels** (already captured, already
 * serialized in the project file) plus which tool made it. The value is
 * *derived*, here, on demand. That is the same model the datasets already use
 * (`core/dataset.ts` stores `PixelPoint`, values come from `pixelToData`), and
 * it is what StarryDigitizer independently got right across 194k curves
 * (`Point = {id, xPx, yPx}`, values computed at read time).
 *
 * **It also makes Set-scale retroactive**, which was a separate logged defect:
 * measurements taken before a scale existed used to stay in pixels forever,
 * because the string was frozen at capture. Derived values simply re-derive —
 * the same way re-calibrating an axis re-derives every data point. Nothing
 * special was needed for it; it falls out of recording the right thing.
 *
 * **Field names follow WPD's own contract** (`dataProviders.js:294-356`):
 * Distance → `['Distance']`, Angle → `['Angle']`, Area → `['Area']`. We add
 * Slope, which WPD has no counterpart for. Upstream also emits a `Label`
 * column and Area's `Perimeter`; both are real and deliberately out of scope
 * here — this checkpoint changes what a value *is*, not how many there are.
 *
 * Pure per CLAUDE.md's leg (c): no DOM, no engine imports. The axes arrives as
 * a structural type, and formatting stays in `ui/` — a `core/` module that
 * returned `"45.0°"` would be re-committing the defect.
 */

/** The Measure tools. Slope is ours; the rest mirror WPD's measurement types. */
export type MeasureTool = 'distance' | 'angle' | 'area' | 'slope';

export interface Point2D {
  x: number;
  y: number;
}

/** A px→real-world scale (Set-scale), independent of the chart axes. */
export interface MeasureScale {
  unitPerPx: number;
  unit: string;
}

/** What a value needs beyond its own pixels. Both optional: an angle needs
 * neither, and a distance with no scale is still a real measurement in px. */
export interface MeasureContext {
  scale?: MeasureScale | null;
  /** Only Slope needs this — it is the one measurement in the CHART's units. */
  axes?: { pixelToData(px: number, py: number): number[] } | null;
}

/**
 * A derived measurement: raw numbers plus the unit they are in.
 *
 * `values` are **numbers, never strings** — that is the whole point. `unit` is
 * reported separately so a consumer can read the magnitude without parsing a
 * glyph off it, and so `ui/` can render "45.0°" without `core/` deciding what
 * "45.0" should look like.
 */
export interface MeasurementValue {
  /** Column headers, per WPD's contract where one exists. */
  fields: string[];
  values: number[];
  /** `'°'`, `'px'`, `'px²'`, a Set-scale unit, or `''` for a dimensionless
   * slope. Never concatenated into `values`. */
  unit: string;
}

/** Shoelace area of a closed polygon, in px². */
function polygonArea(points: readonly Point2D[]): number {
  let cross = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    cross += p.x * q.y - q.x * p.y;
  }
  return Math.abs(cross) / 2;
}

/**
 * The measurement `tool` makes from `points`, or null if the geometry is
 * incomplete.
 *
 * **Every call derives from scratch**, so a later Set-scale or re-calibration
 * is reflected immediately and everywhere — screen, table and export cannot
 * drift apart, because there is only one place the number comes from.
 */
export function measurementValue(
  tool: MeasureTool,
  points: readonly Point2D[],
  ctx: MeasureContext = {}
): MeasurementValue | null {
  switch (tool) {
    case 'distance': {
      if (points.length < 2) return null;
      const [a, b] = [points[0]!, points[1]!];
      const px = Math.hypot(b.x - a.x, b.y - a.y);
      // No scale is not a failure -- a length in pixels is a real, honest
      // measurement, and saying so beats inventing a unit.
      return ctx.scale
        ? { fields: ['Distance'], values: [px * ctx.scale.unitPerPx], unit: ctx.scale.unit }
        : { fields: ['Distance'], values: [px], unit: 'px' };
    }
    case 'area': {
      if (points.length < 3) return null;
      const px = polygonArea(points);
      return ctx.scale
        ? {
            fields: ['Area'],
            values: [px * ctx.scale.unitPerPx * ctx.scale.unitPerPx],
            unit: `${ctx.scale.unit}²`,
          }
        : { fields: ['Area'], values: [px], unit: 'px²' };
    }
    case 'angle': {
      if (points.length < 3) return null;
      // points are [arm, vertex, arm] -- the order the canvas draws them in.
      const [a, v, b] = [points[0]!, points[1]!, points[2]!];
      const ux = a.x - v.x;
      const uy = a.y - v.y;
      const wx = b.x - v.x;
      const wy = b.y - v.y;
      // atan2 of the cross/dot pair, not acos of the normalized dot: it stays
      // accurate for angles near 0 and 180, where acos loses precision.
      const deg = (Math.abs(Math.atan2(ux * wy - uy * wx, ux * wx + uy * wy)) * 180) / Math.PI;
      // Scale-invariant by construction, so it needs no context at all.
      return { fields: ['Angle'], values: [deg], unit: '°' };
    }
    case 'slope': {
      if (points.length < 2 || !ctx.axes) return null;
      const [a, b] = [points[0]!, points[1]!];
      const d1 = ctx.axes.pixelToData(a.x, a.y);
      const d2 = ctx.axes.pixelToData(b.x, b.y);
      const x1 = d1[0];
      const y1 = d1[1];
      const x2 = d2[0];
      const y2 = d2[1];
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
      // A vertical secant is Infinity, which is REPORTED, not swallowed: it is
      // the true answer to "what is the slope here", and `unit: ''` keeps it a
      // number rather than the string "∞ (vertical)" the old record stored.
      return { fields: ['Slope'], values: [(y2 - y1) / (x2 - x1)], unit: '' };
    }
  }
}

/** Slope's Δx/Δy in chart units — the detail the card shows beside the slope.
 * Derived like everything else here rather than frozen into a note string. */
export function slopeDeltas(
  points: readonly Point2D[],
  axes: { pixelToData(px: number, py: number): number[] } | null | undefined
): { dx: number; dy: number } | null {
  if (points.length < 2 || !axes) return null;
  const d1 = axes.pixelToData(points[0]!.x, points[0]!.y);
  const d2 = axes.pixelToData(points[1]!.x, points[1]!.y);
  const x1 = d1[0];
  const y1 = d1[1];
  const x2 = d2[0];
  const y2 = d2[1];
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
  return { dx: x2 - x1, dy: y2 - y1 };
}

/** The measurement's pixel-space magnitude — what the card shows as the
 * secondary "12.5 px" note when a scale is in play. Kept here so the pixel and
 * scaled forms cannot drift. */
export function measurementPixelValue(tool: MeasureTool, points: readonly Point2D[]): number | null {
  const raw = measurementValue(tool, points, {});
  if (!raw) return null;
  return tool === 'slope' ? null : raw.values[0]!;
}
