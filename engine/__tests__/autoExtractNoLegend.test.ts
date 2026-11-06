/**
 * Auto-extract on a bar chart with no legend (docs/v2.7-workflow-walk.md, "Auto-extract on a bar chart with no
 * legend", David 2026-11-06): the series are the bar colours the detector's bars show, unnamed entries named by the
 * plan after the series they go into.
 */
import { describe, expect, it } from 'vitest';
import { entriesFromBars, planAutoExtract } from '../autoExtract.js';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';

const BAR = ALL_AXES_TYPE_CONFIGS.find((c) => c.id === 'bar')!;
type RGB = [number, number, number];
const NAVY: RGB = [31, 78, 121];
const ORANGE: RGB = [255, 127, 14];
const WHITE: RGB = [255, 255, 255];
const W = 200, H = 120;

function figure(bars: { x0: number; y0: number; x1: number; y1: number; c: RGB; hatch?: boolean }[], paper: RGB = WHITE) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { d[i * 4] = paper[0]; d[i * 4 + 1] = paper[1]; d[i * 4 + 2] = paper[2]; d[i * 4 + 3] = 255; }
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
const one = [{ index: 0, name: 'Series 1', pointCount: 0, color: [31, 119, 180] }];
const intoOf = (plan: ReturnType<typeof planAutoExtract>) => plan.map((s) => ('into' in s ? s.into : null));

describe('Auto-extract on a bar chart with no legend', () => {
  it('given a bar chart with one bar colour and no legend marked, its bars are read into Series 1', () => {
    const bars = [
      { x0: 10, y0: 20, x1: 40, y1: 110, c: NAVY },
      { x0: 60, y0: 50, x1: 90, y1: 110, c: NAVY },
      { x0: 110, y0: 30, x1: 140, y1: 110, c: NAVY },
    ];
    const entries = entriesFromBars(bars, figure(bars), W, H, null);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('');
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
    const entries = entriesFromBars(bars, figure(bars), W, H, null);
    expect(near(entries[0]!.colour, NAVY) && near(entries[1]!.colour, ORANGE)).toBe(true);
    const plan = planAutoExtract(BAR, entries, one);
    expect(plan.map((s) => s.name)).toEqual(['Series 1', 'Series 2']);
    expect(intoOf(plan)).toEqual([0, 'new']);
  });

  it('given detector boxes over the paper (no bar of a colour), no series is read', () => {
    expect(entriesFromBars([{ x0: 10, y0: 10, x1: 50, y1: 50 }], figure([]), W, H, null)).toEqual([]);
  });

  it('given a detector box it is unsure of over another colour, it is no series', () => {
    const bars = [{ x0: 10, y0: 20, x1: 40, y1: 110, c: NAVY }, { x0: 60, y0: 50, x1: 90, y1: 110, c: ORANGE }];
    const entries = entriesFromBars([{ ...bars[0]!, score: 0.98 }, { ...bars[1]!, score: 0.2 }], figure(bars), W, H, null);
    expect(entries).toHaveLength(1);
    expect(near(entries[0]!.colour, NAVY)).toBe(true);
  });

  // the code review of 2026-11-06 (02248a6..d4deb83)
  it('given Auto-extract pressed again, the bars go back into the series of their colour, never a second copy', () => {
    const bars = [{ x0: 10, y0: 20, x1: 40, y1: 110, c: NAVY }];
    const entries = entriesFromBars(bars, figure(bars), W, H, null);
    const plan = planAutoExtract(BAR, entries, [{ index: 0, name: 'Series 1', pointCount: 12, color: NAVY }]);
    expect(plan[0]).toMatchObject({ name: 'Series 1', into: 0 });
  });

  it('given a series already called Series 2, a new bar colour is never given its name (its data is not replaced)', () => {
    const bars = [{ x0: 10, y0: 20, x1: 40, y1: 110, c: NAVY }];
    const entries = entriesFromBars(bars, figure(bars), W, H, null);
    const plan = planAutoExtract(BAR, entries, [{ index: 0, name: 'Series 2', pointCount: 5, color: ORANGE }]);
    expect(plan[0]).toMatchObject({ name: 'Series 1', into: 'new' });
  });

  it('given a bar outside the data area (another panel), its colour is no series', () => {
    const bars = [{ x0: 10, y0: 20, x1: 40, y1: 110, c: NAVY }, { x0: 150, y0: 20, x1: 180, y1: 110, c: ORANGE }];
    const entries = entriesFromBars(bars, figure(bars), W, H, { x: 0, y: 0, width: 120, height: H });
    expect(entries).toHaveLength(1);
    expect(near(entries[0]!.colour, NAVY)).toBe(true);
  });

  it('given a grey panel behind the bars, the panel is the paper, not a bar colour', () => {
    const GREY: RGB = [228, 228, 228];
    const bars = [{ x0: 10, y0: 60, x1: 40, y1: 110, c: NAVY }];
    // a detector box reaching up over the panel above the bar: its middle half is mostly panel
    const entries = entriesFromBars([{ x0: 10, y0: 0, x1: 40, y1: 110 }], figure(bars, GREY), W, H, null);
    expect(entries).toEqual([]);
  });
});
