/**
 * Bin glyph geometry (checkpoint 66) — the on-canvas drawing that makes a
 * captured histogram bin *look* like a bin, mirroring what
 * engine/boxPlotGlyph.ts does for a Box Plot tuple.
 *
 * Without it, a captured bin renders as two unrelated numbered dots and the
 * user has to hold the pairing in their head — the interval, which is the
 * whole point of capturing a histogram properly, would be the one thing not
 * actually visible. (Caught driving the real app, checkpoint 66.)
 *
 * Pixel-space rendering geometry, so it lives in engine/ next to its sibling
 * rather than in algorithms/ with the bin *math* (which is headless and knows
 * nothing about how a bin is drawn).
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface GlyphSegment {
  from: Point2D;
  to: Point2D;
}

/** Length of the downward edge ticks, in image pixels. Short enough not to
 * bury the bar it sits on, long enough to read as an edge rather than a
 * stray dot -- same spirit as boxPlotGlyph.ts's own fixed constants. */
const EDGE_TICK = 12;

/**
 * A bin drawn as a staple: the top span between the two captured corners,
 * plus a short tick dropping at each edge.
 *
 * Deliberately not a full rectangle down to the baseline. The baseline is a
 * *derived* guess (the bar's foot isn't captured and needn't be at y=0 -- the
 * axis may be cropped or offset), so drawing one would assert something the
 * data doesn't say. The staple shows exactly what was measured: this
 * interval, at this height.
 *
 * Corners come in click order; the span is drawn between them as given, since
 * a line is symmetric and the ordering only matters to the bin math.
 */
export function computeBinGlyph(a: Point2D, b: Point2D): GlyphSegment[] {
  return [
    { from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } },
    { from: { x: a.x, y: a.y }, to: { x: a.x, y: a.y + EDGE_TICK } },
    { from: { x: b.x, y: b.y }, to: { x: b.x, y: b.y + EDGE_TICK } },
  ];
}
