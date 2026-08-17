/**
 * Adding error bars to points that already exist — the LabPlot failure mode.
 *
 * ⚑⚑ DAVID SET THIS REQUIREMENT, 2026-08-17, from what is wrong with LabPlot's
 * implementation: *"points needed to be Errorplots from the beginning, and if
 * they were not, you lost whatever points you had placed. We want flexibility.
 * So you should be able to place points, and then ADD error bars to them (if
 * that means replacing internally that is fine)."*
 *
 * ⚠️ AND THE NAIVE ROUTE REALLY DOES LOSE THEM — measured before writing this,
 * not assumed. `setSlotNames(...)` on a dataset holding 7 plain points gives
 * `count = 7`, `hasSlots = true`, `tuples = 0`. The pixels are still in storage,
 * so nothing looks broken from the inside, but:
 *   · the data panel is chosen by `hasSlots`, so it switches to the TUPLE table
 *     and renders ZERO rows;
 *   · `getExportShape()` returns `'tuples'`, so the CSV is built from tuples and
 *     comes out EMPTY.
 * Seven measured points, present in memory, absent from the table and from the
 * file. That is worse than losing them outright, because nothing reports it.
 *
 * `adoptSlots` is the one entrance that cannot do that.
 */
import { describe, it, expect } from 'vitest';
import { Dataset } from '../dataset.js';

const SLOTS = ['Value', 'Upper', 'Lower', 'Left', 'Right'];

function seriesOf(n: number): Dataset {
  const ds = new Dataset();
  for (let i = 0; i < n; i++) ds.addPixel(i * 10, 50 + i);
  return ds;
}

describe('adding error bars to a series that already has points', () => {
  it('keeps every point, as its own tuple', () => {
    const ds = seriesOf(7);
    ds.adoptSlots(SLOTS);
    expect(ds.getCount(), 'no pixel may be dropped').toBe(7);
    expect(ds.getAllTuples(), 'every point becomes a tuple of its own').toHaveLength(7);
  });

  it('each tuple points at the point it was made from, in order', () => {
    // The pairing must be identity, not "some point" -- a tuple that pointed at
    // the wrong pixel would put every reading against the wrong row, which is
    // the mis-pairing this whole record change exists to remove.
    const ds = seriesOf(4);
    ds.adoptSlots(SLOTS);
    ds.getAllTuples().forEach((tuple, i) => {
      expect(tuple[0], `tuple ${i} must hold pixel ${i}`).toBe(i);
    });
  });

  it('leaves every extent slot EMPTY — adopting is not measuring', () => {
    // Tenet 9 at its plainest: turning on the capability must not invent a cap.
    // A zero-height error bar is a claim about the figure; an absent one is not.
    const ds = seriesOf(3);
    ds.adoptSlots(SLOTS);
    for (const tuple of ds.getAllTuples()) {
      expect(tuple.slice(1), 'no extent may be fabricated').toEqual([null, null, null, null]);
    }
  });

  it('the points still export, because the tuple table can see them', () => {
    // The regression that motivated this: `hasSlots` flips the panel AND the
    // export shape, so tuples must exist the instant it becomes true.
    const ds = seriesOf(5);
    ds.adoptSlots(SLOTS);
    expect(ds.hasSlots()).toBe(true);
    expect(ds.getAllTuples().length, 'a slotted series with no tuples exports nothing').toBe(ds.getCount());
  });

  it('is safe to run twice — the second time changes nothing', () => {
    // The UI cannot be trusted to ask only once (adding a second cap, reloading,
    // an undo/redo round trip), so this has to be idempotent rather than
    // guarded by its caller.
    const ds = seriesOf(3);
    ds.adoptSlots(SLOTS);
    const first = JSON.stringify(ds.getAllTuples());
    ds.adoptSlots(SLOTS);
    expect(JSON.stringify(ds.getAllTuples())).toBe(first);
    expect(ds.getCount()).toBe(3);
  });

  it('does not disturb a series that was ALREADY slotted and half-captured', () => {
    // A bar/box series arrives here with real tuples and deliberate nulls. Those
    // nulls mean "not captured yet" and must survive untouched -- rebuilding
    // one-tuple-per-pixel would tear a two-corner bar into two half bars.
    const ds = seriesOf(4); // 4 pixels = 2 bars, say
    ds.adoptSlots(['Bar start', 'Bar end']);
    ds.getAllTuples().forEach(() => undefined);
    // Re-shape into two real pairs, the way a bar capture would.
    while (ds.getAllTuples().length > 0) ds.removeTuple(0);
    ds.addTuple(0);
    ds.addToTupleAt(0, 1, 1);
    ds.addTuple(2); // second bar, second corner not yet placed
    const before = JSON.stringify(ds.getAllTuples());
    ds.adoptSlots(['Bar start', 'Bar end']);
    expect(JSON.stringify(ds.getAllTuples()), 'an existing pairing must not be rebuilt').toBe(before);
  });

  it('an empty series gains slots and stays empty', () => {
    const ds = new Dataset();
    ds.adoptSlots(SLOTS);
    expect(ds.hasSlots()).toBe(true);
    expect(ds.getAllTuples()).toHaveLength(0);
    expect(ds.getCount()).toBe(0);
  });
});
