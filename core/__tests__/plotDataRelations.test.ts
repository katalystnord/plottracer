import { describe, expect, it } from 'vitest';
import { PlotData } from '../plotData.js';
import { Dataset } from '../dataset.js';
import { XYAxes } from '../axes/xy.js';
import { Calibration } from '../calibration.js';
import { DistanceMeasurement, AngleMeasurement, AreaMeasurement } from '../connectedPoints.js';
import { CategoryAxis } from '../categoryAxis.js';

/**
 * PlotData's RELATIONSHIPS - the object→axes map, deletion, and measurements.
 *
 * ⚑ WHY THIS FILE EXISTS. `core/plotData.ts` scored 32.44% - the lowest in
 * `core/` - with 277 survivors and 204 mutants no test reaches, and its function
 * coverage is 57%: **thirteen of its twenty-three methods are never called by any
 * test in the suite.** Our existing plotData tests round-trip a document's
 * CONTENT well; what nothing touches is the part that binds the content together
 * - which dataset belongs to which axes, what happens when either is deleted,
 * and whether measurements survive being saved.
 *
 * That matters more than the score suggests. PlotData is the record: a defect
 * here is not a wrong pixel, it is a project file that reopens missing something.
 * And it is where v2.0 lands, since the bar model changes what a datum is and the
 * file format with it.
 *
 * There is nothing to port here. WebPlotDigitizer's `save_tests.js` loads its
 * fixtures and counts what came back; it never deletes anything and never builds
 * a document up from parts. This is new ground.
 */

function xyAxes(name: string): XYAxes {
  const calib = new Calibration(2);
  calib.addPoint(0, 99, '0', '0');
  calib.addPoint(99, 99, '100', '0');
  calib.addPoint(0, 99, '0', '0');
  calib.addPoint(0, 0, '0', '10');
  const axes = new XYAxes();
  axes.calibrate(calib, false, false, false);
  axes.name = name;
  return axes;
}

function dataset(name: string): Dataset {
  const ds = new Dataset(2);
  ds.name = name;
  ds.addPixel(10, 20);
  return ds;
}

describe('PlotData - deleting an axes', () => {
  it('ORPHANS the datasets that used it rather than leaving a dangling reference', () => {
    // The contract, which nothing asserted: the dataset survives, and its axes
    // becomes null. A mutant that skips the map walk leaves the dataset pointing
    // at an axes no longer in the collection - a document that serialises to a
    // reference to nothing.
    const pd = new PlotData();
    const axes = xyAxes('A');
    const ds = dataset('data');
    pd.addAxes(axes);
    pd.addDataset(ds);
    pd.setAxesForDataset(ds, axes);
    expect(pd.getAxesForDataset(ds)).toBe(axes);

    pd.deleteAxes(axes);

    expect(pd.getAxesCount()).toBe(0);
    expect(pd.getDatasetCount()).toBe(1); // the data is NOT deleted with its axes
    expect(pd.getAxesForDataset(ds)).toBeNull();
  });

  it('leaves every OTHER binding intact', () => {
    // The map walk is a forEach with an equality test; a mutant that nulls
    // unconditionally would pass the case above and silently unbind the whole
    // document here.
    const pd = new PlotData();
    const [a, b] = [xyAxes('A'), xyAxes('B')];
    const [dsA, dsB] = [dataset('a'), dataset('b')];
    pd.addAxes(a);
    pd.addAxes(b);
    pd.addDataset(dsA);
    pd.addDataset(dsB);
    pd.setAxesForDataset(dsA, a);
    pd.setAxesForDataset(dsB, b);

    pd.deleteAxes(a);

    expect(pd.getAxesForDataset(dsA)).toBeNull();
    expect(pd.getAxesForDataset(dsB)).toBe(b);
    expect(pd.getAxesCount()).toBe(1);
  });

  it('does nothing when handed an axes it does not hold', () => {
    // The `indexOf >= 0` guard. Without it, splice(-1, 1) removes the LAST
    // axes - deleting something the caller never asked about.
    const pd = new PlotData();
    const kept = xyAxes('kept');
    pd.addAxes(kept);

    pd.deleteAxes(xyAxes('stranger'));

    expect(pd.getAxesCount()).toBe(1);
    expect(pd.getAxesColl()[0]).toBe(kept);
  });
});

describe('PlotData - deleting a dataset', () => {
  it('removes its binding AND its auto-detection data, leaving nothing behind', () => {
    // ⚑ Deliberately asymmetric with deleteAxes, and worth pinning as such:
    // deleting an AXES nulls the map entry (the dataset lives on, orphaned),
    // while deleting a DATASET removes the key outright. Both are defensible;
    // what would be a defect is either one changing silently.
    const pd = new PlotData();
    const axes = xyAxes('A');
    const ds = dataset('data');
    pd.addAxes(axes);
    pd.addDataset(ds);
    pd.setAxesForDataset(ds, axes);
    pd.setAutoDetectionDataForDataset(ds, { mask: new Set([1, 2, 3]) } as never);
    expect(pd.getAutoDetectionDataForDataset(ds)).toBeDefined();

    pd.deleteDataset(ds);

    expect(pd.getDatasetCount()).toBe(0);
    expect(pd.getAxesCount()).toBe(1); // the axes outlives its dataset
    // undefined, not null: this getter is a Map lookup, and the file's own note
    // on getGridDetectionData says undefined is deliberate here rather than
    // auto-creating a default. Contrast getAxesForDataset, which returns null.
    expect(pd.getAutoDetectionDataForDataset(ds)).toBeUndefined();
  });

  it('does nothing when handed a dataset it does not hold', () => {
    const pd = new PlotData();
    const kept = dataset('kept');
    pd.addDataset(kept);

    pd.deleteDataset(dataset('stranger'));

    expect(pd.getDatasetCount()).toBe(1);
    expect(pd.getDatasets()[0]).toBe(kept);
  });

  it('removes the category-axis binding too, alongside the value-axes one', () => {
    const pd = new PlotData();
    const ds = dataset('data');
    const cat = new CategoryAxis();
    pd.addDataset(ds);
    pd.addCategoryAxis(cat);
    pd.setCategoryAxisForDataset(ds, cat);
    expect(pd.getCategoryAxisForDataset(ds)).toBe(cat);

    pd.deleteDataset(ds);

    expect(pd.getCategoryAxisCount()).toBe(1); // the axis itself outlives its dataset
    expect(pd.getCategoryAxisForDataset(ds)).toBeUndefined();
  });
});

describe('PlotData - category axis binding (v2.0 groundwork, unwired)', () => {
  // Mirrors the value-axes describe blocks above exactly -- CategoryAxis is a
  // second, independent binding dimension using the identical additive-map
  // pattern (`_objectAxesMap` for value axes, `_datasetCategoryAxisMap` here).
  it('binds a dataset to a category axis, independent of its value axes binding', () => {
    const pd = new PlotData();
    const axes = xyAxes('A');
    const ds = dataset('data');
    const cat = new CategoryAxis();
    cat.addCategory('Alpha');
    pd.addAxes(axes);
    pd.addDataset(ds);
    pd.addCategoryAxis(cat);
    pd.setAxesForDataset(ds, axes);
    pd.setCategoryAxisForDataset(ds, cat);

    expect(pd.getAxesForDataset(ds)).toBe(axes);
    expect(pd.getCategoryAxisForDataset(ds)).toBe(cat);
    expect(pd.getCategoryAxisColl()).toEqual([cat]);
  });

  it('lets two series share ONE category axis while bound to two different value axes', () => {
    // The exact case the plan calls out: category identity and the value scale
    // are independent binding dimensions, so sharing one does not couple the
    // other.
    const pd = new PlotData();
    const [a, b] = [xyAxes('A'), xyAxes('B')];
    const [dsA, dsB] = [dataset('a'), dataset('b')];
    const sharedCategories = new CategoryAxis();
    pd.addAxes(a);
    pd.addAxes(b);
    pd.addDataset(dsA);
    pd.addDataset(dsB);
    pd.addCategoryAxis(sharedCategories);
    pd.setAxesForDataset(dsA, a);
    pd.setAxesForDataset(dsB, b);
    pd.setCategoryAxisForDataset(dsA, sharedCategories);
    pd.setCategoryAxisForDataset(dsB, sharedCategories);

    expect(pd.getAxesForDataset(dsA)).toBe(a);
    expect(pd.getAxesForDataset(dsB)).toBe(b);
    expect(pd.getCategoryAxisForDataset(dsA)).toBe(sharedCategories);
    expect(pd.getCategoryAxisForDataset(dsB)).toBe(sharedCategories);
  });

  it('ORPHANS bound datasets when their category axis is deleted, mirroring deleteAxes', () => {
    const pd = new PlotData();
    const ds = dataset('data');
    const cat = new CategoryAxis();
    pd.addDataset(ds);
    pd.addCategoryAxis(cat);
    pd.setCategoryAxisForDataset(ds, cat);

    pd.deleteCategoryAxis(cat);

    expect(pd.getCategoryAxisCount()).toBe(0);
    expect(pd.getDatasetCount()).toBe(1); // the dataset is NOT deleted with its category axis
    expect(pd.getCategoryAxisForDataset(ds)).toBeNull();
  });

  it('leaves every OTHER category-axis binding intact when one is deleted', () => {
    const pd = new PlotData();
    const [dsA, dsB] = [dataset('a'), dataset('b')];
    const [catA, catB] = [new CategoryAxis(), new CategoryAxis()];
    pd.addDataset(dsA);
    pd.addDataset(dsB);
    pd.addCategoryAxis(catA);
    pd.addCategoryAxis(catB);
    pd.setCategoryAxisForDataset(dsA, catA);
    pd.setCategoryAxisForDataset(dsB, catB);

    pd.deleteCategoryAxis(catA);

    expect(pd.getCategoryAxisForDataset(dsA)).toBeNull();
    expect(pd.getCategoryAxisForDataset(dsB)).toBe(catB);
    expect(pd.getCategoryAxisCount()).toBe(1);
  });

  it('does nothing when handed a category axis it does not hold', () => {
    const pd = new PlotData();
    const kept = new CategoryAxis();
    pd.addCategoryAxis(kept);

    pd.deleteCategoryAxis(new CategoryAxis());

    expect(pd.getCategoryAxisCount()).toBe(1);
    expect(pd.getCategoryAxisColl()[0]).toBe(kept);
  });

  it('reset() clears the category-axis collection and its bindings', () => {
    const pd = new PlotData();
    const ds = dataset('data');
    const cat = new CategoryAxis();
    pd.addDataset(ds);
    pd.addCategoryAxis(cat);
    pd.setCategoryAxisForDataset(ds, cat);

    pd.reset();

    expect(pd.getCategoryAxisCount()).toBe(0);
    expect(pd.getCategoryAxisForDataset(ds)).toBeUndefined();
  });
});

describe('PlotData - measurements are part of the record', () => {
  // `addMeasurement` was called by NO test in the suite before this file, which
  // means measurements had never been round-tripped through the document at all.
  // They export, so a serialisation defect here loses recorded work in silence -
  // the worst failure mode this project has (tenet 9).
  function withMeasurements(): PlotData {
    const pd = new PlotData();
    const axes = xyAxes('A');
    pd.addAxes(axes);

    const dist = new DistanceMeasurement();
    dist.addConnection([0, 0, 30, 40]); // 3-4-5 triangle: 50px
    const angle = new AngleMeasurement();
    angle.addConnection([10, 0, 0, 0, 0, 10]);
    const area = new AreaMeasurement();
    area.addConnection([0, 0, 10, 0, 10, 10, 0, 10]);

    for (const m of [dist, angle, area]) {
      pd.addMeasurement(m);
      pd.setAxesForMeasurement(m, axes);
    }
    return pd;
  }

  it('holds all three measurement kinds and binds each to its axes', () => {
    const pd = withMeasurements();
    expect(pd.getMeasurementColl()).toHaveLength(3);
    for (const m of pd.getMeasurementColl()) {
      expect(pd.getAxesForMeasurement(m)).not.toBeNull();
    }
  });

  it('carries measurements through serialize and back', () => {
    const pd = withMeasurements();
    const restored = new PlotData();
    const json = JSON.parse(JSON.stringify(pd.serialize()));
    // ⚑ `deserialize` returns `boolean | DocumentMetadata`: false means failure,
    // but success is either `true` OR a metadata object, depending on the
    // document version taken. Assert what the contract actually promises.
    expect(restored.deserialize(json)).not.toBe(false);

    expect(restored.getMeasurementColl()).toHaveLength(3);
    // The distance survives as a MEASUREMENT, not just as a count: 30-40-50.
    const dist = restored
      .getMeasurementColl()
      .find((m) => m instanceof DistanceMeasurement) as DistanceMeasurement | undefined;
    expect(dist).toBeDefined();
    expect(dist!.connectionCount()).toBe(1);
    expect(dist!.getDistance(0)).toBeCloseTo(50, 9);
  });

  it('deleting a measurement removes it and leaves the others', () => {
    const pd = withMeasurements();
    const victim = pd.getMeasurementColl()[1]!;

    pd.deleteMeasurement(victim);

    expect(pd.getMeasurementColl()).toHaveLength(2);
    expect(pd.getMeasurementColl()).not.toContain(victim);
  });
});

describe('PlotData - reset', () => {
  it('empties every collection, not just the ones it is easy to remember', () => {
    // reset() clears axes, datasets and measurements. A mutant that forgets one
    // leaves a stale object in a document the user believes is new.
    const pd = new PlotData();
    pd.addAxes(xyAxes('A'));
    pd.addDataset(dataset('d'));
    pd.addMeasurement(new DistanceMeasurement());

    pd.reset();

    expect(pd.getAxesCount()).toBe(0);
    expect(pd.getDatasetCount()).toBe(0);
    expect(pd.getMeasurementColl()).toHaveLength(0);
  });
});

describe('PlotData - category axis serialization (v2.0 groundwork)', () => {
  it('carries a category axis and its binding through serialize and back', () => {
    const pd = new PlotData();
    const dsA = dataset('a');
    const dsB = dataset('b');
    const cat = new CategoryAxis();
    cat.name = 'Categories 1';
    cat.addCategory('Flax');
    cat.addCategory('Hemp');
    pd.addDataset(dsA);
    pd.addDataset(dsB);
    pd.addCategoryAxis(cat);
    pd.setCategoryAxisForDataset(dsA, cat);
    pd.setCategoryAxisForDataset(dsB, cat);

    const restored = new PlotData();
    const json = JSON.parse(JSON.stringify(pd.serialize()));
    expect(restored.deserialize(json)).not.toBe(false);

    expect(restored.getCategoryAxisCount()).toBe(1);
    const restoredCategories = restored.getCategoryAxisColl()[0]!.getCategories();
    expect(restoredCategories).toEqual(['Flax', 'Hemp']);

    // Both datasets are bound to the SAME restored instance -- a rename after
    // reload must still propagate to both, exactly as it did before saving.
    const [restoredA, restoredB] = restored.getDatasets();
    const caForA = restored.getCategoryAxisForDataset(restoredA!);
    const caForB = restored.getCategoryAxisForDataset(restoredB!);
    expect(caForA).toBe(caForB);
    caForA!.renameCategory(0, 'Flax (renamed)');
    expect(restored.getCategoryAxisForDataset(restoredB!)!.getCategories()[0]).toBe('Flax (renamed)');
  });

  it('adds no categoryAxisColl key at all when nothing uses one -- old files stay byte-identical', () => {
    const pd = new PlotData();
    pd.addDataset(dataset('d'));
    const serialized = pd.serialize();
    expect(serialized.categoryAxisColl).toBeUndefined();
    expect(serialized.datasetColl[0]!.categoryAxisName).toBeUndefined();
  });
});
