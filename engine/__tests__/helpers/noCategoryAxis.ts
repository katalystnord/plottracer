import { CategoryAxis } from '../../../core/categoryAxis.js';
import type { Dataset } from '../../../core/dataset.js';
import type { CalibratedAxes } from '../../axesTypeConfigs.js';
import type { CalibrationSession } from '../../calibrationSession.js';

/**
 * A bar-family session with NO category axis - built the way the app actually
 * reaches that state.
 *
 * ⚑⚑ THE DOOR IS `loadCalibrated`, AND THE FIXTURES WERE USING A FAKE ONE.
 * Every one of these fixtures used to walk the category axis and then call
 * `removeCategoryTicks` to tear it back down - a session-level mutator with no
 * production caller at all, kept alive only by the tests that needed it. So the
 * state was reached by an operation no user can perform, and the ONE entrance
 * that really produces it was exercised by nothing.
 *
 * ⚠️ AND IT IS NOT LEGACY SUPPORT, which is what it looks like. The comment on
 * the old fixture said *"a project saved before v2.4, which is the only way to
 * reach the un-ticked path now"*, and that is wrong in the direction that
 * matters: `WPD_AXES_TO_CONFIG` maps `BarAxes` to `bar`, and WebPlotDigitizer
 * has no category axis to import. So **an imported bar chart lands here, every
 * time, permanently** - tenet 6, not backward compatibility. This project owes
 * old files of its own nothing while it has no users
 * ([[feedback_dont_overbuild_legacy_migration]]); it owes a WPD import forever.
 *
 * ⚑ Which is also why this lives in `helpers/` beside `categoryWalk`, and not
 * as a method on `CalibrationSession`. It is a way of CONSTRUCTING a state for
 * a test, not a thing the product does. Weighing the two, David: *"it sounds
 * like we should really break out A into a supporting function library, not
 * something that we carry every day."*
 */
export function loadWithoutCategoryAxis<A extends CalibratedAxes>(
  session: CalibrationSession<A>,
  axes: A,
  datasets: Dataset[],
): void {
  // ⚑ A FRESH, EMPTY `CategoryAxis` is exactly what `deserializeProject` hands
  // over for "a file that predates this or a session whose graph type never
  // uses one" - the same object shape, from the same argument position, so the
  // fixture cannot drift away from what opening a file really does.
  session.loadCalibrated(axes, datasets, new CategoryAxis(), null);
}
