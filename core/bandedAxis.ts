/**
 * A banded axis - two placed edges, a declared count, and the dividers between
 * them (v2.2). It has NO IDEA what the axis means.
 *
 * ⚑⚑ EXTRACTED, NOT WRITTEN. Every function below - `tickCountFor`,
 * `generateTickParams`, `dividerParamsFrom`, `bandIndexForParam`,
 * `pointAtParam`, `paramAtPoint` - is v2.1's category-tick geometry, moved here
 * unchanged; `core/categoryAxis.ts` now imports and re-exports them so its eight
 * consumers see no change. What is new is only the SEPARATION: that class was
 * two things fused, a banded axis and a shared NAME LIST that a bar chart's
 * datasets bind to, and only the second half is bar-specific.
 *
 * The heatmap design said v2.1's category ticks were the structural foundation,
 * and the build read *"NOT `core/categoryAxis.ts` - a heatmap has two
 * independent axes, so binding it there would make one axis rename the other"*
 * as covering the whole class. True of the names; false of the bands. From that
 * one over-application came a second divider store, a second set of marker
 * graphics and a second count box. `CategoryAxis` now composes this and keeps
 * its names; a heatmap's x and y each own one; the colour key is the same shape
 * again, which is what makes a 2.5D type's third axis an axis rather than a
 * mechanism bolted beside two.
 *
 * ⚑⚑ PARAMETER SPACE IS THE WHOLE TRICK - 0 at the first edge, 1 at the second,
 * never pixels and never data coordinates. It is what makes David's two layers
 * work: *"the tick dividers are dependent on the axis end points. If the axis
 * moves, they do too."* In parameters that is true by construction, with no
 * synchronisation pass to forget. A store of ABSOLUTE coordinates - which is
 * what the first heatmap grid used - cannot express it at all: a bare number
 * cannot say whether it should follow the axis or stay where it was put.
 *
 * ⚑ PLACING the edges and MOVING them are different verbs. Placing defines the
 * axis, so the ticks are generated fresh (bar's gesture: mark the axis, then it
 * is frozen). Moving corrects an axis that already exists, so adjustments
 * survive (the heatmap's: the calibration markers stay draggable, and dragging
 * one must not silently discard a grid the user has tuned).
 *
 * Pure: geometry in, geometry out. No image, no session, no DOM.
 */

/**
 * Which printed tick a figure draws, and therefore what the user is pointing at
 * (v2.1). Measured, not guessed: across the 381 bar charts in the ICPR ground
 * truth that carry an `_x-tick-type`, 242 (63.5%) print a tick UNDER each
 * category (matplotlib, ggplot) and 139 (36.5%) print one BETWEEN them (Excel).
 * Neither is safe to assume, so it is a switchable declaration - offered as a
 * toggle beside the category count rather than as a question, because flipping
 * it moves the marks on screen and the answer is then visible on the figure.
 */
export type TickConvention = 'centred' | 'edge';

/** The least separation two ticks may have, as a parameter along the axis -
 * sub-pixel on any real figure.
 *
 * ⚑ Shared by the drag and the LOAD door on purpose. `moveTick` leaves this much
 * on each side of a tick, which is what makes its "the window is never empty"
 * invariant true; a file that got in under a weaker rule broke it, so both
 * entrances now measure against the same constant rather than each carrying
 * their own idea of "close enough". */
const TICK_EPS = 1e-6;

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
 * are what completes either set - in `edge` the ticks are already dividers, in
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
 * ⚑ The outermost bands are UNBOUNDED - anything left of the first divider is
 * category 0 and anything right of the last is category N-1. A bar sitting just
 * outside the declared span still belongs to the category it is nearest, which
 * is what a reader would say looking at the figure.
 */
export function bandIndexForParam(t: number, dividers: readonly number[]): number | null {
  return bandIndexIn(dividers, t, 'clamp');
}

/**
 * WHERE in the bands `t` sits, as a continuous coordinate: band *k*'s centre is
 * exactly *k*, and its two dividers are half a band either side of that.
 *
 * ⚑⚑ THE BAND INDEX IS THE COARSE CASE OF THIS ONE. `bandIndexForParam` answers
 * WHICH category a pixel is in, which is what a Line reading or a bar's identity
 * needs. An EXTENT needs the fine answer: a bar is two opposite corners, and its
 * width along the category axis is a measurement that has nowhere to live in an
 * integer. Same dividers, same clamp policy at the outer bands, so the two
 * cannot disagree about which band a coordinate belongs to.
 *
 * ⚑ THE FRAME IS THE ONE A GENERATOR TAKES, which is why the centre is the
 * integer rather than the first divider: `matplotlib.bar(x, height, width)`
 * places a bar of width 0.8 centred on x, and `x` is the category index. A bar
 * filling the middle 80% of band 1 (0-based) therefore comes out as 0.6 to 1.4
 * here - readable as "0.8 wide, centred" without arithmetic on the record.
 *
 * ⚑ Bands may be UNEQUAL (every divider is draggable), so the position inside
 * the band is a parameter of that band's own width, never a fraction of the
 * axis. Outside the outermost dividers the coordinate simply continues past
 * -0.5 or N-0.5, which is the same unbounded-outer-band rule the index uses.
 */
export function bandCoordinateForParam(t: number, dividers: readonly number[]): number | null {
  const band = bandIndexIn(dividers, t, 'clamp');
  if (band === null) return null;
  const within = paramOfSpan(t, dividers[band]!, dividers[band + 1]!);
  if (!Number.isFinite(within)) return null;
  return band - 0.5 + within;
}

/**
 * ⚑⚑ THE ONE BAND LOOKUP, with its out-of-range policy NAMED at the call site.
 *
 * The v2.2 audit's reuse pass found this loop written out THREE times - here,
 * in `core/heatmapGrid.ts`'s `bandOf`, and inline in `engine/barDetectRun.ts` -
 * under TWO policies. Grepping for the name found nothing; grepping for the loop
 * found all three.
 *
 * ⚑ THE FIRST TWO DISAGREE ON PURPOSE, and both said so. A bar sitting just past
 * the last divider still belongs to the category a reader would name it, so the
 * outermost bands are UNBOUNDED there. A point outside a matrix has no row at
 * all, and inventing one would put a value in a cell the figure does not have.
 * That difference is real and it survives; what did not survive is each site
 * expressing it by writing the loop again.
 *
 * ⚠️ THE THIRD SITE NEVER STATED A CHOICE - and its clamp is why a legend
 * swatch lands in a real category instead of being reported as unplaceable
 * (v2.4, parked). Behaviour there is UNCHANGED by this consolidation; what
 * changes is that the policy is now a word someone had to type, so the v2.4 fix
 * is a one-word decision rather than an archaeology exercise.
 *
 * ⚑ `outside` has no default, deliberately. A default is how a policy gets taken
 * without being chosen - the same lesson as `readHeatmapCells`'s `kinds`.
 */
export function bandIndexIn(
  dividers: readonly number[],
  v: number,
  outside: 'clamp' | 'refuse'
): number | null {
  const bands = dividers.length - 1;
  if (bands < 1 || !Number.isFinite(v)) return null;
  // ⚑ The far edge belongs to the LAST band under both policies, so the end of a
  // grid is not a gap - the loop's fallthrough is what delivers that, and the
  // refusal below must not steal it.
  if (outside === 'refuse' && (v < dividers[0]! || v > dividers[bands]!)) return null;
  for (let i = 0; i < bands; i++) {
    if (v < dividers[i + 1]!) return i;
  }
  return bands - 1;
}

/**
 * ⚑⚑ THE AFFINE CORE - a value's position along a span, and back.
 *
 * "0 at one end, 1 at the other" was expressed TWICE: here in 2-D image space
 * (`paramAtPoint` / `pointAtParam`), and in `core/heatmapGrid.ts` in 1-D data
 * space. They were never two ideas - **the 1-D case IS the 2-D case with the
 * perpendicular component absent** - but nothing said so and nothing enforced
 * it, which is how a heatmap grid ended up with a parameter frame of its own.
 *
 * ⚑ Extracted rather than merely documented (David's call): a reason that lives
 * only in a comment is what produced this release's worst defect. `pointAtParam`
 * is now literally `valueOfSpan` per component, and `heatmapGrid` composes these
 * two directly.
 *
 * ⚠️ `paramAtPoint` CANNOT compose from these - it is a PROJECTION, because it
 * must also place points that are OFF the axis. So instead of claiming they are
 * the same code, a test asserts they give the same ANSWER wherever both are
 * defined ("AGREES WITH paramAtPoint FOR A POINT ON THE AXIS"). That is the
 * enforcement a comment could not provide.
 *
 * NOT CLAMPED, deliberately: under the `centred` tick convention the outermost
 * boundaries sit half a band BEYOND the calibration points, so a negative
 * parameter is ordinary rather than an error.
 */
export function paramOfSpan(v: number, from: number, to: number): number {
  // ⚑ NaN, not Infinity, for a span of nothing - the same degeneracy
  // `paramAtPoint` refuses, for the same reason recorded there: a span that
  // underflows to zero divides to ±Infinity, which sails through any caller
  // that only checks for NaN.
  const span = to - from;
  if (span === 0) return Number.NaN;
  return (v - from) / span;
}

/** The inverse of `paramOfSpan`. */
export function valueOfSpan(t: number, from: number, to: number): number {
  return from + t * (to - from);
}

/** Where `t` sits in image coordinates, 0 at the first edge and 1 at the second. */
export function pointAtParam(
  edges: readonly [CategoryAxisPoint, CategoryAxisPoint],
  t: number
): CategoryAxisPoint {
  // ⚑ The affine core, once per component - so this and the heatmap grid are
  // the same arithmetic rather than two copies of it.
  const [a, b] = edges;
  return { x: valueOfSpan(t, a.x, b.x), y: valueOfSpan(t, a.y, b.y) };
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
 * survive - which is NOT the same as "the two points are equal", since a
 * denormally short axis underflows to zero with distinct endpoints. */
function axisLengthSq(a: CategoryAxisPoint, b: CategoryAxisPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}




export class BandedAxis {
  /** The two placed points that ARE the axis - its line, direction and span.
   * Null until placed. Never presented as ticks. */
  private _edges: [CategoryAxisPoint, CategoryAxisPoint] | null = null;

  private _convention: TickConvention = 'centred';

  /** Tick positions as parameters along the axis - see `generateTickParams`. */
  private _tickParams: number[] = [];

  /** Whether any tick has been dragged since the last generation. Regeneration
   * discards those adjustments, so a caller must be able to say so first rather
   * than silently reverting the user's corrections. */
  private _adjusted = false;

  /** How many bands the user has DECLARED. Zero until they say.
   *
   * ⚑ Stored here, unlike `CategoryAxis` where the count IS the name list's
   * length - because an axis with no names still has bands. That coupling is
   * exactly what made a value axis unable to have a grid. */
  private _count = 0;

  /**
   * PLACE the two edges, generating ticks from scratch.
   *
   * ⚑ Refuses a degenerate axis rather than reporting success on it - the
   * `calibrate()`-that-cannot-fail shape this project has found five times. Two
   * coincident edges make `paramAtPoint` divide by zero, so every tick, divider
   * and band assignment reads back NaN with nothing on screen wrong.
   */
  setEdges(a: CategoryAxisPoint, b: CategoryAxisPoint): boolean {
    if (!this.usableEdges(a, b)) return false;
    this._edges = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
    this.regenerate();
    return true;
  }

  /**
   * MOVE the edges, keeping every tick where the user put it.
   *
   * ⚑⚑ THE ONE THING A HEATMAP NEEDS THAT A BAR CHART DOES NOT. Bar places its
   * axis once and freezes it, so `setEdges`'s regeneration is right there. A
   * heatmap's axis is its CALIBRATION, which stays draggable like every other
   * graph type's - and dragging it must move the grid without throwing away a
   * grid the user has tuned. In parameter space that is simply "do not
   * regenerate"; the pixels follow because they were never stored.
   */
  moveEdges(a: CategoryAxisPoint, b: CategoryAxisPoint): boolean {
    if (!this.usableEdges(a, b)) return false;
    this._edges = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
    return true;
  }

  private usableEdges(a: CategoryAxisPoint, b: CategoryAxisPoint): boolean {
    if (!isUsablePoint(a) || !isUsablePoint(b)) return false;
    // ⚑ Tested as a LENGTH, not coordinate equality: two endpoints a denormal
    // distance apart are distinct points whose squared length underflows to
    // zero, which divides to Infinity rather than NaN.
    return axisLengthSq(a, b) !== 0;
  }

  getEdges(): readonly [CategoryAxisPoint, CategoryAxisPoint] | null {
    return this._edges;
  }

  /** True once the axis is placed, i.e. once any of this is meaningful. */
  hasGeometry(): boolean {
    return this._edges !== null;
  }

  getConvention(): TickConvention {
    return this._convention;
  }

  /** Switching convention regenerates, which is the point: the marks move on
   * screen and the user sees which one matches the figure. */
  setConvention(convention: TickConvention): boolean {
    if (convention !== 'centred' && convention !== 'edge') return false;
    this._convention = convention;
    this.regenerate();
    return true;
  }

  getCount(): number {
    return this._count;
  }

  /**
   * Drop the bands, keeping the axis line itself.
   *
   * ⚑ The state a NAME LIST has before anyone has said how many categories
   * there are - `CategoryAxis` reaches it whenever its list is empty. A heatmap
   * axis never does: "zero columns" is not a figure, which is why `setCount`
   * refuses it at the declaration door. Two different facts, so two methods,
   * rather than one door that accepts a meaningless count to keep the other
   * caller happy.
   */
  clearBands(): void {
    this._count = 0;
    this._tickParams = [];
    this._adjusted = false;
  }

  /** Declare how many bands the axis has, regenerating the ticks. */
  setCount(count: number): boolean {
    if (!Number.isInteger(count) || count < 1) return false;
    this._count = count;
    this.regenerate();
    return true;
  }

  /**
   * Rebuild the evenly spaced ticks from the edges, the convention and the
   * count, discarding any manual adjustment.
   *
   * ⚑ Callers must warn BEFORE calling this when `hasAdjustments()` - silently
   * reverting someone's corrections is the failure that flag exists to prevent.
   */
  regenerate(): boolean {
    this._adjusted = false;
    if (!this._edges) {
      this._tickParams = [];
      return false;
    }
    this._tickParams = generateTickParams(this._convention, this._count);
    return true;
  }

  /**
   * Restore ticks from a loaded file, validating them the way the interactive
   * path does. True if the stored set was usable, false if it was rejected and
   * regenerated instead.
   *
   * ⚑ THE LOAD PATH IS THE MODEL'S OTHER ENTRANCE. A stored tick list must be
   * finite, strictly inside the axis, and SPACED - not merely increasing -
   * because `moveTick` leaves EPS on each side and a hand-edited file that got
   * in under a weaker rule puts the model in a state no sequence of clicks can
   * produce. It REPAIRS rather than refusing: ticks are an aid, so regenerating
   * loses nothing measured, where refusing the load would cost the user their
   * actual data over a broken hint.
   */
  restoreTickParams(params: readonly number[], adjusted = false): boolean {
    if (!this._edges) return false;
    const expected = tickCountFor(this._convention, this._count);
    // ⚑⚑ THE COMPARISON IS SLACKENED BY ONE ULP, and the exact figure matters.
    // "moveTick clamps to prev + EPS" is not true in floating point:
    // `(0.25 + 1e-6) - 0.25` is 9.999999999732445e-7 - BELOW EPS - and rounds
    // down like that at 78 of the 299 tick positions generated for N = 2..24.
    // Comparing against EPS exactly therefore rejects tick sets the drag itself
    // just produced, and a rejected set is REGENERATED with `_adjusted` reset,
    // so the user's drag vanishes with no warning on every project reopen AND
    // every rotate or crop. That was a v2.1 audit finding; writing this class
    // from memory reintroduced it with `Number.EPSILON` (2.2e-16), which is
    // ~10⁷ times too tight. Carried over verbatim instead.
    const MIN_GAP = TICK_EPS * (1 - 1e-9);
    const usable =
      Array.isArray(params) &&
      params.length === expected &&
      params.every(
        (t, i) =>
          Number.isFinite(t) && t > 0 && t < 1 && (i === 0 || t - params[i - 1]! >= MIN_GAP)
      );
    if (!usable) {
      this.regenerate();
      return false;
    }
    this._tickParams = [...params];
    this._adjusted = adjusted;
    return true;
  }

  /** Whether the tick set still matches the declared count. */
  ticksAreStale(): boolean {
    if (!this._edges) return false;
    return this._tickParams.length !== tickCountFor(this._convention, this._count);
  }

  getTickParams(): readonly number[] {
    return this._tickParams;
  }

  getTickPoints(): CategoryAxisPoint[] {
    const edges = this._edges;
    if (!edges) return [];
    return this._tickParams.map((t) => pointAtParam(edges, t));
  }

  /** The N+1 dividers bounding the N bands - see `dividerParamsFrom`. */
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
   * Clamped strictly between its neighbours (and inside the edges), so a tick
   * can never cross another or leave the span. That keeps tick *i* the divider
   * for band *i* by construction - reordering under the drag would silently
   * reassign every band beyond it.
   */
  moveTick(index: number, point: CategoryAxisPoint): boolean {
    const edges = this._edges;
    if (!edges) return false;
    if (!Number.isInteger(index) || index < 0 || index >= this._tickParams.length) return false;
    if (!isUsablePoint(point)) return false;
    const t = paramAtPoint(edges, point);
    // ⚑ Not masked by `isUsablePoint`, and mutation testing is what showed it: a
    // FINITE but astronomically large coordinate overflows the projection to
    // Infinity, and the tick would be set to NaN while this reported success.
    if (!Number.isFinite(t)) return false;
    const lower = (index === 0 ? 0 : this._tickParams[index - 1]!) + TICK_EPS;
    const upper = (index === this._tickParams.length - 1 ? 1 : this._tickParams[index + 1]!) - TICK_EPS;
    this._tickParams[index] = Math.min(Math.max(t, lower), upper);
    this._adjusted = true;
    return true;
  }

  /** Which band `point` falls in, projected onto the axis. Null when there is no
   * geometry to answer with. The outermost bands are unbounded - a cell drawn a
   * pixel past the plot box belongs to the band it is nearest. */
  bandIndexAt(point: CategoryAxisPoint): number | null {
    const edges = this._edges;
    if (!edges || !isUsablePoint(point)) return null;
    return bandIndexForParam(paramAtPoint(edges, point), this.getDividerParams());
  }

  /** Where `point` sits among the bands as a continuous coordinate - band k's
   * centre is k - so a MEASURED extent (a bar's two corners) has a frame to be
   * expressed in. See `bandCoordinateForParam`. */
  bandCoordinateAt(point: CategoryAxisPoint): number | null {
    const edges = this._edges;
    if (!edges || !isUsablePoint(point)) return null;
    return bandCoordinateForParam(paramAtPoint(edges, point), this.getDividerParams());
  }
}
