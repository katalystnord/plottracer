/**
 * Which found lines make each legend entry's series, where the entries share one ink (v2.7;
 * docs/v2.7-workflow-walk.md, "Series told apart by their line style").
 *
 * The lines are given to the entries by style (`assignStyles`). An entry's lines are then its series, joined end to
 * end in order along x, through the same join Join with uses. Two of them that run alongside each other are not one
 * line drawn in pieces: the longer is the entry's, and the other is left as a place to check (on the release figure,
 * a short piece from where the four curves start together).
 */
import { assignStyles, stylesDistinct, type LineStyle } from '../algorithms/lineStyle.js';

export interface StyledLine {
  style: LineStyle;
  /** Its extent along x, image px. */
  xMin: number;
  xMax: number;
}

export interface StyleSeriesPlan {
  /** Per entry, its lines in order along x: the first is the series, the rest are joined onto it. */
  perEntry: number[][];
  /** Lines given to no entry: none matched its style, or it runs alongside its entry's line. */
  left: ({ line: number; why: 'unmatched' } | { line: number; why: 'overlaps'; entry: number })[];
  /** Entries no line has the style of. */
  empty: number[];
  /** Entries whose sample has the style of an earlier entry's, so no line can be told to be theirs: what has that
   * style is the earlier entry's. */
  sameStyleAs: { entry: number; as: number }[];
}

/** How far two pieces of one line may overlap along x where they meet, px: a join is end to end. */
const END_TO_END = 4;

/** Null when fewer than two styles can be told apart among the entries: then the read is as before, by colour alone.
 * An entry with the style of an earlier one takes no part, and the plan says whose style it shares. */
export function planStyleSeries(lines: readonly StyledLine[], entries: readonly (LineStyle | null)[]): StyleSeriesPlan | null {
  const sameStyleAs: StyleSeriesPlan['sameStyleAs'] = [];
  const distinct = entries.map((st, e) => {
    if (!st) return null;
    const as = entries.findIndex((o, k) => k < e && o !== null && !sameStyleAs.some((x) => x.entry === k) && !stylesDistinct([o, st]));
    if (as < 0) return st;
    sameStyleAs.push({ entry: e, as });
    return null;
  });
  if (distinct.filter((e) => e !== null).length < 2) return null;
  const given = assignStyles(lines.map((l) => l.style), distinct);
  const perEntry: number[][] = entries.map(() => []);
  const left: StyleSeriesPlan['left'] = [];
  given.forEach((e, i) => {
    if (e === null) left.push({ line: i, why: 'unmatched' });
  });
  entries.forEach((_, e) => {
    // the longest first: a piece that runs alongside what the entry already has is not more of the same line
    const mine = given.map((g, i) => (g === e ? i : -1)).filter((i) => i >= 0)
      .sort((a, b) => (lines[b]!.xMax - lines[b]!.xMin) - (lines[a]!.xMax - lines[a]!.xMin));
    const kept: number[] = [];
    for (const i of mine) {
      const L = lines[i]!;
      const alongside = kept.some((k) => Math.min(L.xMax, lines[k]!.xMax) - Math.max(L.xMin, lines[k]!.xMin) > END_TO_END);
      if (alongside) left.push({ line: i, why: 'overlaps', entry: e });
      else kept.push(i);
    }
    perEntry[e] = kept.sort((a, b) => lines[a]!.xMin - lines[b]!.xMin);
  });
  left.sort((a, b) => a.line - b.line);
  const empty = perEntry.map((l, e) => (l.length || sameStyleAs.some((x) => x.entry === e) ? -1 : e)).filter((e) => e >= 0);
  return { perEntry, left, empty, sameStyleAs };
}
