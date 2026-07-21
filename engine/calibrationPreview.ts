/**
 * The geometry a calibration IMPLIES, drawn while you place it (checkpoint 84).
 *
 * **Why this is a tenet-1 fix and not decoration.** Until now we drew the
 * handles (ckpt 59's reticles) and *nothing between them* — so a mis-clicked
 * handle produced a **wrong-but-plausible chart, silently**. Every value on the
 * figure is wrong, and nothing on screen looks wrong. That is the
 * silent-bad-data failure at its purest: the app cannot get reliable data out
 * of a calibration the user cannot see.
 *
 * It is the same argument as ckpt 79's whisker rendering and ckpt 83's loupe:
 * **draw the derived thing, so a wrong-but-plausible result stops being
 * invisible.** A calibration is a claim about the figure's geometry; showing the
 * claim is what lets a human refute it.
 *
 * **Ported from WPD's own drawAxes** (`tools/axesCalibrationTools.js:179-245`)
 * plus its `CircularChartRecorderAlignmentRepainter` (`:280-299`), with three
 * deliberate divergences, each earning itself:
 *
 * 1. **Progressive, not all-or-nothing.** WPD gates on
 *    `getCount() === 4` — nothing appears until the last click. Each pair here
 *    draws as soon as *its own* two points exist, so you see the X axis you
 *    implied before you start on Y. Strictly more useful, and free: the pairs
 *    are independent by construction.
 * 2. **Coloured by the step, not by convention.** WPD hardcodes red for X and
 *    green for Y. Our steps already carry the colours their on-canvas reticles
 *    use (`x1` amber, `y1` blue), so a line is drawn in its own axis's colour and
 *    reads as belonging to those handles rather than as a third thing.
 * 3. **Polar and Map get a preview; upstream gives them none.** Both are just a
 *    line between two placed points (the radius vector, the scale bar), so the
 *    cost is zero and leaving two of seven types blind would be an odd place to
 *    stop (tenet 8: break with the stack when the solution wants it).
 *
 * Pure: geometry in, geometry out, image-pixel space. No DOM, no Konva. The
 * caller converts to screen space like every other overlay.
 */

import { getCircleFrom3Pts, type Vec2 } from '../core/mathFunctions.js';

export interface PreviewPoint {
  x: number;
  y: number;
}

/** A line the calibration implies — an axis, a scale bar, a triangle edge. */
export interface PreviewSegment {
  from: PreviewPoint;
  to: PreviewPoint;
  color: string;
}

/** A circle the calibration implies — a CCR pen arc or chart circle. */
export interface PreviewCircle {
  cx: number;
  cy: number;
  r: number;
  color: string;
}

export interface CalibrationPreview {
  segments: PreviewSegment[];
  circles: PreviewCircle[];
}

type AxesKind = 'xy' | 'bar' | 'polar' | 'ternary' | 'map' | 'ccr';

/**
 * Which placed points to join, per axes kind, by step key.
 *
 * Keyed on `axesKind` — the DECLARED capability — rather than on `config.id`,
 * so the whole XY family (XY, Histogram, and any future XY-backed type) gets the
 * preview automatically. That is checkpoint 73's rule, and the reason Histogram
 * needs no entry of its own here.
 */
const PAIRS: Record<AxesKind, readonly (readonly [string, string])[]> = {
  // The two axes the user actually implied. WPD draws exactly these.
  xy: [
    ['x1', 'x2'],
    ['y1', 'y2'],
  ],
  bar: [['p1', 'p2']],
  // The radius vectors. Upstream draws nothing for polar; these are the lines
  // whose ANGLE the calibration reads, so seeing them is the whole point.
  polar: [
    ['origin', 'p1'],
    ['origin', 'p2'],
  ],
  ternary: [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'a'],
  ],
  // The scale bar itself.
  map: [['p1', 'p2']],
  // CCR implies circles, not lines — see CIRCLE_TRIPLES.
  ccr: [],
};

/**
 * Which placed points fit a circle, per axes kind.
 *
 * **This is the one that matters most.** A CCR is calibrated from 5 clicks that
 * imply two arcs, and *nobody can eyeball whether 5 points imply the right
 * circle*. Fitting and drawing them live is the only way the user can tell —
 * which is exactly why WPD built a bespoke repainter for it and nothing else.
 * The triples mirror upstream's: points 0-1-2 are the pen arc, 2-3-4 the chart
 * circle, sharing point 2.
 */
const CIRCLE_TRIPLES: Partial<Record<AxesKind, readonly (readonly [string, string, string])[]>> = {
  ccr: [
    ['t0r0', 't0r1', 't0r2'],
    ['t0r2', 't1r2', 't2r2'],
  ],
};

/**
 * The geometry implied by whatever is placed so far.
 *
 * `placed` is the session's own map of step key -> pixel; a missing key simply
 * means that pair or triple isn't drawn yet. Returns empty rather than throwing
 * on anything degenerate — this is a drawing aid, and it must never be the
 * reason a calibration fails.
 */
export function calibrationPreview(
  config: { axesKind: AxesKind; steps: readonly { key: string; color: string }[] },
  placed: Readonly<Record<string, { px: number; py: number } | undefined>>
): CalibrationPreview {
  const at = (key: string): PreviewPoint | null => {
    const p = placed[key];
    return p ? { x: p.px, y: p.py } : null;
  };
  const colorOf = (key: string): string => config.steps.find((s) => s.key === key)?.color ?? '#888888';

  const segments: PreviewSegment[] = [];
  for (const [a, b] of PAIRS[config.axesKind] ?? []) {
    const from = at(a);
    const to = at(b);
    // Each pair is independent: draw as soon as ITS points exist, rather than
    // waiting for the whole calibration (WPD's all-or-nothing).
    if (from && to) segments.push({ from, to, color: colorOf(a) });
  }

  const circles: PreviewCircle[] = [];
  for (const [a, b, c] of CIRCLE_TRIPLES[config.axesKind] ?? []) {
    const p1 = at(a);
    const p2 = at(b);
    const p3 = at(c);
    if (!p1 || !p2 || !p3) continue;
    const pts: [Vec2, Vec2, Vec2] = [
      [p1.x, p1.y],
      [p2.x, p2.y],
      [p3.x, p3.y],
    ];
    const circle = getCircleFrom3Pts(pts);
    // Three collinear points have no circumcircle -- the fit blows up to an
    // infinite radius. Skipped rather than drawn: a preview that renders
    // garbage is worse than one that renders nothing, because the user would be
    // checking their calibration against OUR bug.
    if (!Number.isFinite(circle.x0) || !Number.isFinite(circle.y0) || !Number.isFinite(circle.radius)) continue;
    if (circle.radius <= 0 || circle.radius > 1e6) continue;
    circles.push({ cx: circle.x0, cy: circle.y0, r: circle.radius, color: colorOf(c) });
  }

  return { segments, circles };
}
