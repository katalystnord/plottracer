/**
 * The error model's one piece of stored state: a series' relationship to
 * another series.
 *
 * **The whole model is "an error series is an ordinary series, plus a stored
 * relationship to another series"** (docs/error-bars-design.md, agreed with
 * David 2026-07-16). Everything that used to look like separate work falls out
 * of it: the taxonomy is the four roles, a confidence band is the same relation
 * at higher density, and "only some points carry error" needs no support at all
 * because the error series simply has fewer points.
 *
 * **No format invention — both halves already round-trip.** The error series is
 * a `Dataset` in `datasetColl`; the relationship is a key in that dataset's own
 * metadata, which `core/plotData.ts` serializes and restores generically
 * (`:637` writes `dsData.metadata`, `:453` calls `setMetadata`). This is the
 * same extension point checkpoint 27 used for `curveFit` and checkpoint 66 used
 * for the graph type, and upstream deep-clones metadata keys it does not
 * recognise — so a WPD user can still open our file, and CLAUDE.md's hard
 * constraint ("preserve the JSON project file format exactly") holds without
 * an exception.
 *
 * **Why the target is a name, not an index.** It mirrors how WPD itself binds a
 * dataset to its axes (`axesName: axes.name`), and an index is not stable
 * across the delete of an earlier series. The cost is that a name is mutable,
 * which is what `retargetErrorRelations`/`clearErrorRelationsTo` below exist to
 * pay -- see their notes. Checkpoint 75 made names unique, which is what makes
 * a name usable as a key at all.
 *
 * **No `errorKind`.** Deliberate, and revision 1 of the design doc: the kind
 * (SD/SEM/CI95) is not in the geometry, it is in the figure's caption, so we
 * could only ask the user to type it -- and asking means offering a default,
 * which is LabPlot's ±30 all over again (a value that looks like a measurement
 * and isn't). The meaning lives in the series' name, which the user writes.
 * David: *"we only need to give the user the numbers, and he can decide the
 * interpretation."*
 */

import type { Dataset } from '../core/dataset.js';
import { ERROR_ROLES, type ErrorRole } from '../algorithms/errorBar.js';

/** A series' declaration that it records error for another series. */
export interface ErrorRelation {
  role: ErrorRole;
  /** The `name` of the series this one carries error for. */
  of: string;
}

const ERROR_RELATION_METADATA_KEY = 'errorRelation';

function isErrorRole(value: unknown): value is ErrorRole {
  return typeof value === 'string' && (ERROR_ROLES as readonly string[]).includes(value);
}

/**
 * The relation `dataset` declares, or null if it is an ordinary series.
 *
 * Validated rather than cast: metadata is free-form and round-trips through a
 * file anyone can hand-edit (and through upstream WPD, which preserves keys it
 * does not understand), so a malformed relation is reachable without any bug of
 * ours. A junk role reads as "no relation" -- the series still shows every
 * point it holds, which degrades to an ordinary series rather than to a wrong
 * whisker.
 *
 * **A self-relation is refused HERE, not only where it is set.** The session's
 * setErrorRelation also refuses one, but that is the *controller* -- and a
 * relation arrives from a file too, where no controller ever runs. Left to the
 * controller alone, a self-relating series resolves each of its own points as
 * its own cap and reports an error of **exactly zero**: fabricated certainty,
 * which is the precise inverse of what this feature exists to prevent, and
 * invisible because a zero-length whisker draws nothing. This is checkpoint
 * 69's lesson exactly (`core/` holds the math, `controllers/` holds the guards,
 * so a faithful port silently drops every refusal) -- caught by execution
 * against new code rather than inherited. Verified 2026-07-16.
 */
export function getErrorRelation(dataset: Dataset): ErrorRelation | null {
  const raw = dataset.getMetadata()[ERROR_RELATION_METADATA_KEY];
  if (raw == null || typeof raw !== 'object') return null;
  const { role, of } = raw as Record<string, unknown>;
  if (!isErrorRole(role)) return null;
  if (typeof of !== 'string' || of.trim().length === 0) return null;
  if (of.trim() === dataset.name.trim()) return null;
  return { role, of };
}

/** Declare (or, with null, clear) the relation `dataset` carries. */
export function setErrorRelation(dataset: Dataset, relation: ErrorRelation | null): void {
  const meta = { ...dataset.getMetadata() };
  if (relation) meta[ERROR_RELATION_METADATA_KEY] = { role: relation.role, of: relation.of };
  else delete meta[ERROR_RELATION_METADATA_KEY];
  dataset.setMetadata(meta);
}

/** True when any other series carries error for `name`. */
export function hasErrorSeries(datasets: readonly Dataset[], name: string): boolean {
  return datasets.some((d) => getErrorRelation(d)?.of === name);
}

/** Every series carrying error for `name`, with the role each plays. */
export function errorSeriesFor(
  datasets: readonly Dataset[],
  name: string
): { dataset: Dataset; role: ErrorRole }[] {
  const found: { dataset: Dataset; role: ErrorRole }[] = [];
  for (const dataset of datasets) {
    const relation = getErrorRelation(dataset);
    if (relation?.of === name) found.push({ dataset, role: relation.role });
  }
  return found;
}

/**
 * Follow a rename through every relation pointing at the old name.
 *
 * **Relating by name buys stability across a delete and pays for it here.**
 * Three existing paths mutate a series' name with no idea this key exists, and
 * each would leave a relation pointing at a series that no longer answers to
 * that name -- a whisker that silently stops being drawn:
 *
 *  1. `renameDataset` -- the user renames the series the error belongs to.
 *  2. `dedupeDatasetNames` on load -- our own 0.2.0 files can hold duplicate
 *     names (checkpoint 75's bug), so *opening a file* can rename a series.
 *  3. `loadCalibrated`, which calls (2).
 *
 * That is **one class, not three instances** -- checkpoint 72's lesson, which
 * found checkpoint 69 had "fixed two instances of two bug classes and is
 * written as if it fixed the classes". So the cascade lives here, beside the
 * key it protects, and every path that renames calls it rather than each
 * remembering the invariant.
 */
export function retargetErrorRelations(
  datasets: readonly Dataset[],
  oldName: string,
  newName: string
): void {
  if (oldName === newName) return;
  for (const dataset of datasets) {
    const relation = getErrorRelation(dataset);
    if (relation?.of === oldName) setErrorRelation(dataset, { ...relation, of: newName });
  }
}

/**
 * Drop every relation pointing at a series that is going away.
 *
 * The sibling of retargetErrorRelations, for `removeDataset`. Clearing beats
 * leaving it dangling: a stale relation would silently re-attach if a later
 * series happened to take the freed name, resurrecting error against data it
 * was never measured from. The error *points* are untouched -- deleting the
 * curve must not silently delete the measurements taken from the figure, and
 * the series remains, now an ordinary one, visible and re-relatable.
 */
export function clearErrorRelationsTo(datasets: readonly Dataset[], removedName: string): void {
  for (const dataset of datasets) {
    if (getErrorRelation(dataset)?.of === removedName) setErrorRelation(dataset, null);
  }
}
