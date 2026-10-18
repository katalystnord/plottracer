/**
 * The graph type suggested by Automatic graph extraction (beta) - docs/v2.7-figure-type.md.
 *
 * Two small image classifiers read the captured figure (ui/figtype-model/, run in the OCR's
 * worker thread): Docling's DocumentFigureClassifier v2.5 (MIT), which splits a chart into its
 * types, and PlotTracer's own fine-tune of the same network, which says chart / heatmap / other.
 * Measured on 536 hand-checked real figures from openly licensed papers (plottracer-ref
 * research/v2.7-figclass/FINDINGS.md): 277 of 324 handled figures suggested right, 17 wrong.
 *
 * ⚑ The suggestion is an OFFER (tenet 9): the Graph type card highlights it green, and the user
 * always clicks a type themselves (David, 2026-10-16). Nothing here selects anything.
 */

/** Docling's 26 labels, in its model's output order (its config.json, id2label). */
export const DOCLING_LABELS = [
  'logo', 'photograph', 'icon', 'engineering_drawing', 'line_chart', 'bar_chart', 'other', 'table',
  'flow_chart', 'screenshot_from_computer', 'signature', 'screenshot_from_manual', 'geographical_map',
  'pie_chart', 'page_thumbnail', 'stamp', 'music', 'calendar', 'qr_code', 'bar_code', 'full_page_image',
  'scatter_plot', 'chemistry_structure', 'topographical_map', 'crossword_puzzle', 'box_plot',
] as const;

/** PlotTracer's own model's labels, in its output order. */
export const OWN_LABELS = ['chart', 'heatmap', 'other'] as const;

/** Docling's chart labels, as PlotTracer's graph types. Its other labels are not charts we read. */
const DOCLING_TO_TYPE: Record<string, string> = {
  line_chart: 'xy', scatter_plot: 'xy', bar_chart: 'bar', box_plot: 'boxplot', pie_chart: 'pie', geographical_map: 'map',
};

/**
 * Fixed shifts on the own model's logits and the suggestion cutoff, chosen on CHART-Info PMC
 * split 1's 'select' half only (calib.py) and kept as measured; the cutoff is David's 70%.
 */
const SHIFT_OTHER = -3.0;
const SHIFT_HEATMAP = -1.5;
export const SUGGEST_AT = 0.7;

export interface GraphTypeSuggestion {
  /** The graph type id to highlight, or null for no suggestion. */
  type: string | null;
  /** The suggested (or the likeliest) type's probability, 0..1. */
  confidence: number;
}

function softmax(logits: readonly number[]): number[] {
  const m = Math.max(...logits);
  const e = logits.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/**
 * Fuse the two models: the own model decides heatmap / not a chart we read / a chart, and Docling
 * divides "a chart" among xy, bar, box plot, pie and map.
 */
export function suggestGraphType(ownLogits: readonly number[], doclingLogits: readonly number[]): GraphTypeSuggestion {
  const own = [...ownLogits];
  own[OWN_LABELS.indexOf('other')]! += SHIFT_OTHER;
  own[OWN_LABELS.indexOf('heatmap')]! += SHIFT_HEATMAP;
  const pOwn = softmax(own);
  const heat = pOwn[OWN_LABELS.indexOf('heatmap')]!;
  const other = pOwn[OWN_LABELS.indexOf('other')]!;
  const pDoc = softmax(doclingLogits);
  const five: Record<string, number> = { xy: 0, bar: 0, boxplot: 0, pie: 0, map: 0 };
  DOCLING_LABELS.forEach((l, i) => {
    const t = DOCLING_TO_TYPE[l];
    if (t) five[t]! += pDoc[i]!;
  });
  const sum = Object.values(five).reduce((a, b) => a + b, 0) || 1;
  const p: Record<string, number> = { heatmap: heat };
  for (const [t, v] of Object.entries(five)) p[t] = ((1 - heat - other) * v) / sum;
  const [best, conf] = Object.entries(p).reduce((a, b) => (b[1] > a[1] ? b : a));
  return { type: conf >= SUGGEST_AT && conf > other ? best : null, confidence: conf };
}
