/**
 * ⚑⚑ TWO TYPES' DATA IN ONE FIGURE IS LAYERED DATA (v2.5.1).
 *
 * David, 2026-09-14: *"two different types of graphs data in different series on
 * one figure. That is layered data. and we do not support that yet."* Layered
 * figures are the v3.0 release; nothing on screen can build one today.
 *
 * ⚑ THE FILE IS THE ONLY DOOR. `setSlotNames` reshapes the ACTIVE series alone,
 * and checkpoint 109 retired its only UI caller (the hidden "Box Plot Groups"
 * toggle) so that *"one discoverable path"* remains. What can still arrive is a
 * WPD import carrying per-dataset point groups, a project written by an older
 * version, or a hand-edited file.
 *
 * ⚑ SURFACED, NOT REFUSED, and the door's own standing decision is why:
 * *"Visible and recoverable beats silent and pristine (tenet 1)"*. A bad
 * calibration opens with its reason on screen and a colliding series name is
 * deduped rather than turned away, so a refusal here would stand alone.
 *
 * ⚑ WHAT THIS MODULE DOES NOT DO: decide anything. It REPORTS the disagreement
 * and describes the split that would resolve it. The split itself is an OFFER
 * the user accepts (tenet 9, and gate 3's *"assert only what was measured"*).
 */

import { ownSlotNames } from '../algorithms/errorExtent.js';

/** One series, as this module needs to see it. */
export interface SeriesShape {
  name: string;
  /** The series' own slot names, in capture order. */
  slots: readonly string[];
}

/**
 * ⚑⚑ THE ERROR TAIL IS NOT PART OF THE SHAPE, and `ownSlotNames` is the app's
 * own answer to that - *"error slots are an addition to a SERIES, not a change
 * of what the series IS"*.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-15. Every caller here was handed the RAW
 * `Dataset.getSlotNames()`, so capturing one error cap - which calls
 * `adoptSlots` on that series ALONE - made a plain bar and its error-carrying
 * sibling answer two different shapes. An ordinary chart was declared to hold
 * *"series of different kinds"* and its owner was offered the split of a project
 * this app supports completely. Enforced by
 * `errorBarsAreNotASecondKind.test.ts`, which is red without this line.
 *
 * ⚑ Asked HERE rather than at each door, so the offer, the grouping and
 * `typeForSlots` cannot answer the question three ways.
 */
function ownShape(slots: readonly string[]): readonly string[] {
  return ownSlotNames(slots);
}

/**
 * The key two series must share to be the same shape.
 *
 * ⚑ Case- and space-insensitive, matching the box-plot shape test the session
 * already applies to loaded slot names - a file that writes `min` where we write
 * `Min` is the same shape, not a second one.
 *
 * ⚑ `JSON.stringify` rather than a joined string, so no separator character can
 * appear inside a slot name and merge two different shapes into one key.
 */
function shapeKey(slots: readonly string[]): string {
  return JSON.stringify(ownShape(slots).map((s) => s.trim().toLowerCase()));
}

/**
 * The series grouped by shape, in first-appearance order. One group means the
 * figure is not layered; two or more means it is.
 *
 * ⚑ GENERIC over the caller's own series object, so the SPLIT can walk these
 * groups carrying its datasets rather than grouping a second time off a parallel
 * array - one grouping in the app, which is also the one the offer describes.
 */
export function layeredSeriesGroups<T extends SeriesShape>(series: readonly T[]): {
  slots: readonly string[];
  members: readonly T[];
}[] {
  const byKey = new Map<string, { slots: readonly string[]; members: T[] }>();
  for (const s of series) {
    const key = shapeKey(s.slots);
    const group = byKey.get(key);
    if (group) group.members.push(s);
    // ⚑ The group's slots are the SHAPE, error tail stripped - so what the offer
    // lists as a kind and what `typeForSlots` is later asked are one answer.
    else byKey.set(key, { slots: ownShape(s.slots), members: [s] });
  }
  return [...byKey.values()];
}

/** Is this figure carrying more than one shape of series? */
export function isLayered(series: readonly SeriesShape[]): boolean {
  return layeredSeriesGroups(series).length > 1;
}

/**
 * ⚑⚑ WHAT THE USER IS ASKED, IN DAVID'S OWN WORDS (2026-09-14). He wrote this
 * sentence after reading a generated one of mine and turning it down, so it is
 * quoted rather than composed: *"This graph project contains series of different
 * kinds based on the same graph figure, which PlotTracer does not support yet.
 * For now, plottracer can offer to split the project in to a multifigure
 * project, with one copy of the graph image per series type. Do you want to
 * proceed [Yes] / [No]"*
 *
 * ⚑ It is an OFFER, not a notice: the split happens only on Yes. Nothing is
 * decided for the user, and refusing leaves the project exactly as it opened,
 * every series readable under its own columns.
 *
 * ⚑ PER SERIES TYPE, not per series - *"one copy of the graph image per series
 * type"* - which is why `layeredSeriesGroups` groups by shape and leaves two
 * series of one shape together in one figure.
 *
 * ⚠⚑⚑ AND IT IS THE WHOLE MESSAGE. It briefly sandwiched a GENERATED list of
 * each series and its slot names, added when David observed that a constant
 * cannot say WHICH kinds it found. He deleted it on sight of the built app:
 * *"Just remove the technical wording from the offer altogether. It is not
 * needed at all for any graph or series type."*
 *
 * ▶ The reason it had to go is worth keeping, because the idea sounded right.
 * The list was built to make every word checkable against the panel, and for a
 * BAR it printed `Corner, Opposite corner` - how a bar is CAPTURED, a phrase
 * that appears NOWHERE on screen, where the panel's own header reads `Value`. It
 * achieved the opposite of its purpose for the commonest type in the app. The
 * question the dialog asks is whether to split a project we cannot represent,
 * and naming our internal shapes answers a question nobody asked.
 */
export const LAYERED_PROJECT_OFFER =
  'This graph project contains series of different kinds based on the same graph figure, ' +
  'which PlotTracer does not support yet. For now, PlotTracer can offer to split the project ' +
  'into a multi-figure project, with one copy of the graph image per series type. ' +
  'Do you want to proceed?';

/** `a`, `a and b`, `a, b and c` - the same list voice the bar table's
 * crowded-readings sentence uses, so two messages about one figure read as one
 * app rather than two. */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}


/**
 * What to call the figure a group becomes when the project is split.
 *
 * ⚑ NAMED BY ITS CONTENTS, not `Figure 1`/`Figure 2`: after a split the jumper
 * is the only thing saying which figure is which, and a positional name makes
 * the user open both to find out.
 *
 * ⚑ THE SERIES' OWN NAMES, which the user typed and can see in the panel - not
 * slot names. That distinction is why this survived the offer's generated middle
 * being deleted: a series name is the USER's word, a slot name is OURS.
 */
export function layeredGroupName(members: readonly SeriesShape[]): string {
  return listOf(members.map((m) => m.name)) || 'Figure';
}

/**
 * The offer to make, or null when this project is not layered and there is
 * nothing to ask.
 *
 * ⚑⚑ DAVID'S TWO SENTENCES, AND NOTHING ELSE. David, 2026-09-15, seeing the
 * generated middle in the built app: *"Just remove the technical wording from
 * the offer altogether. It is not needed at all for any graph or series type."*
 *
 * ⚠️ IT USED TO LIST EACH SERIES AND ITS SLOT NAMES, and that was mine. The
 * reasoning sounded good - a constant cannot say WHICH kinds it found, so make
 * the middle generated and every word checkable against the panel. It did not
 * survive contact: the words it printed for a BAR were `Corner, Opposite
 * corner`, which is how a bar is CAPTURED and appears nowhere on screen, where
 * the panel's own header reads `Value`. So the "checkable" list was checkable
 * for some types and meaningless for the commonest one.
 *
 * ▶ And the question the dialog asks never needed it: it asks whether to split
 * a project the app cannot represent, and naming the internal shapes answers a
 * question nobody asked, in words only we use.
 */
export function layeredProjectOffer(series: readonly SeriesShape[]): string | null {
  return isLayered(series) ? LAYERED_PROJECT_OFFER : null;
}

/** What this module needs to know about a graph type to recognise a series of
 * its shape. Narrow on purpose, so this stays testable without the registry. */
export interface SlotShapedType {
  id: string;
  /** Which axes class it calibrates - a type of another kind cannot take over a
   * figure whose calibration was made for this one. */
  axesKind: string;
  /** The slots it captures into when nothing has reshaped it. */
  defaultSlots?: readonly string[];
}

/**
 * ⚑⚑ WHICH TYPE A SPLIT FIGURE SHOULD DECLARE, given the slots its series carry.
 *
 * ⚠️ FOUND BY DAVID'S HANDS ON THE BUILT APP, 2026-09-14, and by nothing else.
 * The first split produced two figures and left BOTH declared as the document's
 * original type, so a figure whose series held `Min, Q1, Median, Q3, Max` sat
 * under a toolbar reading "Bar" and drew a BAR's advisory about bars that do not
 * reach the baseline. The data was separated and the declaration was not, which
 * makes "one figure per series type" half true in the half the user can see.
 * ⚑ The e2e asserted the figure COUNT and its NAME and sailed past it: the case
 * *"the second figure's graph type reads Box Plot"* was a conclusion in my head
 * and was never written as an observable outcome (gate 1).
 *
 * ⚑ THIS READS THE RECORD, IT DOES NOT INTERPRET PIXELS. A series captured into
 * `BOX_PLOT_SLOTS` IS a box plot by the model's own definition - the slot names
 * are what the type declares - so this is the same reading `valueColumnNames`
 * already makes, not a judgement about the figure (tenet 9).
 *
 * ⚑ IT CHANGES NOTHING UNLESS IT IS SURE, and there are two ways not to be:
 * · **the shape names more than one type.** Bar and Span both declare
 *   `OPPOSITE_CORNER_SLOTS`, so those slots identify neither - which is the same
 *   boundary `layeredProjectOffer` has, for the same reason.
 * · **the type calibrates a different axes class.** A pie's slots cannot take
 *   over a figure calibrated as a bar; the axes would not fit the record.
 * In both cases the figure keeps the type the document declared.
 */
export function typeForSlots(
  slots: readonly string[],
  types: readonly SlotShapedType[],
  current: SlotShapedType
): string {
  const key = shapeKey(slots);
  const matches = types.filter(
    (t) => t.axesKind === current.axesKind && t.defaultSlots && shapeKey(t.defaultSlots) === key
  );
  return matches.length === 1 ? matches[0]!.id : current.id;
}
