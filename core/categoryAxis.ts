/**
 * A category axis (v2.0 groundwork) - an ordered, named list of categories
 * that one or more datasets can share, so renaming or reordering a category
 * updates every bound series' table cell from one place instead of N copies
 * of a free-text string.
 *
 * ⚑ NOT a port, and NOT a `CalibratedAxes`. Every other axes class in
 * `core/axes/` traces back to wpd-core and satisfies the shared
 * `calibrate`/`pixelToData`/`dataToPixel` contract (`core/axes/types.ts`) -
 * a category axis has no pixel transform at all: it is a plain ordered name
 * list, deliberately kept separate from the value axis it stands beside.
 * This is a genuinely new class for v2.0's bar model, unwired from any
 * session or `PlotData` binding yet (that lands in a later v2.0 phase).
 *
 * A tuple's category is recorded as an INDEX into this list (see
 * `Dataset`'s per-pixel `metadata.categoryIndex`, planned for the same
 * phase that wires this in) rather than a copied string - replacing today's
 * `metadata.label` free-text mechanism
 * (`CalibrationSession.getTupleLabel`/`setTupleLabel`), where two series
 * naming "the same" category independently have no way to be told they
 * agree, and a rename means finding and editing every copy by hand.
 *
 * Always stores strings, never coerces - a numeric-looking category (e.g.
 * "2019", "2020" as x-axis labels on an otherwise-categorical chart) stays
 * text here by construction, satisfying tenet 9 without a special case.
 */
import {
  BandedAxis,
  bandIndexForParam,
  dividerParamsFrom,
  generateTickParams,
  paramAtPoint,
  pointAtParam,
  tickCountFor,
  type CategoryAxisPoint,
  type TickConvention,
} from './bandedAxis.js';

// ⚑ RE-EXPORTED, not moved away. The band geometry now lives in
// `core/bandedAxis.ts` because it is not a category axis's private business -
// but eight modules already import these names from here, and churning their
// import lines would say something changed for them when nothing did.
export {
  bandIndexForParam,
  dividerParamsFrom,
  generateTickParams,
  paramAtPoint,
  pointAtParam,
  tickCountFor,
};
export type { CategoryAxisPoint, TickConvention };

export class CategoryAxis {
  name = 'Category';

  private _categories: string[] = [];

  /**
   * The band mechanism - edges, convention, generated ticks, dividers, the
   * adjustment flag and the drag. COMPOSED, not inherited and not copied.
   *
   * ⚑⚑ This class is two things, and only one of them is bar-specific. The
   * NAME LIST below is: a bar chart's datasets bind to it, which is exactly why
   * a heatmap must not share it - one axis would rename the other. The BANDS
   * are not, and reading the memo's "not `core/categoryAxis.ts`" as covering
   * both halves is what produced a second divider store, a second set of marker
   * graphics and a second count box in v2.2. See `core/bandedAxis.ts`.
   *
   * ⚑ The one fact that stays HERE is the count: for a category axis the number
   * of bands IS the name list's length, so it is synchronised on regeneration
   * rather than stored twice. `BandedAxis` keeps its own count because an axis
   * with no names still has bands - which is the whole reason a heatmap's value
   * axis can have a grid at all.
   */
  private _bands = new BandedAxis();

  /**
   * Whether the user has DECLARED how many categories there are.
   *
   * ⚑ NOT the same as `getCategoryCount() > 0`, and reading one for the other was
   * a real defect (code review, 2026-08-10). Categories also come into existence
   * one at a time as bars are captured on the un-ticked path, so a session with a
   * marked axis and no declared count would flip from the old path to the band
   * path THE MOMENT THE FIRST BAR reserved a slot - the first bar filed one way
   * and every later bar the other. "How many exist" and "how many were declared"
   * are different facts and have to be stored as such.
   */
  private _countDeclared = false;

  /**
   * The user has said the ticks are where they want them - the stage's ENDING.
   *
   * ⚑⚑ NOT the same as "the ticks exist", and that difference is the whole
   * reason it is stored. Since v2.4 the axis and its count arrive with the
   * calibration walk, so ticks exist the instant the walk finishes - and a card
   * that folded on THAT would close itself at the exact moment the user was
   * about to drag a marker onto the figure's own rule. The heatmap has the same
   * shape and answers it the same way: its stage ends when `Read cells` produces
   * a record, not when a grid becomes possible.
   *
   * ⚑ It is on the MODEL rather than in the component so a reopened project does
   * not ask for the marking again. Dropped by `clearGeometry`, because ticks
   * nobody has placed cannot have been accepted.
   */
  private _marked = false;

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
   * `0..count-1` - out of range, wrong length, or the same index twice all
   * refuse rather than silently reinterpreting a bad list.
   *
   * ⚑ This class has no reference to any dataset bound to it, so it cannot
   * remap a bound tuple's `metadata.categoryIndex` through the same
   * permutation itself - that remap is the wiring phase's responsibility
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
   * ⚑ Deliberately NOT guarded against orphaning a bound tuple - this class
   * cannot see who is bound to it (see `reorderCategories`'s comment). The
   * plan's own rule ("never silently orphans a bound tuple - refuse or
   * flag, not reindex-and-forget") is the WIRING layer's job: it must check
   * every bound dataset for a tuple still referencing `index` before
   * calling this, and remap every later `categoryIndex` down by one
   * afterward, in the same operation. Calling this directly, unwired, WILL
   * silently reassign every later category - that is intentional here and
   * dangerous everywhere else, which is exactly why it isn't wired to
   * anything yet.
   */
  removeCategory(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= this._categories.length) return false;
    this._categories.splice(index, 1);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Geometry (v2.1). An AID, not a calibration: no measured VALUE depends on any
  // of it. A bar reads its value from the calibrated value axis and auto-extract
  // finds bars from ink; ticks only DIVIDE and LABEL. A misplaced tick costs a
  // mislabelled row, visible in the table and fixed by a drag - never a wrong
  // number. If a future reader finds an argument here that tick precision
  // threatens a value, the argument is wrong.
  // ---------------------------------------------------------------------------

  /**
   * Place the two edges that ARE the category axis, and regenerate the ticks.
   *
   * ⚑ Refuses a degenerate axis rather than reporting success on it - the
   * `calibrate()`-that-cannot-fail shape this project has now found five times.
   * Two coincident edges make `paramAtPoint` divide by zero, so every tick, every
   * divider and every category assignment would read back NaN with nothing on
   * screen wrong.
   */
  setAxisEdges(a: CategoryAxisPoint, b: CategoryAxisPoint): boolean {
    // ⚑ The degenerate-axis refusal lives in `BandedAxis.setEdges` now - tested
    // as a LENGTH rather than as coordinate equality, because two endpoints a
    // denormal distance apart are distinct points whose squared length
    // underflows to zero and divides to Infinity rather than NaN.
    if (!this._bands.setEdges(a, b)) return false;
    this.regenerateTicks();
    return true;
  }

  getAxisEdges(): readonly [CategoryAxisPoint, CategoryAxisPoint] | null {
    return this._bands.getEdges();
  }

  /** True once the axis is marked, i.e. once any of this is meaningful. */
  hasGeometry(): boolean {
    return this._bands.hasGeometry();
  }

  /**
   * ⚑⚑ `clearGeometry` WAS HERE, AND IS GONE WITH ITS LAST CALLER.
   *
   * It dropped the bands and the marks while keeping the names, for the two
   * session mutators `clearCategoryAxisGeometry` ("Re-place axis") and
   * `removeCategoryTicks` ("Remove ticks"). Since v2.4 the category axis IS
   * calibration steps c1/c2: re-placing it is dragging those handles, and the
   * "Remove ticks" button no longer exists, so neither gesture reaches this.
   *
   * ⚠️ IT IS WORTH KNOWING WHAT IT COST WHILE IT LIVED. This method used to
   * clear `_countDeclared` too, contradicting `BandedAxis.clearGeometry` one
   * level down - and that is exactly how the v2.3 minting defect got in:
   * "Re-place axis" kept the names and brought the bands back while the model
   * believed nobody had declared a count, so the next bar captured was filed
   * into a freshly minted category instead of the band it sits in. A geometry
   * that can be dropped independently of the declaration is what made two
   * facts able to disagree; the walk owning both is what closed it.
   */

  /** The stage's ending: these ticks are where the figure's own boundaries are.
   * See `_marked`. */
  markCategories(): void {
    this._marked = true;
  }

  /** Whether that ending has been pressed. */
  categoriesMarked(): boolean {
    return this._marked;
  }

  /**
   * ⚑ `undeclareCount` WAS HERE. Its only caller was `removeCategoryTicks`,
   * the "Remove ticks" button, which the v2.4 card rebuild removed: there is no
   * state with an axis and no ticks to get back to. Nothing withdraws a
   * declaration any more - the count is typed on the click that places the
   * second end, and correcting it means editing it there.
   */

  getConvention(): TickConvention {
    return this._bands.getConvention();
  }

  /** Switching convention regenerates, which is the point: the marks move on
   * screen and the user sees which one matches the figure. */
  setConvention(convention: TickConvention): boolean {
    if (!this._bands.setConvention(convention)) return false;
    this.regenerateTicks();
    return true;
  }

  /**
   * Declare how many categories the figure has, resizing the name list to match
   * and regenerating the ticks.
   *
   * ⚑ The count is NOT stored separately - it IS `_categories.length`. Two
   * fields holding one fact is how they come to disagree; see
   * `ticksAreStale()` for the one place that difference can still appear.
   * Growing adds unnamed categories (a dash at rest, never an invented name);
   * shrinking drops the trailing ones.
   */
  setCategoryCount(count: number): boolean {
    if (!Number.isInteger(count) || count < 1) return false;
    // Rebuilt in one expression rather than grown-then-truncated: setting
    // `.length` on a short array leaves HOLES, and a hole reads back as
    // `undefined` where every consumer expects the empty string of an unnamed
    // category. This shape cannot produce one.
    this._categories = Array.from({ length: count }, (_, i) => this._categories[i] ?? '');
    this._countDeclared = true;
    this.regenerateTicks();
    return true;
  }

  /**
   * Rebuild the evenly spaced ticks from the edges, the convention and the
   * category count, discarding any manual adjustment.
   *
   * ⚑ Callers must warn BEFORE calling this when `hasAdjustments()` - silently
   * reverting someone's corrections is the failure this flag exists to prevent.
   */
  regenerateTicks(): boolean {
    // ⚑ The count is synchronised HERE and only here, because for a category
    // axis it is not a separate fact: it IS the name list's length. An empty
    // list has no bands at all, which `BandedAxis.setCount` refuses to express
    // on purpose - zero columns is not a figure - so the empty case takes the
    // other door rather than passing a meaningless count through the one that
    // guards a heatmap's declaration.
    const declared = this._categories.length;
    if (declared >= 1) this._bands.setCount(declared);
    else this._bands.clearBands();
    return this._bands.hasGeometry();
  }

  /**
   * Restore ticks from a loaded file, validating them the way the interactive
   * path does. Returns true if the stored set was usable, false if it was
   * rejected and regenerated instead.
   *
   * ⚑ THE LOAD PATH IS THE MODEL'S OTHER ENTRANCE, and this project has been
   * bitten repeatedly by a guard that only the click path reaches. A stored tick
   * list must be finite, strictly inside the axis, strictly increasing, and the
   * right LENGTH for the convention and category count - exactly the invariants
   * `moveTick` maintains - or a hand-edited file would put the model in a state
   * no sequence of clicks can produce.
   *
   * ⚑ It REPAIRS rather than refusing, and that is a deliberate consequence of
   * ticks being an aid: regenerating loses nothing measured, where refusing the
   * load would cost the user their actual data over a broken hint. Same
   * "surface, don't refuse" stance `loadCalibrated` already takes.
   */
  restoreTickParams(params: readonly number[], adjusted = false): boolean {
    // ⚑ Sync the count first: `BandedAxis` validates the stored list's LENGTH
    // against its own declared count, and for a category axis that count is the
    // name list's length. Without this the file door would measure against a
    // stale number - the drift `ticksAreStale` exists to report, silently
    // deciding a load instead.
    const declared = this._categories.length;
    if (declared >= 1) {
      if (declared !== this._bands.getCount()) this._bands.setCount(declared);
    } else {
      this._bands.clearBands();
    }
    return this._bands.restoreTickParams(params, adjusted);
  }

  /** Whether the tick set still matches the declared category count. Only ever
   * true if a category was added or removed through the naming path without a
   * regeneration - the one way the two can drift apart.
   *
   * ⚑ Measured against the NAME LIST, not against the band mechanism's own
   * count, because that drift is precisely what this reports: `addCategory`
   * deliberately does not regenerate, so the two numbers are allowed to differ
   * until someone asks. */
  ticksAreStale(): boolean {
    if (!this._bands.hasGeometry()) return false;
    return this._bands.getTickParams().length !== tickCountFor(this.getConvention(), this._categories.length);
  }

  getTickParams(): readonly number[] {
    return this._bands.getTickParams();
  }

  getTickPoints(): CategoryAxisPoint[] {
    return this._bands.getTickPoints();
  }

  /** The N+1 dividers bounding the N bands - see `dividerParamsFrom`. */
  getDividerParams(): number[] {
    return this._bands.getDividerParams();
  }

  getDividerPoints(): CategoryAxisPoint[] {
    return this._bands.getDividerPoints();
  }

  hasAdjustments(): boolean {
    return this._bands.hasAdjustments();
  }

  /** Whether a category COUNT has been declared - the thing that turns a marked
   * axis into usable bands. See `_countDeclared`. */
  hasDeclaredCount(): boolean {
    return this._countDeclared;
  }

  /** Restoring a loaded file's declared-count flag. Geometry in a project file
   * only ever gets there through the panel, which cannot leave without a count,
   * so a stored geometry with categories means one was declared. */
  markCountDeclared(): void {
    this._countDeclared = true;
  }

  /**
   * Drag one tick, by projecting `point` onto the axis.
   *
   * Clamped strictly between its neighbours (and inside the axis edges), so a
   * tick can never cross another or leave the span. That keeps tick *i* the
   * divider for category *i* by construction - reordering under the drag would
   * silently reassign categories, which is the defect this whole feature exists
   * to remove.
   */
  moveTick(index: number, point: CategoryAxisPoint): boolean {
    return this._bands.moveTick(index, point);
  }

  /**
   * Which category `point` belongs to - the band it falls in, projected onto the
   * axis. Null when there is no geometry to answer with.
   *
   * This is what replaces the nearest-donor name prefill: a declaration instead
   * of a guess, with no dependence on which series was captured first.
   */
  bandIndexAt(point: CategoryAxisPoint): number | null {
    return this._bands.bandIndexAt(point);
  }

  /**
   * Where `point` sits among the categories as a continuous coordinate - a
   * category's centre is its own index, its dividers half a band either side.
   *
   * What `bandIndexAt` is for identity, this is for EXTENT: a bar is captured as
   * two opposite corners, and the width between them is a measurement no integer
   * index can carry (F21).
   */
  bandCoordinateAt(point: CategoryAxisPoint): number | null {
    return this._bands.bandCoordinateAt(point);
  }
}
