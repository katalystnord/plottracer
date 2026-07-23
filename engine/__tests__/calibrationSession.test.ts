import { describe, expect, it } from 'vitest';
import {
  CalibrationSession,
  XY_AXES_CONFIG,
  BAR_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  GRAPH_TYPE_METADATA_KEY,
  POLAR_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
  MAP_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
} from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';
import type { BarAxes } from '../../core/axes/bar.js';
import type { PolarAxes } from '../../core/axes/polar.js';
import type { TernaryAxes } from '../../core/axes/ternary.js';
import type { MapAxes } from '../../core/axes/map.js';
import type { CircularChartRecorderAxes } from '../../core/axes/circularChartRecorder.js';
import { Dataset } from '../../core/dataset.js';

function calibrateStandardXY(session: CalibrationSession<XYAxes>) {
  // Same 4-point setup used throughout the engine/ui spike's checkpoints:
  // X1=0 @ (100,250), X2=10 @ (400,250), Y1=0 @ (100,250), Y2=10 @ (100,100).
  const steps: Array<[number, number, string]> = [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, value] of steps) {
    expect(session.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(session.confirmCalibrationValues([value])).toBe(true);
  }
}

describe('Polar P2 optional θ — a field labelled "unused" must not block Confirm', () => {
  it('confirms P2 with r filled and θ left blank, then calibrates', () => {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    expect(session.handleCalibrationClick(400, 400)).toBe('point-placed'); // origin (no value)
    expect(session.handleCalibrationClick(500, 400)).toBe('awaiting-value'); // P1
    expect(session.confirmCalibrationValues(['6', '0'])).toBe(true); // r1, θ1
    expect(session.handleCalibrationClick(600, 400)).toBe('awaiting-value'); // P2
    // The fix: r filled, θ blank. Previously ANY blank field was refused, so a
    // field the math never reads still forced the user to type a throwaway value.
    expect(session.confirmCalibrationValues(['10', ''])).toBe(true);
    expect(session.runCalibration()).toBe(true);
    expect(session.getAxes()).not.toBeNull();
  });

  it('still refuses P2 when the REQUIRED r field is blank', () => {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    session.handleCalibrationClick(400, 400);
    session.handleCalibrationClick(500, 400);
    session.confirmCalibrationValues(['6', '0']);
    session.handleCalibrationClick(600, 400);
    expect(session.confirmCalibrationValues(['', ''])).toBe(false); // r is not optional
  });
});

describe('Categorical line (checkpoint 101)', () => {
  it('calibrates the value axis only (no X clicks) and exports Position + Value', () => {
    const session = new CalibrationSession<BarAxes>(CATEGORICAL_LINE_CONFIG);
    // Two value-axis points: py=400 -> value 0, py=100 -> value 100. No X.
    session.handleCalibrationClick(80, 400);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(80, 100);
    session.confirmCalibrationValues(['100']);
    expect(session.runCalibration()).toBe(true);

    // Place points OUT of left-to-right order to prove Position is derived from
    // pixel-x, not placement order.
    session.addDataPoint(300, 250); // px 300, value 50
    session.addDataPoint(150, 200); // px 150, value ~66.7
    session.addDataPoint(450, 100); // px 450, value 100

    expect(session.getExportFields()).toEqual(['Position', 'Value']);
    const rows = session.getExportRows(0);
    // rows align with the stored point order, which insert-in-place (v1.1 #1) may
    // permute -- so key Position/Value by each point's pixel-x rather than a fixed
    // row index. Position must still be the ordinal by pixel-x: px150->1, px300->2,
    // px450->3, no matter what order they were placed in.
    const pts = session.getDataPoints();
    const posByPx = new Map(pts.map((p, i) => [Math.round(p.px), rows[i]!.values[0]]));
    const valByPx = new Map(pts.map((p, i) => [Math.round(p.px), rows[i]!.values[1]]));
    expect(posByPx.get(150)).toBe(1);
    expect(posByPx.get(300)).toBe(2);
    expect(posByPx.get(450)).toBe(3);
    expect(valByPx.get(300)).toBeCloseTo(50, 5);
    expect(valByPx.get(450)).toBeCloseTo(100, 5);
    // Table shows the measured Value only (Position is an export-derived column).
    expect(session.getTableValueLabels()).toEqual(['Value']);
  });
});

describe('CalibrationSession captureState/restoreState (checkpoint 38)', () => {
  it('round-trips a calibrated session with data points, and restore is independent of later mutation', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    expect(session.runCalibration()).toBe(true);
    session.addDataPoint(200, 200);
    session.addDataPoint(300, 150);
    const snap = session.captureState();
    const dataAt0 = session.getDataPoints()[0]!.data;

    // Mutate past the snapshot, then restore.
    session.addDataPoint(350, 120);
    expect(session.getDataPoints()).toHaveLength(3);
    session.restoreState(snap);

    expect(session.isCalibrated()).toBe(true);
    const restored = session.getDataPoints();
    expect(restored).toHaveLength(2);
    expect(restored[0]!.px).toBe(200);
    expect(restored[0]!.py).toBe(200);
    // The restored axes actually works -- pixelToData matches the pre-snapshot value.
    expect(restored[0]!.data).toEqual(dataAt0);

    // Restoring produced fresh instances: mutating now doesn't corrupt the snapshot.
    session.addDataPoint(1, 1);
    session.restoreState(snap);
    expect(session.getDataPoints()).toHaveLength(2);
  });

  it('round-trips multiple series with their names, colors, and active index', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    expect(session.runCalibration()).toBe(true);
    session.renameDataset(0, 'Alpha');
    session.setDatasetColor(0, [10, 20, 30]);
    session.addDataset('Beta');
    session.setActiveDataset(1);
    session.addDataPoint(220, 210);
    const snap = session.captureState();

    // Wreck the state, then restore.
    session.removeDataset(1);
    session.setActiveDataset(0);
    session.restoreState(snap);

    const infos = session.getDatasetInfos();
    expect(infos).toHaveLength(2);
    expect(infos[0]!.name).toBe('Alpha');
    expect(infos[0]!.color).toEqual([10, 20, 30]);
    expect(infos[1]!.name).toBe('Beta');
    expect(session.getActiveDatasetIndex()).toBe(1);
    expect(session.getDataPoints()).toHaveLength(1); // Beta's one point
  });

  it('round-trips mid-calibration progress (step index + placed points)', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    // Place only the first two of four calibration points.
    session.handleCalibrationClick(100, 250);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(400, 250);
    session.confirmCalibrationValues(['10']);
    expect(session.getStepIndex()).toBe(2);
    const snap = session.captureState();

    // Finish calibrating, then roll back to the mid-calibration snapshot.
    session.handleCalibrationClick(100, 250);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues(['10']);
    expect(session.runCalibration()).toBe(true);
    expect(session.isCalibrated()).toBe(true);

    session.restoreState(snap);
    expect(session.isCalibrated()).toBe(false);
    expect(session.getStepIndex()).toBe(2);
    expect(Object.keys(session.getPlacedPoints())).toHaveLength(2);
  });

  it('captures and restores a fresh, uncalibrated session (empty axesColl path)', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    const snap = session.captureState();
    calibrateStandardXY(session);
    expect(session.runCalibration()).toBe(true);
    expect(session.isCalibrated()).toBe(true);
    session.restoreState(snap);
    expect(session.isCalibrated()).toBe(false);
    expect(session.getStepIndex()).toBe(0);
    expect(session.getDatasetCount()).toBe(1);
  });
});

describe('CalibrationSession (XY axes)', () => {
  it('walks through the 4 calibration steps in order', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(session.getCurrentStep()?.key).toBe('x1');
    expect(session.isCalibrated()).toBe(false);

    session.handleCalibrationClick(100, 250);
    expect(session.getPendingPixel()).toEqual({ px: 100, py: 250 });
    session.confirmCalibrationValues(['0']);
    expect(session.getCurrentStep()?.key).toBe('x2');

    session.handleCalibrationClick(400, 250);
    session.confirmCalibrationValues(['10']);
    expect(session.getCurrentStep()?.key).toBe('y1');

    session.handleCalibrationClick(100, 250);
    session.confirmCalibrationValues(['0']);
    expect(session.getCurrentStep()?.key).toBe('y2');

    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues(['10']);
    expect(session.getCurrentStep()).toBeNull();
  });

  it('ignores confirmCalibrationValues with no pending pixel or blank input', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(session.confirmCalibrationValues(['5'])).toBe(false);
    session.handleCalibrationClick(10, 10);
    expect(session.confirmCalibrationValues(['   '])).toBe(false);
    expect(session.confirmCalibrationValues(['5'])).toBe(true);
  });

  it('runs calibration and produces working XYAxes once all 4 points are placed', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(session.runCalibration()).toBe(false); // nothing placed yet

    calibrateStandardXY(session);
    expect(session.runCalibration()).toBe(true);
    expect(session.isCalibrated()).toBe(true);
    expect(session.getCalibrationError()).toBeNull();

    const axes = session.getAxes();
    const [x, y] = axes!.pixelToData(250, 175);
    expect(x).toBeCloseTo(5, 10);
    expect(y).toBeCloseTo(5, 10);
  });

  it('reports a calibration error for invalid data values instead of throwing', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.handleCalibrationClick(100, 250);
    session.confirmCalibrationValues(['not-a-number']);
    session.handleCalibrationClick(400, 250);
    session.confirmCalibrationValues(['10']);
    session.handleCalibrationClick(100, 250);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues(['10']);

    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).not.toBeNull();
    expect(session.isCalibrated()).toBe(false);
  });

  it('adds points to a real Dataset once calibrated, converting live via the calibrated axes', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();

    expect(session.addDataPoint(250, 175)).toBe('point-added');
    expect(session.addDataPoint(100, 250)).toBe('point-added');
    expect(session.addDataPoint(400, 100)).toBe('point-added');

    // Insert-in-place (v1.1 #1) may reorder the stored points; this test is about
    // live pixel->data conversion, not order, so read by ascending pixel-x
    // (px 100 -> (0,0), 250 -> (5,5), 400 -> (10,10)).
    const points = [...session.getDataPoints()].sort((a, b) => a.px - b.px);
    expect(points).toHaveLength(3);
    points[0]!.data!.forEach((v, i) => expect(v).toBeCloseTo([0, 0][i]!, 10));
    points[1]!.data!.forEach((v, i) => expect(v).toBeCloseTo([5, 5][i]!, 10));
    points[2]!.data!.forEach((v, i) => expect(v).toBeCloseTo([10, 10][i]!, 10));
  });

  describe('insert-in-place point ordering (v1.1 #1)', () => {
    it('splices a re-added middle point back into curve order, not at the end', () => {
      const s = new CalibrationSession(XY_AXES_CONFIG);
      calibrateStandardXY(s);
      s.runCalibration();
      // Place the two ends, then a point that belongs between them LAST: it lands
      // in the middle rather than appending, and no other point moves.
      s.addDataPoint(100, 250); // left
      s.addDataPoint(400, 250); // right
      s.addDataPoint(250, 250); // middle, added last
      expect(s.getDataPoints().map((p) => Math.round(p.px))).toEqual([100, 250, 400]);
    });

    it('a normal left-to-right trace still just appends (unchanged behaviour)', () => {
      const s = new CalibrationSession(XY_AXES_CONFIG);
      calibrateStandardXY(s);
      s.runCalibration();
      for (const px of [100, 200, 300, 400]) s.addDataPoint(px, 250);
      expect(s.getDataPoints().map((p) => Math.round(p.px))).toEqual([100, 200, 300, 400]);
    });

    it('leaves an interpolation series alone (its order is anchor-derived)', () => {
      const s = new CalibrationSession(XY_AXES_CONFIG);
      calibrateStandardXY(s);
      s.runCalibration();
      s.addAnchorPoint(120, 240);
      s.addAnchorPoint(380, 130);
      const before = s.getDataPoints().length;
      // A plain point added onto an interpolation series appends (the guard that
      // canSortByNearestNeighbour uses), so insert-in-place never reorders the
      // anchor/derived sequence out from under itself.
      s.addDataPoint(250, 300);
      const pts = s.getDataPoints();
      expect(pts).toHaveLength(before + 1);
      expect(Math.round(pts[pts.length - 1]!.px)).toBe(250); // appended at the end
    });
  });

  it('removes the last point and clears all points', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(250, 175);
    session.addDataPoint(100, 250);

    session.removeLastPoint();
    expect(session.getDataPoints()).toHaveLength(1);

    session.clearPoints();
    expect(session.getDataPoints()).toHaveLength(0);
  });

  it('removeLastPoint on an empty dataset is a no-op, not an error', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(() => session.removeLastPoint()).not.toThrow();
    expect(session.getDataPoints()).toHaveLength(0);
  });

  it('reset() returns the session to its initial state, discarding calibration and points', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(250, 175);

    session.reset();
    expect(session.isCalibrated()).toBe(false);
    expect(session.getCurrentStep()?.key).toBe('x1');
    expect(session.getPlacedPoints()).toEqual({});
    expect(session.getDataPoints()).toHaveLength(0);
    expect(session.getCalibrationError()).toBeNull();
  });

  it('ignores image clicks once all 4 calibration steps are placed but not yet calibrated', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    // Calibration steps are done (stepIndex === 4) but runCalibration() hasn't
    // been called yet -- clicks should be ignored, not silently added as data points.
    expect(session.handleCalibrationClick(999, 999)).toBe('ignored');
    expect(session.getDataPoints()).toHaveLength(0);
  });

  it('addDataPoint is ignored until calibrated', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(session.addDataPoint(250, 175)).toBe('ignored');
    session.handleCalibrationClick(100, 250);
    session.confirmCalibrationValues(['0']); // mid-walk, still not calibrated
    expect(session.addDataPoint(250, 175)).toBe('ignored');
    expect(session.getDataPoints()).toHaveLength(0);
  });

  it('handleCalibrationClick is ignored once calibrated, so it never re-adds a data point in Calibrate mode', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    expect(session.handleCalibrationClick(250, 175)).toBe('ignored');
    expect(session.getDataPoints()).toHaveLength(0);
  });

  it('updateDataPointPixel moves an existing data point and updates its live data conversion', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(100, 250); // (0, 0)

    session.updateDataPointPixel(0, 400, 100); // drag it to (10, 10)

    const points = session.getDataPoints();
    expect(points).toHaveLength(1);
    expect(points[0]!.px).toBe(400);
    expect(points[0]!.py).toBe(100);
    points[0]!.data!.forEach((v, i) => expect(v).toBeCloseTo([10, 10][i]!, 10));
  });

  it('updateCalibPointPixel repositions a placed handle and re-calibrates live', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    expect(session.isCalibrated()).toBe(true);

    // Drag the Y2 handle so the Y axis now spans twice the pixel distance
    // for the same data range (100,250)=0 -> (100,0)=10 instead of (100,100)=10.
    session.updateCalibPointPixel('y2', 100, 0);
    expect(session.isCalibrated()).toBe(true);

    const [, y] = session.getAxes()!.pixelToData(100, 125);
    expect(y).toBeCloseTo(5, 10);
  });

  it('updateCalibPointPixel on an unplaced step or before calibration is a safe no-op / deferred', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(() => session.updateCalibPointPixel('x1', 5, 5)).not.toThrow();
    expect(session.isCalibrated()).toBe(false);

    session.handleCalibrationClick(100, 250);
    session.confirmCalibrationValues(['0']);
    // x1 is placed but the session isn't calibrated yet -- repositioning
    // should update the stored point without attempting calibration.
    session.updateCalibPointPixel('x1', 50, 250);
    expect(session.getPlacedPoints().x1).toEqual({ px: 50, py: 250, values: ['0'] });
    expect(session.isCalibrated()).toBe(false);
  });

  describe('addSegmentFillPoints (checkpoint 26)', () => {
    it('bulk-adds points once calibrated, returning the count added', () => {
      const session = new CalibrationSession(XY_AXES_CONFIG);
      calibrateStandardXY(session);
      session.runCalibration();

      const added = session.addSegmentFillPoints([
        { x: 250, y: 175 },
        { x: 100, y: 250 },
        { x: 400, y: 100 },
      ]);
      expect(added).toBe(3);
      const points = session.getDataPoints();
      expect(points).toHaveLength(3);
      points[0]!.data!.forEach((v, i) => expect(v).toBeCloseTo([5, 5][i]!, 10));
    });

    it('is ignored (returns 0, adds nothing) until calibrated', () => {
      const session = new CalibrationSession(XY_AXES_CONFIG);
      const added = session.addSegmentFillPoints([{ x: 250, y: 175 }]);
      expect(added).toBe(0);
      expect(session.getDataPoints()).toHaveLength(0);
    });

    it('is ignored when the dataset has point groups configured, unlike addDataPoint', () => {
      const session = new CalibrationSession(BAR_AXES_CONFIG);
      calibrateStandardBar(session);
      session.runCalibration();
      session.applyBoxPlotGroups();

      const added = session.addSegmentFillPoints([{ x: 300, y: 300 }]);
      expect(added).toBe(0);
      expect(session.getDataPoints()).toHaveLength(0);
    });
  });
});

function calibrateStandardBar(session: CalibrationSession<BarAxes>) {
  // P1=0 @ (300,500), P2=10 @ (300,100) -- a vertical bar-value scale.
  const steps: Array<[number, number, string]> = [
    [300, 500, '0'],
    [300, 100, '10'],
  ];
  for (const [px, py, value] of steps) {
    expect(session.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(session.confirmCalibrationValues([value])).toBe(true);
  }
}

describe('Interpolation-assist stores the series in curve order (rc.2 fix)', () => {
  it('interleaves anchors with the fill in curve order, not [anchors][fill]', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration(); // addAnchorPoint is ignored until axes exist
    // Two guide points far apart -> a spline fill between them.
    session.addAnchorPoint(150, 240);
    session.addAnchorPoint(380, 120);
    const roles = session.getDataPointRoles();
    expect(roles.length).toBeGreaterThan(3);
    // Curve order: an anchor at the very start of the curve and one at the very
    // end, with the derived fill BETWEEN them. The old [anchors][fill] layout put
    // both anchors at indices 0 and 1, so roles[1] === 'anchor' -- this assertion
    // fails without the curve-order rebuild.
    expect(roles[0]).toBe('anchor');
    expect(roles[roles.length - 1]).toBe('anchor');
    expect(roles[1]).toBe('interpolated');
    expect(roles.filter((r) => r === 'anchor').length).toBe(2);
  });

  it('keeps anchor pixels exact on rebuild (no drift)', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addAnchorPoint(150, 240);
    session.addAnchorPoint(380, 120);
    const pts = session.getDataPoints();
    const roles = session.getDataPointRoles();
    const anchorPix = pts.filter((_, i) => roles[i] === 'anchor').map((p) => ({ px: p.px, py: p.py }));
    expect(anchorPix).toContainEqual({ px: 150, py: 240 });
    expect(anchorPix).toContainEqual({ px: 380, py: 120 });
  });
});

describe('CalibrationSession (Bar axes)', () => {
  it('walks through the 2 calibration steps in order, fewer than XY', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    expect(session.getCurrentStep()?.key).toBe('p1');

    session.handleCalibrationClick(300, 500);
    session.confirmCalibrationValues(['0']);
    expect(session.getCurrentStep()?.key).toBe('p2');

    session.handleCalibrationClick(300, 100);
    session.confirmCalibrationValues(['10']);
    expect(session.getCurrentStep()).toBeNull();
  });

  it('runs calibration and produces a working BarAxes reading a single value per point', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    expect(session.runCalibration()).toBe(true);
    expect(session.isCalibrated()).toBe(true);

    expect(session.addDataPoint(300, 300)).toBe('point-added');
    const points = session.getDataPoints();
    expect(points).toHaveLength(1);
    expect(points[0]!.data).toHaveLength(1);
    expect(points[0]!.data![0]).toBeCloseTo(5, 10);
  });

  it('re-calibrates live when a Bar calibration handle is dragged', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.addDataPoint(300, 300); // reads 5 at the original calibration

    // Drag P2 from (300,100) to (300,0): the pixel span for the same 0-10
    // data range grows from 400px to 500px, so the same data point's pixel
    // (unchanged, only the handle moved) now reads a smaller value.
    session.updateCalibPointPixel('p2', 300, 0);
    const points = session.getDataPoints();
    expect(points[0]!.data![0]).toBeCloseTo(4, 10);
  });
});

describe('CalibrationSession (Point Groups / Box Plot)', () => {
  it('addDataPoint behaves like an ungrouped dataset until point groups are configured', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    expect(session.hasPointGroups()).toBe(false);

    session.addDataPoint(300, 300);
    expect(session.getDataPoints()).toHaveLength(1);
    expect(session.getTupleRows()).toEqual([]);
  });

  it('applyBoxPlotGroups sets Min/Q1/Median/Q3/Max and declines a second time', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    expect(session.applyBoxPlotGroups()).toBe(true);
    expect(session.getPointGroups()).toEqual(['Min', 'Q1', 'Median', 'Q3', 'Max']);
    expect(session.hasPointGroups()).toBe(true);

    // Declines once already configured -- matches the current app's own
    // "Box Plot Groups" button (011ef1c), which safely diffing an in-use
    // tuple structure is a separate feature ("Edit Point Groups"), not this one.
    expect(session.setPointGroups(['A', 'B'])).toBe(false);
    expect(session.getPointGroups()).toEqual(['Min', 'Q1', 'Median', 'Q3', 'Max']);
  });

  it('files 5 clicks into one tuple, cycling the group cursor Min through Max, then starts a new tuple', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.applyBoxPlotGroups();

    const expectedLabels = ['Min', 'Q1', 'Median', 'Q3', 'Max'];
    for (let i = 0; i < 5; i++) {
      expect(session.getCurrentTupleIndex()).toBe(i === 0 ? null : 0);
      expect(session.getCurrentGroupIndex()).toBe(i);
      expect(session.getCurrentGroupLabel()).toBe(expectedLabels[i]);
      session.addDataPoint(300, 500 - i * 40);
    }
    // Tuple complete: cursor rolls over to a fresh tuple at the first group.
    expect(session.getCurrentTupleIndex()).toBeNull();
    expect(session.getCurrentGroupIndex()).toBe(0);

    const rows = session.getTupleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.points.every((p) => p !== null)).toBe(true);
    expect(rows[0]!.points[2]!.data![0]).toBeCloseTo(2, 10); // Median @ py=420
  });

  it('lets a click skip to a later slot without filling the ones in between', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.applyBoxPlotGroups();

    session.addDataPoint(300, 500); // Min, tuple 0
    session.nextGroupCursor(); // skip Q1
    expect(session.getCurrentGroupLabel()).toBe('Median');
    session.addDataPoint(300, 300); // Median, tuple 0

    const rows = session.getTupleRows();
    expect(rows[0]!.points[0]).not.toBeNull(); // Min filled
    expect(rows[0]!.points[1]).toBeNull(); // Q1 still open
    expect(rows[0]!.points[2]).not.toBeNull(); // Median filled

    // The cursor still finds Q1 as the next open slot in the same tuple,
    // rather than jumping ahead to Q3 -- nextGroupCursor searches forward
    // from the current position, so it never revisits a skipped slot on
    // its own; previousGroupCursor below is what walks back to it.
    session.previousGroupCursor();
    session.previousGroupCursor();
    expect(session.getCurrentTupleIndex()).toBe(0);
    expect(session.getCurrentGroupIndex()).toBe(1);
  });

  it('removeLastPoint cleans up the tuple slot and walks the cursor back', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.applyBoxPlotGroups();

    session.addDataPoint(300, 500); // Min
    session.addDataPoint(300, 460); // Q1
    expect(session.getCurrentGroupIndex()).toBe(2); // Median

    session.removeLastPoint();
    expect(session.getDataPoints()).toHaveLength(1);
    expect(session.getCurrentTupleIndex()).toBe(0);
    expect(session.getCurrentGroupIndex()).toBe(1); // back to Q1
    expect(session.getTupleRows()[0]!.points[1]).toBeNull();

    session.removeLastPoint();
    expect(session.getDataPoints()).toHaveLength(0);
    // The now-empty tuple is dropped entirely, not left as a blank row.
    expect(session.getTupleRows()).toHaveLength(0);
    expect(session.getCurrentTupleIndex()).toBeNull();
    expect(session.getCurrentGroupIndex()).toBe(0);
  });

  it('reset and clearPoints drop point groups along with the dataset', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.applyBoxPlotGroups();
    session.addDataPoint(300, 500);

    session.clearPoints();
    expect(session.hasPointGroups()).toBe(false);
    expect(session.getCurrentTupleIndex()).toBeNull();
    expect(session.getCurrentGroupIndex()).toBe(0);
  });

  describe('getBoxPlotGlyphs (checkpoint 22)', () => {
    it('is empty before point groups are configured, and while a tuple is incomplete', () => {
      const session = new CalibrationSession(BAR_AXES_CONFIG);
      calibrateStandardBar(session);
      session.runCalibration();
      expect(session.getBoxPlotGlyphs()).toEqual([]);

      session.applyBoxPlotGroups();
      session.addDataPoint(300, 500); // Min only -- tuple still incomplete
      session.addDataPoint(300, 460); // Q1
      expect(session.getBoxPlotGlyphs()).toEqual([]);
    });

    it('returns one 9-segment glyph per complete tuple, and none for a still-open one', () => {
      const session = new CalibrationSession(BAR_AXES_CONFIG);
      calibrateStandardBar(session);
      session.runCalibration();
      session.applyBoxPlotGroups();

      for (const py of [500, 460, 420, 380, 340]) {
        session.addDataPoint(300, py); // completes Min..Max of the first tuple
      }
      session.addDataPoint(300, 500); // starts a second, incomplete tuple

      const glyphs = session.getBoxPlotGlyphs();
      expect(glyphs).toHaveLength(1);
      expect(glyphs[0]).toHaveLength(9);
      // Vertical Bar axes (P1/P2 share pixel-x=300): the median segment (last
      // of the 9) spans the box's cross-axis width, centered on pixel-x=300.
      expect(glyphs[0]![8]).toEqual({ from: { x: 280, y: 420 }, to: { x: 320, y: 420 } });
    });

    it('is empty for a non-Bar axes session, even if named identically to Box Plot groups', () => {
      const session = new CalibrationSession(XY_AXES_CONFIG);
      calibrateStandardXY(session);
      session.runCalibration();
      session.setPointGroups(['Min', 'Q1', 'Median', 'Q3', 'Max']);
      for (const [x, y] of [
        [100, 100],
        [150, 100],
        [200, 100],
        [250, 100],
        [300, 100],
      ]) {
        session.addDataPoint(x!, y!);
      }
      expect(session.getBoxPlotGlyphs()).toEqual([]);
    });
  });

  describe('Box Plot as a first-class graph type (checkpoint 107)', () => {
    it('auto-carries Min/Q1/Median/Q3/Max groups without the legacy toggle', () => {
      // The whole point of the promotion: tuple capture is the type's inherent
      // shape, not a mode the user must first discover and switch on. No
      // applyBoxPlotGroups() call here.
      const session = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
      expect(session.hasPointGroups()).toBe(true);
      expect(session.getPointGroups()).toEqual(['Min', 'Q1', 'Median', 'Q3', 'Max']);
    });

    it('reads one value per point and renders a glyph for a complete tuple', () => {
      const session = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
      calibrateStandardBar(session);
      expect(session.runCalibration()).toBe(true);

      // Same complete tuple as the getBoxPlotGlyphs Bar test above -- the glyph
      // gate is now axesKind-based, so the 'boxplot' config qualifies exactly
      // like the legacy 'bar' path did.
      for (const py of [500, 460, 420, 380, 340]) session.addDataPoint(300, py);
      const glyphs = session.getBoxPlotGlyphs();
      expect(glyphs).toHaveLength(1);
      expect(glyphs[0]).toHaveLength(9);
    });

    it('tags its axes graphType=boxplot so a saved project restores as Box Plot, not Bar', () => {
      // BarAxes serializes as 'BarAxes', so without this tag a saved box plot
      // would reload as a plain Bar chart (checkpoint 66's graph-type != axes-class
      // problem). projectFile.deserializeProject reads this key back as the config id.
      const session = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
      calibrateStandardBar(session);
      session.runCalibration();
      expect(session.getAxes()?.getMetadata()[GRAPH_TYPE_METADATA_KEY]).toBe('boxplot');
    });
  });

  describe('category naming (checkpoint 23)', () => {
    it('auto-labels a new tuple with axes.dataPointsLabelPrefix + tuple index', () => {
      const session = new CalibrationSession(BAR_AXES_CONFIG);
      calibrateStandardBar(session);
      session.runCalibration();
      session.applyBoxPlotGroups();

      session.addDataPoint(300, 500); // starts tuple 0 (Min)
      expect(session.getTupleLabel(0)).toBe('Bar0'); // BarAxes.dataPointsLabelPrefix === 'Bar'
      expect(session.getTupleRows()[0]!.label).toBe('Bar0');

      for (const py of [460, 420, 380, 340]) session.addDataPoint(300, py); // Q1, Median, Q3, Max
      session.addDataPoint(300, 500); // starts tuple 1 (Min)
      expect(session.getTupleLabel(1)).toBe('Bar1');
    });

    it('setTupleLabel overrides the auto-generated default and registers the "label" metadata key', () => {
      const session = new CalibrationSession(BAR_AXES_CONFIG);
      calibrateStandardBar(session);
      session.runCalibration();
      session.applyBoxPlotGroups();
      session.addDataPoint(300, 500); // tuple 0

      session.setTupleLabel(0, 'Sample A');
      expect(session.getTupleLabel(0)).toBe('Sample A');
      expect(session.getTupleRows()[0]!.label).toBe('Sample A');
      expect(session.getMetadataKeys()).toContain('label');
    });

    it('is empty for a tuple index with no primary-group point placed yet', () => {
      const session = new CalibrationSession(BAR_AXES_CONFIG);
      calibrateStandardBar(session);
      session.runCalibration();
      session.applyBoxPlotGroups();
      expect(session.getTupleLabel(0)).toBe('');

      session.setTupleLabel(0, 'ignored, no tuple exists yet'); // no-op, no crash
      expect(session.getTupleLabel(0)).toBe('');
    });
  });
});

describe('CalibrationSession: shared-origin pixel reuse', () => {
  it('lets Y1 reuse X1\'s pixel instead of requiring a second click at the same spot', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.handleCalibrationClick(100, 250); // X1
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(400, 250); // X2
    session.confirmCalibrationValues(['10']);

    expect(session.getReusableSteps().map((s) => s.key)).toEqual(['x1', 'x2']);
    expect(session.reuseStepPixel('x1')).toBe(true);
    expect(session.getPendingPixel()).toEqual({ px: 100, py: 250 });
    session.confirmCalibrationValues(['0']); // Y1

    session.handleCalibrationClick(100, 100); // Y2
    session.confirmCalibrationValues(['10']);

    expect(session.runCalibration()).toBe(true);
    const [x, y] = session.getAxes()!.pixelToData(250, 175);
    expect(x).toBeCloseTo(5, 10);
    expect(y).toBeCloseTo(5, 10);
  });

  it('reuseStepPixel is a no-op once calibrated or for an unplaced/unknown step', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(session.reuseStepPixel('x1')).toBe(false); // nothing placed yet
    expect(session.getReusableSteps()).toEqual([]);

    session.handleCalibrationClick(100, 250);
    session.confirmCalibrationValues(['0']);
    expect(session.reuseStepPixel('does-not-exist')).toBe(false);

    session.handleCalibrationClick(400, 250);
    session.confirmCalibrationValues(['10']);
    session.handleCalibrationClick(100, 250);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues(['10']);
    session.runCalibration();
    expect(session.reuseStepPixel('x1')).toBe(false); // already calibrated
  });

  it('does not offer reuse once a pixel is already pending for the current step', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.handleCalibrationClick(100, 250);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(400, 250); // X2 pixel pending, value not yet confirmed
    expect(session.getReusableSteps()).toEqual([]);
  });
});

function calibrateStandardPolar(session: CalibrationSession<PolarAxes>) {
  // Origin at (100,300); P1 r=10,θ=0° at (400,300); P2 r=20 (θ unused) at
  // (700,300) -- all three pixels share one horizontal line through the
  // origin, so θ=0 everywhere along it and r grows linearly with pixel
  // distance from the origin.
  expect(session.handleCalibrationClick(100, 300)).toBe('point-placed'); // origin: no value prompt
  expect(session.handleCalibrationClick(400, 300)).toBe('awaiting-value');
  expect(session.confirmCalibrationValues(['10', '0'])).toBe(true); // r1, θ1
  expect(session.handleCalibrationClick(700, 300)).toBe('awaiting-value');
  expect(session.confirmCalibrationValues(['20', '0'])).toBe(true); // r2, θ2 (unused)
}

describe('CalibrationSession (Polar axes)', () => {
  it('walks a 3-step calibration where the origin needs no typed value', () => {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    expect(session.getCurrentStep()?.key).toBe('origin');
    expect(session.getCurrentStep()?.valueFields).toHaveLength(0);

    expect(session.handleCalibrationClick(100, 300)).toBe('point-placed');
    expect(session.getCurrentStep()?.key).toBe('p1');
    expect(session.getCurrentStep()?.valueFields).toHaveLength(2);

    expect(session.handleCalibrationClick(400, 300)).toBe('awaiting-value');
    expect(session.confirmCalibrationValues(['10', '0'])).toBe(true);
    expect(session.getCurrentStep()?.key).toBe('p2');

    expect(session.handleCalibrationClick(700, 300)).toBe('awaiting-value');
    expect(session.confirmCalibrationValues(['20', '0'])).toBe(true);
    expect(session.getCurrentStep()).toBeNull();
  });

  it('runs calibration and produces a working PolarAxes reading both r and θ', () => {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    calibrateStandardPolar(session);
    expect(session.runCalibration()).toBe(true);
    expect(session.isCalibrated()).toBe(true);

    expect(session.addDataPoint(400, 300)).toBe('point-added'); // exactly P1's pixel
    const points = session.getDataPoints();
    expect(points[0]!.data![0]).toBeCloseTo(10, 10); // r
    expect(points[0]!.data![1]).toBeCloseTo(0, 10); // θ
  });

  it('re-calibrates live when the P2 handle is dragged (its unused θ2 value plays no part)', () => {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    calibrateStandardPolar(session);
    session.runCalibration();
    session.addDataPoint(700, 300); // exactly P2's original pixel, reads r=20

    let points = session.getDataPoints();
    expect(points[0]!.data![0]).toBeCloseTo(20, 10);

    // Drag P2 from (700,300) to (1300,300): dist10=300 (unchanged), dist20
    // grows from 600 to 1200, so dist12 grows from 300 to 900. The same
    // pixel (700,300 -- unchanged, only the handle moved) now reads a
    // smaller r: ((20-10)/900)*(600-300)+10 = 13.333...
    session.updateCalibPointPixel('p2', 1300, 300);
    points = session.getDataPoints();
    expect(points[0]!.data![0]).toBeCloseTo(10 + (10 / 900) * 300, 10);
  });

  it('confirmCalibrationValues rejects a value count mismatched to the current step', () => {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    session.handleCalibrationClick(100, 300); // origin, auto-placed
    session.handleCalibrationClick(400, 300); // p1 awaiting 2 values
    expect(session.confirmCalibrationValues(['10'])).toBe(false); // only 1 of 2
    expect(session.getPendingPixel()).not.toBeNull(); // still pending
    expect(session.confirmCalibrationValues(['10', '0'])).toBe(true);
  });
});

function calibrateStandardTernary(session: CalibrationSession<TernaryAxes>) {
  // Corner A at (100,300), corner B at (100,100) directly above A (so
  // L=200, phi0=90 deg); corner C is a click-only, geometrically unused
  // third corner (see calibrationSession.ts's header comment).
  expect(session.handleCalibrationClick(100, 300)).toBe('point-placed'); // A
  expect(session.handleCalibrationClick(100, 100)).toBe('point-placed'); // B
  expect(session.handleCalibrationClick(300, 300)).toBe('point-placed'); // C
}

describe('CalibrationSession (Ternary axes)', () => {
  it('walks a 3-step calibration where every step needs no typed value', () => {
    const session = new CalibrationSession(TERNARY_AXES_CONFIG);
    expect(session.getCurrentStep()?.key).toBe('a');
    expect(session.getCurrentStep()?.valueFields).toHaveLength(0);

    expect(session.handleCalibrationClick(100, 300)).toBe('point-placed');
    expect(session.getCurrentStep()?.key).toBe('b');
    expect(session.handleCalibrationClick(100, 100)).toBe('point-placed');
    expect(session.getCurrentStep()?.key).toBe('c');
    expect(session.handleCalibrationClick(300, 300)).toBe('point-placed');
    expect(session.getCurrentStep()).toBeNull();
  });

  it('runs calibration and produces a working TernaryAxes reading a, b, c', () => {
    const session = new CalibrationSession(TERNARY_AXES_CONFIG);
    calibrateStandardTernary(session);
    expect(session.runCalibration()).toBe(true);
    expect(session.isCalibrated()).toBe(true);

    expect(session.addDataPoint(100, 300)).toBe('point-added'); // corner A itself
    session.addDataPoint(100, 100); // corner B itself
    session.addDataPoint(100, 200); // midpoint of A-B

    // Insert-in-place (v1.1 #1) may reorder the stored points (the midpoint,
    // placed last, slots between the two corners); this test reads a,b,c, not
    // order, so read by ascending pixel-y: py100 -> corner B, py200 -> midpoint,
    // py300 -> corner A.
    const points = [...session.getDataPoints()].sort((a, b) => a.py - b.py);
    points[0]!.data!.forEach((v, i) => expect(v).toBeCloseTo([0, 100, 0][i]!, 10));
    points[1]!.data!.forEach((v, i) => expect(v).toBeCloseTo([50, 50, 0][i]!, 10));
    points[2]!.data!.forEach((v, i) => expect(v).toBeCloseTo([100, 0, 0][i]!, 10));
  });

  it('re-calibrates live when the B handle is dragged', () => {
    const session = new CalibrationSession(TERNARY_AXES_CONFIG);
    calibrateStandardTernary(session);
    session.runCalibration();
    session.addDataPoint(100, 200); // midpoint of A-B, reads (50,50,0)

    let points = session.getDataPoints();
    expect(points[0]!.data![0]).toBeCloseTo(50, 10);

    // Drag B from (100,100) to (100,0): L grows from 200 to 300, so the
    // same pixel (100,200 -- unchanged, only the handle moved) is now only
    // 1/3 of the way from A to B instead of half.
    session.updateCalibPointPixel('b', 100, 0);
    points = session.getDataPoints();
    expect(points[0]!.data![0]).toBeCloseTo(200 / 3, 6);
    expect(points[0]!.data![1]).toBeCloseTo(100 / 3, 6);
  });
});

function calibrateStandardMap(session: CalibrationSession<MapAxes>) {
  // P1 at (100,300), P2 at (400,300) -- a 300px reference line representing
  // 30 real-world units (scale 0.1 unit/px).
  expect(session.handleCalibrationClick(100, 300)).toBe('point-placed'); // P1
  expect(session.handleCalibrationClick(400, 300)).toBe('awaiting-value'); // P2
  expect(session.confirmCalibrationValues(['30'])).toBe(true);
}

describe('CalibrationSession (Map axes)', () => {
  it('walks a 2-step calibration where only P2 needs a typed value', () => {
    const session = new CalibrationSession(MAP_AXES_CONFIG);
    expect(session.getCurrentStep()?.key).toBe('p1');
    expect(session.getCurrentStep()?.valueFields).toHaveLength(0);

    expect(session.handleCalibrationClick(100, 300)).toBe('point-placed');
    expect(session.getCurrentStep()?.key).toBe('p2');
    expect(session.getCurrentStep()?.valueFields).toHaveLength(1);

    expect(session.handleCalibrationClick(400, 300)).toBe('awaiting-value');
    expect(session.confirmCalibrationValues(['30'])).toBe(true);
    expect(session.getCurrentStep()).toBeNull();
  });

  it('runs calibration and produces a working MapAxes reading X and Y', () => {
    const session = new CalibrationSession(MAP_AXES_CONFIG);
    // Pin top-left explicitly: this test is about the pixel->data mapping, not
    // about which origin is default (checkpoint 68 corrected the default to
    // bottom-left to match WPD -- covered by its own tests below).
    session.setOption('origin', 'top-left');
    calibrateStandardMap(session);
    expect(session.runCalibration()).toBe(true);
    expect(session.isCalibrated()).toBe(true);

    expect(session.addDataPoint(200, 150)).toBe('point-added');
    const points = session.getDataPoints();
    expect(points[0]!.data![0]).toBeCloseTo(20, 10);
    expect(points[0]!.data![1]).toBeCloseTo(15, 10);
  });

  it('re-calibrates live when the P2 handle is dragged', () => {
    const session = new CalibrationSession(MAP_AXES_CONFIG);
    session.setOption('origin', 'top-left'); // see the note above
    calibrateStandardMap(session);
    session.runCalibration();
    session.addDataPoint(200, 150); // reads (20, 15) at the original calibration

    let points = session.getDataPoints();
    expect(points[0]!.data![0]).toBeCloseTo(20, 10);

    // Drag P2 from (400,300) to (700,300): dist grows from 300 to 600, so
    // the same pixel (200,150 -- unchanged, only the handle moved) now
    // reads half the value.
    session.updateCalibPointPixel('p2', 700, 300);
    points = session.getDataPoints();
    expect(points[0]!.data![0]).toBeCloseTo(10, 10);
    expect(points[0]!.data![1]).toBeCloseTo(7.5, 10);
  });
});

// (T0,R0)=(200,200) t0/r0=1; (T0,R1)=(400,200) click-only; (T0,R2)=(300,100)
// r2=10; (T1,R2)=(200,400) click-only; (T2,R2)=(400,400) click-only. Chosen
// so both 3-point groups ({T0,R0/R1/R2} for the pen circle, {T0,R2/T1,R2/T2,R2}
// for the chart circle) are non-collinear -- getCircleFrom3Pts needs that to
// produce a real circle, not a divide-by-zero. This fixture is for exercising
// the click-walk/global-field plumbing only, not for verifying the circle-fit
// + angle math itself -- that needs an independent oracle (the live wpd-core
// app), which is what core/__tests__/crossCheck.test.ts is for; see this
// file's own header comment and CLAUDE.md's checkpoint 20 notes for why.
function calibrateStandardCCR(session: CalibrationSession<CircularChartRecorderAxes>) {
  expect(session.handleCalibrationClick(200, 200)).toBe('awaiting-value'); // (T0,R0)
  expect(session.confirmCalibrationValues(['2024-01-01 00:00', '1'])).toBe(true);
  expect(session.handleCalibrationClick(400, 200)).toBe('point-placed'); // (T0,R1)
  expect(session.handleCalibrationClick(300, 100)).toBe('awaiting-value'); // (T0,R2)
  expect(session.confirmCalibrationValues(['10'])).toBe(true);
  expect(session.handleCalibrationClick(200, 400)).toBe('point-placed'); // (T1,R2)
  expect(session.handleCalibrationClick(400, 400)).toBe('point-placed'); // (T2,R2)
}

describe('CalibrationSession (Circular Chart Recorder axes)', () => {
  it('walks a 5-step calibration mixing value-less and 1-2 value steps', () => {
    const session = new CalibrationSession(CIRCULAR_CHART_RECORDER_AXES_CONFIG);
    expect(session.getCurrentStep()?.key).toBe('t0r0');
    expect(session.getCurrentStep()?.valueFields).toHaveLength(2);

    calibrateStandardCCR(session);
    expect(session.getCurrentStep()).toBeNull();
  });

  it('runCalibration rejects a blank global field with a clear error, before touching the axes', () => {
    const session = new CalibrationSession(CIRCULAR_CHART_RECORDER_AXES_CONFIG);
    calibrateStandardCCR(session);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/Chart Start Time/);
    expect(session.isCalibrated()).toBe(false);
  });

  it('runs calibration once the global field is filled, reading back a known radial value exactly', () => {
    const session = new CalibrationSession(CIRCULAR_CHART_RECORDER_AXES_CONFIG);
    calibrateStandardCCR(session);
    session.setGlobalFieldValue('startTime', '2024-01-01 00:00');
    expect(session.runCalibration()).toBe(true);
    expect(session.isCalibrated()).toBe(true);
    expect(session.getCalibrationError()).toBeNull();

    // Querying (T0,R0)'s own pixel makes rPx equal rMinPx exactly, so the
    // radial interpolation collapses to r0 exactly -- a hand-verifiable
    // check, unlike the angle/time component (see the fixture comment
    // above). pixelToData returns [time, magnitude] (core/axes/
    // circularChartRecorder.ts's getAxesLabels() -> ['Time', 'Magnitude']),
    // time first.
    expect(session.addDataPoint(200, 200)).toBe('point-added');
    const points = session.getDataPoints();
    expect(points[0]!.data).toHaveLength(2);
    expect(Number.isFinite(points[0]!.data![0])).toBe(true); // time -- see crossCheck.test.ts for exact verification
    expect(points[0]!.data![1]).toBeCloseTo(1, 6); // r
  });

  it('getGlobalFieldValues/setGlobalFieldValue round-trip, and reset() clears them', () => {
    const session = new CalibrationSession(CIRCULAR_CHART_RECORDER_AXES_CONFIG);
    expect(session.getGlobalFieldValues()).toEqual({});
    session.setGlobalFieldValue('startTime', '2024-06-01 12:00');
    expect(session.getGlobalFieldValues()).toEqual({ startTime: '2024-06-01 12:00' });
    session.reset();
    expect(session.getGlobalFieldValues()).toEqual({});
  });
});

describe('CalibrationSession: multi-dataset/series support (checkpoint 30)', () => {
  it('starts with exactly one dataset, named "Series 1" and active', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(session.getDatasetCount()).toBe(1);
    expect(session.getActiveDatasetIndex()).toBe(0);
    const infos = session.getDatasetInfos();
    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatchObject({ index: 0, name: 'Series 1', pointCount: 0, active: true });
  });

  it('addDataset creates a new, auto-named, auto-colored, active dataset', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    const newIndex = session.addDataset();
    expect(newIndex).toBe(1);
    expect(session.getDatasetCount()).toBe(2);
    expect(session.getActiveDatasetIndex()).toBe(1);

    const infos = session.getDatasetInfos();
    expect(infos[0]!.name).toBe('Series 1');
    expect(infos[1]!.name).toBe('Series 2');
    expect(infos[0]!.active).toBe(false);
    expect(infos[1]!.active).toBe(true);
    // Auto-assigned colors differ between series.
    expect(infos[0]!.color).not.toEqual(infos[1]!.color);
  });

  it('addDataset accepts an explicit name instead of auto-naming', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.addDataset('Sample B');
    expect(session.getDatasetInfos()[1]!.name).toBe('Sample B');
    // An explicitly-named dataset doesn't consume the auto-naming counter.
    session.addDataset();
    expect(session.getDatasetInfos()[2]!.name).toBe('Series 2');
  });

  it('addDataPoint only ever adds to the active dataset', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();

    session.addDataPoint(250, 175); // Series 1
    session.addDataset(); // -> Series 2, now active
    session.addDataPoint(100, 250); // Series 2
    session.addDataPoint(400, 100); // Series 2

    expect(session.getDatasetInfos()[0]!.pointCount).toBe(1);
    expect(session.getDatasetInfos()[1]!.pointCount).toBe(2);
    // getDataPoints() reflects "the active dataset", same as every other
    // per-dataset accessor after checkpoint 30 -- see this file's header
    // comment.
    expect(session.getDataPoints()).toHaveLength(2);

    session.setActiveDataset(0);
    expect(session.getDataPoints()).toHaveLength(1);
  });

  it('getAllDatasetsData returns every dataset\'s own points, color, and active flag', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(250, 175);
    session.addDataset();
    session.addDataPoint(100, 250);

    const all = session.getAllDatasetsData();
    expect(all).toHaveLength(2);
    expect(all[0]!.points).toHaveLength(1);
    expect(all[0]!.active).toBe(false);
    expect(all[1]!.points).toHaveLength(1);
    expect(all[1]!.active).toBe(true);
    expect(all[0]!.color).not.toEqual(all[1]!.color);
  });

  it('setActiveDataset switches context; out-of-range indices are ignored', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.addDataset();
    session.addDataset();
    expect(session.getActiveDatasetIndex()).toBe(2);

    session.setActiveDataset(0);
    expect(session.getActiveDatasetIndex()).toBe(0);

    session.setActiveDataset(99);
    expect(session.getActiveDatasetIndex()).toBe(0); // unchanged
    session.setActiveDataset(-1);
    expect(session.getActiveDatasetIndex()).toBe(0); // unchanged
  });

  it('removeDataset refuses to remove the last remaining dataset', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.removeDataset(0);
    expect(session.getDatasetCount()).toBe(1);
  });

  it('removeDataset picks a sensible fallback active index when the active dataset is removed', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.addDataset(); // index 1, active
    session.addDataset(); // index 2, active
    expect(session.getActiveDatasetIndex()).toBe(2);

    session.removeDataset(2); // remove the active (last) one
    expect(session.getDatasetCount()).toBe(2);
    expect(session.getActiveDatasetIndex()).toBe(1); // clamped to the new last index
  });

  it('removeDataset shifts the active index down when removing an earlier dataset', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.addDataset(); // index 1
    session.addDataset(); // index 2, active
    session.removeDataset(0); // remove Series 1, before the active index
    expect(session.getDatasetCount()).toBe(2);
    expect(session.getActiveDatasetIndex()).toBe(1); // was 2, shifted down by one
  });

  it('renameDataset and setDatasetColor update the target dataset only', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.addDataset();
    session.renameDataset(0, 'Control');
    session.setDatasetColor(1, [1, 2, 3]);

    const infos = session.getDatasetInfos();
    expect(infos[0]!.name).toBe('Control');
    expect(infos[1]!.name).toBe('Series 2');
    expect(infos[1]!.color).toEqual([1, 2, 3]);
    expect(infos[0]!.color).not.toEqual([1, 2, 3]);
  });

  it('clearPoints preserves the active dataset\'s name and color, unlike discarding it entirely', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.renameDataset(0, 'Control');
    session.setDatasetColor(0, [9, 9, 9]);
    session.addDataPoint(250, 175);

    session.clearPoints();
    expect(session.getDataPoints()).toHaveLength(0);
    const info = session.getDatasetInfos()[0]!;
    expect(info.name).toBe('Control');
    expect(info.color).toEqual([9, 9, 9]);
  });

  it('each dataset keeps its own independent point-groups cursor', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();

    session.applyBoxPlotGroups();
    session.addDataPoint(300, 500); // Series 1: Min filled, cursor -> Q1
    expect(session.getCurrentGroupLabel()).toBe('Q1');

    session.addDataset(); // Series 2, active, no point groups yet
    expect(session.hasPointGroups()).toBe(false);
    session.applyBoxPlotGroups();
    expect(session.getCurrentGroupLabel()).toBe('Min'); // fresh cursor, unaffected by Series 1's

    session.setActiveDataset(0);
    expect(session.hasPointGroups()).toBe(true);
    expect(session.getCurrentGroupLabel()).toBe('Q1'); // Series 1's cursor is exactly where it was left
  });

  it('reset() collapses back to a single fresh "Series 1" dataset', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataset('Extra');
    session.addDataPoint(250, 175);

    session.reset();
    expect(session.getDatasetCount()).toBe(1);
    expect(session.getActiveDatasetIndex()).toBe(0);
    expect(session.getDatasetInfos()[0]!.name).toBe('Series 1');
    expect(session.getDataPoints()).toHaveLength(0);

    // The auto-naming counter also resets, not just the dataset list.
    session.addDataset();
    expect(session.getDatasetInfos()[1]!.name).toBe('Series 2');
  });
});

/**
 * Checkpoint 68 — per-axes calibration options.
 *
 * WPD exposes every one of these on its calibration sidebar
 * (`wpd-core/templates/_sidebars.html:251-527`); we hardcoded them to literals
 * across 6 of 7 axes types until now, which the 2026-07-15 parity re-audit
 * ranked as its biggest finding — log axes, table stakes for scientific
 * figures, were unreachable. See CLAUDE.md.
 */
describe('CalibrationSession — per-axes calibration options (checkpoint 68)', () => {
  it('seeds every option from its declared default', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(session.getOptions()).toEqual({ isLogX: 'false', isLogY: 'false', skipRotation: 'false' });
  });

  it('reads a log Y axis correctly — the capability that was unreachable', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.setOption('isLogY', 'true');
    // Y1=1 @ py 300, Y2=1000 @ py 0 -> three decades over 300px.
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(400, 300);
    session.confirmCalibrationValues(['10']);
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['1']);
    session.handleCalibrationClick(100, 0);
    session.confirmCalibrationValues(['1000']);
    expect(session.runCalibration()).toBe(true);

    session.addDataPoint(100, 200); // one decade up from the bottom
    const p = session.getDataPoints()[0]!;
    expect(p.data![1]).toBeCloseTo(10, 6);
  });

  it('re-reads existing handles when an option is toggled, without re-calibrating by hand', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(400, 300);
    session.confirmCalibrationValues(['10']);
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['1']);
    session.handleCalibrationClick(100, 0);
    session.confirmCalibrationValues(['1000']);
    session.runCalibration();
    session.addDataPoint(100, 200);
    // py 200 is one third of the way up from Y1(py 300) to Y2(py 0):
    // linear reads 1 + (1000-1)/3 = 334.
    expect(session.getDataPoints()[0]!.data![1]).toBeCloseTo(334, 2);

    // The option describes how the *existing* handles should be read, so
    // toggling it must update every derived value immediately. Same third of
    // the way up, but now of three decades (1 -> 1000): 10^1 = 10.
    session.setOption('isLogY', 'true');
    expect(session.getDataPoints()[0]!.data![1]).toBeCloseTo(10, 6);
  });

  it('defaults Map axes to a bottom-left origin, matching WPD', () => {
    // WPD's <select> lists "Bottom Left" first (templates/_sidebars.html:353);
    // we silently forced top-left until checkpoint 68.
    const session = new CalibrationSession(MAP_AXES_CONFIG);
    expect(session.getOptions()['origin']).toBe('bottom-left');
  });

  it('flips y for a bottom-left origin, using the image height it was told', () => {
    const session = new CalibrationSession(MAP_AXES_CONFIG);
    session.setImageHeight(400);
    calibrateStandardMap(session); // 300px == 30 units, so 0.1 unit/px
    expect(session.runCalibration()).toBe(true);
    session.addDataPoint(200, 150);
    // Bottom-left measures up from the image floor: (400 - 150 - 1) * 0.1.
    expect(session.getDataPoints()[0]!.data![1]).toBeCloseTo(24.9, 6);
  });

  it('defaults CCR to a 1-week rotation, matching WPD', () => {
    // WPD's own sidebar lists "1 Week" first AND its deserializer falls back to
    // 'week' (core/plotData.js:384); we hardcoded 'day' while claiming it
    // matched WPD.
    const session = new CalibrationSession(CIRCULAR_CHART_RECORDER_AXES_CONFIG);
    expect(session.getOptions()['rotationTime']).toBe('week');
  });

  it('restores the options a project was calibrated with, not the defaults', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.setOption('isLogY', 'true');
    session.setOption('skipRotation', 'true');
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(400, 300);
    session.confirmCalibrationValues(['10']);
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['1']);
    session.handleCalibrationClick(100, 0);
    session.confirmCalibrationValues(['1000']);
    session.runCalibration();

    const restored = new CalibrationSession(XY_AXES_CONFIG);
    restored.restoreState(session.captureState());
    expect(restored.getOptions()).toEqual({ isLogX: 'false', isLogY: 'true', skipRotation: 'true' });
  });

  it('carries options through undo, so settings and data never disagree', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    const before = session.captureState();
    session.setOption('isLogX', 'true');
    expect(session.getOptions()['isLogX']).toBe('true');
    session.restoreState(before);
    expect(session.getOptions()['isLogX']).toBe('false');
  });
});

/**
 * Guardrails found by the third-pass parity audit (2026-07-15).
 *
 * Both are silent-wrong-output paths: the calibration reports success and
 * every value reads back unusable, with nothing on screen saying so — the
 * exact failure this project's record-first principle singles out. Checkpoint 68
 * made log axes reachable, which made the first one live.
 */
describe('CalibrationSession — calibration guardrails (third-pass audit)', () => {
  function calibrateXY(session: CalibrationSession<XYAxes>, x1: string, x2: string, y1: string, y2: string) {
    session.handleCalibrationClick(100, 300); session.confirmCalibrationValues([x1]);
    session.handleCalibrationClick(400, 300); session.confirmCalibrationValues([x2]);
    session.handleCalibrationClick(100, 300); session.confirmCalibrationValues([y1]);
    session.handleCalibrationClick(100, 0);   session.confirmCalibrationValues([y2]);
  }

  it('refuses a log X axis through zero instead of silently reading back null', () => {
    // WPD refuses this in its controller (axesCalibration.js:79-86); the guard
    // never came across because core/ ports the axes classes only, and
    // XYAxes.processCalibration does Math.log(0) and still returns true.
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.setOption('isLogX', 'true');
    calibrateXY(session, '0', '100', '0', '100');
    expect(session.runCalibration()).toBe(false);
    expect(session.isCalibrated()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/log X scale cannot pass through zero/);
  });

  it('refuses a log Y axis through zero', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.setOption('isLogY', 'true');
    calibrateXY(session, '0', '100', '0', '100');
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/log Y scale cannot pass through zero/);
  });

  it('still calibrates a log axis whose values are non-zero', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.setOption('isLogX', 'true');
    calibrateXY(session, '1', '100', '0', '100');
    expect(session.runCalibration()).toBe(true);
    expect(session.isCalibrated()).toBe(true);
  });

  it('never offers the same axis\'s other end for pixel reuse', () => {
    // Reusing X1's pixel for X2 puts both points on one pixel -> singular
    // matrix -> XYAxes returns true and every value reads back null. Reuse
    // across axes (X1 for Y1, the shared origin) stays offered.
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['0']); // X1 placed; now at X2
    expect(session.getCurrentStep()?.key).toBe('x2');
    expect(session.getReusableSteps().map((s) => s.key)).toEqual([]);

    session.handleCalibrationClick(400, 300);
    session.confirmCalibrationValues(['10']); // X2 placed; now at Y1
    expect(session.getCurrentStep()?.key).toBe('y1');
    // X1 and X2 are both legitimate here: Y1 may share the origin pixel.
    expect(session.getReusableSteps().map((s) => s.key)).toEqual(['x1', 'x2']);
  });
});

/**
 * Checkpoint 72 — the guard CLASSES, not two more instances.
 *
 * An adversarial review of checkpoint 69 found it had "fixed two instances of
 * two bug classes and was written as if it fixed the classes". Both were still
 * one click away, on the axes types checkpoint 68 had just opened:
 *  - the log-zero guard was hardcoded XY-only, so Bar and Polar still
 *    calibrated "successfully" and read back null;
 *  - the reuse filter was a string-shape heuristic on a trailing digit, which
 *    silently no-opped on Ternary (a/b/c) and CCR (t1r2/t2r2), and never
 *    covered the drag path at all.
 * Both are now declared per config, so the guard cannot be forgotten for a new
 * type — and it runs before any axes class sees the values, because every axes
 * class reports success on degenerate input.
 */
describe('CalibrationSession — guard classes (checkpoint 72)', () => {
  it('refuses a log BAR scale through zero — a bar baseline IS zero, the most natural input', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    session.setOption('isLog', 'true');
    session.handleCalibrationClick(10, 300);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(10, 100);
    session.confirmCalibrationValues(['100']);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/log value scale cannot pass through zero/);
  });

  it('refuses a log POLAR radial scale through zero', () => {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    session.setOption('isLogR', 'true');
    session.handleCalibrationClick(100, 100); // origin
    session.handleCalibrationClick(200, 100);
    session.confirmCalibrationValues(['0', '0']); // r1 = 0
    session.handleCalibrationClick(100, 200);
    session.confirmCalibrationValues(['10', '90']);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/log radial scale cannot pass through zero/);
  });

  it('never offers reuse across TERNARY corners — the case the old heuristic missed', () => {
    const session = new CalibrationSession(TERNARY_AXES_CONFIG);
    session.handleCalibrationClick(100, 300); // A placed; now at B
    expect(session.getCurrentStep()?.key).toBe('b');
    expect(session.getReusableSteps().map((s) => s.key)).toEqual([]);
  });

  it('refuses a degenerate calibration reached by DRAG, not just by the reuse button', () => {
    // Checkpoint 69 closed the reuse door and left the drag door open.
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(400, 300);
    session.confirmCalibrationValues(['10']);
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(100, 0);
    session.confirmCalibrationValues(['10']);
    expect(session.runCalibration()).toBe(true);

    // Drag X2 onto X1 — no reuse button involved.
    session.updateCalibPointPixel('x2', 100, 300);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/same pixel/);
  });

  it('still allows the legitimate cross-axis shared origin (X1 <-> Y1)', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.handleCalibrationClick(100, 300);
    session.confirmCalibrationValues(['0']);
    session.handleCalibrationClick(400, 300);
    session.confirmCalibrationValues(['10']);
    expect(session.getCurrentStep()?.key).toBe('y1');
    expect(session.getReusableSteps().map((s) => s.key)).toEqual(['x1', 'x2']);
  });
});

describe('CalibrationSession interpolation-assist (checkpoint 120)', () => {
  it('ignores anchors until calibrated', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    expect(session.addAnchorPoint(150, 200)).toBe('ignored');
    expect(session.getDataPoints()).toHaveLength(0);
  });

  it('a single anchor stands alone -- no curve to fill yet', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    expect(session.addAnchorPoint(150, 200)).toBe('point-added');
    expect(session.getDataPoints()).toHaveLength(1);
    expect(session.getDataPointRoles()).toEqual(['anchor']);
  });

  it('fills a derived curve between anchors, tagging roles index-aligned with getDataPoints', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addAnchorPoint(120, 240);
    session.addAnchorPoint(250, 160);
    session.addAnchorPoint(380, 120);

    const roles = session.getDataPointRoles();
    const points = session.getDataPoints();
    expect(roles).toHaveLength(points.length); // index-aligned, same source array
    // 3 anchors + interpolated samples between them.
    const anchors = roles.filter((r) => r === 'anchor');
    const interp = roles.filter((r) => r === 'interpolated');
    expect(anchors).toHaveLength(3);
    expect(interp.length).toBeGreaterThan(3); // the fill is denser than the anchors
    // Curve order (rc.2): the series runs ALONG the curve, anchors interleaved with
    // the fill -- not parked in a block at the front. The curve starts on the first
    // anchor and ends on the last.
    expect(roles[0]).toBe('anchor');
    expect(roles[roles.length - 1]).toBe('anchor');
    // The three anchors round-trip at their exact pixels, in curve order (placed
    // left-to-right, so that IS their order along the curve).
    const anchorPix = points.filter((_, i) => roles[i] === 'anchor').map((p) => [p.px, p.py]);
    expect(anchorPix).toEqual([
      [120, 240],
      [250, 160],
      [380, 120],
    ]);
  });

  it('rebuilds the fill live on each new anchor (no stale derived points)', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addAnchorPoint(120, 240);
    session.addAnchorPoint(250, 160);
    const twoAnchorCount = session.getDataPoints().length;
    session.addAnchorPoint(380, 120);
    const threeAnchorCount = session.getDataPoints().length;
    // Adding a third anchor extended the curve rather than leaving orphaned
    // samples from the two-anchor fill.
    expect(threeAnchorCount).toBeGreaterThan(twoAnchorCount);
    // Exactly one 'interpolated' run -- the old fill was cleared, not stacked.
    expect(session.getDataPointRoles().filter((r) => r === 'anchor')).toHaveLength(3);
  });

  it('re-interpolates when an anchor is moved (drag / nudge / value-edit path)', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addAnchorPoint(120, 240);
    session.addAnchorPoint(380, 120);
    const before = session.getDataPoints().map((p) => [p.px, p.py]);

    // Move the first anchor (index 0) somewhere far -- the derived fill must follow.
    session.updateDataPointPixel(0, 120, 60);
    const roles = session.getDataPointRoles();
    const points = session.getDataPoints();
    expect(roles.filter((r) => r === 'anchor')).toHaveLength(2); // still exactly two anchors
    expect(points[0]!.px).toBe(120);
    expect(points[0]!.py).toBe(60); // the anchor moved
    // The fill is different from before the move (the curve was rebuilt, not stale).
    const after = points.map((p) => [p.px, p.py]);
    expect(after).not.toEqual(before);
    expect(roles.filter((r) => r === 'interpolated').length).toBeGreaterThan(0);
  });

  it('re-interpolates when an anchor is deleted (no stale fill spanning a gone guide point)', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addAnchorPoint(120, 240);
    session.addAnchorPoint(380, 120);
    expect(session.getDataPointRoles().filter((r) => r === 'interpolated').length).toBeGreaterThan(0);

    // Delete one of the two anchors -> one guide point left -> no curve to fill,
    // so the derived samples that spanned the deleted anchor are cleared.
    session.removeDataPointAt(0);
    const roles = session.getDataPointRoles();
    expect(roles.filter((r) => r === 'anchor')).toHaveLength(1);
    expect(roles.filter((r) => r === 'interpolated')).toHaveLength(0);
    expect(session.getDataPoints()).toHaveLength(1);
  });

  it('declines anchors on a point-group (Box Plot) dataset, like Segment Fill', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.applyBoxPlotGroups();
    expect(session.addAnchorPoint(150, 200)).toBe('ignored');
    expect(session.getDataPoints()).toHaveLength(0);
  });
});

describe('removeTuple — delete a whole Box Plot box / Histogram bin (checkpoint 129)', () => {
  function twoBoxes(session: CalibrationSession<BarAxes>) {
    calibrateStandardBar(session);
    session.runCalibration();
    // Box 0 (Bar0): Min..Max at py 500,460,420,380,340
    for (const py of [500, 460, 420, 380, 340]) session.addDataPoint(300, py);
    // Box 1 (Bar1): distinct py values so it's identifiable after a re-index
    for (const py of [480, 440, 400, 360, 320]) session.addDataPoint(300, py);
  }

  it('removes every point of a complete tuple plus its row, leaving the others', () => {
    const session = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
    twoBoxes(session);
    expect(session.getTupleRows()).toHaveLength(2);
    expect(session.getDataPoints()).toHaveLength(10);

    session.removeTuple(0);
    expect(session.getTupleRows()).toHaveLength(1);
    expect(session.getDataPoints()).toHaveLength(5); // only box 1's points remain
  });

  it('re-indexes the surviving tuples and their labels travel with them, not the index', () => {
    const session = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
    twoBoxes(session);

    session.removeTuple(0); // box 1 shifts down to index 0
    // The label is metadata on the tuple's own primary point, so it moves WITH
    // the box: what was Bar1 is now the only (index-0) row, still named Bar1.
    expect(session.getTupleLabel(0)).toBe('Bar1');
    // And it carries box 1's data (Min from py 480 -> (500-480)/400*10 = 0.5),
    // proving the right points survived, not box 0's.
    expect(session.getTupleRows()[0]!.points[0]!.data![0]).toBeCloseTo(0.5, 6);
  });

  it('recomputes the cursor so the next point opens a fresh tuple after the survivor', () => {
    const session = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
    twoBoxes(session);

    session.removeTuple(0);
    // The survivor is a complete tuple (no open slot), so the cursor points at
    // "new tuple", and the next point starts box index 1 -- not refilling box 0.
    expect(session.getCurrentTupleIndex()).toBeNull();
    session.addDataPoint(300, 500);
    expect(session.getTupleRows()).toHaveLength(2);
    expect(session.getCurrentTupleIndex()).toBe(1);
  });

  it('handles a partially-filled tuple (fewer than all groups placed)', () => {
    const session = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.addDataPoint(300, 500); // opens box 0 with just Min
    expect(session.getTupleRows()).toHaveLength(1);
    session.removeTuple(0);
    expect(session.getTupleRows()).toHaveLength(0);
    expect(session.getDataPoints()).toHaveLength(0);
  });

  it('is a no-op for an out-of-range index or a dataset without point groups', () => {
    const session = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
    twoBoxes(session);
    expect(() => session.removeTuple(-1)).not.toThrow();
    expect(() => session.removeTuple(99)).not.toThrow();
    expect(session.getTupleRows()).toHaveLength(2); // untouched

    const xy = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(xy);
    xy.runCalibration();
    xy.addDataPoint(250, 175);
    xy.removeTuple(0); // no point groups -> declines silently
    expect(xy.getDataPoints()).toHaveLength(1);
  });
});

describe('sortByNearestNeighbour — manual NN reorder (checkpoint 130)', () => {
  it('reorders out-of-order points into a nearest-neighbour path, keeping every point', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    // Bulk-added out of order along a horizontal line: 100, 400, then the middle
    // 250. A segment-fill / blob-detector batch arrives in arbitrary order and
    // does NOT go through insert-in-place (v1.1 #1), so it's the honest way to
    // build a scrambled series for the manual NN sort to fix (a click-placed
    // series now self-orders on the way in). NN from the leftmost threads
    // 100 -> 250 -> 400.
    session.addSegmentFillPoints([
      { x: 100, y: 250 },
      { x: 400, y: 250 },
      { x: 250, y: 250 },
    ]);
    expect(session.getDataPoints().map((p) => Math.round(p.px))).toEqual([100, 400, 250]);

    session.sortByNearestNeighbour();
    expect(session.getDataPoints().map((p) => Math.round(p.px))).toEqual([100, 250, 400]);
    expect(session.getDataPoints()).toHaveLength(3); // nothing added or dropped
  });

  it('canSortByNearestNeighbour gates on plain, 3+-point, non-interpolation series', () => {
    const xy = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(xy);
    xy.runCalibration();
    expect(xy.canSortByNearestNeighbour()).toBe(false); // 0 points
    xy.addDataPoint(100, 250);
    xy.addDataPoint(400, 250);
    expect(xy.canSortByNearestNeighbour()).toBe(false); // only 2
    xy.addDataPoint(250, 250);
    expect(xy.canSortByNearestNeighbour()).toBe(true); // 3 plain points

    // Interpolation series (anchors + derived samples) -> declined.
    const interp = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(interp);
    interp.runCalibration();
    interp.addAnchorPoint(120, 240);
    interp.addAnchorPoint(380, 130);
    expect(interp.getDataPoints().length).toBeGreaterThan(2); // spline fill present
    expect(interp.canSortByNearestNeighbour()).toBe(false);

    // Box Plot (point groups) -> declined regardless of count.
    const box = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
    calibrateStandardBar(box);
    box.runCalibration();
    for (const py of [500, 460, 420, 380, 340]) box.addDataPoint(300, py);
    expect(box.canSortByNearestNeighbour()).toBe(false);
  });

  it('is a no-op when it does not apply (grouped series unchanged)', () => {
    const box = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
    calibrateStandardBar(box);
    box.runCalibration();
    for (const py of [500, 460, 420, 380, 340]) box.addDataPoint(300, py);
    const before = box.getDataPoints().map((p) => Math.round(p.py));
    box.sortByNearestNeighbour();
    expect(box.getDataPoints().map((p) => Math.round(p.py))).toEqual(before);
  });

  it('preserves a series-level error relation across the sort', () => {
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    const errIdx = session.addDataset();
    expect(session.setErrorRelation(errIdx, { role: 'upper', of: 'Series 1' })).toBeNull();
    session.setActiveDataset(errIdx);
    session.addDataPoint(100, 250);
    session.addDataPoint(400, 250);
    session.addDataPoint(250, 250);

    session.sortByNearestNeighbour();
    expect(session.getErrorRelation(errIdx)).toEqual({ role: 'upper', of: 'Series 1' });
    expect(session.getDataPoints()).toHaveLength(3);
  });

  it('preserves per-pixel metadata (a loaded value override) through the sort — regression for the ckpt-130 audit HIGH', () => {
    // A plain ungrouped series LOADED from a project can carry per-pixel metadata
    // a click-placed one never does: a manual value `overrides` (and a Bar's
    // per-point `label`), both read at export. The first cut of
    // sortByNearestNeighbour rebuilt bare {x,y} and blanked these -> silent data
    // loss. Build that exact shape via the load path and prove each override
    // rides to the point it belongs to.
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    const axes = session.getAxes()!;

    const ds = new Dataset(XY_AXES_CONFIG.dataDim);
    ds.setMetadataKeys(['overrides']);
    // Out of order along a horizontal line, each with a distinct override so we
    // can tell which point it stayed attached to. Placement order: 100, 400, 250.
    ds.addPixel(100, 250, { overrides: { y: 111 } });
    ds.addPixel(400, 250, { overrides: { y: 333 } });
    ds.addPixel(250, 250, { overrides: { y: 222 } });
    session.loadCalibrated(axes, [ds]);
    expect(session.canSortByNearestNeighbour()).toBe(true);

    session.sortByNearestNeighbour();

    // NN threads 100 -> 250 -> 400, and each override must travel WITH its point.
    const pixels = ds.getAllPixels();
    expect(pixels.map((p) => Math.round(p.x))).toEqual([100, 250, 400]);
    expect(
      pixels.map((p) => (p.metadata as { overrides?: { y?: number } } | null)?.overrides?.y)
    ).toEqual([111, 222, 333]);
  });
});
