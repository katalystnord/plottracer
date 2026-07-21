import { describe, it, expect } from 'vitest';
import { binFromCorners, binsFromCorners, type BinCorner } from '../histogram.js';

describe('histogram bins', () => {
  describe('binFromCorners', () => {
    it('reads both edges and the height from a bar\'s two top corners', () => {
      const bin = binFromCorners({ x: 20, y: 47 }, { x: 30, y: 47 });
      expect(bin).toEqual({ binStart: 20, binEnd: 30, value: 47 });
    });

    it('is independent of click order — right corner first gives the same bin', () => {
      const left: BinCorner = { x: 20, y: 47 };
      const right: BinCorner = { x: 30, y: 47 };
      expect(binFromCorners(right, left)).toEqual(binFromCorners(left, right));
    });

    it('averages the two corner heights, halving hand-click error', () => {
      // Both corners mark the same bar top; a real click misses slightly.
      const bin = binFromCorners({ x: 20, y: 46 }, { x: 30, y: 48 });
      expect(bin.value).toBe(47);
    });

    it('handles bins left of the origin and negative magnitudes', () => {
      const bin = binFromCorners({ x: -5, y: -12 }, { x: -1, y: -12 });
      expect(bin).toEqual({ binStart: -5, binEnd: -1, value: -12 });
    });

    it('leaves valueErr unset — nothing captures uncertainty yet', () => {
      expect(binFromCorners({ x: 0, y: 1 }, { x: 1, y: 1 }).valueErr).toBeUndefined();
    });
  });

  describe('binsFromCorners', () => {
    it('maps complete corner-pairs to bins in capture order', () => {
      const bins = binsFromCorners([
        [{ x: 0, y: 3 }, { x: 10, y: 3 }],
        [{ x: 10, y: 8 }, { x: 20, y: 8 }],
      ]);
      expect(bins).toEqual([
        { binStart: 0, binEnd: 10, value: 3 },
        { binStart: 10, binEnd: 20, value: 8 },
      ]);
    });

    it('yields null in place for a bin with only one corner placed so far', () => {
      const bins = binsFromCorners([
        [{ x: 0, y: 3 }, { x: 10, y: 3 }],
        [{ x: 10, y: 8 }, null],
      ]);
      expect(bins).toEqual([{ binStart: 0, binEnd: 10, value: 3 }, null]);
    });

    it('preserves index alignment so a partial bin can still show as its own row', () => {
      const bins = binsFromCorners([
        [null, null],
        [{ x: 10, y: 8 }, { x: 20, y: 8 }],
      ]);
      expect(bins).toHaveLength(2);
      expect(bins[0]).toBeNull();
      expect(bins[1]).toEqual({ binStart: 10, binEnd: 20, value: 8 });
    });

    it('does not re-sort — capture order is kept so table and export agree', () => {
      const bins = binsFromCorners([
        [{ x: 30, y: 1 }, { x: 40, y: 1 }],
        [{ x: 0, y: 5 }, { x: 10, y: 5 }],
      ]);
      expect(bins.map((b) => b?.binStart)).toEqual([30, 0]);
    });

    it('keeps uneven bin widths exactly, rather than assuming a uniform grid', () => {
      const bins = binsFromCorners([
        [{ x: 0, y: 2 }, { x: 1, y: 2 }],
        [{ x: 1, y: 9 }, { x: 25, y: 9 }],
      ]);
      expect(bins[0]).toMatchObject({ binStart: 0, binEnd: 1 });
      expect(bins[1]).toMatchObject({ binStart: 1, binEnd: 25 });
    });

    it('returns an empty list for no tuples', () => {
      expect(binsFromCorners([])).toEqual([]);
    });
  });
});
