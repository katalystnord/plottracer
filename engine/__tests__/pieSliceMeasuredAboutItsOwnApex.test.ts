/**
 * ⚑⚑ A ROW'S `cells` AND ITS `derived` ARE ONE READING OF ONE SLICE.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-10. `valueCells` hard-coded `apex: null` while the
 * same row's `derived` was computed with `getSectorApex`, so an EXPLODED slice
 * was measured about the pie's centre in one and about its own apex in the
 * other. Measured: `derived 25` against `cells [18.7]` - the same slice, the
 * same row, 25% apart.
 *
 * ⚑ `PIE_AXES_CONFIG.derivedTupleValue.compute` takes `ctx.apex` precisely
 * because *"an exploded slice measures about its own"*, and `valueColumns.ts`'s
 * header says the module exists so the panel, the editor and the exporter
 * *"cannot drift into three answers"*. The drift was inside the module.
 *
 * ⚑⚑ AND THE NARROWING WAS THE DEFECT IN TYPE FORM: the local config type
 * declared `ctx: { apex: null }`, so the module said in its own signature that it
 * never passes one. Widening it is what makes the mistake unrepeatable.
 *
 * ⚠️ No pie consumer reads `cells` today - `tupleDataSection` fills from it only
 * when a type names more than one value, and a pie names one - so this was a
 * loaded gun rather than a firing one. The whole direction of v2.5 is to move
 * consumers onto `cells`, which is what makes it worth closing now.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, PIE_AXES_CONFIG, type CalibratedAxes } from '../calibrationSession.js';

/** A pie calibrated on its outline, with one slice exploded away from the centre. */
function pieWithExplodedSlice(): CalibrationSession<CalibratedAxes> {
  const s = new CalibrationSession<CalibratedAxes>(PIE_AXES_CONFIG as never);
  // Three points on the rim fit the ellipse: centre (300,200), r = 120.
  s.handleCalibrationClick(420, 200);
  s.handleCalibrationClick(300, 320);
  s.handleCalibrationClick(180, 200);
  expect(s.runCalibration(), s.getCalibrationError() ?? 'no error').toBe(true);
  return s;
}

describe('a pie slice is measured about the apex its row carries', () => {
  it('⚑⚑ cells and derived agree on the same slice', () => {
    const s = pieWithExplodedSlice();
    // ⚑⚑ EXPLODED, WHICH IS THE WHOLE POINT. My first draft captured an
    // ORDINARY slice and passed without the fix - an apex of null on both
    // routes agrees trivially. Arming the slice and clicking its apex is what
    // makes the two routes able to disagree at all.
    s.setNextSectorExploded(true);
    expect(s.isAwaitingExplodedApex(), 'the walk is not waiting for an apex').toBe(true);
    s.addDataPoint(330, 230); // the apex, away from the pie's own centre
    // Two rim points bounding a quarter of the pie.
    s.addDataPoint(420, 200);
    s.addDataPoint(300, 320);
    expect(s.getSectorApex(0), 'the slice recorded no apex').not.toBeNull();

    const row = s.getTupleRows()[0];
    expect(row, 'no slice was recorded').toBeDefined();
    const cell = row!.cells[0];
    const derived = row!.derived;
    expect(derived, 'the slice has no derived value').not.toBeNull();
    expect(cell, 'the slice has no cell value').not.toBeNull();
    expect(
      cell as number,
      `cells ${JSON.stringify(row!.cells)} against derived ${String(derived)} - one slice, two answers`
    ).toBeCloseTo(derived as number, 6);
  });

  it('⚑ the type asks for an apex at all, which is why this can differ', () => {
    // Not vacuous: if pie ever stopped measuring about an apex, the test above
    // would pass for the wrong reason and this says so.
    const compute = PIE_AXES_CONFIG.derivedTupleValue?.compute;
    expect(compute, 'pie no longer derives a value').toBeDefined();
    expect(String(compute), 'pie no longer reads ctx.apex').toMatch(/apex/);
  });
});
