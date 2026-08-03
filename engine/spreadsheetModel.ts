/**
 * The multi-series data spreadsheet's MODEL — what the table is made of, as
 * opposed to how it is drawn.
 *
 * The table itself stays in `ui/src/Workspace.tsx`: it is text inputs, click
 * handlers, sticky headers and inline styles, and none of that belongs in a
 * framework-agnostic module. What lives here is the part that is not really
 * rendering at all — the RULES:
 *
 *   - which series/rows/values the table shows, and how many rows a RAGGED
 *     multi-series table has;
 *   - whether the Category column exists at all;
 *   - **what order a series' columns come in** (Category leads the values);
 *   - which cells the user may type into, and which are spline-derived.
 *
 * ⚑ WHY THESE FOUR. Every one of them has produced a real defect:
 *   - Column ORDER: the screen led with Category while the categorical EXPORT
 *     appended it last — screen and file disagreed until David caught it
 *     (2026-07-26). Both are now Position, Category, Value.
 *   - EDITABILITY: a spline-derived sample is regenerated from its anchors, so
 *     an edit looked like it took and was silently wiped (v0.6 audit).
 *   - DERIVED rows: selecting one made it the nudge/Del target, so a read-only
 *     italic row could still be moved with an arrow key (v1.3 gate).
 *   - The Category column belongs to Bar-WITHOUT-slots only; Box Plot and
 *     Histogram are bar-kind too but render the tuple table instead.
 *
 * Inside the component each of those was an inline expression that only an
 * ~18-minute Electron run could check. Here they are ordinary unit tests.
 */
import type {
  CalibrationSession,
  CalibratedAxes,
  DatasetInfo,
  DatasetPointsView,
  PointRole,
} from './calibrationSession.js';

/** One series as the spreadsheet shows it: its identity, its values with the
 * pixel columns dropped, and the two per-point annotations that differ BETWEEN
 * series (every series renders at once, so "is this point derived?" and "what
 * is it called?" cannot be read off the active one). */
export interface SpreadsheetSeries {
  index: number;
  name: string;
  color: [number, number, number];
  active: boolean;
  /** Per row: the point's data values, or null where the series is shorter. */
  values: (number[] | null)[];
  roles: (PointRole | null)[];
  labels: string[];
  /** For an ERROR-CAP series: each row's signed offset from the datum it
   * resolves to. Empty for every other series, which is what the table keys on
   * to show a single Δ column instead of X/Y — the cap's own x is the datum's x
   * by construction, so printing it is three columns of one number. See
   * CalibrationSession.getErrorCapDeltas. */
  deltas: (number | null)[];
}

/** A single column under one series' heading. `category` is the independent
 * variable (a NAME); `value` columns are the dependent ones, one per data
 * dimension, carrying the date format when that column is date-calibrated. */
export type SpreadsheetColumn =
  | { kind: 'category'; label: string }
  | { kind: 'value'; label: string; dim: number; dateFormat: string | null };

/**
 * Build every series' spreadsheet row data.
 *
 * `allDatasetsData` and `datasetInfos` are passed in rather than re-read from
 * the session because the component already memoises both and uses them
 * elsewhere — asking twice would risk the two views disagreeing mid-render.
 */
export function buildSpreadsheetSeries(
  allDatasetsData: readonly DatasetPointsView[],
  datasetInfos: readonly DatasetInfo[],
  session: CalibrationSession<CalibratedAxes>
): SpreadsheetSeries[] {
  return allDatasetsData.map((d) => ({
    index: d.index,
    // v2.0 pre-launch audit: was a fabricated `Series ${d.index + 1}` fallback
    // when the two views disagree -- the same invented-name shape as the
    // Bar0/Slice0 defect fixed elsewhere in this codebase, just triggered by
    // a desync instead of an unnamed capture. A name nobody gave the series
    // is not this component's to invent (tenet 9); if the two views can ever
    // actually disagree, blank is the honest answer, matching how every
    // other unnamed-thing in this app renders.
    name: datasetInfos.find((i) => i.index === d.index)?.name ?? '',
    color: d.color,
    active: d.active,
    values: d.points.map((p) => p.data),
    roles: session.getDataPointRolesFor(d.index),
    labels: session.getPointLabels(d.index),
    deltas: session.getErrorCapDeltas(d.index),
  }));
}

/** The table is RAGGED: it has as many rows as the longest series, and shorter
 * series render blank cells past their end. */
export function spreadsheetMaxRows(series: readonly SpreadsheetSeries[]): number {
  return series.reduce((max, s) => Math.max(max, s.values.length), 0);
}

/**
 * Does this chart get a Category column?
 *
 * ⚑ Bar-kind is NOT sufficient. Box Plot and Histogram are bar-kind too, but
 * they have SLOTS and render the tuple table above — which has carried its own
 * name field since v0.5. Keying on bar-kind alone would give them a second,
 * competing name column.
 */
export function showsCategoryColumn(axesKind: string, hasSlots: boolean): boolean {
  return axesKind === 'bar' && !hasSlots;
}

/**
 * One series' columns, IN ORDER.
 *
 * ⚑ Category leads: an independent variable comes before the dependent one, and
 * this order is the screen's half of the contract the categorical export also
 * keeps (Position, Category, Value). They disagreed once; keeping the order in
 * one function is what stops them drifting apart again.
 */
export function seriesColumns(
  showCategory: boolean,
  valueLabels: readonly string[],
  dateFormats: readonly (string | null)[] = []
): SpreadsheetColumn[] {
  return [
    ...(showCategory ? [{ kind: 'category' as const, label: 'Category' }] : []),
    ...valueLabels.map((label, dim) => ({
      kind: 'value' as const,
      label,
      dim,
      dateFormat: dateFormats[dim] ?? null,
    })),
  ];
}

/** A spline-derived sample has no independent existence — the next anchor move
 * rebuilds it from the anchors. */
export function isDerivedAt(roles: readonly (PointRole | null)[], row: number): boolean {
  return roles[row] === 'interpolated';
}

/**
 * May the user type into this cell?
 *
 * Three conditions, all necessary: only XY carries free numeric values; only
 * the ACTIVE series is edited ("you edit the series you're working on"); and a
 * derived sample refuses, because an edit there is silently wiped by the next
 * rebuild. It reads muted and italic instead, pointing at the anchors — which
 * ARE editable, and which the curve follows.
 */
export function isCellEditable(axesKind: string, seriesActive: boolean, derived: boolean): boolean {
  return axesKind === 'xy' && seriesActive && !derived;
}
