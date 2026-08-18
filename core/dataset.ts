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


export class Dataset {
  private _dim: number | undefined;
  private _dataPoints: PixelPoint[] = [];
  private _connections: unknown[] = [];
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
    // ⚑ BOTH bounds -- the SAME defect removePixelAtIndex documents below, left
    // in its two siblings when that one was fixed (2026-07-31 sweep). The upper
    // test alone lets a NEGATIVE index through (`-1 < length` is true) and the
    // next line dereferences `_dataPoints[-1]`, throwing a TypeError instead of
    // doing nothing. A found bug is a search query, not a ticket closed.
    if (index >= 0 && index < this._dataPoints.length) {
      this._dataPoints[index]!.x = pxi;
      this._dataPoints[index]!.y = pyi;
    }
  }

  setMetadataAt(index: number, mdata: PixelMetadata): void {
    // Both bounds, for the same reason as setPixelAt above.
    if (index >= 0 && index < this._dataPoints.length) {
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

  /**
   * Splice a pixel in at `index`, shifting the rest along.
   *
   * ⚑ Shifts the tuples with them. Every index at or past the insertion point
   * moves by one, and a tuple holding the OLD number would point at its
   * neighbour -- the same silent re-pointing `reorderPixels` documents, reached
   * by the other direction. The model had `refreshTuplesAfterPixelRemoval` and no
   * counterpart for insertion, which is exactly why the insert-in-place path had
   * to be fenced off from slotted series in the SESSION (`addDataPoint` appends
   * instead when `hasSlots()`). Done here rather than left to the caller because,
   * unlike removal -- where the caller must also decide whether a now-empty tuple
   * should go -- the shift is mechanical and always right.
   */
  insertPixel(index: number, pxi: number, pyi: number, mdata?: PixelMetadata): void {
    this._dataPoints.splice(index, 0, { x: pxi, y: pyi, metadata: mdata });
    if (mdata != null) {
      this._pixelMetadataCount++;
    }
    for (const tuple of this._tuples) {
      for (let groupIndex = 0; groupIndex < tuple.length; groupIndex++) {
        const pixelIndex = tuple[groupIndex];
        if (pixelIndex != null && pixelIndex >= index) {
          tuple[groupIndex] = pixelIndex + 1;
        }
      }
    }
  }

  removePixelAtIndex(index: number): void {
    // ⚑ BOTH bounds. The upper test alone let a NEGATIVE index through (-1 < 0
    // is true), and the next line dereferences `_dataPoints[-1]` - so
    // `removeLastPixel()` on an empty dataset threw a TypeError rather than
    // doing nothing. No caller can reach it today because
    // `CalibrationSession.removeLastPoint` checks the count first, but that is
    // the guard living in the session rather than in the model, and the model
    // has more than one entrance. Fixed where it belongs.
    if (index >= 0 && index < this._dataPoints.length) {
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

  /**
   * Reorder the pixels, `order` being the new sequence written as OLD indexes
   * (checkpoint 130's nearest-neighbour sort). Series-level metadata, metadata
   * keys and group names are untouched -- only the point SEQUENCE changes, and
   * each pixel travels whole, carrying its own per-pixel metadata.
   *
   * ⚑ TUPLES HOLD PIXEL INDEXES, so they are remapped through the same
   * permutation. The previous shape of this method took the reordered pixels and
   * left `_tuples` alone, which silently re-pointed every pairing: a slotted
   * series whose tuple 0 meant (10,20) meant (40,30) after a reverse, with no
   * error and nothing on screen to see. On a Box Plot, an error bar or a spider
   * the PAIR *is* the datum, so that is not a reordering, it is a different
   * record. The session refuses to sort a slotted series
   * (`canSortByNearestNeighbour`) and no caller can reach it today -- which is
   * exactly the problem, since that guard lives in the session and the model has
   * more than one entrance. Same finding, and the same fix, as
   * `removePixelAtIndex`'s missing lower bound; v2.0's interval record makes
   * tuple-shaped data the norm rather than the exception.
   *
   * Takes the ORDER rather than the pixels so the permutation is a fact this
   * method can check instead of a promise the caller makes in a comment.
   * Returns false, changing nothing, for anything that is not a permutation of
   * 0..count-1.
   */
  reorderPixels(order: readonly number[]): boolean {
    const n = this._dataPoints.length;
    if (order.length !== n) return false;
    const oldToNew = new Array<number>(n).fill(-1);
    for (let newIndex = 0; newIndex < n; newIndex++) {
      const oldIndex = order[newIndex]!;
      if (!Number.isInteger(oldIndex) || oldIndex < 0 || oldIndex >= n || oldToNew[oldIndex] !== -1) {
        return false; // out of range, or the same pixel twice -- not a permutation
      }
      oldToNew[oldIndex] = newIndex;
    }
    this._dataPoints = order.map((oldIndex) => this._dataPoints[oldIndex]!);
    this._tuples = this._tuples.map((tuple) =>
      tuple.map((pixelIndex) => {
        if (pixelIndex == null) return null;
        const moved = oldToNew[pixelIndex];
        // A tuple slot pointing outside the pixel list was already dangling; it
        // does not survive the move as a number that now means something else.
        return moved === undefined || moved < 0 ? null : moved;
      })
    );
    return true;
  }

  getCount(): number {
    return this._dataPoints.length;
  }

  getSlotNames(): string[] {
    return this._groupNames;
  }

  setSlotNames(pointGroups: string[]): void {
    this._groupNames = pointGroups;
  }

  /**
   * Turn slots ON for a series that may already hold points, wrapping each
   * existing pixel into a tuple of its own so nothing is stranded.
   *
   * ⚑⚑ THIS IS THE LabPlot FAILURE MODE, AND IT IS WHY THE METHOD EXISTS.
   * David, 2026-08-17: *"points needed to be Errorplots from the beginning, and
   * if they were not, you lost whatever points you had placed. We want
   * flexibility - you should be able to place points, and then ADD error bars to
   * them."*
   *
   * ⚠️ `setSlotNames` ALONE DOES EXACTLY WHAT HE DESCRIBES. Measured: seven plain
   * points, then slot names set, gives `count = 7`, `hasSlots = true`,
   * `tuples = 0`. The pixels are still in storage, so from the inside nothing
   * looks wrong - but `hasSlots` is what selects the TUPLE table (zero rows) and
   * what makes `getExportShape()` return `'tuples'` (an empty CSV). Seven
   * measured points, present in memory and absent from both the screen and the
   * file, with nothing reporting it. Worse than losing them, because it is
   * silent.
   *
   * ⚑ ADOPTING IS NOT MEASURING. Every extent slot is left null: turning on the
   * capability must not invent a cap, because a zero-height error bar is a claim
   * about the figure and an absent one is not (tenet 9).
   *
   * ⚑ A SERIES THAT IS ALREADY SLOTTED IS LEFT ALONE. Its tuples encode a real
   * pairing whose nulls mean "not captured yet" - rebuilding one-tuple-per-pixel
   * would tear a two-corner bar into two half bars. That also makes this
   * idempotent, which it must be: the UI cannot be trusted to ask exactly once
   * across a second cap, a reload, or an undo round trip.
   *
   * ⚑ It lives HERE rather than in the session because guards belong in the
   * model, and the model has more than one entrance.
   */
  adoptSlots(pointGroups: string[]): void {
    const alreadySlotted = this._tuples.length > 0;
    this._groupNames = pointGroups;
    if (alreadySlotted) return;
    this._tuples = this._dataPoints.map((_, pixelIndex) => {
      const tuple: (number | null)[] = new Array(pointGroups.length).fill(null);
      tuple[0] = pixelIndex;
      return tuple;
    });
  }

  hasSlots(): boolean {
    return this._groupNames.length > 0;
  }

  getPointGroupsCount(): number {
    return this._groupNames.length;
  }

  getSlotIndexInTuple(tupleIndex: number, pixelIndex: number): number {
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

  removeSlotFromTuples(groupIndex: number): void {
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
