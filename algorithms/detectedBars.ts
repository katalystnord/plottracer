/**
 * The detector decides what is a bar (v2.7; docs/v2.7-workflow-walk.md, "Bars seen whole by the detector", David
 * 2026-11-06, and "The detector decides what is a bar", David 2026-11-07).
 *
 * A hatch line is drawn in a colour the bar's colour filter drops, so the colour read returns a hatched bar in pieces;
 * and it returns every shape of the bars' colour, a legend swatch, a tick label, a piece of text, as a bar. The
 * detector (ui/figdet-model/detector.onnx, class `bar`) sees each drawn bar as one box, whatever its fill, and only
 * bars. So where it is sure of any bar on the figure, the bars are its boxes, and the colour only says which series a
 * box belongs to; where it is sure of none (or is not there), the colour read reads the bars as before.
 *
 * Measured on CHART-Info's test figures at the competition's protocol, PMC / Adobe CHART-Synthetic, through the app's
 * own detector path (plottracer-benchmarks harness/detect-bars.mjs), recall, precision, F-measure at IoU 0.5, Task 6a
 * (harness/lib/chartinfo6a.mjs): the colour read with the detector's boxes put in 85.3 / 85.4, 18.7 / 11.6, 30.7 / 20.4,
 * 35.9 / 27.9; this rule 79.5 / 79.6, 95.2 / 92.4, 86.6 / 85.5, 78.9 / 70.5. The detector's edges are the closer
 * ones (PMC, 2,470 bars both found: far end median error 0.45 px against the colour read's 1.00). Every rule tried on
 * the way is in the walk notes.
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

/** How sure the detector must be of a bar. Measured: at 0.5 the read found the most bars on the real figures. */
export const DETECTED_BAR_SCORE = 0.5;
/** Two detector boxes overlapping this much (IoU) are one bar, given twice. */
export const SAME_BAR = 0.5;
/** The share of a detector box that must be within the traced colour's tolerance. */
export const OWN_COLOUR = 0.3;
/** How near (largest channel difference) a box's commonest colour must be to the traced colour for the box to be that
 * colour's: within tolerance alone, two close series both claimed a bar (measured: precision 79% to 94% on PMC). */
export const OWN_INK = 30;

const area = (b: BarBox) => Math.max(0, b.end.x - b.start.x) * Math.max(0, b.end.y - b.start.y);
const iou = (a: BarBox, b: BarBox) => {
  const w = Math.min(a.end.x, b.end.x) - Math.max(a.start.x, b.start.x);
  const h = Math.min(a.end.y, b.end.y) - Math.max(a.start.y, b.start.y);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (area(a) + area(b) - i);
};

/**
 * The bars of one colour.
 * @param boxes the colour read's boxes for that colour, returned as they are where the detector is sure of no bar
 * @param detected the detector's bar boxes for the figure
 * @param belongs whether a box is this colour's: its middle mostly this colour (OWN_COLOUR, OWN_INK)
 * @param inDataArea whether a box's centre lies in the data area (the colour read's own rule)
 */
export function withDetectedBars<B extends BarBox>(
  boxes: readonly B[],
  detected: readonly DetectedBarProposal[],
  belongs: (b: BarBox) => boolean,
  inDataArea: (b: BarBox) => boolean,
  make: (b: BarBox) => B
): B[] {
  const sure = detected.filter((d) => d.score >= DETECTED_BAR_SCORE).sort((a, b) => b.score - a.score);
  if (sure.length === 0) return [...boxes];
  const kept: BarBox[] = [];
  for (const d of sure) {
    const box: BarBox = {
      start: { x: Math.round(d.x0), y: Math.round(d.y0) },
      end: { x: Math.round(d.x1), y: Math.round(d.y1) },
    };
    if (area(box) <= 0 || !inDataArea(box) || !belongs(box)) continue;
    // a bar the detector gives twice is placed once
    if (kept.some((k) => iou(k, box) >= SAME_BAR)) continue;
    kept.push(box);
  }
  return kept.map(make);
}
