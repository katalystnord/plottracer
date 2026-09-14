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

/** One series, as this module needs to see it. */
export interface SeriesShape {
  name: string;
  /** The series' own slot names, in capture order. */
  slots: readonly string[];
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
  return JSON.stringify(slots.map((s) => s.trim().toLowerCase()));
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
    else byKey.set(key, { slots: s.slots, members: [s] });
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
 */
export const LAYERED_PROJECT_OFFER_OPENING =
  'This graph project contains series of different kinds based on the same graph figure, ' +
  'which PlotTracer does not support yet.';

export const LAYERED_PROJECT_OFFER_CLOSING =
  'For now, PlotTracer can offer to split the project into a multi-figure project, ' +
  'with one copy of the graph image per series type. Do you want to proceed?';

/** `a`, `a and b`, `a, b and c` - the same list voice the bar table's
 * crowded-readings sentence uses, so two messages about one figure read as one
 * app rather than two. */
function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

/**
 * The offer to make, or null when this project is not layered and there is
 * nothing to ask.
 *
 * ⚑⚑ DAVID'S TWO SENTENCES ARE THE FRAME AND THEY ARE STATIC; only the middle
 * is generated. David, 2026-09-14, on his own wording being the more apt one:
 * *"Yes, but the text is static."* A constant cannot say WHICH kinds it found,
 * and the kinds are the one thing the user cannot see for themselves - the panel
 * shows series names, not the shapes behind them. So the frame stays general
 * (it reads the same for two kinds or ten) and the list carries the specifics.
 *
 * ⚑ NAMED BY THE SERIES' OWN NAMES AND THEIR OWN SLOTS - nothing is
 * interpreted, and a user can check every word of it against the panel.
 */
/**
 * What to call the figure a group becomes when the project is split - the names
 * of the series it holds, in the list voice the offer itself uses.
 *
 * ⚑ NAMED BY ITS CONTENTS, not `Figure 1`/`Figure 2`: after a split the jumper
 * is the only thing saying which figure is which, and a positional name makes
 * the user open both to find out.
 */
export function layeredGroupName(members: readonly SeriesShape[]): string {
  return listOf(members.map((m) => m.name)) || 'Figure';
}

export function layeredProjectOffer(series: readonly SeriesShape[]): string | null {
  const groups = layeredSeriesGroups(series);
  if (groups.length < 2) return null;
  const kinds = groups
    .map((g) => `    ${listOf(g.members.map((m) => m.name))}: ${g.slots.join(', ')}`)
    .join('\n');
  return `${LAYERED_PROJECT_OFFER_OPENING}\n\n${kinds}\n\n${LAYERED_PROJECT_OFFER_CLOSING}`;
}
