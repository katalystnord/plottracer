/**
 * The geometry a calibration IMPLIES, drawn while you place it (checkpoint 84).
 *
 * **Why this is a tenet-1 fix and not decoration.** Until now we drew the
 * handles (ckpt 59's reticles) and *nothing between them* - so a mis-clicked
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
 *    `getCount() === 4` - nothing appears until the last click. Each pair here
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

import { getCircleFrom3Pts, fitCircle, type Vec2 } from '../core/mathFunctions.js';

export interface PreviewPoint {
  x: number;
  y: number;
}

/** A line the calibration implies - an axis, a scale bar, a triangle edge. */
export interface PreviewSegment {
  from: PreviewPoint;
  to: PreviewPoint;
  color: string;
  /** Draw this one as THE one being worked on right now (v1.4, Spider): the axis
   * the capture cursor is filling. Everything else dims.
   *
   * ⚑ Prevention rather than correction. A spider's spoke ORDER is deliberately
   * not enforced at calibration -- the user places the rays in whatever order
   * suits them -- so the capture cursor walks them in CALIBRATION order, which
   * need not match the visual order round the chart. A user going clockwise by eye
   * can therefore drift out of step with the cursor, click the vertex on the wrong
   * spoke, and have it projected onto the axis the cursor was actually filling: at
   * 120 degrees that turns an intended 50 into -25, sitting on the right row and
   * looking entirely deliberate. Showing which ray is live is what stops the drift
   * happening at all, rather than reporting it afterwards. */
  emphasis?: boolean;
}

/** A circle the calibration implies - a CCR pen arc or chart circle. */
export interface PreviewCircle {
  cx: number;
  cy: number;
  r: number;
  color: string;
  /**
   * A MARKER rather than a measured circle: drawn solid, with crosshair arms, at a
   * fixed SCREEN size that does not scale with zoom.
   *
   * ⚑ The distinction is real and not cosmetic. A fitted rim is a measurement and must
   * scale, because its whole job is lying on the ink. A derived centre has no extent to
   * be true to -- only a position -- so scaling it makes it vanish at low zoom, which
   * is exactly the zoom where you are looking at the whole figure to judge whether the
   * middle landed right. `r` is then in screen pixels.
   */
  marker?: boolean;
}

export interface CalibrationPreview {
  segments: PreviewSegment[];
  circles: PreviewCircle[];
}

type AxesKind = 'xy' | 'bar' | 'polar' | 'ternary' | 'map' | 'ccr' | 'spider' | 'pie';

/**
 * Which placed points to join, per axes kind, by step key.
 *
 * Keyed on `axesKind` - the DECLARED capability - rather than on `config.id`,
 * so the whole XY family (XY, Histogram, and any future XY-backed type) gets the
 * preview automatically. That is checkpoint 73's rule, and the reason Histogram
 * needs no entry of its own here.
 */
/** The colour a LIVE calibration segment is drawn in - the same magenta the
 * colour-match preview paints with (Workspace's COLOR_TRACE_PREVIEW_RGBA, ckpt
 * 121), picked there for reading clearly over typical scientific figures without
 * being mistaken for a series colour. Both are the app pointing at the image. */
const LIVE_STEP_COLOR = '#ff00c8';

const PAIRS: Record<AxesKind, readonly (readonly [string, string])[]> = {
  // The two axes the user actually implied. WPD draws exactly these.
  xy: [
    ['x1', 'x2'],
    ['y1', 'y2'],
  ],
  bar: [['p1', 'p2']],
  // ⚑ Nothing to JOIN on a pie: its calibration is a set of points around the
  // outline, and the thing worth drawing is the CIRCLE fitted through them, not
  // segments between them. That is the whole point of the preview here -- seeing the
  // fitted circle laid back over the figure is what catches a mis-clicked rim point,
  // and on a donut it is the only way to see whether the derived centre landed
  // right, since there is no centre in the image to compare it against.
  pie: [],
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
  // CCR implies circles, not lines - see CIRCLE_TRIPLES.
  ccr: [],
  // Spider's rays cannot be a fixed list: the spoke count belongs to the figure,
  // not to the type. Built from the placed steps instead - see spiderPairs below.
  spider: [],
};

/**
 * Spider's rays: the centre joined to each placed spoke, derived from the step
 * list rather than declared.
 *
 * ⚑ This is the preview that matters most for spider, for the CCR reason. A ray's
 * DIRECTION is measured from a single click, so a spoke clicked slightly off the
 * printed axis tilts the whole scale - and every value along it moves - with
 * nothing on screen wrong. Drawing the rays as they are placed is how the user
 * sees that the lines they implied are the lines the figure drew.
 */
function spiderPairs(steps: readonly { key: string }[]): readonly (readonly [string, string])[] {
  return steps.filter((s) => s.key !== 'origin').map((s) => ['origin', s.key] as const);
}

/**
 * Which placed points fit a circle, per axes kind.
 *
 * **This is the one that matters most.** A CCR is calibrated from 5 clicks that
 * imply two arcs, and *nobody can eyeball whether 5 points imply the right
 * circle*. Fitting and drawing them live is the only way the user can tell -
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
 * on anything degenerate - this is a drawing aid, and it must never be the
 * reason a calibration fails.
 */
export function calibrationPreview(
  // ⚑ NOT the config: `steps` here must be the session's UNROLLED list
  // (`session.getSteps()`), because a spider's spokes exist only in the session.
  // Named `shape` rather than `config` so the call site cannot read as though
  // handing over the type's own fixed steps - which for a spider is just the
  // origin, and would leave the preview unable to name or colour any ray.
  shape: { axesKind: AxesKind; steps: readonly { key: string; color: string }[] },
  placed: Readonly<Record<string, { px: number; py: number } | undefined>>,
  /** Step key to draw as the live one - see PreviewSegment.emphasis. */
  emphasisKey?: string
): CalibrationPreview {
  const at = (key: string): PreviewPoint | null => {
    const p = placed[key];
    return p ? { x: p.px, y: p.py } : null;
  };
  const colorOf = (key: string): string => shape.steps.find((s) => s.key === key)?.color ?? '#888888';

  const segments: PreviewSegment[] = [];
  const pairs = shape.axesKind === 'spider' ? spiderPairs(shape.steps) : (PAIRS[shape.axesKind] ?? []);
  for (const [a, b] of pairs) {
    const from = at(a);
    const to = at(b);
    // Each pair is independent: draw as soon as ITS points exist, rather than
    // waiting for the whole calibration (WPD's all-or-nothing).
    if (from && to) {
      const emphasis = b === emphasisKey;
      segments.push({
        from,
        to,
        // ⚑ The LIVE ray is drawn in the colour-match magenta, not in the step's own
        // colour. Spider rays take their colour from the shared origin step, which
        // is green - and a green highlight over a green series is no highlight at
        // all (the bundled example has exactly that). This magenta is already the
        // app's "machine is telling you something about the image" colour, chosen
        // for the same property: it is not easily mistaken for a series.
        color: emphasis ? LIVE_STEP_COLOR : colorOf(a),
        ...(emphasis ? { emphasis: true } : {}),
      });
    }
  }

  const circles: PreviewCircle[] = [];

  // ⚑ THE PIE'S FITTED CIRCLE, drawn back over the figure (v1.6). This is the only
  // way to check an outline-first calibration: the centre is DERIVED, so on a donut
  // there is nothing in the image to compare it against -- seeing the ring laid over
  // the rim, and the centre marker sitting where the slices meet, is the check.
  // Same "draw it back on the figure" job the spider's whiskers do.
  if (shape.axesKind === 'pie') {
    const pts: Vec2[] = [];
    for (const st of shape.steps) {
      const p = at(st.key);
      if (p) pts.push([p.x, p.y]);
    }
    const fitted = pts.length >= 3 ? fitCircle(pts) : null;
    if (fitted && Number.isFinite(fitted.radius) && fitted.radius > 0 && fitted.radius < 1e6) {
      circles.push({ cx: fitted.x0, cy: fitted.y0, r: fitted.radius, color: LIVE_STEP_COLOR });
      // A crosshair AT the centre, so the derived middle is visible as a thing you can
      // disagree with rather than an invisible assumption. Sized in SCREEN pixels (see
      // `marker`): the first attempt scaled with the figure and, on a pie whose slices
      // meet in a busy tangle of boundary lines and labels, was lost in them.
      circles.push({ cx: fitted.x0, cy: fitted.y0, r: 9, color: LIVE_STEP_COLOR, marker: true });
    }
  }
  for (const [a, b, c] of CIRCLE_TRIPLES[shape.axesKind] ?? []) {
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
