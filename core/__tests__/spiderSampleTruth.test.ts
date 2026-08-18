import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SpiderAxes } from '../axes/spider.js';
import { Calibration } from '../calibration.js';

/**
 * The bundled spider example's ground truth (v1.4).
 *
 * ⚑ What is actually at risk here is the PIXEL CONVENTION. The generator works in
 * matplotlib's display space (origin bottom-left, y UP) and y-flips into the image
 * space the app calibrates in (origin top-left, y DOWN). Get that flip wrong and
 * the truth file still looks entirely reasonable - every number is right, the
 * anchors are all inside the image - but the chart calibrates MIRRORED, and every
 * extracted value comes off the wrong spoke. Nothing else in the suite would catch
 * it, because no other test reads this file.
 *
 * So this checks the geometry the figure was drawn with: six spokes, equal angles,
 * clockwise from 12 o'clock, all the same pixel length.
 */

const truth = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../samples/spider-material-profile.truth.json', import.meta.url)), 'utf8')
) as {
  graphType: string;
  axes: { axis: number; name: string; centre: number; max: number }[];
  calibration: {
    imageWidth: number;
    imageHeight: number;
    anchors: Record<string, { px: number; py: number; value: number; name?: string }>;
  };
  series: { name: string; points: { axis: number; name: string; value: number }[] }[];
};

/** Build the axes the app would build from the truth's own calibration anchors. */
function axesFromTruth(): SpiderAxes {
  const cal = new Calibration(3);
  const origin = truth.calibration.anchors['origin']!;
  cal.addPoint(origin.px, origin.py, '0', '0', '');
  for (const axis of truth.axes) {
    const anchor = truth.calibration.anchors[`spoke${axis.axis}`]!;
    cal.addPoint(anchor.px, anchor.py, String(axis.max), String(axis.centre), axis.name);
  }
  const axes = new SpiderAxes();
  expect(axes.calibrate(cal, false)).toBe(true);
  return axes;
}

describe('the bundled spider example ships a calibration the app can use', () => {
  it('declares six axes, three series, and a value on every axis', () => {
    expect(truth.graphType).toBe('spider');
    expect(truth.axes).toHaveLength(6);
    expect(truth.series).toHaveLength(3);
    for (const s of truth.series) expect(s.points).toHaveLength(6);
  });

  it('gives each axis its OWN range - the case the figure exists to exercise', () => {
    // A figure whose axes shared one scale would not test anything the field's
    // only prior art (ChartSense) cannot already do.
    const maxima = truth.axes.map((a) => a.max);
    expect(new Set(maxima).size).toBeGreaterThan(1);
    expect(Math.max(...maxima) / Math.min(...maxima)).toBeGreaterThan(10);
  });

  it('shares a single centre value across every axis', () => {
    expect(new Set(truth.axes.map((a) => a.centre))).toEqual(new Set([0]));
  });

  it('⚑ is not Y-FLIPPED - axis 1 is ABOVE the centre in image pixels', () => {
    // The whole reason this file has a test. Image space runs y DOWNWARD, so the
    // 12-o'clock spoke must have a SMALLER py than the origin. A flipped export
    // would put it below and calibrate a mirrored chart that still reads plausibly.
    const origin = truth.calibration.anchors['origin']!;
    const first = truth.calibration.anchors['spoke1']!;
    expect(first.py).toBeLessThan(origin.py);
    expect(first.px).toBeCloseTo(origin.px, 0);
  });

  it('runs CLOCKWISE from 12 o\'clock, at equal angles and equal pixel length', () => {
    const axes = axesFromTruth();
    const spokes = axes.getSpokes();
    expect(spokes).toHaveLength(6);

    // Equal length: every ray is drawn to the same radius, only the SCALES differ.
    const lengths = spokes.map((s) => s.lengthPx);
    for (const len of lengths) expect(len).toBeCloseTo(lengths[0]!, 1);

    // Clockwise from straight up, 60 degrees apart. atan2 of (ux, -uy) gives the
    // bearing from 12 o'clock, increasing clockwise.
    const bearings = spokes.map((s) => {
      const deg = (Math.atan2(s.ux, -s.uy) * 180) / Math.PI;
      return (deg + 360) % 360;
    });
    for (let i = 0; i < 6; i++) expect(bearings[i]!).toBeCloseTo(i * 60, 0);
  });

  it('reads each axis\'s stated maximum back at its own anchor pixel', () => {
    const axes = axesFromTruth();
    truth.axes.forEach((axis, i) => {
      const anchor = truth.calibration.anchors[`spoke${axis.axis}`]!;
      expect(axes.projectOnSpoke(i, anchor.px, anchor.py)!.value).toBeCloseTo(axis.max, 6);
    });
  });

  it('reads the centre as 0 on every axis', () => {
    const axes = axesFromTruth();
    const origin = truth.calibration.anchors['origin']!;
    for (let i = 0; i < 6; i++) {
      expect(axes.projectOnSpoke(i, origin.px, origin.py)!.value).toBeCloseTo(0, 6);
    }
  });

  it('places every series value inside its own axis, and carries the axis names', () => {
    const axes = axesFromTruth();
    for (const series of truth.series) {
      series.points.forEach((point, i) => {
        expect(point.name).toBe(axes.getSpokeLabel(i));
        expect(point.value).toBeGreaterThanOrEqual(truth.axes[i]!.centre);
        expect(point.value).toBeLessThanOrEqual(truth.axes[i]!.max);
        // And the value round-trips through the pixel the app would draw it at.
        const pixel = axes.dataToPixel(i, point.value);
        expect(axes.projectOnSpoke(i, pixel.x, pixel.y)!.value).toBeCloseTo(point.value, 6);
      });
    }
  });

  it('states an image size matching the PNG every other sample uses', () => {
    expect(truth.calibration.imageWidth).toBe(900);
    expect(truth.calibration.imageHeight).toBe(700);
  });
});
