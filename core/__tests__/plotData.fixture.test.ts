import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PlotData } from '../plotData.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Real project JSON exported from the live wpd-core app (via a Playwright
 * driver calling wpd.appData.getPlotData().serialize() directly), not
 * hand-written — this is the "done criteria" #2 fixture from CLAUDE.md's
 * Step 1 scope: XY axes with a metadata override, Bar axes with point
 * groups (Error Bar Groups) and a custom label.
 */
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/real-project.json'), 'utf8'));

describe('PlotData — round-trip against a real exported project', () => {
  it('deserializes the fixture without error', () => {
    const pd = new PlotData();
    const result = pd.deserialize(fixture);
    expect(result).not.toBe(false);
    expect(pd.getAxesNames()).toEqual(['XY Axes', 'Bar Axes']);
    expect(pd.getDatasetNames()).toEqual(['Stress-Strain', 'Samples']);
  });

  it('re-derives the exact same data-space values the live app computed', () => {
    const pd = new PlotData();
    pd.deserialize(fixture);

    const xyDs = pd.getDatasets()[0]!;
    const xyAxes = pd.getAxesForDataset(xyDs)!;
    // Compare every re-derived pixelToData() value against the "value"
    // field the live app itself computed at export time.
    for (let i = 0; i < xyDs.getCount(); i++) {
      const px = xyDs.getPixel(i);
      const expected = fixture.datasetColl[0].data[i].value;
      const actual = xyAxes.pixelToData(px.x, px.y);
      expect(actual[0]).toBeCloseTo(expected[0], 6);
      expect(actual[1]).toBeCloseTo(expected[1], 6);
    }
  });

  it('preserves the metadata override on the XY dataset', () => {
    const pd = new PlotData();
    pd.deserialize(fixture);
    const xyDs = pd.getDatasets()[0]!;
    expect(xyDs.getPixel(0).metadata).toEqual({ overrides: { y: 8.6 } });
  });

  it('preserves the custom label and point-group tuples on the Bar dataset', () => {
    const pd = new PlotData();
    pd.deserialize(fixture);
    const barDs = pd.getDatasets()[1]!;
    expect(barDs.getPointGroups()).toEqual(['Value', 'Upper', 'Lower']);
    expect(barDs.getPixel(0).metadata).toEqual({ label: 'Sample A' });
    expect(barDs.getPointGroupIndexInTuple(0, 0)).toBe(0); // Value
    expect(barDs.getPointGroupIndexInTuple(0, 1)).toBe(1); // Upper
    expect(barDs.getPointGroupIndexInTuple(0, 2)).toBe(2); // Lower
  });

  it('round-trips serialize(deserialize(fixture)) back to an equivalent structure', () => {
    const pd = new PlotData();
    pd.deserialize(fixture);
    const reserialized = pd.serialize();

    expect(reserialized.version).toEqual(fixture.version);
    expect(reserialized.axesColl.map((a) => a.type)).toEqual(fixture.axesColl.map((a: { type: string }) => a.type));
    expect(reserialized.datasetColl.map((d) => d.name)).toEqual(
      fixture.datasetColl.map((d: { name: string }) => d.name)
    );
    expect(reserialized.datasetColl[0]!.data[0]!.value).toEqual(fixture.datasetColl[0].data[0].value);
  });
});
