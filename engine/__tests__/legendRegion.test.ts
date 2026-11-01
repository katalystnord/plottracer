import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import { serializeProject, deserializeProject } from '../projectFile.js';
import type { XYAxes } from '../../core/axes/xy.js';
import { legendFromDetections } from '../pictureAxes.js';
import { resolveDigit, type KeyboardState } from '../keyboardActions.js';
import { routeCanvasClick } from '../canvasClickRoute.js';
import { guidanceTip } from '../guidanceTip.js';
import { regionCornerMarkers, regionCornerFromId } from '../regionHandles.js';

/**
 * The legend and the masked areas, as the Legend tool records them (v2.7; David 2026-10-31 and 2026-11-01,
 * docs/v2.7-workflow-walk.md, The Legend tool's card). Both are rectangles over the figure, not paint: the legend is
 * one of its own kind, masked by itself ("that is half the point"), and every rectangle keeps corners that can be
 * moved.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const session = () => new CalibrationSession<XYAxes>(XY_AXES_CONFIG);

describe('the legend is a rectangle of its own kind', () => {
  it('marking the legend records it as the legend, and it is masked like any masked area', () => {
    const s = session();
    s.setLegendRegion({ x: 300, y: 20, width: 100, height: 60 });
    expect(s.getLegendRegion()).toEqual({ x: 300, y: 20, width: 100, height: 60 });
    expect(s.getNotDataRegions()).toEqual([{ x: 300, y: 20, width: 100, height: 60, kind: 'legend' }]);
  });

  it('a figure has one legend: marking it again replaces it, and the masked areas stay', () => {
    const s = session();
    s.setNotDataRegions([{ x: 0, y: 0, width: 10, height: 10 }]);
    s.setLegendRegion({ x: 300, y: 20, width: 100, height: 60 });
    s.setLegendRegion({ x: 310, y: 30, width: 90, height: 50 });
    expect(s.getLegendRegion()).toEqual({ x: 310, y: 30, width: 90, height: 50 });
    expect(s.getNotDataRegions().filter((r) => r.kind !== 'legend')).toEqual([{ x: 0, y: 0, width: 10, height: 10 }]);
  });

  it('the legend survives saving and reopening the project, as the legend', () => {
    const s = session();
    for (const [px, py, v] of [[100, 250, '0'], [400, 250, '10'], [100, 250, '0'], [100, 100, '10']] as const) {
      s.handleCalibrationClick(px, py);
      s.confirmCalibrationValues([v]);
    }
    expect(s.runCalibration()).toBe(true);
    s.setLegendRegion({ x: 300, y: 20, width: 100, height: 60 });
    const file = serializeProject(s, PNG);
    if ('error' in file) throw new Error(file.error);
    const opened = deserializeProject(JSON.parse(JSON.stringify(file)));
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.notDataRegions).toEqual([{ x: 300, y: 20, width: 100, height: 60, kind: 'legend' }]);
  });
});

describe('every rectangle keeps corners that can be moved', () => {
  it('moving a corner moves that corner, and the opposite corner stays where it was', () => {
    const s = session();
    s.setNotDataRegions([{ x: 100, y: 100, width: 50, height: 40 }]);
    expect(s.moveNotDataRegionCorner(0, 'br', 170, 160)).toBe(true);
    expect(s.getNotDataRegions()[0]).toEqual({ x: 100, y: 100, width: 70, height: 60 });
    expect(s.moveNotDataRegionCorner(0, 'tl', 90, 110)).toBe(true);
    expect(s.getNotDataRegions()[0]).toEqual({ x: 90, y: 110, width: 80, height: 50 });
  });

  it('a corner dragged past the opposite one turns the rectangle round instead of giving it a negative size', () => {
    const s = session();
    s.setNotDataRegions([{ x: 100, y: 100, width: 50, height: 40 }]);
    s.moveNotDataRegionCorner(0, 'tr', 80, 160);
    expect(s.getNotDataRegions()[0]).toEqual({ x: 80, y: 140, width: 20, height: 20 });
  });

  it('the legend keeps being the legend when its corner moves', () => {
    const s = session();
    s.setLegendRegion({ x: 300, y: 20, width: 100, height: 60 });
    s.moveNotDataRegionCorner(0, 'bl', 290, 90);
    expect(s.getLegendRegion()).toEqual({ x: 290, y: 20, width: 110, height: 70 });
  });

  it('a corner that would leave no area is refused', () => {
    const s = session();
    s.setNotDataRegions([{ x: 100, y: 100, width: 50, height: 40 }]);
    expect(s.moveNotDataRegionCorner(0, 'br', 100, 160)).toBe(false);
    expect(s.moveNotDataRegionCorner(5, 'br', 120, 120)).toBe(false);
    expect(s.getNotDataRegions()[0]).toEqual({ x: 100, y: 100, width: 50, height: 40 });
  });
});

describe('Auto detect legend reads the legend off the chart-element detector', () => {
  const d = (cls: string, x0: number, y0: number, x1: number, y1: number, score = 0.9) => ({ cls, box: { x0, y0, x1, y1 }, score });

  it('the legend is the detector\'s legend area, the most certain one when it finds two', () => {
    expect(legendFromDetections([d('legend_area', 300, 20, 400, 80, 0.7), d('legend_area', 50, 50, 90, 90, 0.95), d('plot_area', 0, 0, 500, 400)])).toEqual({
      x: 50, y: 50, width: 40, height: 40,
    });
  });

  it('with no legend area, the legend is the box round the legend\'s markers and labels', () => {
    expect(legendFromDetections([d('legend_marker', 300, 20, 310, 30), d('legend_label', 315, 18, 380, 32), d('legend_label', 315, 40, 370, 54)])).toEqual({
      x: 300, y: 18, width: 80, height: 36,
    });
  });

  it('a detection below the detector\'s threshold is not a legend', () => {
    expect(legendFromDetections([d('legend_area', 300, 20, 400, 80, 0.3)])).toBeNull();
  });

  it('nothing of a legend found is no legend: the caller warns, it does not guess', () => {
    expect(legendFromDetections([d('plot_area', 0, 0, 500, 400), d('x_tick_label', 10, 410, 30, 420)])).toBeNull();
    expect(legendFromDetections([])).toBeNull();
  });
});

describe('the Legend tool on the rail', () => {
  const captured = { figureCaptured: true, canvasHasImage: true, isCalibrated: false } as KeyboardState;

  it('3 opens the Legend card once the figure is captured, calibrated or not', () => {
    expect(resolveDigit('3', captured)).toEqual({ type: 'toggle-legend' });
    expect(resolveDigit('3', { ...captured, figureCaptured: false })).toBeNull();
  });

  it('with the card open, a click on the figure adds nothing: the legend is marked by a drag', () => {
    expect(routeCanvasClick({ eyedropper: null, mode: 'legend', figureCaptured: true, hasImage: true })).toEqual({ kind: 'ignore' });
  });

  it('the tips bar names the three ways and the corners', () => {
    const tip = guidanceTip({ mode: 'legend', canvasHasImage: true, figureCaptured: true, isCalibrated: true } as Parameters<typeof guidanceTip>[0]);
    expect(tip).toMatch(/Mark legend/);
    expect(tip).toMatch(/corner/i);
  });

  it('the same tip during the calibration walk, since the legend can be marked before the axes are calibrated', () => {
    const tip = guidanceTip({
      mode: 'legend', canvasHasImage: true, figureCaptured: true, isCalibrated: false, isCalibrating: true,
      currentStep: { key: 'x1', prompt: 'Click X1' }, stepIndex: 0, totalSteps: 4,
    } as unknown as Parameters<typeof guidanceTip>[0]);
    expect(tip).toMatch(/^Legend - Mark legend/);
  });

  it('on a chart captured in slots, the tip carries no slot to fill: the Legend card captures no points', () => {
    const tip = guidanceTip({
      mode: 'legend', canvasHasImage: true, figureCaptured: true, isCalibrated: true,
      hasSlots: true, captureProgressText: 'Next: Corner - new bar (0 of 2 filled)', currentGroupLabel: 'Corner',
    } as unknown as Parameters<typeof guidanceTip>[0]);
    expect(tip).not.toMatch(/new bar/);
  });
});

describe('the corners are grips on the figure, while the Legend card is open', () => {
  it('each rectangle has four square grips, one at each corner, in its own colour', () => {
    const m = regionCornerMarkers([{ x: 10, y: 20, width: 30, height: 40 }, { x: 0, y: 0, width: 5, height: 5, kind: 'legend' }], { mask: '#666', legend: '#167782' });
    expect(m).toHaveLength(8);
    expect(m.slice(0, 4).map((k) => [k.x, k.y])).toEqual([[10, 20], [40, 20], [40, 60], [10, 60]]);
    expect(m.every((k) => k.kind === 'aid' && k.draggable)).toBe(true);
    expect(m[0]!.color).toBe('#666');
    expect(m[4]!.color).toBe('#167782');
  });

  it('a grip says which rectangle and which corner it moves', () => {
    const m = regionCornerMarkers([{ x: 10, y: 20, width: 30, height: 40 }], { mask: '#666', legend: '#167782' });
    expect(m.map((k) => regionCornerFromId(k.id))).toEqual([
      { index: 0, corner: 'tl' }, { index: 0, corner: 'tr' }, { index: 0, corner: 'br' }, { index: 0, corner: 'bl' },
    ]);
    expect(regionCornerFromId('point-3')).toBeNull();
  });
});
