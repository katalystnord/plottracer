/**
 * Auto-extract on a scatter whose legend entries share one ink: which markers make each entry's series (v2.7;
 * docs/v2.7-workflow-walk.md, "Series told apart by their markers", the cases). The figures are the study's own
 * (algorithms/__tests__/fixtures/markers, made by markers.py), with their true marker positions.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPng } from './helpers/readPng.js';
import { withMasksBlanked } from '../imageEdit.js';
import { readMarkerSeries, type MarkerSeriesPlan } from '../markerSeries.js';

const DIR = 'algorithms/__tests__/fixtures/markers';
type Box = { x0: number; y0: number; x1: number; y1: number };
type Fig = { box: number[]; legend: number[]; series: { name: string; ink: [number, number, number]; markers: [number, number][]; cut?: [number, number][]; sample: number[] }[] };
const asBox = (b: readonly number[]): Box => ({ x0: b[0]!, y0: b[1]!, x1: b[2]!, y1: b[3]! });

/** The figure as Auto-extract reads it: the legend masked (as the Legend card's Mark legend masks it), the search in the
 * data area, each entry's sample where the legend says. */
function read(name: string, samples: (fig: Fig) => (Box | null)[]): { fig: Fig; plan: MarkerSeriesPlan | null } {
  const fig = JSON.parse(fs.readFileSync(`${DIR}/${name}.json`, 'utf8')) as Fig;
  const img = readPng(`${DIR}/${name}.png`);
  const L = fig.legend;
  const seen = withMasksBlanked(new Uint8ClampedArray(img.data), img.width, img.height, [{ x: L[0]! - 4, y: L[1]! - 4, width: L[2]! - L[0]! + 8, height: L[3]! - L[1]! + 8 }]);
  const B = fig.box;
  const plan = readMarkerSeries({
    data: seen,
    legendData: img.data,
    width: img.width,
    height: img.height,
    target: fig.series[0]!.ink,
    region: { x: B[0]!, y: B[1]!, width: B[2]! - B[0]!, height: B[3]! - B[1]! },
    minDiameter: 3,
    samples: samples(fig),
  });
  // a marker the legend's mask covers, whole or in part, need not be read; if it is, its point is on a marker
  const under = (q: readonly [number, number]) => q[0] >= L[0]! - 12 && q[0] <= L[2]! + 12 && q[1] >= L[1]! - 12 && q[1] <= L[3]! + 12;
  for (const s of fig.series) {
    s.cut = s.markers.filter(under);
    s.markers = s.markers.filter((q) => !under(q));
  }
  return { fig, plan };
}

/** Of a series' true markers, the share with a point of that series within 3 px; and of its points, the share on one. */
function agreement(s: Fig['series'][number], got: readonly { x: number; y: number }[]): { found: number; on: number } {
  const near = (p: { x: number; y: number }, q: readonly [number, number], r = 3) => Math.hypot(p.x - q[0], p.y - q[1]) <= r;
  return {
    found: s.markers.filter((q) => got.some((p) => near(p, q))).length / s.markers.length,
    on: got.filter((p) => s.markers.some((q) => near(p, q)) || (s.cut ?? []).some((q) => near(p, q, 8))).length / Math.max(1, got.length),
  };
}
/** Every doubtful place is at a marker the legend's mask cuts: where the markers are whole, none is doubtful. */
const doubtOnlyWhereCut = (fig: Fig, plan: MarkerSeriesPlan) => {
  const cut = fig.series.flatMap((s) => s.cut ?? []);
  for (const d of plan.doubtful) expect(cut.some((q) => Math.hypot(d.at.x - q[0], d.at.y - q[1]) <= 8), JSON.stringify(d)).toBe(true);
};

describe('which markers make each entry series', () => {
  it('given entries in one ink with different markers (filled circle, square, triangle), each entry gets the markers like its own', () => {
    const { fig, plan } = read('scatter-mpl-filled3', (f) => f.series.map((s) => asBox(s.sample)));
    expect(plan).not.toBeNull();
    fig.series.forEach((s, e) => {
      const a = agreement(s, plan!.perEntry[e]!);
      expect(a.found, `${s.name} found`).toBeGreaterThanOrEqual(0.95);
      expect(a.on, `${s.name} on its own markers`).toBeGreaterThanOrEqual(0.95);
    });
    doubtOnlyWhereCut(fig, plan!);
  });

  it('given open markers (circle, square, triangle), each entry still gets its own', () => {
    const { fig, plan } = read('scatter-mpl-open3', (f) => f.series.map((s) => asBox(s.sample)));
    fig.series.forEach((s, e) => {
      const a = agreement(s, plan!.perEntry[e]!);
      expect(a.found, `${s.name} found`).toBeGreaterThanOrEqual(0.95);
      expect(a.on, `${s.name} on its own markers`).toBeGreaterThanOrEqual(0.95);
    });
  });

  it('given markers of two series drawn over each other, each is its own point in its own series', () => {
    const { fig, plan } = read('scatter-mpl-filled3-dense', (f) => f.series.map((s) => asBox(s.sample)));
    const all = fig.series.reduce((n, s) => n + s.markers.length, 0);
    const got = plan!.perEntry.reduce((n, p) => n + p.length, 0);
    // without the split, the 180 markers read as about 140 points
    expect(got / all).toBeGreaterThanOrEqual(0.95);
    expect(got / all).toBeLessThanOrEqual(1.05);
    // in a cluster of different markers some go to the wrong series: the study measured 90% right on merged blobs
    fig.series.forEach((s, e) => {
      const a = agreement(s, plan!.perEntry[e]!);
      expect(a.found, `${s.name} found`).toBeGreaterThanOrEqual(0.85);
      expect(a.on, `${s.name} on its own markers`).toBeGreaterThanOrEqual(0.85);
    });
  });

  it('given markers of a kind no entry names, each still goes to the entry it is most like, and that entry has one place saying how many are doubtful', () => {
    // the open circles' entry left out of the legend: filled circle, filled square, open square named
    const { fig, plan } = read('scatter-mpl-mixed4', (f) => [f.series[0]!, f.series[2]!, f.series[3]!].map((s) => asBox(s.sample)));
    // two open circles drawn over each other are one point: no entry's marker is theirs to take them apart with
    const all = fig.series.reduce((n, s) => n + s.markers.length, 0);
    expect(plan!.perEntry.reduce((n, p) => n + p.length, 0) / all).toBeGreaterThanOrEqual(0.9);
    // the open circles went to one or more of the named entries, and are said as doubtful, once per entry
    expect(plan!.doubtful.length).toBeGreaterThanOrEqual(1);
    expect(new Set(plan!.doubtful.map((d) => d.entry)).size).toBe(plan!.doubtful.length);
    expect(plan!.doubtful.reduce((n, d) => n + d.count, 0)).toBeGreaterThanOrEqual(20);
    // the place is at one of the entry's own points
    for (const d of plan!.doubtful) expect(plan!.perEntry[d.entry]!.some((p) => p.x === d.at.x && p.y === d.at.y)).toBe(true);
  });

  it('given entries whose markers cannot be told apart, what has that marker is the first entry, and the other is said to share it', () => {
    const { fig, plan } = read('scatter-mpl-filled3', (f) => [asBox(f.series[0]!.sample), asBox(f.series[0]!.sample), asBox(f.series[2]!.sample)]);
    expect(plan!.sameMarkerAs).toEqual([{ entry: 1, as: 0 }]);
    expect(plan!.perEntry[1]).toEqual([]);
    expect(agreement(fig.series[0]!, plan!.perEntry[0]!).found).toBeGreaterThanOrEqual(0.95);
    expect(plan!.empty).toEqual([]);
  });

  it('given an entry whose legend marker could not be measured, it gets no markers and is said to be empty; the others are still matched', () => {
    const { fig, plan } = read('scatter-mpl-filled3', (f) => [asBox(f.series[0]!.sample), null, asBox(f.series[2]!.sample)]);
    expect(plan!.perEntry[1]).toEqual([]);
    expect(plan!.empty).toEqual([1]);
    expect(plan!.unmeasured).toEqual([1]);
    expect(agreement(fig.series[0]!, plan!.perEntry[0]!).found).toBeGreaterThanOrEqual(0.95);
    expect(agreement(fig.series[2]!, plan!.perEntry[2]!).found).toBeGreaterThanOrEqual(0.95);
  });

  it('given entries whose markers cannot be told apart at all, there is no plan: the read goes as before', () => {
    const { plan } = read('scatter-mpl-filled3', (f) => [asBox(f.series[0]!.sample), asBox(f.series[0]!.sample)]);
    expect(plan).toBeNull();
  });
});
