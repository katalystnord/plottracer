/**
 * A category axis (v2.0 groundwork) — an ordered, named list of categories
 * that one or more datasets can share, so renaming or reordering a category
 * updates every bound series' table cell from one place instead of N copies
 * of a free-text string.
 *
 * ⚑ NOT a port, and NOT a `CalibratedAxes`. Every other axes class in
 * `core/axes/` traces back to wpd-core and satisfies the shared
 * `calibrate`/`pixelToData`/`dataToPixel` contract (`core/axes/types.ts`) —
 * a category axis has no pixel transform at all: it is a plain ordered name
 * list, deliberately kept separate from the value axis it stands beside.
 * This is a genuinely new class for v2.0's bar model, unwired from any
 * session or `PlotData` binding yet (that lands in a later v2.0 phase).
 *
 * A tuple's category is recorded as an INDEX into this list (see
 * `Dataset`'s per-pixel `metadata.categoryIndex`, planned for the same
 * phase that wires this in) rather than a copied string — replacing today's
 * `metadata.label` free-text mechanism
 * (`CalibrationSession.getTupleLabel`/`setTupleLabel`), where two series
 * naming "the same" category independently have no way to be told they
 * agree, and a rename means finding and editing every copy by hand.
 *
 * Always stores strings, never coerces — a numeric-looking category (e.g.
 * "2019", "2020" as x-axis labels on an otherwise-categorical chart) stays
 * text here by construction, satisfying tenet 9 without a special case.
 */
export class CategoryAxis {
  name = 'Category';

  private _categories: string[] = [];

  /** Appends a new category and returns its index. */
  addCategory(name: string): number {
    this._categories.push(name);
    return this._categories.length - 1;
  }

  /** Renames an existing category in place. Every dataset bound to this axis
   * and referencing `index` reflects the new name immediately, since they
   * hold the index, not a copy of the string. False for an out-of-range
   * index, mirroring `Dataset.setTupleLabel`'s validity-signaling
   * convention. */
  renameCategory(index: number, newName: string): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this._categories.length) return false;
    this._categories[index] = newName;
    return true;
  }

  getCategories(): readonly string[] {
    return this._categories;
  }

  getCategoryCount(): number {
    return this._categories.length;
  }

  getCategoryIndex(name: string): number {
    return this._categories.indexOf(name);
  }

  /**
   * True permutation-checked reorder, mirroring `Dataset.reorderPixels`
   * exactly: `order[newIndex] = oldIndex`. Refuses (returns false, leaves
   * the list untouched) unless `order` is a genuine permutation of
   * `0..count-1` — out of range, wrong length, or the same index twice all
   * refuse rather than silently reinterpreting a bad list.
   *
   * ⚑ This class has no reference to any dataset bound to it, so it cannot
   * remap a bound tuple's `metadata.categoryIndex` through the same
   * permutation itself — that remap is the wiring phase's responsibility
   * (mirroring how `CalibrationSession`, not `Dataset`, currently owns
   * `prefillCategoryLabel`). Reordering the names here without also
   * remapping every bound reference would silently reassign categories;
   * the wiring phase must do both in the same operation.
   */
  reorderCategories(order: readonly number[]): boolean {
    const n = this._categories.length;
    if (order.length !== n) return false;
    const seen = new Array<boolean>(n).fill(false);
    for (const oldIndex of order) {
      if (!Number.isInteger(oldIndex) || oldIndex < 0 || oldIndex >= n || seen[oldIndex]) return false;
      seen[oldIndex] = true;
    }
    this._categories = order.map((oldIndex) => this._categories[oldIndex]!);
    return true;
  }

  /**
   * Removes a category by index, shifting every later index down by one.
   *
   * ⚑ Deliberately NOT guarded against orphaning a bound tuple — this class
   * cannot see who is bound to it (see `reorderCategories`'s comment). The
   * plan's own rule ("never silently orphans a bound tuple — refuse or
   * flag, not reindex-and-forget") is the WIRING layer's job: it must check
   * every bound dataset for a tuple still referencing `index` before
   * calling this, and remap every later `categoryIndex` down by one
   * afterward, in the same operation. Calling this directly, unwired, WILL
   * silently reassign every later category — that is intentional here and
   * dangerous everywhere else, which is exactly why it isn't wired to
   * anything yet.
   */
  removeCategory(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this._categories.length) return false;
    this._categories.splice(index, 1);
    return true;
  }
}
