import { describe, expect, it } from 'vitest';
import { computeBoxPlotGlyph, type BoxPlotPoints } from '../boxPlotGlyph.js';

describe('computeBoxPlotGlyph', () => {
  const verticalPoints: BoxPlotPoints = {
    min: { x: 300, y: 500 },
    q1: { x: 300, y: 460 },
    median: { x: 300, y: 420 },
    q3: { x: 300, y: 380 },
    max: { x: 300, y: 340 },
  };

  it('builds 9 segments (2 whiskers, 2 caps, 4 box sides, 1 median) for a vertical box plot', () => {
    const segments = computeBoxPlotGlyph(verticalPoints, 'vertical');
    expect(segments).toHaveLength(9);
    expect(segments).toEqual([
      { from: { x: 300, y: 500 }, to: { x: 300, y: 460 } }, // whisker: min-q1
      { from: { x: 300, y: 380 }, to: { x: 300, y: 340 } }, // whisker: q3-max
      { from: { x: 290, y: 500 }, to: { x: 310, y: 500 } }, // min cap
      { from: { x: 290, y: 340 }, to: { x: 310, y: 340 } }, // max cap
      { from: { x: 280, y: 460 }, to: { x: 320, y: 460 } }, // box top (q1)
      { from: { x: 320, y: 460 }, to: { x: 320, y: 380 } }, // box side
      { from: { x: 320, y: 380 }, to: { x: 280, y: 380 } }, // box bottom (q3)
      { from: { x: 280, y: 380 }, to: { x: 280, y: 460 } }, // box side
      { from: { x: 280, y: 420 }, to: { x: 320, y: 420 } }, // median line
    ]);
  });

  it('averages a slightly jittered cross position across all 5 points', () => {
    const jittered: BoxPlotPoints = {
      min: { x: 296, y: 500 },
      q1: { x: 300, y: 460 },
      median: { x: 302, y: 420 },
      q3: { x: 298, y: 380 },
      max: { x: 304, y: 340 },
    };
    // cross = (296+300+302+298+304)/5 = 300, same as the exact-alignment case.
    const segments = computeBoxPlotGlyph(jittered, 'vertical');
    expect(segments[4]).toEqual({ from: { x: 280, y: 460 }, to: { x: 320, y: 460 } });
  });

  it('swaps value/cross axes for a horizontal (rotated Bar axes) box plot', () => {
    const horizontalPoints: BoxPlotPoints = {
      min: { x: 500, y: 300 },
      q1: { x: 460, y: 300 },
      median: { x: 420, y: 300 },
      q3: { x: 380, y: 300 },
      max: { x: 340, y: 300 },
    };
    const segments = computeBoxPlotGlyph(horizontalPoints, 'horizontal');
    // Same shape as the vertical case with x/y transposed throughout.
    const verticalEquivalent = computeBoxPlotGlyph(verticalPoints, 'vertical');
    const transposed = verticalEquivalent.map((s) => ({
      from: { x: s.from.y, y: s.from.x },
      to: { x: s.to.y, y: s.to.x },
    }));
    expect(segments).toEqual(transposed);
  });
});
