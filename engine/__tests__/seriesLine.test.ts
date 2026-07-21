import { describe, expect, it } from 'vitest';
import { polylineRuns } from '../seriesLine.js';

describe('polylineRuns — connect dense curves, leave scatters as dots (checkpoint 131)', () => {
  it('returns one run spanning a dense per-column traced curve', () => {
    // 500 points ~1px apart in x with a smooth y -- the stress-strain trace shape
    // that rendered as a furry band of overlapping dots.
    const pts = Array.from({ length: 500 }, (_, i) => ({ x: 69 + i, y: 631 - Math.round(i * 1.2) }));
    const runs = polylineRuns(pts);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(500);
  });

  it('returns no runs for a scatter (markers many px apart) so it stays dots', () => {
    const pts = [
      { x: 10, y: 10 },
      { x: 80, y: 40 },
      { x: 150, y: 20 },
      { x: 210, y: 90 },
      { x: 300, y: 55 },
    ];
    expect(polylineRuns(pts)).toEqual([]);
  });

  it('breaks the line at a genuine discontinuity instead of bridging it', () => {
    // Two dense segments (1px steps) separated by a 60px jump -- a dashed gap.
    const left = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 }));
    const right = Array.from({ length: 20 }, (_, i) => ({ x: 80 + i, y: 0 }));
    const runs = polylineRuns([...left, ...right]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(20);
    expect(runs[1]).toHaveLength(20);
  });

  it('never moves a point -- runs preserve coordinates and order exactly', () => {
    // A gentle dense curve (1px steps) so it connects into one run; the run must
    // be the same points, same order, unchanged.
    const pts = Array.from({ length: 5 }, (_, i) => ({ x: i, y: i }));
    expect(polylineRuns(pts)[0]).toEqual(pts);
  });

  it('returns [] for fewer than 2 points', () => {
    expect(polylineRuns([])).toEqual([]);
    expect(polylineRuns([{ x: 1, y: 2 }])).toEqual([]);
  });
});
