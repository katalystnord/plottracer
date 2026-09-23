import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * ⚑ A BUNDLED EXAMPLE'S TRUTH MAY ONLY CLAIM WHAT ITS FIGURE DRAWS.
 *
 * Every generator clips its data artists to the axes (matplotlib's default
 * `clip_on=True`), so a truth value outside the axes' own min/max is a value the
 * figure never shows. It cannot be traced, so it cannot be scored: the Trace
 * Challenge charges a perfect player for points nobody can see.
 *
 * Found 2026-09-23: `xy-stress-strain` rose to 54.05 MPa under a y-limit of 50,
 * so the curve left the frame at x = 9.2 and 24 of its 61 truth points were off
 * the figure.
 *
 * Checked against the committed truth files, not a fixture - the rule is about
 * what ships. Coordinates are read per axis: `x` against the x axis, and every
 * value-axis field of the point shapes in samples/generators/README.md against
 * the y axis. Types whose points carry no such field (pie, polar, ternary,
 * spider, heatmap cells) are outside this rule rather than passing it.
 */

type Axis = { min: number; max: number };
type Figure = {
  axes?: Record<string, Partial<Axis> | undefined>;
  series?: { name: string; points: Record<string, unknown>[] }[];
};

const ON_Y = ['y', 'yUpper', 'yLower', 'value', 'min', 'q1', 'median', 'q3', 'max', 'open', 'high', 'low', 'close'];

function axisFor(field: string): 'x' | 'y' | null {
  if (field === 'x') return 'x';
  return ON_Y.includes(field) ? 'y' : null;
}

/** Every numeric coordinate the truth claims that lies outside its own axis. */
function outsideItsAxes(fig: Figure): string[] {
  const out: string[] = [];
  for (const s of fig.series ?? []) {
    for (const p of s.points) {
      for (const [field, v] of Object.entries(p)) {
        const a = axisFor(field);
        const axis = a ? fig.axes?.[a] : undefined;
        if (typeof v !== 'number' || axis?.min === undefined || axis.max === undefined) continue;
        const lo = Math.min(axis.min, axis.max);
        const hi = Math.max(axis.min, axis.max);
        if (v < lo || v > hi) out.push(`${s.name}.${field}=${v} outside [${lo}, ${hi}]`);
      }
    }
  }
  return out;
}

const files = readdirSync('samples').filter((f) => f.endsWith('.truth.json')).sort();

describe('a bundled example’s truth claims only what its figure draws', () => {
  it('finds the truth files it is meant to check', () => {
    // Guards the instrument: an empty glob would pass every case below.
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files)('%s has no value outside its own axes', (file) => {
    const truth = JSON.parse(readFileSync(`samples/${file}`, 'utf8')) as Figure & { figures?: Figure[] };
    const figures = truth.figures ?? [truth];
    expect(figures.flatMap(outsideItsAxes)).toEqual([]);
  });

  it('would catch a value past the top of the axis', () => {
    // The rule shown to fire, independent of any committed file.
    const clipped: Figure = {
      axes: { x: { min: 0, max: 15 }, y: { min: 0, max: 50 } },
      series: [{ name: 's', points: [{ x: 14, y: 54.05 }] }],
    };
    expect(outsideItsAxes(clipped)).toEqual(['s.y=54.05 outside [0, 50]']);
  });
});
