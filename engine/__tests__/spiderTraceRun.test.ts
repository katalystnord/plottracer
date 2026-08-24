import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runSpiderTrace, spiderBoxRegion } from '../spiderTraceRun.js';
import { readPng } from './helpers/readPng.js';
import {
  CalibrationSession,
  SPIDER_AXES_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  BAR_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  XY_AXES_CONFIG,
} from '../calibrationSession.js';
import { SpiderAxes as SpiderAxesClass } from '../../core/axes/spider.js';
import { Calibration } from '../../core/calibration.js';
import type { SpiderAxes } from '../../core/axes/spider.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * The axis-aware colour trace, orchestrated (v1.4) - and its landing in the record.
 *
 * ⚑ Well-founded where the bar case was not. Auto-extract is refused on bars because
 * every mechanism it has returns the MIDDLE of a filled shape, and a bar's value is
 * its end: the number was never the datum. On a radar chart the datum IS where the
 * series crosses the axis, and a crossing is exactly what this measures. What still
 * has to hold is the refusal - an ambiguous ray must reach the record as an empty
 * slot the user is then asked for, never as the outermost run silently chosen.
 */

const W = 220;
const H = 220;
const CX = 110;
const CY = 110;
const R = 80;
const WHITE: [number, number, number] = [255, 255, 255];
const RED: [number, number, number] = [220, 30, 30];

/** `n` spokes of `radius`px, clockwise from 12 o'clock, about (CX, CY). */
function spokePixel(i: number, n: number, radius = R): [number, number] {
  const angle = (2 * Math.PI * i) / n;
  return [CX + radius * Math.sin(angle), CY - radius * Math.cos(angle)];
}

function blankImage(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = WHITE[0];
    data[i + 1] = WHITE[1];
    data[i + 2] = WHITE[2];
    data[i + 3] = 255;
  }
  return data;
}

/** Draw a ring of `rgb` at `radius` - a closed radar polygon, as far as a ray
 * walking outward can tell, crossing every spoke at the same distance. */
function drawRing(data: Uint8ClampedArray, radius: number, rgb: [number, number, number], thickness = 4): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.abs(Math.hypot(x - CX, y - CY) - radius) > thickness / 2) continue;
      const i = (y * W + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
}

function calibratedSpider(names: string[], values: string[]): CalibrationSession<SpiderAxes> {
  const session = new CalibrationSession(SPIDER_AXES_CONFIG);
  while (session.getRepeatCount() < names.length) session.addRepeat();
  session.handleCalibrationClick(CX, CY);
  session.confirmCalibrationValues(['0']);
  for (let i = 0; i < names.length; i++) {
    session.handleCalibrationClick(...spokePixel(i, names.length));
    session.confirmCalibrationValues([values[i]!, names[i]!]);
  }
  expect(session.runCalibration()).toBe(true);
  return session;
}

const THREE = () => calibratedSpider(['Strength', 'Weight', 'Cost'], ['100', '100', '100']);

/** A drawn line has WIDTH, and the reading is its outer edge, so an expectation is
 * "within a few percent of THAT axis's range" - never an exact number. Stated per
 * axis on purpose: a tolerance in absolute units would be meaningless on a figure
 * whose axes run to 5 and to 1000.
 *
 * ⚠️ THIS FILE CANNOT SEE THE REAL BIAS, and the tolerance below should not be
 * read as evidence that it is small. `drawSeries` strokes lines between vertices
 * and draws NO MARKERS, while the bundled PNG this stands for draws a marker at
 * every vertex - and the marker, not the stroke, is what the outer-edge reading
 * lands on (see SpokeRun.atPx). Measured through the real figure the over-read is
 * ~4.8px, about one marker radius; measured here it is ~1px, half a stroke. The
 * fixture is an easier figure than the example it represents. */
function expectValue(actual: number | null | undefined, expected: number, range: number, fraction = 0.05): void {
  expect(actual == null).toBe(false);
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(range * fraction);
}
const axesOf = (session: CalibrationSession<SpiderAxes>) => session.getAxes() as unknown as SpiderAxes;

describe('runSpiderTrace', () => {
  it('reads one value per axis, on that axis own scale, named as the figure named it', () => {
    const session = THREE();
    const img = blankImage();
    drawRing(img, R / 2, RED); // half way out on every 100-valued axis

    const result = runSpiderTrace(img, W, H, axesOf(session), RED, 40);
    if ('error' in result) throw new Error(result.error);

    expect(result.readings.map((r) => r.name)).toEqual(['Strength', 'Weight', 'Cost']);
    for (const reading of result.readings) {
      expect(reading.reason).toBeNull();
      expect(reading.point).not.toBeNull();
      expectValue(reading.value, 50, 100);
    }
  });

  it('carries each axis own scale, not one shared range', () => {
    // ⚑ The assumption the only prior art (ChartSense, CHI 2017) makes and this
    // model does not: one ring at one radius reads as a DIFFERENT number on each
    // axis, because each ray carries its own known value.
    const session = calibratedSpider(['A', 'B', 'C'], ['10', '100', '1000']);
    const img = blankImage();
    drawRing(img, R / 2, RED);

    const result = runSpiderTrace(img, W, H, axesOf(session), RED, 40);
    if ('error' in result) throw new Error(result.error);
    [5, 50, 500].forEach((expected, i) => expectValue(result.readings[i]!.value, expected, expected * 2));
  });

  it('refuses the ray a grid ring also crosses, and says which', () => {
    const session = THREE();
    const img = blankImage();
    drawRing(img, R / 2, RED);
    // A second ring in the SAME ink, crossing only the first spoke: a partial arc.
    for (let y = 0; y < CY; y++) {
      for (let x = CX - 3; x <= CX + 3; x++) {
        if (Math.abs(Math.hypot(x - CX, y - CY) - R * 0.8) > 2) continue;
        const i = (y * W + x) * 4;
        img[i] = RED[0];
        img[i + 1] = RED[1];
        img[i + 2] = RED[2];
      }
    }

    const result = runSpiderTrace(img, W, H, axesOf(session), RED, 40);
    if ('error' in result) throw new Error(result.error);
    expect(result.readings[0]!.reason).toBe('ambiguous');
    expect(result.readings[0]!.point).toBeNull();
    expect(result.readings[0]!.value).toBeNull();
    expect(result.readings[0]!.runs).toHaveLength(2); // the evidence rides along
    // The other two axes are unaffected - a doubtful ray poisons only itself.
    expect(result.readings[1]!.reason).toBeNull();
    expect(result.readings[2]!.reason).toBeNull();
  });

  it('errors clearly when the colour matches (almost) nothing', () => {
    const session = THREE();
    const result = runSpiderTrace(blankImage(), W, H, axesOf(session), RED, 10);
    expect('error' in result && result.error).toMatch(/No pixels matched/);
  });

  it('refuses to run at all before the axes are calibrated', () => {
    // The rays ARE the search. Without them there is nothing to walk, and a generic
    // trace here would return a curve nobody asked for.
    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    const img = blankImage();
    drawRing(img, R / 2, RED);
    const result = runSpiderTrace(img, W, H, session.getAxes() as unknown as SpiderAxes, RED, 40);
    expect('error' in result && result.error).toMatch(/Calibrate the axes first/);
  });
});

describe('spiderBoxRegion', () => {
  it('boxes the web, so same-ink axis labels outside it are not searched', () => {
    const region = spiderBoxRegion(axesOf(THREE()))!;
    expect(region).not.toBeNull();
    // Encloses the centre and every spoke tip, with the overshoot the tracer looks
    // through -- and not much more. (A three-spoke chart reaches further up than
    // sideways, so the box is not a square around the circumcircle.)
    for (const [x, y] of [[CX, CY], ...[0, 1, 2].map((i) => spokePixel(i, 3))] as [number, number][]) {
      expect(x).toBeGreaterThanOrEqual(region.x);
      expect(x).toBeLessThanOrEqual(region.x + region.width);
      expect(y).toBeGreaterThanOrEqual(region.y);
      expect(y).toBeLessThanOrEqual(region.y + region.height);
    }
    expect(region.width).toBeLessThan(2 * R * 1.4);
    expect(region.height).toBeLessThan(2 * R * 1.4);
  });

  it('is null before calibration, rather than a box around nothing', () => {
    expect(spiderBoxRegion(new CalibrationSession(SPIDER_AXES_CONFIG).getAxes() as unknown as SpiderAxes)).toBeNull();
  });
});

describe('addSpiderTracePoints', () => {
  const readingsFor = (session: CalibrationSession<SpiderAxes>, img: Uint8ClampedArray) => {
    const result = runSpiderTrace(img, W, H, axesOf(session), RED, 40);
    if ('error' in result) throw new Error(result.error);
    return result.readings.map((r) => r.point);
  };

  it('files each reading into ITS OWN axis slot', () => {
    const session = calibratedSpider(['A', 'B', 'C'], ['10', '100', '1000']);
    const img = blankImage();
    drawRing(img, R / 2, RED);

    expect(session.addSpiderTracePoints(readingsFor(session, img))).toBe(3);
    const values = session.getSpiderTable().columns[0]!.values;
    [5, 50, 500].forEach((expected, i) => expectValue(values[i], expected, expected * 2));
  });

  it('leaves a refused axis EMPTY, and asks for it next', () => {
    // ⚑ The refusal has to survive all the way into the record. A skipped slot is
    // not a gap in the data - it is the worklist: the capture cursor lands on it, so
    // the user is asked for exactly the axis the trace could not read.
    const session = THREE();
    const img = blankImage();
    drawRing(img, R / 2, RED);
    const readings = readingsFor(session, img);
    readings[1] = null; // as an ambiguous ray arrives

    expect(session.addSpiderTracePoints(readings)).toBe(2);
    const table = session.getSpiderTable();
    expect(table.columns[0]!.values[1]).toBeNull();
    expect(session.getCurrentSlotIndex()).toBe(1);
    expect(session.getCurrentTupleIndex()).toBe(0);
  });

  it('files a reading for axis 2 against axis 2, even when it is the first one placed', () => {
    // ⚑ The trap in the shortest implementation: the dataset primitive that CREATES
    // a tuple puts its pixel in slot 0. A trace whose first offered reading is for
    // axis 2 (because axis 0 was ambiguous) would then have the right number filed
    // against the wrong axis - worse than the empty slot it should have left.
    const session = calibratedSpider(['A', 'B', 'C'], ['10', '100', '1000']);
    const img = blankImage();
    drawRing(img, R / 2, RED);
    const readings = readingsFor(session, img);

    expect(session.addSpiderTracePoints([null, null, readings[2]!])).toBe(1);
    const values = session.getSpiderTable().columns[0]!.values;
    expect(values[0]).toBeNull();
    expect(values[1]).toBeNull();
    expectValue(values[2], 500, 1000);
  });

  it('never overwrites a reading the user placed by hand', () => {
    // A trace ASSISTS. Running it after fixing one axis by eye must not silently
    // undo that fix - so it fills the open slots and leaves the rest alone.
    const session = THREE();
    session.addDataPoint(...spokePixel(0, 3, R * 0.9)); // 90 on Strength, placed by hand
    const img = blankImage();
    drawRing(img, R / 2, RED);

    expect(session.addSpiderTracePoints(readingsFor(session, img))).toBe(2);
    const values = session.getSpiderTable().columns[0]!.values;
    expectValue(values[0], 90, 100);
    expectValue(values[1], 50, 100);
    expect(session.getDataPoints()).toHaveLength(3);
  });

  it('starts a new profile once the current one is full', () => {
    const session = THREE();
    const img = blankImage();
    drawRing(img, R / 2, RED);
    session.addSpiderTracePoints(readingsFor(session, img));

    const second = blankImage();
    drawRing(second, R * 0.75, RED);
    expect(session.addSpiderTracePoints(readingsFor(session, second))).toBe(3);
    const columns = session.getSpiderTable().columns;
    expect(columns).toHaveLength(2);
    expectValue(columns[1]!.values[0], 75, 100);
  });

  it('does nothing on a graph type whose slots are not axes', () => {
    // Same shape of gate as addSegmentFillPoints' slot check, and for the
    // stronger reason: a Box Plot's Min/Q1/Median slots are not rays, so there is no
    // sense in which a ray-walk produced them.
    const session = new CalibrationSession(SPIDER_AXES_CONFIG);
    expect(session.addSpiderTracePoints([{ x: 1, y: 1 }])).toBe(0);
  });
});

/**
 * The bundled example's ground truth, traced end to end.
 *
 * ⚑ Why this is worth its length. Every other test here draws a RING, which crosses
 * each ray head-on at a distance chosen by the test. A real radar series is a
 * POLYGON: each edge runs between two adjacent vertices, so the ray meets the ink at
 * a corner, and the corner is the datum. The figure this uses is the one shipped in
 * samples/, with six axes of six DIFFERENT ranges (120, 60, 25, 100, 80, 5) - so a
 * reading that came off a shared scale, or off the wrong spoke, cannot pass by
 * looking plausible.
 *
 * The pixels are drawn here rather than decoded from the PNG (no decoder in the
 * dependency set), but the geometry is not invented: the vertices come from the
 * committed truth values through SpiderAxes.dataToPixel, and the trace has to walk
 * back from ink to number without being told any of it.
 */

const truth = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../samples/spider-material-profile.truth.json', import.meta.url)), 'utf8')
) as {
  axes: { axis: number; name: string; centre: number; max: number }[];
  calibration: {
    imageWidth: number;
    imageHeight: number;
    anchors: Record<string, { px: number; py: number; value: number; name?: string }>;
  };
  series: { name: string; points: { axis: number; name: string; value: number }[] }[];
};

function axesFromTruth(): SpiderAxes {
  const cal = new Calibration(3);
  const origin = truth.calibration.anchors['origin']!;
  cal.addPoint(origin.px, origin.py, '0', '0', '');
  for (const axis of truth.axes) {
    const anchor = truth.calibration.anchors[`spoke${axis.axis}`]!;
    cal.addPoint(anchor.px, anchor.py, String(axis.max), String(axis.centre), axis.name);
  }
  const axes = new SpiderAxesClass();
  expect(axes.calibrate(cal, false)).toBe(true);
  return axes as unknown as SpiderAxes;
}

describe('the bundled example, traced end to end', () => {
  const TW = truth.calibration.imageWidth;
  const TH = truth.calibration.imageHeight;

  function whiteImage(): Uint8ClampedArray {
    const data = new Uint8ClampedArray(TW * TH * 4);
    data.fill(255);
    return data;
  }

  /** A 3px-wide stroke from a to b - a drawn plot line, not a mathematical one. */
  function stroke(
    data: Uint8ClampedArray,
    a: { x: number; y: number },
    b: { x: number; y: number },
    rgb: [number, number, number]
  ): void {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.round(a.x + (b.x - a.x) * t);
      const cy = Math.round(a.y + (b.y - a.y) * t);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= TW || y >= TH) continue;
          const i = (y * TW + x) * 4;
          data[i] = rgb[0];
          data[i + 1] = rgb[1];
          data[i + 2] = rgb[2];
        }
      }
    }
  }

  /** A filled disc, standing for the marker a radar chart draws at each vertex. */
  function marker(data: Uint8ClampedArray, c: { x: number; y: number }, rgb: [number, number, number]): void {
    const r = 4.5; // matplotlib markersize 7 at dpi 100 is a 4.86px radius
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (Math.hypot(dx, dy) > r) continue;
        const x = Math.round(c.x) + dx;
        const y = Math.round(c.y) + dy;
        if (x < 0 || y < 0 || x >= TW || y >= TH) continue;
        const i = (y * TW + x) * 4;
        data[i] = rgb[0];
        data[i + 1] = rgb[1];
        data[i + 2] = rgb[2];
      }
    }
  }

  /** Draw one series as a closed polygon through its own truth values, WITH the
   * marker each vertex carries.
   *
   * ⚑ The markers were missing here, and their absence is what let this test
   * credit the real figure's ~4.8px over-read to a ~1px stroke bias for three
   * releases: the synthetic figure could not exhibit the defect it was supposed to
   * be watching. It draws the same KIND of figure as the bundled PNG now - but the
   * accuracy claim belongs to the PNG test below, which reads the shipped ink. */
  function drawSeries(data: Uint8ClampedArray, axes: SpiderAxes, values: number[], rgb: [number, number, number]) {
    const vertices = values.map((v, i) => axes.dataToPixel(i, v));
    for (let i = 0; i < vertices.length; i++) {
      stroke(data, vertices[i]!, vertices[(i + 1) % vertices.length]!, rgb);
    }
    for (const v of vertices) marker(data, v, rgb);
  }

  const COLOURS: [number, number, number][] = [
    [200, 40, 40],
    [40, 120, 200],
    [30, 150, 70],
  ];

  it('recovers every published value, on six axes of six different ranges', () => {
    const axes = axesFromTruth();
    const img = whiteImage();
    // All three series drawn, as the figure has them - the trace must separate them
    // by colour, not by being the only ink on the page.
    truth.series.forEach((series, s) => drawSeries(img, axes, series.points.map((p) => p.value), COLOURS[s]!));

    truth.series.forEach((series, s) => {
      const result = runSpiderTrace(img, TW, TH, axes, COLOURS[s]!, 60);
      if ('error' in result) throw new Error(`${series.name}: ${result.error}`);
      result.readings.forEach((reading, i) => {
        const expected = series.points[i]!.value;
        const range = truth.axes[i]!.max - truth.axes[i]!.centre;
        expect(reading.reason, `${series.name} / ${truth.axes[i]!.name}`).toBeNull();
        // Within 2% of that axis's OWN range. The reading is the outer edge of the
        // ink, so it sits out by half a stroke HERE - and by a whole marker radius
        // on the real figure, which this synthetic one does not draw (see the note
        // on expectValue above). Bounded and the same on every axis either way. A reading taken off a NEIGHBOURING axis, off a shared scale,
        // or from the middle of the ink misses by far more than this on a figure
        // whose ranges run from 5 to 120.
        expect(
          Math.abs(reading.value! - expected),
          `${series.name} / ${truth.axes[i]!.name}: read ${reading.value}, published ${expected}`
        ).toBeLessThan(range * 0.02);
      });
    });
  });

  it('reads the axis that runs to 5 as 3.4, not as a fraction of 120', () => {
    // ⚑ The single number that catches a shared-scale reading. Cost index runs 0–5
    // while Tensile strength runs 0–120; a trace that read every ray against one
    // range would put Cost's 3.4 out at 82 and look entirely confident about it.
    const axes = axesFromTruth();
    const img = whiteImage();
    drawSeries(img, axes, truth.series[0]!.points.map((p) => p.value), COLOURS[0]!);
    const result = runSpiderTrace(img, TW, TH, axes, COLOURS[0]!, 60);
    if ('error' in result) throw new Error(result.error);
    expect(Math.abs(result.readings[5]!.value! - 3.4)).toBeLessThan(0.1); // range 5
    expect(Math.abs(result.readings[0]!.value! - 92)).toBeLessThan(2.4); // range 120
  });
});

describe('a spider export carries every series, read against its own spoke', () => {
  it('exports each reading with the axis it was CAPTURED on', () => {
    // ⚑ The release audit's finding. Grouped types routed to `getTupleRows`, which
    // is ACTIVE-SERIES-ONLY and reads values through `pixelToData` - the NEAREST
    // ray. So the screen showed three series and the file carried one, and the one
    // it carried was read off whichever ray each point happened to sit closest to,
    // not the axis it was recorded against. On a spider those coincide for a clean
    // click and diverge exactly where it matters.
    const session = THREE();
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, R / 2)); // half way out = 50
    session.addDataset();
    session.setActiveDataset(1);
    for (let i = 0; i < 3; i++) session.addDataPoint(...spokePixel(i, 3, R / 4)); // a quarter = 25

    // Series 0 keeps its own readings, each labelled with its own axis.
    const first = session.getExportRows(0);
    expect(first).toHaveLength(3);
    expect(first.map((r) => r.values[0])).toEqual([1, 2, 3]);
    expect(first.map((r) => r.values[1])).toEqual(['Strength', 'Weight', 'Cost']);
    first.forEach((r) => expect(Math.round(r.values[2] as number)).toBe(50));

    // ...and the SECOND series is a separate, complete set - not absent.
    const second = session.getExportRows(1);
    expect(second).toHaveLength(3);
    second.forEach((r) => expect(Math.round(r.values[2] as number)).toBe(25));
  });
});

describe('a graph type declares the SHAPE its data takes in a file', () => {
  it('answers flat for a spider, whose slots are independent readings', () => {
    // ⚑ The v1.4 audit's export defect, now impossible to reintroduce by adding a
    // branch to a cascade: a spider is grouped, but its export is one row per
    // reading, carrying the axis it was captured on, across every series. The
    // tuple table would give one series read off the nearest ray.
    expect(THREE().getExportShape()).toBe('flat');
  });

  it('answers tuples for a Box Plot - including one reached as a Bar toggle, and for plain Bar\'s own interval record (v2.0)', () => {
    // ⚑ Why this cannot be a static config field alone. Box Plot is two doors: its
    // own graph type, and a toggle that gives a BAR session Min/Q1/Median/Q3/Max.
    // The second has a config that says nothing about tuples.
    expect(new CalibrationSession(BOX_PLOT_AXES_CONFIG).getExportShape()).toBe('tuples');

    const bar = new CalibrationSession(BAR_AXES_CONFIG);
    bar.handleCalibrationClick(100, 200);
    bar.confirmCalibrationValues(['0']);
    bar.handleCalibrationClick(100, 100);
    bar.confirmCalibrationValues(['10']);
    walkCategoryAxis(bar);
    expect(bar.runCalibration()).toBe(true);
    // v2.0: a plain bar is ALREADY tuple-shaped (its own 2-slot interval
    // record, BAR_INTERVAL_SLOTS) -- not the 'flat' shape a pre-v2.0 bar
    // session had before Box Plot Groups was applied.
    expect(bar.getExportShape()).toBe('tuples');
    expect(bar.getSlotNames()).toEqual(['Min', 'Max']);
    expect(bar.applyBoxPlotGroups()).toBe(true);
    expect(bar.getExportShape()).toBe('tuples'); // ...the same session, toggled to the 5-slot shape
    expect(bar.getSlotNames()).toEqual(['Min', 'Q1', 'Median', 'Q3', 'Max']);
  });

  it('answers bins for the type that has its own table', () => {
    expect(new CalibrationSession(HISTOGRAM_AXES_CONFIG).getExportShape()).toBe('bins');
  });

  it('answers flat for an ordinary XY series', () => {
    expect(new CalibrationSession(XY_AXES_CONFIG).getExportShape()).toBe('flat');
  });
});

/**
 * ⚑⚑ THE SHIPPED PNG, not a figure this test drew.
 *
 * The block above strokes lines between vertices and draws NO MARKERS, so it can
 * only ever exhibit a half-stroke bias - while the real figure draws a marker at
 * every vertex, and the vertex is exactly where the crossing is measured. Its 2%
 * tolerance was wide enough to absorb the real error while crediting it to the
 * wrong cause: a test that invents its own geometry proves self-consistency, not
 * truth. This traces `samples/spider-material-profile.png` itself, against the
 * `.truth.json` committed beside it.
 */
describe('the bundled example PNG, traced as it ships', () => {
  // From the generator: line-only polygons, three distinct colours, a marker at
  // every vertex (samples/generators/gen_samples.py).
  const SERIES_INK: [number, number, number][] = [
    [0x1f, 0x4e, 0x79],
    [0xc1, 0x55, 0x3b],
    [0x3a, 0x9d, 0x5d],
  ];

  function tracedErrors(): { name: string; axis: string; read: number; published: number; px: number }[] {
    const png = readPng(fileURLToPath(new URL('../../samples/spider-material-profile.png', import.meta.url)));
    const axes = axesFromTruth();
    const out: { name: string; axis: string; read: number; published: number; px: number }[] = [];
    truth.series.forEach((series, s) => {
      const result = runSpiderTrace(png.data, png.width, png.height, axes, SERIES_INK[s]!, 60);
      if ('error' in result) throw new Error(`${series.name}: ${result.error}`);
      result.readings.forEach((reading, i) => {
        expect(reading.reason, `${series.name} / ${truth.axes[i]!.name}`).toBeNull();
        const published = series.points[i]!.value;
        const range = truth.axes[i]!.max - truth.axes[i]!.centre;
        // The error in PIXELS, which is what makes the diagnosis: a geometry bias
        // is constant in pixels across axes of different ranges, while a
        // calibration error is proportional to the reading.
        const radiusPx = Math.hypot(
          truth.calibration.anchors[`spoke${i + 1}`]!.px - truth.calibration.anchors['origin']!.px,
          truth.calibration.anchors[`spoke${i + 1}`]!.py - truth.calibration.anchors['origin']!.py
        );
        out.push({
          name: series.name,
          axis: truth.axes[i]!.name,
          read: reading.value!,
          published,
          px: ((reading.value! - published) / range) * radiusPx,
        });
      });
    });
    return out;
  }

  it('reads every published value off the real ink, on six axes of six ranges', () => {
    // ⚑ Every reading is reported, not just the first to fail: a systematic bias
    // and one awkward vertex look identical when a loop stops at the first miss.
    const rows = tracedErrors().map((e) => {
      const range = truth.axes.find((a) => a.name === e.axis)!;
      const fraction = Math.abs(e.read - e.published) / (range.max - range.centre);
      return { ...e, fraction };
    });
    const table = rows
      .map((r) => `${r.name} / ${r.axis}: read ${r.read.toFixed(2)} vs ${r.published} (${(100 * r.fraction).toFixed(2)}%, ${r.px.toFixed(2)}px)`)
      .join('\n');
    const worst = Math.max(...rows.map((r) => r.fraction));
    // 1.5% of each axis's own range. ⚑ The bound is set by ONE reading - Cellulose
    // film's tensile strength, a spike at 110 of 120 whose neighbours are 9 and
    // 4.3. At a vertex that sharp the polygon's two edges hug the ray, so the ink
    // reaches further back towards the centre than the marker does and drags the
    // middle inward. That is the residual the old comment predicted, and it is now
    // BOUNDED and visible rather than hidden inside a uniform over-read: the other
    // seventeen readings are all inside 0.7%, and thirteen inside 0.35%.
    expect(worst, table).toBeLessThan(0.015);
  });

  it('carries no systematic outward bias - the marker radius is not a reading', () => {
    // ⚑ The DIAGNOSTIC assertion, and the one that failed before the fix. A
    // vertex marker is ~4.9px in radius; reading a run's outer end put every
    // value that far out, uniformly, on every axis at once. The mean signed
    // error in pixels is what sees it - individual errors can cancel in a
    // percentage, a constant bias cannot hide in a mean.
    const errors = tracedErrors();
    const meanPx = errors.reduce((s, e) => s + e.px, 0) / errors.length;
    expect(Math.abs(meanPx), `mean signed error ${meanPx.toFixed(2)} px across ${errors.length} readings`).toBeLessThan(1.5);
  });
});
