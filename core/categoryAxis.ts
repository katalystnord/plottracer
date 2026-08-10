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
/**
 * Which printed tick a figure draws, and therefore what the user is pointing at
 * (v2.1). Measured, not guessed: across the 381 bar charts in the ICPR ground
 * truth that carry an `_x-tick-type`, 242 (63.5%) print a tick UNDER each
 * category (matplotlib, ggplot) and 139 (36.5%) print one BETWEEN them (Excel).
 * Neither is safe to assume, so it is a switchable declaration — offered as a
 * toggle beside the category count rather than as a question, because flipping
 * it moves the marks on screen and the answer is then visible on the figure.
 */
export type TickConvention = 'centred' | 'edge';

/** A pixel position in image coordinates. */
export interface CategoryAxisPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * How many ticks `categoryCount` categories produce. `centred` draws one under
 * each category; `edge` draws one between each adjacent pair, so the outermost
 * two dividers are the axis edges rather than ticks (see `dividerParamsFrom`).
 * Zero for a count that is not a positive integer.
 */
export function tickCountFor(convention: TickConvention, categoryCount: number): number {
  if (!Number.isInteger(categoryCount) || categoryCount < 1) return 0;
  return convention === 'centred' ? categoryCount : categoryCount - 1;
}

/**
 * The evenly spaced tick positions, as PARAMETERS along the axis: 0 at the
 * first edge, 1 at the second.
 *
 * ⚑ Parameters, not pixels, and that is the whole reason the geometry survives
 * an image edit for free. A rotation or a crop moves the two edge pixels; every
 * tick is defined relative to them, so the set follows by construction instead
 * of needing its own pass in `transformAllPixels`. It also makes the generated
 * positions exact rather than rounded through pixel space.
 */
export function generateTickParams(convention: TickConvention, categoryCount: number): number[] {
  // No `n === 0` early return: `Array.from({length: 0})` is already `[]`, so the
  // guard could not change an answer -- and a guard that cannot fire is the shape
  // this codebase has been bitten by five times. A refused count reaches here as
  // n = 0 and falls out empty.
  const n = tickCountFor(convention, categoryCount);
  const total = categoryCount;
  return convention === 'centred'
    ? Array.from({ length: n }, (_, i) => (i + 0.5) / total)
    : Array.from({ length: n }, (_, i) => (i + 1) / total);
}

/**
 * The N+1 dividers bounding N bands, in parameter space.
 *
 * ⚑ BOTH conventions resolve to the same N+1 dividers, and the two axis EDGES
 * are what completes either set — in `edge` the ticks are already dividers, in
 * `centred` the dividers are the midpoints between adjacent ticks. Using the
 * edges as the outer two is INTERNAL: on screen they stay the axis, and nothing
 * tells the user they double as ticks.
 */
export function dividerParamsFrom(
  convention: TickConvention,
  tickParams: readonly number[]
): number[] {
  const interior =
    convention === 'edge'
      ? [...tickParams]
      : tickParams.slice(0, -1).map((t, i) => (t + tickParams[i + 1]!) / 2);
  return [0, ...interior, 1];
}

/**
 * Which band a parameter falls in, given `dividers` from `dividerParamsFrom`.
 *
 * ⚑ The outermost bands are UNBOUNDED — anything left of the first divider is
 * category 0 and anything right of the last is category N-1. A bar sitting just
 * outside the declared span still belongs to the category it is nearest, which
 * is what a reader would say looking at the figure.
 */
export function bandIndexForParam(t: number, dividers: readonly number[]): number | null {
  const bands = dividers.length - 1;
  if (bands < 1 || !Number.isFinite(t)) return null;
  for (let i = 0; i < bands; i++) {
    if (t < dividers[i + 1]!) return i;
  }
  return bands - 1;
}

/** Where `t` sits in image coordinates, 0 at the first edge and 1 at the second. */
export function pointAtParam(
  edges: readonly [CategoryAxisPoint, CategoryAxisPoint],
  t: number
): CategoryAxisPoint {
  const [a, b] = edges;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

/**
 * `point` projected onto the axis, as a parameter. Deliberately NOT clamped:
 * a bar outside the declared span reads past 0 or 1, and `bandIndexForParam`
 * decides what that means rather than this function silently pretending the
 * point was inside.
 */
export function paramAtPoint(
  edges: readonly [CategoryAxisPoint, CategoryAxisPoint],
  point: CategoryAxisPoint
): number {
  const [a, b] = edges;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  // ⚑ NOT redundant, and the first draft's test could not tell. For two
  // IDENTICAL points the unguarded arithmetic is 0/0 and yields NaN on its own,
  // which is why removing this line left every test green. But two points a
  // DENORMAL distance apart underflow lenSq to zero while the numerator stays
  // finite -- that divides to +/-Infinity, and an Infinity parameter sails
  // through `Number.isFinite`-less callers as a real position. `axisLengthSq`
  // below refuses such an axis at the door for the same reason.
  if (lenSq === 0) return NaN;
  return ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
}

function isUsablePoint(p: CategoryAxisPoint | undefined): p is CategoryAxisPoint {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** The squared length of the axis, as the arithmetic that will actually divide
 * by it computes it. Zero here is the exact condition `paramAtPoint` cannot
 * survive — which is NOT the same as "the two points are equal", since a
 * denormally short axis underflows to zero with distinct endpoints. */
function axisLengthSq(a: CategoryAxisPoint, b: CategoryAxisPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export class CategoryAxis {
  name = 'Category';

  private _categories: string[] = [];

  /** The two placed points that ARE the category axis (v2.1) — its line, its
   * direction and its span. Null until the user marks it. Never presented as
   * ticks, and frozen once placed: every tick is a function of these two, so
   * moving one moves all of them (see `setAxisEdges`). */
  private _edges: [CategoryAxisPoint, CategoryAxisPoint] | null = null;

  private _convention: TickConvention = 'centred';

  /** Tick positions as parameters along the axis — see `generateTickParams`. */
  private _tickParams: number[] = [];

  /** Whether any tick has been dragged since the last generation. Regeneration
   * discards those adjustments, so the caller needs to know to say so first
   * rather than silently reverting the user's corrections. */
  private _adjusted = false;

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

  // ---------------------------------------------------------------------------
  // Geometry (v2.1). An AID, not a calibration: no measured VALUE depends on any
  // of it. A bar reads its value from the calibrated value axis and auto-extract
  // finds bars from ink; ticks only DIVIDE and LABEL. A misplaced tick costs a
  // mislabelled row, visible in the table and fixed by a drag — never a wrong
  // number. If a future reader finds an argument here that tick precision
  // threatens a value, the argument is wrong.
  // ---------------------------------------------------------------------------

  /**
   * Place the two edges that ARE the category axis, and regenerate the ticks.
   *
   * ⚑ Refuses a degenerate axis rather than reporting success on it — the
   * `calibrate()`-that-cannot-fail shape this project has now found five times.
   * Two coincident edges make `paramAtPoint` divide by zero, so every tick, every
   * divider and every category assignment would read back NaN with nothing on
   * screen wrong.
   */
  setAxisEdges(a: CategoryAxisPoint, b: CategoryAxisPoint): boolean {
    if (!isUsablePoint(a) || !isUsablePoint(b)) return false;
    // ⚑ Tested as a LENGTH, not as `a.x === b.x && a.y === b.y`. Coordinate
    // equality misses the axis whose endpoints differ denormally: distinct
    // points, but a squared length that underflows to zero, which divides to
    // Infinity rather than NaN. Ask the same question the arithmetic asks.
    if (axisLengthSq(a, b) === 0) return false;
    this._edges = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
    this.regenerateTicks();
    return true;
  }

  getAxisEdges(): readonly [CategoryAxisPoint, CategoryAxisPoint] | null {
    return this._edges;
  }

  /** True once the axis is marked, i.e. once any of this is meaningful. */
  hasGeometry(): boolean {
    return this._edges !== null;
  }

  /** Drops the geometry entirely, leaving the category NAMES untouched — the
   * un-ticked path is a supported way to work, not a broken state. */
  clearGeometry(): void {
    this._edges = null;
    this._tickParams = [];
    this._adjusted = false;
  }

  getConvention(): TickConvention {
    return this._convention;
  }

  /** Switching convention regenerates, which is the point: the marks move on
   * screen and the user sees which one matches the figure. */
  setConvention(convention: TickConvention): boolean {
    if (convention !== 'centred' && convention !== 'edge') return false;
    this._convention = convention;
    this.regenerateTicks();
    return true;
  }

  /**
   * Declare how many categories the figure has, resizing the name list to match
   * and regenerating the ticks.
   *
   * ⚑ The count is NOT stored separately — it IS `_categories.length`. Two
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
    this.regenerateTicks();
    return true;
  }

  /**
   * Rebuild the evenly spaced ticks from the edges, the convention and the
   * category count, discarding any manual adjustment.
   *
   * ⚑ Callers must warn BEFORE calling this when `hasAdjustments()` — silently
   * reverting someone's corrections is the failure this flag exists to prevent.
   */
  regenerateTicks(): boolean {
    if (!this._edges) {
      this._tickParams = [];
      this._adjusted = false;
      return false;
    }
    this._tickParams = generateTickParams(this._convention, this._categories.length);
    this._adjusted = false;
    return true;
  }

  /**
   * Restore ticks from a loaded file, validating them the way the interactive
   * path does. Returns true if the stored set was usable, false if it was
   * rejected and regenerated instead.
   *
   * ⚑ THE LOAD PATH IS THE MODEL'S OTHER ENTRANCE, and this project has been
   * bitten repeatedly by a guard that only the click path reaches. A stored tick
   * list must be finite, strictly inside the axis, strictly increasing, and the
   * right LENGTH for the convention and category count — exactly the invariants
   * `moveTick` maintains — or a hand-edited file would put the model in a state
   * no sequence of clicks can produce.
   *
   * ⚑ It REPAIRS rather than refusing, and that is a deliberate consequence of
   * ticks being an aid: regenerating loses nothing measured, where refusing the
   * load would cost the user their actual data over a broken hint. Same
   * "surface, don't refuse" stance `loadCalibrated` already takes.
   */
  restoreTickParams(params: readonly number[], adjusted = false): boolean {
    if (!this._edges) return false;
    const expected = tickCountFor(this._convention, this._categories.length);
    const usable =
      Array.isArray(params) &&
      params.length === expected &&
      params.every((t, i) => Number.isFinite(t) && t > 0 && t < 1 && (i === 0 || t > params[i - 1]!));
    if (!usable) {
      this.regenerateTicks();
      return false;
    }
    this._tickParams = [...params];
    this._adjusted = adjusted;
    return true;
  }

  /** Whether the tick set still matches the declared category count. Only ever
   * true if a category was added or removed through the naming path without a
   * regeneration — the one way the two can drift apart. */
  ticksAreStale(): boolean {
    if (!this._edges) return false;
    return this._tickParams.length !== tickCountFor(this._convention, this._categories.length);
  }

  getTickParams(): readonly number[] {
    return this._tickParams;
  }

  getTickPoints(): CategoryAxisPoint[] {
    const edges = this._edges;
    if (!edges) return [];
    return this._tickParams.map((t) => pointAtParam(edges, t));
  }

  /** The N+1 dividers bounding the N bands — see `dividerParamsFrom`. */
  getDividerParams(): number[] {
    if (!this._edges) return [];
    return dividerParamsFrom(this._convention, this._tickParams);
  }

  getDividerPoints(): CategoryAxisPoint[] {
    const edges = this._edges;
    if (!edges) return [];
    return this.getDividerParams().map((t) => pointAtParam(edges, t));
  }

  hasAdjustments(): boolean {
    return this._adjusted;
  }

  /**
   * Drag one tick, by projecting `point` onto the axis.
   *
   * Clamped strictly between its neighbours (and inside the axis edges), so a
   * tick can never cross another or leave the span. That keeps tick *i* the
   * divider for category *i* by construction — reordering under the drag would
   * silently reassign categories, which is the defect this whole feature exists
   * to remove.
   */
  moveTick(index: number, point: CategoryAxisPoint): boolean {
    const edges = this._edges;
    if (!edges) return false;
    if (!Number.isInteger(index) || index < 0 || index >= this._tickParams.length) return false;
    if (!isUsablePoint(point)) return false;
    const t = paramAtPoint(edges, point);
    // ⚑ Not masked by `isUsablePoint` above, and mutation testing is what showed
    // it: a FINITE but astronomically large coordinate overflows the projection
    // to Infinity. Without this the tick would be set to NaN and `moveTick`
    // would return true, reporting a move it did not make.
    if (!Number.isFinite(t)) return false;
    const EPS = 1e-6;
    const lower = (index === 0 ? 0 : this._tickParams[index - 1]!) + EPS;
    const upper = (index === this._tickParams.length - 1 ? 1 : this._tickParams[index + 1]!) - EPS;
    // ⚑ No `upper < lower` branch. Every drag already leaves EPS between a tick
    // and each neighbour, so ticks i-1 and i+1 are never closer than 2*EPS and
    // the window is never empty. Writing the branch anyway would be a refusal
    // that cannot fire, and mutation testing shows it up as exactly that.
    this._tickParams[index] = Math.min(Math.max(t, lower), upper);
    this._adjusted = true;
    return true;
  }

  /**
   * Which category `point` belongs to — the band it falls in, projected onto the
   * axis. Null when there is no geometry to answer with.
   *
   * This is what replaces the nearest-donor name prefill: a declaration instead
   * of a guess, with no dependence on which series was captured first.
   */
  bandIndexAt(point: CategoryAxisPoint): number | null {
    const edges = this._edges;
    if (!edges || !isUsablePoint(point)) return null;
    return bandIndexForParam(paramAtPoint(edges, point), this.getDividerParams());
  }
}
