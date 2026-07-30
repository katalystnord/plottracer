import { describe, expect, it } from 'vitest';
import {
  CalibrationSession,
  XY_AXES_CONFIG,
  BAR_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  SPIDER_AXES_CONFIG,
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

    it('is ignored when the dataset has slots configured, unlike addDataPoint', () => {
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

// v1.3 — the role has to reach the EXPORT, not just the canvas. It already
// round-tripped through the project file; a CSV/JSON handed to anyone else
// flattened an assigned anchor and an invented spline sample into the same
// thing (the v0.6 audit's highest-value deferred finding).
describe('interpolation roles reach the export rows (v1.3)', () => {
  it('tags each export row with the role its point carries', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addAnchorPoint(150, 240);
    session.addAnchorPoint(380, 120);
    const roles = session.getDataPointRoles();
    const rows = session.getExportRows(0);
    expect(rows).toHaveLength(roles.length);
    // Index-aligned with the canvas' own view of the same points.
    expect(rows.map((r) => r.role ?? null)).toEqual(roles);
    expect(rows[0]!.role).toBe('anchor');
    expect(rows[1]!.role).toBe('interpolated');
  });

  it('leaves an ordinary traced point with no role at all', () => {
    // Not `role: null` -- absent, so a plain series exports exactly as before.
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addDataPoint(200, 200);
    expect(session.getExportRows(0)[0]).not.toHaveProperty('role');
  });

  it('reads the roles of a series that is NOT the active one', () => {
    // The spreadsheet and the export render every series at once, so roles have
    // to be readable per index -- the active-only getter can't answer for them.
    const session = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addAnchorPoint(150, 240);
    session.addAnchorPoint(380, 120);
    const guided = session.getActiveDatasetIndex();
    const plain = session.addDataset('Traced'); // switches active away from the guided one
    session.addDataPoint(200, 200);

    expect(session.getDataPointRolesFor(plain)).toEqual([null]);
    const guidedRoles = session.getDataPointRolesFor(guided);
    expect(guidedRoles.length).toBeGreaterThan(3);
    expect(guidedRoles[0]).toBe('anchor');
    expect(guidedRoles).toContain('interpolated');
    // ...and the same series still exports its roles while inactive.
    expect(session.getExportRows(guided)[0]!.role).toBe('anchor');
  });

  it('yields an empty list for an out-of-range dataset index', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(session.getDataPointRolesFor(99)).toEqual([]);
  });
});

// v1.3 #9 -- the category NAME is the independent variable of a Bar /
// categorical-line figure, and it is the one thing the pixels cannot carry: a
// reader transcribes it off the tick labels. Until now there was nowhere to put
// it (Bar's export read metadata.label but nothing could write it; the
// categorical line exported a bare ordinal).
describe('categorical-X labels (v1.3 #9) — v2.0: Bar is now 2 clicks (a tuple), not 1', () => {
  // ⚑ Bar's category name moved from the per-POINT API (getPointLabels/
  // setPointLabel, one label per pixel) to the per-TUPLE API (getTupleLabel/
  // setTupleLabel, one label per captured bar) once BAR_AXES_CONFIG declared
  // defaultSlots -- every Bar dataset is now tuple-shaped from creation, the
  // same API Box Plot/Pie/Histogram already use for their own category names.
  // The PREFILL behaviour itself (this whole describe block) is ported to
  // tuples by prefillTupleCategoryLabel, same algorithm as the old
  // prefillCategoryLabel, operating on each tuple's PRIMARY (first-clicked)
  // pixel instead of a single point.
  function barSession() {
    const session = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    return session;
  }

  /** Two clicks at the same x (Bar start, Bar end) capture one bar/tuple --
   * standing in for a drag-box's two corners in these engine-level tests. */
  function addBar(session: CalibrationSession<BarAxes>, x: number, yStart: number, yEnd: number) {
    session.addDataPoint(x, yStart);
    session.addDataPoint(x, yEnd);
  }

  it('names a tuple and reads it back per series', () => {
    const session = barSession();
    addBar(session, 150, 300, 250);
    addBar(session, 250, 300, 200);
    session.setTupleLabel(0, 'Flax');
    session.setTupleLabel(1, 'Hemp');
    expect([session.getTupleLabel(0), session.getTupleLabel(1)]).toEqual(['Flax', 'Hemp']);
  });

  it('registers the categoryIndex metadata key as soon as a bar is captured', () => {
    // The record is only durable if plotData knows to serialize the key.
    // v2.0: unlike the old per-point behaviour, the key is registered
    // IMMEDIATELY on capture, not only once a name is explicitly typed --
    // autoLabelTuple names every new tuple right away (same as Box Plot/Pie/
    // Histogram already do), so there is no longer an unlabeled-tuple state.
    // Phase 3: the key is "categoryIndex" now, not "label" -- a bar's category
    // resolves through the canonical CategoryAxis, not a per-tuple string.
    const session = barSession();
    addBar(session, 150, 300, 250);
    expect(session.getMetadataKeys()).toContain('categoryIndex');
  });

  it('prefills a new series\' bar from whichever series already named that column', () => {
    // A grouped bar chart repeats one category set across series; typing it again
    // per series is pure friction (David's call: prefill, not a shared list).
    // The prefill fires the moment a new tuple's FIRST corner lands, same timing
    // as the old per-point version's single click.
    const session = barSession();
    addBar(session, 150, 300, 250);
    addBar(session, 250, 300, 200);
    session.setTupleLabel(0, 'Flax');
    session.setTupleLabel(1, 'Hemp');

    session.addDataset('Alkali');
    addBar(session, 160, 300, 240);
    addBar(session, 260, 300, 190);
    expect([session.getTupleLabel(0), session.getTupleLabel(1)]).toEqual(['Flax', 'Hemp']);
  });

  it('writes the prefilled name ONTO the tuple, so retyping one bar moves nothing else', () => {
    // The reason this is a prefill and not a shared positional list: a series
    // that skips a category must be correctable without shifting its neighbours.
    const session = barSession();
    addBar(session, 150, 300, 250);
    addBar(session, 250, 300, 200);
    session.setTupleLabel(0, 'Flax');
    session.setTupleLabel(1, 'Hemp');
    session.addDataset('Alkali');
    addBar(session, 160, 300, 240);
    addBar(session, 260, 300, 190);

    session.setTupleLabel(1, 'Jute'); // series 2 has no Hemp bar
    expect([session.getTupleLabel(0), session.getTupleLabel(1)]).toEqual(['Flax', 'Jute']);
    session.setActiveDataset(0);
    expect([session.getTupleLabel(0), session.getTupleLabel(1)]).toEqual(['Flax', 'Hemp']); // series 1 untouched
  });

  // ⚑ The v1.3 release-gate audit proved the prefill could fabricate a WRONG name
  // and export it as if transcribed: it matched by ROW INDEX, which is click order,
  // not category identity. The pairing is now a measurement -- the nearest named
  // bar along the CATEGORY axis -- so it lands on the right category however the
  // user clicks and whatever they skip. These three pin the failure modes.
  it('a series that SKIPS a category is not given the skipped name', () => {
    const session = barSession();
    addBar(session, 150, 300, 250);
    addBar(session, 250, 300, 200);
    addBar(session, 350, 300, 220);
    session.setTupleLabel(0, 'Flax');
    session.setTupleLabel(1, 'Hemp');
    session.setTupleLabel(2, 'Jute');

    // Series 2 has no Hemp bar: the user drags the Flax bar, then the Jute bar.
    session.addDataset('Alkali');
    addBar(session, 160, 300, 240);
    addBar(session, 360, 300, 180);
    // Row-index matching gave tuple 1 the name "Hemp" -- against the JUTE bar.
    expect([session.getTupleLabel(0), session.getTupleLabel(1)]).toEqual(['Flax', 'Jute']);
  });

  it('names follow the bar dragged, not the order it was dragged in', () => {
    const session = barSession();
    addBar(session, 150, 300, 250);
    addBar(session, 250, 300, 200);
    session.setTupleLabel(0, 'Flax');
    session.setTupleLabel(1, 'Hemp');

    // Series 2 traced right-to-left. Tuple 0 is the HEMP bar.
    session.addDataset('Alkali');
    addBar(session, 260, 300, 190);
    addBar(session, 160, 300, 240);
    expect([session.getTupleLabel(0), session.getTupleLabel(1)]).toEqual(['Hemp', 'Flax']);
  });

  it('falls back to the plain Bar<i> default rather than reuse a name when the pairing is ambiguous', () => {
    // A category appears at most once per series, so a second claim on one name
    // means the nearest-bar pairing cannot tell -- and refusing to prefill is
    // honest where reusing a name that looks typed is not (tenets 9+10).
    //
    // ⚑ v2.0 DIFFERENCE FROM THE OLD PER-POINT BEHAVIOUR: a bar tuple that fails
    // the prefill now falls back to autoLabelTuple's plain numbered default
    // ("Bar1"), the SAME fallback every other tuple-shaped type (Box Plot, Pie,
    // Histogram) already gets unconditionally on every new tuple -- Bar now goes
    // through that identical code path instead of staying blank the way an
    // unslotted point used to. Still visibly a placeholder, still editable, and
    // still never a name that looks transcribed.
    const session = barSession();
    addBar(session, 150, 300, 250);
    session.setTupleLabel(0, 'Flax');

    session.addDataset('Alkali');
    addBar(session, 155, 300, 245);
    addBar(session, 158, 300, 235); // a second bar by the same donor
    expect([session.getTupleLabel(0), session.getTupleLabel(1)]).toEqual(['Flax', 'Bar1']);
  });

  it('carries a typed name into the Bar export (no Bar<i> fallback once named)', () => {
    const session = barSession();
    addBar(session, 150, 300, 250);
    session.setTupleLabel(0, 'Flax');
    expect(session.getTupleRows()[0]!.label).toBe('Flax');
  });

  // ⚑ v2.0 Phase 3: the canonical CategoryAxis is what makes these two true
  // at once -- a rename propagates when it's safe, and never corrupts a
  // sibling series' data when it isn't. Direct coverage beyond what the
  // adapted tests above exercise incidentally.
  it('renaming a category with no other owner propagates in place -- the same category, just a better name', () => {
    const session = barSession();
    addBar(session, 150, 300, 250);
    session.setTupleLabel(0, 'Flax'); // sole owner: renames in place
    session.setTupleLabel(0, 'Flaxseed'); // retyping again, still sole owner
    expect(session.getTupleLabel(0)).toBe('Flaxseed');
    // It's a RENAME, not a new category sitting alongside the old one.
    expect(session.getCategoryAxis().getCategories()).toEqual(['Flaxseed']);
  });

  it('typing an EXISTING category\'s exact name joins it by canonical identity, not just by position', () => {
    // Distinct from prefill (which matches by nearest position): this is the
    // user directly typing a name that already exists elsewhere, and it must
    // share the SAME index -- so renaming either bar afterward renames both,
    // exactly as if prefill had assigned it.
    const session = barSession();
    addBar(session, 150, 300, 250);
    session.setTupleLabel(0, 'Flax');

    session.addDataset('Alkali');
    addBar(session, 900, 300, 200); // far away -- prefill would NOT have matched this to Flax
    session.setTupleLabel(0, 'Flax'); // typed manually, same exact name
    expect(session.getCategoryAxis().getCategories()).toEqual(['Flax']); // joined, not duplicated

    // Now shared -- renaming this series' bar must not corrupt series 1's.
    session.setTupleLabel(0, 'Flax (batch 2)');
    session.setActiveDataset(0);
    expect(session.getTupleLabel(0)).toBe('Flax'); // untouched
  });

  it('grows the categorical export a Category column only once something is named', () => {
    const session = new CalibrationSession<BarAxes>(CATEGORICAL_LINE_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.addDataPoint(150, 300);
    session.addDataPoint(250, 200);
    // Untouched: exactly the Position/Value contract shipped since checkpoint 101.
    expect(session.getExportFields()).toEqual(['Position', 'Value']);
    expect(session.getExportRows(0)[0]!.values).toHaveLength(2);
    const valuesBefore = session.getExportRows(0).map((r) => r.values[1]);

    session.setPointLabel(0, 'Flax');
    // ⚑ Position, Category, VALUE -- independent variables first, then the dependent
    // one. Matches Bar's own inherited contract (Label before the value) and the
    // on-screen table, which showed Category before Value from the start. The first
    // cut appended Category to keep "files already in the wild" from shifting, but
    // no such file can exist: nothing before v1.3 could name a point, and an
    // unnamed export is still byte-identical `Position, Value` (asserted above).
    // David caught the incoherence, 2026-07-26.
    expect(session.getExportFields()).toEqual(['Position', 'Category', 'Value']);
    const rows = session.getExportRows(0);
    expect(rows[0]!.values[1]).toBe('Flax');
    // An unnamed point in a named figure exports BLANK -- never a made-up name.
    expect(rows[1]!.values[1]).toBe('');
    // ⚑ The measured values are UNCHANGED by the reorder -- they moved column, they
    // did not move value. Compared against the same export before the name existed,
    // so this cannot pass by agreeing with a hardcoded number I guessed wrong.
    expect(rows.map((r) => r.values[2])).toEqual(valuesBefore);
    expect(rows[0]!.values).toHaveLength(3);
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
  it('addDataPoint behaves like an ungrouped dataset until slots are configured', () => {
    // v2.0: BAR_AXES_CONFIG itself is no longer a genuinely ungrouped fixture
    // (it declares defaultSlots unconditionally) -- CATEGORICAL_LINE_CONFIG
    // shares BarAxes but is still deliberately ungrouped ("points are captured
    // like an XY series, not bars"), so it's the fixture for this behaviour now.
    const session = new CalibrationSession(CATEGORICAL_LINE_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    expect(session.hasSlots()).toBe(false);

    session.addDataPoint(300, 300);
    expect(session.getDataPoints()).toHaveLength(1);
    expect(session.getTupleRows()).toEqual([]);
  });

  it('applyBoxPlotGroups sets Min/Q1/Median/Q3/Max, and setSlotNames declines once real data exists', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    expect(session.applyBoxPlotGroups()).toBe(true);
    expect(session.getSlotNames()).toEqual(['Min', 'Q1', 'Median', 'Q3', 'Max']);
    expect(session.hasSlots()).toBe(true);

    // ⚑ v2.0: relaxed from "declines whenever slots exist" to "declines once a
    // tuple actually holds data" -- Bar now declares its own 2 default slots
    // unconditionally, so the OLD guard would have made applyBoxPlotGroups a
    // permanent no-op on every fresh Bar session. See setSlotNames's own
    // comment. The safety property that matters -- never reshape a slot
    // structure that already holds real clicks -- still holds once data exists.
    session.addDataPoint(300, 500); // Min -- real captured data now exists
    expect(session.setSlotNames(['A', 'B'])).toBe(false);
    expect(session.getSlotNames()).toEqual(['Min', 'Q1', 'Median', 'Q3', 'Max']);
  });

  it('files 5 clicks into one tuple, cycling the group cursor Min through Max, then starts a new tuple', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.applyBoxPlotGroups();

    const expectedLabels = ['Min', 'Q1', 'Median', 'Q3', 'Max'];
    for (let i = 0; i < 5; i++) {
      expect(session.getCurrentTupleIndex()).toBe(i === 0 ? null : 0);
      expect(session.getCurrentSlotIndex()).toBe(i);
      expect(session.getCurrentSlotLabel()).toBe(expectedLabels[i]);
      session.addDataPoint(300, 500 - i * 40);
    }
    // Tuple complete: cursor rolls over to a fresh tuple at the first group.
    expect(session.getCurrentTupleIndex()).toBeNull();
    expect(session.getCurrentSlotIndex()).toBe(0);

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
    session.nextSlot(); // skip Q1
    expect(session.getCurrentSlotLabel()).toBe('Median');
    session.addDataPoint(300, 300); // Median, tuple 0

    const rows = session.getTupleRows();
    expect(rows[0]!.points[0]).not.toBeNull(); // Min filled
    expect(rows[0]!.points[1]).toBeNull(); // Q1 still open
    expect(rows[0]!.points[2]).not.toBeNull(); // Median filled

    // The cursor still finds Q1 as the next open slot in the same tuple,
    // rather than jumping ahead to Q3 -- nextSlot searches forward
    // from the current position, so it never revisits a skipped slot on
    // its own; previousSlot below is what walks back to it.
    session.previousSlot();
    session.previousSlot();
    expect(session.getCurrentTupleIndex()).toBe(0);
    expect(session.getCurrentSlotIndex()).toBe(1);
  });

  it('removeLastPoint cleans up the tuple slot and walks the cursor back', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.applyBoxPlotGroups();

    session.addDataPoint(300, 500); // Min
    session.addDataPoint(300, 460); // Q1
    expect(session.getCurrentSlotIndex()).toBe(2); // Median

    session.removeLastPoint();
    expect(session.getDataPoints()).toHaveLength(1);
    expect(session.getCurrentTupleIndex()).toBe(0);
    expect(session.getCurrentSlotIndex()).toBe(1); // back to Q1
    expect(session.getTupleRows()[0]!.points[1]).toBeNull();

    session.removeLastPoint();
    expect(session.getDataPoints()).toHaveLength(0);
    // The now-empty tuple is dropped entirely, not left as a blank row.
    expect(session.getTupleRows()).toHaveLength(0);
    expect(session.getCurrentTupleIndex()).toBeNull();
    expect(session.getCurrentSlotIndex()).toBe(0);
  });

  it('clearPoints resets the cursor and reverts to the graph type\'s OWN default slots', () => {
    // v2.0: Bar's own default is now 2 slots (BAR_INTERVAL_SLOTS), not none.
    // applyBoxPlotGroups's 5-slot upgrade is the OPT-IN state clearPoints
    // always drops; the type's OWN shape is what survives a clear -- exactly
    // what clearPoints's own comment already says ("Only the graph type's OWN
    // groups come back"), just truer now that Bar has an own shape at all.
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();
    session.applyBoxPlotGroups();
    session.addDataPoint(300, 500);

    session.clearPoints();
    expect(session.hasSlots()).toBe(true);
    expect(session.getSlotNames()).toEqual(['Bar start', 'Bar end']);
    expect(session.getCurrentTupleIndex()).toBeNull();
    expect(session.getCurrentSlotIndex()).toBe(0);
  });

  describe('getBoxPlotGlyphs (checkpoint 22)', () => {
    it('is empty before slots are configured, and while a tuple is incomplete', () => {
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
      session.setSlotNames(['Min', 'Q1', 'Median', 'Q3', 'Max']);
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
      expect(session.hasSlots()).toBe(true);
      expect(session.getSlotNames()).toEqual(['Min', 'Q1', 'Median', 'Q3', 'Max']);
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

    it('setTupleLabel overrides the auto-generated default, via the canonical CategoryAxis', () => {
      // v2.0 Phase 6: the legacy "Box Plot Groups" toggle reaches the same
      // 5-slot shape as the first-class Box Plot config, so it now shares
      // the same CategoryAxis naming (usesCategoryAxis is axesKind+hasSlots
      // based, not gated on which door produced the slots) -- registers
      // "categoryIndex", not "label".
      const session = new CalibrationSession(BAR_AXES_CONFIG);
      calibrateStandardBar(session);
      session.runCalibration();
      session.applyBoxPlotGroups();
      session.addDataPoint(300, 500); // tuple 0

      session.setTupleLabel(0, 'Sample A');
      expect(session.getTupleLabel(0)).toBe('Sample A');
      expect(session.getTupleRows()[0]!.label).toBe('Sample A');
      expect(session.getMetadataKeys()).toContain('categoryIndex');
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

    it('a first-class Box Plot session resolves its category label live through the canonical CategoryAxis', () => {
      // The actual payoff of usesCategoryAxis covering Box Plot (v2.0 Phase
      // 6): getTupleLabel is a live read through the CategoryAxis entry
      // (metadata.categoryIndex), not a frozen per-tuple string copy -- so
      // renaming the entry through the CategoryAxis itself (as a "manage
      // categories" reorder/rename UI would) is reflected immediately,
      // exactly like it already was for Bar.
      const session = new CalibrationSession(BOX_PLOT_AXES_CONFIG);
      calibrateStandardBar(session);
      session.runCalibration();
      for (const py of [500, 460, 420, 380, 340]) session.addDataPoint(300, py); // tuple 0
      session.setTupleLabel(0, 'Group A');
      expect(session.getTupleLabel(0)).toBe('Group A');

      const idx = session.getCategoryAxis().getCategoryIndex('Group A');
      expect(idx).toBeGreaterThanOrEqual(0);
      session.getCategoryAxis().renameCategory(idx, 'Group A (renamed)');
      expect(session.getTupleLabel(0)).toBe('Group A (renamed)');
    });

    it('protects a sole-owner box\'s name from a typo fix on a DIFFERENT box that shares its typed name', () => {
      // The v1.3 #9 protection, now proven for Box Plot too: two boxes
      // happen to share a typed name; correcting a typo on one must not
      // silently rename the other out from under it, since setTupleLabel
      // cannot tell "shared on purpose" from "coincidentally identical, one
      // of them is wrong".
      const session = new CalibrationSession(BOX_PLOT_AXES_CONFIG);
      calibrateStandardBar(session);
      session.runCalibration();
      for (const py of [500, 460, 420, 380, 340]) session.addDataPoint(300, py); // tuple 0
      for (const py of [500, 460, 420, 380, 340]) session.addDataPoint(300, py); // tuple 1
      session.setTupleLabel(0, 'Groop A');
      session.setTupleLabel(1, 'Groop A'); // shares tuple 0's category index

      session.setTupleLabel(0, 'Group A'); // fixes tuple 0's typo only
      expect(session.getTupleLabel(0)).toBe('Group A');
      expect(session.getTupleLabel(1)).toBe('Groop A'); // untouched, not silently corrected
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
// so both 3-slots ({T0,R0/R1/R2} for the pen circle, {T0,R2/T1,R2/T2,R2}
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

  it('each dataset keeps its own independent slot cursor', () => {
    const session = new CalibrationSession(BAR_AXES_CONFIG);
    calibrateStandardBar(session);
    session.runCalibration();

    session.applyBoxPlotGroups();
    session.addDataPoint(300, 500); // Series 1: Min filled, cursor -> Q1
    expect(session.getCurrentSlotLabel()).toBe('Q1');

    session.addDataset(); // Series 2, active -- starts with Bar's own 2 default slots
    expect(session.hasSlots()).toBe(true);
    expect(session.getSlotNames()).toEqual(['Bar start', 'Bar end']);
    session.applyBoxPlotGroups();
    expect(session.getCurrentSlotLabel()).toBe('Min'); // fresh cursor, unaffected by Series 1's

    session.setActiveDataset(0);
    expect(session.hasSlots()).toBe(true);
    expect(session.getCurrentSlotLabel()).toBe('Q1'); // Series 1's cursor is exactly where it was left
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

  it('REFUSES to move a derived sample — the guard is in the model, not a UI handler', () => {
    // ⚑ v1.3 put this guard in commitDataPointEdit, a UI handler whose own comment
    // called itself "the model-side rule". The v1.3 gate walked around it: click an
    // italic (read-only) table row to select it, then press an arrow key, and the
    // derived sample moved -- reported as `role=interpolated` at a hand-chosen
    // position, then silently discarded by the next rebuild. That is the exact
    // defect the read-only rows were added to close, reached by another door.
    // updateDataPointPixel is where drag, nudge and value-edit all converge.
    const session = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(session);
    session.runCalibration();
    session.addAnchorPoint(120, 240);
    session.addAnchorPoint(380, 120);
    const derived = session.getDataPointRoles().indexOf('interpolated');
    expect(derived).toBeGreaterThanOrEqual(0);
    const before = session.getDataPoints()[derived]!;

    session.updateDataPointPixel(derived, before.px, before.py - 40);

    const after = session.getDataPoints()[derived]!;
    expect(after.px).toBe(before.px);
    expect(after.py).toBe(before.py); // unmoved
    // An ANCHOR still moves -- the guard is scoped to derived samples only.
    const anchor = session.getDataPointRoles().indexOf('anchor');
    session.updateDataPointPixel(anchor, 120, 60);
    expect(session.getDataPoints()[session.getDataPointRoles().indexOf('anchor')]!.py).toBe(60);
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

  it('declines anchors on a slot (Box Plot) dataset, like Segment Fill', () => {
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

  it('is a no-op for an out-of-range index or a dataset without slots', () => {
    const session = new CalibrationSession<BarAxes>(BOX_PLOT_AXES_CONFIG);
    twoBoxes(session);
    expect(() => session.removeTuple(-1)).not.toThrow();
    expect(() => session.removeTuple(99)).not.toThrow();
    expect(session.getTupleRows()).toHaveLength(2); // untouched

    const xy = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    calibrateStandardXY(xy);
    xy.runCalibration();
    xy.addDataPoint(250, 175);
    xy.removeTuple(0); // no slots -> declines silently
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

    // Box Plot (slots) -> declined regardless of count.
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

describe('what a graph type declares it CAN DO (v1.5)', () => {
  // ⚑ v1.5 regression, caught by the release-gate audit. Auto-extract used to be
  // refused by INFERENCE -- the rail button read `hasPointGroups && id !== 'spider'`
  // -- and the v1.5 refactor replaced that with a declared `autoExtractKind`.
  // Every slot-filling type was given `'none'` except the retired ERROR_BAR config,
  // which fell through to the `'curve'` default and got its Auto-extract button
  // back. That config has since been deleted outright, so the instance is gone --
  // but the RULE is what stops the next slot type repeating it, so it is asserted
  // here rather than left to the next refactor to rediscover.
  const ALL_CONFIGS = [
    XY_AXES_CONFIG,
    HISTOGRAM_AXES_CONFIG,
    BAR_AXES_CONFIG,
    CATEGORICAL_LINE_CONFIG,
    BOX_PLOT_AXES_CONFIG,
    POLAR_AXES_CONFIG,
    SPIDER_AXES_CONFIG,
    TERNARY_AXES_CONFIG,
    MAP_AXES_CONFIG,
    CIRCULAR_CHART_RECORDER_AXES_CONFIG,
  ];

  it('no slot-filling graph type falls through to curve auto-extract', () => {
    const offenders = ALL_CONFIGS.filter(
      (c) => (c.defaultSlots?.length ?? 0) > 0 && (c.autoExtractKind ?? 'curve') === 'curve'
    ).map((c) => c.id);
    expect(offenders).toEqual([]);
  });

  it('spider is the deliberate exception: its slots ARE traced, along the spokes', () => {
    expect(SPIDER_AXES_CONFIG.autoExtractKind).toBe('along-axes');
  });
});
