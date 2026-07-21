/**
 * Faithful TypeScript port of wpd-core's core/dataset.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See core/mathFunctions.ts for porting-provenance notes.
 */

import { Color } from './color.js';

export type PixelMetadata = Record<string, unknown> | null | undefined;

export interface PixelPoint {
  x: number;
  y: number;
  metadata: PixelMetadata;
}

export interface Point2D {
  x: number;
  y: number;
}

type RectDirection = 'ne' | 'se' | 'sw' | 'nw';

export class Dataset {
  private _dim: number | undefined;
  private _dataPoints: PixelPoint[] = [];
  private _connections: unknown[] = [];
  private _selections: number[] = [];
  private _pixelMetadataCount = 0;
  private _pixelMetadataKeys: string[] = [];
  private _metadata: Record<string, unknown> = {};
  private _groupNames: string[] = [];
  /** Array of arrays; each inner array contains pixel indexes, indexed by group index. */
  private _tuples: (number | null)[][] = [];

  name = 'Default Dataset';
  variableNames = ['x', 'y'];
  colorRGB = new Color(200, 0, 0);

  constructor(dim?: number) {
    this._dim = dim;
  }

  hasMetadata(): boolean {
    return this._pixelMetadataCount > 0;
  }

  setMetadataKeys(metakeys: string[]): void {
    this._pixelMetadataKeys = metakeys;
  }

  getMetadataKeys(): string[] {
    return this._pixelMetadataKeys;
  }

  addPixel(pxi: number, pyi: number, mdata?: PixelMetadata): number {
    const dlen = this._dataPoints.length;
    this._dataPoints[dlen] = { x: pxi, y: pyi, metadata: mdata };
    if (mdata != null) {
      this._pixelMetadataCount++;
    }
    return dlen;
  }

  getPixel(index: number): PixelPoint {
    return this._dataPoints[index]!;
  }

  getAllPixels(): PixelPoint[] {
    return this._dataPoints;
  }

  setPixelAt(index: number, pxi: number, pyi: number): void {
    if (index < this._dataPoints.length) {
      this._dataPoints[index]!.x = pxi;
      this._dataPoints[index]!.y = pyi;
    }
  }

  setMetadataAt(index: number, mdata: PixelMetadata): void {
    if (index < this._dataPoints.length) {
      if (mdata != null) {
        if (this._dataPoints[index]!.metadata == null) {
          this._pixelMetadataCount++;
        }
      } else {
        if (this._dataPoints[index]!.metadata != null) {
          this._pixelMetadataCount--;
        }
      }
      this._dataPoints[index]!.metadata = mdata;
    }
  }

  insertPixel(index: number, pxi: number, pyi: number, mdata?: PixelMetadata): void {
    this._dataPoints.splice(index, 0, { x: pxi, y: pyi, metadata: mdata });
    if (mdata != null) {
      this._pixelMetadataCount++;
    }
  }

  removePixelAtIndex(index: number): void {
    if (index < this._dataPoints.length) {
      if (this._dataPoints[index]!.metadata != null) {
        this._pixelMetadataCount--;
      }
      this._dataPoints.splice(index, 1);
    }
  }

  removeLastPixel(): number {
    const pIndex = this._dataPoints.length - 1;
    this.removePixelAtIndex(pIndex);
    return pIndex;
  }

  findNearestPixel(x: number, y: number, threshold?: number | string): number {
    const thresh = threshold == null ? 50 : parseFloat(String(threshold));
    let minDist = 0;
    let minIndex = -1;
    for (let i = 0; i < this._dataPoints.length; i++) {
      const dp = this._dataPoints[i]!;
      const dist = Math.sqrt((x - dp.x) * (x - dp.x) + (y - dp.y) * (y - dp.y));
      if ((minIndex < 0 && dist <= thresh) || (minIndex >= 0 && dist < minDist)) {
        minIndex = i;
        minDist = dist;
      }
    }
    return minIndex;
  }

  removeNearestPixel(x: number, y: number, threshold?: number): number {
    const minIndex = this.findNearestPixel(x, y, threshold);
    if (minIndex >= 0) {
      this.removePixelAtIndex(minIndex);
    }
    return minIndex;
  }

  clearAll(): void {
    this._dataPoints = [];
    this._pixelMetadataCount = 0;
    this._pixelMetadataKeys = [];
    this._metadata = {};
    this._groupNames = [];
    this._tuples = [];
  }

  /** Replace the pixel list with a reordered copy (checkpoint 130's nearest-
   *  neighbour sort). Series-level metadata, metadata keys and group names are
   *  untouched -- only the point SEQUENCE changes. The caller guarantees
   *  `reordered` is a permutation of the current pixels. */
  setAllPixels(reordered: PixelPoint[]): void {
    this._dataPoints = reordered.map((p) => ({ x: p.x, y: p.y, metadata: p.metadata }));
    this._pixelMetadataCount = this._dataPoints.reduce((n, p) => (p.metadata != null ? n + 1 : n), 0);
  }

  getCount(): number {
    return this._dataPoints.length;
  }

  selectPixel(index: number): void {
    if (this._selections.indexOf(index) >= 0) {
      return;
    }
    this._selections.push(index);
  }

  selectPixels(indexes: number[]): void {
    for (let i = 0; i < indexes.length; i++) {
      this.selectPixel(indexes[i]!);
    }
  }

  unselectAll(): void {
    this._selections = [];
  }

  selectPixelsInRectangle(p1: Point2D, p2: Point2D): void {
    const tester: Record<RectDirection, (x: number, y: number) => boolean> = {
      ne: (x, y) => x >= p1.x && x <= p2.x && y >= p1.y && y <= p2.y,
      se: (x, y) => x >= p1.x && x <= p2.x && y <= p1.y && y >= p2.y,
      sw: (x, y) => x <= p1.x && x >= p2.x && y <= p1.y && y >= p2.y,
      nw: (x, y) => x <= p1.x && x >= p2.x && y >= p1.y && y <= p2.y,
    };

    const xDirection = p1.x - p2.x > 0 ? -1 : 1;
    const yDirection = p1.y - p2.y > 0 ? 1 : -1;

    let direction: RectDirection;
    if (yDirection > 0) {
      direction = xDirection > 0 ? 'se' : 'sw';
    } else {
      direction = xDirection > 0 ? 'ne' : 'nw';
    }

    for (let index = 0; index < this._dataPoints.length; index++) {
      const dp = this._dataPoints[index]!;
      if (tester[direction](dp.x, dp.y)) {
        this.selectPixel(index);
      }
    }
  }

  selectNearestPixel(x: number, y: number, threshold?: number): number {
    const minIndex = this.findNearestPixel(x, y, threshold);
    if (minIndex >= 0) {
      this.selectPixel(minIndex);
    }
    return minIndex;
  }

  selectNextPixel(): void {
    for (let i = 0; i < this._selections.length; i++) {
      this._selections[i] = (this._selections[i]! + 1) % this._dataPoints.length;
    }
  }

  selectPreviousPixel(): void {
    for (let i = 0; i < this._selections.length; i++) {
      let newIndex = this._selections[i]!;
      if (newIndex === 0) {
        newIndex = this._dataPoints.length - 1;
      } else {
        newIndex = newIndex - 1;
      }
      this._selections[i] = newIndex;
    }
  }

  getSelectedPixels(): number[] {
    return this._selections;
  }

  getPointGroups(): string[] {
    return this._groupNames;
  }

  setPointGroups(pointGroups: string[]): void {
    this._groupNames = pointGroups;
  }

  hasPointGroups(): boolean {
    return this._groupNames.length > 0;
  }

  getPointGroupsCount(): number {
    return this._groupNames.length;
  }

  getPointGroupIndexInTuple(tupleIndex: number, pixelIndex: number): number {
    const tuple = this._tuples[tupleIndex];
    if (tuple) {
      return tuple.indexOf(pixelIndex);
    }
    return -1;
  }

  getPixelIndexesInGroup(groupIndex: number): (number | null)[] {
    if (groupIndex < this._groupNames.length) {
      return this._tuples.map((tuple) => tuple[groupIndex] ?? null);
    }
    return [];
  }

  removePointGroupFromTuples(groupIndex: number): void {
    if (groupIndex < this._groupNames.length) {
      this._tuples.forEach((tuple) => {
        tuple.splice(groupIndex, 1);
      });
    }
  }

  addTuple(pixelIndex: number): number | null {
    if (!this._tuples.some((tuple) => tuple[0] === pixelIndex)) {
      const tuple: (number | null)[] = new Array(this._groupNames.length).fill(null);
      tuple[0] = pixelIndex;
      this._tuples.push(tuple);
      return this._tuples.length - 1;
    }
    return null;
  }

  addEmptyTupleAt(tupleIndex: number): void {
    if (!this._tuples[tupleIndex]) {
      this._tuples[tupleIndex] = new Array(this._groupNames.length).fill(null);
    }
  }

  addToTupleAt(tupleIndex: number, groupIndex: number, pixelIndex: number): void {
    if (!this._tuples[tupleIndex]!.includes(pixelIndex)) {
      this._tuples[tupleIndex]![groupIndex] = pixelIndex;
    }
  }

  removeTuple(tupleIndex: number): void {
    if (tupleIndex < this._tuples.length) {
      this._tuples.splice(tupleIndex, 1);
    }
  }

  removeFromTupleAt(tupleIndex: number, pixelIndex: number): void {
    const groupIndex = this._tuples[tupleIndex]!.indexOf(pixelIndex);
    if (groupIndex > -1) {
      this._tuples[tupleIndex]![groupIndex] = null;
    }
  }

  getTupleIndex(pixelIndex: number): number {
    return this._tuples.findIndex((tuple) => tuple.includes(pixelIndex));
  }

  getTuple(tupleIndex: number): (number | null)[] {
    return this._tuples[tupleIndex]!;
  }

  getTupleCount(): number {
    return this._tuples.length;
  }

  getAllTuples(): (number | null)[][] {
    return this._tuples;
  }

  isTupleEmpty(tupleIndex: number): boolean {
    return this._tuples[tupleIndex]!.every((groupIndex) => groupIndex === null);
  }

  refreshTuplesAfterGroupAdd(count: number): void {
    this._tuples.forEach((tuple) => tuple.push(...new Array(count).fill(null)));
  }

  refreshTuplesAfterPixelRemoval(removedPixelIndex: number): void {
    for (let tupleIndex = 0; tupleIndex < this._tuples.length; tupleIndex++) {
      const tuple = this._tuples[tupleIndex]!;
      for (let groupIndex = 0; groupIndex < tuple.length; groupIndex++) {
        const v = tuple[groupIndex];
        if (v !== null) {
          if (v === removedPixelIndex) {
            tuple[groupIndex] = null;
          } else if (v! > removedPixelIndex) {
            tuple[groupIndex] = v! - 1;
          }
        }
      }
    }
  }

  getMetadata(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(this._metadata));
  }

  setMetadata(obj: Record<string, unknown>): void {
    this._metadata = JSON.parse(JSON.stringify(obj));
  }
}
