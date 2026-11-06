/**
 * Auto-extract on a bar chart with no legend (docs/v2.7-workflow-walk.md, "Auto-extract on a bar chart with no
 * legend", David 2026-11-06): the series are the bar colours the detector's bars show.
 */
import { describe, expect, it } from 'vitest';
import { entriesFromBars, planAutoExtract } from '../autoExtract.js';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';

const BAR = ALL_AXES_TYPE_CONFIGS.find((c) => c.id === 'bar')!;
type RGB = [number, number, number];
const NAVY: RGB = [31, 78, 121];
const ORANGE: RGB = [255, 127, 14];
const W = 200, H = 120;

function figure(bars: { x0: number; y0: number; x1: number; y1: number; c: RGB; hatch?: boolean }[]) {
  const d = new Uint8ClampedArray(W * H * 4).fill(255);
  for (const b of bars) {
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const i = (y * W + x) * 4;
        const c = b.hatch && (x + y) % 8 < 2 ? [0, 0, 0] : b.c;
        d[i] = c[0]!; d[i + 1] = c[1]!; d[i + 2] = c[2]!;
      }
    }
  }
  return d;
}
const near = (a: RGB | null, b: RGB) => !!a && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 12;
const one = [{ index: 0, name: 'Series 1', pointCount: 0 }];

describe('Auto-extract on a bar chart with no legend', () => {
  it('given a bar chart with one bar colour and no legend marked, its bars are read into Series 1', () => {
    const bars = [
      { x0: 10, y0: 20, x1: 40, y1: 110, c: NAVY },
      { x0: 60, y0: 50, x1: 90, y1: 110, c: NAVY },
      { x0: 110, y0: 30, x1: 140, y1: 110, c: NAVY },
    ];
    const entries = entriesFromBars(bars, figure(bars), W, H, one);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('Series 1');
    expect(near(entries[0]!.colour, NAVY)).toBe(true);
    const plan = planAutoExtract(BAR, entries, one);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ name: 'Series 1', into: 0 });
  });

  it('given two bar colours and no legend marked, each colour is read into a series of its own, Series 1 and Series 2', () => {
    const bars = [
      { x0: 10, y0: 20, x1: 30, y1: 110, c: NAVY },
      { x0: 30, y0: 40, x1: 50, y1: 110, c: ORANGE, hatch: true },
      { x0: 80, y0: 30, x1: 100, y1: 110, c: NAVY },
      { x0: 100, y0: 60, x1: 120, y1: 110, c: ORANGE, hatch: true },
    ];
    const entries = entriesFromBars(bars, figure(bars), W, H, one);
    expect(entries.map((e) => e.name)).toEqual(['Series 1', 'Series 2']);
    expect(near(entries[0]!.colour, NAVY) && near(entries[1]!.colour, ORANGE)).toBe(true);
    const plan = planAutoExtract(BAR, entries, one);
    expect(plan.map((s) => ('into' in s ? s.into : null))).toEqual([0, 'new']);
  });

  it('given detector boxes over the paper (no bar of a colour), no series is read', () => {
    expect(entriesFromBars([{ x0: 10, y0: 10, x1: 50, y1: 50 }], figure([]), W, H, one)).toEqual([]);
  });

  it('given a detector box it is unsure of over another colour, it is no series', () => {
    const bars = [{ x0: 10, y0: 20, x1: 40, y1: 110, c: NAVY }, { x0: 60, y0: 50, x1: 90, y1: 110, c: ORANGE }];
    const entries = entriesFromBars([{ ...bars[0]!, score: 0.98 }, { ...bars[1]!, score: 0.2 }], figure(bars), W, H, one);
    expect(entries.map((e) => e.name)).toEqual(['Series 1']);
    expect(near(entries[0]!.colour, NAVY)).toBe(true);
  });
});
