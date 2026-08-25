/**
 * Faithful TypeScript port of wpd-core's core/plotData.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See core/mathFunctions.ts for porting-provenance notes.
 *
 * Two deliberate scope simplifications (see CLAUDE.md "Current scoped
 * task - Step 1"), both isolated to auto-detection state, never to
 * calibration/dataset data itself:
 *
 * 1. Auto-detection data (`wpd.AutoDetectionData`) and grid-detection
 *    data (`wpd.GridDetectionData`) are explicitly out of Step 1's scope
 *    (they live in autoDetection.js/gridDetectionCore.js, not ported).
 *    Stored/returned here as opaque, already-JSON-shaped blobs instead of
 *    reconstructed class instances - round-trips faithfully for a real
 *    project file's raw data, but `getAutoDetectionDataForDataset`
 *    returns `undefined` when absent rather than auto-creating a default
 *    instance (the original's `new wpd.AutoDetectionData()` fallback) -
 *    there is no class to instantiate yet. A future step that ports
 *    autoDetection.js should restore that auto-create behavior.
 * 2. `getAxesForDataset`/`getAxesForMeasurement` etc. use a `Map` keyed
 *    by object identity - unchanged from the original, just noting it
 *    since it means two `Dataset` instances are only "the same" by
 *    reference, matching JS's original semantics exactly.
 *
 * ⚑ v2.0 GROUNDWORK, NOT A PORT: `_categoryAxisColl`/`_datasetCategoryAxisMap`
 * and their accessors below have no upstream counterpart. `CategoryAxis`
 * (core/categoryAxis.ts) is new for the bar model, added here rather than in
 * a new file because the additive-map pattern it needs - a collection plus
 * an identity-keyed binding - is exactly what `_objectAxesMap` already does
 * for value axes, so this mirrors that shape deliberately rather than
 * inventing a second one. Wired into `CalibrationSession`/`projectFile.ts`
 * and serialize()/deserialize() in a later v2.0 phase - additively, into the
 * SAME version [4, 2] shape this file already writes: `categoryAxisColl`/
 * `categoryAxisName` are both omitted-when-unused, so an older reader (or a
 * plain XY/polar/spider project that never uses one) sees a byte-identical
 * file. No version bump ever became necessary for the bar model - the
 * tuple/slot machinery it rides on (`_tuples`, per-pixel metadata) was
 * already fully generic before this release touched it.
 */

import { Calibration } from './calibration.js';
import { isPositionOnKey } from './heatmapGrid.js';
import { Dataset, type PixelMetadata } from './dataset.js';
import { Color } from './color.js';
import { XYAxes } from './axes/xy.js';
import { BarAxes } from './axes/bar.js';
import { PolarAxes } from './axes/polar.js';
import { TernaryAxes } from './axes/ternary.js';
import { MapAxes, type OriginLocation } from './axes/map.js';
import { ImageAxes } from './axes/image.js';
import { CircularChartRecorderAxes, type RotationDirection, type RotationTime } from './axes/circularChartRecorder.js';
import { SpiderAxes } from './axes/spider.js';
import { PieAxes } from './axes/pie.js';
import { DistanceMeasurement, AngleMeasurement, AreaMeasurement } from './connectedPoints.js';
import { CategoryAxis, type TickConvention } from './categoryAxis.js';

export type AnyAxes = XYAxes | BarAxes | PolarAxes | TernaryAxes | MapAxes | ImageAxes | CircularChartRecorderAxes | SpiderAxes | PieAxes;
export type AnyMeasurement = DistanceMeasurement | AngleMeasurement | AreaMeasurement;

interface DocumentMetadataGroup {
  axes?: Record<string, unknown[]>;
  datasets?: Record<string, unknown[]>;
  measurements?: Record<string, unknown[]>;
}
export interface DocumentMetadata {
  file?: DocumentMetadataGroup;
  page?: DocumentMetadataGroup;
  misc?: unknown;
  [key: string]: unknown;
}

/** Permissive shape covering every axes type's serialized fields - mirrors the original's loose per-type object building. */
export interface SerializedAxesData {
  name: string;
  type: string;
  file?: unknown;
  page?: unknown;
  metadata?: Record<string, unknown>;
  calibrationPoints?: Array<{ px: number; py: number; dx: unknown; dy: unknown; dz: unknown }>;
  isLogX?: boolean;
  isLogY?: boolean;
  noRotation?: boolean;
  isLog?: boolean;
  isRotated?: boolean;
  /** Bar's declared baseline (v2.0). ⚑ Without these two the file loses the
   * ONE number the whole bar model exists to produce: a reopened project fell
   * back to BarAxes's defaults (true / 0), so a floating bar recorded as 5
   * came back as 7.5 with nothing to say it had changed. */
  hasBaseline?: boolean;
  baselineValue?: number;
  isDegrees?: boolean;
  isClockwise?: boolean;
  isRange100?: boolean;
  isNormalOrientation?: boolean;
  scaleLength?: number;
  unitString?: string | undefined;
  originLocation?: OriginLocation;
  imageHeight?: number;
  startTime?: string | null;
  rotationTime?: RotationTime;
  rotationDirection?: RotationDirection;
}

export interface SerializedPixel {
  x: number;
  y: number;
  metadata?: PixelMetadata;
  value?: number[];
  tuple?: number;
  group?: number;
}

export interface SerializedDatasetData {
  name: string;
  axesName: string;
  colorRGB: [number, number, number, number];
  metadataKeys: string[];
  file?: unknown;
  page?: unknown;
  groupNames?: string[];
  metadata?: Record<string, unknown>;
  data: SerializedPixel[];
  autoDetectionData?: unknown;
  /** v2.0 groundwork -- see SerializedCategoryAxisData. Absent for every
   * dataset not bound to a CategoryAxis (every project before this, and
   * every non-bar-family dataset after it). */
  categoryAxisName?: string;
}

/** v2.0 groundwork: a CategoryAxis's serialized form -- an ordered name list,
 * nothing else (see core/categoryAxis.ts, which has no pixel transform to
 * serialize). Linked to a dataset by NAME, exactly like axesColl/axesName --
 * plain object references don't survive JSON, so every cross-reference in
 * this format already works this way. Purely ADDITIVE to the existing
 * version [4, x] shape: an older reader drops `categoryAxisColl` and
 * `categoryAxisName` on the floor and reads everything else unchanged, so
 * this needs no version bump of its own. */
export interface SerializedCategoryAxisData {
  name: string;
  categories: string[];
  /** v2.1: the category TICK geometry, and additive again - absent for every
   * axis whose owner never marked one, which is every project written before
   * this and every bar chart the user simply did not need it for. An older
   * reader drops the key and reads the name list exactly as before.
   *
   * ⚑ Ticks are stored as PARAMETERS along the axis (0 at the first edge, 1 at
   * the second), not as pixels. Two consequences worth knowing when reading a
   * file: the numbers are resolution-independent, and a crop or rotation that
   * moved the figure only had to move the two edges. */
  geometry?: SerializedCategoryGeometry;
}

/** See SerializedCategoryAxisData.geometry. */
export interface SerializedCategoryGeometry {
  /** The two placed points that ARE the category axis. */
  edges: [{ x: number; y: number }, { x: number; y: number }];
  convention: TickConvention;
  /** Parameters in (0,1), strictly increasing. Validated on load - see
   * CategoryAxis.restoreTickParams. */
  ticks: number[];
  /** Present only when the user dragged a tick, so a reopened project still
   * knows to warn before regenerating discards their adjustments. */
  adjusted?: boolean;
  /**
   * Whether the user pressed the stage's ENDING - "these ticks are right".
   *
   * ⚑ STORED for the same reason `countDeclared` is: since v2.3 the ticks exist
   * the moment the calibration walk finishes, so "there are ticks" no longer
   * implies anybody has looked at them. Without this a reopened project would
   * ask to have its categories marked again, every time.
   * ⚑ The fallback is `false`, the safe side: a file written before this field
   * existed simply shows the stage as unfinished, which costs one press and
   * claims nothing that did not happen.
   */
  marked?: boolean;
  /**
   * Whether the user actually DECLARED a category count.
   *
   * ⚑ STORED, NEVER INFERRED. This is the flag `categoriesFollowBands()` gates
   * on - declared, and a bar's category is derived from the band it falls in;
   * not declared, and it is read from the index stored at capture. The load
   * door used to guess it back as `getCategoryCount() > 0`, which is a
   * different fact: categories also come into existence one at a time on the
   * UN-ticked path (`reserveEmptyCategorySlot`). So "axis marked, no count
   * typed, some bars captured" - reachable by opening the fold-out and pressing
   * Done - round-tripped into band mode, and EVERY ROW SILENTLY REORDERED. One
   * Ctrl+Z was enough to trigger it. Found by two independent reviewers,
   * v2.1 audit.
   */
  countDeclared?: boolean;
}

export interface SerializedMeasurementData {
  type: 'Distance' | 'Angle' | 'Area';
  name: string;
  axesName?: string;
  file?: unknown;
  page?: unknown;
  data: number[][];
}

/**
 * ⚑⚑ THE HEATMAP'S RECORD - the grid, the axis NAMES, and the cells a person
 * read themselves. A LAYER ON TOP OF THE CALIBRATION, not part of it.
 *
 * David, 2026-08-16, as a rule for every graph type: *"Anything detected on the
 * graph sits on TOP of the calibration… It has to sit on top of it and respect
 * it, but not be a part of it. We should and need to be able to adjust the axis
 * calibrations independently of changing the grid."*
 *
 * ⚠️ ALL THREE USED TO LIVE IN AXES METADATA, and that is what made a
 * re-calibration silently empty them: `runCalibration` ends with
 * `this.axes = result.axes`, a brand-new object. The fix at the time COPIED the
 * metadata across; this is the fix that removes the need for a copy, because the
 * record was never the calibration's to hold.
 *
 * ⚑ Mirrors `SerializedCategoryAxisData` deliberately - that is the precedent
 * for a per-session thing that lives outside the axes and serialises in its own
 * right, and the heatmap should have been built on it.
 *
 * ⚑ THE GRID IS PARAMETERS, not coordinates: 0 at an axis's first calibration
 * point, 1 at its second. Resolution-independent, and a crop or rotation that
 * moved the figure only had to move the calibration points.
 */
export interface SerializedHeatmapLayer {
  /** Divider parameters per axis, and where the axes SAT when they were
   * recorded - used only to say "these have moved since", never to place
   * anything. */
  grid?: {
    x: number[];
    y: number[];
    axisAt?: {
      x: [{ px: number; py: number }, { px: number; py: number }];
      y: [{ px: number; py: number }, { px: number; py: number }];
    };
  };
  /** One name per BAND, per axis. Empty lists are the norm - a value × value
   * heatmap has nothing to name. */
  labels?: { x: string[]; y: string[] };
  /** `"col,row"` → position on the colour key, for cells a person read
   * themselves. A POSITION, not a number, so a recalibrated key moves them. */
  readings?: Record<string, number>;
}

/**
 * A heatmap layer off a file, or null.
 *
 * ⚑ DROPPED WHOLE when malformed, never half-read. A grid with two good
 * dividers and one `"x"` would otherwise place boundaries the user never put
 * anywhere - and on a heatmap a wrong boundary has no visible symptom, because
 * the colour IS the value.
 */
function heatmapLayerFrom(raw: unknown): SerializedHeatmapLayer | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const src = raw as SerializedHeatmapLayer;
  const out: SerializedHeatmapLayer = {};

  const numbers = (v: unknown): number[] | null => {
    if (!Array.isArray(v)) return null;
    const ns = v.map(Number);
    return ns.every((n) => Number.isFinite(n)) ? ns : null;
  };
  if (src.grid) {
    const x = numbers(src.grid.x);
    const y = numbers(src.grid.y);
    // Two dividers bound one band - the smallest grid that is a grid.
    if (x && y && x.length >= 2 && y.length >= 2) {
      out.grid = { x, y, ...(src.grid.axisAt ? { axisAt: src.grid.axisAt } : {}) };
    }
  }
  if (src.labels && Array.isArray(src.labels.x) && Array.isArray(src.labels.y)) {
    out.labels = { x: src.labels.x.map(String), y: src.labels.y.map(String) };
  }
  if (src.readings && typeof src.readings === 'object') {
    const kept: Record<string, number> = {};
    for (const [key, v] of Object.entries(src.readings)) {
      // The model's own key format, and a POSITION ON THE KEY - anything else
      // would land a number on a cell nobody touched, or on a stretch of key
      // that has no ink.
      //
      // ⚑⚑ THE RANGE CHECK WAS MISSING UNTIL 2026-08-17 (v2.2 audit pass 5).
      // Both interactive entrances refuse a position off the strip and say why;
      // this one asked only for a finite number, so a hand-edited or foreign
      // file could carry `5` and have it extrapolated into an ordinary-looking
      // value attributed to ink that does not exist. Finding A5 fixed "one line
      // at two entrances" - and there were three.
      //
      // ⚑ DROPPED, not clamped. The cell then falls back to what its own COLOUR
      // says, which is a real measurement off real ink; clamping would invent a
      // reading at the strip's end that nobody took.
      if (/^\d+,\d+$/.test(key) && isPositionOnKey(Number(v))) kept[key] = Number(v);
    }
    if (Object.keys(kept).length > 0) out.readings = kept;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface SerializedPlotData {
  version: [number, number];
  axesColl: SerializedAxesData[];
  datasetColl: SerializedDatasetData[];
  measurementColl: SerializedMeasurementData[];
  /** v2.0 groundwork, additive -- see SerializedCategoryAxisData. */
  categoryAxisColl?: SerializedCategoryAxisData[];
  /** v2.2, additive -- see SerializedHeatmapLayer. Absent for every type that is
   * not a heatmap, and for a heatmap whose grid has not been read yet. */
  heatmapLayer?: SerializedHeatmapLayer;
  misc?: unknown;
}

interface PreV4Data {
  axesType?: string;
  calibration?: Array<{ px: number; py: number; dx: unknown; dy: unknown; dz: unknown }>;
  axesParameters?: Record<string, unknown>;
  dataSeries?: Array<{ name: string; metadataKeys: string[]; data: Array<{ x: number; y: number; metadata?: unknown[] }> }>;
  distanceMeasurementData?: number[][];
  angleMeasurementData?: number[][];
}

export class PlotData {
  private _topColors: unknown = null;
  private _axesColl: AnyAxes[] = [];
  private _datasetColl: Dataset[] = [];
  private _measurementColl: AnyMeasurement[] = [];
  private _objectAxesMap = new Map<Dataset | AnyMeasurement, AnyAxes | null>();
  private _datasetAutoDetectionDataMap = new Map<Dataset, unknown>();
  private _gridDetectionData: unknown = null;
  private _categoryAxisColl: CategoryAxis[] = [];
  private _datasetCategoryAxisMap = new Map<Dataset, CategoryAxis | null>();
  private _heatmapLayer: SerializedHeatmapLayer | null = null;

  reset(): void {
    this._axesColl = [];
    this._datasetColl = [];
    this._measurementColl = [];
    this._objectAxesMap = new Map();
    this._datasetAutoDetectionDataMap = new Map();
    this._gridDetectionData = null;
    this._categoryAxisColl = [];
    this._datasetCategoryAxisMap = new Map();
    this._heatmapLayer = null;
  }

  /** The heatmap's record. Null for every other type - and for a heatmap that
   * has none yet, which is not the same as an empty one. */
  setHeatmapLayer(layer: SerializedHeatmapLayer | null): void {
    this._heatmapLayer = layer;
  }

  getHeatmapLayer(): SerializedHeatmapLayer | null {
    return this._heatmapLayer;
  }

  setTopColors(topColors: unknown): void {
    this._topColors = topColors;
  }

  getTopColors(): unknown {
    return this._topColors;
  }

  addAxes(ax: AnyAxes): void {
    this._axesColl.push(ax);
  }

  getAxesColl(): AnyAxes[] {
    return this._axesColl;
  }

  getAxesNames(): string[] {
    return this._axesColl.map((ax) => ax.name);
  }

  deleteAxes(ax: AnyAxes): void {
    const axIdx = this._axesColl.indexOf(ax);
    if (axIdx >= 0) {
      this._axesColl.splice(axIdx, 1);
      this._objectAxesMap.forEach((val, key) => {
        if (val === ax) {
          this._objectAxesMap.set(key, null);
        }
      });
    }
  }

  getAxesCount(): number {
    return this._axesColl.length;
  }

  /** v2.0 groundwork - see the file header. Mirrors addAxes/getAxesColl/
   * deleteAxes/setAxesForDataset/getAxesForDataset exactly, for CategoryAxis
   * instead of AnyAxes. */
  addCategoryAxis(ax: CategoryAxis): void {
    this._categoryAxisColl.push(ax);
  }

  getCategoryAxisColl(): CategoryAxis[] {
    return this._categoryAxisColl;
  }

  getCategoryAxisCount(): number {
    return this._categoryAxisColl.length;
  }

  deleteCategoryAxis(ax: CategoryAxis): void {
    const idx = this._categoryAxisColl.indexOf(ax);
    if (idx >= 0) {
      this._categoryAxisColl.splice(idx, 1);
      this._datasetCategoryAxisMap.forEach((val, key) => {
        if (val === ax) {
          this._datasetCategoryAxisMap.set(key, null);
        }
      });
    }
  }

  setCategoryAxisForDataset(ds: Dataset, ax: CategoryAxis | null): void {
    this._datasetCategoryAxisMap.set(ds, ax);
  }

  getCategoryAxisForDataset(ds: Dataset): CategoryAxis | null | undefined {
    return this._datasetCategoryAxisMap.get(ds) as CategoryAxis | null | undefined;
  }

  addDataset(ds: Dataset): void {
    this._datasetColl.push(ds);
  }

  getDatasets(): Dataset[] {
    return this._datasetColl;
  }

  getDatasetNames(): string[] {
    return this._datasetColl.map((ds) => ds.name);
  }

  getDatasetCount(): number {
    return this._datasetColl.length;
  }

  addMeasurement(ms: AnyMeasurement, skipAutoAttach?: boolean): void {
    this._measurementColl.push(ms);
    if (!skipAutoAttach && ms instanceof DistanceMeasurement && this._axesColl.length > 0) {
      for (let aIdx = 0; aIdx < this._axesColl.length; aIdx++) {
        const ax = this._axesColl[aIdx]!;
        if (ax instanceof MapAxes || ax instanceof ImageAxes) {
          this.setAxesForMeasurement(ms, ax);
          break;
        }
      }
    }
  }

  getMeasurementColl(): AnyMeasurement[] {
    return this._measurementColl;
  }

  getMeasurementsByType<T extends AnyMeasurement>(mtype: new () => T): T[] {
    return this._measurementColl.filter((m): m is T => m instanceof mtype);
  }

  deleteMeasurement(ms: AnyMeasurement): void {
    const msIdx = this._measurementColl.indexOf(ms);
    if (msIdx >= 0) {
      this._measurementColl.splice(msIdx, 1);
      this._objectAxesMap.delete(ms);
    }
  }

  setAxesForDataset(ds: Dataset, ax: AnyAxes | null): void {
    this._objectAxesMap.set(ds, ax);
  }

  setAxesForMeasurement(ms: AnyMeasurement, ax: AnyAxes | null): void {
    this._objectAxesMap.set(ms, ax);
  }

  setAutoDetectionDataForDataset(ds: Dataset, autoDetectionData: unknown): void {
    this._datasetAutoDetectionDataMap.set(ds, autoDetectionData);
  }

  getAxesForDataset(ds: Dataset): AnyAxes | null | undefined {
    return this._objectAxesMap.get(ds) as AnyAxes | null | undefined;
  }

  getAxesForMeasurement(ms: AnyMeasurement): AnyAxes | null | undefined {
    return this._objectAxesMap.get(ms) as AnyAxes | null | undefined;
  }

  /** See file header note 1 - returns undefined rather than auto-creating a default instance (class not ported in Step 1). */
  getAutoDetectionDataForDataset(ds: Dataset): unknown {
    return this._datasetAutoDetectionDataMap.get(ds);
  }

  /** See file header note 1 - returns undefined rather than auto-creating a default instance. */
  getGridDetectionData(): unknown {
    return this._gridDetectionData;
  }

  deleteDataset(ds: Dataset): void {
    const dsIdx = this._datasetColl.indexOf(ds);
    if (dsIdx >= 0) {
      this._datasetColl.splice(dsIdx, 1);
      this._objectAxesMap.delete(ds);
      this._datasetAutoDetectionDataMap.delete(ds);
      this._datasetCategoryAxisMap.delete(ds);
    }
  }

  private _deserializePreVersion4(data: PreV4Data): boolean {
    if (data.axesType == null) {
      return true;
    }
    if (data.axesType !== 'ImageAxes' && (data.calibration == null || data.axesParameters == null)) {
      return false;
    }

    let calibration: Calibration | null = null;
    if (data.axesType !== 'ImageAxes') {
      calibration = new Calibration(data.axesType === 'TernaryAxes' ? 3 : 2);
      for (const cp of data.calibration!) {
        calibration.addPoint(cp.px, cp.py, cp.dx as number | string, cp.dy as number | string, cp.dz as number | string);
      }
    }

    const params = data.axesParameters ?? {};
    let axes: AnyAxes | null = null;
    if (data.axesType === 'XYAxes') {
      axes = new XYAxes();
      axes.calibrate(calibration!, Boolean(params.isLogX), Boolean(params.isLogY), false);
    } else if (data.axesType === 'BarAxes') {
      axes = new BarAxes();
      axes.calibrate(calibration!, Boolean(params.isLog), false);
    } else if (data.axesType === 'PolarAxes') {
      axes = new PolarAxes();
      axes.calibrate(calibration!, Boolean(params.isDegrees), Boolean(params.isClockwise), false);
    } else if (data.axesType === 'TernaryAxes') {
      axes = new TernaryAxes();
      axes.calibrate(calibration!, Boolean(params.isRange100), Boolean(params.isNormalOrientation));
    } else if (data.axesType === 'MapAxes') {
      axes = new MapAxes();
      axes.calibrate(calibration!, params.scaleLength as number, params.unitString as string, 'top-left', 0);
    } else if (data.axesType === 'ImageAxes') {
      axes = new ImageAxes();
    }

    if (axes != null) {
      this._axesColl.push(axes);
    }

    if (data.dataSeries != null) {
      for (const dsData of data.dataSeries) {
        const ds = new Dataset();
        ds.name = dsData.name;
        if (dsData.metadataKeys != null && dsData.metadataKeys.length > 0) {
          ds.setMetadataKeys(dsData.metadataKeys.map((k) => k.toLowerCase()));
        }
        for (const pt of dsData.data) {
          // ⚑⚑ THE SAME GUARD THE v4 LOOP BELOW APPLIES, and it was in one door
          // of two (v2.3 re-audit, F42). A pixel with no position is not a
          // pixel: `null` is what NaN becomes through JSON with nobody editing
          // anything, and it behaves as 0 on the other side - so the point lands
          // at the image origin and reads back a confident value for a place
          // nothing was measured. v3 is the LEGACY format, which is exactly the
          // door most likely to be handed a damaged file.
          if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
          if (dsData.metadataKeys.length > 0) {
            const metadataKey = dsData.metadataKeys[0]!.toLowerCase();
            const metadataValue = pt.metadata?.[0];
            ds.addPixel(pt.x, pt.y, { [metadataKey]: metadataValue });
          } else {
            ds.addPixel(pt.x, pt.y);
          }
        }
        this.addDataset(ds);
        this.setAxesForDataset(ds, axes);
      }
    }

    if (data.distanceMeasurementData != null) {
      const dist = new DistanceMeasurement();
      for (const conn of data.distanceMeasurementData) {
        dist.addConnection(conn);
      }
      this.addMeasurement(dist);
      if (axes instanceof MapAxes) {
        this.setAxesForMeasurement(dist, axes);
      }
    }

    if (data.angleMeasurementData != null) {
      const ang = new AngleMeasurement();
      for (const conn of data.angleMeasurementData) {
        ang.addConnection(conn);
      }
      this.addMeasurement(ang);
    }

    return true;
  }

  private _deserializeVersion4(data: SerializedPlotData): DocumentMetadata {
    const documentMetadata: DocumentMetadata = {};

    const collectMetadata = (group: 'file' | 'page', type: 'axes' | 'datasets' | 'measurements', key: string, object: unknown) => {
      const dm = documentMetadata as Record<string, Record<string, Record<string, unknown[]>>>;
      if (!dm[group]) dm[group] = {} as Record<string, Record<string, unknown[]>>;
      if (!dm[group]![type]) dm[group]![type] = {};
      if (!dm[group]![type]![key]) dm[group]![type]![key] = [];
      dm[group]![type]![key]!.push(object);
    };

    if (data.axesColl != null) {
      for (const axData of data.axesColl) {
        let calibration: Calibration | null = null;
        if (axData.type !== 'ImageAxes') {
          // Spider joins Ternary at 3 dimensions, for a different reason: its third
          // slot carries the axis's NAME (a string), not a third coordinate. A
          // 2-dimension Calibration would drop `dz` on the floor and every spoke
          // would reload unnamed -- silently, since the values still read correctly.
          calibration = new Calibration(axData.type === 'TernaryAxes' || axData.type === 'SpiderAxes' ? 3 : 2);
          for (const cp of axData.calibrationPoints ?? []) {
            calibration.addPoint(cp.px, cp.py, cp.dx as number | string, cp.dy as number | string, cp.dz as number | string);
          }
        }

        let axes: AnyAxes | null = null;
        if (axData.type === 'XYAxes') {
          axes = new XYAxes();
          axes.calibrate(calibration!, Boolean(axData.isLogX), Boolean(axData.isLogY), Boolean(axData.noRotation));
        } else if (axData.type === 'BarAxes') {
          axes = new BarAxes();
          axes.calibrate(calibration!, Boolean(axData.isLog), axData.isRotated == null ? false : axData.isRotated);
          // Absent in any file written before v2.0's audit: fall back to the
          // class defaults, which is what those files were read as anyway.
          axes.setBaseline(
            axData.hasBaseline == null ? true : Boolean(axData.hasBaseline),
            typeof axData.baselineValue === 'number' && Number.isFinite(axData.baselineValue)
              ? axData.baselineValue
              : 0
          );
        } else if (axData.type === 'PolarAxes') {
          axes = new PolarAxes();
          axes.calibrate(calibration!, Boolean(axData.isDegrees), Boolean(axData.isClockwise), Boolean(axData.isLog));
        } else if (axData.type === 'TernaryAxes') {
          axes = new TernaryAxes();
          axes.calibrate(calibration!, Boolean(axData.isRange100), Boolean(axData.isNormalOrientation));
        } else if (axData.type === 'MapAxes') {
          axes = new MapAxes();
          const originLocation = axData.originLocation != null ? axData.originLocation : 'top-left';
          const imageHeight = axData.imageHeight != null ? parseInt(String(axData.imageHeight), 10) : 0;
          axes.calibrate(calibration!, axData.scaleLength!, axData.unitString, originLocation, imageHeight);
        } else if (axData.type === 'SpiderAxes') {
          axes = new SpiderAxes();
          // The spoke count is whatever the figure had, and each spoke's own name
          // rides in its calibration point's third slot (dz) -- which is why the
          // Calibration above was built with 3 dimensions for this type. calibrate()
          // reads both straight off the points; nothing needs deriving here.
          axes.calibrate(calibration!, Boolean(axData.isLog));
        } else if (axData.type === 'PieAxes') {
          axes = new PieAxes();
          // ⚑ The outline is variable-length, like a spider's spokes -- three points
          // or more -- and calibrate() fits whatever the file holds, so a project
          // written with six outline points reopens with six rather than being
          // silently reduced to the first three.
          // The total and the sweep are GLOBAL -- properties of the whole figure, not
          // of any point -- so they ride in the axes metadata, which is the only
          // per-axes home the format has for a value with no pixel attached.
          const meta = (axData.metadata ?? {}) as Record<string, unknown>;
          // ⚑ THE TILT MUST TRAVEL. Without it a saved 3D pie reopens as a CIRCLE,
          // and every value in the file changes silently -- the readings still sum to
          // the total, so nothing looks wrong. Read from axData rather than the
          // instance because setMetadata runs further down, after this call.
          axes.calibrate(
            calibration!,
            parseFloat(String(meta['pieTotal'] ?? '100')),
            parseFloat(String(meta['pieSweep'] ?? '360')),
            String(meta['pieTilted'] ?? 'false') === 'true'
          );
        } else if (axData.type === 'ImageAxes') {
          axes = new ImageAxes();
        } else if (axData.type === 'CircularChartRecorderAxes') {
          axes = new CircularChartRecorderAxes();
          axes.calibrate(
            calibration!,
            axData.startTime as string,
            axData.rotationTime == null ? 'week' : axData.rotationTime,
            axData.rotationDirection == null ? 'anticlockwise' : axData.rotationDirection
          );
        }

        if (axes != null) {
          (axes as { name: string }).name = axData.name;
          if (axData.metadata !== undefined) {
            axes.setMetadata(axData.metadata);
          }
          this._axesColl.push(axes);

          if (axData.file !== undefined) collectMetadata('file', 'axes', axData.file as string, axes);
          if (axData.page !== undefined) collectMetadata('page', 'axes', axData.page as string, axes);
        }
      }
    }

    // v2.2 -- see SerializedHeatmapLayer. VALIDATED, not trusted: this is a load
    // entrance, and the same rule the interactive path applies has to apply
    // here. A malformed layer is DROPPED whole rather than half-read, because a
    // half-read grid would place boundaries the user never put anywhere.
    this._heatmapLayer = heatmapLayerFrom(data.heatmapLayer);

    // v2.0 groundwork, additive -- see SerializedCategoryAxisData. Read BEFORE
    // the dataset loop below, which looks these up by name to rebind.
    if (data.categoryAxisColl != null) {
      for (const caData of data.categoryAxisColl) {
        const ca = new CategoryAxis();
        ca.name = caData.name;
        for (const category of caData.categories) ca.addCategory(category);
        // v2.1 tick geometry, read AFTER the names because the tick count is a
        // function of how many categories there are.
        //
        // ⚑ Every step here is the SAME call the interactive path makes, so the
        // load door cannot admit a state the click path refuses: setAxisEdges
        // rejects a degenerate or denormal axis, setConvention rejects an
        // unknown one (leaving the default), and restoreTickParams rejects a
        // tick list that is the wrong length or not strictly inside and
        // increasing. A rejected tick list is REGENERATED rather than refusing
        // the load -- these are an aid, and nothing measured is lost by
        // rebuilding them, where refusing would cost the user their data.
        const geo = caData.geometry;
        if (geo && ca.setAxisEdges(geo.edges?.[0] as never, geo.edges?.[1] as never)) {
          ca.setConvention(geo.convention);
          ca.restoreTickParams(geo.ticks ?? [], geo.adjusted === true);
          // ⚑ READ, not inferred. See SerializedCategoryGeometry.countDeclared.
          //
          // ⚑ AND THE FALLBACK IS `false`, which is the SAFE side. A file
          // written before this field existed has no way to say, and treating
          // an unknown as "declared" is what caused the reordering: a stored
          // index is what the user actually captured against, so honouring it
          // can only be conservative. The bars stay where they were put; the
          // user can declare the count again in one keystroke if they want
          // bands, and that keystroke is visible.
          if (geo.countDeclared === true) ca.markCountDeclared();
          if (geo.marked === true) ca.markCategories();
        }
        this.addCategoryAxis(ca);
      }
    }

    if (data.datasetColl != null) {
      for (const dsData of data.datasetColl) {
        const ds = new Dataset();
        ds.name = dsData.name;
        if (dsData.colorRGB != null) {
          ds.colorRGB = new Color(dsData.colorRGB[0], dsData.colorRGB[1], dsData.colorRGB[2]);
        }
        if (dsData.metadata !== undefined) {
          ds.setMetadata(dsData.metadata);
        }
        if (dsData.groupNames !== undefined) {
          ds.setSlotNames(dsData.groupNames);
        }
        if (dsData.metadataKeys != null) {
          ds.setMetadataKeys(dsData.metadataKeys);
        }

        /**
         * The file's tuple positions, mapped onto dense 0..n-1 in the file's own
         * ascending order (F35).
         *
         * ⚑⚑ A POSITION, NOT A SIZE. The file says which tuple each point sits
         * in and never says how many tuples there are, so the index cannot be
         * range-checked - only its ORDER is meaningful, and the order is all any
         * consumer uses. Renumbering keeps every membership and every ordering,
         * and caps the array at the number of tuples the file actually mentions,
         * which cannot exceed its own point count.
         *
         * ⚑ IDENTITY FOR EVERY FILE WE WRITE, provably: our tuples are dense and
         * ascending, so `0,1,2...` maps to `0,1,2...`. Only a file with a gap -
         * a hand edit, a foreign model translated at the boundary - is renumbered
         * at all, and a gap is not something any reader could have used.
         */
        // ⚑⚑ ONLY A POSITION THAT ACTUALLY RECEIVES A POINT EARNS A SLOT. Capping
        // the array's SIZE is not the same as making it DENSE: a position whose
        // every point is DROPPED - a non-finite coordinate, or a group index
        // outside the declared slots - would otherwise be counted here and never
        // created below, leaving a literal HOLE in `_tuples`. `getAllTuples()`
        // hands that array to everything, and a hole reads as `undefined`:
        // `tupleIndexOfPixel` walks it on every render, so one damaged file
        // turned the whole workspace into a TypeError. (v2.3 audit fleet, A4.)
        //
        // ⚑ The two passes share ONE predicate, so "was this point kept?" cannot
        // be answered differently by the counting pass and the filling pass.
        const slotCount = ds.getSlotNames().length;
        const keeps = (p: { x: unknown; y: unknown; tuple?: unknown; group?: unknown }): boolean =>
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          Number.isInteger(p.tuple) &&
          (p.tuple as number) >= 0 &&
          Number.isInteger(p.group) &&
          (p.group as number) >= 0 &&
          (p.group as number) < slotCount;
        const tupleSlot = new Map<number, number>();
        [...new Set(dsData.data.filter(keeps).map((p) => p.tuple as number))]
          .sort((a, b) => a - b)
          .forEach((t, i) => tupleSlot.set(t, i));

        // ⚑ The dataset's OWN index, which is no longer the file's once a point
        // can be skipped. `addToTupleAt` files a pixel by its index in the
        // DATASET, so using the loop counter after a skip would file every later
        // point into the wrong slot.
        let added = 0;
        for (let pxIdx = 0; pxIdx < dsData.data.length; pxIdx++) {
          const pt = dsData.data[pxIdx]!;
          // ⚑⚑ A PIXEL WITH NO POSITION IS NOT A PIXEL. Both foreign importers
          // already refuse this - `digImport` will not import a NaN coordinate,
          // `starryImport` skips a point whose pixel is not finite - and our own
          // door took whatever the file said.
          //
          // ⚠️ `null` IS NOT AN EXOTIC HAND EDIT: it is what NaN becomes on the
          // way through JSON, with nobody editing anything, and `null` behaves
          // as 0 in the arithmetic on the other side. The point lands at the
          // image origin and reads back a confident value for a place nothing
          // was measured. `"abc"` gives NaN instead - a point `findNearestPixel`
          // can never select or delete, because every comparison against NaN is
          // false.
          //
          // ⚑ DROPPED, not repaired, and that is not the same call as F4/F11/F14.
          // Those kept a reading and discarded an untrue claim ABOUT it; here the
          // coordinate IS the reading, so there is nothing left to keep.
          if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
          let metadata: PixelMetadata = pt.metadata as PixelMetadata;
          if (pt.metadata != null && Array.isArray(pt.metadata)) {
            const arr = pt.metadata as unknown[];
            metadata = arr.reduce<Record<string, unknown>>((obj, val, idx) => {
              obj[dsData.metadataKeys[idx]!] = val;
              return obj;
            }, {});
          }
          // ⚑⚑ A TUPLE INDEX FROM A FILE IS AN ARRAY INDEX, AND IT WAS
          // UNCHECKED (v2.3 re-audit, F35). `addEmptyTupleAt` writes straight
          // into `_tuples[tupleIndex]`, so `"tuple": 1000000` in a 200-byte file
          // gives the dataset a million-entry array that `getAllTuples()` hands
          // to every table, every export and every render - the app stops
          // responding and nothing on screen says why. `"group": 50` on a
          // two-slot type is the same door: it lengthens the tuple past its own
          // slot names, so every consumer that walks `points[i]` against the
          // header reads members that no column exists for.
          //
          // ⚑ THE INDEX IS TRANSLATED, NOT TESTED - see `tupleSlot` above. A
          // bound of "fewer tuples than points" was the first attempt and it is
          // WRONG: it holds for every file we write, and a file with an unfilled
          // tuple in the middle would have had a real bar's membership silently
          // dropped. Positions cannot be range-checked against a count the file
          // does not state; they can be renumbered, which is exact for any file
          // whose tuples are dense (identity) and bounded for any that is not.
          //
          // ⚑ The GROUP is a plain bound, because the dataset DOES state how
          // many slots it has.
          //
          // ⚑ WHERE A CLAIM IS DROPPED, THE READING IS KEPT - the opposite call
          // to the coordinate check above, for the stated reason: there, the
          // coordinate WAS the reading; here it is sound and only the claim
          // about which row it belongs to is not. Same call as F4/F11/F14. A
          // pixel with no tuple is a state this door already produces
          // (`pt.tuple === undefined`).
          // ⚑ The SAME predicate the counting pass used, so a position that was
          // counted is always filled and one that was not is never referenced.
          const tupleIndex = tupleSlot.get(pt.tuple as number);
          if (ds.hasSlots() && tupleIndex !== undefined && keeps(pt)) {
            ds.addEmptyTupleAt(tupleIndex);
            ds.addToTupleAt(tupleIndex, pt.group as number, added);
          }
          ds.addPixel(pt.x, pt.y, metadata);
          added++;
        }
        this._datasetColl.push(ds);

        if (dsData.file !== undefined) collectMetadata('file', 'datasets', dsData.file as string, ds);
        if (dsData.page !== undefined) collectMetadata('page', 'datasets', dsData.page as string, ds);

        const axIdx = this.getAxesNames().indexOf(dsData.axesName);
        if (axIdx >= 0) {
          this.setAxesForDataset(ds, this._axesColl[axIdx]!);
        }

        if (dsData.categoryAxisName != null) {
          const caIdx = this._categoryAxisColl.findIndex((ca) => ca.name === dsData.categoryAxisName);
          if (caIdx >= 0) this.setCategoryAxisForDataset(ds, this._categoryAxisColl[caIdx]!);
        }

        if (dsData.autoDetectionData != null) {
          // See file header note 1 - stored as an opaque blob, not reconstructed.
          this.setAutoDetectionDataForDataset(ds, dsData.autoDetectionData);
        }
      }
    }

    if (data.measurementColl != null) {
      for (const msData of data.measurementColl) {
        let ms: AnyMeasurement | null = null;
        if (msData.type === 'Distance') {
          ms = new DistanceMeasurement();
          this._measurementColl.push(ms);
          const axIdx = this.getAxesNames().indexOf(msData.axesName ?? '');
          if (axIdx >= 0) this.setAxesForMeasurement(ms, this._axesColl[axIdx]!);
        } else if (msData.type === 'Angle') {
          ms = new AngleMeasurement();
          this._measurementColl.push(ms);
        } else if (msData.type === 'Area') {
          ms = new AreaMeasurement();
          this._measurementColl.push(ms);
          const axIdx = this.getAxesNames().indexOf(msData.axesName ?? '');
          if (axIdx >= 0) this.setAxesForMeasurement(ms, this._axesColl[axIdx]!);
        }
        if (ms != null) {
          for (const conn of msData.data) {
            ms.addConnection(conn);
          }
          if (msData.file !== undefined) collectMetadata('file', 'measurements', String(msData.file), ms);
          if (msData.page !== undefined) collectMetadata('page', 'measurements', String(msData.page), ms);
        }
      }
    }

    if (data.misc != null) {
      documentMetadata.misc = data.misc;
    }

    return documentMetadata;
  }

  /** v2.0 Phase 8: an unrecognized major version -- or no format marker at
   * all -- now fails (`false`) rather than the pre-existing fallthrough
   * `return true`, which left the PlotData wholly empty (`reset()` above
   * already cleared it) while telling the caller it had succeeded. A file
   * this build cannot read deserves a visible "can't open this" (every real
   * caller already checks for `false` -- engine/projectFile.ts's
   * deserializeProject, engine/wpdImport.ts), not a silent blank project
   * that reads as "this figure has no data" instead of "this file could not
   * be opened". No version bump of v2.0's OWN format accompanies this: every
   * field the bar model added (categoryAxisColl, categoryAxisName) is
   * additive, so a v[4,2] reader already ignores what it doesn't recognize
   * -- see this file's own header comment on why. */
  deserialize(data: { wpd?: PreV4Data & { version: number[] }; version?: number[] } & Partial<SerializedPlotData>): boolean | DocumentMetadata {
    this.reset();
    try {
      if (data.wpd != null) {
        if (data.wpd.version[0] === 3) return this._deserializePreVersion4(data.wpd);
        return false;
      }
      if (data.version != null) {
        if (data.version[0] === 4) return this._deserializeVersion4(data as SerializedPlotData);
        return false;
      }
      return false;
    } catch (e) {
      console.log(e);
      return false;
    }
  }

  serialize(documentMetadata?: DocumentMetadata): SerializedPlotData {
    const data: SerializedPlotData = {
      version: [4, 2],
      axesColl: [],
      datasetColl: [],
      measurementColl: [],
    };

    for (const axes of this._axesColl) {
      const axData: SerializedAxesData = { name: axes.name, type: '' };

      if (documentMetadata) {
        const fileEntry = documentMetadata.file?.axes?.[axes.name];
        if (fileEntry !== undefined) axData.file = fileEntry;
        const pageEntry = documentMetadata.page?.axes?.[axes.name];
        if (pageEntry !== undefined) axData.page = pageEntry;
      }

      if (axes instanceof XYAxes) {
        axData.type = 'XYAxes';
        axData.isLogX = axes.isLogX();
        axData.isLogY = axes.isLogY();
        axData.noRotation = axes.noRotation();
      } else if (axes instanceof BarAxes) {
        axData.type = 'BarAxes';
        axData.isLog = axes.isLog();
        axData.isRotated = axes.isRotated();
        axData.hasBaseline = axes.hasDeclaredBaseline();
        axData.baselineValue = axes.getBaselineValue();
      } else if (axes instanceof PolarAxes) {
        axData.type = 'PolarAxes';
        axData.isDegrees = axes.isThetaDegrees();
        axData.isClockwise = axes.isThetaClockwise();
        axData.isLog = axes.isRadialLog();
      } else if (axes instanceof TernaryAxes) {
        axData.type = 'TernaryAxes';
        axData.isRange100 = axes.isRange100();
        // Serialize the CALL, not the method reference. Upstream WPD writes the
        // function reference here; JSON.stringify (our persistence path) drops
        // function-valued keys, so on reload isNormalOrientation reads undefined
        // -> Boolean(undefined) -> false, flipping a default Normal ternary to
        // Reverse and permuting every [a,b,c] datum. Deliberate divergence from
        // the port (Tenet 8): reliable data out (Tenet 1) over faithfulness.
        axData.isNormalOrientation = axes.isNormalOrientation();
      } else if (axes instanceof MapAxes) {
        axData.type = 'MapAxes';
        axData.scaleLength = axes.getScaleLength();
        axData.unitString = axes.getUnits();
        axData.originLocation = axes.getOriginLocation();
        axData.imageHeight = axes.getImageHeight();
      } else if (axes instanceof ImageAxes) {
        axData.type = 'ImageAxes';
      } else if (axes instanceof CircularChartRecorderAxes) {
        axData.type = 'CircularChartRecorderAxes';
        axData.startTime = axes.getStartTime();
        axData.rotationTime = axes.getRotationTime();
        axData.rotationDirection = axes.getRotationDirection();
      } else if (axes instanceof PieAxes) {
        axData.type = 'PieAxes';
        // The total and the sweep have no pixel to ride on -- they are global to the
        // figure -- so the axes metadata is their one home, written through the shared
        // metadata block below and read back at `pieTotal`/`pieSweep`/`pieTilted` in
        // _deserializeVersion4.
        //
        // ⚑ WHO PUTS THEM THERE IS NOT IN THIS FILE, and this comment used to imply
        // it was ("`setMetadata` above has already populated" -- there is no such call
        // above, in serialize or in PieAxes.calibrate). It is
        // engine/calibrationSession.ts's PIE_AXES_CONFIG.buildAxes. PieAxes.calibrate
        // keeps the total and sweep as plain FIELDS, which serialize never reads, so a
        // PieAxes built through core/ alone writes no total and reopens at the reader's
        // 100/360 defaults. Pinned deliberately in plotDataAxesRoundTrip.test.ts rather
        // than left as folklore.
      } else if (axes instanceof SpiderAxes) {
        axData.type = 'SpiderAxes';
        // Everything else about a spider lives in the calibration points, one per
        // spoke: dx the known value, dy THAT SPOKE'S centre value, dz the axis name.
        // Nothing spider-specific is written here, and deliberately so -- a
        // per-axes-entry `centreValue` would be a second home for a fact the points
        // already carry, and two homes eventually disagree.
        axData.isLog = axes.isLog();
      }

      if (Object.keys(axes.getMetadata()).length > 0) {
        axData.metadata = axes.getMetadata();
      }

      if (!(axes instanceof ImageAxes)) {
        axData.calibrationPoints = [];
        for (let calIdx = 0; calIdx < axes.calibration!.getCount(); calIdx++) {
          const cp = axes.calibration!.getPoint(calIdx)!;
          axData.calibrationPoints.push({ px: cp.px, py: cp.py, dx: cp.dx, dy: cp.dy, dz: cp.dz });
        }
      }

      data.axesColl.push(axData);
    }

    // v2.2, additive (see SerializedHeatmapLayer) -- written only when a
    // heatmap actually has a record, so every other type's file is unchanged.
    if (this._heatmapLayer !== null) {
      data.heatmapLayer = this._heatmapLayer;
    }

    // v2.0 groundwork, additive (see SerializedCategoryAxisData) -- only
    // written when at least one exists, so a project with none round-trips
    // byte-for-byte identically to before this field existed.
    if (this._categoryAxisColl.length > 0) {
      data.categoryAxisColl = this._categoryAxisColl.map((ca) => {
        const edges = ca.getAxisEdges();
        return {
          name: ca.name,
          categories: [...ca.getCategories()],
          // Omitted entirely when the axis was never marked, so a project that
          // never used ticks round-trips byte-for-byte as it did before v2.1.
          ...(edges
            ? {
                geometry: {
                  edges: [
                    { x: edges[0].x, y: edges[0].y },
                    { x: edges[1].x, y: edges[1].y },
                  ] as SerializedCategoryGeometry['edges'],
                  convention: ca.getConvention(),
                  ticks: [...ca.getTickParams()],
                  ...(ca.hasAdjustments() ? { adjusted: true } : {}),
                  ...(ca.hasDeclaredCount() ? { countDeclared: true } : {}),
                  ...(ca.categoriesMarked() ? { marked: true } : {}),
                },
              }
            : {}),
        };
      });
    }

    for (const ds of this._datasetColl) {
      const axes = this.getAxesForDataset(ds);
      const categoryAxis = this.getCategoryAxisForDataset(ds);
      const autoDetectionData = this.getAutoDetectionDataForDataset(ds);

      const dsData: SerializedDatasetData = {
        name: ds.name,
        axesName: axes != null ? axes.name : '',
        colorRGB: ds.colorRGB.serialize(),
        metadataKeys: ds.getMetadataKeys(),
        data: [],
        ...(categoryAxis != null ? { categoryAxisName: categoryAxis.name } : {}),
      };

      if (documentMetadata) {
        const fileEntry = documentMetadata.file?.datasets?.[ds.name];
        if (fileEntry !== undefined) dsData.file = fileEntry;
        const pageEntry = documentMetadata.page?.datasets?.[ds.name];
        if (pageEntry !== undefined) dsData.page = pageEntry;
      }
      if (ds.hasSlots()) {
        dsData.groupNames = ds.getSlotNames();
      }
      if (Object.keys(ds.getMetadata()).length > 0) {
        dsData.metadata = ds.getMetadata();
      }

      for (let pxIdx = 0; pxIdx < ds.getCount(); pxIdx++) {
        const px = ds.getPixel(pxIdx);
        const serializedPx: SerializedPixel = { x: px.x, y: px.y, metadata: px.metadata };

        if (ds.hasSlots()) {
          const tupleIdx = ds.getTupleIndex(pxIdx);
          const groupIdx = ds.getSlotIndexInTuple(tupleIdx, pxIdx);
          if (tupleIdx > -1 && groupIdx > -1) {
            serializedPx.tuple = tupleIdx;
            serializedPx.group = groupIdx;
          }
        }

        if (axes != null) {
          serializedPx.value = axes.pixelToData(px.x, px.y);
        }
        dsData.data[pxIdx] = serializedPx;
      }

      dsData.autoDetectionData = autoDetectionData ?? null;
      data.datasetColl.push(dsData);
    }

    for (let msIdx = 0; msIdx < this._measurementColl.length; msIdx++) {
      const ms = this._measurementColl[msIdx]!;
      const axes = this.getAxesForMeasurement(ms);
      const msData: SerializedMeasurementData = { type: 'Distance', name: '', data: [] };

      if (ms instanceof DistanceMeasurement) {
        msData.type = 'Distance';
        msData.name = 'Distance';
        msData.axesName = axes != null ? axes.name : '';
      } else if (ms instanceof AngleMeasurement) {
        msData.type = 'Angle';
        msData.name = 'Angle';
      } else if (ms instanceof AreaMeasurement) {
        msData.type = 'Area';
        msData.name = 'Area';
        msData.axesName = axes != null ? axes.name : '';
      }

      if (documentMetadata) {
        const fileEntry = documentMetadata.file?.measurements?.[msIdx];
        if (fileEntry !== undefined) msData.file = fileEntry;
        const pageEntry = documentMetadata.page?.measurements?.[msIdx];
        if (pageEntry !== undefined) msData.page = pageEntry;
      }

      for (let cIdx = 0; cIdx < ms.connectionCount(); cIdx++) {
        msData.data.push(ms.getConnectionAt(cIdx)!);
      }
      data.measurementColl.push(msData);
    }

    if (documentMetadata && documentMetadata.misc) {
      data.misc = documentMetadata.misc;
    }

    return data;
  }
}
