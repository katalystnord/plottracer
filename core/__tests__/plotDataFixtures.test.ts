import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlotData } from '../plotData.js';

/**
 * The v3 and v4 deserializers, against real upstream project files.
 *
 * ⚑ WHY THIS FILE EXISTS. After covering PlotData's relationship layer, 287
 * mutants still survived — almost all of them inside the deserializers
 * themselves, which unit-constructed documents cannot reach. Those paths only
 * run against real files, and we hold four of them: genuine WebPlotDigitizer
 * projects, redistributable because WPD is AGPL-3.0 like us (see
 * engine/__tests__/fixtures/wpd/PROVENANCE.md).
 *
 * ⚑ THE PATTERN IS UPSTREAM'S, AND IT IS THE GOOD IDEA IN THEIR SUITE: every
 * assertion runs TWICE — once on the document as deserialized, and once on
 * `deserialize(serialize(it))`. Reading a file correctly and being able to SAVE
 * what you read are different claims, and only the second one protects a user
 * who opens someone else's project and then presses Save.
 *
 * What we assert is deliberately richer than upstream's. WPD's save_tests.js
 * checks `axesCount === 1` for wpd3_xy and stops; the fixture actually carries
 * four datasets and a measurement, all of which must survive too.
 *
 * `engine/__tests__/wpdImport.test.ts` covers the IMPORT path — enumerating
 * figures, mapping them to our graph types, refusing what it cannot read. This
 * file covers the layer underneath: whether core/plotData.ts reads and rewrites
 * the bytes faithfully.
 */

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../engine/__tests__/fixtures/wpd'
);

/**
 * Load a fixture and return it twice: as deserialized, and after a full
 * serialize/deserialize cycle. Both must satisfy every assertion.
 */
function bothWays(fixture: string): [PlotData, PlotData] {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES, fixture), 'utf8'));

  const loaded = new PlotData();
  expect(loaded.deserialize(raw), `${fixture} should deserialize`).not.toBe(false);

  const roundTripped = new PlotData();
  const rewritten = JSON.parse(JSON.stringify(loaded.serialize()));
  expect(roundTripped.deserialize(rewritten), `${fixture} should survive a re-save`).not.toBe(false);

  return [loaded, roundTripped];
}

/** Dataset names paired with their point counts, in document order. */
const shape = (pd: PlotData): [string, number][] =>
  pd.getDatasets().map((d) => [d.name, d.getCount()]);

describe('PlotData — pre-v4 projects (the legacy deserializer)', () => {
  it.each(bothWays('wpd3_xy.json').map((pd, i) => [i === 0 ? 'as read' : 're-saved', pd] as const))(
    'reads a v3 XY project with all four series (%s)',
    (_stage, pd) => {
      expect(pd.getAxesCount()).toBe(1);
      expect(pd.getAxesNames()).toEqual(['XY']);
      // Upstream asserts only the axes count here. The fixture has far more in
      // it, and a deserializer that dropped a series would pass their test.
      expect(shape(pd)).toEqual([
        ['blue', 144],
        ['yellow', 147],
        ['red', 56],
        ['green', 56],
      ]);
      expect(pd.getMeasurementColl()).toHaveLength(1);
    }
  );

  it.each(bothWays('wpd3_bar.json').map((pd, i) => [i === 0 ? 'as read' : 're-saved', pd] as const))(
    'reads a v3 BAR project, whose axes type is chosen differently (%s)',
    (_stage, pd) => {
      // The pre-v4 path branches on `axesType`, so bar and xy exercise different
      // construction. Both matter: this is the format real old projects are in.
      expect(pd.getAxesCount()).toBe(1);
      expect(pd.getAxesNames()).toEqual(['Bar']);
      expect(shape(pd)).toEqual([['Default Dataset', 5]]);
    }
  );
});

describe('PlotData — a v4 project with all six axes types', () => {
  it.each(bothWays('wpd4.json').map((pd, i) => [i === 0 ? 'as read' : 're-saved', pd] as const))(
    'keeps every axes, dataset and binding (%s)',
    (_stage, pd) => {
      expect(pd.getAxesCount()).toBe(6);
      expect(pd.getAxesNames()).toEqual(['xy axes', 'Bar', 'Polar', 'Ternary', 'Map', 'Image']);
      expect(shape(pd)).toEqual([
        ['xy data', 144],
        ['bar data', 3],
        ['polar data', 3],
        ['ternary data', 3],
        ['map data', 0], // a dataset with NO points is still a dataset
        ['image data', 57],
      ]);
      expect(pd.getMeasurementColl()).toHaveLength(2);
    }
  );

  it('binds each dataset to its OWN axes, not all of them to the first', () => {
    // Six datasets across six different axes types is the case that catches a
    // deserializer collapsing the object→axes map. Asserted on the re-saved
    // copy specifically: the map is rebuilt from indices on the way out and
    // back, which is where it would go wrong.
    const [, resaved] = bothWays('wpd4.json');
    const bound = resaved.getDatasets().map((ds) => resaved.getAxesForDataset(ds)?.name ?? null);
    expect(bound).toEqual(['xy axes', 'Bar', 'Polar', 'Ternary', 'Map', 'Image']);
  });
});

describe('PlotData — v4.2, with masks and measurements', () => {
  it.each(
    bothWays('wpd4_2_with_masks.json').map((pd, i) => [i === 0 ? 'as read' : 're-saved', pd] as const)
  )('keeps the document (%s)', (_stage, pd) => {
    expect(pd.getAxesCount()).toBe(6);
    expect(shape(pd)).toEqual([
      // ⚑ 143 here against 144 in wpd4.json — the same figure with one point
      // masked out. Asserted as an exact count precisely because the two
      // fixtures differ by one: a deserializer that silently reinstated the
      // masked point would still look plausible.
      ['xy data', 143],
      ['bar data', 3],
      ['polar data', 3],
      ['ternary data', 3],
      ['map data', 0],
      ['image data', 57],
    ]);
    expect(pd.getMeasurementColl()).toHaveLength(3);
  });

  it.each(
    bothWays('wpd4_2_with_masks.json').map((pd, i) => [i === 0 ? 'as read' : 're-saved', pd] as const)
  )('keeps the auto-detection masks, on exactly the two datasets that have them (%s)', (_stage, pd) => {
    // The masks are what make this fixture worth having: they are the only
    // per-dataset side-channel in the format, and the only thing carried through
    // serialize by a separate map rather than alongside the dataset.
    //
    // ⚑ We store the mask RUN-LENGTH ENCODED — an array of [start, length]
    // pairs — where upstream expands it into a Set of pixel indices. So the two
    // codebases hold the same mask in different shapes, and upstream's own test
    // asserts the EXPANDED counts (264662 and 14710) for this very file. Summing
    // our runs and checking against those numbers is therefore a cross-check of
    // the port against upstream ground truth, not merely a self-consistent
    // snapshot: it would catch a decoder that dropped or doubled a run while
    // still producing a plausible-looking array.
    const masks = pd.getDatasets().map((ds) => {
      const detection = pd.getAutoDetectionDataForDataset(ds) as
        | { mask?: [number, number][] }
        | undefined;
      const runs = detection?.mask;
      if (!runs) return null;
      return { runs: runs.length, pixels: runs.reduce((sum, [, len]) => sum + len, 0) };
    });

    expect(masks).toEqual([
      { runs: 403, pixels: 264662 },
      null,
      null,
      null,
      null,
      { runs: 331, pixels: 14710 },
    ]);
  });

  it('keeps all three measurement kinds through a re-save', () => {
    const [loaded, resaved] = bothWays('wpd4_2_with_masks.json');
    const kinds = (pd: PlotData) =>
      pd
        .getMeasurementColl()
        .map((m) => m.constructor.name)
        .sort();
    expect(kinds(loaded)).toEqual(['AngleMeasurement', 'AreaMeasurement', 'DistanceMeasurement']);
    expect(kinds(resaved)).toEqual(kinds(loaded));
    // And each keeps its connection rather than arriving empty.
    for (const m of resaved.getMeasurementColl()) {
      expect((m as { connectionCount(): number }).connectionCount()).toBe(1);
    }
  });
});
