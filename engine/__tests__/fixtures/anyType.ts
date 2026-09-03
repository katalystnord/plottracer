/**
 * DRIVING ANY GRAPH TYPE THROUGH A REAL CALIBRATION - the one fixture.
 *
 * A cross-cutting test ("every type must …") needs a calibrated session of each
 * of the twelve types, and each type wants a pixel layout that is genuinely
 * NON-degenerate for its own geometry: a real L for XY, a real triangle for
 * Ternary, three distinct radii for Polar, two curved arcs for the chart
 * recorder. That table is the expensive part, and it is the part a second
 * cross-cutting test would otherwise copy.
 *
 * ⚑ WHY IT LIVES HERE. `everyAxesTypeRefuses.test.ts` built this table for its
 * own use, and `everyTypeGenerates.test.ts` needs exactly the same thing. One
 * copy each is how `#7c3aed` came to have seven sites and three spellings
 * (v2.2 audit, finding A1) - a duplicate is not neutral, it forks every
 * decision downstream of it. So the table moved here the moment it had a second
 * caller, rather than after it had a third.
 *
 * ⚑⚑ KEYED BY CONFIG `id`, NOT BY LABEL. A label is UI text and is expected to
 * change - "Line (categorical)" became "Line" in v1.6 - while an id is what a
 * saved file names its type with, and is therefore stable by contract.
 */
import { expect } from 'vitest';
import {
  ALL_AXES_TYPE_CONFIGS,
  CalibrationSession,
  type AxesTypeConfig,
  type CalibratedAxes,
} from '../../calibrationSession.js';

/**
 * A NON-DEGENERATE pixel layout for each type.
 *
 * ⚑ WHY EACH ONE IS SHAPED AS IT IS. The first version of the refusal suite
 * walked every click along one diagonal. For XY that trips `parallelAxisGuard`
 * before any VALUE is read, so the "identical values are refused" case passed
 * without ever testing values - and the property it claimed was false: XY
 * happily accepted two identical X values and read one constant forever. The
 * round-2 audit fleet caught it. **A degenerate-input test must be degenerate
 * in exactly ONE way, or it proves nothing about the way it names.**
 */
export const HEALTHY_PIXELS: Record<string, Array<[number, number]>> = {
  xy: [[100, 400], [500, 400], [100, 400], [100, 100]],
  histogram: [[100, 400], [500, 400], [100, 400], [100, 100]],
  // ⚑⚑ FOUR CLICKS SINCE v2.3: two on the VALUE axis, then the two ends of the
  // CATEGORY axis. A bar chart has two axes and only one of them used to be
  // calibrated - the other was a fold-out seeded from P1.
  // ⚠️ The list must have an entry PER STEP: `clickHealthy` repeats the LAST
  // pixel once it runs off the end, so a two-entry layout put `Cat 1` and
  // `Cat n` on the same point and every one of these types failed its own
  // healthy control with "they must be different points".
  bar: [[300, 500], [300, 100], [100, 500], [500, 500]],
  categorical: [[300, 500], [300, 100], [100, 500], [500, 500]],
  boxplot: [[300, 500], [300, 100], [100, 500], [500, 500]],
  // ⚑ A candlestick is calibrated exactly as a box plot is - the walk is Box
  // Plot's, only the number of marks per datum differs (four, not five).
  candlestick: [[300, 500], [300, 100], [100, 500], [500, 500]],
  // ⚑ Span shares Bar's fixedSteps exactly, so it shares Bar's layout: two on
  // the VALUE axis, then the two ends of the CATEGORY axis.
  span: [[300, 500], [300, 100], [100, 500], [500, 500]],
  // The frame's three corners (x1 and y1 share the first), then the colour
  // key's strip -- two opposite corners of a bar standing clear of the plot
  // box, then two points ON that strip carrying its values. Kept off the plot
  // box deliberately: a key drawn across the figure is a different fixture.
  heatmap: [
    [100, 400], [500, 400], [100, 400], [100, 100],
    [600, 400], [640, 100], [620, 380], [620, 120],
  ],
  polar: [[300, 300], [400, 300], [500, 300]],
  spider: [[300, 300], [450, 300], [300, 150], [150, 300]],
  pie: [[450, 300], [300, 450], [150, 300], [300, 150], [406, 406]],
  ternary: [[100, 400], [400, 400], [250, 150]],
  map: [[100, 100], [300, 100]],
  // Two genuinely CURVED arcs: the pen arc on a circle centred (150,300) r=100,
  // then the chart arc on one centred (300,300) r=250, sharing t0r2.
  // ⚑ The first version put all five on one vertical line, which is collinear
  // -- so it was a degenerate fixture masquerading as the healthy control, and
  // it went red the moment CCR learned to refuse a collinear arc.
  ccr: [[250, 300], [150, 200], [50, 300], [300, 50], [550, 300]],
};

/**
 * The layout for `id`, or a FAILURE naming what is missing.
 *
 * ⚑⚑ NOT `HEALTHY_PIXELS[id]!`. A per-type lookup that returns `undefined` for
 * an unknown key is how the heatmap escaped `axesConfigTable.test.ts` for a
 * whole release (finding A6b) - a test of that shape gets QUIETER as the app
 * grows. A missing entry here would otherwise throw a bare TypeError deep
 * inside a loop: loud, but saying nothing about which type is unenrolled.
 */
export function healthyPixels(id: string): Array<[number, number]> {
  const pixels = HEALTHY_PIXELS[id];
  expect(
    pixels,
    `${id} has no healthy pixel layout - add one deliberately, so a new type is proven to calibrate rather than silently skipped`
  ).toBeDefined();
  return pixels!;
}

/** Every registered type as `[id, config]`, in the picker's own order. */
export const ALL_TYPES: Array<[string, AxesTypeConfig<CalibratedAxes>]> =
  ALL_AXES_TYPE_CONFIGS.map((c) => [c.id, c]);

/** A type's display label, for a test name a human can read. */
export const labelOf = (id: string): string =>
  ALL_AXES_TYPE_CONFIGS.find((c) => c.id === id)?.label ?? id;

/**
 * Click `config`'s steps at its healthy pixels, giving every value field the
 * text `valueAt` returns. Does NOT call `runCalibration` - the caller decides
 * whether success or refusal is the thing being tested.
 */
export function clickHealthy(
  id: string,
  config: AxesTypeConfig<CalibratedAxes>,
  valueAt: (n: number) => string,
  /** What every GLOBAL field is given. Separate from `valueAt` because a global
   * is not a click: a chart recorder's rotation time and a pie's total are
   * collected once, after the walk, and a test about the CLICKED values must be
   * able to hold them steady. */
  globalValue = '100'
): CalibrationSession<CalibratedAxes> {
  const session = new CalibrationSession(config);
  const pixels = healthyPixels(id);
  let n = 0;
  for (let i = 0; i < 40; i++) {
    const step = session.getCurrentStep();
    if (!step) break;
    const [px, py] = pixels[Math.min(i, pixels.length - 1)]!;
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues(step.valueFields.map(() => valueAt(n++)));
  }
  for (const gf of config.globalFields) session.setGlobalFieldValue(gf.key, globalValue);
  return session;
}

/**
 * A CALIBRATED session of `config`, from healthy pixels and distinct ascending
 * values - the starting point for any test about what happens AFTER a
 * calibration.
 *
 * Values are `10, 20, 30…`: distinct, ascending and positive, so they are valid
 * on a log scale and as a radius too.
 */
export function calibratedHealthy(
  id: string,
  config: AxesTypeConfig<CalibratedAxes>
): CalibrationSession<CalibratedAxes> {
  const session = clickHealthy(id, config, (n) => String((n + 1) * 10));
  expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
  return session;
}
