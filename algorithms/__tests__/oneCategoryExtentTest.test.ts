/**
 * ⚑⚑ THE TWO JOINS SHARE THE TEST THEIR HEADERS SAY THEY SHARE.
 *
 * `hatchJoin` and `ruleJoin` are one problem seen twice - the figure drew
 * something across a bar in a colour we drop - and each file states the sharing
 * as its reason for existing: *"they are fixed the same way, in the same place
 * in the pipeline, using the same `sameCategoryExtent` test."*
 *
 * ⚠️ EACH CARRIED A PRIVATE COPY. Two `SAME_CATEGORY_OVERLAP = 0.9` constants
 * and two verbatim helpers, in one directory, under two comments asserting they
 * were shared - and the comment is what stops the next reader from checking.
 * A number that must agree with another number, with nothing making it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SAME_CATEGORY_OVERLAP, sameCategoryExtent } from '../categoryExtent.js';
import type { Blob } from '../blobDetect.js';

const SOURCES = {
  hatchJoin: readFileSync('algorithms/hatchJoin.ts', 'utf8'),
  ruleJoin: readFileSync('algorithms/ruleJoin.ts', 'utf8'),
};

const box = (minX: number, maxX: number, minY: number, maxY: number): Blob =>
  ({ bbox: { minX, maxX, minY, maxY } }) as unknown as Blob;

describe('one category-extent test, shared', () => {
  it('neither join declares a threshold of its own', () => {
    for (const [name, src] of Object.entries(SOURCES)) {
      expect(src, `${name} still declares its own constant`).not.toMatch(
        /const SAME_CATEGORY_OVERLAP\s*=/
      );
      expect(src, `${name} still defines its own helper`).not.toMatch(
        /const sameCategoryExtent\s*=/
      );
      expect(src, `${name} does not use the shared one`).toContain("from './categoryExtent.js'");
    }
  });

  it('⚑ the shared rule answers the case both joins exist for', () => {
    // Two halves of one severed bar: identical category extent, split in value.
    expect(sameCategoryExtent(box(10, 30, 0, 40), box(10, 30, 60, 100), 'x')).toBe(true);
    // Two neighbouring bars: they share almost none of their width.
    expect(sameCategoryExtent(box(10, 30, 0, 100), box(40, 60, 0, 100), 'x')).toBe(false);
  });

  it('⚑ and it reads the OTHER axis for a horizontal chart, from one definition', () => {
    // The same two shapes, with the roles of x and y exchanged.
    expect(sameCategoryExtent(box(0, 40, 10, 30), box(60, 100, 10, 30), 'y')).toBe(true);
    expect(sameCategoryExtent(box(0, 100, 10, 30), box(0, 100, 40, 60), 'y')).toBe(false);
  });

  it('⚑ a shape with no width is never anyone’s other half', () => {
    // `widest > 0` is the guard: without it a degenerate blob divides by zero
    // and joins whatever it touches.
    expect(sameCategoryExtent(box(10, 10, 0, 40), box(10, 10, 60, 100), 'x')).toBe(false);
  });

  it('the threshold is a fraction, so it means the same on any figure size', () => {
    expect(SAME_CATEGORY_OVERLAP).toBeGreaterThan(0);
    expect(SAME_CATEGORY_OVERLAP).toBeLessThanOrEqual(1);
  });
});
