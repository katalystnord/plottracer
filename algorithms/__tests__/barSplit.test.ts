import { describe, expect, it } from 'vitest';
import {
  reconcileWithExpected,
  runColumnsFromMembers,
  splitRunAtDividers,
  type RunColumn,
} from '../barSplit.js';

/**
 * Splitting a merged run of touching bars at declared dividers.
 *
 * ⚑ THE ASSERTION THAT MATTERS MOST is that a divider placed a few pixels INTO
 * the taller neighbour does not drag the shorter bar's reading up. That is the
 * difference between "tick placement is an aid" and "tick placement is a
 * measurement", and it is decided entirely by measuring each piece with a median
 * rather than an extreme.
 */

/** A run of `n` columns from `at0`, all reaching `top` (small = tall bar). */
function bar(at0: number, count: number, top: number, base = 100): RunColumn[] {
  return Array.from({ length: count }, (_, i) => ({ at: at0 + i, min: top, max: base }));
}

describe('splitting a run at declared dividers', () => {
  it('cuts two touching bars into two pieces, each measured on its own', () => {
    // A step: 0..19 is tall (top 20), 20..39 is short (top 60).
    const columns = [...bar(0, 20, 20), ...bar(20, 20, 60)];
    const { pieces, emptyBands } = splitRunAtDividers(columns, [0, 20, 40]);
    expect(emptyBands).toEqual([]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ from: 0, to: 20, min: 20, max: 100, columns: 20 });
    expect(pieces[1]).toMatchObject({ from: 20, to: 40, min: 60, max: 100, columns: 20 });
  });

  it('⚑ a divider a few pixels INTO the taller bar does not raise the shorter one', () => {
    // The whole point. Divider at 24 instead of 20, so the short bar's band
    // wrongly contains four columns of the TALL bar. A maximum-based reading
    // would report the short bar at the tall one's height -- a silently wrong
    // NUMBER produced by a small placement error.
    const columns = [...bar(0, 20, 20), ...bar(20, 20, 60)];
    const { pieces } = splitRunAtDividers(columns, [0, 16, 40]);
    // Band 1 now holds 4 tall columns (16..19) and 20 short ones.
    expect(pieces[1]!.columns).toBe(24);
    expect(pieces[1]!.min).toBe(60); // the SHORT bar's own top, uncontaminated
    expect(Math.min(...columns.slice(16, 20).map((c) => c.min))).toBe(20); // the contamination was there
  });

  it('survives contamination up to just under half the band', () => {
    // 11 tall columns against 12 short ones: the median still lands on the
    // short bar. Past half it flips, which is honest -- at that point the
    // divider is nearer the wrong bar than the right one.
    const columns = [...bar(0, 20, 20), ...bar(20, 12, 60)];
    expect(splitRunAtDividers(columns, [0, 9, 32]).pieces[1]!.min).toBe(60);
  });

  it('reports an empty band rather than inventing a bar for it', () => {
    // ⚑ The rule that keeps this from becoming approach C: a band with no ink
    // comes back EMPTY. Nothing is synthesised to satisfy the declared count.
    const columns = [...bar(0, 20, 20), ...bar(40, 20, 60)];
    const { pieces, emptyBands } = splitRunAtDividers(columns, [0, 20, 40, 60]);
    expect(pieces).toHaveLength(2);
    expect(emptyBands).toEqual([1]);
    expect(pieces.map((p) => p.from)).toEqual([0, 40]);
  });

  it('needs more than one column before it calls a band a bar', () => {
    // A single column is as likely to be an antialiased edge bleeding across a
    // divider as a bar, and it is exactly what a slightly misplaced divider
    // produces.
    const columns = [...bar(0, 1, 20), ...bar(20, 20, 60)];
    expect(splitRunAtDividers(columns, [0, 20, 40]).emptyBands).toEqual([0]);
    // ...and the threshold is the caller's to lower, deliberately.
    expect(splitRunAtDividers(columns, [0, 20, 40], { minColumns: 1 }).emptyBands).toEqual([]);
  });

  it('⚑ a column ON a divider belongs to the band that divider OPENS', () => {
    // The same half-open rule bandIndexForParam uses, so a bar cannot be
    // assigned to one category and split into another.
    const columns = [...bar(0, 10, 20), ...bar(10, 10, 60)];
    const { pieces } = splitRunAtDividers(columns, [0, 10, 20]);
    expect(pieces[0]!.columns).toBe(10); // 0..9
    expect(pieces[1]!.columns).toBe(10); // 10..19
    expect(pieces[1]!.min).toBe(60);
  });

  it('includes the closing divider in the LAST band, or the final column vanishes', () => {
    const columns = bar(0, 21, 20); // 0..20 inclusive
    expect(splitRunAtDividers(columns, [0, 20]).pieces[0]!.columns).toBe(21);
  });

  it('answers nothing for fewer than two dividers — there is no band', () => {
    const columns = bar(0, 10, 20);
    expect(splitRunAtDividers(columns, [])).toEqual({ pieces: [], emptyBands: [] });
    expect(splitRunAtDividers(columns, [5])).toEqual({ pieces: [], emptyBands: [] });
  });

  it('does not require the columns to arrive in order', () => {
    const columns = [...bar(20, 20, 60), ...bar(0, 20, 20)];
    const { pieces } = splitRunAtDividers(columns, [0, 20, 40]);
    expect(pieces[0]!.min).toBe(20);
    expect(pieces[1]!.min).toBe(60);
  });

  it('⚑ the median genuinely SORTS — a band whose columns arrive out of order', () => {
    // Every other fixture here has uniform columns, so ordering cannot matter
    // and the sort was untested: mutation showed the comparator could be
    // removed or inverted with the suite still green. A ragged top -- a grid
    // line crossing the bar, an antialiased edge -- is the ordinary case where
    // it bites.
    //
    // tops 60,20,60,20,20: the true median is 20. Taking the middle of the list
    // AS GIVEN reports 60, and so does a broken comparator.
    const tops = [60, 20, 60, 20, 20];
    const columns: RunColumn[] = tops.map((t, i) => ({ at: i, min: t, max: 100 }));
    expect(splitRunAtDividers(columns, [0, 5]).pieces[0]!.min).toBe(20);
  });

  it('picks the middle READING, not the middle of the far end', () => {
    // The two ends are medianed independently -- a bar whose base is ragged
    // must not drag its top.
    const columns: RunColumn[] = [
      { at: 0, min: 20, max: 100 },
      { at: 1, min: 20, max: 60 },
      { at: 2, min: 20, max: 100 },
    ];
    const piece = splitRunAtDividers(columns, [0, 3]).pieces[0]!;
    expect(piece.min).toBe(20);
    expect(piece.max).toBe(100);
  });

  it('takes a real column reading, never an average of two', () => {
    // An even-length median that averaged would report a value no column had --
    // which is the habit this whole module exists to break.
    const columns: RunColumn[] = [
      { at: 0, min: 10, max: 100 },
      { at: 1, min: 20, max: 100 },
    ];
    const { min } = splitRunAtDividers(columns, [0, 2]).pieces[0]!;
    expect([10, 20]).toContain(min);
    expect(min).not.toBe(15);
  });
});

describe('reconciling against the declared count', () => {
  it('says so when the figure produced exactly what was declared', () => {
    const report = splitRunAtDividers([...bar(0, 20, 20), ...bar(20, 20, 60)], [0, 20, 40]);
    expect(reconcileWithExpected(report, 2)).toEqual({
      expected: 2,
      found: 2,
      complete: true,
      emptyBands: [],
    });
  });

  it('⚑ names the short answer instead of handing back a table that looks finished', () => {
    const report = splitRunAtDividers([...bar(0, 20, 20), ...bar(40, 20, 60)], [0, 20, 40, 60]);
    expect(reconcileWithExpected(report, 3)).toEqual({
      expected: 3,
      found: 2,
      complete: false,
      emptyBands: [1],
    });
  });

  it('⚑ REPORTS ONLY — it changes nothing about the split it was given', () => {
    // If this ever retried, relaxed a threshold, or filled a gap, it would be
    // approach C with extra steps: erasing a visible failure by manufacturing
    // the expected answer.
    const report = splitRunAtDividers([...bar(0, 20, 20)], [0, 20, 40]);
    const before = JSON.parse(JSON.stringify(report));
    reconcileWithExpected(report, 2);
    expect(report).toEqual(before);
  });

  it('hands back a copy of the empty bands, so a caller cannot edit the finding', () => {
    const report = splitRunAtDividers([...bar(0, 20, 20)], [0, 20, 40]);
    const out = reconcileWithExpected(report, 2);
    out.emptyBands.push(99);
    expect(report.emptyBands).toEqual([1]);
  });
});

describe('reading the columns out of the blob’s OWN pixels', () => {
  /** Pixel indices of a filled rect in a `w`-wide image. */
  function rect(w: number, x0: number, y0: number, x1: number, y1: number): number[] {
    const out: number[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * w + x);
    return out;
  }

  it('finds each column’s two ink ends for an upright chart', () => {
    // Two touching bars: x 2..5 tall (y 3..9), x 6..9 short (y 6..9).
    const members = [...rect(12, 2, 3, 5, 9), ...rect(12, 6, 6, 9, 9)];
    const cols = runColumnsFromMembers(members, 12, 'x');
    expect(cols).toHaveLength(8);
    expect(cols[0]).toEqual({ at: 2, min: 3, max: 9 });
    expect(cols[4]).toEqual({ at: 6, min: 6, max: 9 });
  });

  it('scans the other way once the bars are horizontal', () => {
    const cols = runColumnsFromMembers(rect(12, 3, 2, 9, 5), 12, 'y');
    expect(cols).toHaveLength(4); // rows 2..5
    expect(cols[0]).toEqual({ at: 2, min: 3, max: 9 });
  });

  it('⚑ READS NOTHING that is not the blob’s own — the whole point of the change', () => {
    // A legend swatch sits in the same colour, inside the run's bounding box,
    // and used to be measured as part of it. It is not in the blob's membership,
    // so it contributes nothing.
    const bar = rect(20, 2, 10, 5, 18);
    const swatchInsideTheBbox = rect(20, 3, 1, 4, 2);
    const cols = runColumnsFromMembers(bar, 20, 'x');
    expect(cols.every((c) => c.min >= 10)).toBe(true);
    // ...and the contamination really was inside the box that used to be scanned.
    expect(Math.min(...swatchInsideTheBbox.map((p) => Math.floor(p / 20)))).toBeLessThan(10);
  });

  it('has no gap columns to omit — a blob only contains ink', () => {
    // Two disconnected rects would be two BLOBS; within one, every column of the
    // membership has ink by construction, so there is nothing to filter.
    const cols = runColumnsFromMembers([...rect(10, 1, 4, 2, 8), ...rect(10, 5, 4, 6, 8)], 10, 'x');
    expect(cols.map((c) => c.at)).toEqual([1, 2, 5, 6]);
  });

  it('returns the columns in order however the pixels arrive', () => {
    const shuffled = [...rect(10, 1, 2, 3, 4)].reverse();
    expect(runColumnsFromMembers(shuffled, 10, 'x').map((c) => c.at)).toEqual([1, 2, 3]);
  });

  it('finds nothing in an empty membership, and does not throw', () => {
    expect(runColumnsFromMembers([], 3, 'x')).toEqual([]);
    expect(runColumnsFromMembers(new Int32Array(0), 3, 'y')).toEqual([]);
  });

  it('takes a typed array, which is what the detector hands over', () => {
    const cols = runColumnsFromMembers(Int32Array.from(rect(8, 1, 1, 2, 3)), 8, 'x');
    expect(cols).toEqual([{ at: 1, min: 1, max: 3 }, { at: 2, min: 1, max: 3 }]);
  });
});

describe('end to end: a merged run of three touching bars', () => {
  it('recovers three separate readings from one blob', () => {
    // The case the feature exists for -- one blob, three bars, no gaps.
    const w = 40;
    const h = 24;
    const mask = new Uint8Array(w * h);
    const tops = [4, 14, 9];
    for (let b = 0; b < 3; b++) {
      for (let x = b * 12; x < b * 12 + 12; x++) {
        for (let y = tops[b]!; y <= 20; y++) mask[y * w + x] = 1;
      }
    }
    const members: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) members.push(i);
    const cols = runColumnsFromMembers(members, w, 'x');
    const report = splitRunAtDividers(cols, [0, 12, 24, 36]);
    expect(report.pieces.map((p) => p.min)).toEqual(tops);
    expect(report.pieces.map((p) => p.max)).toEqual([20, 20, 20]);
    expect(reconcileWithExpected(report, 3).complete).toBe(true);
  });
});

describe('⚑ a piece is boxed by its INK, not by its band', () => {
  it('reports the ink extent when the bar is narrower than its band', () => {
    // The defect the corpus run caught, and which every fixture above hid by
    // having bars that filled their bands exactly. A real bar has gaps either
    // side; boxing it at the band edges describes something much wider than the
    // bar and misses it outright.
    const columns: RunColumn[] = [];
    for (let at = 12; at <= 27; at++) columns.push({ at, min: 30, max: 100 });
    const piece = splitRunAtDividers(columns, [0, 40]).pieces[0]!;
    expect(piece.from).toBe(0);
    expect(piece.to).toBe(40);
    expect(piece.atFrom).toBe(12);
    expect(piece.atTo).toBe(27);
  });

  it('each piece of a merged run gets its own ink extent', () => {
    // Two touching bars with a small gap between them inside one run.
    const columns = [...bar(2, 16, 20), ...bar(22, 16, 60)];
    const { pieces } = splitRunAtDividers(columns, [0, 20, 40]);
    expect(pieces.map((p) => [p.atFrom, p.atTo])).toEqual([[2, 17], [22, 37]]);
    expect(pieces.map((p) => [p.from, p.to])).toEqual([[0, 20], [20, 40]]);
  });
});
