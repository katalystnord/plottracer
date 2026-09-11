import { describe, expect, it } from 'vitest';
import { CalibrationSession, POLAR_AXES_CONFIG, HEATMAP_AXES_CONFIG } from '../calibrationSession.js';

/**
 * ⚑⚑ THE CALIBRATION CARD, REBUILT FROM A FILE, MUST ASK THE QUESTIONS THE FILE
 * WAS ANSWERING.
 *
 * `loadCalibrated` rebuilt `placed` from the loaded calibration BEFORE it read
 * the file's options back off the axes. For most types that is harmless,
 * because their walk has one fixed shape. For the two configs with a
 * `stepsForOptions` - polar and heatmap - the walk itself depends on an option,
 * so the rebuild ran against the DEFAULTS and filled each step's boxes from the
 * wrong value slots.
 *
 * Nothing measured went wrong, which is exactly why it was silent: the axes
 * instance was built by `calibrate()` from the file, so every exported number on
 * first open was right. What broke was the record ON SCREEN and the ability to
 * repair it.
 *
 * - A tilted polar lost `r at centre` and P2's angle from the card. The card
 *   renders one editable box per entry in `placed.values`, so the origin
 *   rendered as `-` with NO BOX TO TYPE INTO, and the walk was finished so
 *   clicks were ignored. Nudging any handle then refused, naming a step whose
 *   missing values the user could not see. The figure was frozen short of Reset
 *   calibration, which is the dead end `setCalibrationValues` exists to close,
 *   reached by a new route.
 * - A categorical heatmap showed a WRONG NUMBER: a 7-column figure reopened
 *   reading `6.5` in the box labelled Columns, because the index-frame
 *   coordinate was read into the count's slot.
 *
 * ⚠️ Every load test that existed used a type whose step shape does not depend
 * on an option, so the whole class was invisible. These two cases are named for
 * the two configs that HAVE a `stepsForOptions`; a third such config needs a
 * third case here.
 */
describe('a reopened calibration card keeps the values the user typed', () => {
  /** Save and reopen through the session's own two doors. */
  function reopen(s: CalibrationSession<never>): CalibrationSession<never> {
    const axes = s.getAxes()!;
    const fresh = new CalibrationSession(s.getConfig());
    fresh.loadCalibrated(axes, [s.getDataset()], undefined, s.getHeatmapLayer());
    return fresh as unknown as CalibrationSession<never>;
  }

  it('⚑ a tilted polar reopens with "r at centre" still in its box', () => {
    const s = new CalibrationSession(POLAR_AXES_CONFIG);
    s.setOption('isCircular', 'false'); // Shape: tilted or squashed
    s.handleCalibrationClick(300, 300);
    s.confirmCalibrationValues(['2']); // r at centre
    s.handleCalibrationClick(500, 300);
    s.confirmCalibrationValues(['10', '0']);
    s.handleCalibrationClick(300, 150);
    s.confirmCalibrationValues(['20', '90']);
    expect(s.runCalibration(), 'the walk calibrates').toBe(true);

    const back = reopen(s as unknown as CalibrationSession<never>);
    const placed = back.getPlacedPoints();
    expect(placed.origin?.values, 'the centre value survives the reopen').toEqual(['2']);
    expect(placed.p2?.values, "P2's angle survives the reopen").toEqual(['20', '90']);
    // And the figure is repairable: re-placing a handle must not refuse over
    // values the card is not showing.
    back.updateCalibPointPixel('origin', 300, 300);
    expect(back.getCalibrationError(), 'nudging a handle does not freeze the figure').toBeNull();
  });

  it('⚑ a categorical heatmap reopens showing the column COUNT it was given, not a coordinate', () => {
    const s = new CalibrationSession(HEATMAP_AXES_CONFIG);
    s.setOption('xIsCategory', 'true');
    s.setOption('yIsCategory', 'true');
    // The categorical walk: the two band steps carry a COUNT and nothing else,
    // then the colour key's strip ends and two labelled ticks on it.
    const clicks: Array<[number, number, string[]]> = [
      [100, 300, []],
      [400, 300, ['7']], // Columns
      [100, 300, []],
      [100, 100, ['3']], // Rows
      [120, 420, []],
      [380, 420, []],
      [150, 420, ['5']],
      [350, 420, ['95']],
    ];
    for (const [px, py, vals] of clicks) {
      s.handleCalibrationClick(px, py);
      if (vals.length > 0) s.confirmCalibrationValues(vals);
    }
    expect(s.runCalibration(), 'the walk calibrates').toBe(true);
    expect(s.getPlacedPoints().x2?.values, 'the count is on the card before the save').toEqual(['7']);

    const back = reopen(s as unknown as CalibrationSession<never>);
    // 7 columns and 3 rows, not the index-frame coordinates 6.5 and 2.5.
    expect(back.getPlacedPoints().x2?.values, 'Columns reopens as the count').toEqual(['7']);
    expect(back.getPlacedPoints().y2?.values, 'Rows reopens as the count').toEqual(['3']);
  });
});
