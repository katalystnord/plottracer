/**
 * Faithful TypeScript port of wpd-core's core/connectedPoints.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See core/mathFunctions.ts for porting-provenance notes.
 *
 * Ported in full (not in the original Step 1 file list) — plotData.ts's
 * measurement serialize/deserialize has a hard dependency on these
 * classes, same "graduates into scope" situation as dateConversion.ts.
 *
 * One deliberate simplification: the original constructor sets
 * `this.page = 1` when `wpd.appData.isMultipage()` — that's PDF/multi-
 * page session UI state, not calibration/measurement data, and has no
 * equivalent in a headless core. Dropped; page association (if ever
 * needed here) belongs in a future ui/ or pageManager-equivalent layer.
 */

import { taninverse } from './mathFunctions.js';

export class ConnectedPoints {
  protected _connections: number[][] = [];
  protected _selectedConnectionIndex = -1;
  protected _selectedPointIndex = -1;
  protected _connectivity: number;

  constructor(connectivity: number) {
    this._connectivity = connectivity;
  }

  addConnection(plist: number[]): void {
    this._connections.push(plist);
  }

  clearAll(): void {
    this._connections = [];
  }

  getConnectionAt(index: number): number[] | undefined {
    if (index < this._connections.length) {
      return this._connections[index];
    }
    return undefined;
  }

  replaceConnectionAt(index: number, plist: number[]): void {
    if (index < this._connections.length) {
      this._connections[index] = plist;
    }
  }

  deleteConnectionAt(index: number): void {
    if (index < this._connections.length) {
      this._connections.splice(index, 1);
    }
  }

  connectionCount(): number {
    return this._connections.length;
  }

  findNearestPointAndConnection(x: number, y: number): { connectionIndex: number; pointIndex: number } {
    let minConnIndex = -1;
    let minPointIndex = -1;
    let minDist = 0;

    for (let ci = 0; ci < this._connections.length; ci++) {
      const conn = this._connections[ci]!;
      for (let pi = 0; pi < conn.length; pi += 2) {
        const dist = (conn[pi]! - x) * (conn[pi]! - x) + (conn[pi + 1]! - y) * (conn[pi + 1]! - y);
        if (minPointIndex === -1 || dist < minDist) {
          minConnIndex = ci;
          minPointIndex = pi / 2;
          minDist = dist;
        }
      }
    }

    return { connectionIndex: minConnIndex, pointIndex: minPointIndex };
  }

  selectNearestPoint(x: number, y: number): void {
    const nearestPt = this.findNearestPointAndConnection(x, y);
    if (nearestPt.connectionIndex >= 0) {
      this._selectedConnectionIndex = nearestPt.connectionIndex;
      this._selectedPointIndex = nearestPt.pointIndex;
    }
  }

  deleteNearestConnection(x: number, y: number): void {
    const nearestPt = this.findNearestPointAndConnection(x, y);
    if (nearestPt.connectionIndex >= 0) {
      this.deleteConnectionAt(nearestPt.connectionIndex);
    }
  }

  isPointSelected(connectionIndex: number, pointIndex: number): boolean {
    return this._selectedPointIndex === pointIndex && this._selectedConnectionIndex === connectionIndex;
  }

  getSelectedConnectionAndPoint(): { connectionIndex: number; pointIndex: number } {
    return { connectionIndex: this._selectedConnectionIndex, pointIndex: this._selectedPointIndex };
  }

  unselectConnectionAndPoint(): void {
    this._selectedConnectionIndex = -1;
    this._selectedPointIndex = -1;
  }

  setPointAt(connectionIndex: number, pointIndex: number, x: number, y: number): void {
    this._connections[connectionIndex]![pointIndex * 2] = x;
    this._connections[connectionIndex]![pointIndex * 2 + 1] = y;
  }

  getPointAt(connectionIndex: number, pointIndex: number): { x: number; y: number } {
    const conn = this._connections[connectionIndex]!;
    return { x: conn[pointIndex * 2]!, y: conn[pointIndex * 2 + 1]! };
  }
}

export class DistanceMeasurement extends ConnectedPoints {
  constructor() {
    super(2);
  }

  getDistance(index: number): number | undefined {
    if (index < this._connections.length && this._connectivity === 2) {
      const conn = this._connections[index]!;
      return Math.sqrt((conn[0]! - conn[2]!) * (conn[0]! - conn[2]!) + (conn[1]! - conn[3]!) * (conn[1]! - conn[3]!));
    }
    return undefined;
  }
}

export class AngleMeasurement extends ConnectedPoints {
  constructor() {
    super(3);
  }

  getAngle(index: number): number | undefined {
    if (index < this._connections.length && this._connectivity === 3) {
      const conn = this._connections[index]!;
      const ang1 = taninverse(-(conn[5]! - conn[3]!), conn[4]! - conn[2]!);
      const ang2 = taninverse(-(conn[1]! - conn[3]!), conn[0]! - conn[2]!);
      let ang = ang1 - ang2;
      ang = (180.0 * ang) / Math.PI;
      ang = ang < 0 ? ang + 360 : ang;
      return ang;
    }
    return undefined;
  }
}

export class AreaMeasurement extends ConnectedPoints {
  constructor() {
    super(-1); // connectivity can vary depending on the number of polygon points
  }

  getArea(index: number): number {
    if (index < this._connections.length) {
      const conn = this._connections[index]!;
      if (conn.length >= 4) {
        let totalArea = 0.0;
        for (let pi = 0; pi < conn.length; pi += 2) {
          const px1 = conn[pi]!;
          const py1 = conn[pi + 1]!;
          let px2: number;
          let py2: number;
          if (pi <= conn.length - 4) {
            px2 = conn[pi + 2]!;
            py2 = conn[pi + 3]!;
          } else {
            px2 = conn[0]!;
            py2 = conn[1]!;
          }
          totalArea += px1 * py2 - px2 * py1;
        }
        totalArea /= 2.0;
        return totalArea;
      }
    }
    return 0;
  }

  getPerimeter(index: number): number | undefined {
    if (index < this._connections.length) {
      const conn = this._connections[index]!;
      let totalDist = 0.0;
      let px_prev = 0.0;
      let py_prev = 0.0;
      for (let pi = 0; pi < conn.length; pi += 2) {
        const px = conn[pi]!;
        const py = conn[pi + 1]!;
        if (pi >= 2) {
          totalDist += Math.sqrt((px - px_prev) * (px - px_prev) + (py - py_prev) * (py - py_prev));
        }
        if (pi === conn.length - 2 && pi >= 4) {
          const px0 = conn[0]!;
          const py0 = conn[1]!;
          totalDist += Math.sqrt((px - px0) * (px - px0) + (py - py0) * (py - py0));
        }
        px_prev = px;
        py_prev = py;
      }
      return totalDist;
    }
    return undefined;
  }
}
