import { describe, expect, it } from 'vitest';
import { CalibrationSession, HISTOGRAM_AXES_CONFIG, XY_AXES_CONFIG, BAR_AXES_CONFIG } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { computeBinGlyph } from '../histogramGlyph.js';
import type { XYAxes } from '../../core/axes/xy.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * `getTupleGlyphs()` - what the canvas draws so a captured bin reads as
 * an INTERVAL rather than two loose dots.
 *
 * ⚑ WHY THIS FILE EXISTS. `computeBinGlyph` (the geometry) has had its own
 * tests since it was written; the session method that CALLS it had none - a
 * mutation run scored it at 15 mutants with ZERO coverage, meaning no test in
 * the suite reached it at all. That is this project's recurring shape: the pure
 * algorithm is covered and the WIRING is not, even though the wiring is where
 * the rules live (which graph types draw glyphs, and what a half-captured bin
 * draws). The same gap hid `getBarCategoryTable` at 0% until 2026-07-30.
 */

/** Calibrate an XY-shaped session: x 0..10 across 100..400, y 0..10 up 300..100. */
function calibrateXY(s: CalibrationSession<XYAxes>): void {
  const steps: Array<[number, number, string]> = [
    [100, 300, '0'],
    [400, 300, '10'],
    [100, 300, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, v] of steps) {
    expect(s.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues([v])).toBe(true);
  }
  expect(s.runCalibration()).toBe(true);
}

function histogramWithBins(corners: Array<[number, number]>): CalibrationSession<XYAxes> {
  const session = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
  calibrateXY(session);
  for (const [px, py] of corners) session.addDataPoint(px, py);
  return session;
}

describe('getTupleGlyphs', () => {
  it('draws one glyph per COMPLETE bin', () => {
    const session = histogramWithBins([
      [150, 200],
      [250, 200],
      [250, 240],
      [350, 240],
    ]);
    expect(session.getTupleGlyphs()).toHaveLength(2);
  });

  it('draws nothing at all before any bin is captured', () => {
    const session = histogramWithBins([]);
    expect(session.getTupleGlyphs()).toEqual([]);
  });

  it('⚑ draws NOTHING for a half-captured bin - the rule getBoxPlotGlyphs uses', () => {
    // One corner down is not an interval yet: which edge it is is unknown until
    // the second corner decides the ordering, so there is no honest span to draw.
    const session = histogramWithBins([[150, 200]]);
    expect(session.getTupleGlyphs()).toEqual([]);
  });

  it('skips an incomplete bin without dropping the complete one after it', () => {
    // A `continue`, not a `break` - the loop must keep going.
    const session = histogramWithBins([
      [150, 200],
      [250, 200], // complete
      [300, 260], // left alone, half-captured
    ]);
    expect(session.getTupleGlyphs()).toHaveLength(1);
  });

  it('builds each glyph from BOTH captured corners, in capture order', () => {
    const session = histogramWithBins([
      [150, 200],
      [250, 210],
    ]);
    const [glyph] = session.getTupleGlyphs();
    // Delegates to the geometry rather than re-deriving it - same call, same
    // pixels, so the canvas and the export cannot disagree about a bin's span.
    expect(glyph).toEqual(computeBinGlyph({ x: 150, y: 200 }, { x: 250, y: 210 }));
  });

  it('⚑⚑ no type wears another type\u2019s mark - a Bar gets ITS OWN, not a bin\u2019s', () => {
    // ⚑ The interesting case is Bar, not XY. XY has no slots, so its tuple rows
    // are empty and it would draw nothing even WITHOUT a guard - testing only
    // that proves nothing. Bar is tuple-shaped and its captured bar IS a
    // complete two-corner tuple, so a careless accessor renders bin staples over
    // every bar on the chart.
    //
    // ⚠️ UNTIL v2.5 THE ANSWER HERE WAS "nothing at all", and that was the
    // defect hiding behind the guard: a Bar had no mark of its own, so the type
    // whose datum most obviously IS a rectangle rendered as two numbered dots.
    // It now draws a staple standing ON the declared origin - which is NOT the
    // bin's staple, and that is what this asserts.
    const bar = new CalibrationSession(BAR_AXES_CONFIG) as unknown as CalibrationSession<BarAxes>;
    bar.handleCalibrationClick(300, 500);
    bar.confirmCalibrationValues(['0']);
    bar.handleCalibrationClick(300, 100);
    bar.confirmCalibrationValues(['10']);
    walkCategoryAxis(bar);
    expect(bar.runCalibration()).toBe(true);
    bar.addDataPoint(200, 400);
    bar.addDataPoint(260, 500);
    expect(bar.getTupleRows()[0]!.points.every((p) => p !== null)).toBe(true);
    const [barGlyph] = bar.getTupleGlyphs();
    expect(barGlyph).not.toEqual(computeBinGlyph({ x: 200, y: 400 }, { x: 260, y: 500 }));
    // ⚑ Both legs reach the origin's pixel (value 0 at py 500), which is the
    // whole point of the mark: the measurement made visible.
    expect(barGlyph!.filter((seg) => seg.to.y === 500)).toHaveLength(2);

    const xy = new CalibrationSession(XY_AXES_CONFIG);
    calibrateXY(xy as unknown as CalibrationSession<XYAxes>);
    xy.addDataPoint(150, 200);
    expect(xy.getTupleGlyphs()).toEqual([]);
  });

  it('returns nothing before the axes exist', () => {
    const session = new CalibrationSession(HISTOGRAM_AXES_CONFIG);
    expect(session.getTupleGlyphs()).toEqual([]);
  });
});
