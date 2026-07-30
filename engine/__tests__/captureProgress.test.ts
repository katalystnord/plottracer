import { describe, expect, it } from 'vitest';
import { describeCaptureProgress } from '../captureProgress.js';
import { Dataset } from '../../core/dataset.js';

/**
 * The capture-progress SENTENCE (pure string-building, describeCaptureProgress) --
 * these tests are about its text and counting rules only, not where it's displayed.
 * It exists in this form because the old sidebar line was a DUPLICATE of the tips
 * bar, not because the wording was wrong: see captureProgress.ts's own header
 * comment for the full history (v1.6 split it out, v2.0 2026-07-30 folded it back
 * into the tips bar as guidanceTip's slotAimNote suffix). This file never changed
 * through either move -- the sentence-building logic stayed exactly as useful.
 */

/** A dataset with `slots` named slots and the given tuples, built directly — the
 * function takes only what it reads, so no session walk is needed to exercise it. */
function ds(slotNames: string[], tuples: (number | null)[][]): Dataset {
  const d = new Dataset(1);
  d.setSlotNames(slotNames);
  tuples.forEach((t, i) => {
    d.addEmptyTupleAt(i);
    t.forEach((v, g) => {
      if (v !== null) d.addToTupleAt(i, g, v);
    });
  });
  return d;
}

const SPIDER = ['Axis 1', 'Axis 2', 'Axis 3', 'Axis 4', 'Axis 5', 'Axis 6'];
const BOX = ['Min', 'Q1', 'Median', 'Q3', 'Max'];
const SECTOR = ['Sector start', 'Sector end'];

describe('where the next click lands', () => {
  it('names a tuple that does not exist yet as NEW, not by number', () => {
    // Numbering it ahead of the click would name a row the table does not have.
    const p = describeCaptureProgress({
      slotLabel: 'Axis 1',
      tupleIndex: null,
      tupleNoun: 'profile',
      dataset: ds(SPIDER, []),
    });
    expect(p.text).toBe('Next: Axis 1 — new profile (0 of 6 filled)');
  });

  it('numbers an existing tuple from 1, as the table does', () => {
    const p = describeCaptureProgress({
      slotLabel: 'Median',
      tupleIndex: 1,
      tupleNoun: 'box',
      dataset: ds(BOX, [[0, 1, 2, 3, 4], [5, 6, null, null, null]]),
    });
    expect(p.text).toBe('Next: Median — box 2 (2 of 5 filled)');
  });

  it('says nothing at all for a type with no slots', () => {
    // XY and friends: there is no tuple to be part-way through, so the line does not
    // render rather than rendering an empty or meaningless one.
    const p = describeCaptureProgress({
      slotLabel: 'Primary group',
      tupleIndex: null,
      tupleNoun: 'box',
      dataset: ds([], []),
    });
    expect(p.text).toBeNull();
  });
});

describe('what was left unfinished — the part the figure cannot tell you', () => {
  it('counts a profile abandoned part-way', () => {
    // ⚑ The reason this line was worth keeping. A spider's slots are N×1D --
    // independently meaningful and independently EMPTY -- so a profile recorded on
    // four of six axes looks exactly like a complete one unless you scan the table
    // for dashes. Three of those and the export is quietly full of holes.
    const p = describeCaptureProgress({
      slotLabel: 'Axis 1',
      tupleIndex: null,
      tupleNoun: 'profile',
      dataset: ds(SPIDER, [[0, 1, 2, 3, null, null]]),
    });
    expect(p.incompleteElsewhere).toBe(1);
    expect(p.text).toBe('Next: Axis 1 — new profile (0 of 6 filled) · 1 profile incomplete');
  });

  it('pluralises by the count, not by the noun', () => {
    const p = describeCaptureProgress({
      slotLabel: 'Axis 1',
      tupleIndex: null,
      tupleNoun: 'profile',
      dataset: ds(SPIDER, [[0, null, null, null, null, null], [1, 2, null, null, null, null]]),
    });
    expect(p.text).toContain('2 profiles incomplete');
  });

  it('EXCLUDES the tuple in hand, which is incomplete only because you are in it', () => {
    // ⚑ Without this a pie accuses you from the first click to the last: chaining
    // pre-opens the next sector holding the shared boundary, so there is ALWAYS an
    // open tuple. A warning that is permanently on is furniture, not a signal --
    // and worse, it trains the user to ignore the one time it means something.
    const p = describeCaptureProgress({
      slotLabel: 'Sector end',
      tupleIndex: 2,
      tupleNoun: 'sector',
      dataset: ds(SECTOR, [[0, 1], [2, 3], [4, null]]),
    });
    expect(p.incompleteElsewhere).toBe(0);
    expect(p.text).toBe('Next: Sector end — sector 3 (1 of 2 filled)');
  });

  it('EXCLUDES a wholly empty tuple, which is unstarted rather than abandoned', () => {
    const p = describeCaptureProgress({
      slotLabel: 'Axis 1',
      tupleIndex: null,
      tupleNoun: 'profile',
      dataset: ds(SPIDER, [[null, null, null, null, null, null]]),
    });
    expect(p.incompleteElsewhere).toBe(0);
    expect(p.text).not.toContain('incomplete');
  });

  it('says nothing when everything recorded is whole', () => {
    // The clause appears only when it is true — no "0 profiles incomplete".
    const p = describeCaptureProgress({
      slotLabel: 'Axis 1',
      tupleIndex: null,
      tupleNoun: 'profile',
      dataset: ds(SPIDER, [[0, 1, 2, 3, 4, 5]]),
    });
    expect(p.text).toBe('Next: Axis 1 — new profile (0 of 6 filled)');
  });

  it('still counts a straggler while a LATER tuple is being worked on', () => {
    // The two exclusions must not swallow the real case: profile 1 was abandoned at
    // four axes and profile 2 is in hand. Only the first is reported.
    const p = describeCaptureProgress({
      slotLabel: 'Axis 3',
      tupleIndex: 1,
      tupleNoun: 'profile',
      dataset: ds(SPIDER, [
        [0, 1, 2, 3, null, null],
        [4, 5, null, null, null, null],
      ]),
    });
    expect(p.incompleteElsewhere).toBe(1);
    expect(p.text).toBe('Next: Axis 3 — profile 2 (2 of 6 filled) · 1 profile incomplete');
  });
});
