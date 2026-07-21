/**
 * Geometry & Statistics orchestration (checkpoint 27, see CLAUDE.md) --
 * the thin run policy on top of algorithms/geometry.ts's pure
 * computeGeometry/getGeometryPoints, same extraction reasoning as
 * engine/curveFitPanel.ts and engine/segmentFillRun.ts.
 *
 * Faithful port of the policy in ui-patches/engauge-algos.js's
 * wpd.runGeometry/wpd.showGeometryPopup (Phase 2.6, part 2): reject a
 * dataset with point groups configured (Box Plot / Error Bar Groups are
 * tuples of independent measurements, not a single traced curve -- arc
 * length/area/curvature have no sensible meaning there, same message
 * verbatim), require at least 2 points, then compute. XY axes only, same
 * restriction as Curve Fit, enforced by ui/'s Workspace.tsx rather than
 * here (see curveFitPanel.ts's header comment for why).
 *
 * Unlike Curve Fit, this is a read-only, recompute-on-open report in the
 * current app (no dataset-metadata persistence, no overlay) -- preserved
 * here: no getGeometryState/setGeometryState pair exists, deliberately.
 */

import type { Dataset } from '../core/dataset.js';
import type { AnyAxes } from '../core/plotData.js';
import { computeGeometry, getGeometryPoints, type GeometryResult } from '../algorithms/geometry.js';

export type RunGeometryResult = { geometry: GeometryResult } | { error: string };

export function runGeometry(dataset: Dataset, axes: AnyAxes, closed: boolean): RunGeometryResult {
  if (dataset.hasPointGroups()) {
    return {
      error:
        "Geometry statistics don't apply to datasets with point groups (Box Plot / Error Bar Groups) — those are tuples of independent measurements, not a single traced curve.",
    };
  }

  const points = getGeometryPoints(dataset, axes);
  if (points.length < 2) {
    return { error: 'Need at least 2 points to compute geometry statistics.' };
  }

  return { geometry: computeGeometry(points, closed) };
}
