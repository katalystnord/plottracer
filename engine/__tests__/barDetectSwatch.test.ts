import { describe, it, expect } from 'vitest';
import { runBarDetect, partitionSwatchSuspects } from '../barDetectRun.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';

/**
 * ⚑⚑ A LEGEND SWATCH IS NOT A BAR - and the record was carrying it as one.
 *
 * David, driving the built app on a grouped bar figure: *"we have a problem with
 * the legend bars here in autodetect."* A legend's swatch is a filled rectangle
 * in EXACTLY the series ink, so it matches the colour ball at any tolerance,
 * comes back as a blob and is filed as a bar. It exports.
 *
 * ⚠️ THE OBVIOUS FIX IS THE WRONG ONE, measured off his screenshot: that legend
 * was INSET, comfortably inside both the calibrated value span and the declared
 * category span, so restricting the trace to the plot area would have excluded
 * nothing. Inset legends are the common case in published figures.
 *
 * ▶ THE DISCRIMINATOR IS THE BASELINE ANCHOR, and it needs a SIZE test beside it
 * because a stacked figure's upper segments legitimately float too.
 *
 * ⚑ THE DETECTOR REPORTS AND DOES NOT ACT. Every box is still returned; it names
 * the suspects by index. The standing rule for bar techniques is that one may
 * only refuse or corroborate, never act alone.
 *
 * ⚑⚑ THE CALLER THEN HOLDS THEM BACK AND OFFERS THEM (v2.3), which is the other
 * half of that rule rather than a departure from it: a refusal is only allowed
 * when the control that undoes it is on screen. Filing the phantom and printing
 * a sentence left a wrong reading in the record that exports unless the reader
 * goes and finds it; holding it back leaves a visible offer instead. The one
 * that is visible is the one to prefer - see `partitionSwatchSuspects`.
 */

const W = 200;
const H = 120;

/** A canvas with white ground and black rectangles painted on it. */
function image(rects: { x0: number; y0: number; x1: number; y1: number }[]) {
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (const r of rects) {
    for (let y = r.y0; y <= r.y1; y += 1) {
      for (let x = r.x0; x <= r.x1; x += 1) {
        const i = (y * W + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
      }
    }
  }
  return data;
}

const BLACK: [number, number, number] = [0, 0, 0];
/** The baseline sits at py 100, the foot of every bar below. */
const BASELINE = { atPixel: 100, tolerancePx: 2 };

const detect = (data: Uint8ClampedArray, baseline = BASELINE) =>
  runBarDetect(data, W, H, BLACK, 30, 'foreground', undefined, { minDiameter: 3 }, undefined, baseline);

describe('a shape that neither reaches the baseline nor spans a category is reported', () => {
  it('⚑⚑ three bars on the baseline and one small floating square: the square is named', () => {
    const result = detect(
      image([
        { x0: 10, y0: 40, x1: 40, y1: 100 },
        { x0: 60, y0: 20, x1: 90, y1: 100 },
        { x0: 110, y0: 55, x1: 140, y1: 100 },
        { x0: 170, y0: 10, x1: 181, y1: 21 }, // the legend swatch: small, floating
      ])
    );
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.boxes).toHaveLength(4);
    expect(result.swatchSuspects).toHaveLength(1);
    // Named by INDEX into the boxes actually returned, so the caller can point at it.
    const suspect = result.boxes[result.swatchSuspects![0]!]!;
    expect(suspect.start.x).toBeGreaterThan(160);
  });

  it('⚑⚑ and every box is still RETURNED - the report does not act', () => {
    const result = detect(
      image([
        { x0: 10, y0: 40, x1: 40, y1: 100 },
        { x0: 60, y0: 20, x1: 90, y1: 100 },
        { x0: 170, y0: 10, x1: 181, y1: 21 },
      ])
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.boxes).toHaveLength(3);
    // ⚑ Indices into `boxes` as returned, which is blob order and not paint
    // order - so the identity is checked by where the box actually is.
    expect(result.swatchSuspects).toHaveLength(1);
    expect(result.boxes[result.swatchSuspects![0]!]!.start.x).toBeGreaterThan(160);
  });

  it('⚑ an ordinary chart with no legend reports nothing', () => {
    const result = detect(
      image([
        { x0: 10, y0: 40, x1: 40, y1: 100 },
        { x0: 60, y0: 20, x1: 90, y1: 100 },
        { x0: 110, y0: 55, x1: 140, y1: 100 },
      ])
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.swatchSuspects).toEqual([]);
  });

  it('⚑⚑ a FULL-WIDTH shape that floats is NOT called a swatch - that is a stacked segment', () => {
    // The case that makes the baseline test insufficient on its own: on a stacked
    // figure only the bottom layer touches the baseline, and every segment above
    // it floats exactly like a swatch does. Size is what separates them.
    const result = detect(
      image([
        { x0: 10, y0: 60, x1: 40, y1: 100 }, // bottom segment, on the baseline
        { x0: 10, y0: 20, x1: 40, y1: 58 }, // the segment stacked on it: floats
        { x0: 60, y0: 50, x1: 90, y1: 100 },
      ])
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.swatchSuspects).toEqual([]);
  });

  it('⚑ a bar drawn ACROSS the baseline reaches it from both sides', () => {
    const result = detect(
      image([
        { x0: 10, y0: 40, x1: 40, y1: 100 },
        { x0: 60, y0: 80, x1: 90, y1: 120 }, // straddles py 100
      ])
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.swatchSuspects).toEqual([]);
  });

  it('⚑⚑ nothing is reported when NO shape reaches the baseline', () => {
    // A floating-bar chart, or a stack captured without its bottom layer. There
    // is no reference to measure "small" against, and guessing would libel every
    // bar on the figure.
    const result = detect(
      image([
        { x0: 10, y0: 20, x1: 40, y1: 60 },
        { x0: 60, y0: 30, x1: 90, y1: 70 },
        { x0: 170, y0: 10, x1: 181, y1: 21 },
      ])
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.swatchSuspects).toEqual([]);
  });

});

describe('the suspects are HELD BACK from the record, and offered instead', () => {
  /**
   * ⚑⚑ WHY HOLDING BACK BEATS FILING-AND-SAYING-SO, which is what this did first.
   * A phantom bar filed as data looks exactly like a measurement: it has a row,
   * a category and a value, and it exports. The reader has to be told it is
   * there, find it, and delete it. A shape held back with an offer beside it is
   * visible by construction and costs one click to take back.
   *
   * ⚑ It is only a refusal because the control that undoes it exists. Without
   * the offer this would be a silent drop, which is the worse half of the same
   * defect.
   */
  it('the bars are filed and the swatch is not', () => {
    const result = detect(
      image([
        { x0: 10, y0: 40, x1: 40, y1: 100 },
        { x0: 60, y0: 20, x1: 90, y1: 100 },
        { x0: 110, y0: 55, x1: 140, y1: 100 },
        { x0: 170, y0: 10, x1: 181, y1: 21 }, // the legend swatch
      ])
    );
    if ('error' in result) throw new Error(result.error);
    const { file, holdBack } = partitionSwatchSuspects(result);
    expect(file).toHaveLength(3);
    expect(holdBack).toHaveLength(1);
    // ⚑ IDENTITY, not arithmetic. Three-and-one is also what you get by holding
    // back the wrong shape, so the held-back box has to BE the swatch.
    expect(holdBack[0]!.start.x).toBeGreaterThan(160);
    expect(file.every((b) => b.start.x < 160)).toBe(true);
  });

  it('a figure with no legend files every shape and offers nothing', () => {
    const result = detect(
      image([
        { x0: 10, y0: 40, x1: 40, y1: 100 },
        { x0: 60, y0: 20, x1: 90, y1: 100 },
      ])
    );
    if ('error' in result) throw new Error(result.error);
    const { file, holdBack } = partitionSwatchSuspects(result);
    expect(file).toHaveLength(2);
    expect(holdBack).toEqual([]);
  });

  it('⚑⚑ a STACKED figure files every segment - nothing is held back', () => {
    // The case that makes holding back dangerous rather than merely wrong: an
    // upper segment floats exactly like a swatch, and withholding it would
    // delete a real reading. The size test is what stops it, and this asserts
    // the whole chain rather than the detector half alone.
    const result = detect(
      image([
        { x0: 10, y0: 60, x1: 40, y1: 100 },
        { x0: 10, y0: 20, x1: 40, y1: 58 },
        { x0: 60, y0: 50, x1: 90, y1: 100 },
      ])
    );
    if ('error' in result) throw new Error(result.error);
    const { file, holdBack } = partitionSwatchSuspects(result);
    expect(holdBack).toEqual([]);
    expect(file).toHaveLength(3);
  });

  it('⚑ a floating-bar figure files everything - there is no reference to judge "small" by', () => {
    const result = detect(
      image([
        { x0: 10, y0: 20, x1: 40, y1: 60 },
        { x0: 60, y0: 30, x1: 90, y1: 70 },
        { x0: 170, y0: 10, x1: 181, y1: 21 },
      ])
    );
    if ('error' in result) throw new Error(result.error);
    const { file, holdBack } = partitionSwatchSuspects(result);
    expect(holdBack).toEqual([]);
    expect(file).toHaveLength(3);
  });

  it('⚑ with NO baseline declared nothing can be held back, which is the pre-v2.3 record exactly', () => {
    const result = runBarDetect(
      image([
        { x0: 10, y0: 40, x1: 40, y1: 100 },
        { x0: 170, y0: 10, x1: 181, y1: 21 },
      ]),
      W, H, BLACK, 30, 'foreground', undefined, { minDiameter: 3 }
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.swatchSuspects).toBeUndefined();
    const { file, holdBack } = partitionSwatchSuspects(result);
    expect(holdBack).toEqual([]);
    expect(file).toHaveLength(2);
  });

  it('⚑ without a baseline the detector answers exactly as it did before', () => {
    const data = image([
      { x0: 10, y0: 40, x1: 40, y1: 100 },
      { x0: 170, y0: 10, x1: 181, y1: 21 },
    ]);
    const result = runBarDetect(data, W, H, BLACK, 30, 'foreground', undefined, { minDiameter: 3 });
    if ('error' in result) throw new Error(result.error);
    expect(result.boxes).toHaveLength(2);
    expect(result.swatchSuspects).toBeUndefined();
  });
});

describe('the session says where the baseline runs, so the detector can ask', () => {
  it('⚑ answers for an ordinary bar chart, at the pixel the baseline was calibrated to', async () => {
    const { CalibrationSession, BAR_AXES_CONFIG } = await import('../calibrationSession.js');
    const s = new CalibrationSession(BAR_AXES_CONFIG);
    s.handleCalibrationClick(100, 500);
    expect(s.confirmCalibrationValues(['0'])).toBe(true);
    s.handleCalibrationClick(100, 100);
    expect(s.confirmCalibrationValues(['10'])).toBe(true);
    walkCategoryAxis(s);
    expect(s.runCalibration()).toBe(true);
    // The baseline defaults to 0, which is py 500 on this calibration.
    expect(s.baselinePixelForDetect()?.atPixel).toBeCloseTo(500, 6);
  });

  it('⚑ and follows a NON-ZERO declared baseline', async () => {
    // Nothing here assumes the baseline is zero: it is a declared value like any
    // other, and the pixel follows it. 40 px per unit, so a baseline of 2 is
    // py 420.
    const { CalibrationSession, BAR_AXES_CONFIG } = await import('../calibrationSession.js');
    const s = new CalibrationSession(BAR_AXES_CONFIG);
    s.setOption('baselineValue', '2');
    s.handleCalibrationClick(100, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(100, 100);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s);
    expect(s.runCalibration()).toBe(true);
    expect(s.baselinePixelForDetect()?.atPixel).toBeCloseTo(420, 6);
  });

  it('⚑⚑ says NOTHING when no baseline was declared', async () => {
    const { CalibrationSession, BAR_AXES_CONFIG } = await import('../calibrationSession.js');
    const s = new CalibrationSession(BAR_AXES_CONFIG);
    s.setOption('hasBaseline', 'false');
    s.handleCalibrationClick(100, 500);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(100, 100);
    s.confirmCalibrationValues(['10']);
    walkCategoryAxis(s);
    expect(s.runCalibration()).toBe(true);
    // A figure with no baseline has no anchor to measure against, and the
    // detector must not be handed one that was never declared.
    expect(s.baselinePixelForDetect()).toBeNull();
  });

  it('⚑ and nothing at all on a type that has no baseline to declare', async () => {
    const { CalibrationSession, XY_AXES_CONFIG } = await import('../calibrationSession.js');
    const s = new CalibrationSession(XY_AXES_CONFIG);
    expect(s.baselinePixelForDetect()).toBeNull();
  });
});
