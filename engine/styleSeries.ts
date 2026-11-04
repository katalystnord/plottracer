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
}

/** How far two pieces of one line may overlap along x where they meet, px: a join is end to end. */
const END_TO_END = 4;

/** Null when the entries cannot be told apart by style: then the read is as before, by colour alone. */
export function planStyleSeries(lines: readonly StyledLine[], entries: readonly (LineStyle | null)[]): StyleSeriesPlan | null {
  const measured = entries.filter((e): e is LineStyle => e !== null);
  if (measured.length < 2 || !stylesDistinct(measured)) return null;
  const given = assignStyles(lines.map((l) => l.style), entries);
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
  const empty = perEntry.map((l, e) => (l.length ? -1 : e)).filter((e) => e >= 0);
  return { perEntry, left, empty };
}
