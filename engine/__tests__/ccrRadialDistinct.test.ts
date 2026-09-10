/**
 * ⚑⚑ A RADIAL SCALE MEASURED FROM A CENTRE NEEDS TWO DIFFERENT RADII - and the
 * centre being FITTED rather than CLICKED does not change that.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-10 (round types, R3). A circular chart recorder
 * takes its radial scale from `dist(chartCentre, T0R0)` and
 * `dist(chartCentre, T0R2)`: `core/axes/circularChartRecorder.ts`'s
 * `pixelToData` divides by `rMaxPx - rMinPx`. Click those two at the same
 * distance from the fitted centre and that divisor is zero, while `calibrate()`
 * reports success with nothing on screen wrong.
 *
 * ⚠️⚑⚑ AND THE AUDIT SAID "READS null FOR EVERY VALUE", WHICH IS THE HARMLESS
 * HALF. Measured on the fixture below: the centre is FITTED, so the two radii
 * differ by float noise (-1.4e-13) rather than by exactly zero - the division
 * is finite, and the readings come back **4.2e16** and **7.0e15**. Two radii,
 * two different numbers, a column that looks like data rather than a row of
 * dashes. A dash is visible; 4.2e16 is a measurement. ▶ The exactly-equal case
 * is the one that gives Infinity, and only a hand-built calibration reaches it -
 * which is why the guard tests a TOLERANCE and not equality.
 *
 * ⚑⚑ POLAR ALREADY HAD THE GUARD, and CCR is the same figure with the origin
 * fitted instead of clicked. `radialDistinctGuard` is therefore EXTENDED to
 * accept a centre fitted from three steps rather than reimplemented per type -
 * one declaration, one sentence, one implementation, the reuse rule's own
 * argument. The message below is Polar's, word for word, and that is the
 * assertion: a second mechanism would phrase it differently.
 *
 * ⚑ THE DECLARED-VALUES SIBLING WAS ALREADY THERE (`r0Parsed === r2Parsed`, in
 * the class, since 2026-07-31). This is its PIXEL half - the same distinction
 * `core/axes/polar.ts` draws in its own comment: *"The config's
 * `radialDistinctGuard` checks the two PIXELS are at distinct radii, which is a
 * different question and does not catch this."* Both halves now exist for both
 * types.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, CIRCULAR_CHART_RECORDER_AXES_CONFIG, checkGuards } from '../calibrationSession.js';
import { Calibration } from '../../core/calibration.js';
import { CircularChartRecorderAxes } from '../../core/axes/circularChartRecorder.js';

/** The chart circle: (T0,R2), (T1,R2) and (T2,R2) fit it, so its centre is
 *  (300,300) and its radius 200 by construction. */
const CHART_CENTRE = { x: 300, y: 300 };
const CHART_R = 200;
const onChart = (deg: number, r = CHART_R): [number, number] => [
  CHART_CENTRE.x + r * Math.cos((deg * Math.PI) / 180),
  CHART_CENTRE.y + r * Math.sin((deg * Math.PI) / 180),
];

/**
 * The five clicks, with (T0,R0) placed `r0Radius` from the fitted centre.
 *
 * ⚑ (T0,R1) is off both circles on purpose: it only has to make the PEN arc
 * curve, and a collinear trio is a different refusal this file is not about.
 */
function ccrClicks(r0Radius: number): Array<[number, number]> {
  return [
    onChart(150, r0Radius), // (T0,R0) - the low radial value
    [200, 470], // (T0,R1) - click-only, fits the pen arc
    onChart(90), // (T0,R2) - the high radial value, on the chart circle
    onChart(210), // (T1,R2)
    onChart(330), // (T2,R2)
  ];
}

function walk(clicks: Array<[number, number]>): CalibrationSession<CircularChartRecorderAxes> {
  const config = CIRCULAR_CHART_RECORDER_AXES_CONFIG;
  const session = new CalibrationSession(config);
  // Value fields, in walk order: (T0,R0) takes Time and R0; (T0,R2) takes R2.
  const values = [['0', '0'], [], ['100'], [], []];
  clicks.forEach(([px, py], i) => {
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues(values[i]!);
  });
  session.setGlobalFieldValue('startTime', '0');
  return session;
}

const REFUSAL =
  'The radial calibration points are the same distance from the origin - they must be at different radii, or the calibration has no radial scale.';

describe('a circular chart recorder needs two DIFFERENT radii', () => {
  it('⚑⚑ refuses two radial clicks equidistant from the FITTED chart centre', () => {
    // Both (T0,R0) and (T0,R2) sit exactly on the chart circle: 200px from the
    // centre the other three clicks fit. The values say 0 and 100, so the
    // declared-value guard in the class is perfectly satisfied.
    const session = walk(ccrClicks(CHART_R));
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toBe(REFUSAL);
  });

  it('⚠️ the healthy walk still calibrates - the guard must not over-reach', () => {
    // ⚑ THE COMPANION ASSERTION, and it is not a formality here: this is the
    // type whose obvious fix for R1 broke eight tests, one of them named this.
    const session = walk(ccrClicks(80));
    expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
    const axes = session.getAxes()!;
    const reading = axes.pixelToData(...onChart(150, 140));
    // Halfway between the two radii in pixels reads halfway between 0 and 100.
    expect(reading[1]).toBeCloseTo(50, 6);
  });

  it('⚑ names the symptom the refusal replaces, and the door the CLASS does not stand at', () => {
    // ⚠️ THE MEASUREMENT, kept so the refusal is never traded away as cosmetic.
    // ⚑⚑ The class itself still says TRUE to this, exactly as `PolarAxes` does
    // to its own equal-radii pixels - the pixel half of the rule lives in
    // `checkGuards`, which is what BOTH doors consult, and the class carries
    // only the DECLARED-value half. So the assertion is in two parts: the model
    // alone cannot see it, and the guard both doors run can.
    // ⚠️ My first draft of this mutated `cal.getPoint(0)` in place - and
    // `getPoint` returns a FRESH object, so the mutation went nowhere and the
    // test measured a healthy calibration. Build the degenerate calibration.
    const clicks = ccrClicks(CHART_R);
    const cal = new Calibration(2);
    clicks.forEach(([px, py], i) => {
      cal.addPoint(px, py, i === 0 ? '0' : '', i === 0 ? '0' : i === 2 ? '100' : '');
    });
    const axes = new CircularChartRecorderAxes();
    expect(axes.calibrate(cal, '0', 'week', 'anticlockwise')).toBe(true);
    // ⚑ NOT a dash. A number, of a magnitude no figure ever printed - and a
    // DIFFERENT one at each radius, so the column reads as data.
    const near = axes.pixelToData(...onChart(150, 140))[1]!;
    const far = axes.pixelToData(...onChart(120, 190))[1]!;
    expect(Math.abs(near)).toBeGreaterThan(1e12);
    expect(Math.abs(far)).toBeGreaterThan(1e12);
    expect(near).not.toBe(far);

    // ⚑ And the guard the file door runs DOES see it.
    const steps = new CalibrationSession(CIRCULAR_CHART_RECORDER_AXES_CONFIG).getSteps();
    expect(
      checkGuards(CIRCULAR_CHART_RECORDER_AXES_CONFIG, cal, { rotationTime: 'week', rotationDirection: 'anticlockwise' }, { startTime: '0' }, steps)
    ).toBe(REFUSAL);
  });
});
