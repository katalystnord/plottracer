/**
 * Series-name validation and disambiguation.
 *
 * **Why this exists now.** Series names are about to stop being cosmetic. The
 * error-capture model agreed 2026-07-16 (see docs/error-bars-design.md) relates
 * one series to another *by name* — mirroring how WPD binds a dataset to its
 * axes (`axesName: axes.name`) — so a duplicate name stops being an untidy CSV
 * header and becomes an ambiguous relationship. David: *"we need to move to
 * unique series names… under this way of looking at things, that is a must."*
 *
 * **Ported from WPD's controller layer, which is where its refusals live.**
 * `controllers/datasetManagement.js:23-30` is `datasetWithNameExists`, checked
 * on rename (`:72-76`) and on add (`:109-115`); `:53-56` bumps the default
 * name's suffix until it's free. `core/` never carried any of it — the same
 * shape as checkpoint 69's finding that `core/` holds the math while
 * `controllers/` holds the guards, so a faithful `core/` port silently drops
 * every refusal.
 *
 * **Verified by execution before writing this** — all four paths were
 * unguarded, and one is a live bug with nothing to do with error bars: rename
 * "Series 1" to "Series 2", press Add, and you get two series named "Series 2",
 * because the auto-namer trusts a counter that a rename invalidates. The
 * counter's own comment claimed names "stay unique", which held for
 * add/remove but not for rename.
 *
 * Comparison is **exact after trimming**, matching WPD's own `indexOf(name)`
 * against trimmed input. Deliberately not case-insensitive: "SD" and "sd" are
 * distinct column headers, upstream allows both, and diverging here would be a
 * silent behaviour change for no stated need.
 *
 * Pure and headless per CLAUDE.md's leg (c): no DOM, no session imports.
 */

/** Empty names are OUR rule, not WPD's — recorded as a decision, not parity.
 * `datasetManagement.js` only ever calls `.trim()`; it has no empty check
 * anywhere. We refuse blanks because a series name is a CSV column header, and
 * a blank header is unreadable output rather than merely untidy state. */
const EMPTY_NAME_ERROR = 'A series needs a name.';

/**
 * Why `name` can't be used, or null if it can.
 *
 * `otherNames` must exclude the series being named — renaming a series to what
 * it is already called is not a conflict.
 */
export function datasetNameError(name: string, otherNames: readonly string[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return EMPTY_NAME_ERROR;
  if (otherNames.some((other) => other.trim() === trimmed)) {
    return `A series called "${trimmed}" already exists.`;
  }
  return null;
}

/**
 * `desired`, or the first free `desired (2)`, `desired (3)`… variant.
 *
 * For names the user did not choose: the auto-namer, and de-duplicating a
 * loaded project that predates this guard. A name the user *typed* gets
 * refused instead (see datasetNameError) — silently substituting a different
 * name for one they asked for would ignore their intent, which is why WPD
 * refuses a typed duplicate but bumps its own default. Same split here.
 */
export function uniqueDatasetName(desired: string, otherNames: readonly string[]): string {
  const base = desired.trim() || 'Series';
  const taken = (candidate: string) => otherNames.some((other) => other.trim() === candidate);
  if (!taken(base)) return base;
  let suffix = 2;
  while (taken(`${base} (${suffix})`)) suffix++;
  return `${base} (${suffix})`;
}

/**
 * Rename as few of `names` as it takes to make them all unique and non-empty,
 * preserving order and keeping each first occurrence untouched.
 *
 * For the load path. Our own 0.2.0 files can already contain duplicates (the
 * auto-namer bug above), so a project can arrive violating the invariant that
 * the rest of the app is about to depend on. Fixing it on load is the honest
 * move: the alternative is refusing to open a file the previous version wrote.
 */
export function dedupeDatasetNames(names: readonly string[]): string[] {
  const settled: string[] = [];
  for (const name of names) {
    settled.push(uniqueDatasetName(name.trim() || 'Series', settled));
  }
  return settled;
}
