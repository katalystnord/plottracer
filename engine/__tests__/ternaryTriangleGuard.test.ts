/**
 * ⚑⚑ THREE CORNERS ON ONE LINE ARE NOT A TRIANGLE - refused in the user's own
 * words, at the click that makes it true.
 *
 * ⚑ THE COMPANION TO USING THE THIRD CORNER (2026-09-10). While the maths read
 * only A and B, a collinear C was harmless because it was ignored; now the
 * reading is the pixel's barycentric coordinate in the clicked triangle, so a
 * triangle with no area has no reading at all and `TernaryAxes.calibrate`
 * refuses it. A model refusal alone would reach the user as *"Calibration
 * failed - check the entered data values are valid numbers"*, from
 * `buildAxes` - and a ternary calibration has NO entered values, so that
 * sentence sends them to look at fields that do not exist (tenet 7).
 *
 * ⚑⚑ NO NEW MECHANISM. `parallelAxisGuard` already asks exactly this question -
 * *are these two pixel directions parallel* - for XY, the heatmap and the bar
 * chart. A→B against A→C is the same cross product, so ternary DECLARES it and
 * supplies the one sentence that differs. The guard runs in `checkGuards`, which
 * BOTH doors consult.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, TERNARY_AXES_CONFIG, POLAR_AXES_CONFIG } from '../calibrationSession.js';

const REFUSAL =
  'The three corners are on one line - a ternary diagram needs a triangle with area, or no pixel has a composition.';

function walk(corners: Array<[number, number]>): CalibrationSession<never> {
  const session = new CalibrationSession(TERNARY_AXES_CONFIG) as never as CalibrationSession<never>;
  const s = session as unknown as {
    handleCalibrationClick(x: number, y: number): void;
    confirmCalibrationValues(v: string[]): void;
  };
  for (const [px, py] of corners) {
    s.handleCalibrationClick(px, py);
    // ⚑ A corner now carries the figure's own NAME, optional, so the step is
    // confirmed like a spider spoke's rather than being a bare click.
    s.confirmCalibrationValues(['']);
  }
  return session;
}

describe('a ternary diagram needs a triangle', () => {
  it('⚑⚑ refuses three corners on one line, in words about corners', () => {
    const session = walk([[100, 400], [400, 400], [250, 400]]);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toBe(REFUSAL);
  });

  it('⚑⚑ the refusal arrives at the LAST CLICK now, not one button later', () => {
    // ⚑⚑ THIS CASE CHANGED, AND IT IMPROVED. It used to assert the opposite:
    // that a collinear triangle was accepted through the whole walk and only
    // refused when Calibrate was pressed. That was defensible then - David:
    // *"We (the user) mark the points, and then presses calibrate. There is
    // nothing more to it than that, no?"* - because `confirmCalibrationValues`
    // asks `problemWith` when a walk completes, and a step with NOTHING TO TYPE
    // never reached that path. The two moments were one button press apart.
    //
    // Giving each corner the figure's own NAME (2026-09-12) put a field on the
    // step, so the walk now completes through that path and the refusal lands on
    // the gesture that caused it. That is gate 5 - *do refusals fire AT the
    // gesture?* - arriving as a side effect of a change made for another reason,
    // which is worth pinning so nobody "fixes" it back.
    const session = walk([[100, 400], [400, 400], [250, 400]]);
    expect(session.getCalibrationError()).toBe(REFUSAL);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toBe(REFUSAL);
  });

  it('⚠️ a real triangle still calibrates - the guard must not over-reach', () => {
    const session = walk([[100, 400], [400, 400], [250, 150]]);
    expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
  });

  it('a right-angled triangle is a real triangle, and reads its own corner', () => {
    // The shape the old maths could not describe is ordinary to the guard: it
    // has area, so it calibrates, and corner C reads as pure C.
    const session = walk([[100, 300], [100, 100], [300, 300]]);
    expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
    const axes = (session as unknown as { getAxes(): { pixelToData(x: number, y: number): number[] } }).getAxes();
    const [a, b, c] = axes.pixelToData(300, 300);
    expect(a).toBeCloseTo(0, 9);
    expect(b).toBeCloseTo(0, 9);
    expect(c).toBeCloseTo(100, 9);
  });
});

/**
 * ⚑⚑ A GUARD MUST NOT REFUSE THE THING IT PROTECTS.
 *
 * ⚠️ MEASURED, 2026-09-10: polar's `radialDistinctGuard` refused a perfectly
 * good calibration of a SQUASHED figure. Its question - "are P1 and P2 the same
 * distance from the origin" - exists because the CIRCULAR reading divides by
 * that difference. A figure read through its measured frame has no such scale,
 * and on a 2:1 ellipse r=50 at 0° and r=100 at 90° are both exactly 100px out.
 * The guard now asks the MODEL whether its question applies.
 */
describe('the polar radial guard asks only where its question applies', () => {
  const O = { x: 300, y: 300 };

  function polarWalk(
    p1: [number, number],
    v1: string[],
    p2: [number, number],
    v2: string[],
    { circular = false } = {}
  ) {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    session.setOption('isCircular', String(circular));
    const s = session as unknown as {
      handleCalibrationClick(x: number, y: number): void;
      confirmCalibrationValues(v: string[]): void;
    };
    s.handleCalibrationClick(O.x, O.y);
    // ⚑ The distorted walk asks for the centre's radial value; the circular one
    // asks for nothing here. The fixture follows the walk rather than assuming.
    s.confirmCalibrationValues(circular ? [] : ['0']);
    s.handleCalibrationClick(p1[0], p1[1]);
    s.confirmCalibrationValues(v1);
    s.handleCalibrationClick(p2[0], p2[1]);
    s.confirmCalibrationValues(v2);
    return session;
  }

  it('⚑⚑ accepts equal pixel distances when the FRAME is measured, and reads them right', () => {
    // A 2:1 squash: r=50 at 0° lands 100px east, r=100 at 90° lands 100px south.
    const session = polarWalk([O.x + 100, O.y], ['50', '0'], [O.x, O.y + 100], ['100', '90']);
    expect(session.runCalibration(), session.getCalibrationError() ?? 'no error').toBe(true);
    const axes = session.getAxes()!;
    expect(axes.pixelToData(O.x + 100, O.y)[0]).toBeCloseTo(50, 8);
    expect(axes.pixelToData(O.x, O.y + 100)[0]).toBeCloseTo(100, 8);
    // The point the circular reading would have called r=50 is not r=50: it is
    // half a squashed radius, and the frame knows the difference.
    expect(axes.pixelToData(O.x + 50, O.y)[0]).toBeCloseTo(25, 8);
  });

  it('⚠️ still refuses equal distances when the reading IS circular - the guard must not go quiet', () => {
    // Same pixels, but the figure DECLARED circular - which is what every WPD
    // project is: no frame, so the radial scale really would be zero.
    const session = polarWalk([O.x + 100, O.y], ['50', '0'], [O.x, O.y + 100], ['100'], { circular: true });
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/same distance from the origin/i);
  });
});

/**
 * ⚑⚑ THE SHAPE OF A POLAR FIGURE IS DECLARED, AND THE DECLARATION CHANGES WHAT
 * THE WALK ASKS FOR.
 *
 * David, 2026-09-10, cutting through a long argument about which reading was
 * "in force" and whether the card should announce it: *"For all other kinds of
 * graphs that can have special cases... we have a simple toggle for them, and
 * they change WHAT WE ASK FOR. So in this case. Can we not simply have a toggle
 * that asks, is the plot circular?"*
 *
 * ▶ It removes the mode rather than labelling it. A circular figure is fully
 * described by the origin and two radii on one spoke, so that walk asks for
 * nothing more - upstream's dead θ field is simply not there. A distorted one
 * needs two more numbers, so that walk asks for them and REQUIRES them.
 */
describe('the polar walk asks what the declared shape needs', () => {
  const stepsFor = (isCircular: boolean) => {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    session.setOption('isCircular', String(isCircular));
    return session.getSteps();
  };
  const fieldsOf = (isCircular: boolean, key: string) =>
    stepsFor(isCircular).find((st) => st.key === key)!.valueFields.map((f) => f.key);

  it('⚑⚑ a CIRCULAR figure is never asked for P2’s angle - nothing would read it', () => {
    expect(fieldsOf(true, 'p2')).toEqual(['r2']);
    expect(fieldsOf(true, 'origin')).toEqual([]);
  });

  it('⚑⚑ a DISTORTED figure is asked for the angle and the centre, and both are required', () => {
    expect(fieldsOf(false, 'p2')).toEqual(['r2', 'theta2']);
    expect(fieldsOf(false, 'origin')).toEqual(['r0']);
    // Required, not optional: without them there is no reading at all.
    const p2 = stepsFor(false).find((st) => st.key === 'p2')!;
    expect(p2.valueFields.every((f) => !f.optional)).toBe(true);
  });

  it('⚑ the prompts differ, because the questions differ', () => {
    expect(stepsFor(true).find((st) => st.key === 'p2')!.prompt).toMatch(/same θ as P1/);
    expect(stepsFor(false).find((st) => st.key === 'p2')!.prompt).toMatch(/DIFFERENT angle/);
    expect(stepsFor(false).find((st) => st.key === 'origin')!.prompt).toMatch(/radial value there/);
  });

  it('⚑⚑ Direction is offered only where it can change something', () => {
    // With two angles the sense of rotation is measured, so the control decides
    // nothing on a distorted figure. `onlyWhen` is the existing declaration for
    // "do not present a control whose outcome is already decided" - the same
    // rule the heatmap's tick convention uses.
    const direction = POLAR_AXES_CONFIG.options!.find((o) => o.key === 'isClockwise')!;
    expect(direction.onlyWhen).toBe('isCircular');
  });

  it('⚠️ refuses a distorted walk whose two points share a line through the centre', () => {
    const session = new CalibrationSession(POLAR_AXES_CONFIG);
    session.setOption('isCircular', 'false');
    const s = session as unknown as {
      handleCalibrationClick(x: number, y: number): void;
      confirmCalibrationValues(v: string[]): void;
    };
    s.handleCalibrationClick(300, 300);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(400, 300);
    s.confirmCalibrationValues(['50', '0']);
    s.handleCalibrationClick(200, 300); // θ=180: the opposite side of one line
    s.confirmCalibrationValues(['100', '180']);
    expect(session.runCalibration()).toBe(false);
    expect(session.getCalibrationError()).toMatch(/same line through the centre/i);
  });
});
