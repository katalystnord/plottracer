import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPng } from '../../engine/__tests__/helpers/readPng.js';
import { findLines } from '../findLines/lines.js';

/**
 * Spectra (v2.7; David, 2026-11-02: the spectrum pieces are fixed in v2.7, after the cards, and the measured spectra
 * become the tests; docs/v2.7-workflow-walk.md, under "Colour trace on XY reads points only"). Measured 2026-11-02:
 * Find lines broke an IR spectrum into one piece per few peaks (23 on the 100 dpi figure), each break a place to
 * check, and missed 17 of its 47 peak tips. The figures are drawn by `fixtures/findLines/spectra/spectra.py`, so the
 * truth is the drawn polyline itself.
 */

type P = [number, number];
interface Truth { box: [number, number, number, number]; series: { colour: [number, number, number]; points: P[] }[] }
const DIR = 'algorithms/__tests__/fixtures/findLines/spectra/';

function read(name: string, series = 0) {
  const t = JSON.parse(readFileSync(`${DIR}${name}.truth.json`, 'utf8')) as Truth;
  const img = readPng(`${DIR}${name}.png`);
  const [x0, y0, x1, y1] = t.box;
  const s = t.series[series]!;
  const others = t.series.filter((_, i) => i !== series).map((o) => o.colour);
  const r = findLines(img.data, img.width, img.height, s.colour, { x0, y0, x1, y1 }, { contour: false, masks: [], ...(others.length ? { otherInks: others } : {}) });
  return { r, truth: s.points, box: { x0, y0, x1, y1 } };
}

/** The drawn curve's peak tips inside the frame: its local extremes up or down, three samples either side. */
function tips(truth: readonly P[], box: { x0: number; y0: number; x1: number; y1: number }): P[] {
  const inside = truth.filter(([x, y]) => x > box.x0 + 4 && x < box.x1 - 4 && y > box.y0 + 4 && y < box.y1 - 4);
  const out: P[] = [];
  for (let i = 3; i + 3 < inside.length; i++) {
    const y = inside[i]![1];
    const around = [-3, -2, -1, 1, 2, 3].map((k) => inside[i + k]![1]);
    if (around.every((v) => v < y) || around.every((v) => v > y)) out.push(inside[i]!);
  }
  return out;
}

const missed = (points: readonly P[], at: readonly P[]) => at.filter((t) => !points.some((p) => Math.hypot(p[0] - t[0], p[1] - t[1]) <= 3));

describe('a narrow peak is read through its tip, not split there', () => {
  it('given one narrow, deep peak on a flat baseline, Find lines reads it as one line, with no place to check, through its tip', () => {
    const { r, truth, box } = read('one-narrow-peak');
    expect(r.lines).toHaveLength(1);
    expect(r.places).toEqual([]);
    const points = r.lines[0]!.points as P[];
    expect(missed(points, tips(truth, box))).toEqual([]);
  });

  it('given a curve drawn through filled markers, it is one line on the curve, with no detour into a marker', () => {
    const { r, truth } = read('line-through-markers');
    expect(r.lines).toHaveLength(1);
    expect(r.places).toEqual([]);
    expect(r.lines[0]!.roles.filter((x) => x === 'shared')).toEqual([]);
    // as before the change (measured 2026-11-04): the markers' own ink beside the curve, nothing walked out into them
    const off = (r.lines[0]!.points as P[]).filter((p) => !truth.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= 2.5));
    expect(off.length).toBeLessThanOrEqual(271);
  });

  it('given the noisy IR spectrum (a black line with noise), Find lines reads it in 32 pieces at most (48 before)', () => {
    expect(read('ir-noisy').r.lines.length).toBeLessThanOrEqual(32);
  });

  // ⚑ The five spectra, measured 2026-11-02 before the change and 2026-11-03 after it: the pieces each comes in, and
  // the peak tips with no read point within 3 px. What is left is recorded in the walk notes (narrow peaks that fuse
  // into one meeting with more than two arms, and small bumps on a steep flank); these hold what was won.
  const measured: [string, number, number, number, number][] = [
    // name, series, pieces (was), tips missed at most
    ['ir-100dpi', 0, 3, 23, 5],
    ['ir-150dpi', 0, 3, 25, 3],
    ['raman-sharp', 0, 9, 64, 6],
    ['ir-two', 0, 8, 24, 3],
    ['ir-two', 1, 6, 19, 6],
  ];
  for (const [name, series, pieces, was, tipsMissed] of measured) {
    const label = `${name}${name === 'ir-two' ? ` (series ${series + 1})` : ''}`;
    it(`given the spectrum ${label}, Find lines reads it in ${pieces} pieces at most (${was} before)`, () => {
      expect(read(name, series).r.lines.length).toBeLessThanOrEqual(pieces);
    });

    it(`given the spectrum ${label}, no more than ${tipsMissed} of its peak tips are without a read point within 3 px`, () => {
      const { r, truth, box } = read(name, series);
      const points = r.lines.flatMap((l) => l.points) as P[];
      const t = tips(truth, box);
      expect(t.length).toBeGreaterThan(20);
      expect(missed(points, t).length).toBeLessThanOrEqual(tipsMissed);
    });
  }
});
