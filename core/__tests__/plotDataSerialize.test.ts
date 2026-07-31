import { describe, expect, it } from 'vitest';
import { PlotData } from '../plotData.js';
import { Dataset } from '../dataset.js';
import { Calibration } from '../calibration.js';
import { XYAxes } from '../axes/xy.js';
import { ImageAxes } from '../axes/image.js';
import { CategoryAxis } from '../categoryAxis.js';
import { DistanceMeasurement, AngleMeasurement, AreaMeasurement } from '../connectedPoints.js';

/**
 * `PlotData.serialize` — what actually gets WRITTEN into a project file.
 *
 * ⚑ WHY THIS FILE EXISTS. The 2026-07-31 full mutation run scored
 * `core/plotData.ts` at **52.97%** with 372 mutants unnoticed — the largest
 * unchecked surface in `core/`, and the highest-stakes one: this is the file
 * format. Wrong here means silently corrupt saved projects, discovered by a
 * user months later with no way to recover the original.
 *
 * The existing plotData tests are ROUND-TRIP tests (serialize, deserialize,
 * check the model came back) and real-fixture tests. Both are valuable and
 * stay — but a round trip is blind to a whole class of defect by
 * construction: any field that serialize omits AND deserialize defaults, or
 * that both mangle the same way, round-trips perfectly while the FILE is
 * wrong. Anyone else reading our format — the export pipeline, a future
 * migration, a third-party tool — sees the file, not the round trip.
 *
 * So these assert the WRITTEN SHAPE directly. The survivors they rule out
 * cluster in three places nothing had ever looked at:
 *   - the whole documentMetadata file/page path (NO COVERAGE at all),
 *   - the "only write this key when there's something to write" guards,
 *     each of which mutated from `> 0` to `>= 0` and survived,
 *   - the tuple/group indices that make a grouped capture reconstructable.
 */

function calibratedXY(): XYAxes {
  const cal = new Calibration(2);
  cal.addPoint(100, 250, '0', '0');
  cal.addPoint(400, 250, '10', '0');
  cal.addPoint(100, 250, '0', '0');
  cal.addPoint(100, 100, '0', '10');
  const axes = new XYAxes();
  axes.name = 'XY';
  expect(axes.calibrate(cal, false, false, false)).toBe(true);
  return axes;
}

/** A minimal but complete project: one calibrated axes, one dataset with a
 * point bound to it. */
function simpleProject(): { plot: PlotData; axes: XYAxes; ds: Dataset } {
  const plot = new PlotData();
  const axes = calibratedXY();
  const ds = new Dataset(2);
  ds.name = 'Series 1';
  ds.addPixel(250, 175);
  plot.addAxes(axes);
  plot.addDataset(ds);
  plot.setAxesForDataset(ds, axes);
  return { plot, axes, ds };
}

describe('serialize — the file s own envelope', () => {
  it('stamps the format version, which is how every reader routes the file', () => {
    // ⚑ The version array mutated to a garbage literal and survived. It is
    // the FIRST thing deserialize branches on (`data.version[0] === 4`), so a
    // wrong stamp makes every file we write unreadable by our own reader.
    const { plot } = simpleProject();
    expect(plot.serialize().version).toEqual([4, 2]);
  });

  it('writes the three collections even when they are empty', () => {
    const empty = new PlotData().serialize();
    expect(empty.axesColl).toEqual([]);
    expect(empty.datasetColl).toEqual([]);
    expect(empty.measurementColl).toEqual([]);
  });
});

describe('serialize — writing a key only when there is something to write', () => {
  /**
   * ⚑ EVERY ONE OF THESE GUARDS MUTATED `> 0` TO `>= 0` AND SURVIVED, because
   * nothing asserted the ABSENCE of a key. That matters beyond tidiness: the
   * project's own stated contract is that an additive field leaves a file
   * that doesn't use it "round-tripping byte-for-byte identically to before
   * the field existed". An always-written empty key silently breaks that, and
   * with it any byte-comparison a migration might rely on.
   */
  it('omits axes metadata entirely when the axes has none', () => {
    const { plot } = simpleProject();
    const written = plot.serialize().axesColl[0]!;
    expect(written).not.toHaveProperty('metadata');
  });

  it('writes axes metadata when there IS some', () => {
    const { plot, axes } = simpleProject();
    axes.setMetadata({ total: '100' });
    expect(plot.serialize().axesColl[0]!.metadata).toEqual({ total: '100' });
  });

  it('omits dataset metadata when the dataset has none, and writes it when it does', () => {
    const { plot, ds } = simpleProject();
    expect(plot.serialize().datasetColl[0]!).not.toHaveProperty('metadata');
    ds.setMetadata({ geometry: { closed: true } });
    expect(plot.serialize().datasetColl[0]!.metadata).toEqual({ geometry: { closed: true } });
  });

  it('omits the category-axis collection when the project has none', () => {
    // Its own comment promises exactly this ("only written when at least one
    // exists"), so the promise is what gets asserted.
    const { plot } = simpleProject();
    expect(plot.serialize()).not.toHaveProperty('categoryAxisColl');
  });

  it('writes the category-axis collection, with its categories, when one exists', () => {
    const { plot, ds } = simpleProject();
    const ca = new CategoryAxis();
    ca.name = 'Categories';
    ca.addCategory('Flax');
    ca.addCategory('Hemp');
    plot.addCategoryAxis(ca);
    plot.setCategoryAxisForDataset(ds, ca);
    const written = plot.serialize();
    expect(written.categoryAxisColl).toEqual([{ name: 'Categories', categories: ['Flax', 'Hemp'] }]);
    // ...and the dataset names which category axis it belongs to.
    expect(written.datasetColl[0]!.categoryAxisName).toBe('Categories');
  });

  it('omits categoryAxisName on a dataset bound to no category axis', () => {
    const { plot } = simpleProject();
    expect(plot.serialize().datasetColl[0]!).not.toHaveProperty('categoryAxisName');
  });

  it('omits groupNames for an ungrouped dataset, and writes them for a slotted one', () => {
    const { plot, ds } = simpleProject();
    expect(plot.serialize().datasetColl[0]!).not.toHaveProperty('groupNames');
    ds.setSlotNames(['Bar start', 'Bar end']);
    expect(plot.serialize().datasetColl[0]!.groupNames).toEqual(['Bar start', 'Bar end']);
  });

  it('writes calibration points for a real axes, and none for an ImageAxes', () => {
    // ⚑ ImageAxes is the one type with no calibration to write; the guard
    // excluding it mutated to always-true and survived. Always-true would
    // dereference `axes.calibration!` on a type that has none.
    const { plot } = simpleProject();
    expect(plot.serialize().axesColl[0]!.calibrationPoints).toHaveLength(4);

    const imagePlot = new PlotData();
    const img = new ImageAxes();
    imagePlot.addAxes(img);
    const written = imagePlot.serialize().axesColl[0]!;
    expect(written.type).toBe('ImageAxes');
    expect(written).not.toHaveProperty('calibrationPoints');
  });
});

describe('serialize — the per-point record', () => {
  it('writes each pixel with its calibrated VALUE alongside the raw coordinates', () => {
    // The value is what makes a saved file readable without re-deriving the
    // calibration; the `axes != null` guard around it mutated and survived.
    const { plot } = simpleProject();
    const px = plot.serialize().datasetColl[0]!.data[0]!;
    expect(px.x).toBe(250);
    expect(px.y).toBe(175);
    expect(px.value![0]).toBeCloseTo(5, 6);
    expect(px.value![1]).toBeCloseTo(5, 6);
  });

  it('writes NO value for a dataset bound to no axes, rather than inventing one', () => {
    const plot = new PlotData();
    const ds = new Dataset(2);
    ds.name = 'Unbound';
    ds.addPixel(10, 20);
    plot.addDataset(ds);
    const px = plot.serialize().datasetColl[0]!.data[0]!;
    expect(px.x).toBe(10);
    expect(px).not.toHaveProperty('value');
    expect(plot.serialize().datasetColl[0]!.axesName).toBe('');
  });

  it('⚑ writes the TUPLE and GROUP index of every grouped point — how a capture is reconstructed', () => {
    // The `tupleIdx > -1 && groupIdx > -1` guard had FIVE surviving mutants
    // (both comparisons, and the conditional collapsed either way). Without
    // these two numbers a reopened bar/box/pie is a bag of loose points: the
    // pairing that IS the measurement is carried by nothing else in the file.
    const { plot, ds } = simpleProject();
    ds.setSlotNames(['Bar start', 'Bar end']);
    const p0 = ds.addPixel(100, 400);
    const p1 = ds.addPixel(140, 300);
    const t = ds.addTuple(p0);
    expect(t).not.toBeNull();
    ds.addToTupleAt(t!, 1, p1);

    const written = plot.serialize().datasetColl[0]!.data;
    const start = written[p0]!;
    const end = written[p1]!;
    expect(start.tuple).toBe(t!);
    expect(start.group).toBe(0);
    expect(end.tuple).toBe(t!);
    expect(end.group).toBe(1);
    // The two corners of one bar share a tuple and differ by group -- that
    // pairing is the whole point.
    expect(start.tuple).toBe(end.tuple);
    expect(start.group).not.toBe(end.group);
  });

  it('leaves tuple/group off a point that belongs to no tuple', () => {
    // The very first pixel of the fixture was never filed into a tuple.
    const { plot, ds } = simpleProject();
    ds.setSlotNames(['Bar start', 'Bar end']);
    const orphan = plot.serialize().datasetColl[0]!.data[0]!;
    expect(orphan).not.toHaveProperty('tuple');
    expect(orphan).not.toHaveProperty('group');
  });

  it('carries per-pixel metadata (the category index a bar was filed under)', () => {
    const { plot, ds } = simpleProject();
    ds.setMetadataAt(0, { categoryIndex: 3 });
    expect(plot.serialize().datasetColl[0]!.data[0]!.metadata).toEqual({ categoryIndex: 3 });
  });
});

describe('serialize — measurements', () => {
  it('writes each measurement under its own type name, with its connections', () => {
    const plot = new PlotData();
    const axes = calibratedXY();
    plot.addAxes(axes);
    const dist = new DistanceMeasurement();
    dist.addConnection([0, 0, 30, 40]);
    plot.addMeasurement(dist);
    plot.setAxesForMeasurement(dist, axes);

    const written = plot.serialize().measurementColl[0]!;
    expect(written.type).toBe('Distance');
    expect(written.name).toBe('Distance');
    expect(written.axesName).toBe('XY');
    expect(written.data).toEqual([[0, 0, 30, 40]]);
  });

  it('distinguishes Angle and Area from Distance, and every connection is written', () => {
    const plot = new PlotData();
    const ang = new AngleMeasurement();
    ang.addConnection([0, 0, 10, 0, 10, 10]);
    const area = new AreaMeasurement();
    area.addConnection([0, 0, 10, 0, 10, 10, 0, 10]);
    area.addConnection([1, 1, 2, 2, 3, 3]);
    plot.addMeasurement(ang);
    plot.addMeasurement(area);

    const written = plot.serialize().measurementColl;
    expect(written.map((m) => m.type)).toEqual(['Angle', 'Area']);
    // ⚑ The connection loop must write EVERY connection, not just the first:
    // its bound mutated and survived because no fixture had two.
    expect(written[1]!.data).toHaveLength(2);
    expect(written[1]!.data[1]).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

/**
 * ⚑⚑ THE DOCUMENT-METADATA PATH, which had NO COVERAGE AT ALL — every mutant
 * in it (three blocks, six optional-chain steps, six `!== undefined` tests)
 * was unreached by any test.
 *
 * This is what binds each axes/dataset/measurement to the FILE and PAGE it
 * came from — the multi-figure record. If it silently stops being written, a
 * multi-page project reopens with every figure's provenance gone, and nothing
 * in a round-trip notices because the model never held it in the first place:
 * it is passed IN to serialize and read straight back OUT of the file.
 */
describe('serialize — the document metadata that binds a figure to its source', () => {
  function projectWithEverything() {
    const plot = new PlotData();
    const axes = calibratedXY();
    const ds = new Dataset(2);
    ds.name = 'Series 1';
    ds.addPixel(250, 175);
    const dist = new DistanceMeasurement();
    dist.addConnection([0, 0, 3, 4]);
    plot.addAxes(axes);
    plot.addDataset(ds);
    plot.setAxesForDataset(ds, axes);
    plot.addMeasurement(dist);
    return plot;
  }

  const metadata = {
    file: { axes: { XY: ['doc.pdf'] }, datasets: { 'Series 1': ['doc.pdf'] }, measurements: { 0: ['doc.pdf'] } },
    page: { axes: { XY: [2] }, datasets: { 'Series 1': [2] }, measurements: { 0: [2] } },
    misc: { note: 'kept verbatim' },
  };

  it('attaches file and page to the AXES entry', () => {
    const written = projectWithEverything().serialize(metadata).axesColl[0]!;
    expect(written.file).toEqual(['doc.pdf']);
    expect(written.page).toEqual([2]);
  });

  it('attaches file and page to the DATASET entry, keyed by its name', () => {
    const written = projectWithEverything().serialize(metadata).datasetColl[0]!;
    expect(written.file).toEqual(['doc.pdf']);
    expect(written.page).toEqual([2]);
  });

  it('attaches file and page to the MEASUREMENT entry, keyed by its index', () => {
    const written = projectWithEverything().serialize(metadata).measurementColl[0]!;
    expect(written.file).toEqual(['doc.pdf']);
    expect(written.page).toEqual([2]);
  });

  it('carries `misc` through verbatim', () => {
    expect(projectWithEverything().serialize(metadata).misc).toEqual({ note: 'kept verbatim' });
  });

  it('writes NOTHING when no metadata is supplied at all — the ordinary single-figure save', () => {
    const written = projectWithEverything().serialize();
    expect(written.axesColl[0]!).not.toHaveProperty('file');
    expect(written.axesColl[0]!).not.toHaveProperty('page');
    expect(written.datasetColl[0]!).not.toHaveProperty('file');
    expect(written.measurementColl[0]!).not.toHaveProperty('page');
    expect(written).not.toHaveProperty('misc');
  });

  it('⚑ writes nothing for a name the metadata does NOT mention, rather than an undefined key', () => {
    // The `!== undefined` tests are what separate "this figure has no page
    // recorded" from "page: undefined" -- and an explicit undefined key
    // SURVIVES JSON.stringify as a dropped key on write but reads back
    // differently through structured paths. Asserted as absence.
    const written = projectWithEverything().serialize({
      file: { axes: { 'Some Other Axes': ['elsewhere.pdf'] } },
    }).axesColl[0]!;
    expect(written).not.toHaveProperty('file');
    expect(written).not.toHaveProperty('page');
  });

  it('tolerates a metadata object with only one group present', () => {
    // `documentMetadata.file?.axes?.[name]` -- both optional steps mutated and
    // survived. A metadata object carrying only `page` must not throw.
    const onlyPage = projectWithEverything().serialize({ page: { axes: { XY: [7] } } }).axesColl[0]!;
    expect(onlyPage.page).toEqual([7]);
    expect(onlyPage).not.toHaveProperty('file');

    const emptyGroups = projectWithEverything().serialize({ file: {}, page: {} }).axesColl[0]!;
    expect(emptyGroups).not.toHaveProperty('file');
    expect(emptyGroups).not.toHaveProperty('page');
  });
});

describe('deserialize — routing a file by its version stamp', () => {
  it('accepts our own v4 file and refuses a version it does not know', () => {
    const { plot } = simpleProject();
    const written = JSON.parse(JSON.stringify(plot.serialize()));
    expect(new PlotData().deserialize(written)).not.toBe(false);

    expect(new PlotData().deserialize({ ...written, version: [5, 0] })).toBe(false);
    expect(new PlotData().deserialize({ ...written, version: [3, 0] })).toBe(false);
  });

  it('refuses a file with no version stamp at all', () => {
    expect(new PlotData().deserialize({ axesColl: [], datasetColl: [], measurementColl: [] })).toBe(false);
  });

  it('refuses a wpd-wrapped file that is not version 3', () => {
    expect(new PlotData().deserialize({ wpd: { version: [2, 0] } as never })).toBe(false);
  });

  it('RESETS before loading, so a second load cannot inherit the first project s content', () => {
    // deserialize() calls reset() first; without it, opening a second project
    // would silently append to the first -- a data-mixing bug with no visible
    // symptom until export.
    const { plot } = simpleProject();
    const written = JSON.parse(JSON.stringify(plot.serialize()));
    const target = new PlotData();
    expect(target.deserialize(written)).not.toBe(false);
    expect(target.deserialize(written)).not.toBe(false);
    expect(target.getAxesCount()).toBe(1);
    expect(target.getDatasetCount()).toBe(1);
  });
});
