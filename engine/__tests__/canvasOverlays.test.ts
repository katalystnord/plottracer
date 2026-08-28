import { describe, it, expect } from 'vitest';
import {
  buildCanvasMarkers,
  buildSeriesLines,
  radialLabelCentre,
  runsForPoints,
  SELECTED_DOT_RADIUS,
  type CanvasMarker,
  type CanvasMarkerInput,
} from '../canvasOverlays.js';
import type { OverlaySeries, OverlaySeriesInfo } from '../canvasOverlays.js';
import type { CalibStepInfo } from '../axesTypeConfigs.js';
import type { CapHandle } from '../calibrationSession.js';

/**
 * These assert the BOOLEANS on a marker - which ones Konva may drag, and which
 * must stay out of its hit graph so the press underneath reaches the stage.
 * Three shipped defects lived in exactly those booleans (v1.3's caps, v2.0.1's
 * hauled datum, the pie ring's swallowed closing click), and none of them was
 * reachable by a test until this moved out of Workspace.tsx.
 */

const step = (key: string, label = key.toUpperCase(), color = '#111'): CalibStepInfo => ({
  key,
  label,
  color,
  prompt: `click ${key}`,
  valueFields: [],
});

/**
 * ⚑⚑ A DECLARED COUNT IS NOT A COORDINATE. A heatmap's second corner takes the
 * X value AND how many COLUMNS the figure has, into `dx` and `dz`. The marker
 * drawn on the figure joined every value it held, so that corner printed
 * `=24, 5` - which reads as a coordinate pair, and on a heatmap whose other axis
 * is numeric a reader takes it as x=24, y=5. Worse on a CATEGORY axis, where the
 * corner takes only the count and the label read `First column x last row=5`:
 * a bare 5 presented as the place that corner sits.
 *
 * `dz` is documented in `CalibValueField` as *"a slot, not a Z axis"* - spider
 * puts an axis NAME there, a heatmap puts a band COUNT. Neither is a position,
 * so neither belongs in a label that says where a point is.
 *
 * ⚠️ Caught by David on the built app, on a figure with a category axis. No test
 * could see it: the label is a string nobody was asserting on.
 */
const cornerStep = (key: string, label: string, fields: Array<'dx' | 'dy' | 'dz'>): CalibStepInfo => ({
  key,
  label,
  color: '#111',
  prompt: `click ${key}`,
  valueFields: fields.map((field, i) => ({ key: `${key}${i}`, label: field, field })),
});

describe('what a calibration marker says its point is', () => {
  const at = { px: 10, py: 20 };
  /** ⚑ MID-WALK, because that is when a calibration label is drawn at all: since
   * v2.3 a committed calibration stops labelling the figure it calibrated (the
   * anchors sit over a heatmap's own cells). These cases are about what a label
   * SAYS, so they are taken in the state that says it. */
  const walking = { isCalibrated: false, mode: 'calibrate' } as const;

  it('⚑⚑ a declared COUNT is left out - it is not where the point is', () => {
    const steps = [cornerStep('x2', 'Cn × R1', ['dx', 'dz'])];
    const m = buildCanvasMarkers(
      base({ ...walking, steps, placedPoints: { x2: { ...at, values: ['24', '5'] } } })
    );
    const marker = m.find((x) => x.id === 'x2')!;
    expect(marker.label).toBe('Cn × R1=24');
  });

  it('⚑ a corner that takes ONLY a count says nothing about where it is', () => {
    // The category case: the step collects the row count and no coordinate, so
    // there is no value to report for this point at all.
    const steps = [cornerStep('y2', 'C1 × Rn', ['dz'])];
    const m = buildCanvasMarkers(
      base({ ...walking, steps, placedPoints: { y2: { ...at, values: ['5'] } } })
    );
    expect(m.find((x) => x.id === 'y2')!.label).toBe('C1 × Rn');
  });

  it('⚑ an ordinary coordinate still shows - the guard must not over-reach', () => {
    const steps = [cornerStep('x1', 'C1 × R1', ['dx'])];
    const m = buildCanvasMarkers(
      base({ ...walking, steps, placedPoints: { x1: { ...at, values: ['0'] } } })
    );
    expect(m.find((x) => x.id === 'x1')!.label).toBe('C1 × R1=0');
  });

  it('⚑ and a two-COORDINATE point still shows both', () => {
    const steps = [cornerStep('p1', 'P1', ['dx', 'dy'])];
    const m = buildCanvasMarkers(
      base({ ...walking, steps, placedPoints: { p1: { ...at, values: ['3', '4'] } } })
    );
    expect(m.find((x) => x.id === 'p1')!.label).toBe('P1=3, 4');
  });
});

/** A scatter: markers far apart, so polylineRuns yields no runs. */
const sparse = (n: number, x0 = 0) =>
  Array.from({ length: n }, (_, i) => ({ px: x0 + i * 40, py: 100 + i * 40 }));

/** A traced curve: ~1px median gap, which is what makes a series "dense". */
const dense = (n: number) => Array.from({ length: n }, (_, i) => ({ px: i, py: 50 }));

/** ⚑ A traced curve that the polyline CANNOT fully cover: dense enough to count
 *  as a curve, but with strays far enough out that `polylineRuns` leaves each of
 *  them in a fragment of one point, and a one-point fragment is not a run. Every
 *  other fixture here is UNIFORMLY dense or UNIFORMLY sparse, which is exactly
 *  why the case below went unnoticed. */
const denseWithStrays = (n: number) => [
  ...Array.from({ length: n }, (_, i) => ({ px: i, py: 50 })),
  { px: n + 400, py: 90 },
  { px: n + 800, py: 20 },
];

const info = (_index: number, active: boolean, color: [number, number, number]): OverlaySeriesInfo => ({
  color,
  active,
});

const view = (
  index: number,
  active: boolean,
  color: [number, number, number],
  points: { px: number; py: number }[]
): OverlaySeries => ({ index, color, active, points });

function base(over: Partial<CanvasMarkerInput> = {}): CanvasMarkerInput {
  return {
    steps: [],
    placedPoints: {},
    pendingPixel: null,
    pendingPixelColor: '#pending',
    dataPoints: [],
    dataPointRoles: [],
    allDatasetsData: [],
    datasetInfos: [info(0, true, [10, 20, 30])],
    fallbackColor: '#fallback',
    axesKind: 'xy',
    isCalibrated: true,
    labelAway: undefined,
    ringClosingIndex: null,
    mode: 'place-point',
    activeHandleKey: null,
    activePointIndex: null,
    selectedPointIndices: [],
    activeDatasetIndex: 0,
    errorTargetIndex: 0,
    ...over,
  };
}

const points = (markers: CanvasMarker[]) => markers.filter((m) => m.id.startsWith('point-'));

describe('calibration handles', () => {
  const steps = [step('x1'), step('y1')];
  const placed = { x1: { px: 5, py: 6, values: ['0'] }, y1: { px: 7, py: 8, values: [] } };

  it('draw only where a pixel has actually been placed', () => {
    const m = buildCanvasMarkers(base({ steps, placedPoints: { x1: placed.x1 } }));
    expect(m.map((x) => x.id)).toEqual(['x1']);
  });

  it('are draggable ONLY once calibrated AND in Calibrate mode', () => {
    // Mid-walk a click landing on an already-placed handle (X1 and Y1 sharing an
    // origin pixel is an ordinary calibration) must register as the NEXT step's
    // click, not start a drag.
    const midWalk = buildCanvasMarkers(base({ steps, placedPoints: placed, isCalibrated: false, mode: 'calibrate' }));
    expect(midWalk.every((x) => x.draggable === false)).toBe(true);

    // Once calibrated, still inert outside Calibrate - a handle on the origin
    // would otherwise swallow the click meant to drop a data point there.
    for (const mode of ['place-point', 'pan', 'select', 'error-bars']) {
      const m = buildCanvasMarkers(base({ steps, placedPoints: placed, mode }));
      expect(m.every((x) => x.draggable === false), mode).toBe(true);
    }

    const live = buildCanvasMarkers(base({ steps, placedPoints: placed, mode: 'calibrate' }));
    expect(live.every((x) => x.draggable === true)).toBe(true);
  });

  it('render as calibration reticles, not data dots', () => {
    const m = buildCanvasMarkers(base({ steps, placedPoints: placed }));
    expect(m.every((x) => x.kind === 'calibration')).toBe(true);
  });

  it('highlight the one the arrow keys will move', () => {
    const m = buildCanvasMarkers(base({ steps, placedPoints: placed, activeHandleKey: 'y1' }));
    expect(m.find((x) => x.id === 'y1')?.selected).toBe(true);
    expect(m.find((x) => x.id === 'x1')?.selected).toBe(false);
  });

  it('label spider handles with the VALUE alone, and everything else with step=values', () => {
    // ⚑ "Axis 5=80, Biodegradation" - six of those sprawled across the plot,
    // repeating axis names the figure already prints.
    const spider = buildCanvasMarkers(
      base({ isCalibrated: false, mode: 'calibrate', axesKind: 'spider', steps: [step('a1', 'Axis 5')], placedPoints: { a1: { px: 1, py: 2, values: ['80', 'Biodegradation'] } } })
    );
    expect(spider[0]!.label).toBe('80');

    const xy = buildCanvasMarkers(
      base({ isCalibrated: false, mode: 'calibrate', steps: [step('x1', 'X1')], placedPoints: { x1: { px: 1, py: 2, values: ['0', '10'] } } })
    );
    expect(xy[0]!.label).toBe('X1=0, 10');

    const valueless = buildCanvasMarkers(
      base({ isCalibrated: false, mode: 'calibrate', steps: [step('o', 'Origin')], placedPoints: { o: { px: 1, py: 2, values: [] } } })
    );
    expect(valueless[0]!.label).toBe('Origin');
  });

  it('falls back to the step name on a spider handle that has no value yet', () => {
    // Reading values[0] unconditionally would print the string "undefined".
    const m = buildCanvasMarkers(
      base({ isCalibrated: false, mode: 'calibrate', axesKind: 'spider', steps: [step('a1', 'Axis 1')], placedPoints: { a1: { px: 1, py: 2, values: [] } } })
    );
    expect(m[0]!.label).toBe('Axis 1');
  });

  it('lean their labels away from a radial centre too, not just the data points', () => {
    const m = buildCanvasMarkers(
      base({ steps: [step('x1')], placedPoints: { x1: { px: 1, py: 2, values: [] } }, labelAway: { x: 50, y: 60 } })
    );
    expect(m[0]!.labelAway).toEqual({ x: 50, y: 60 });
    const plain = buildCanvasMarkers(base({ steps: [step('x1')], placedPoints: { x1: { px: 1, py: 2, values: [] } } }));
    expect('labelAway' in plain[0]!).toBe(false);
  });

  it('carry the STAGGER a config asks for, so labels on one line do not collide', () => {
    // ⚑ The heatmap's four colour-key clicks land along one strip, where every
    // handle's outward direction is the same direction - so leaning away cannot
    // separate them and the config says which ones hang below instead. Which
    // steps stagger is the config's knowledge, never this module's.
    const staggered = { ...step('kv1', 'Key value 1'), labelBelow: true };
    const m = buildCanvasMarkers(
      base({ steps: [staggered, step('k1', 'Key start')], placedPoints: { kv1: { px: 1, py: 2, values: ['20'] }, k1: { px: 3, py: 2, values: [] } } })
    );
    expect(m[0]!.labelBelow).toBe(true);
    // …and a step that did not ask carries no key at all, not an explicit
    // `undefined` - the exactOptionalPropertyTypes rule labelAway follows.
    expect('labelBelow' in m[1]!).toBe(false);
  });
});

describe('the pending calibration pixel', () => {
  it('draws a "?" in its own colour, and only while one is pending', () => {
    expect(buildCanvasMarkers(base()).find((m) => m.id === 'pending')).toBeUndefined();
    const m = buildCanvasMarkers(base({ pendingPixel: { px: 9, py: 9 } }));
    const pending = m.find((x) => x.id === 'pending');
    expect(pending).toMatchObject({ x: 9, y: 9, label: '?', color: '#pending' });
  });
});

describe('inactive series are context, never a click target', () => {
  it('draw as unlabelled, non-draggable dots in their own colour', () => {
    const m = buildCanvasMarkers(
      base({ allDatasetsData: [view(1, false, [1, 2, 3], sparse(2)), view(0, true, [9, 9, 9], [])] })
    );
    const inactive = m.filter((x) => x.id.startsWith('inactive-point-'));
    expect(inactive).toHaveLength(2);
    expect(inactive.every((x) => x.draggable === false && x.label === '')).toBe(true);
    expect(inactive[0]!.color).toBe('rgb(1, 2, 3)');
  });

  it('drop their dots entirely when dense - the LINE carries the shape', () => {
    // Even tiny dots mush into a furry band, and an inactive series has no
    // selection to preserve.
    const m = buildCanvasMarkers(base({ allDatasetsData: [view(1, false, [1, 2, 3], dense(40))] }));
    expect(m.filter((x) => x.id.startsWith('inactive-point-'))).toHaveLength(0);
  });

  it('a point the line cannot reach keeps its dot', () => {
    // ⚑ The dots are dropped because "the LINE carries the shape" -- so a point
    // with no line through it must keep its own. `polylineRuns` discards any
    // fragment shorter than two points, so a stray is in no run at all: drop its
    // dot too and a reading the record HAS is drawn by nothing. This file already
    // ruled on the class ("JOINED, not dropped ... a real reading invisible
    // rather than merely unreadable"); unreadable is acceptable, invisible is not.
    const m = buildCanvasMarkers(base({ allDatasetsData: [view(1, false, [1, 2, 3], denseWithStrays(40))] }));
    const drawn = m.filter((x) => x.id.startsWith('inactive-point-'));
    expect(drawn.map((d) => [d.x, d.y])).toEqual([
      [440, 90],
      [840, 20],
    ]);
  });

  it('skip the ACTIVE series - its own points are pushed later, interactive', () => {
    // Drawing it here too would put a second, non-draggable dot under every
    // active point, and the press would land on whichever Konva hit first.
    const m = buildCanvasMarkers(
      base({ allDatasetsData: [view(0, true, [9, 9, 9], sparse(3))], dataPoints: sparse(3), dataPointRoles: [null, null, null] })
    );
    expect(m.filter((x) => x.id.startsWith('inactive-point-'))).toHaveLength(0);
    expect(points(m)).toHaveLength(3);
  });

  it('render BEFORE the active series, so the active points layer on top', () => {
    const m = buildCanvasMarkers(
      base({ allDatasetsData: [view(1, false, [1, 2, 3], sparse(1))], dataPoints: sparse(1), dataPointRoles: [null] })
    );
    expect(m.map((x) => x.id)).toEqual(['inactive-point-1-0', 'point-0']);
  });
});

describe('data points - the draggable rules that shipped as defects', () => {
  const three = { dataPoints: sparse(3), dataPointRoles: [null, null, null] };

  it('are draggable in the ordinary editing modes', () => {
    for (const mode of ['place-point', 'select', 'calibrate', 'eraser']) {
      const m = points(buildCanvasMarkers(base({ ...three, mode })));
      expect(m.every((x) => x.draggable === true), mode).toBe(true);
    }
  });

  it('are inert in Pan and Measure - a measure click must pass THROUGH the marker', () => {
    // It used to let a measure click grab and move a data point.
    for (const mode of ['pan', 'measure']) {
      const m = points(buildCanvasMarkers(base({ ...three, mode })));
      expect(m.every((x) => x.draggable === false), mode).toBe(true);
    }
  });

  it('are inert in Error-bars for the TARGET series only', () => {
    // ⚑ v2.0.1: the press that recorded a cap also hauled the datum to wherever
    // the drag ended. But a blanket freeze made caps uncorrectable, and the
    // lower cap is MIRRORED by the app - so an uncorrectable cap exports a
    // symmetry the figure never showed.
    const target = points(
      buildCanvasMarkers(base({ ...three, mode: 'error-bars', activeDatasetIndex: 2, errorTargetIndex: 2 }))
    );
    expect(target.every((x) => x.draggable === false)).toBe(true);

    const capSeries = points(
      buildCanvasMarkers(base({ ...three, mode: 'error-bars', activeDatasetIndex: 3, errorTargetIndex: 2 }))
    );
    expect(capSeries.every((x) => x.draggable === true)).toBe(true);
  });

  it("⚑⚑ a CAP of the target series stays draggable - B4 put it in that series", () => {
    // The rule above scoped the inertness to the TARGET series so that a cap,
    // living in a series of its own, stayed correctable. B4 moves the cap ONTO
    // the datum's record, so it is a pixel of the target series - and the same
    // rule froze it. Measured on the built app: dragging the mirrored lower cap
    // did nothing at all, while three on-screen strings promised it would.
    //
    // ⚑ The DATUM is what must stay inert, and for its own stated reason: the
    // cap gesture BEGINS by pressing a datum, and Konva's built-in drag would
    // fire off the same press and haul the point along to the cap. That reason
    // has never applied to a cap, which is not where a link drag starts.
    //
    // ⚑ This is B3 ("caps ALWAYS editable") arriving without an exception to the
    // active-series guard, exactly as the taxonomy predicted: a cap is part of
    // the active series' point, so dragging it already IS editing the active
    // series.
    const withCaps = {
      dataPoints: [
        { px: 10, py: 10 }, // datum
        { px: 10, py: 4 }, // its upper cap
        { px: 10, py: 16 }, // its lower cap
      ],
      capRoles: [null, { role: 'upper', line: null }, { role: 'lower', line: null }] as (CapHandle | null)[],
    };
    const markers = points(
      buildCanvasMarkers(base({ ...withCaps, mode: 'error-bars', activeDatasetIndex: 0, errorTargetIndex: 0 }))
    );
    expect(markers[0]!.draggable, 'the datum the drag starts on').toBe(false);
    expect(markers[1]!.draggable, 'its upper cap').toBe(true);
    expect(markers[2]!.draggable, 'its lower cap').toBe(true);
  });

  it('⚑ a cap is not numbered like a data point', () => {
    // The label is the point's ordinal. A cap is part of a reading, not another
    // reading - numbering it says a one-point series has three points, the same
    // claim the series list was making before `datumCount`.
    const markers = points(
      buildCanvasMarkers(
        base({
          dataPoints: [
            { px: 10, py: 10 },
            { px: 10, py: 4 },
          ],
          capRoles: [null, { role: 'upper', line: null }],
        })
      )
    );
    expect(markers[0]!.label).toBe('1');
    expect(markers[1]!.label).toBe('');
  });

  it('leave the hit graph while they are the ring-closing target', () => {
    // ⚑ To close a pie ring you must click the first boundary - which has a
    // marker on it, and a draggable marker takes the press for its own drag, so
    // the click that closes the ring was the one click the figure ignored.
    const m = points(buildCanvasMarkers(base({ ...three, ringClosingIndex: 0 })));
    expect(m[0]!.draggable).toBe(false);
    expect(m[1]!.draggable).toBe(true);
  });

  it('say so on the figure while closing is on offer, and stop when it is not', () => {
    const closing = points(buildCanvasMarkers(base({ ...three, ringClosingIndex: 0 })));
    expect(closing[0]!.label).toBe('1 - click to close the ring');
    expect(closing[1]!.label).toBe('2');

    const notClosing = points(buildCanvasMarkers(base({ ...three })));
    expect(notClosing[0]!.label).toBe('1');
  });

  it('never let an interpolated sample be dragged - a drag is wiped on the next rebuild', () => {
    const m = points(
      buildCanvasMarkers(base({ dataPoints: sparse(2), dataPointRoles: ['anchor', 'interpolated'] }))
    );
    expect(m[0]!.draggable).toBe(true);
    expect(m[1]!.draggable).toBe(false);
  });
});

describe('data points - selection and size', () => {
  it('follow the marquee in Select and the single active point elsewhere', () => {
    const sel = points(
      buildCanvasMarkers(base({ dataPoints: sparse(3), dataPointRoles: [null, null, null], mode: 'select', selectedPointIndices: [0, 2], activePointIndex: 1 }))
    );
    expect(sel.map((m) => m.selected)).toEqual([true, false, true]);

    const place = points(
      buildCanvasMarkers(base({ dataPoints: sparse(3), dataPointRoles: [null, null, null], mode: 'place-point', selectedPointIndices: [0, 2], activePointIndex: 1 }))
    );
    expect(place.map((m) => m.selected)).toEqual([false, true, false]);
  });

  it('size anchors big, interpolated samples small, and leave an ordinary dot to the default', () => {
    const m = points(
      buildCanvasMarkers(base({ dataPoints: sparse(3), dataPointRoles: ['anchor', 'interpolated', null] }))
    );
    expect(m[0]!.radius).toBe(6.5);
    expect(m[1]!.radius).toBe(2.5);
    // ⚑ ABSENT, not undefined - ImageCanvas's own default of 5 applies.
    expect('radius' in m[2]!).toBe(false);
  });

  it('label an interpolated sample with nothing - the anchors are the record', () => {
    const m = points(buildCanvasMarkers(base({ dataPoints: sparse(2), dataPointRoles: ['anchor', 'interpolated'] })));
    expect(m[0]!.label).toBe('1');
    expect(m[1]!.label).toBe('');
  });
});

describe('a dense active series draws no dots except the selected one', () => {
  const pts = dense(40);
  const roles = pts.map(() => null);

  it('drops every plain dot', () => {
    const m = points(buildCanvasMarkers(base({ dataPoints: pts, dataPointRoles: roles })));
    expect(m).toHaveLength(0);
  });

  it('a plain point the line cannot reach keeps its dot', () => {
    // ⚑ Same rule as the inactive series': a plain point is drawn ONLY by the
    // line, and the line does not reach a fragment of one point. Without this
    // the stray is in the table, in the export and on nothing at all.
    const strayPts = denseWithStrays(40);
    const m = points(
      buildCanvasMarkers(base({ dataPoints: strayPts, dataPointRoles: strayPts.map(() => null) }))
    );
    expect(m.map((d) => [d.x, d.y])).toEqual([
      [440, 90],
      [840, 20],
    ]);
  });

  it('keeps the selected one visible and grabbable, at the small radius', () => {
    // You must still be able to pick a point off the curve (click a table row).
    const m = points(
      buildCanvasMarkers(base({ dataPoints: pts, dataPointRoles: roles, activePointIndex: 7 }))
    );
    expect(m).toHaveLength(1);
    expect(m[0]!.id).toBe('point-7');
    expect(m[0]!.radius).toBe(SELECTED_DOT_RADIUS);
    expect(m[0]!.draggable).toBe(true);
  });

  it('always draws anchors and interpolated samples - they are not the furry band', () => {
    const roles2 = pts.map((_, i) => (i === 3 ? 'anchor' : i === 4 ? 'interpolated' : null));
    const m = points(buildCanvasMarkers(base({ dataPoints: pts, dataPointRoles: roles2 })));
    expect(m.map((x) => x.id)).toEqual(['point-3', 'point-4']);
  });
});

describe('the active series colour', () => {
  it('comes from the active dataset, and falls back only when there is none', () => {
    const m = points(
      buildCanvasMarkers(base({ dataPoints: sparse(1), dataPointRoles: [null], datasetInfos: [info(0, true, [4, 5, 6])] }))
    );
    expect(m[0]!.color).toBe('rgb(4, 5, 6)');

    const none = points(
      buildCanvasMarkers(base({ dataPoints: sparse(1), dataPointRoles: [null], datasetInfos: [info(0, false, [4, 5, 6])] }))
    );
    expect(none[0]!.color).toBe('#fallback');
  });
});

describe('radialLabelCentre', () => {
  const pie = { getCentre: () => ({ x: 100, y: 200 }) };
  const spider = { getOrigin: () => ({ x: 5, y: 6 }) };

  it('leans pie labels away from the fitted centre and spider labels away from the origin', () => {
    expect(radialLabelCentre('pie', pie)).toEqual({ x: 100, y: 200 });
    expect(radialLabelCentre('spider', spider)).toEqual({ x: 5, y: 6 });
  });

  it('gives an XY plot no centre - the middle of the axes is not a place labels should flee', () => {
    expect(radialLabelCentre('xy', pie)).toBeUndefined();
    expect(radialLabelCentre('bar', spider)).toBeUndefined();
  });

  it('answers undefined rather than throwing when the axes cannot be asked', () => {
    expect(radialLabelCentre('pie', null)).toBeUndefined();
    // A radial kind whose axes object simply has no such method.
    expect(radialLabelCentre('pie', {})).toBeUndefined();
    expect(radialLabelCentre('spider', pie)).toBeUndefined();
  });

  it('is only carried onto markers where a centre exists', () => {
    const withCentre = buildCanvasMarkers(
      base({ dataPoints: sparse(1), dataPointRoles: [null], labelAway: { x: 1, y: 2 } })
    );
    expect(points(withCentre)[0]!.labelAway).toEqual({ x: 1, y: 2 });
    // ⚑ ABSENT, not undefined - "does not apply", the exactOptionalPropertyTypes rule.
    const without = points(buildCanvasMarkers(base({ dataPoints: sparse(1), dataPointRoles: [null] })));
    expect('labelAway' in without[0]!).toBe(false);
  });
});

describe('buildSeriesLines', () => {
  const fallbackColor = '#fallback';

  it('draws nothing for grouped types - a box plot gets glyphs, not a curve', () => {
    expect(
      buildSeriesLines({ hasSlots: true, allDatasetsData: [view(0, true, [1, 1, 1], dense(40))], dataPoints: dense(40), datasetInfos: [info(0, true, [1, 1, 1])], fallbackColor })
    ).toEqual([]);
  });

  it('draws nothing for a scatter - polylineRuns finds no runs', () => {
    expect(
      buildSeriesLines({ hasSlots: false, allDatasetsData: [], dataPoints: sparse(6), datasetInfos: [info(0, true, [1, 1, 1])], fallbackColor })
    ).toEqual([]);
  });

  it('puts inactive series first so the active line layers on top', () => {
    const lines = buildSeriesLines({
      hasSlots: false,
      allDatasetsData: [view(1, false, [1, 2, 3], dense(30)), view(0, true, [7, 8, 9], dense(30))],
      dataPoints: dense(30),
      datasetInfos: [info(0, true, [7, 8, 9]), info(1, false, [1, 2, 3])],
      fallbackColor,
    });
    expect(lines.map((l) => l.color)).toEqual(['rgb(1, 2, 3)', 'rgb(7, 8, 9)']);
  });

  it('gives a sparse INACTIVE series no line - it stays dots', () => {
    const lines = buildSeriesLines({
      hasSlots: false,
      allDatasetsData: [view(1, false, [1, 2, 3], sparse(6))],
      dataPoints: [],
      datasetInfos: [info(0, true, [7, 8, 9])],
      fallbackColor,
    });
    expect(lines).toEqual([]);
  });

  it('falls back on colour when no dataset is marked active', () => {
    const lines = buildSeriesLines({
      hasSlots: false,
      allDatasetsData: [],
      dataPoints: dense(30),
      datasetInfos: [info(0, false, [7, 8, 9])],
      fallbackColor,
    });
    expect(lines[0]!.color).toBe(fallbackColor);
  });

  it('breaks a run at a genuine discontinuity rather than bridging it', () => {
    const gapped = [...dense(20), ...Array.from({ length: 20 }, (_, i) => ({ px: 300 + i, py: 50 }))];
    const lines = buildSeriesLines({
      hasSlots: false,
      allDatasetsData: [],
      dataPoints: gapped,
      datasetInfos: [info(0, true, [1, 1, 1])],
      fallbackColor,
    });
    expect(lines[0]!.runs).toHaveLength(2);
  });
});

describe('runsForPoints', () => {
  it('adapts {px,py} to the {x,y} the geometry works in, without moving anything', () => {
    const runs = runsForPoints(dense(4));
    expect(runs[0]![0]).toEqual({ x: 0, y: 50 });
    expect(runs[0]).toHaveLength(4);
  });

  it('answers "no runs" for a scatter, which is what keeps it dots', () => {
    expect(runsForPoints(sparse(5))).toEqual([]);
  });
});

describe('⚑⚑ a committed calibration stops LABELLING the figure it calibrated', () => {
  /**
   * David, 2026-08-23, unable to photograph the heatmap feature: the anchors and
   * their labels are drawn unconditionally for the rest of the session, and on a
   * heatmap they sit INSIDE the plot - six labels and a dozen handles over the
   * very cells you are now reading.
   *
   * ⚑ THE FIX IS THE LABELS, NOT A TOGGLE. Asked which he wanted, David chose the
   * defect-only fix: once a stage has committed, its labels come off and the
   * handles stay. A visibility toggle is new capability and a mode to learn, and
   * the handles are what you would still want to grab.
   *
   * ⚑ AND THEY COME BACK IN CALIBRATE MODE, which is the mode that can move them.
   * A handle is draggable only there, so that is exactly where you need to know
   * which one you are about to nudge - and it is a mode already on screen with a
   * button of its own, not a hidden state.
   */
  const steps = [step('x1', 'X1'), step('y1', 'Y1')];
  const placed = {
    x1: { px: 5, py: 6, values: ['0'] },
    y1: { px: 7, py: 8, values: ['10'] },
  };
  const labelsOf = (input: Partial<CanvasMarkerInput>) =>
    buildCanvasMarkers(base({ steps, placedPoints: placed, ...input }))
      .filter((m) => m.kind === 'calibration')
      .map((m) => m.label);

  it('labels every handle DURING the walk, when the label is the instruction', () => {
    expect(labelsOf({ isCalibrated: false, mode: 'calibrate' })).toEqual(['X1=0', 'Y1=10']);
  });

  it('⚑⚑ and none of them once the axes are built', () => {
    expect(labelsOf({ isCalibrated: true, mode: 'place-point' })).toEqual(['', '']);
  });

  it('⚑ the handles themselves stay, so nothing becomes unreachable', () => {
    const markers = buildCanvasMarkers(base({ steps, placedPoints: placed }));
    expect(markers.filter((m) => m.kind === 'calibration').map((m) => m.id)).toEqual(['x1', 'y1']);
  });

  it('⚑⚑ and they read again in Calibrate mode, which is the mode that can move them', () => {
    expect(labelsOf({ isCalibrated: true, mode: 'calibrate' })).toEqual(['X1=0', 'Y1=10']);
  });
});

describe('⚑ two anchors on ONE pixel print ONE label, not two on top of each other', () => {
  /**
   * A heatmap's `x1` and `y1` ARE the same click - the shared corner - so both
   * labels were drawn at one point and overlapped illegibly: `C1 x R1(0)=0`
   * rendered as overlapping glyphs. Every shared-corner type has this.
   *
   * ⚑ JOINED, NOT DROPPED. Both anchors are really there and both say something
   * about that pixel; hiding one would make a real reading invisible rather than
   * unreadable, which is worse.
   */
  const shared = { px: 40, py: 40, values: ['0'] };

  it('⚑⚑ joins them onto the first, and leaves the second blank', () => {
    const markers = buildCanvasMarkers(
      base({
        isCalibrated: false,
        mode: 'calibrate',
        steps: [step('x1', 'C1'), step('y1', 'R1')],
        placedPoints: { x1: shared, y1: { ...shared } },
      })
    );
    expect(markers.map((m) => m.label)).toEqual(['C1=0 · R1=0', '']);
  });

  it('⚑ anchors on DIFFERENT pixels are untouched', () => {
    const markers = buildCanvasMarkers(
      base({
        isCalibrated: false,
        mode: 'calibrate',
        steps: [step('x1', 'C1'), step('y1', 'R1')],
        placedPoints: { x1: shared, y1: { px: 200, py: 90, values: ['5'] } },
      })
    );
    expect(markers.map((m) => m.label)).toEqual(['C1=0', 'R1=5']);
  });

  it('⚑ three on one pixel still print once', () => {
    const markers = buildCanvasMarkers(
      base({
        isCalibrated: false,
        mode: 'calibrate',
        steps: [step('x1', 'C1'), step('y1', 'R1'), step('z1', 'K1')],
        placedPoints: { x1: shared, y1: { ...shared }, z1: { ...shared } },
      })
    );
    expect(markers.map((m) => m.label)).toEqual(['C1=0 · R1=0 · K1=0', '', '']);
  });
});
