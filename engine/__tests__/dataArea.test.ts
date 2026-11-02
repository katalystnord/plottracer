import { describe, expect, it } from 'vitest';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';
import { serializeProject, deserializeProject } from '../projectFile.js';
import type { XYAxes } from '../../core/axes/xy.js';
import { dataAreaCornerMarkers, dataAreaCornerFromId, regionCornerFromId } from '../regionHandles.js';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';
import { dataAreaApplies } from '../dataArea.js';

/**
 * The data area (v2.7; David 2026-11-01, docs/v2.7-workflow-walk.md, "The data area, apart from the calibration"):
 * a rectangle of its own, where the automatic tools search. It is not the calibration (the points sit on labelled
 * ticks, often inside the frame) and it is not a masked area. Set by a drag, the first thing the calibration card
 * asks for, or by [Automatic axis detection]; its corners move.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const session = () => new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
function calibrated(): CalibrationSession<XYAxes> {
  const s = session();
  for (const [px, py, v] of [[100, 250, '0'], [400, 250, '10'], [100, 250, '0'], [100, 100, '10']] as const) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  expect(s.runCalibration()).toBe(true);
  return s;
}
const config = (id: string) => {
  const c = ALL_AXES_TYPE_CONFIGS.find((t) => t.id === id);
  if (!c) throw new Error(`no graph type ${id}`);
  return c;
};
const AREA = { x: 80, y: 60, width: 360, height: 210 };

describe('the data area is a rectangle of its own', () => {
  it('a new figure has no data area', () => {
    expect(session().getDataArea()).toBeNull();
  });

  it('marking it records the rectangle, and it is not a masked area', () => {
    const s = session();
    s.setNotDataRegions([{ x: 0, y: 0, width: 10, height: 10 }]);
    s.setDataArea(AREA);
    expect(s.getDataArea()).toEqual(AREA);
    expect(s.getNotDataRegions()).toEqual([{ x: 0, y: 0, width: 10, height: 10 }]);
  });

  it('a figure has one data area: marking it again replaces it', () => {
    const s = session();
    s.setDataArea(AREA);
    s.setDataArea({ x: 90, y: 70, width: 300, height: 200 });
    expect(s.getDataArea()).toEqual({ x: 90, y: 70, width: 300, height: 200 });
  });

  it('a rectangle with no area is refused, and the data area stays as it was', () => {
    const s = session();
    s.setDataArea(AREA);
    expect(s.setDataArea({ x: 10, y: 10, width: 0, height: 50 })).toBe(false);
    expect(s.getDataArea()).toEqual(AREA);
  });

  it('marking or moving the data area keeps the calibration: it is where the tools search, not the scale', () => {
    const s = calibrated();
    s.setDataArea(AREA);
    expect(s.isCalibrated()).toBe(true);
    s.moveDataAreaCorner('br', 450, 280);
    expect(s.isCalibrated()).toBe(true);
  });

  it('the data area survives saving and reopening the project', () => {
    const s = calibrated();
    s.setDataArea(AREA);
    const file = serializeProject(s, PNG);
    if ('error' in file) throw new Error(file.error);
    const opened = deserializeProject(JSON.parse(JSON.stringify(file)));
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.dataArea).toEqual(AREA);
    const s2 = session();
    s2.loadCalibrated(opened.axes as XYAxes, opened.datasets, opened.categoryAxis, opened.heatmapLayer, opened.notDataRegions, opened.dataArea);
    expect(s2.getDataArea()).toEqual(AREA);
  });

  it('a project saved before the data area existed opens with the box round its calibration points, what v2.6 searched', () => {
    const s = calibrated();
    const file = serializeProject(s, PNG);
    if ('error' in file) throw new Error(file.error);
    const opened = deserializeProject(JSON.parse(JSON.stringify(file)));
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.dataArea).toBeNull();
    const s2 = session();
    s2.loadCalibrated(opened.axes as XYAxes, opened.datasets, opened.categoryAxis, opened.heatmapLayer, opened.notDataRegions, opened.dataArea);
    expect(s2.getDataArea()).toEqual({ x: 100, y: 100, width: 300, height: 150 });
  });

  it('a file\'s data area is held to the same rule as one marked on screen: a value that is not a number drops it', () => {
    const s = calibrated();
    s.setDataArea(AREA);
    const file = serializeProject(s, PNG);
    if ('error' in file) throw new Error(file.error);
    const raw = JSON.parse(JSON.stringify(file));
    const json = JSON.stringify(raw).replace('"dataArea":{"x":80', '"dataArea":{"x":null');
    const opened = deserializeProject(JSON.parse(json));
    if ('error' in opened) throw new Error(opened.error);
    expect(opened.dataArea).toBeNull();
  });

  it('undo brings the data area back as it was', () => {
    const s = session();
    s.setDataArea(AREA);
    const before = s.captureState();
    s.moveDataAreaCorner('tl', 20, 20);
    s.restoreState(before);
    expect(s.getDataArea()).toEqual(AREA);
  });

  it('the data area turns with the picture', () => {
    const s = session();
    s.setDataArea(AREA);
    // a quarter turn clockwise of a 500 x 300 picture: (x, y) -> (300 - y, x)
    s.transformAllPixels((x, y) => ({ x: 300 - y, y: x }));
    expect(s.getDataArea()).toEqual({ x: 30, y: 80, width: 210, height: 360 });
  });

  it('the legend stays the legend when the picture turns', () => {
    const s = session();
    s.setLegendRegion({ x: 300, y: 20, width: 100, height: 60 });
    s.transformAllPixels((x, y) => ({ x: 300 - y, y: x }));
    expect(s.getLegendRegion()).toEqual({ x: 220, y: 300, width: 60, height: 100 });
  });

  it('starting the figure again clears the data area', () => {
    const s = session();
    s.setDataArea(AREA);
    s.reset();
    expect(s.getDataArea()).toBeNull();
  });
});

describe('the data area keeps corners that can be moved', () => {
  it('moving a corner moves that corner, and the opposite corner stays where it was', () => {
    const s = session();
    s.setDataArea(AREA);
    expect(s.moveDataAreaCorner('br', 460, 290)).toBe(true);
    expect(s.getDataArea()).toEqual({ x: 80, y: 60, width: 380, height: 230 });
  });

  it('a corner dragged past the opposite one turns the rectangle round', () => {
    const s = session();
    s.setDataArea(AREA);
    s.moveDataAreaCorner('tr', 60, 300);
    expect(s.getDataArea()).toEqual({ x: 60, y: 270, width: 20, height: 30 });
  });

  it('a corner that would leave no area is refused', () => {
    const s = session();
    s.setDataArea(AREA);
    expect(s.moveDataAreaCorner('br', 80, 400)).toBe(false);
    expect(s.getDataArea()).toEqual(AREA);
  });

  it('its four grips are told apart from the masks\' and the legend\'s', () => {
    const grips = dataAreaCornerMarkers(AREA, '#123456');
    expect(grips.map((g) => [g.id, g.x, g.y])).toEqual([
      ['data-area:tl', 80, 60], ['data-area:tr', 440, 60], ['data-area:br', 440, 270], ['data-area:bl', 80, 270],
    ]);
    expect(grips.every((g) => g.kind === 'aid' && g.draggable && g.color === '#123456')).toBe(true);
    expect(dataAreaCornerFromId('data-area:br')).toBe('br');
    expect(dataAreaCornerFromId('region:0:br')).toBeNull();
    expect(regionCornerFromId('data-area:br')).toBeNull();
  });

  it('while the walk places points, a click on a grip is a click on the figure there: X1 often goes on the frame\'s corner', () => {
    expect(dataAreaCornerMarkers(AREA, '#123456', true).every((g) => g.clickThrough === true)).toBe(true);
    expect(dataAreaCornerMarkers(AREA, '#123456').every((g) => !g.clickThrough)).toBe(true);
  });
});

describe('which graph types have a data area', () => {
  it('every type that is XY in some form', () => {
    for (const id of ['xy', 'contour', 'histogram', 'heatmap', 'bar', 'categorical', 'boxplot', 'candlestick', 'stacked', 'span']) {
      expect(dataAreaApplies(config(id)), id).toBe(true);
    }
  });

  it('not polar, ternary, pie, spider, map or the circular chart recorder', () => {
    for (const id of ['polar', 'ternary', 'pie', 'spider', 'map', 'ccr']) {
      expect(dataAreaApplies(config(id)), id).toBe(false);
    }
  });
});
