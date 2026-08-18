/**
 * Measurement containers - the shape a saved measurement takes in the file.
 *
 * Originally a full port of wpd-core's core/connectedPoints.js
 * (WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0; see
 * core/mathFunctions.ts for porting-provenance notes). Ported because
 * plotData.ts's measurement serialize/deserialize has a hard dependency on
 * these classes.
 *
 * ⚑ NO LONGER A FULL PORT - reduced to what this app actually reaches
 * (2026-07-31, the pre-launch dead-code sweep; the mutation run scored this
 * file at 20% with 82 mutants no test could even reach, which is what a
 * wholly unreachable API surface looks like from the outside).
 *
 * What went, and why it was safe: upstream's INTERACTIVE editing API - the
 * selection pair (`selectNearestPoint`/`isPointSelected`/
 * `getSelectedConnectionAndPoint`/`unselectConnectionAndPoint` and the two
 * `_selected*` fields), in-place editing (`setPointAt`/`getPointAt`/
 * `replaceConnectionAt`), and deletion (`clearAll`/`deleteConnectionAt`/
 * `deleteNearestConnection`/`findNearestPointAndConnection`). Every one had
 * ZERO callers anywhere in core/, algorithms/, engine/ or ui/: PlotTracer
 * does measurement interaction in its own overlay layer (ui/'s MeasureCard +
 * the Konva overlay, with values derived by core/measurementValues.ts), and
 * only ever uses these classes as SERIALIZATION containers. We hold no
 * allegiance to the upstream API at the code level (tenet 5) - carrying a
 * parallel, unreachable editing model was a standing invitation to wire the
 * wrong one up.
 *
 * What remains is exactly the serialization surface plotData.ts calls:
 * `addConnection` (deserialize), `connectionCount` + `getConnectionAt`
 * (serialize), and DistanceMeasurement's `getDistance`, which is how a
 * round-trip test checks a restored measurement really holds its geometry
 * rather than merely existing.
 *
 * One deliberate simplification kept from the original port: upstream's
 * constructor sets `this.page = 1` when `wpd.appData.isMultipage()` - PDF/
 * multi-page session UI state, not measurement data, with no equivalent in a
 * headless core.
 */

export class ConnectedPoints {
  protected _connections: number[][] = [];
  /** How many points one connection holds: 2 for a distance, 3 for an angle,
   * -1 for an area (a polygon's vertex count varies). Read by
   * DistanceMeasurement.getDistance to refuse a mis-shaped connection. */
  protected _connectivity: number;

  constructor(connectivity: number) {
    this._connectivity = connectivity;
  }

  addConnection(plist: number[]): void {
    this._connections.push(plist);
  }

  getConnectionAt(index: number): number[] | undefined {
    if (index < this._connections.length) {
      return this._connections[index];
    }
    return undefined;
  }

  connectionCount(): number {
    return this._connections.length;
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
}

export class AreaMeasurement extends ConnectedPoints {
  constructor() {
    super(-1); // connectivity can vary depending on the number of polygon points
  }
}
