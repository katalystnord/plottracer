import { describe, expect, it } from 'vitest';
import { DATA_EXTRACTION_TOOLS, dataExtractionToolsFor } from '../toolMode.js';
import { resolveDigit, type KeyboardState } from '../keyboardActions.js';
import { guidanceTip, noPointsHint } from '../guidanceTip.js';
import { routeCanvasClick } from '../canvasClickRoute.js';
import {
  XY_AXES_CONFIG,
  CONTOUR_AXES_CONFIG,
  POLAR_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
  MAP_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
  BAR_AXES_CONFIG,
  STACKED_AXES_CONFIG,
  SPAN_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  SPIDER_AXES_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  CANDLESTICK_AXES_CONFIG,
  PIE_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  HEATMAP_AXES_CONFIG,
} from '../axesTypeConfigs.js';

/**
 * The Data extraction tool, rail 4 (David, 2026-10-31 and 2026-11-01; docs/v2.7-workflow-walk.md, The Data
 * extraction card). Place point, Auto-extract and Cut become one tool with one card. Every tool keeps its place in
 * the card on every graph, and one that does not apply is greyed there; the card opens with nothing picked.
 */

type Cfg = Parameters<typeof dataExtractionToolsFor>[0];
const offered = (config: Cfg) => dataExtractionToolsFor(config);

describe('the Data extraction card', () => {
  it('holds six tools, in the order of the settled card', () => {
    expect(DATA_EXTRACTION_TOOLS).toEqual(['find-lines', 'color-trace', 'segment-fill', 'interpolate', 'place-point', 'cut']);
  });

  it('on XY and Contour every tool applies', () => {
    expect(offered(XY_AXES_CONFIG)).toEqual(DATA_EXTRACTION_TOOLS);
    expect(offered(CONTOUR_AXES_CONFIG)).toEqual(DATA_EXTRACTION_TOOLS);
  });

  it('on Polar, Ternary, Map and the chart recorder, Find lines and Split a line do not apply', () => {
    for (const c of [POLAR_AXES_CONFIG, TERNARY_AXES_CONFIG, MAP_AXES_CONFIG, CIRCULAR_CHART_RECORDER_AXES_CONFIG]) {
      expect(offered(c as Cfg), c.id).toEqual(['color-trace', 'segment-fill', 'interpolate', 'place-point']);
    }
  });

  it('on bars, spans, histograms and spiders only Colour trace and Place points apply', () => {
    for (const c of [BAR_AXES_CONFIG, STACKED_AXES_CONFIG, SPAN_AXES_CONFIG, HISTOGRAM_AXES_CONFIG, SPIDER_AXES_CONFIG]) {
      expect(offered(c as Cfg), c.id).toEqual(['color-trace', 'place-point']);
    }
  });

  it('on a box plot, candlestick, pie or line with categories only Place points applies', () => {
    for (const c of [BOX_PLOT_AXES_CONFIG, CANDLESTICK_AXES_CONFIG, PIE_AXES_CONFIG, CATEGORICAL_LINE_CONFIG]) {
      expect(offered(c as Cfg), c.id).toEqual(['place-point']);
    }
  });

  it('on a heatmap no tool applies: its cells are read at the end of the calibration card', () => {
    expect(offered(HEATMAP_AXES_CONFIG as Cfg)).toEqual([]);
  });
});

describe('the Data extraction tool on the rail and the keys', () => {
  const calibrated = { isCalibrated: true, figureCaptured: true, canvasHasImage: true } as KeyboardState;

  it('4 opens it on every calibrated graph, also where only Place points applies', () => {
    expect(resolveDigit('4', calibrated)).toEqual({ type: 'toggle-data-extraction' });
    expect(resolveDigit('4', { ...calibrated, autoExtractKind: 'none' })).toEqual({ type: 'toggle-data-extraction' });
    expect(resolveDigit('4', { ...calibrated, isCalibrated: false })).toBeNull();
  });

  it('3 does nothing until the Legend tool takes it', () => {
    expect(resolveDigit('3', calibrated)).toBeNull();
  });
});

describe('the words around the Data extraction tool', () => {
  it('with the card open and nothing picked, the tips bar asks for a tool', () => {
    const tip = guidanceTip({
      mode: 'extract',
      canvasHasImage: true,
      figureCaptured: true,
      isCalibrated: true,
    } as Parameters<typeof guidanceTip>[0]);
    expect(tip).toMatch(/pick a tool/i);
  });

  it('an empty table names Data extraction (4), never the retired Add points or Auto-extract', () => {
    for (const c of [XY_AXES_CONFIG, BAR_AXES_CONFIG, BOX_PLOT_AXES_CONFIG, PIE_AXES_CONFIG, CATEGORICAL_LINE_CONFIG]) {
      for (const mode of ['select', 'pan', 'extract'] as const) {
        const hint = noPointsHint({ mode, config: c as Parameters<typeof noPointsHint>[0]['config'] });
        expect(hint, `${c.id} / ${mode}`).not.toMatch(/Add points|Auto-extract/);
        expect(hint, `${c.id} / ${mode}`).toMatch(/Data extraction|pick a tool/);
      }
    }
  });
});

describe('with the Data extraction card open and nothing picked', () => {
  it('a click on the figure adds nothing (the router falls through to add-point otherwise)', () => {
    expect(routeCanvasClick({ eyedropper: null, mode: 'extract', figureCaptured: true, hasImage: true })).toEqual({ kind: 'ignore' });
  });
});
