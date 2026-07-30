import { describe, expect, it } from 'vitest';
import { CategoryAxis } from '../categoryAxis.js';

/**
 * CategoryAxis — v2.0 groundwork, unwired.
 *
 * Written before anything binds to this class (see the plan's phasing): a
 * category axis is only a name list here, so these tests are about the list
 * itself -- adding, renaming, reordering, removing -- not about what a bound
 * dataset does with an index into it.
 */

function withThree(): CategoryAxis {
  const ax = new CategoryAxis();
  ax.addCategory('Alpha');
  ax.addCategory('Beta');
  ax.addCategory('Gamma');
  return ax;
}

describe('adding and reading categories', () => {
  it('appends and returns the new index', () => {
    const ax = new CategoryAxis();
    expect(ax.addCategory('Alpha')).toBe(0);
    expect(ax.addCategory('Beta')).toBe(1);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta']);
    expect(ax.getCategoryCount()).toBe(2);
  });

  it('starts empty', () => {
    const ax = new CategoryAxis();
    expect(ax.getCategories()).toEqual([]);
    expect(ax.getCategoryCount()).toBe(0);
  });

  it('finds a category by name, or -1 when absent', () => {
    const ax = withThree();
    expect(ax.getCategoryIndex('Beta')).toBe(1);
    expect(ax.getCategoryIndex('Delta')).toBe(-1);
  });

  it('never coerces a numeric-looking name -- stays a string, unconditionally', () => {
    const ax = new CategoryAxis();
    ax.addCategory('2020');
    expect(ax.getCategories()[0]).toBe('2020');
    expect(typeof ax.getCategories()[0]).toBe('string');
  });
});

describe('renaming', () => {
  it('renames in place, leaving the index and the other names unchanged', () => {
    const ax = withThree();
    expect(ax.renameCategory(1, 'Beta II')).toBe(true);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta II', 'Gamma']);
  });

  it('refuses an out-of-range index and leaves the list untouched', () => {
    const ax = withThree();
    expect(ax.renameCategory(3, 'Delta')).toBe(false);
    expect(ax.renameCategory(-1, 'Delta')).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

describe('reordering — permutation-checked, mirroring Dataset.reorderPixels', () => {
  it('applies order[newIndex] = oldIndex', () => {
    const ax = withThree();
    expect(ax.reorderCategories([2, 0, 1])).toBe(true);
    expect(ax.getCategories()).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('refuses the wrong length', () => {
    const ax = withThree();
    expect(ax.reorderCategories([0, 1])).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('refuses an out-of-range index', () => {
    const ax = withThree();
    expect(ax.reorderCategories([0, 1, 3])).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('refuses the same index twice -- not a permutation', () => {
    const ax = withThree();
    expect(ax.reorderCategories([0, 0, 2])).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('refuses a non-integer index', () => {
    const ax = withThree();
    expect(ax.reorderCategories([0.5, 1, 2])).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('a no-op reorder (identity) succeeds and changes nothing', () => {
    const ax = withThree();
    expect(ax.reorderCategories([0, 1, 2])).toBe(true);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

describe('removing', () => {
  it('removes by index and shifts every later index down by one', () => {
    const ax = withThree();
    expect(ax.removeCategory(1)).toBe(true);
    expect(ax.getCategories()).toEqual(['Alpha', 'Gamma']);
  });

  it('refuses an out-of-range index and leaves the list untouched', () => {
    const ax = withThree();
    expect(ax.removeCategory(5)).toBe(false);
    expect(ax.getCategories()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});
