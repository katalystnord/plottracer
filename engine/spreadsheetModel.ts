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
*   - which cells the user may type into, and which are spline-derived.
 *   - which cells the user may type into, and which are spline-derived.
 *
 * ⚑ WHY THESE FOUR. Every one of them has produced a real defect:
 *   - ⚑ Column ORDER USED TO LIVE HERE, in `seriesColumns`, after the screen led
 *     with Category while the categorical EXPORT appended it last (David caught
 *     it 2026-07-26). That function was DELETED 2026-08-03: it had zero callers
 *     — the table builds its columns inline and never adopted it — so the drift
 *     it was written to prevent was never actually prevented, while the function
 *     sitting here tested and green read as though it were. Re-introduce it WIRED
 *     when the v2.1 Workspace split restructures the table; an uninstalled
 *     contract is worse than none, because it looks like cover.
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
import { ERROR_ROLES, type ErrorRole } from '../algorithms/errorBar.js';

/** The `ErrorBarPoint` field each role reads back from. */
const ROLE_FIELD = {
  upper: 'yUpper',
  lower: 'yLower',
  left: 'xLeft',
  right: 'xRight',
} as const satisfies Record<ErrorRole, 'yUpper' | 'yLower' | 'xLeft' | 'xRight'>;

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
  /** ⚑⚑ Which PIXEL each row is, so a click still addresses a real point.
   * Row index stopped being pixel index when a datum's caps became pixels of
   * its own series (B4) — every outward call from the table takes a pixel
   * index, and a row without its own would address the point two along. Plain
   * `0..n-1` for a series carrying no error. */
  pixelIndices: number[];
  /** The error columns this series records, in role order, under the user's own
   * word for the error ('SD upper'). ⚑ ONE PER ROLE THAT WAS MEASURED: all four
   * always exist in the record, but a vertical-error figure has nothing to say
   * about left and right, and four columns of blanks assert an emptiness nobody
   * looked for. Empty for a series with no error. */
  errorColumns: { role: ErrorRole; label: string }[];
  /** Per row, one value per `errorColumns` entry — the cap's ABSOLUTE position
   * on that role's axis, `null` where that side was never captured.
   * ⚑ Absolutes rather than deltas, measured not chosen: in the delta form "no
   * bound" and "a bound of size zero" are the same number, which is tenet 9's
   * exact failure (docs/generator-input-formats.md). The delta is a projection
   * the EXPORT carries alongside. */
  errorValues: (number | null)[][];
}


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
  return allDatasetsData.map((d) => {
    const pixelIndices = session.getDatumPixelIndices(d.index);
    const tail = session.getErrorSlotNames(d.index);
    // Row-aligned with `pixelIndices` by construction — both walk the tuples in
    // order and skip a tuple with no datum. See getDatumPixelIndices.
    const bars = tail.length > 0 ? session.getResolvedErrorBars(d.index) : [];
    const errorColumns = ERROR_ROLES.flatMap((role, i) =>
      bars.some((b) => b[ROLE_FIELD[role]] !== undefined)
        ? [{ role, label: tail[i] ?? role }]
        : []
    );
    const roles = session.getDataPointRolesFor(d.index);
    const labels = session.getPointLabels(d.index);
    return {
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
    values: pixelIndices.map((p) => d.points[p]?.data ?? null),
    roles: pixelIndices.map((p) => roles[p] ?? null),
    labels: pixelIndices.map((p) => labels[p] ?? ''),
    deltas: session.getErrorCapDeltas(d.index),
    pixelIndices,
    errorColumns,
    errorValues: pixelIndices.map((_p, row) => {
      const bar = bars[row];
      return errorColumns.map((c) => (bar ? bar[ROLE_FIELD[c.role]] ?? null : null));
    }),
    };
  });
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
