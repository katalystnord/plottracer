import { describe, it, expect } from 'vitest';
import { computeWhiskerGlyph, CAP_HALF } from '../errorBarGlyph.js';
import { CalibrationSession, BAR_AXES_CONFIG } from '../calibrationSession.js';
import type { BarAxes } from '../../core/axes/bar.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

// ⚑ This file used to test computeErrorBarGlyph -- the RETIRED tuple model's
// two-ended bar -- and nothing else. That function was reachable only through the
// retired 'errorbar' graph type, deleted in v1.5, so its three tests were green
// over code no user could run, while the whisker glyph the LIVE error tool
// actually draws had no test at all. Inverted here.
describe('whisker glyph (checkpoint 79) -- what the live error tool draws', () => {
  it('⚑ draws a tick WIDER than the datum marker it sits beside', () => {
    // The cap's job is to be legible AGAINST the data point, and the datum
    // draws as a ring of radius 7 (see ui/src/ImageCanvas.tsx) with crosshair
    // arms. The inherited constant was 8, spanning 16px against a 14px marker,
    // so the whisker's end vanished into the circle. This pins the RELATIONSHIP
    // rather than the digit -- the number may be tuned, but a cap narrower than
    // the marker is the defect, not a preference.
    const DATUM_MARKER_RADIUS = 7;
    expect(CAP_HALF).toBeGreaterThan(DATUM_MARKER_RADIUS);

    const w = computeWhiskerGlyph({ x: 100, y: 100 }, { x: 100, y: 40 });
    const tick = w.cap;
    const width = Math.hypot(tick.to.x - tick.from.x, tick.to.y - tick.from.y);
    expect(width).toBeGreaterThan(DATUM_MARKER_RADIUS * 2);
  });

  it('draws the bar out to the cap, then a tick across the CAP end only', () => {
    const w = computeWhiskerGlyph({ x: 100, y: 100 }, { x: 100, y: 40 });
    // The datum end draws no tick of its own: it already has its data dot, and a
    // tick there would read as a second cap.
    expect(w.bar).toEqual({ from: { x: 100, y: 100 }, to: { x: 100, y: 40 } });
    // The tick sits at the CAP, normal to a vertical bar so horizontal...
    expect(w.cap.from.y).toBeCloseTo(40);
    expect(w.cap.to.y).toBeCloseTo(40);
    // ...and centred on it.
    expect((w.cap.from.x + w.cap.to.x) / 2).toBeCloseTo(100);
  });

  it('leans the tick with the bar, so a rotated calibration cannot detach it', () => {
    const w = computeWhiskerGlyph({ x: 0, y: 0 }, { x: 100, y: 100 }); // 45°
    const tick = w.cap;
    // Dot product with the bar's own direction must be ~0.
    expect((tick.to.x - tick.from.x) * 100 + (tick.to.y - tick.from.y) * 100).toBeCloseTo(0, 6);
    // Centred on the cap, not on the datum.
    expect((tick.from.x + tick.to.x) / 2).toBeCloseTo(100);
    expect((tick.from.y + tick.to.y) / 2).toBeCloseTo(100);
  });

  it('still draws a visible tick when a cap sits ON its datum (zero error)', () => {
    // A cap on its datum is a claim of perfect certainty -- more dangerous here
    // than a wrong number -- so it must never render as nothing at all.
    const w = computeWhiskerGlyph({ x: 100, y: 100 }, { x: 100, y: 100 });
    // ⚑ The CAP is what must stay visible; the BAR is honestly empty.
    const width = Math.hypot(w.cap.to.x - w.cap.from.x, w.cap.to.y - w.cap.from.y);
    expect(width).toBeGreaterThan(0);
    expect(w.bar.from).toEqual(w.bar.to);
  });
});

/**
 * ⚑⚑ A BAR'S WHISKER STARTS AT THE BAR'S CENTRE, NOT AT A CORNER.
 *
 * David, 2026-08-24, looking at real published figures: *"The error bars need to
 * be drawn on the center of the bar however. Not from a corner point."* Every one
 * of them draws it there - ggplot, matplotlib, the salinity chart, the
 * significance cartoons.
 *
 * ⚠️ AND A BAR IS CAPTURED AS TWO OPPOSITE CORNERS, so NEITHER stored point is
 * at the centre. The whisker ran diagonally from a corner to a cap the user had
 * placed where the figure draws it - the picture disagreeing with the record,
 * CLAUDE.md pattern 4, the same shape the cap drift had.
 *
 * ⚑ The anchor is DERIVED from what the record already holds. Nothing measured
 * changes: the cap's own pixel is still the measurement.
 */
describe('the anchor a bar\u2019s whisker is drawn from', () => {
  /** A bar from x 100..160, top at y 200, baseline at y 500 (upright). */
  function upright(): CalibrationSession<BarAxes> {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    s.handleCalibrationClick(80, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(80, 100);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s, { from: { x: 80, y: 500 }, to: { x: 680, y: 500 }, count: 4 });
    expect(s.runCalibration()).toBe(true);
    s.addDataPoint(100, 500);
    s.addDataPoint(160, 200);
    return s;
  }

  it('⚑⚑ starts at the CENTRE of the bar along the category axis', () => {
    const s = upright();
    expect(s.captureErrorCap({ targetIndex: 0, datumPixel: { x: 100, y: 500 }, capPixel: { x: 130, y: 150 }, baseName: 'SD' })).toBeNull();
    const [w] = s.getErrorWhiskers();
    expect(w).toBeDefined();
    // x 130 is the midpoint of 100 and 160 - neither of which is a stored point.
    expect(w!.bar.from.x).toBeCloseTo(130, 6);
  });

  it('⚑ and at the END OF THE BAR NEAREST THE CAP, not at the far one', () => {
    const s = upright();
    s.captureErrorCap({ targetIndex: 0, datumPixel: { x: 100, y: 500 }, capPixel: { x: 130, y: 150 }, baseName: 'SD' });
    const [w] = s.getErrorWhiskers();
    expect(w!.bar.from.y).toBeCloseTo(200, 6);
  });

  /**
   * ⚑ THE ORIENTATION DECIDES WHICH ROLE IS WHICH, so a horizontal bar chart is
   * the same rule and not a special case: there the categories run DOWN and the
   * value ACROSS, so the midpoint is taken on y and the near end on x.
   */
  it('⚑ follows the orientation on a HORIZONTAL bar chart', () => {
    const s = new CalibrationSession<BarAxes>(BAR_AXES_CONFIG);
    s.setOption('isRotated', 'true');
    s.handleCalibrationClick(100, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(500, 500);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s, { from: { x: 100, y: 100 }, to: { x: 100, y: 600 }, count: 4 });
    expect(s.runCalibration()).toBe(true);
    s.addDataPoint(100, 200); // bar runs across, spanning y 200..260
    s.addDataPoint(400, 260);
    expect(s.captureErrorCap({ targetIndex: 0, datumPixel: { x: 100, y: 200 }, capPixel: { x: 450, y: 230 }, baseName: 'SD' })).toBeNull();
    const [w] = s.getErrorWhiskers();
    // ⚑ The MIDPOINT is the half David reported and the half this change makes:
    // y 230 is the centre of a bar spanning 200..260, and neither 200 nor 260 is
    // where the whisker used to start.
    expect(w!.bar.from.y).toBeCloseTo(230, 6);
    // ⚠️ NOT ASSERTED: which END it picks on a rotated chart. Measured here as
    // x=100 rather than the 400 nearest the cap, because `captureErrorCap`
    // CONSTRAINS the cap before it is stored and the constrained pixel is what
    // this reads. Whether that constraint is right for a horizontal bar is its
    // own question and is logged rather than guessed at - writing an expectation
    // I have not understood would bake today's behaviour in as intended.
  });

  it('⚑ a HALF-DRAGGED bar has no centre, so its one corner is the honest anchor', () => {
    const s = upright();
    // A second bar with only one corner down.
    s.setSlotCursor(null, 0);
    s.addDataPoint(300, 500);
    expect(s.captureErrorCap({ targetIndex: 0, datumPixel: { x: 300, y: 500 }, capPixel: { x: 300, y: 400 }, baseName: 'SD' })).toBeNull();
    // ⚑ Indexed rather than `.at(-1)`: the benchmark harness compiles this
    // checkout under an older lib target and `Array.prototype.at` is not in it.
    const all = s.getErrorWhiskers();
    const w = all[all.length - 1]!;
    expect(w.bar.from.x).toBeCloseTo(300, 6);
  });
});
