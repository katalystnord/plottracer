import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPng } from './helpers/readPng.js';
import { runBarDetect } from '../barDetectRun.js';
import {
  BAR_AXES_CONFIG,
  SPAN_AXES_CONFIG,
  CalibrationSession,
} from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';

/**
 * ⚑⚑ EVERY BAR-FAMILY SAMPLE, READ END TO END AND CHECKED AGAINST ITS OWN TRUTH.
 *
 * Written as the outward-pointing half of v2.5's pre-tag audit. That release
 * changed what a bar's `Value` MEANS (measured from the figure's origin rather
 * than a typed one), what a stacked segment reports (`Base` and a SIGNED
 * contribution), which columns reach the file, and where the detector's join is
 * aimed. Every one of those is a change to the thing that produces numbers, and
 * the project's own history says that is exactly when a silent wrong number gets
 * in: three of them went unnoticed before v2.3 with the whole board green.
 *
 * ⚑ THE INSTRUMENT POINTS OUTWARD, which is the point. The unit board asks
 * whether the code agrees with itself; this asks whether the app agrees with
 * FIGURES WHOSE ANSWERS WERE WRITTEN DOWN BEFORE ANY OF TODAY'S CODE EXISTED.
 * The `.truth.json` files are committed ground truth, not fixtures I wrote.
 *
 * ⚑ Calibration comes from each figure's own anchors - the same four clicks the
 * walk asks for - so a regression in the ORIGIN shows up here as every reading
 * shifting together, and a regression in the SCALE as every reading scaled.
 * (That is the same signature that found David's `-00` mistype in one minute.)
 */
interface Truth {
  calibration: { anchors: Record<string, { px: number; py: number; value?: number }> };
  series: { name?: string; points: { category: string; value?: number; start?: number; end?: number }[] }[];
}

function truthFor(stem: string): Truth {
  return JSON.parse(readFileSync(`samples/${stem}.truth.json`, 'utf8')) as Truth;
}

/** A session calibrated exactly as the figure's own truth anchors describe. */
function calibratedFrom(truth: Truth, config: typeof BAR_AXES_CONFIG, options: Record<string, string> = {}) {
  const a = truth.calibration.anchors;
  const s = new CalibrationSession<BarAxes>(config as never);
  for (const [k, v] of Object.entries(options)) s.setOption(k, v);
  s.handleCalibrationClick(a['p1']!.px, a['p1']!.py);
  expect(s.confirmCalibrationValues([String(a['p1']!.value)])).toBe(true);
  s.handleCalibrationClick(a['p2']!.px, a['p2']!.py);
  expect(s.confirmCalibrationValues([String(a['p2']!.value)])).toBe(true);
  s.handleCalibrationClick(a['c1']!.px, a['c1']!.py);
  s.handleCalibrationClick(a['c2']!.px, a['c2']!.py);
  expect(s.confirmCalibrationValues([String(a['c2']!.value)])).toBe(true);
  expect(s.runCalibration()).toBe(true);
  return s;
}

/** Auto-extract by colour, the way the rail's By-colour tool does. */
function traced(stem: string, s: CalibrationSession<BarAxes>, ink: [number, number, number]) {
  const img = readPng(`samples/${stem}.png`);
  const declared = s.categoryDividersForDetect();
  const result = runBarDetect(
    img.data,
    img.width,
    img.height,
    ink,
    30,
    'foreground',
    undefined,
    { minDiameter: 3 },
    declared
      ? {
          dividers: declared.dividers,
          categoryAxis: declared.categoryAxis,
          expected: s.getCategoryAxis().getCategoryCount(),
        }
      : undefined,
    s.baselinePixelForDetect() ?? undefined,
    s.severingRulePixelForDetect() ?? undefined
  );
  if ('error' in result) throw new Error(`${stem}: ${result.error}`);
  for (const box of result.boxes) {
    s.addDataPoint(box.start.x, box.start.y);
    s.addDataPoint(box.end.x, box.end.y);
  }
  return result;
}

/** Every reading the panel would show for the active series, by category. */
function readings(s: CalibrationSession<BarAxes>) {
  const table = s.getBarCategoryTable();
  const at = table.derivedColumnIndex ?? 0;
  return table.columns[0]!.cells.map((c) => c[at] ?? null);
}

const INK: [number, number, number] = [31, 78, 121];

/**
 * How far a reading may sit from truth: TWO PIXELS in this figure's own data
 * units, computed from its calibration anchors.
 *
 * ⚑ A TOLERANCE, NOT A DIGIT COUNT. `toBeCloseTo(v, 1)` means 0.05 whatever the
 * axis is, which is tighter than the pixels can express on a 0..450 chart and
 * looser than they can on a 0..1 one - so it would be asserting the fixture's
 * scale rather than the reading. Two pixels is the same slack the detector's own
 * baseline test allows, and it is what a hand or an anti-aliased edge is worth.
 */
function tolerance(truth: Truth): number {
  const a = truth.calibration.anchors;
  const span = Math.abs(a['p2']!.value! - a['p1']!.value!);
  const px = Math.hypot(a['p2']!.px - a['p1']!.px, a['p2']!.py - a['p1']!.py);
  return (span / px) * 2;
}

describe('a plain bar chart, auto-extracted, against its committed truth', () => {
  it('⚑⚑ six bars, every one within a tenth of a unit', () => {
    const truth = truthFor('bar-tensile-strength');
    const s = calibratedFrom(truth, BAR_AXES_CONFIG);
    traced('bar-tensile-strength', s, INK);
    const got = readings(s);
    const want = truth.series[0]!.points.map((p) => p.value!);
    expect(got).toHaveLength(want.length);
    const tol = tolerance(truth);
    want.forEach((v, i) => {
      expect(Math.abs(got[i]! - v), `${truth.series[0]!.points[i]!.category}`).toBeLessThan(tol);
    });
  });
});

describe('a floating-bar figure is a SPAN, and the zero rule does not split it', () => {
  it('⚑⚑ twelve spans, both ends of each within a tenth of a degree', () => {
    const truth = truthFor('bar-floating-temperature');
    const s = calibratedFrom(truth, SPAN_AXES_CONFIG as never);
    const result = traced('bar-floating-temperature', s, INK);
    // ⚑ THE JOIN. Five of these bars cross the zero rule, which the figure
    // paints across them in a colour the trace drops. Without it the detector
    // returns seventeen shapes for twelve bars - measured, and the state this
    // figure was in for three hours this morning.
    expect(result.boxes).toHaveLength(12);
    const table = s.getBarCategoryTable();
    expect(table.valueColumns).toEqual(['Min', 'Max']);
    const tol = tolerance(truth);
    truth.series[0]!.points.forEach((p, i) => {
      const cell = table.columns[0]!.cells[i]!;
      expect(Math.abs(cell[0]! - Math.min(p.start!, p.end!)), `${p.category} min`).toBeLessThan(tol);
      expect(Math.abs(cell[1]! - Math.max(p.start!, p.end!)), `${p.category} max`).toBeLessThan(tol);
    });
  });
});

describe('a hatched figure is rejoined before it is read', () => {
  it('⚑ six bars, on the values its truth file states', () => {
    const truth = truthFor('bar-hatched-extraction-yield');
    const s = calibratedFrom(truth, BAR_AXES_CONFIG);
    // ⚑ Sampled from the ink, not declared - the same rule
    // `hatchedSample.test.ts` follows, because a hand-picked colour drifts from
    // the PNG the moment anyone touches the fixture.
    const img = readPng('samples/bar-hatched-extraction-yield.png');
    const a = truth.calibration.anchors;
    const dividers = s.categoryDividersForDetect()!.dividers;
    const sampleX = Math.round((dividers[0]! + dividers[1]!) / 2);
    const sampleY = Math.round(a['p1']!.py - 30);
    const o = (sampleY * img.width + sampleX) * 4;
    const ink = [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!] as [number, number, number];
    const result = traced('bar-hatched-extraction-yield', s, ink);
    expect(result.boxes.length).toBe(truth.series[0]!.points.length);
    const got = readings(s);
    const tol = tolerance(truth);
    truth.series[0]!.points.forEach((p, i) => {
      expect(Math.abs(got[i]! - p.value!), p.category).toBeLessThan(tol);
    });
  });
});
