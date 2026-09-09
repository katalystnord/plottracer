/**
 * ⚑⚑ THE COLOUR KEY IS THE THIRD AXIS, SO MOVING IT COUNTS AS THE AXIS MOVING.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-10. The two spatial axes have a whole mechanism for
 * "the calibration moved under a record measured against it" - a stamp, a
 * comparison, and a warning that offers a fresh detection. The third axis had
 * none of it. Moving a key corner, or a labelled tick, or retyping a tick's
 * VALUE, or ticking Log, changes every cell's number and fired nothing, so the
 * table, the project file and every export kept numbers read through a key that
 * no longer exists.
 *
 * Measured on the committed viridis fixture: retyping the second key tick from
 * 100 to 120 moved cell 0 from -30.84 to -32.64, and the stamp was
 * byte-identical.
 *
 * ⚑ Pattern 1 of v2.2's five: *does this belong to the TYPE, or to an AXIS? If
 * an axis, EVERY axis gets it* - here applied to the very mechanism written to
 * close that class of defect.
 */
import { describe, expect, it } from 'vitest';
import { heatmapAxisStamp, heatmapAxisMoved, heatmapAxisMovedKind } from '../heatmapRun.js';

type Placed = Record<string, { px: number; py: number; values?: readonly string[] } | undefined>;

/** A calibrated heatmap: two spatial axes, and a colour key with two ticks. */
function placed(overrides: Placed = {}): Placed {
  return {
    x1: { px: 100, py: 400 },
    x2: { px: 400, py: 400 },
    y1: { px: 100, py: 400 },
    y2: { px: 100, py: 100 },
    k1: { px: 500, py: 100 },
    k2: { px: 520, py: 400 },
    kv1: { px: 510, py: 380, values: ['-20'] },
    kv2: { px: 510, py: 120, values: ['100'] },
    ...overrides,
  };
}

const LOG_ON = { isLogValue: 'true' };

describe('the colour key moving is the axis moving', () => {
  it('⚑ an untouched calibration has not moved - the companion assertion', () => {
    const now = placed();
    expect(heatmapAxisMoved(heatmapAxisStamp(now)!, now)).toBe(false);
  });

  it('⚑⚑ a retyped key VALUE counts, though no pixel moved', () => {
    // The ordinary "I misread the label" correction, and the case measured.
    const before = heatmapAxisStamp(placed())!;
    const after = placed({ kv2: { px: 510, py: 120, values: ['120'] } });
    expect(heatmapAxisMoved(before, after), 'every cell changed and nothing said so').toBe(true);
  });

  it('⚑⚑ ticking LOG counts, though nothing on screen moved at all', () => {
    const before = heatmapAxisStamp(placed())!;
    expect(heatmapAxisMoved(before, placed(), LOG_ON)).toBe(true);
    // ...and back again is a change too: the stamp records a state, not a
    // direction of travel.
    const logStamp = heatmapAxisStamp(placed(), LOG_ON)!;
    expect(heatmapAxisMoved(logStamp, placed())).toBe(true);
  });

  it('⚑ a dragged key corner counts', () => {
    const before = heatmapAxisStamp(placed())!;
    expect(heatmapAxisMoved(before, placed({ k2: { px: 560, py: 400 } }))).toBe(true);
  });

  it('⚑ a labelled tick nudged along the strip counts', () => {
    const before = heatmapAxisStamp(placed())!;
    expect(
      heatmapAxisMoved(before, placed({ kv1: { px: 510, py: 360, values: ['-20'] } }))
    ).toBe(true);
  });

  it('⚑ sub-pixel jitter on the key is not a gesture anybody made', () => {
    const before = heatmapAxisStamp(placed())!;
    expect(
      heatmapAxisMoved(before, placed({ kv1: { px: 510.0001, py: 380, values: ['-20'] } }))
    ).toBe(false);
  });

  it('⚑⚑ a grid stamped before the key was recorded does NOT read as moved', () => {
    // A missing key stamp means "nothing to compare", never "it moved". Getting
    // this backwards would put a warning on every heatmap saved before today.
    const old = heatmapAxisStamp({
      x1: { px: 100, py: 400 },
      x2: { px: 400, py: 400 },
      y1: { px: 100, py: 400 },
      y2: { px: 100, py: 100 },
    })!;
    expect(old.key, 'a calibration with no key should stamp none').toBeUndefined();
    expect(heatmapAxisMoved(old, placed())).toBe(false);
  });

  it('⚑ and the spatial axes still answer for themselves', () => {
    const before = heatmapAxisStamp(placed())!;
    expect(heatmapAxisMoved(before, placed({ x2: { px: 430, py: 400 } }))).toBe(true);
  });

  /**
   * ⚑⚑ AND WHICH ONE MOVED, because the remedy differs. The spatial axes carry
   * the grid with them - "detect the grid again". The key carries no grid; it
   * changes what every cell is WORTH - "read the cells again". One sentence for
   * both would send half the readers to the wrong gesture, which is worse than
   * the silence it replaced.
   */
  it('⚑⚑ names the key when only the key moved', () => {
    const before = heatmapAxisStamp(placed())!;
    expect(heatmapAxisMovedKind(before, placed(), LOG_ON)).toBe('key');
    expect(
      heatmapAxisMovedKind(before, placed({ kv2: { px: 510, py: 120, values: ['120'] } }))
    ).toBe('key');
  });

  it('⚑ names the spatial axes when only they moved', () => {
    const before = heatmapAxisStamp(placed())!;
    expect(heatmapAxisMovedKind(before, placed({ x2: { px: 430, py: 400 } }))).toBe('spatial');
  });

  it('⚑ names both when both did, and nothing when neither did', () => {
    const before = heatmapAxisStamp(placed())!;
    expect(
      heatmapAxisMovedKind(before, placed({ x2: { px: 430, py: 400 } }), LOG_ON)
    ).toBe('both');
    expect(heatmapAxisMovedKind(before, placed())).toBeNull();
  });
});
