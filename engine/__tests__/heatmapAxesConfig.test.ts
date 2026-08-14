import { describe, expect, it } from 'vitest';
import { CalibrationSession, HEATMAP_AXES_CONFIG, HEATMAP_KEY_POINTS, commonOriginReuse } from '../calibrationSession.js';
import { XYAxes } from '../../core/axes/xy.js';
import { heatmapBounds, heatmapBandCounts, initialGridFor } from '../heatmapRun.js';
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
  [400, 300, ['10', '5']], // x2 — coordinate, then how many COLUMNS
  [100, 300, ['0']], // y1
  [100, 100, ['20', '4']], // y2 — coordinate, then how many ROWS
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


describe('a CATEGORY axis — the question a value axis cannot ask', () => {
  /** The eight clicks with x declared categorical: no coordinate is ever typed
   * for x, only a COUNT. */
  function categoricalSession(options: Record<string, string> = {}) {
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    s.setOption('xIsCategory', 'true');
    for (const [k, v] of Object.entries(options)) s.setOption(k, v);
    return s;
  }

  it('asks for an EDGE and a COUNT instead of two coordinates', () => {
    // ⚑⚑ The defect this fixes: the walk demanded a numeric coordinate for an
    // axis the figure prints names on, so the tool itself invited fabricated
    // data. The first edge now takes no typed value at all.
    const steps = categoricalSession().getSteps();
    const x1 = steps.find((st) => st.key === 'x1')!;
    const x2 = steps.find((st) => st.key === 'x2')!;
    expect(x1.valueFields).toEqual([]);
    expect(x1.prompt).toMatch(/outer edge of the FIRST column/);
    expect(x2.valueFields).toHaveLength(1);
    expect(x2.valueFields[0]!.label).toBe('Columns');
    expect(x2.prompt).toMatch(/how many columns/);
    // …and the y axis is untouched, because the two are declared independently.
    expect(steps.find((st) => st.key === 'y1')!.valueFields).toHaveLength(1);
  });

  it('DERIVES the 0…N frame from the count, so nobody types a coordinate', () => {
    const s = categoricalSession();
    const walk: Array<[number, number, string[]]> = [
      [100, 300, []],        // x start edge — a click, nothing to type
      [400, 300, ['5']],     // x end edge + "5 columns"
      [100, 300, ['0']],
      [100, 100, ['20', '4']], // y stays MEASURED — coordinate, then rows
      [120, 420, []],
      [380, 420, []],
      [150, 420, ['5']],
      [350, 420, ['95']],
    ];
    for (const [px, py, values] of walk) {
      s.handleCalibrationClick(px, py);
      if (values.length > 0) s.confirmCalibrationValues(values);
    }
    expect(s.runCalibration()).toBe(true);
    const axes = s.getAxes()!;
    // Five columns across the clicked span: the left edge is index 0 and the
    // right edge index 5, so a pixel in the middle reads 2.5 — the centre of
    // the third band.
    expect(axes.pixelToData(100, 300)[0]).toBeCloseTo(0, 6);
    expect(axes.pixelToData(400, 300)[0]).toBeCloseTo(5, 6);
    expect(axes.pixelToData(250, 300)[0]).toBeCloseTo(2.5, 6);
    // The y axis stayed a measured one.
    expect(axes.pixelToData(100, 100)[1]).toBeCloseTo(20, 6);
  });

  it('records WHICH axes are ordinals, so a reopened file does not ask again', () => {
    const s = categoricalSession();
    for (const [px, py, values] of [
      [100, 300, []], [400, 300, ['4']], [100, 300, ['0']], [100, 100, ['20', '4']],
      [120, 420, []], [380, 420, []], [150, 420, ['5']], [350, 420, ['95']],
    ] as Array<[number, number, string[]]>) {
      s.handleCalibrationClick(px, py);
      if (values.length > 0) s.confirmCalibrationValues(values);
    }
    expect(s.runCalibration()).toBe(true);
    const meta = s.getAxes()!.getMetadata();
    expect(meta['heatmapXKind']).toBe('category');
    expect(meta['heatmapYKind']).toBe('value');
    expect(HEATMAP_AXES_CONFIG.extractOptions!(s.getAxes()!)['xIsCategory']).toBe('true');
    expect(HEATMAP_AXES_CONFIG.extractOptions!(s.getAxes()!)['yIsCategory']).toBe('false');
  });

  it('REFUSES a count that is not a whole number of categories', () => {
    const cal = new Calibration(3);
    cal.addPoint(100, 300, '', '', '');
    cal.addPoint(400, 300, '', '', '2.5'); // the COUNT, in its own slot
    cal.addPoint(100, 300, '', '0', '');
    cal.addPoint(100, 100, '', '20', '4');
    const problem = HEATMAP_AXES_CONFIG.checkValues!(cal, { xIsCategory: 'true' }, {});
    expect(problem).toMatch(/whole number/i);
    // ⚑ And the refusal names where the NAMES go, because "2.5 columns" is
    // usually someone trying to type a category rather than a count.
    expect(problem).toMatch(/names are typed later/i);
    // Zero is not a grid either.
    expect(HEATMAP_AXES_CONFIG.checkValues!(
      (() => { const c = new Calibration(3); c.addPoint(100, 300, '', '', ''); c.addPoint(400, 300, '', '', '0'); c.addPoint(100, 300, '', '0', ''); c.addPoint(100, 100, '', '20', '4'); return c; })(),
      { xIsCategory: 'true' },
      {}
    )).toMatch(/whole number/i);
  });

  it('says nothing while the count is still being typed', () => {
    const cal = new Calibration();
    cal.addPoint(100, 300, '', '');
    cal.addPoint(400, 300, '', '');
    cal.addPoint(100, 300, '', '0');
    cal.addPoint(100, 100, '', '20');
    expect(HEATMAP_AXES_CONFIG.checkValues!(cal, { xIsCategory: 'true' }, {})).toBeNull();
  });

  it('never takes the LOG of an ordinal, whatever the option says', () => {
    const s = categoricalSession({ isLogX: 'true' });
    for (const [px, py, values] of [
      [100, 300, []], [400, 300, ['3']], [100, 300, ['0']], [100, 100, ['20', '4']],
      [120, 420, []], [380, 420, []], [150, 420, ['5']], [350, 420, ['95']],
    ] as Array<[number, number, string[]]>) {
      s.handleCalibrationClick(px, py);
      if (values.length > 0) s.confirmCalibrationValues(values);
    }
    // ⚑ A log category axis would take the log of a counted position — and
    // log(0) at the first edge would make every reading -Infinity or NaN.
    expect(s.runCalibration()).toBe(true);
    expect(s.getAxes()!.isLogX()).toBe(false);
  });
});


describe('the TICK CONVENTION — centred marks vs boundary marks', () => {
  /**
   * ⚑⚑ David: *"for some of them, the tick markers actually sit centred in
   * category mode, and the edge of boundaries are in between, right?"* Right —
   * matplotlib and ggplot print a tick under each category, Excel prints one
   * between them, and it is the same `TickConvention` v2.1's category ticks
   * already carry. Asking for the outer EDGE of a band on a figure that marks
   * only centres asks the user to point at something unprinted.
   *
   * THE CLAIM UNDER TEST: the two conventions are two ways to say the SAME
   * geometry. Given a figure whose five bands run across pixels 100…400, the
   * edge clicks (100, 400) and the centred clicks (130, 370) must produce the
   * identical grid — because a centred tick is half a band inside the edge.
   */
  function walk(options: Record<string, string>, firstPx: number, lastPx: number, count: string) {
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    for (const [k, v] of Object.entries(options)) s.setOption(k, v);
    const steps: Array<[number, number, string[]]> = [
      [firstPx, 300, []],
      [lastPx, 300, [count]],
      [100, 300, ['0']],
      [100, 100, ['20', '4']], // y stays MEASURED — coordinate, then rows
      [120, 420, []],
      [380, 420, []],
      [150, 420, ['5']],
      [350, 420, ['95']],
    ];
    for (const [px, py, values] of steps) {
      s.handleCalibrationClick(px, py);
      if (values.length > 0) s.confirmCalibrationValues(values);
    }
    expect(s.runCalibration()).toBe(true);
    return s;
  }

  it('asks for a CENTRE when the figure marks centres, and says so', () => {
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    s.setOption('xIsCategory', 'true');
    s.setOption('xTicksCentred', 'true');
    const steps = s.getSteps();
    expect(steps.find((st) => st.key === 'x1')!.prompt).toMatch(/CENTRE of the first column/);
    expect(steps.find((st) => st.key === 'x2')!.prompt).toMatch(/CENTRE of the last column/);
    // …and still asks for the count on the second click, never a coordinate.
    expect(steps.find((st) => st.key === 'x2')!.valueFields[0]!.label).toBe('Columns');
  });

  it('puts the SAME grid on the figure from either kind of click', () => {
    // Five bands across pixels 100…400: bands are 60px, so the first centre is
    // at 130 and the last at 370.
    const edges = walk({ xIsCategory: 'true' }, 100, 400, '5');
    const centres = walk({ xIsCategory: 'true', xTicksCentred: 'true' }, 130, 370, '5');
    const a = edges.getAxes()!;
    const b = centres.getAxes()!;
    // The plot's own edges read 0 and 5 under BOTH conventions — the centred
    // walk never pointed at them.
    for (const [px, want] of [[100, 0], [400, 5], [250, 2.5]] as const) {
      expect(a.pixelToData(px, 300)[0]).toBeCloseTo(want, 6);
      expect(b.pixelToData(px, 300)[0]).toBeCloseTo(want, 6);
    }
  });

  it('spans the whole ordinal range, not just what was clicked', () => {
    // ⚑ The trap this exists to stop: the centred calibration's own values run
    // 0.5…4.5, and reading those as the grid's extent would drop half a band off
    // each end and shift every boundary inward.
    const centres = walk({ xIsCategory: 'true', xTicksCentred: 'true' }, 130, 370, '5');
    const bounds = heatmapBounds(centres.getAxes()! as never)!;
    expect(bounds.xMin).toBe(0);
    expect(bounds.xMax).toBe(5);
    const grid = initialGridFor(bounds, heatmapBandCounts(centres.getAxes()! as never));
    expect([...grid.xDividers]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('remembers the convention, because the extent cannot be read back without it', () => {
    const centres = walk({ xIsCategory: 'true', xTicksCentred: 'true' }, 130, 370, '5');
    expect(centres.getAxes()!.getMetadata()['heatmapXTicks']).toBe('centred');
    expect(HEATMAP_AXES_CONFIG.extractOptions!(centres.getAxes()!)['xTicksCentred']).toBe('true');
    // An edge-marked axis says so too, rather than defaulting silently.
    const edges = walk({ xIsCategory: 'true' }, 100, 400, '5');
    expect(edges.getAxes()!.getMetadata()['heatmapXTicks']).toBe('edge');
  });
});


describe('the SHARED CORNERS of a heatmap’s plot box', () => {
  /**
   * ⚑⚑ David: *"the common origin does not work when you have a categorial
   * axis. And it should allow both common X or Y."* Both halves were real. The
   * prefill declared for X1→Y1 is the origin's `0`, and a CATEGORY edge takes no
   * typed value at all — so the walk took the shared pixel and then waited for a
   * value the step could not accept, with no confirm button in sight. And only
   * one pairing was ever declared, when a heatmap's axes span exactly the plot
   * box: its two opposite corners carry all four points.
   */
  it('COMPLETES a no-value step from a reused pixel, as a click on it would', () => {
    // ⚑ The two entrances to placing a point have to agree about when a point is
    // finished. A click on a value-less step advances the walk; a reused pixel
    // used to leave it pending forever.
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    s.setOption('yIsCategory', 'true');
    s.handleCalibrationClick(100, 300);
    s.confirmCalibrationValues(['0']);
    s.handleCalibrationClick(400, 300);
    s.confirmCalibrationValues(['10', '5']); // coordinate, then columns
    expect(s.getCurrentStep()!.key).toBe('y1');
    expect(s.reuseStepPixel('x1')).toBe(true);
    // Placed AND advanced — not sitting on a step that can never be confirmed.
    expect(Object.keys(s.getPlacedPoints())).toContain('y1');
    expect(s.getCurrentStep()!.key).toBe('y2');
  });

  it('shares ONE corner only — two shared pairs cannot calibrate at all', () => {
    // ⚑⚑ THE FEATURE THIS REPLACES WAS GEOMETRICALLY IMPOSSIBLE. v2.2 declared a
    // second pairing (x2 -> y2) so a heatmap could be calibrated from the plot
    // box's two opposite corners — *"two clicks and two counts instead of four
    // clicks and four values."* But sharing BOTH pairs leaves the calibration
    // with TWO distinct pixels, and two points cannot define a 2-D transform:
    // the Y axis vector becomes the X axis vector, so the axes are parallel by
    // construction and the whole calibration is refused. At ANY corners.
    //
    // ⚑ David, day one: *"the text for shared origin is misleading or
    // incorrect"* and *"we are missing a data point out."* A data point IS
    // missing. The diagnosis that the prompts merely failed to say "click the
    // opposite corner" was wrong; the opposite corner fails too.
    //
    // ⚑⚑ AND THE TEST THAT USED TO STAND HERE STOPPED AT 4/8 AND CHECKED THE
    // WALK HAD MOVED ON — it never called `runCalibration`, so it proved the
    // walk advanced and nothing about whether the result was usable. The e2e
    // did the same. This one calibrates, which is the only assertion that could
    // have caught it.
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    s.setOption('xIsCategory', 'true');
    s.setOption('yIsCategory', 'true');
    s.handleCalibrationClick(100, 300); // one corner  -> x1 (no value)
    s.handleCalibrationClick(400, 100); // the other   -> x2
    s.confirmCalibrationValues(['6']);

    const shareInto = (key: string) =>
      commonOriginReuse(
        HEATMAP_AXES_CONFIG as never,
        true,
        key,
        s.getPlacedPoints(),
        s.getCurrentStep() ?? undefined
      );
    // The ORIGIN is still shared — three distinct pixels remain, which is the
    // long-standing case every XY chart has had.
    expect(shareInto('y1')).toEqual({ from: 'x1', prefill: [] });
    // The far corner is NOT, because sharing it would leave only two.
    expect(shareInto('y2')).toBeNull();
  });

  it('REFUSES a calibration whose Y points are the X points', () => {
    // The geometric fact, stated where it cannot be argued with: place all four
    // by hand at only two pixels and the calibration is impossible.
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    const clicks: Array<[number, number, string[]]> = [
      [100, 300, ['0']], [400, 100, ['10', '5']],
      [100, 300, ['0']], [400, 100, ['20', '4']],
      [120, 420, []], [380, 420, []], [150, 420, ['5']], [350, 420, ['95']],
    ];
    for (const [px, py, vals] of clicks) {
      s.handleCalibrationClick(px, py);
      if (vals.length > 0) s.confirmCalibrationValues(vals);
    }
    expect(s.runCalibration()).toBe(false);
    expect(s.getCalibrationError()).toMatch(/parallel/i);
  });
});
