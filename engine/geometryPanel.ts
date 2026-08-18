/**
 * Geometry & Statistics orchestration (checkpoint 27, see CLAUDE.md) --
 * the thin run policy on top of algorithms/geometry.ts's pure
 * computeGeometry/getGeometryPoints, same extraction reasoning as
 * engine/curveFitPanel.ts and engine/segmentFillRun.ts.
 *
 * Faithful port of the policy in ui-patches/engauge-algos.js's
 * wpd.runGeometry/wpd.showGeometryPopup (Phase 2.6, part 2): reject a
 * dataset with slots configured (Box Plot / Error Bar Groups are
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
import { ownSlotNames } from '../algorithms/errorExtent.js';

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
  // ⚑ The type's OWN slots. A Box Plot's five letter values really are
  // independent measurements rather than a traced curve, and that refusal
  // stands - but an XY scatter that acquired error extents is still a traced
  // curve, and asking `dataset.hasSlots()` refused it the moment one error bar
  // was added. The shape question again: what the TYPE is, not what the storage
  // looks like.
  if (ownSlotNames(dataset.getSlotNames()).length > 0) {
    return {
      error:
        "Geometry statistics don't apply to datasets with slots (Box Plot / Error Bar Groups) - those are tuples of independent measurements, not a single traced curve.",
    };
  }

  // ⚑ ONE refusal, not two. The v2.0 pre-launch audit put the "fewer than 2
  // points" guard into computeGeometry itself, where it belongs, and this
  // function kept its own copy of the same test immediately above the call --
  // so the model's refusal could never be the one that fired. Two checks of one
  // predicate on one path is not defense-in-depth; it is a dead branch, and it
  // made BOTH of them unverifiable (each masked the other, so neither could be
  // shown to matter). The model decides; this layer turns its refusal into the
  // sentence the user reads, naming the requirement rather than the failure.
  const geometry = computeGeometry(getGeometryPoints(dataset, axes), closed);
  if (!geometry) {
    return { error: 'Need at least 2 points to compute geometry statistics.' };
  }
  return { geometry };
}
