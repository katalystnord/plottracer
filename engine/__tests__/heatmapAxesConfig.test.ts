import { describe, expect, it } from 'vitest';
import { CalibrationSession, HEATMAP_AXES_CONFIG, HEATMAP_KEY_POINTS } from '../calibrationSession.js';
import { XYAxes } from '../../core/axes/xy.js';
import { Calibration } from '../../core/calibration.js';

/**
 * The heatmap graph type's calibration (v2.2, phase 2).
 *
 * ⚑ WHAT IS BEING TESTED IS A WALK WITH EIGHT STEPS, four of which mean nothing
 * to the axes class underneath. x and y are an ordinary `XYAxes` — the same
 * reuse Histogram makes — and the last four clicks describe the COLOUR KEY: two
 * that say where its coloured strip runs, and two that say what a pair of
 * labelled positions on it are worth.
 *
 * ⚑ The strip and the scale are separate measurements on purpose (see the
 * config's own comment), so the risk this file exists to cover is an index
 * slipping: read the wrong click as a labelled tick and every value in the
 * figure is wrong by a constant, with nothing on screen to show it.
 */

/** The eight clicks, with the value each step collects (empty = none). */
const WALK: Array<[number, number, string[]]> = [
  [100, 300, ['0']], // x1
  [400, 300, ['10']], // x2
  [100, 300, ['0']], // y1
  [100, 100, ['20']], // y2
  [120, 420, []], // k1 — the strip's left end
  [380, 420, []], // k2 — its right end
  [150, 420, ['5']], // kv1 — a labelled tick
  [350, 420, ['95']], // kv2 — a second one
];

function walk(
  s: CalibrationSession<XYAxes>,
  steps: Array<[number, number, string[]]> = WALK
): void {
  for (const [px, py, values] of steps) {
    s.handleCalibrationClick(px, py);
    if (values.length > 0) s.confirmCalibrationValues(values);
  }
}

/** The same eight points as a Calibration, which is the LOAD path's entrance —
 * a project file hands one of these over without any clicking. */
function loadedCalibration(overrides: Partial<Record<number, [number, number, string]>> = {}): Calibration {
  const cal = new Calibration();
  WALK.forEach(([px, py, values], i) => {
    const override = overrides[i];
    const value = override ? override[2] : (values[0] ?? '');
    const x = override ? override[0] : px;
    const y = override ? override[1] : py;
    // x steps fill dx, everything else fills dy — matching the config's fields.
    if (i < 2) cal.addPoint(x, y, value, '');
    else cal.addPoint(x, y, '', value);
  });
  return cal;
}

describe('HEATMAP_AXES_CONFIG', () => {
  it('calibrates x and y through the same XYAxes the rest of the app uses', () => {
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    walk(s);
    expect(s.runCalibration()).toBe(true);
    const axes = s.getAxes()!;
    // x: 100px = 0, 400px = 10. y: 300px = 0, 100px = 20.
    expect(axes.pixelToData(250, 200)).toEqual([5, 10]);
  });

  it('asks for eight clicks, and the key’s two ENDS carry no number at all', () => {
    // ⚑ A click with nothing to type is not a wasted step: it is the difference
    // between RECORDING where the ramp is and inferring it from the numbers.
    // Six values are typed — four for the x/y frame, two for the key's scale —
    // and the two clicks that locate the strip itself are pure measurement.
    const steps = HEATMAP_AXES_CONFIG.fixedSteps;
    expect(steps.map((st) => st.key)).toEqual([
      'x1',
      'x2',
      'y1',
      'y2',
      'k1',
      'k2',
      'kv1',
      'kv2',
    ]);
    expect(steps.filter((st) => st.valueFields.length > 0)).toHaveLength(6);
    expect(steps[HEATMAP_KEY_POINTS.stripFrom]!.valueFields).toEqual([]);
    expect(steps[HEATMAP_KEY_POINTS.stripTo]!.valueFields).toEqual([]);
  });

  it('refuses two labelled ticks carrying the same value', () => {
    // Every cell in the figure would read that one number, and nothing on screen
    // would look wrong.
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    walk(s, WALK.map((step, i) => (i === 7 ? [step[0], step[1], ['5']] : step)));
    expect(s.runCalibration()).toBe(false);
    expect(s.getCalibrationError()).toMatch(/same value/i);
  });

  it('refuses a log colour scale whose labelled values are not positive', () => {
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    s.setOption('isLogValue', 'true');
    walk(s, WALK.map((step, i) => (i === 6 ? [step[0], step[1], ['0']] : step)));
    expect(s.runCalibration()).toBe(false);
    expect(s.getCalibrationError()).toMatch(/log colour scale/i);
  });

  it('accepts a log colour scale with positive values', () => {
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    s.setOption('isLogValue', 'true');
    walk(s);
    expect(s.runCalibration()).toBe(true);
  });

  it('refuses a key whose two ends are the same click', () => {
    // ⚑ THE MIS-CLICK WORTH CATCHING EARLY: clicking across the key's WIDTH
    // instead of along its length gives a strip of one flat colour, on which
    // every cell inverts to the same meaningless position. Here it is caught on
    // geometry alone, before any pixel has been read — the same rule
    // `sampleColorBar` applies later, called from one place.
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    walk(s, WALK.map((step, i) => (i === 5 ? [122, 421, []] : step)));
    expect(s.runCalibration()).toBe(false);
    expect(s.getCalibrationError()).toMatch(/colour key/i);
  });

  it('says WHY, naming the requirement and not just the fault', () => {
    // A refusal that only says "invalid" sends the user to fix something that is
    // not broken. Each of these has to name what to do instead.
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    walk(s, WALK.map((step, i) => (i === 5 ? [122, 421, []] : step)));
    s.runCalibration();
    expect(s.getCalibrationError()).toMatch(/along its length/i);
  });

  it('applies the identical refusals on the LOAD path, which does no clicking', () => {
    // ⚑ The door that has been unguarded four separate times in this project: a
    // project file calls the model directly and never walks a single step. The
    // check lives in `checkValues`, which runs on both entrances.
    const equalTicks = loadedCalibration({ 7: [350, 420, '5'] });
    expect(HEATMAP_AXES_CONFIG.checkValues!(equalTicks, { isLogValue: 'false' }, {})).toMatch(
      /same value/i
    );
    const shortStrip = loadedCalibration({ 5: [122, 421, ''] });
    expect(HEATMAP_AXES_CONFIG.checkValues!(shortStrip, { isLogValue: 'false' }, {})).toMatch(
      /colour key/i
    );
    const logNegative = loadedCalibration({ 6: [150, 420, '-5'] });
    expect(HEATMAP_AXES_CONFIG.checkValues!(logNegative, { isLogValue: 'true' }, {})).toMatch(
      /log colour scale/i
    );
    expect(HEATMAP_AXES_CONFIG.checkValues!(loadedCalibration(), { isLogValue: 'false' }, {})).toBeNull();
  });

  it('does not refuse a calibration that is merely unfinished', () => {
    // Half-typed is not wrong, and a walk in progress must not be told it is.
    const partial = new Calibration();
    partial.addPoint(100, 300, '0', '');
    expect(HEATMAP_AXES_CONFIG.checkValues!(partial, { isLogValue: 'false' }, {})).toBeNull();
  });

  it('builds its axes from the FIRST FOUR points only', () => {
    // ⚑ `XYAxes.calibrate` reads its four points BY INDEX. Handing it the whole
    // eight-point calibration would work by accident today and break silently
    // the moment a step is reordered, so the four are copied out explicitly —
    // and moving the key's clicks must not move the frame.
    const moved = loadedCalibration({ 4: [999, 999, ''], 5: [1200, 999, ''] });
    const built = HEATMAP_AXES_CONFIG.buildAxes(moved, {
      globalValues: {},
      options: {},
      imageHeight: 500,
    });
    expect('axes' in built).toBe(true);
    expect('axes' in built && built.axes.pixelToData(250, 200)).toEqual([5, 10]);
  });

  it('refuses to build when the x/y frame is incomplete', () => {
    const twoPoints = new Calibration();
    twoPoints.addPoint(100, 300, '0', '');
    twoPoints.addPoint(400, 300, '10', '');
    const built = HEATMAP_AXES_CONFIG.buildAxes(twoPoints, {
      globalValues: {},
      options: {},
      imageHeight: 500,
    });
    expect('axes' in built).toBe(false);
    expect('error' in built && built.error).toMatch(/incomplete/i);
  });

  it('is NOT in the graph-type list yet, and that is deliberate', () => {
    // ⚑ Capture is phase 3. A type in the picker that calibrates and then does
    // nothing is the keystone-persona failure this project is built to avoid, so
    // this assertion is a GATE: when phase 3 lands, it fails, and whoever
    // deletes it has to have read why it was here.
    expect(HEATMAP_AXES_CONFIG.autoExtractKind).toBe('none');
  });
});
