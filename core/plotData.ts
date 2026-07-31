/**
 * Faithful TypeScript port of wpd-core's core/plotData.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See core/mathFunctions.ts for porting-provenance notes.
 *
 * Two deliberate scope simplifications (see CLAUDE.md "Current scoped
 * task — Step 1"), both isolated to auto-detection state, never to
 * calibration/dataset data itself:
 *
 * 1. Auto-detection data (`wpd.AutoDetectionData`) and grid-detection
 *    data (`wpd.GridDetectionData`) are explicitly out of Step 1's scope
 *    (they live in autoDetection.js/gridDetectionCore.js, not ported).
 *    Stored/returned here as opaque, already-JSON-shaped blobs instead of
 *    reconstructed class instances — round-trips faithfully for a real
 *    project file's raw data, but `getAutoDetectionDataForDataset`
 *    returns `undefined` when absent rather than auto-creating a default
 *    instance (the original's `new wpd.AutoDetectionData()` fallback) —
 *    there is no class to instantiate yet. A future step that ports
 *    autoDetection.js should restore that auto-create behavior.
 * 2. `getAxesForDataset`/`getAxesForMeasurement` etc. use a `Map` keyed
 *    by object identity — unchanged from the original, just noting it
 *    since it means two `Dataset` instances are only "the same" by
 *    reference, matching JS's original semantics exactly.
 *
 * ⚑ v2.0 GROUNDWORK, NOT A PORT: `_categoryAxisColl`/`_datasetCategoryAxisMap`
 * and their accessors below have no upstream counterpart. `CategoryAxis`
 * (core/categoryAxis.ts) is new for the bar model, added here rather than in
 * a new file because the additive-map pattern it needs — a collection plus
 * an identity-keyed binding — is exactly what `_objectAxesMap` already does
 * for value axes, so this mirrors that shape deliberately rather than
 * inventing a second one. Wired into `CalibrationSession`/`projectFile.ts`
 * and serialize()/deserialize() in a later v2.0 phase — additively, into the
 * SAME version [4, 2] shape this file already writes: `categoryAxisColl`/
 * `categoryAxisName` are both omitted-when-unused, so an older reader (or a
 * plain XY/polar/spider project that never uses one) sees a byte-identical
 * file. No version bump ever became necessary for the bar model — the
 * tuple/slot machinery it rides on (`_tuples`, per-pixel metadata) was
 * already fully generic before this release touched it.
 */

import { Calibration } from './calibration.js';
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
import { CategoryAxis } from './categoryAxis.js';

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

/** Permissive shape covering every axes type's serialized fields — mirrors the original's loose per-type object building. */
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
}

export interface SerializedMeasurementData {
  type: 'Distance' | 'Angle' | 'Area';
  name: string;
  axesName?: string;
  file?: unknown;
  page?: unknown;
  data: number[][];
}

export interface SerializedPlotData {
  version: [number, number];
  axesColl: SerializedAxesData[];
  datasetColl: SerializedDatasetData[];
  measurementColl: SerializedMeasurementData[];
  /** v2.0 groundwork, additive -- see SerializedCategoryAxisData. */
  categoryAxisColl?: SerializedCategoryAxisData[];
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

  reset(): void {
    this._axesColl = [];
    this._datasetColl = [];
    this._measurementColl = [];
    this._objectAxesMap = new Map();
    this._datasetAutoDetectionDataMap = new Map();
    this._gridDetectionData = null;
    this._categoryAxisColl = [];
    this._datasetCategoryAxisMap = new Map();
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

  /** v2.0 groundwork — see the file header. Mirrors addAxes/getAxesColl/
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

  /** See file header note 1 — returns undefined rather than auto-creating a default instance (class not ported in Step 1). */
  getAutoDetectionDataForDataset(ds: Dataset): unknown {
    return this._datasetAutoDetectionDataMap.get(ds);
  }

  /** See file header note 1 — returns undefined rather than auto-creating a default instance. */
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

    // v2.0 groundwork, additive -- see SerializedCategoryAxisData. Read BEFORE
    // the dataset loop below, which looks these up by name to rebind.
    if (data.categoryAxisColl != null) {
      for (const caData of data.categoryAxisColl) {
        const ca = new CategoryAxis();
        ca.name = caData.name;
        for (const category of caData.categories) ca.addCategory(category);
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

        for (let pxIdx = 0; pxIdx < dsData.data.length; pxIdx++) {
          const pt = dsData.data[pxIdx]!;
          let metadata: PixelMetadata = pt.metadata as PixelMetadata;
          if (pt.metadata != null && Array.isArray(pt.metadata)) {
            const arr = pt.metadata as unknown[];
            metadata = arr.reduce<Record<string, unknown>>((obj, val, idx) => {
              obj[dsData.metadataKeys[idx]!] = val;
              return obj;
            }, {});
          }
          if (ds.hasSlots() && pt.tuple !== undefined && pt.group !== undefined) {
            ds.addEmptyTupleAt(pt.tuple);
            ds.addToTupleAt(pt.tuple, pt.group, pxIdx);
          }
          ds.addPixel(pt.x, pt.y, metadata);
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
          // See file header note 1 — stored as an opaque blob, not reconstructed.
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

    // v2.0 groundwork, additive (see SerializedCategoryAxisData) -- only
    // written when at least one exists, so a project with none round-trips
    // byte-for-byte identically to before this field existed.
    if (this._categoryAxisColl.length > 0) {
      data.categoryAxisColl = this._categoryAxisColl.map((ca) => ({ name: ca.name, categories: [...ca.getCategories()] }));
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
