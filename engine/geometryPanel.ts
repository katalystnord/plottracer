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
 * v1.1: geometry became a SAVED, series-bound output (like Curve Fit) instead of
 * WPD's throwaway popup -- getGeometryState/setGeometryState persist the request
 * (the `closed` flag) on the dataset. The RESULT itself is not stored: ui/ derives
 * it live from the current points via runGeometry, so it recomputes-on-edit for
 * free and can never go silently stale. (The earlier "deliberately no state" note
 * was WPD-parity thinking; Tenet 8 -- capturing derived stats so they can be
 * saved/exported/overlaid is the better answer.)
 */

import type { Dataset } from '../core/dataset.js';
import type { AnyAxes } from '../core/plotData.js';
import { computeGeometry, getGeometryPoints, type GeometryResult } from '../algorithms/geometry.js';

export type RunGeometryResult = { geometry: GeometryResult } | { error: string };

/** Persisted geometry REQUEST for a series (v1.1): its presence means "geometry
 * is on for this series"; `closed` is the open-curve vs closed-polygon choice. */
export interface GeometryState {
  closed: boolean;
}

const GEOMETRY_METADATA_KEY = 'geometry';

export function getGeometryState(dataset: Dataset): GeometryState | null {
  const meta = dataset.getMetadata();
  return (meta[GEOMETRY_METADATA_KEY] as GeometryState | undefined) ?? null;
}

export function setGeometryState(dataset: Dataset, state: GeometryState | null): void {
  const meta = { ...dataset.getMetadata() };
  if (state) meta[GEOMETRY_METADATA_KEY] = state;
  else delete meta[GEOMETRY_METADATA_KEY];
  dataset.setMetadata(meta);
}

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
