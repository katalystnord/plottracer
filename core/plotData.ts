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
import { DistanceMeasurement, AngleMeasurement, AreaMeasurement } from './connectedPoints.js';

export type AnyAxes = XYAxes | BarAxes | PolarAxes | TernaryAxes | MapAxes | ImageAxes | CircularChartRecorderAxes;
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

  reset(): void {
    this._axesColl = [];
    this._datasetColl = [];
    this._measurementColl = [];
    this._objectAxesMap = new Map();
    this._datasetAutoDetectionDataMap = new Map();
    this._gridDetectionData = null;
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
      calibration!.labels = ['X1', 'X2', 'Y1', 'Y2'];
      calibration!.labelPositions = ['N', 'N', 'E', 'E'];
      calibration!.maxPointCount = 4;
      axes.calibrate(calibration!, Boolean(params.isLogX), Boolean(params.isLogY), false);
    } else if (data.axesType === 'BarAxes') {
      axes = new BarAxes();
      calibration!.labels = ['P1', 'P2'];
      calibration!.labelPositions = ['S', 'S'];
      calibration!.maxPointCount = 2;
      axes.calibrate(calibration!, Boolean(params.isLog), false);
    } else if (data.axesType === 'PolarAxes') {
      axes = new PolarAxes();
      calibration!.labels = ['Origin', 'P1', 'P2'];
      calibration!.labelPositions = ['E', 'S', 'S'];
      calibration!.maxPointCount = 3;
      axes.calibrate(calibration!, Boolean(params.isDegrees), Boolean(params.isClockwise), false);
    } else if (data.axesType === 'TernaryAxes') {
      axes = new TernaryAxes();
      calibration!.labels = ['A', 'B', 'C'];
      calibration!.labelPositions = ['S', 'S', 'E'];
      calibration!.maxPointCount = 3;
      axes.calibrate(calibration!, Boolean(params.isRange100), Boolean(params.isNormalOrientation));
    } else if (data.axesType === 'MapAxes') {
      axes = new MapAxes();
      calibration!.labels = ['P1', 'P2'];
      calibration!.labelPositions = ['S', 'S'];
      calibration!.maxPointCount = 2;
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
          calibration = new Calibration(axData.type === 'TernaryAxes' ? 3 : 2);
          for (const cp of axData.calibrationPoints ?? []) {
            calibration.addPoint(cp.px, cp.py, cp.dx as number | string, cp.dy as number | string, cp.dz as number | string);
          }
        }

        let axes: AnyAxes | null = null;
        if (axData.type === 'XYAxes') {
          axes = new XYAxes();
          calibration!.labels = ['X1', 'X2', 'Y1', 'Y2'];
          calibration!.labelPositions = ['N', 'N', 'E', 'E'];
          calibration!.maxPointCount = 4;
          axes.calibrate(calibration!, Boolean(axData.isLogX), Boolean(axData.isLogY), Boolean(axData.noRotation));
        } else if (axData.type === 'BarAxes') {
          axes = new BarAxes();
          calibration!.labels = ['P1', 'P2'];
          calibration!.labelPositions = ['S', 'S'];
          calibration!.maxPointCount = 2;
          axes.calibrate(calibration!, Boolean(axData.isLog), axData.isRotated == null ? false : axData.isRotated);
        } else if (axData.type === 'PolarAxes') {
          axes = new PolarAxes();
          calibration!.labels = ['Origin', 'P1', 'P2'];
          calibration!.labelPositions = ['E', 'S', 'S'];
          calibration!.maxPointCount = 3;
          axes.calibrate(calibration!, Boolean(axData.isDegrees), Boolean(axData.isClockwise), Boolean(axData.isLog));
        } else if (axData.type === 'TernaryAxes') {
          axes = new TernaryAxes();
          calibration!.labels = ['A', 'B', 'C'];
          calibration!.labelPositions = ['S', 'S', 'E'];
          calibration!.maxPointCount = 3;
          axes.calibrate(calibration!, Boolean(axData.isRange100), Boolean(axData.isNormalOrientation));
        } else if (axData.type === 'MapAxes') {
          axes = new MapAxes();
          calibration!.labels = ['P1', 'P2'];
          calibration!.labelPositions = ['S', 'S'];
          calibration!.maxPointCount = 2;
          const originLocation = axData.originLocation != null ? axData.originLocation : 'top-left';
          const imageHeight = axData.imageHeight != null ? parseInt(String(axData.imageHeight), 10) : 0;
          axes.calibrate(calibration!, axData.scaleLength!, axData.unitString, originLocation, imageHeight);
        } else if (axData.type === 'ImageAxes') {
          axes = new ImageAxes();
        } else if (axData.type === 'CircularChartRecorderAxes') {
          axes = new CircularChartRecorderAxes();
          calibration!.labels = ['(T0,R0)', '(T0,R1)', '(T0,R2)', '(T1,R2)', '(T2,R2)'];
          calibration!.labelPositions = ['S', 'S', 'S', 'S', 'S'];
          calibration!.maxPointCount = 5;
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
          ds.setPointGroups(dsData.groupNames);
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
          if (ds.hasPointGroups() && pt.tuple !== undefined && pt.group !== undefined) {
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

  deserialize(data: { wpd?: PreV4Data & { version: number[] }; version?: number[] } & Partial<SerializedPlotData>): boolean | DocumentMetadata {
    this.reset();
    try {
      if (data.wpd != null && data.wpd.version[0] === 3) {
        return this._deserializePreVersion4(data.wpd);
      }
      if (data.version != null && data.version[0] === 4) {
        return this._deserializeVersion4(data as SerializedPlotData);
      }
      return true;
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
        // NOTE: preserves the original's own bug — `axes.isNormalOrientation`
        // (the function reference) is serialized here, not `axes.isNormalOrientation()`
        // (the call). Faithful port, not a fix — see CLAUDE.md Step 1 notes.
        axData.isNormalOrientation = axes.isNormalOrientation as unknown as boolean;
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

    for (const ds of this._datasetColl) {
      const axes = this.getAxesForDataset(ds);
      const autoDetectionData = this.getAutoDetectionDataForDataset(ds);

      const dsData: SerializedDatasetData = {
        name: ds.name,
        axesName: axes != null ? axes.name : '',
        colorRGB: ds.colorRGB.serialize(),
        metadataKeys: ds.getMetadataKeys(),
        data: [],
      };

      if (documentMetadata) {
        const fileEntry = documentMetadata.file?.datasets?.[ds.name];
        if (fileEntry !== undefined) dsData.file = fileEntry;
        const pageEntry = documentMetadata.page?.datasets?.[ds.name];
        if (pageEntry !== undefined) dsData.page = pageEntry;
      }
      if (ds.hasPointGroups()) {
        dsData.groupNames = ds.getPointGroups();
      }
      if (Object.keys(ds.getMetadata()).length > 0) {
        dsData.metadata = ds.getMetadata();
      }

      for (let pxIdx = 0; pxIdx < ds.getCount(); pxIdx++) {
        const px = ds.getPixel(pxIdx);
        const serializedPx: SerializedPixel = { x: px.x, y: px.y, metadata: px.metadata };

        if (ds.hasPointGroups()) {
          const tupleIdx = ds.getTupleIndex(pxIdx);
          const groupIdx = ds.getPointGroupIndexInTuple(tupleIdx, pxIdx);
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
