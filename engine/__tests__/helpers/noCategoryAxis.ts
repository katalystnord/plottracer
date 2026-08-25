import { Calibration } from '../../../core/calibration.js';
import { CategoryAxis } from '../../../core/categoryAxis.js';
import type { Dataset } from '../../../core/dataset.js';
import type { CalibratedAxes } from '../../axesTypeConfigs.js';
import type { CalibrationSession } from '../../calibrationSession.js';

/**
 * A bar-family session with NO category axis - built the way the app actually
 * reaches that state, which is a WPD IMPORT.
 *
 * ⚑⚑ THE DOOR IS `loadCalibrated`, AND THE FIXTURES USED TO USE A FAKE ONE.
 * They walked the category axis and then called `removeCategoryTicks`, a session
 * mutator with no production caller, kept alive only by the tests that needed
 * it. So the state was reached by an operation no user can perform, and the one
 * entrance that really produces it was exercised by nothing.
 *
 * ⚑⚑ AND IT IS NOT LEGACY SUPPORT. `WPD_AXES_TO_CONFIG` maps `BarAxes` to `bar`,
 * and WebPlotDigitizer has no category axis to bring, so **an imported bar chart
 * lands here every time, permanently** - tenet 6, not backward compatibility.
 * This project has no users and owes its own old files nothing
 * ([[feedback_dont_overbuild_legacy_migration]]); it owes a WPD import forever.
 *
 * ⚑⚑ WHY IT TRUNCATES THE CALIBRATION, which is the whole point of the helper.
 * A first version simply handed `loadCalibrated` the session's own axes with a
 * fresh `CategoryAxis`. That clears the GEOMETRY, but `loadCalibrated` rebuilds
 * the placed steps from the axes' calibration BY INDEX - so `c1`/`c2` came back
 * placed, with no geometry and no step left to walk. **That state is not
 * reachable either**: our own serializer writes the category axis whenever the
 * walk created one, so a file cannot hold four calibration points and no
 * geometry. It swapped one impossible state for another, and the tests that then
 * tried to PLACE an axis had no step to click.
 * ▶ A WPD-imported `BarAxes` carries exactly TWO calibration points - its own
 * `calibrate` needs no more (`core/axes/bar.ts`, `getCount() < 2`). Truncating to
 * the value steps is therefore not a trick to make a test pass; it is what the
 * importer really hands over, and it is why the walk resumes at `Cat 1`.
 *
 * ⚑ It lives in `helpers/` beside `categoryWalk`, and not as a method on
 * `CalibrationSession`. It is a way of CONSTRUCTING a state for a test, not a
 * thing the product does. David: *"it sounds like we should really break out A
 * into a supporting function library, not something that we carry every day."*
 */
export function loadWithoutCategoryAxis<A extends CalibratedAxes>(
  session: CalibrationSession<A>,
  axes: A,
  datasets: Dataset[],
  /** How many leading calibration points the VALUE axis owns - two everywhere
   * in the bar family, which is why it defaults. */
  valuePoints = 2,
): void {
  const full = (axes as unknown as { calibration: Calibration | null }).calibration;
  if (full) {
    const trimmed = new Calibration();
    for (let i = 0; i < Math.min(valuePoints, full.getCount()); i += 1) {
      const p = full.getPoint(i)!;
      trimmed.addPoint(p.px, p.py, p.dx ?? '', p.dy ?? '', p.dz ?? undefined);
    }
    (axes as unknown as { calibration: Calibration | null }).calibration = trimmed;
  }
  // ⚑ A FRESH, EMPTY `CategoryAxis` is exactly what `deserializeProject` hands
  // over for "a file that predates this or a session whose graph type never
  // uses one" - the same object shape, from the same argument position, so the
  // fixture cannot drift away from what opening a file really does.
  session.loadCalibrated(axes, datasets, new CategoryAxis(), null);
}
