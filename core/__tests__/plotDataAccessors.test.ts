import { describe, expect, it } from 'vitest';
import { PlotData } from '../plotData.js';
import { Dataset } from '../dataset.js';
import { XYAxes } from '../axes/xy.js';
import { MapAxes } from '../axes/map.js';
import { ImageAxes } from '../axes/image.js';
import { DistanceMeasurement, AngleMeasurement } from '../connectedPoints.js';

/**
 * `PlotData`'s relationship bookkeeping — the accessors nothing had asserted.
 *
 * ⚑ `plotData.ts` scored **45.97%** with **275 surviving mutants and 127 with no
 * coverage** — the largest uncovered block in the project, on the file that holds the
 * record's relationships and its serialiser. `plotDataRelationships.test.ts` covers
 * the binding between datasets and axes; this covers the surface it left: the
 * measurement side, the auto-detection and grid-detection stores, the top-colours
 * pass-through, and what `reset()` actually clears.
 *
 * Why it earns the time: **v2.0 changes the record**, and every one of these is a way
 * for a datum to lose the axes it is read against. That failure never throws — it
 * produces a number computed against the wrong calibration, which is the exact shape
 * of the defects fixed in `reorderPixels` and `insertPixel` this month.
 */

describe('measurements are bound to axes, and unbound when deleted', () => {
  it('remembers which axes a measurement is read against', () => {
    const plot = new PlotData();
    const axes = new XYAxes();
    const ms = new AngleMeasurement();
    plot.addAxes(axes);
    plot.addMeasurement(ms, true);
    plot.setAxesForMeasurement(ms, axes);
    expect(plot.getAxesForMeasurement(ms)).toBe(axes);
  });

  it('accepts null — a measurement deliberately bound to nothing', () => {
    // ⚑ null and undefined are DIFFERENT answers here: null means "explicitly
    // unbound", undefined means "never seen". A mutant collapsing them would make an
    // unbound measurement indistinguishable from an unknown one.
    const plot = new PlotData();
    const ms = new AngleMeasurement();
    plot.addMeasurement(ms, true);
    plot.setAxesForMeasurement(ms, null);
    expect(plot.getAxesForMeasurement(ms)).toBeNull();
    expect(plot.getAxesForMeasurement(new AngleMeasurement())).toBeUndefined();
  });

  it('forgets the binding when the measurement is deleted', () => {
    // Otherwise the map grows a reference to an object no longer in the document —
    // and a later serialise would write a relationship for something that is gone.
    const plot = new PlotData();
    const axes = new XYAxes();
    const ms = new AngleMeasurement();
    plot.addAxes(axes);
    plot.addMeasurement(ms, true);
    plot.setAxesForMeasurement(ms, axes);

    plot.deleteMeasurement(ms);
    expect(plot.getMeasurementColl()).toHaveLength(0);
    expect(plot.getAxesForMeasurement(ms)).toBeUndefined();
  });

  it('ignores a request to delete a measurement it does not hold', () => {
    const plot = new PlotData();
    const kept = new AngleMeasurement();
    plot.addMeasurement(kept, true);
    plot.deleteMeasurement(new AngleMeasurement());
    expect(plot.getMeasurementColl()).toEqual([kept]);
  });
});

describe('a distance measurement auto-attaches to the axes that can scale it', () => {
  // ⚑ The one piece of behaviour in `addMeasurement`, and it was unasserted. A
  // DISTANCE is the only measurement with real-world units, so it attaches itself to
  // a Map or Image axes if one exists — those are the two that can turn pixels into a
  // length. Getting this wrong does not throw; it reports a distance in the wrong
  // units, or in none.
  it('attaches to Map axes when one is present', () => {
    const plot = new PlotData();
    const map = new MapAxes();
    plot.addAxes(map);
    const ms = new DistanceMeasurement();
    plot.addMeasurement(ms);
    expect(plot.getAxesForMeasurement(ms)).toBe(map);
  });

  it('attaches to Image axes too', () => {
    const plot = new PlotData();
    const image = new ImageAxes();
    plot.addAxes(image);
    const ms = new DistanceMeasurement();
    plot.addMeasurement(ms);
    expect(plot.getAxesForMeasurement(ms)).toBe(image);
  });

  it('takes the FIRST suitable axes and stops looking', () => {
    const plot = new PlotData();
    const first = new MapAxes();
    const second = new ImageAxes();
    plot.addAxes(first);
    plot.addAxes(second);
    const ms = new DistanceMeasurement();
    plot.addMeasurement(ms);
    expect(plot.getAxesForMeasurement(ms)).toBe(first);
  });

  it('skips axes that cannot scale a length', () => {
    // An XY axes has units per axis, not a length scale, so a distance must NOT
    // silently bind to it and report a number in mixed units.
    const plot = new PlotData();
    plot.addAxes(new XYAxes());
    const ms = new DistanceMeasurement();
    plot.addMeasurement(ms);
    expect(plot.getAxesForMeasurement(ms)).toBeUndefined();
  });

  it('does NOT auto-attach a non-distance measurement', () => {
    const plot = new PlotData();
    plot.addAxes(new MapAxes());
    const ms = new AngleMeasurement();
    plot.addMeasurement(ms);
    expect(plot.getAxesForMeasurement(ms)).toBeUndefined();
  });

  it('honours skipAutoAttach — the load path binds explicitly', () => {
    // ⚑ Why the flag exists: deserialising a project must restore the binding the
    // FILE recorded, not re-derive one. Auto-attaching during a load would silently
    // overwrite a measurement the user had bound to something else.
    const plot = new PlotData();
    const map = new MapAxes();
    plot.addAxes(map);
    const ms = new DistanceMeasurement();
    plot.addMeasurement(ms, true);
    expect(plot.getAxesForMeasurement(ms)).toBeUndefined();
  });

  it('attaches nothing when there are no axes at all', () => {
    const plot = new PlotData();
    const ms = new DistanceMeasurement();
    plot.addMeasurement(ms);
    expect(plot.getAxesForMeasurement(ms)).toBeUndefined();
  });
});

describe('the per-dataset and per-document detection stores', () => {
  it('keeps auto-detection data per dataset, not shared between them', () => {
    const plot = new PlotData();
    const a = new Dataset(1);
    const b = new Dataset(1);
    plot.addDataset(a);
    plot.addDataset(b);
    plot.setAutoDetectionDataForDataset(a, { colour: 'red' });
    expect(plot.getAutoDetectionDataForDataset(a)).toEqual({ colour: 'red' });
    expect(plot.getAutoDetectionDataForDataset(b)).toBeUndefined();
  });

  it('returns undefined rather than inventing a default', () => {
    // ⚑ A deliberate divergence from upstream, noted in the file header: WPD
    // auto-creates a default instance here. Returning undefined keeps "nothing was
    // detected" distinguishable from "detected, with default settings".
    // ⚑ null, not undefined, and the difference is deliberate: the field is
    // INITIALISED to null ("this document has none"), whereas the per-dataset map
    // returns undefined ("this dataset was never asked about"). Two different
    // absences, and a caller can tell them apart.
    expect(new PlotData().getGridDetectionData()).toBeNull();
    expect(new PlotData().getAutoDetectionDataForDataset(new Dataset(1))).toBeUndefined();
  });

  it('carries the top-colours result through untouched', () => {
    const plot = new PlotData();
    expect(plot.getTopColors()).toBeNull();
    const colours = [{ color: [255, 0, 0], percentage: 12.5 }];
    plot.setTopColors(colours);
    expect(plot.getTopColors()).toBe(colours);
  });
});

describe('reset() clears every collection AND every relationship', () => {
  it('leaves nothing behind that could outlive the document', () => {
    // ⚑ Six fields, and the two Maps are the ones that matter: a surviving
    // dataset→axes entry would let a NEW document's dataset inherit an axes from the
    // one before it. Asserted field by field, because "the lists are empty" would
    // pass with both maps intact.
    const plot = new PlotData();
    const axes = new XYAxes();
    const ds = new Dataset(1);
    const ms = new DistanceMeasurement();
    plot.addAxes(axes);
    plot.addDataset(ds);
    plot.addMeasurement(ms, true);
    plot.setAxesForDataset(ds, axes);
    plot.setAxesForMeasurement(ms, axes);
    plot.setAutoDetectionDataForDataset(ds, { colour: 'red' });

    plot.reset();

    expect(plot.getAxesCount()).toBe(0);
    expect(plot.getDatasetCount()).toBe(0);
    expect(plot.getMeasurementColl()).toHaveLength(0);
    expect(plot.getAxesForDataset(ds)).toBeUndefined();
    expect(plot.getAxesForMeasurement(ms)).toBeUndefined();
    expect(plot.getAutoDetectionDataForDataset(ds)).toBeUndefined();
    expect(plot.getGridDetectionData()).toBeNull();
  });
});

describe('the collections report themselves consistently', () => {
  it('names and counts axes and datasets in insertion order', () => {
    const plot = new PlotData();
    const xy = new XYAxes();
    const map = new MapAxes();
    plot.addAxes(xy);
    plot.addAxes(map);
    const a = new Dataset(1);
    a.name = 'Series A';
    const b = new Dataset(1);
    b.name = 'Series B';
    plot.addDataset(a);
    plot.addDataset(b);

    expect(plot.getAxesCount()).toBe(2);
    expect(plot.getAxesNames()).toEqual([xy.name, map.name]);
    expect(plot.getDatasetCount()).toBe(2);
    expect(plot.getDatasetNames()).toEqual(['Series A', 'Series B']);
    expect(plot.getAxesColl()).toEqual([xy, map]);
    expect(plot.getDatasets()).toEqual([a, b]);
  });

  it('filters measurements by type', () => {
    const plot = new PlotData();
    const distance = new DistanceMeasurement();
    const angle = new AngleMeasurement();
    plot.addMeasurement(distance, true);
    plot.addMeasurement(angle, true);
    expect(plot.getMeasurementsByType(DistanceMeasurement)).toEqual([distance]);
    expect(plot.getMeasurementsByType(AngleMeasurement)).toEqual([angle]);
  });
});
