/**
 * Pure geometry for the box-and-whisker glyph (checkpoint 22, see
 * CLAUDE.md), deferred from checkpoint 21's Point Groups interaction
 * model. Faithful port of the current app's drawBoxGlyph
 * (ui-patches/overrides.js, commit c0b6021) from wpd's own image-space
 * canvas drawing calls into pure, framework-agnostic segment math --
 * the render layer (ui/'s ImageCanvas.tsx) converts each segment's
 * image-space endpoints to screen space via engine/canvasView.ts's
 * imageToScreen and draws them as Konva Lines, the same split every
 * other engine/ module already uses.
 *
 * The original computes everything in abstract (value, cross)
 * coordinates so a single implementation covers both Bar axes
 * orientations: vertical (value varies along pixel-Y, category
 * position along pixel-X) and horizontal/rotated (value along
 * pixel-X, position along pixel-Y). Preserved here unchanged.
 */

export interface Point2D {
  x: number;
  y: number;
}

/** Pixel positions of a completed box-plot tuple's 5 points, one per
 * Min/Q1/Median/Q3/Max group in that order. */
export interface BoxPlotPoints {
  min: Point2D;
  q1: Point2D;
  median: Point2D;
  q3: Point2D;
  max: Point2D;
}

export type BoxPlotOrientation = 'vertical' | 'horizontal';

export interface BoxPlotGlyphSegment {
  from: Point2D;
  to: Point2D;
}

/** Half-width of the box and its end-caps, in image pixels -- same fixed
 * constants as the original drawBoxGlyph. */
const BOX_HALF = 20;
const CAP_HALF = 10;

/** Builds the 9 line segments of a box-and-whisker glyph (2 whiskers, 2 end
 * caps, 4 box sides, 1 median line) from a completed tuple's pixel
 * positions, in image-pixel space. */
export function computeBoxPlotGlyph(points: BoxPlotPoints, orientation: BoxPlotOrientation): BoxPlotGlyphSegment[] {
  const isVertical = orientation === 'vertical';
  const toVC = (p: Point2D) => (isVertical ? { v: p.y, c: p.x } : { v: p.x, c: p.y });
  const toXY = (v: number, c: number): Point2D => (isVertical ? { x: c, y: v } : { x: v, y: c });

  const vc = {
    min: toVC(points.min),
    q1: toVC(points.q1),
    median: toVC(points.median),
    q3: toVC(points.q3),
    max: toVC(points.max),
  };
  const cross = (vc.min.c + vc.q1.c + vc.median.c + vc.q3.c + vc.max.c) / 5;

  const segments: BoxPlotGlyphSegment[] = [];
  const line = (v1: number, c1: number, v2: number, c2: number) => {
    segments.push({ from: toXY(v1, c1), to: toXY(v2, c2) });
  };

  // whiskers (box edge to min/max) + end caps
  line(vc.min.v, cross, vc.q1.v, cross);
  line(vc.q3.v, cross, vc.max.v, cross);
  line(vc.min.v, cross - CAP_HALF, vc.min.v, cross + CAP_HALF);
  line(vc.max.v, cross - CAP_HALF, vc.max.v, cross + CAP_HALF);

  // box (4 sides between Q1 and Q3)
  line(vc.q1.v, cross - BOX_HALF, vc.q1.v, cross + BOX_HALF);
  line(vc.q1.v, cross + BOX_HALF, vc.q3.v, cross + BOX_HALF);
  line(vc.q3.v, cross + BOX_HALF, vc.q3.v, cross - BOX_HALF);
  line(vc.q3.v, cross - BOX_HALF, vc.q1.v, cross - BOX_HALF);

  // median line
  line(vc.median.v, cross - BOX_HALF, vc.median.v, cross + BOX_HALF);

  return segments;
}
