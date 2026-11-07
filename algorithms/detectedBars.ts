/**
 * Bars seen whole by the detector, put together with the colour read (v2.7; docs/v2.7-workflow-walk.md, "Bars seen
 * whole by the detector", David 2026-11-06: "use the vision model to recognise a whole area first, and then trim down").
 *
 * A hatch line is drawn in a colour the bar's colour filter drops, so the colour read returns a hatched bar in pieces.
 * The detector (ui/figdet-model/detector.onnx, class `bar`) sees each drawn bar as one box, whatever its fill. The two
 * are put together so that each gives what it measures best: the colour read the exact edges of a bar it found whole,
 * the detector the extent of a bar the colour read found in pieces.
 *
 * Measured on CHART-Info's test figures, at the competition's protocol, through the app's own detector path
 * (plottracer-benchmarks harness/detect-bars.mjs), colour read alone against colour read with this rule: Adobe
 * CHART-Synthetic (mostly hatched) 62.1% to 85.8%, PMC split 4 81.5% to 87.4%, split 5 78.3% to 83.5% (bars found at
 * IoU 0.5). Snapping the detector's box to the colour's own extent was tried and left out: measured with the detector
 * at 384 px, it gained a point on the synthetic figures and cost half a point to a point on the real ones.
 */

/** One bar box from the detector, in image pixels, with its confidence. */
export interface DetectedBarProposal {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  score: number;
}

/** A box as the colour read gives it: `end` one past the last pixel. */
export interface BarBox {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/** How sure the detector must be. Measured: at 0.5 the rule found the most bars on the real figures. */
export const DETECTED_BAR_SCORE = 0.5;
/** A colour box and a detector box overlapping this much (IoU) are one bar, and the colour's box is kept. */
export const SAME_BAR = 0.5;
/** A colour piece lying this much inside a detector box is part of that bar. */
export const PIECE_INSIDE = 0.7;
/** A colour box covering this much of a detector box is a bar of its own, not a piece: a detector box holding two such
 * side by side along the category axis (one box over two neighbouring bars of the colour) replaces nothing and is not
 * placed. Pieces between hatch lines are smaller (a cross-hatched horizontal bar's strips are about a quarter of the
 * bar each), and two big pieces of one bar (cut by a value label or a gridline) lie one above the other, not side by
 * side (the code review of 2026-11-06). */
export const WHOLE_BAR = 0.35;
/** The share of a detector box that must be the traced colour for the box to be filed under it: another series' bar
 * or a legend is not. A cross-hatched bar keeps about two thirds of its fill. */
export const OWN_COLOUR = 0.3;

const area = (b: BarBox) => Math.max(0, b.end.x - b.start.x) * Math.max(0, b.end.y - b.start.y);
function overlap(a: BarBox, b: BarBox): number {
  const w = Math.min(a.end.x, b.end.x) - Math.max(a.start.x, b.start.x);
  const h = Math.min(a.end.y, b.end.y) - Math.max(a.start.y, b.start.y);
  return w > 0 && h > 0 ? w * h : 0;
}
const iou = (a: BarBox, b: BarBox) => {
  const i = overlap(a, b);
  return i > 0 ? i / (area(a) + area(b) - i) : 0;
};

/**
 * The colour read's boxes with the detector's bars put in.
 * @param boxes the colour read's boxes for one colour
 * @param detected the detector's bar boxes for the figure
 * @param ownShare the share of a box's pixels that are the traced colour
 * @param inDataArea whether a box's centre lies in the data area (the colour read's own rule)
 */
export function withDetectedBars<B extends BarBox>(
  boxes: readonly B[],
  detected: readonly DetectedBarProposal[],
  ownShare: (b: BarBox) => number,
  inDataArea: (b: BarBox) => boolean,
  make: (b: BarBox) => B,
  /** Which way the categories run, where declared: two whole pieces side by side along it are two bars. Unknown, any
   * two whole pieces are taken as two bars. */
  categoryAxis?: 'x' | 'y'
): B[] {
  const sideBySide = (a: BarBox, b: BarBox): boolean => {
    if (!categoryAxis) return true;
    const lo = (q: BarBox) => (categoryAxis === 'x' ? q.start.x : q.start.y);
    const hi = (q: BarBox) => (categoryAxis === 'x' ? q.end.x : q.end.y);
    const shared = Math.min(hi(a), hi(b)) - Math.max(lo(a), lo(b));
    return shared < 0.5 * Math.min(hi(a) - lo(a), hi(b) - lo(b));
  };
  const replaced = new Set<number>();
  const added: B[] = [];
  const kept: BarBox[] = [];
  // the surest first, and a box the detector gave twice placed once (it keeps no other dedup of its own here)
  for (const d of [...detected].sort((a, b) => b.score - a.score)) {
    if (d.score < DETECTED_BAR_SCORE) continue;
    const box: BarBox = {
      start: { x: Math.round(d.x0), y: Math.round(d.y0) },
      end: { x: Math.round(d.x1), y: Math.round(d.y1) },
    };
    if (area(box) <= 0 || !inDataArea(box) || ownShare(box) < OWN_COLOUR) continue;
    if (kept.some((k) => iou(k, box) >= SAME_BAR)) continue;
    // a bar the colour read found whole keeps the colour's exact edges
    if (boxes.some((b) => iou(b, box) >= SAME_BAR)) continue;
    const inside = boxes.flatMap((b, k) => (area(b) > 0 && overlap(b, box) / area(b) >= PIECE_INSIDE ? [k] : []));
    // one box over two whole bars of the colour, side by side and nothing else, is not one bar. ⚠️ Only when the box
    // holds nothing but such pieces: a hatch leaves small pieces besides its big ones, and refusing those too cost
    // Adobe CHART-Synthetic 2.7 points of bars found (85.8% to 83.1%, measured 2026-11-07; PMC 0.1 to 0.3).
    const whole = inside.filter((k) => area(boxes[k]!) >= WHOLE_BAR * area(box)).map((k) => boxes[k]!);
    if (inside.length === whole.length && whole.some((a, i) => whole.some((b, j) => j > i && sideBySide(a, b)))) continue;
    for (const k of inside) replaced.add(k);
    kept.push(box);
    added.push(make(box));
  }
  if (added.length === 0) return [...boxes];
  return [...boxes.filter((_, k) => !replaced.has(k)), ...added];
}
