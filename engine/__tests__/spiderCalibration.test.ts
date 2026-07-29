import { describe, expect, it } from 'vitest';
import { CalibrationSession, SPIDER_AXES_CONFIG, XY_AXES_CONFIG } from '../calibrationSession.js';
import { SpiderAxes } from '../../core/axes/spider.js';
import { Calibration } from '../../core/calibration.js';
import { Dataset } from '../../core/dataset.js';

/**
 * The variable-length calibration (v1.4, Spider) — the one genuinely new mechanism
 * in the version.
 *
 * ⚑ Every axes type before this declared a FIXED `steps` array (XY 4, Bar 2, Polar
 * 3, Ternary 3, CCR 5), and ~10 sites read `config.steps` directly. The step list is
 * now a property of the SESSION, and the danger is precisely that a missed
 * `config.steps` read keeps working on all eight fixed-shape types while silently
 * seeing one step on a spider — reporting a complete calibration with no axes placed.
 * So these tests exercise the step list through the session, on both entrances.
 */

/** A spider figure: centre at (100,100) and `n` spokes at 100px, going clockwise. */
function spokePixel(i: number, n: number): [number, number] {
  const angle = (2 * Math.PI * i) / n;
  return [100 + 100 * Math.sin(angle), 100 - 100 * Math.cos(angle)];
}

/** Walk the whole click path: centre, then each spoke's pixel + value + name. */
function walkSpider(
  session: CalibrationSession<SpiderAxes>,
  values: string[],
  names: string[],
  centre = '0'
): boolean {
  const n = values.length;
  while (session.getRepeatCount() < n) expect(session.addRepeat()).toBe(true);

  expect(session.handleCalibrationClick(100, 100)).toBe('awaiting-value');
  expect(session.confirmCalibrationValues([centre])).toBe(true);
  for (let i = 0; i < n; i++) {
    const [px, py] = spokePixel(i, n);
    expect(session.handleCalibrationClick(px, py)).toBe('awaiting-value');
    expect(session.confirmCalibrationValues([values[i]!, names[i]!])).toBe(true);
  }
  return session.runCalibration();
}

function newSpider(): CalibrationSession<SpiderAxes> {
  return new CalibrationSession(SPIDER_AXES_CONFIG);
}

describe('the step list is variable, and comes from the session', () => {
  it('starts at the centre plus the minimum number of axes', () => {
    const session = newSpider();
    expect(session.getRepeatCount()).toBe(3);
    expect(session.getSteps().map((s) => s.key)).toEqual(['origin', 'spoke1', 'spoke2', 'spoke3']);
  });

  it('numbers each repeat in its label, its prompt and its value-field keys', () => {
    // The '#' placeholder is what makes one template step read as "Axis 2" on screen.
    const steps = newSpider().getSteps();
    expect(steps[2]!.label).toBe('Axis 2');
    expect(steps[2]!.prompt).toContain('axis 2');
    expect(steps[2]!.valueFields.map((f) => f.key)).toEqual(['value2', 'name2']);
  });

  it('grows with addRepeat — a figure with nine axes is not a special case', () => {
    const session = newSpider();
    for (let i = 0; i < 6; i++) expect(session.addRepeat()).toBe(true);
    expect(session.getRepeatCount()).toBe(9);
    expect(session.getSteps()).toHaveLength(10);
  });

  it('shrinks with removeRepeat, dropping what was placed for the axis it removed', () => {
    const session = newSpider();
    session.addRepeat();
    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues(['0']);
    for (let i = 0; i < 4; i++) {
      const [px, py] = spokePixel(i, 4);
      session.handleCalibrationClick(px, py);
      session.confirmCalibrationValues(['10', `A${i}`]);
    }
    expect(Object.keys(session.getPlacedPoints())).toContain('spoke4');

    expect(session.removeRepeat()).toBe(true);
    // ⚑ Leaving the placed point behind would keep a handle on screen for an axis
    // the calibration no longer has, and re-adding the axis would silently inherit
    // the old pixel and value.
    expect(Object.keys(session.getPlacedPoints())).not.toContain('spoke4');
    expect(session.getSteps()).toHaveLength(4);
  });

  it('refuses to shrink below the minimum a spider needs', () => {
    const session = newSpider();
    expect(session.removeRepeat()).toBe(false);
    expect(session.getRepeatCount()).toBe(3);
  });

  it('clamps the step cursor when the list shrinks underneath it', () => {
    // Place ALL four axes, so the cursor is sitting one past the end, then drop one.
    // Unclamped the cursor stays at 5 against a 4-step list, and the card's progress
    // line reads "step 6 of 5" — a count of steps that do not exist.
    const session = newSpider();
    session.addRepeat();
    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues(['0']);
    for (let i = 0; i < 4; i++) {
      const [px, py] = spokePixel(i, 4);
      session.handleCalibrationClick(px, py);
      session.confirmCalibrationValues(['10', `A${i}`]);
    }
    expect(session.getStepIndex()).toBe(5);

    expect(session.removeRepeat()).toBe(true);
    expect(session.getSteps()).toHaveLength(4);
    expect(session.getStepIndex()).toBe(4);
    expect(session.getCurrentStep()).toBeNull();
  });

  it('returns to the starting count on reset', () => {
    const session = newSpider();
    session.addRepeat();
    session.addRepeat();
    session.reset();
    expect(session.getRepeatCount()).toBe(3);
    expect(session.getSteps()).toHaveLength(4);
  });

  it('leaves every fixed-shape type exactly as it was', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    expect(session.getRepeatCount()).toBe(0);
    expect(session.getSteps()).toBe(XY_AXES_CONFIG.fixedSteps);
    expect(session.addRepeat()).toBe(false);
    expect(session.removeRepeat()).toBe(false);
  });
});

describe('undo carries the spoke count', () => {
  /** Place the centre and all `n` spokes of an n-axis spider. */
  function placeAll(session: CalibrationSession<SpiderAxes>, n: number): void {
    while (session.getRepeatCount() < n) expect(session.addRepeat()).toBe(true);
    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues(['0']);
    for (let i = 0; i < n; i++) {
      const [px, py] = spokePixel(i, n);
      session.handleCalibrationClick(px, py);
      session.confirmCalibrationValues(['10', `A${i}`]);
    }
  }

  // ⚑ THE SPOKE COUNT IS DOCUMENT STATE, and the snapshot is its only entrance
  // that does not derive it: loadCalibrated reads it back off the file's own
  // calibration length and reset() returns it to the minimum, but restoreState
  // used to leave `repeatCount` untouched. Both rail buttons commit an undo
  // entry (Workspace.tsx "+ axis" / "− axis"), so every one of these was a
  // committed action that undo could not actually undo.

  it('undoes an added axis', () => {
    const session = newSpider();
    const before = session.captureState();
    expect(session.addRepeat()).toBe(true);

    session.restoreState(before);
    // Without this, the card keeps reading "4 axes" after an undo of the click
    // that made it 4 — the action is on the stack and pressing undo does nothing.
    expect(session.getRepeatCount()).toBe(3);
    expect(session.getSteps().map((s) => s.key)).toEqual(['origin', 'spoke1', 'spoke2', 'spoke3']);
  });

  it('undoes a removed axis, bringing back the step it was placed on', () => {
    const session = newSpider();
    placeAll(session, 4);
    const before = session.captureState();
    expect(session.removeRepeat()).toBe(true);

    session.restoreState(before);
    expect(session.getRepeatCount()).toBe(4);
    // ⚑ The placed points came back either way — `placed` IS in the snapshot. What
    // was missing was the step list to hang them on, so spoke4 was left an ORPHAN:
    // a placed calibration point no step referenced, invisible to the calibration
    // and silently inherited by the next "+ axis". The invariant is that the two
    // agree.
    const stepKeys = session.getSteps().map((s) => s.key);
    expect(Object.keys(session.getPlacedPoints()).sort()).toEqual([...stepKeys].sort());
    // And the cursor lands on a step that exists, rather than one past a shorter list.
    expect(session.getStepIndex()).toBe(5);
    expect(session.getSteps()).toHaveLength(5);
  });

  it('redoes a removed axis, dropping its placement again', () => {
    const session = newSpider();
    placeAll(session, 4);
    const before = session.captureState();
    expect(session.removeRepeat()).toBe(true);
    const after = session.captureState();

    session.restoreState(before); // undo
    session.restoreState(after); // redo
    expect(session.getRepeatCount()).toBe(3);
    expect(Object.keys(session.getPlacedPoints())).not.toContain('spoke4');
    expect(session.getSteps()).toHaveLength(4);
  });

  it('leaves a fixed-shape type at zero repeats through a restore', () => {
    const session = new CalibrationSession(XY_AXES_CONFIG);
    session.restoreState(session.captureState());
    expect(session.getRepeatCount()).toBe(0);
    expect(session.getSteps()).toBe(XY_AXES_CONFIG.fixedSteps);
  });
});

describe('calibrating a spider through the click path', () => {
  it('builds a SpiderAxes with one spoke per placed axis', () => {
    const session = newSpider();
    expect(walkSpider(session, ['100', '50', '10'], ['Strength', 'Weight', 'Cost'])).toBe(true);

    const axes = session.getAxes()!;
    expect(axes).toBeInstanceOf(SpiderAxes);
    expect(axes.getSpokeCount()).toBe(3);
    expect(axes.getSpokes().map((s) => s.name)).toEqual(['Strength', 'Weight', 'Cost']);
    expect(axes.getSpokes().map((s) => s.knownValue)).toEqual([100, 50, 10]);
  });

  it('refuses to calibrate while any axis is still unplaced', () => {
    const session = newSpider();
    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues(['0']);
    const [px, py] = spokePixel(0, 3);
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues(['10', 'A']);
    expect(session.runCalibration()).toBe(false);
    expect(session.getAxes()).toBeNull();
  });

  it('records the name as typed, and an unnamed axis as unnamed', () => {
    // The name is the one transcribed field; blank must stay blank rather than
    // becoming "0" (the default every numeric slot gets).
    const session = newSpider();
    expect(walkSpider(session, ['10', '10', '10'], ['A', '', 'C'])).toBe(true);
    expect(session.getAxes()!.getSpokes().map((s) => s.name)).toEqual(['A', '', 'C']);
    expect(session.getAxes()!.getSpokeLabel(1)).toBe('Axis 2');
  });

  it('asks for the centre value ONCE and stores it on EVERY axis', () => {
    // ⚑ The storage rule: the simplification lives in the workflow, not the record.
    // A per-axis override later is then a UI change with no migration.
    const session = newSpider();
    expect(walkSpider(session, ['100', '50', '10'], ['A', 'B', 'C'], '20')).toBe(true);
    expect(session.getAxes()!.getSpokes().map((s) => s.centreValue)).toEqual([20, 20, 20]);

    // And in the CALIBRATION itself, which is what gets written to the file.
    const cal = session.getAxes()!.calibration!;
    for (let i = 1; i < cal.getCount(); i++) expect(cal.getPoint(i)!.dy).toBe('20');
    // The centre point carries the value AS ENTERED — it is asked for on the centre
    // click now, like every other value (David, 2026-07-27). The per-spoke copies
    // above are what a reader uses, and are what a future per-axis override would
    // change; this one records what the user typed.
    expect(cal.getPoint(0)!.dy).toBe('20');
  });

  it('refuses a centre equal to an axis value, with an error that says why', () => {
    const session = newSpider();
    expect(walkSpider(session, ['20', '50', '10'], ['A', 'B', 'C'], '20')).toBe(false);
    expect(session.getCalibrationError()).toContain('different from the centre');
  });

  it('refuses a log spider through zero, and says so in log terms', () => {
    // The 0-preselected centre makes this reachable on the very first try.
    const session = newSpider();
    session.setOption('isLogRadial', 'true');
    expect(walkSpider(session, ['100', '50', '10'], ['A', 'B', 'C'], '0')).toBe(false);
    expect(session.getCalibrationError()).toContain('positive');

    const ok = newSpider();
    ok.setOption('isLogRadial', 'true');
    expect(walkSpider(ok, ['100', '50', '10'], ['A', 'B', 'C'], '1')).toBe(true);
    expect(ok.getAxes()!.isLog()).toBe(true);
  });

  it('offers no pixel-reuse buttons — a spider has nothing to reuse', () => {
    const session = newSpider();
    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues(['0']);
    const [px, py] = spokePixel(0, 3);
    session.handleCalibrationClick(px, py);
    session.confirmCalibrationValues(['10', 'A']);
    // Reuse exists for the shared-corner case. A spider's centre is shared by
    // construction, and two spokes on one pixel would be two axes recorded as
    // pointing the same way.
    expect(session.getReusableSteps()).toEqual([]);
  });

  it('draws a preview ray from the centre to each placed axis', () => {
    // A ray's DIRECTION comes from one click, so a spoke placed slightly off the
    // printed axis moves every value along it with nothing on screen wrong.
    const session = newSpider();
    session.handleCalibrationClick(100, 100);
    session.confirmCalibrationValues(['0']);
    expect(session.getCalibrationPreview().segments).toHaveLength(0);

    for (let i = 0; i < 3; i++) {
      const [px, py] = spokePixel(i, 3);
      session.handleCalibrationClick(px, py);
      session.confirmCalibrationValues(['10', `A${i}`]);
      expect(session.getCalibrationPreview().segments).toHaveLength(i + 1);
    }
    const [first] = session.getCalibrationPreview().segments;
    expect(first!.from).toEqual({ x: 100, y: 100 });
  });
});

describe('the OTHER entrance — loading an already-calibrated spider', () => {
  /** A spider built outside any session, as deserializing a project file gives it. */
  function loadedSpider(n: number): SpiderAxes {
    const cal = new Calibration(3);
    cal.addPoint(100, 100, '0', '0', '');
    for (let i = 0; i < n; i++) {
      const [px, py] = spokePixel(i, n);
      cal.addPoint(px, py, '10', '2', `A${i}`);
    }
    const axes = new SpiderAxes();
    expect(axes.calibrate(cal, false)).toBe(true);
    return axes;
  }

  it('takes the axis count from the FILE, not from the session default', () => {
    // ⚑ The regression this whole test file exists for. A fresh session sits at 3
    // spokes; a 9-spoke project opened into it would render 3 handles, walk 3 steps,
    // and re-save with six axes deleted. Same "the model has more than one entrance"
    // class as the guards, reached by a different route.
    const session = newSpider();
    session.loadCalibrated(loadedSpider(9), [new Dataset(1)]);
    expect(session.getRepeatCount()).toBe(9);
    expect(session.getSteps()).toHaveLength(10);
  });

  it('restores a handle for every axis, with its value AND its name', () => {
    const session = newSpider();
    session.loadCalibrated(loadedSpider(5), [new Dataset(1)]);
    const placed = session.getPlacedPoints();
    expect(Object.keys(placed)).toHaveLength(6);
    // ⚑ The name rides in the calibration's third slot. A 2-slot Calibration would
    // drop it while every number still read back correctly — a silent loss.
    expect(placed['spoke3']!.values).toEqual(['10', 'A2']);
  });

  it('restores fewer axes than the minimum without inventing extra handles', () => {
    // A one-spoke file is not something the click path can produce, but the load
    // path must not respond by conjuring handles that were never placed.
    const session = newSpider();
    session.loadCalibrated(loadedSpider(1), [new Dataset(1)]);
    expect(Object.keys(session.getPlacedPoints())).toEqual(['origin', 'spoke1']);
  });

  it('reads the centre value back off every loaded axis', () => {
    // Stored per spoke, so a reopened project restores it without a global field to
    // extract it into — the workflow asks once, the file keeps one copy per axis.
    const session = newSpider();
    session.loadCalibrated(loadedSpider(4), [new Dataset(1)]);
    expect(session.getAxes()!.getSpokes().map((s) => s.centreValue)).toEqual([2, 2, 2, 2]);
  });

  it('reads the log option back off the loaded axes', () => {
    const cal = new Calibration(3);
    cal.addPoint(100, 100, '0', '0', '');
    cal.addPoint(100, 0, '100', '1', 'A');
    const axes = new SpiderAxes();
    expect(axes.calibrate(cal, true)).toBe(true);

    const session = newSpider();
    session.loadCalibrated(axes, [new Dataset(1)]);
    expect(session.getOptions()['isLogRadial']).toBe('true');
  });
});
