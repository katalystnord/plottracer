import { describe, it, expect } from 'vitest';
import { valueAtPixel, exportLabelsFor } from '../exportValues.js';
import { Dataset } from '../dataset.js';
import { XYAxes } from '../axes/xy.js';
import { BarAxes } from '../axes/bar.js';
import { TernaryAxes } from '../axes/ternary.js';
import { CircularChartRecorderAxes } from '../axes/circularChartRecorder.js';
import { Calibration } from '../calibration.js';

/**
 * Checkpoint 76 — the exported VALUE contract (port of dataExport.js's
 * getValueAtPixel + generateCSV's header rule).
 *
 * These lock the bytes that reach a downstream consumer. Each of the three
 * defects this fixes has a test that would have caught it.
 */

function xyAxes(): XYAxes {
  const cal = new Calibration(2);
  cal.addPoint(100, 300, '0', '');
  cal.addPoint(400, 300, '10', '');
  cal.addPoint(100, 300, '', '0');
  cal.addPoint(100, 0, '', '10');
  const axes = new XYAxes();
  axes.calibrate(cal, false, false, true);
  return axes;
}

/** X calibrated with dates, Y numeric — the half-working date-axis case.
 *
 * SLASHES, not ISO dashes, and that is not a stylistic choice: WPD's date
 * parser returns null for any string containing neither `/` nor `:`
 * (`dateConversion.js:30-32`, ported verbatim), so "2024-01-01" is not a date
 * to it — it falls through to parseFloat and silently becomes the NUMBER 2024.
 * Verified by execution 2026-07-16. Inherited from upstream, not ours, and
 * logged separately; these fixtures use the format that actually builds a date
 * axis, because the point here is the export contract, not the parser. */
function xyDateAxes(): XYAxes {
  const cal = new Calibration(2);
  cal.addPoint(100, 300, '2024/01/01', '');
  cal.addPoint(400, 300, '2024/01/11', '');
  cal.addPoint(100, 300, '', '0');
  cal.addPoint(100, 0, '', '10');
  const axes = new XYAxes();
  axes.calibrate(cal, false, false, true);
  return axes;
}

function barAxes(): BarAxes {
  const cal = new Calibration(2);
  cal.addPoint(100, 300, '', '0');
  cal.addPoint(100, 100, '', '100');
  const axes = new BarAxes();
  axes.calibrate(cal, false, false);
  return axes;
}

/** The same 5-point walk the e2e drives, but with a date the parser accepts.
 *
 * The e2e's CCR block feeds "2024-01-01 00:00", which is NOT a date to WPD's
 * parser (see xyDateAxes above) — so our CCR e2e has been calibrating a chart
 * whose "time" is the number 2024. It passes because those tests deliberately
 * assert plumbing, not math ("Not hand-verified for exact math here -- that's
 * crossCheck's job"). Worth knowing, and logged; using a real date here is what
 * makes the julian-float defect observable at all. */
function ccrAxes(): CircularChartRecorderAxes {
  const cal = new Calibration(2);
  cal.addPoint(200, 200, '2024/01/01 00:00', '1'); // (T0,R0)
  cal.addPoint(400, 200, '', ''); // (T0,R1)
  cal.addPoint(300, 100, '', '10'); // (T0,R2)
  cal.addPoint(200, 400, '', ''); // (T1,R2)
  cal.addPoint(400, 400, '', ''); // (T2,R2)
  const axes = new CircularChartRecorderAxes();
  axes.calibrate(cal, '2024/01/01 00:00', 'week', 'clockwise');
  return axes;
}

describe('exportLabelsFor — headers come from the axes, not a hardcoded list', () => {
  it('reads each type\'s own contract', () => {
    // These are the three that DIVERGED from AxesTypeConfig.valueLabels, which
    // is what made this a defect rather than a tidy-up: valueLabels said
    // ['value'] / ['t','value'] / ['A','B','C'].
    expect(exportLabelsFor(barAxes())).toEqual(['Label', 'Y']);
    expect(exportLabelsFor(new CircularChartRecorderAxes())).toEqual(['Time', 'Magnitude']);
    expect(exportLabelsFor(new TernaryAxes())).toEqual(['a', 'b', 'c']);
    expect(exportLabelsFor(xyAxes())).toEqual(['X', 'Y']);
  });
});

describe('valueAtPixel — Bar', () => {
  it('emits [Label, Value] — the categorical axis a bar chart IS', () => {
    // The defect: a plain Bar chart exported bare numbers with nothing saying
    // which bar produced each. pixelToData returns ONE value; the label lives
    // in metadata, which is why getDimensions() is 2 while dataDim is 1.
    const ds = new Dataset(1);
    ds.addPixel(150, 200, { label: 'Control' });
    const row = valueAtPixel(0, barAxes(), ds.getPixel(0));
    expect(row[0]).toBe('Control');
    expect(row[1]).toBeCloseTo(50, 6);
  });

  it('falls back to Bar<i> for an unnamed bar, matching upstream', () => {
    const ds = new Dataset(1);
    ds.addPixel(150, 200);
    expect(valueAtPixel(3, barAxes(), ds.getPixel(0))[0]).toBe('Bar3');
  });

  it('falls back for an empty label rather than emitting a blank cell', () => {
    const ds = new Dataset(1);
    ds.addPixel(150, 200, { label: '' });
    expect(valueAtPixel(0, barAxes(), ds.getPixel(0))[0]).toBe('Bar0');
  });
});

describe('valueAtPixel — CCR', () => {
  it('formats its time column instead of emitting a julian float', () => {
    // The defect, and it hit 100% of CCR extractions: upstream formats this
    // column UNCONDITIONALLY (dataExport.js:36-37), so we read 2460123.45
    // where WPD reads a real time.
    const ds = new Dataset(2);
    ds.addPixel(320, 180);
    const row = valueAtPixel(0, ccrAxes(), ds.getPixel(0));
    expect(typeof row[0]).toBe('string');
    expect(row[0]).not.toMatch(/^\d+\.\d+$/); // not a raw serial number
    expect(row[0]).toMatch(/2024/);
  });

  it('leaves the magnitude column a number', () => {
    const ds = new Dataset(2);
    ds.addPixel(320, 180);
    expect(typeof valueAtPixel(0, ccrAxes(), ds.getPixel(0))[1]).toBe('number');
  });
});

describe('valueAtPixel — non-finite sanitation', () => {
  it('maps NaN/Infinity to null so CSV and JSON agree ("not measured")', () => {
    // A degenerate calibration (singular pixel matrix, log through zero) or an
    // undefined geometric point can hand pixelToData a non-finite value. It must
    // export as null everywhere, not "NaN" in CSV while JSON serializes null.
    const fake = { pixelToData: () => [NaN, Infinity, -Infinity, 5] } as unknown as Parameters<
      typeof valueAtPixel
    >[1];
    const out = valueAtPixel(0, fake, { x: 0, y: 0 } as Parameters<typeof valueAtPixel>[2], 'full');
    expect(out).toEqual([null, null, null, 5]);
  });

  it('a non-finite value in a DATE column exports null, not a "NaN" date string', () => {
    // The number-only sanitizer above cannot catch this: a date column formats
    // its value FIRST, so a non-finite serial would become the string
    // "NaN/NaN/NaN" and slip through. The guard belongs in formatIfNumber.
    const axes = xyDateAxes();
    (axes as unknown as { pixelToData: () => number[] }).pixelToData = () => [NaN, 5];
    const ds = new Dataset(2);
    ds.addPixel(250, 150);
    const row = valueAtPixel(0, axes, ds.getPixel(0), 'full');
    expect(row[0]).toBeNull();
    expect(row[1]).toBe(5);
  });
});

describe('valueAtPixel — XY', () => {
  it('leaves a numeric XY chart entirely alone', () => {
    const ds = new Dataset(2);
    ds.addPixel(250, 150);
    const row = valueAtPixel(0, xyAxes(), ds.getPixel(0));
    expect(row[0]).toBeCloseTo(5, 6);
    expect(row[1]).toBeCloseTo(5, 6);
  });

  it('formats a date-calibrated X but not a numeric Y — dates are opt-in here, unlike CCR', () => {
    const ds = new Dataset(2);
    ds.addPixel(250, 150);
    const row = valueAtPixel(0, xyDateAxes(), ds.getPixel(0));
    expect(row[0]).toMatch(/2024\/01\/06/);
    expect(typeof row[1]).toBe('number');
  });
});

/** A small-magnitude Y axis (0..0.01 over 300px) — the case the old fixed
 * 2-decimal round ZEROED. Its resolution is ~3.3e-5/px, so values near 0.003
 * must survive to several decimals. */
function smallYAxes(): XYAxes {
  const cal = new Calibration(2);
  cal.addPoint(100, 300, '0', '');
  cal.addPoint(400, 300, '10', '');
  cal.addPoint(100, 300, '', '0');
  cal.addPoint(100, 0, '', '0.01');
  const axes = new XYAxes();
  axes.calibrate(cal, false, false, true);
  return axes;
}

describe('valueAtPixel — principled precision (the v1.0 export blocker fix)', () => {
  it('does NOT zero a small-magnitude value — it rounds to the axis resolution, not 2 decimals', () => {
    // Y = (300 - py)/300 * 0.01. At py=198, Y = 102/300*0.01 = 0.0034.
    const ds = new Dataset(2);
    ds.addPixel(250, 198);
    const row = valueAtPixel(0, smallYAxes(), ds.getPixel(0));
    // The old Math.round(v*100)/100 made this exactly 0. It must not.
    expect(row[1]).not.toBe(0);
    expect(row[1] as number).toBeGreaterThan(0.003);
    expect(row[1] as number).toBeCloseTo(0.0034, 4);
  });

  it("caps precision on a coarse axis rather than fabricating digits", () => {
    // Standard 0..10 axis: resolution ~0.033/px -> ~2 decimals. A pixel giving a
    // long decimal is reported to a few places, not 12.
    const ds = new Dataset(2);
    ds.addPixel(237, 150); // x = (237-100)/300*10 = 4.5666...
    const x = valueAtPixel(0, xyAxes(), ds.getPixel(0))[0] as number;
    expect(x).toBeCloseTo(4.57, 2);
    expect(String(x).replace('-', '').replace('.', '').length).toBeLessThan(6); // not 4.566666...
  });

  it("full-precision mode emits the raw computed value", () => {
    const ds = new Dataset(2);
    ds.addPixel(237, 150);
    const auto = valueAtPixel(0, xyAxes(), ds.getPixel(0), 'auto')[0] as number;
    const full = valueAtPixel(0, xyAxes(), ds.getPixel(0), 'full')[0] as number;
    expect(full).toBeCloseTo(4.56667, 4); // every digit
    expect(full).not.toBe(auto); // auto rounded it; full did not
  });
});
