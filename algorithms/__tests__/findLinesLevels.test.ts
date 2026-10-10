/**
 * Find lines - reading labels and levels as a field: the agreed cases N2, N3,
 * L4 and C4 (docs/v2.6-curves-cases.md), each a test of the same name.
 */
import { describe, it, expect } from 'vitest';
import { readSlots, levelsFromReads, type LabelSlot } from '../findLines/labels.js';
import { inferLevels } from '../findLines/levels.js';
import type { Pt } from '../findLines/geom.js';

const read = (text: string, confidence: number | null = 0.95) => ({ text, confidence });

describe('reading a label (N2: a refused read says why)', () => {
  it('N2 an unsure read is refused, and says so', () => {
    const [r] = readSlots([read('4', 0.5)]);
    expect(r!.value).toBeNull();
    expect(r!.refused).toMatch(/unsure/);
  });

  it('N2 a read that lost its decimal point is refused', () => {
    const [r] = readSlots([read('02')]);
    expect(r!.value).toBeNull();
    expect(r!.refused).toMatch(/decimal point/);
  });

  it('N2 a read with a different number of decimals from the figure\'s other labels is refused', () => {
    const rs = readSlots([read('0.2'), read('0.4'), read('30'), read('0.6')]);
    expect(rs.map((r) => r.value)).toEqual([0.2, 0.4, null, 0.6]);
    expect(rs[2]!.refused).toMatch(/1 decimals|decimals where/);
  });

  it('N2 a read that is not a number is refused, and the matplotlib minus is a minus', () => {
    const rs = readSlots([read('a3'), read('−0.5')]);
    expect(rs[0]!.value).toBeNull();
    expect(rs[0]!.refused).toMatch(/not a number/);
    expect(rs[1]!.value).toBe(-0.5);
  });

  it('L4 two labels on one line that disagree leave its level unset, with both values kept', () => {
    const slots: LabelSlot[] = [0, 0].map((line) => ({ line, p0: [0, 0], p1: [10, 0], angle: 0, halfH: 4, inkFrom: 2, inkTo: 8 }));
    const [lv] = levelsFromReads(1, slots, readSlots([read('2'), read('3')]));
    expect(lv!.value).toBeNull();
    expect(lv!.conflict).toEqual([2, 3]);
  });
});

/** Concentric circles, radius 30 + 20k - contour lines of a cone, in order. */
function rings(n: number): Pt[][] {
  return [...Array(n).keys()].map((k) => {
    const r = 30 + 20 * k;
    return [...Array(361).keys()].map((a) => [200 + r * Math.cos((a * Math.PI) / 180), 200 + r * Math.sin((a * Math.PI) / 180)] as Pt);
  });
}

describe('levels as a field', () => {
  it('C4 an unlabelled line between two labelled lines gets its level by equal steps, marked interpolated', () => {
    const L = rings(5);
    const reads = [10, 20, null, 40, 50];
    const f = inferLevels(L.map((points, k) => ({ points, read: reads[k]! })), 400, 400);
    expect(f.step).toBe(10);
    expect(f.levels[2]).toEqual({ value: 30, source: 'interpolated', refused: null });
    expect(f.levels[0]!.source).toBe('label');
  });

  it('C4 beyond the last label, the neighbouring step carries on', () => {
    const L = rings(5);
    const reads = [10, 20, 30, null, null];
    const f = inferLevels(L.map((points, k) => ({ points, read: reads[k]! })), 400, 400);
    expect(f.levels[3]!.value).toBe(40);
    expect(f.levels[3]!.source).toBe('interpolated');
  });

  it('N3 uneven levels: nothing is interpolated, and the screen is told why', () => {
    const L = rings(5);
    const reads = [1, 2, 5, 10, null];
    const f = inferLevels(L.map((points, k) => ({ points, read: reads[k]! })), 400, 400);
    expect(f.uneven).toMatch(/differ by/);
    expect(f.levels[4]!.value).toBeNull();
    // and the reads themselves stand: uneven levels are values, not misreads
    expect(f.levels.slice(0, 4).map((l) => l.value)).toEqual([1, 2, 5, 10]);
  });

  it('N2 a read the lines around it contradict is refused, with what they say', () => {
    const L = rings(5);
    const reads = [10, 20, 80, 40, 50];
    const f = inferLevels(L.map((points, k) => ({ points, read: reads[k]! })), 400, 400);
    expect(f.levels[2]!.refused?.read).toBe(80);
    expect(f.levels[2]!.refused?.why).toMatch(/30|disagrees/);
  });
});

describe('levels in the level axis\'s own scale (L2)', () => {
  it('L2 on a log level axis one unlabelled line between 10 and 1000 is 100, not 505', async () => {
    const { inferLevelsInScale } = await import('../findLines/levels.js');
    const L = rings(5);
    const reads = [1, 10, null, 1000, 10000];
    const f = inferLevelsInScale(L.map((points, k) => ({ points, read: reads[k]! })), 400, 400, true);
    if ('error' in f) throw new Error(f.error);
    expect(f.levels[2]).toEqual({ value: 100, source: 'interpolated', refused: null });
    expect(f.levels[0]!.value).toBe(1);
  });

  it('L2 the same lines on a linear axis get NO interpolated level - 1, 10, 1000, 10000 are not equal steps, and a line between 10 and 1000 is not "beyond" 1 and 10', async () => {
    const { inferLevelsInScale } = await import('../findLines/levels.js');
    const L = rings(5);
    const reads = [1, 10, null, 1000, 10000];
    const f = inferLevelsInScale(L.map((points, k) => ({ points, read: reads[k]! })), 400, 400, false);
    if ('error' in f) throw new Error(f.error);
    expect(f.levels[2]!.value).toBeNull();
  });

  it('L2 a level of 0 or below is refused on a log level axis, and says why', async () => {
    const { inferLevelsInScale } = await import('../findLines/levels.js');
    const L = rings(3);
    const f = inferLevelsInScale(L.map((points, k) => ({ points, read: [0, 10, null][k]! })), 400, 400, true);
    expect('error' in f && f.error).toMatch(/above 0/);
  });
});
