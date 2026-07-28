import { describe, it, expect } from 'vitest';
import {
  resolveErrorBars,
} from '../errorBar.js';

describe('error bars', () => {

  describe('resolveErrorBars — the series-to-series link, resolved per point', () => {
    // The model stores the link per SERIES; the point correspondence is derived
    // here (docs/error-bars-design.md). These tests are that derivation's
    // contract.
    const data = [
      { x: 2, y: 12 },
      { x: 4, y: 26 },
      { x: 6, y: 35 },
    ];

    it('resolves symmetric Y error onto the right data points', () => {
      const bars = resolveErrorBars(data, [
        { role: 'upper', caps: [{ x: 2, y: 15 }, { x: 4, y: 30 }, { x: 6, y: 40 }] },
        { role: 'lower', caps: [{ x: 2, y: 9 }, { x: 4, y: 22 }, { x: 6, y: 30 }] },
      ]);
      expect(bars).toEqual([
        { x: 2, y: 12, yUpper: 15, yLower: 9 },
        { x: 4, y: 26, yUpper: 30, yLower: 22 },
        { x: 6, y: 35, yUpper: 40, yLower: 30 },
      ]);
    });

    it('a cap claims its nearest datum even when x is not exact', () => {
      // The user clicks the cap, not a grid: it never lands on the datum's
      // exact x.
      const bars = resolveErrorBars(data, [{ role: 'upper', caps: [{ x: 4.13, y: 30 }] }]);
      expect(bars[1]!.yUpper).toBe(30);
      expect(bars[0]!.yUpper).toBeUndefined();
    });

    it('leaves data with no cap carrying no error — the common case, not an edge case', () => {
      // Authors routinely draw error on every Nth point. Under the old tuple
      // model this was impossible (CLAUDE.md failure #3); here it costs nothing.
      const bars = resolveErrorBars(data, [{ role: 'upper', caps: [{ x: 6, y: 40 }] }]);
      expect(bars[0]!.yUpper).toBeUndefined();
      expect(bars[1]!.yUpper).toBeUndefined();
      expect(bars[2]!.yUpper).toBe(40);
    });

    it('resolves caps to data, not data to caps — so a dense curve gains no invented error', () => {
      // The direction is the whole guard against fabricating uncertainty: a
      // datum-first rule would give all 200 points a whisker from the nearest
      // cap. Exactly one of these five data points was measured.
      const dense = [0, 1, 2, 3, 4].map((x) => ({ x, y: 10 }));
      const bars = resolveErrorBars(dense, [{ role: 'upper', caps: [{ x: 2, y: 12 }] }]);
      expect(bars.filter((b) => b.yUpper !== undefined)).toHaveLength(1);
      expect(bars[2]!.yUpper).toBe(12);
    });

    it('matches X error by y, not by x — the axis the cap does not move along', () => {
      // A left/right cap shares its datum's y and is displaced in x. Matching
      // it by x would compare the very quantity the cap exists to displace.
      const column = [
        { x: 10, y: 1 },
        { x: 10, y: 2 },
      ];
      const bars = resolveErrorBars(column, [
        { role: 'left', caps: [{ x: 7, y: 1 }, { x: 8, y: 2 }] },
        { role: 'right', caps: [{ x: 13, y: 1 }, { x: 12, y: 2 }] },
      ]);
      expect(bars[0]).toEqual({ x: 10, y: 1, xLeft: 7, xRight: 13 });
      expect(bars[1]).toEqual({ x: 10, y: 2, xLeft: 8, xRight: 12 });
    });

    it('builds a 2D cross from all four roles at once', () => {
      const bars = resolveErrorBars([{ x: 10, y: 5 }], [
        { role: 'upper', caps: [{ x: 10, y: 7 }] },
        { role: 'lower', caps: [{ x: 10, y: 3 }] },
        { role: 'left', caps: [{ x: 8, y: 5 }] },
        { role: 'right', caps: [{ x: 13, y: 5 }] },
      ]);
      expect(bars[0]).toEqual({ x: 10, y: 5, yUpper: 7, yLower: 3, xLeft: 8, xRight: 13 });
    });

    it('the nearest cap wins when two of one role claim the same datum', () => {
      const bars = resolveErrorBars([{ x: 2, y: 12 }], [
        { role: 'upper', caps: [{ x: 2.4, y: 99 }, { x: 2.1, y: 15 }] },
      ]);
      expect(bars[0]!.yUpper).toBe(15);
    });

    it('arbitrates by distance across two same-role SERIES, not by argument order', () => {
      // The known limitation: a figure drawing both SD and 95% CI whiskers has
      // two series relating as `upper` and only one yUpper to write, so one is
      // dropped. It must at least be dropped deterministically -- keying the
      // arbitration per-series made the winner depend on which was listed
      // first, so the same project could export different numbers depending on
      // series order. Verified by execution 2026-07-16.
      const target = [{ x: 2, y: 12 }];
      const sd = { role: 'upper' as const, caps: [{ x: 2.05, y: 15 }] };
      const ci = { role: 'upper' as const, caps: [{ x: 2.4, y: 18 }] };
      expect(resolveErrorBars(target, [sd, ci])[0]!.yUpper).toBe(15);
      expect(resolveErrorBars(target, [ci, sd])[0]!.yUpper).toBe(15);
    });

    it('returns the data untouched when nothing is related to it', () => {
      expect(resolveErrorBars(data, [])).toEqual([
        { x: 2, y: 12 },
        { x: 4, y: 26 },
        { x: 6, y: 35 },
      ]);
    });

    it('drops caps rather than inventing data when the target series is empty', () => {
      expect(resolveErrorBars([], [{ role: 'upper', caps: [{ x: 2, y: 15 }] }])).toEqual([]);
    });

    it('omits uncaptured fields rather than nulling them', () => {
      // "not measured" must never read downstream as a value -- the rule the
      // whole error schema follows.
      const bars = resolveErrorBars([{ x: 2, y: 12 }], [{ role: 'upper', caps: [{ x: 2, y: 15 }] }]);
      expect(Object.keys(bars[0]!).sort()).toEqual(['x', 'y', 'yUpper']);
    });
  });
});
