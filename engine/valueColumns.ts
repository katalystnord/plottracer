/**
 * ⚑⚑ WHAT A DATUM'S NUMBERS ARE CALLED, AND HOW TO READ THEM - ONE PLACE (v2.5).
 *
 * David: *"Consistency and coherency above all"*, and then *"we need to get a
 * consistent way of expressing these things that generalises well."* This module
 * is that expression. Two functions that answer in step:
 *
 *   · `valueColumnNames` - the NAMES, in order;
 *   · `valueCells`       - the READINGS, aligned to those names.
 *
 * ⚠️ WHAT ASKS THESE TODAY, stated exactly rather than aspirationally: the BAR
 * FAMILY's shared table (`BarTable`, serving Bar and Span), its value editor,
 * and the tuple export path. Those three cannot drift into three answers, which
 * is what this module was created to stop - the drift had already started, with
 * the panel deriving its columns one way and the exporter another, and a stacked
 * bar was where the two parted.
 *
 * ⛔ IT IS NOT YET THE WHOLE APP, and saying it was would be the gate-3 mistake:
 * `TupleTable` (Box Plot), `SpiderTable`, `HeatmapCellsTable`,
 * `HistogramBinsTable` and the flat spreadsheet all still answer this question
 * their own way. Bringing them in is real work, not a rename - a pie's two
 * boundary angles plus its derived proportion do not fit `valueColumnNames`'s
 * three questions as they stand.
 *
 * ⚑⚑ THE RULE IS THE FAMILY'S, NOT OURS, and it came from asking the generators
 * (tenet 11b): a datum has N NAMED VALUES, and N is a property of the TYPE.
 * `bar(x, height)` takes one, `broken_barh((xmin, xwidth))` two,
 * `Candlestick(open, high, low, close)` four, `bxp` five named keys
 * (`med, q1, q3, whislo, whishi`). So:
 *
 *   | Bar         | 1 | `Value`                          |
 *   | Span        | 2 | `Min`, `Max`                     |
 *   | Candlestick | 4 | `Open`, `High`, `Low`, `Close`   |
 *   | Box plot    | 5 | `Min`, `Q1`, `Median`, `Q3`, `Max` |
 *
 * ⚠️ WHAT THIS REPLACED, and it was mine, made the same evening. The panel grew
 * a two-column MODE to serve Span - `intervalSlots?: [string, string]` - which
 * is the N=2 case wearing the interface. David: *"you had a tendency to make
 * special cases for some groups, and forgot to look at the bigger picture."* A
 * declaration shaped like a PAIR cannot express a box plot, so the fifth type
 * would have grown a third mode beside it.
 *
 * ⚑ NOTHING NEW IS DECLARED. The answers are derived from what a type already
 * says about its record, in the order the record answers them - so there is no
 * second declaration to keep in step with the first.
 */
import type { CalibratedAxes, DataPointView } from './axesTypeConfigs.js';

/** The part of a type's config these questions need - narrow on purpose, so a
 * caller cannot reach past it into unrelated declarations. */
export interface ValueColumnConfig<A extends CalibratedAxes> {
  /**
   * The slots this type captures into when nothing has reshaped it.
   *
   * ⚑⚑ IT IS HERE TO CATCH A RESHAPED DATASET (v2.5). A type's `intervalSlots`
   * and `derivedTupleValue` describe ITS OWN capture shape, and a session can be
   * reshaped out of that shape at runtime - `applyBoxPlotGroups` turns a Bar's
   * two corners into a box plot's five letter values. Answering from the config
   * then reports one `Value` derived from five slots it was never written for.
   * ⚑ "Guards belong in the model, and the model has more than one entrance."
   */
  defaultSlots?: readonly string[];
  /** This type's record IS an interval, and these are its ends' names. */
  intervalSlots?: readonly [string, string];
  /** This type reads ONE number per datum, under this heading. */
  derivedTupleValue?: {
    label: string;
    compute(points: (DataPointView | null)[], axes: A, ctx: { apex: null }): number | null;
    interval?(points: (DataPointView | null)[], axes: A): { min: number; max: number } | null;
    /** The names when the FIGURE changes the answer - see the declaration. */
    namesFor?(axes: A): readonly string[];
    /** The readings for those names, aligned. */
    cellsFor?(points: (DataPointView | null)[], axes: A): (number | null)[];
  };
}

/**
 * The names of a datum's values, in order.
 *
 * ⚑ Slots come from the SESSION rather than the config, because a Box Plot's are
 * a runtime fact (`applyBoxPlotGroups` reshapes them) - which is exactly what
 * question 3 has to be able to answer.
 */
export function valueColumnNames<A extends CalibratedAxes>(
  config: ValueColumnConfig<A>,
  slotNames: readonly string[],
  /** The figure's own axes, where it has been calibrated. Some answers depend on
   * what the FIGURE declares - a STACKED bar's segment has a `Base` as well as a
   * contribution - and a type that does not care simply ignores it. */
  axes?: A
): readonly string[] {
  // 0. a RESHAPED dataset answers from its SLOTS, whatever the type says: the
  //    type's own shape is no longer what is on the record.
  if (isReshaped(config, slotNames)) return slotNames;
  // 1. an INTERVAL record: its two ends are its values.
  if (config.intervalSlots) return config.intervalSlots;
  if (config.derivedTupleValue) {
    // 2. a DERIVED record. The type may name more than one when the figure says
    //    so - `bar(x, height, bottom)` on a stacked chart.
    if (axes && config.derivedTupleValue.namesFor) return config.derivedTupleValue.namesFor(axes);
    return [config.derivedTupleValue.label];
  }
  // 3. otherwise the datum's own SLOTS are its values - a box plot's five.
  return slotNames;
}

/**
 * One datum's readings, aligned index-for-index with `valueColumnNames`.
 *
 * ⚑ ALIGNED IS THE WHOLE CONTRACT. A caller pairs name[i] with cell[i] and needs
 * to know nothing else about the type - which is what lets one table, one
 * exporter and one editor serve a family whose members have 1, 2, 4 and 5
 * values. A missing reading is `null` and keeps its place; the array is never
 * short, so a column can never silently shift into its neighbour.
 */
export function valueCells<A extends CalibratedAxes>(
  config: ValueColumnConfig<A>,
  points: (DataPointView | null)[],
  axes: A,
  /**
   * The dataset's OWN slot names - what `valueColumnNames` was asked, so the two
   * cannot answer from different premises.
   *
   * ⚠️ It is not `points.length`. A series carrying error has cap points too, so
   * counting the points read a bar with error bars as a RESHAPED dataset and
   * reported its first corner where its measured value belongs - measured, 0
   * instead of 5. Optional so an uninterested caller reads unchanged.
   */
  slotNames?: readonly string[]
): (number | null)[] {
  if (slotNames && isReshaped(config, slotNames)) {
    return points.map((p) => p?.data?.[0] ?? null);
  }
  if (config.intervalSlots) {
    const interval = config.derivedTupleValue?.interval?.(points, axes) ?? null;
    return [interval?.min ?? null, interval?.max ?? null];
  }
  if (config.derivedTupleValue) {
    const derive = config.derivedTupleValue;
    if (derive.cellsFor) return derive.cellsFor(points, axes);
    return [derive.compute(points, axes, { apex: null }) ?? null];
  }
  return points.map((p) => p?.data?.[0] ?? null);
}

/**
 * Has this dataset been reshaped away from the type's own capture shape?
 *
 * ⚑ A COUNT, not a name comparison: the reshape that exists today
 * (`applyBoxPlotGroups`) replaces two slots with five, and a future one that
 * merely RENAMED the same number of slots would still be the type's own record.
 * ⚑ Unknowable without `defaultSlots`, so a config that does not declare them is
 * taken at its word - which is every type that cannot be reshaped.
 */
function isReshaped<A extends CalibratedAxes>(
  config: ValueColumnConfig<A>,
  slotNames: readonly string[]
): boolean {
  return config.defaultSlots !== undefined && slotNames.length !== config.defaultSlots.length;
}
