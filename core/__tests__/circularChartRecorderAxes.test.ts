import { describe, expect, it } from 'vitest';
import { CircularChartRecorderAxes } from '../axes/circularChartRecorder.js';
import { Calibration } from '../calibration.js';

/**
 * v2.0 pre-launch audit: `CircularChartRecorderAxes.calibrate()` performed NO
 * input validation at all and always returned `true` -- the only axes class
 * with zero test coverage before this file, despite being a live, shipped
 * graph type with a bundled sample figure. R0/R2 went through a bare
 * `Number()` (bypassing InputParser entirely, so non-numeric input silently
 * became `NaN`), and neither `ip.parse(t0)` nor `ip.parse(startTimeInput)`
 * ever checked `ip.isValid` -- so a blank "Chart Start Time" silently became
 * the Unix epoch via `new Date(null)`.
 *
 * A healthy calibration: pen circle through (200,150)/(150,100)/(100,150)
 * (centre (150,150), r=50), chart circle through (100,150)/(0,250)/(0,50)
 * (centre (0,150), r=100) -- cp2 is the shared rim point both circles fit
 * through, matching how the real 5-click capture works.
 */
function calibrateCcr(
  r0: string,
  r2: string,
  startTime: string,
  { t0 = '0' }: { t0?: string } = {}
): { ok: boolean; axes: CircularChartRecorderAxes } {
  const cal = new Calibration(2);
  cal.addPoint(200, 150, t0, r0);
  cal.addPoint(150, 100, '', '');
  cal.addPoint(100, 150, '', r2);
  cal.addPoint(0, 250, '', '');
  cal.addPoint(0, 50, '', '');
  const axes = new CircularChartRecorderAxes();
  const ok = axes.calibrate(cal, startTime, 'week', 'anticlockwise');
  return { ok, axes };
}

/**
 * ⚑⚑ A ROTATION PERIOD THIS AXIS DOES NOT KNOW (v2.3 audit, F13).
 *
 * `calibrate` sets `timeMax` and `tEnd` inside `if (week) ... else if (day)` and
 * there is no `else`. An unrecognised period leaves `timeMax` at its declared 0
 * and `tEnd` at its declared null - and then `pixelToData` computes
 * `(tEnd - tStart) * ... + tStart`, where `null - tStart` coerces to `-tStart`.
 * Every reading is a finite, plausible, WRONG timestamp, and `calibrate()`
 * reports success.
 *
 * ⚠️ NOTHING IS NON-FINITE, so no sanitiser anywhere can catch it. And it is
 * SELF-SUSTAINING: serialize writes `getRotationTime()` straight back out, so a
 * bad value survives re-calibrating and re-saving.
 *
 * ⚑ REACHABLE FROM A FILE. `core/plotData.ts` passes `axData.rotationTime`
 * through with a cast and no whitelist, and DISCARDS `calibrate()`'s verdict -
 * so the refusal has to live in the model, where `loadCalibrated`'s own
 * `isCalibrated()` check will still see it.
 */
function calibrateWithPeriod(rotationTime: string): { ok: boolean; axes: CircularChartRecorderAxes } {
  const cal = new Calibration(2);
  cal.addPoint(200, 150, '0', '0');
  cal.addPoint(150, 100, '', '');
  cal.addPoint(100, 150, '', '100');
  cal.addPoint(0, 250, '', '');
  cal.addPoint(0, 50, '', '');
  const axes = new CircularChartRecorderAxes();
  const ok = axes.calibrate(cal, '0', rotationTime as 'week' | 'day', 'anticlockwise');
  return { ok, axes };
}

describe('a rotation period this axis does not know', () => {
  it('⚑⚑ is refused, rather than calibrating into wrong timestamps', () => {
    for (const period of ['month', 'hour', '', 'WEEK']) {
      const { ok, axes } = calibrateWithPeriod(period);
      expect(ok, `"${period}" must be refused`).toBe(false);
      expect(axes.isCalibrated(), `"${period}" must not report calibrated`).toBe(false);
    }
  });

  it('⚑ both periods this axis DOES know still calibrate - no over-reach', () => {
    for (const period of ['week', 'day']) {
      expect(calibrateWithPeriod(period).ok, period).toBe(true);
    }
  });
});

describe('CircularChartRecorderAxes.calibrate refuses invalid input instead of succeeding silently', () => {
  it('refuses a non-numeric R0', () => {
    const { ok, axes } = calibrateCcr('abc', '100', '0');
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a non-numeric R2', () => {
    const { ok, axes } = calibrateCcr('0', 'xyz', '0');
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a blank Chart Start Time instead of silently becoming the Unix epoch', () => {
    const { ok, axes } = calibrateCcr('0', '100', '');
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a non-numeric, non-date Chart Start Time', () => {
    const { ok, axes } = calibrateCcr('0', '100', 'abc');
    expect(ok).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses a thousands separator in R0 -- the whole-string rule, like every other axes type', () => {
    const { ok } = calibrateCcr('1,000', '2000', '0');
    expect(ok).toBe(false);
  });

  it('isCalibrated() reflects real state, not a hardcoded false, once calibration succeeds', () => {
    const { ok, axes } = calibrateCcr('0', '100', '0');
    expect(ok).toBe(true);
    expect(axes.isCalibrated()).toBe(true);
  });

  it('isCalibrated() stays false before any calibrate() call', () => {
    const axes = new CircularChartRecorderAxes();
    expect(axes.isCalibrated()).toBe(false);
  });

  it('refuses fewer than 5 calibration points rather than indexing an out-of-range getPoint() into a crash (v2.0 audit)', () => {
    const short = new Calibration(2);
    short.addPoint(200, 150, '0', '0');
    short.addPoint(150, 100, '', '');
    const axes = new CircularChartRecorderAxes();
    expect(axes.calibrate(short, '0', 'week', 'anticlockwise')).toBe(false);
    expect(axes.isCalibrated()).toBe(false);
    expect(new CircularChartRecorderAxes().calibrate(new Calibration(2), '0', 'week', 'anticlockwise')).toBe(false);
  });

  /**
   * ⚑ EACH REFUSAL IS AN `||`, AND THE MUTATION RUN TURNED EVERY ONE INTO `&&`
   * WITHOUT A SINGLE TEST NOTICING. `!ip.isValid || typeof v !== 'number'`
   * mutated to `&&` still refuses plain garbage (both halves true), so the
   * "abc" cases above cannot tell the two apart. An ARRAY separates them: it
   * parses VALIDLY (isValid true) to a number[], so only the second half is
   * true - with `||` it is refused, with `&&` it sails through and the axes
   * calibrates around an array, reading back nonsense.
   */
  it('refuses an ARRAY value, which parses validly but is not a number', () => {
    expect(calibrateCcr('[1,2]', '100', '0').ok).toBe(false); // R0
    expect(calibrateCcr('0', '[1,2]', '0').ok).toBe(false); // R2
    expect(calibrateCcr('0', '100', '[1,2]').ok).toBe(false); // Chart Start Time
    // ...and the first point's Time value, on the same rule.
    expect(calibrateCcr('0', '100', '0', { t0: '[1,2]' }).ok).toBe(false);
  });
});

/**
 * The rotation period - how long one full turn of the chart paper is.
 *
 * ⚑ NOTHING HAD EVER CALIBRATED A 'day' CHART. The whole `rotationTime ===
 * 'day'` branch was NO-COVERAGE: its two `setHours(getHours() + 24)` calls
 * could become `setMinutes(...)` or `- 24` with the suite green. And the
 * 'week' branch, though reached, had its `setDate(getDate() + 7)` mutable to
 * `setTime(...)` or `- 7` unnoticed, because no test ever asserted the
 * resulting span. The span IS the scale every time reading is divided by
 * (`thetaStartOffset`, and `tEnd - tStart` in pixelToData), so getting it
 * wrong silently rescales every timestamp the chart reports.
 *
 * These assert the span in milliseconds against the fixture's own start date,
 * which is arithmetic anyone can check: 7 days and 24 hours.
 */
describe('CircularChartRecorderAxes - the rotation period sets the time scale', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function calibrateWithPeriod(rotationTime: 'week' | 'day') {
    const cal = new Calibration(2);
    cal.addPoint(200, 150, '2024/01/01 00:00', '0');
    cal.addPoint(150, 100, '', '');
    cal.addPoint(100, 150, '', '100');
    cal.addPoint(0, 250, '', '');
    cal.addPoint(0, 50, '', '');
    const axes = new CircularChartRecorderAxes();
    expect(axes.calibrate(cal, '2024/01/01 00:00', rotationTime, 'anticlockwise')).toBe(true);
    return axes;
  }

  it('a WEEK chart spans exactly seven days from its start', () => {
    const axes = calibrateWithPeriod('week');
    expect(axes.timeMax - axes.time0).toBe(7 * DAY_MS);
    expect(axes.tEnd! - axes.tStart!).toBe(7 * DAY_MS);
  });

  it('a DAY chart spans exactly twenty-four hours - a seventh of the week chart', () => {
    const axes = calibrateWithPeriod('day');
    expect(axes.timeMax - axes.time0).toBe(DAY_MS);
    expect(axes.tEnd! - axes.tStart!).toBe(DAY_MS);
    // Stated as a RELATIONSHIP too, so a change that rescaled both branches
    // together could not slip through either.
    expect(calibrateWithPeriod('week').timeMax - axes.time0).toBe(7 * (axes.timeMax - axes.time0));
  });

  it('reports back the period and direction it was calibrated with', () => {
    expect(calibrateWithPeriod('day').getRotationTime()).toBe('day');
    expect(calibrateWithPeriod('week').getRotationTime()).toBe('week');
    expect(calibrateWithPeriod('week').getRotationDirection()).toBe('anticlockwise');
  });
});

/**
 * What the axes tells the REST of the app about itself. Every method below was
 * NO-COVERAGE: each could have returned a constant, or nothing, unnoticed -
 * yet they decide how the time column is formatted on screen and in every
 * export, and how many clicks the calibration walk asks for.
 */
describe('CircularChartRecorderAxes - the contract it exposes', () => {
  function calibratedWithDate() {
    const cal = new Calibration(2);
    cal.addPoint(200, 150, '2024/01/01 00:00', '0');
    cal.addPoint(150, 100, '', '');
    cal.addPoint(100, 150, '', '100');
    cal.addPoint(0, 250, '', '');
    cal.addPoint(0, 50, '', '');
    const axes = new CircularChartRecorderAxes();
    expect(axes.calibrate(cal, '2024/06/15 12:30', 'week', 'anticlockwise')).toBe(true);
    return axes;
  }

  it('COLUMN 0 IS THE DATE COLUMN, and no other column is', () => {
    // ⚑ `col === 0` mutated to `col !== 0` in BOTH isDate and
    // getInitialDateFormat and survived - nothing asked either question. They
    // are what makes the Time column render as a date rather than a raw
    // millisecond count, on screen and in the file alike.
    const axes = calibratedWithDate();
    expect(axes.isDate(0)).toBe(true);
    expect(axes.isDate(1)).toBe(false);
    expect(axes.getInitialDateFormat(0)).toBe(axes.getTimeFormat());
    expect(axes.getInitialDateFormat(0)).not.toBeNull();
    expect(axes.getInitialDateFormat(1)).toBeNull();
  });

  it('reads its start time back as a formatted date, not the raw number', () => {
    const started = calibratedWithDate().getStartTime();
    expect(started).not.toBeNull();
    // The fixture's own start time, round-tripped through the format the
    // calibration inferred from the FIRST POINT's date.
    expect(Number.isNaN(new Date(started!).getTime())).toBe(false);
    expect(started).toContain('2024');
  });

  it('reports the start time it was GIVEN when calibrated from plain numbers', () => {
    // ⚑ THIS TEST USED TO ASSERT `getStartTime()` IS NULL HERE, with the
    // reasoning "no date anywhere means no format to render one with; a
    // fabricated timestamp would be the invention tenet 9 forbids". The premise
    // was sound and the conclusion was the defect: returning the string the user
    // actually TYPED is the opposite of a fabrication -- it is the recorded
    // value, unrendered. Returning null meant the writer stored
    // `startTime: null` and the reader handed that to `calibrate`, which refuses
    // it, so a numeric chart recorder reopened uncalibrated with every reading
    // gone. See plotDataAxesRoundTrip.test.ts for the round trip itself.
    const { axes, ok } = calibrateCcr('0', '100', '0');
    expect(ok).toBe(true);
    expect(axes.getTimeFormat()).toBeNull(); // still no DATE format -- unchanged
    expect(axes.getStartTime()).toBe('0');
  });

  it('asks for five calibration clicks and reports two data dimensions', () => {
    const axes = new CircularChartRecorderAxes();
    expect(axes.numCalibrationPointsRequired()).toBe(5);
    expect(axes.getDimensions()).toBe(2);
  });

  it('labels its two columns Time and Magnitude, in that order', () => {
    // Pinned because these exact strings are the export headers AND the
    // on-screen table headers; a silent reorder would mislabel every file.
    expect(new CircularChartRecorderAxes().getAxesLabels()).toEqual(['Time', 'Magnitude']);
  });

  it('names itself Circular Chart', () => {
    expect(new CircularChartRecorderAxes().name).toBe('Circular Chart');
  });

  it('COPIES its metadata rather than aliasing the caller s object', () => {
    // Same contract every other axes class holds: a caller mutating what it
    // passed in, or what it got back, must not reach into the axes.
    const axes = new CircularChartRecorderAxes();
    const stored = { note: 'original' };
    axes.setMetadata(stored);
    stored.note = 'mutated after the fact';
    expect(axes.getMetadata()).toEqual({ note: 'original' });

    const readBack = axes.getMetadata() as { note: string };
    readBack.note = 'mutated on the way out';
    expect(axes.getMetadata()).toEqual({ note: 'original' });
  });

  it('ships the unimplemented dataToPixel stub, so implementing it must be deliberate', () => {
    expect(calibratedWithDate().dataToPixel(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('says so plainly when asked for a live readout it cannot format', () => {
    // pixelToLiveString's own refusal branch: with no date format there is no
    // honest way to render the time half, and it says "calibration error!"
    // rather than printing a bare millisecond count as if it were a time.
    const { axes } = calibrateCcr('0', '100', '0');
    expect(axes.pixelToLiveString(150, 150)).toBe('calibration error!');
    // ...and with a real date it returns both halves, comma-separated.
    expect(calibratedWithDate().pixelToLiveString(150, 160)).toContain(',');
  });
});

/**
 * ⚑⚑ THE READING ITSELF - the arithmetic that turns a click into (time,
 * magnitude), and which NOTHING HAS EVER CHECKED.
 *
 * The 2026-07-31 mutation run left ~30 survivors concentrated in
 * `pixelToData` and the calibration geometry feeding it: the law-of-cosines
 * term, the radial interpolation, the angle-to-time scaling and the
 * clockwise/anticlockwise branch could each have an operator flipped with the
 * whole suite green. The existing tests only ever asserted
 * `Number.isFinite(time)`, and the e2e says outright that exact verification
 * is "core/__tests__/crossCheck.test.ts's job" - **a file that has never
 * existed in this repo.** So the maths of a live, shipped graph type was
 * pinned by nothing at all.
 *
 * THE FIXTURE, chosen so every expected number is derivable by hand rather
 * than recorded from a run (the standing rule: derive or measure, never
 * invent - these were derived first, then confirmed against the
 * implementation before being written down):
 *
 *   (T0,R0) (200,150) value 0      (T0,R1) (150,100)      (T0,R2) (100,150) value 100
 *   (T1,R2) (0,250)                (T2,R2) (0,50)
 *
 *   pen circle   through the three (T0,*) points -> centre (150,150), r = 50
 *   chart circle through the three (*,R2) points -> centre (0,150),   r = 100
 *   so chart-to-pen distance = 150, rMinPx = 200, rMaxPx = 100, thetac0 = 0
 *
 * The radial scale is therefore linear from r=0 at 200px to r=100 at 100px,
 * i.e. **r = 200 - rPx**. And because (T0,R0) and (T0,R2) sit on the SAME pen
 * arc, they are the same instant - which is the physical invariant the whole
 * mechanism rests on, and the sharpest test available here.
 */
describe('CircularChartRecorderAxes - the reading, against hand-derived ground truth', () => {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  function chart(startTime = '2024/01/01 00:00', direction: 'anticlockwise' | 'clockwise' = 'anticlockwise') {
    const cal = new Calibration(2);
    cal.addPoint(200, 150, '2024/01/01 00:00', '0'); // (T0,R0)
    cal.addPoint(150, 100, '', ''); // (T0,R1)
    cal.addPoint(100, 150, '', '100'); // (T0,R2)
    cal.addPoint(0, 250, '', ''); // (T1,R2)
    cal.addPoint(0, 50, '', ''); // (T2,R2)
    const axes = new CircularChartRecorderAxes();
    expect(axes.calibrate(cal, startTime, 'week', direction)).toBe(true);
    return axes;
  }

  /** Where in the rotation a reading falls, as a fraction of one full turn. */
  function turnFraction(axes: CircularChartRecorderAxes, px: number, py: number): number {
    return (axes.pixelToData(px, py)[0]! - axes.tStart!) / WEEK_MS;
  }

  it('fits BOTH circles from the five clicks, exactly as the geometry dictates', () => {
    // The two circle fits are the foundation every later number stands on;
    // an error here is invisible downstream but poisons every reading.
    const axes = chart();
    expect(axes.xChart).toBeCloseTo(0, 9);
    expect(axes.yChart).toBeCloseTo(150, 9);
    expect(axes.xPen).toBeCloseTo(150, 9);
    expect(axes.yPen).toBeCloseTo(150, 9);
    expect(axes.rPen).toBeCloseTo(50, 9);
    expect(axes.chartToPenDist).toBeCloseTo(150, 9);
    expect(axes.rMinPx).toBeCloseTo(200, 9);
    expect(axes.rMaxPx).toBeCloseTo(100, 9);
  });

  it('reproduces its own two declared radial values at their own pixels', () => {
    // The most basic obligation of any calibration, and nothing asserted it.
    const axes = chart();
    expect(axes.pixelToData(200, 150)[1]).toBeCloseTo(0, 9); // R0 as declared
    expect(axes.pixelToData(100, 150)[1]).toBeCloseTo(100, 9); // R2 as declared
  });

  it('interpolates the radial scale LINEARLY between them - r = 200 - rPx', () => {
    // ⚑ Pins the radial arithmetic, whose every operator survived mutation.
    // 150px from the chart centre is halfway, so it must read 50.
    const axes = chart();
    expect(axes.pixelToData(150, 150)[1]).toBeCloseTo(50, 9);
    expect(axes.pixelToData(50, 150)[1]).toBeCloseTo(150, 9); // extrapolates past R2
    expect(axes.pixelToData(0, 250)[1]).toBeCloseTo(100, 9); // on the chart circle
  });

  it('⚑ reads the two ends of ONE pen arc as the SAME instant - the mechanism s whole premise', () => {
    // (T0,R0) and (T0,R2) are the same time by construction: a pen arc IS a
    // line of constant time. Any error in the law-of-cosines term or in
    // thetac0 makes them disagree, because their distances from the chart
    // centre differ (200px vs 100px) so a broken alpha diverges between them.
    const axes = chart();
    expect(turnFraction(axes, 200, 150)).toBeCloseTo(0, 9);
    expect(turnFraction(axes, 100, 150)).toBeCloseTo(0, 9);
    expect(axes.pixelToData(200, 150)[0]).toBeCloseTo(axes.pixelToData(100, 150)[0]!, 6);
    // ...and that shared instant is the chart's own start time.
    expect(axes.pixelToData(200, 150)[0]).toBeCloseTo(axes.tStart!, 6);
  });

  it('maps a quarter-turn of paper to a quarter of the rotation period', () => {
    // (T1,R2) at (0,250) is 90 deg round the chart circle from thetac0=0, so
    // a WEEK chart must read a quarter of a week later: exactly 1.75 days.
    const axes = chart();
    expect(turnFraction(axes, 0, 250)).toBeCloseTo(0.25, 9);
    expect(axes.pixelToData(0, 250)[0]! - axes.tStart!).toBeCloseTo(1.75 * 24 * 3600 * 1000, 3);
  });

  it('maps a three-quarter turn likewise, so the scaling holds right round', () => {
    // (T2,R2) at (0,50) is 270 deg round. Two points at different angles are
    // what pin the angle->time SCALE rather than just its zero.
    const axes = chart();
    expect(turnFraction(axes, 0, 50)).toBeCloseTo(0.75, 9);
    expect(axes.pixelToData(0, 50)[0]! - axes.tStart!).toBeCloseTo(5.25 * 24 * 3600 * 1000, 3);
  });

  it('a CLOCKWISE chart mirrors the same paper into the opposite times', () => {
    // ⚑ The direction branch could be inverted, or collapsed to one arm, with
    // nothing noticing. Asserted as the MIRROR RELATIONSHIP (a quarter turn
    // one way is three quarters the other) so it stays true if the fixture
    // moves, and so an implementation that simply ignored direction fails.
    const cw = chart('2024/01/01 00:00', 'clockwise');
    expect(turnFraction(cw, 0, 250)).toBeCloseTo(0.75, 9);
    expect(turnFraction(cw, 0, 50)).toBeCloseTo(0.25, 9);
    // The start point is unmoved by direction; only the sweep reverses.
    expect(turnFraction(cw, 200, 150)).toBeCloseTo(0, 9);
    const acw = chart();
    expect(turnFraction(cw, 0, 250)).toBeCloseTo(1 - turnFraction(acw, 0, 250), 9);
  });

  it('shifts every reading when the chart STARTED at a different time than its first point', () => {
    // ⚑ thetaStartOffset -- 360*(tStart-time0)/(timeMax-time0) -- had every
    // operator survive. A start time 1.75 days after the first point's own
    // time is a quarter of the week, so the offset is exactly 90 degrees and
    // every reading rotates back by a quarter turn.
    const off = chart('2024/01/02 18:00');
    expect(off.thetaStartOffset).toBeCloseTo(90, 9);
    // The pen-arc point, previously at 0, now sits three quarters round.
    expect(turnFraction(off, 200, 150)).toBeCloseTo(0.75, 9);
    // ...and the quarter-turn point lands exactly on the new start.
    expect(turnFraction(off, 0, 250)).toBeCloseTo(0, 9);
  });

  it('leaves thetaStartOffset at zero when the chart started at its first point s time', () => {
    expect(chart().thetaStartOffset).toBeCloseTo(0, 9);
  });
});

/**
 * ⚑ THREE COLLINEAR CLICKS DESCRIBE NO CIRCLE - round-2 audit.
 *
 * Both arcs are fitted from exactly three points, and the prompts invite a
 * straight line: "a point on the pen's time axis", "a second point on the same
 * time axis", "a third point on the same time axis". Unguarded, the fit
 * returned nulls, `calibrate()` returned true anyway, and readings came back
 * NaN beside plausible finite numbers.
 */
describe('a chart recorder needs two real ARCS, not two straight lines', () => {
  function calibrateWith(pts: Array<[number, number]>): boolean {
    const cal = new Calibration(2);
    // Only three of the five clicks carry a typed value: (T0,R0) takes the
    // chart's time-0 and R0, and (T0,R2) takes R2. The other two are pixels
    // on the chart circle only.
    const values: Array<[string, string]> = [
      ['2024/01/01', '0'],
      ['', ''],
      ['', '100'],
      ['', ''],
      ['', ''],
    ];
    pts.forEach(([px, py], i) => cal.addPoint(px, py, values[i]![0], values[i]![1]));
    const axes = new CircularChartRecorderAxes();
    return axes.calibrate(cal, '2024/01/01', 'week', 'anticlockwise');
  }

  it('⚑ refuses a COLLINEAR pen arc rather than reading NaN', () => {
    // All three of the pen's points on one vertical line.
    expect(
      calibrateWith([
        [300, 300],
        [300, 240],
        [300, 180],
        [300, 50],
        [550, 300],
      ])
    ).toBe(false);
  });

  it('refuses a collinear CHART arc too', () => {
    expect(
      calibrateWith([
        [250, 300],
        [150, 200],
        [50, 300],
        [150, 300],
        [250, 300],
      ])
    ).toBe(false);
  });

  it('accepts two genuinely curved arcs - the guard must not refuse a real chart', () => {
    expect(
      calibrateWith([
        [250, 300],
        [150, 200],
        [50, 300],
        [300, 50],
        [550, 300],
      ])
    ).toBe(true);
  });
});
