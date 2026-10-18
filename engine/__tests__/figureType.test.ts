/**
 * The graph type suggested by Automatic graph extraction (beta), from the two models' raw outputs
 * (docs/v2.7-figure-type.md). Docling's DocumentFigureClassifier splits a chart into its types;
 * PlotTracer's own fine-tune says chart / heatmap / other. A type is suggested (highlighted green on
 * the Graph type card) only at 70% or more (David, 2026-10-16).
 */
import { describe, expect, it } from 'vitest';
import { DOCLING_LABELS, OWN_LABELS, suggestGraphType } from '../figureType.js';

/** Logits that put almost all of the weight on one label. */
function sure(labels: readonly string[], label: string): number[] {
  return labels.map((l) => (l === label ? 12 : 0));
}

describe('the graph type suggested from the two models', () => {
  it('a chart Docling calls a bar chart is suggested as Bar', () => {
    const s = suggestGraphType(sure(OWN_LABELS, 'chart'), sure(DOCLING_LABELS, 'bar_chart'));
    expect(s.type).toBe('bar');
    expect(s.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('line charts and scatter plots are both suggested as XY', () => {
    expect(suggestGraphType(sure(OWN_LABELS, 'chart'), sure(DOCLING_LABELS, 'line_chart')).type).toBe('xy');
    expect(suggestGraphType(sure(OWN_LABELS, 'chart'), sure(DOCLING_LABELS, 'scatter_plot')).type).toBe('xy');
  });

  it('box plot, pie and map are suggested as Box plot, Pie and Map', () => {
    expect(suggestGraphType(sure(OWN_LABELS, 'chart'), sure(DOCLING_LABELS, 'box_plot')).type).toBe('boxplot');
    expect(suggestGraphType(sure(OWN_LABELS, 'chart'), sure(DOCLING_LABELS, 'pie_chart')).type).toBe('pie');
    expect(suggestGraphType(sure(OWN_LABELS, 'chart'), sure(DOCLING_LABELS, 'geographical_map')).type).toBe('map');
  });

  it('a figure PlotTracer\'s own model calls a heatmap is suggested as Heatmap, whatever Docling says', () => {
    expect(suggestGraphType(sure(OWN_LABELS, 'heatmap'), sure(DOCLING_LABELS, 'bar_chart')).type).toBe('heatmap');
  });

  it('a figure PlotTracer\'s own model calls other gets no suggestion', () => {
    expect(suggestGraphType(sure(OWN_LABELS, 'other'), sure(DOCLING_LABELS, 'line_chart')).type).toBeNull();
  });

  it('below 70% nothing is suggested', () => {
    // a chart, split evenly between line and bar: neither reaches 70%
    const docling = DOCLING_LABELS.map((l) => (l === 'line_chart' || l === 'bar_chart' ? 8 : 0));
    const s = suggestGraphType(sure(OWN_LABELS, 'chart'), docling);
    expect(s.type).toBeNull();
    expect(s.confidence).toBeLessThan(0.7);
  });
});
