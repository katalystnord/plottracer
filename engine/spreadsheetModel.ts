/**
 * The multi-series data spreadsheet's MODEL - what the table is made of, as
 * opposed to how it is drawn.
 *
 * The table itself stays in `ui/src/Workspace.tsx`: it is text inputs, click
 * handlers, sticky headers and inline styles, and none of that belongs in a
 * framework-agnostic module. What lives here is the part that is not really
 * rendering at all - the RULES:
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
 *     - the table builds its columns inline and never adopted it - so the drift
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
import type { ErrorRole } from '../algorithms/errorBar.js';

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
  /** Per row, which of that point's values the USER supplied rather than
   * reading off its pixel (A4). The table prints those in `[brackets]`, on
   * every series - a value a person read is still a reading, and which
   * instrument took it is the fact the record keeps. */
  supplied: number[][];
  labels: string[];
  /** For an ERROR-CAP series: each row's signed offset from the datum it
   * resolves to. Empty for every other series, which is what the table keys on
   * to show a single Δ column instead of X/Y - the cap's own x is the datum's x
   * by construction, so printing it is three columns of one number. See
   * CalibrationSession.getErrorCapDeltas. */
  deltas: (number | null)[];
  /** ⚑⚑ Which PIXEL each row is, so a click still addresses a real point.
   * Row index stopped being pixel index when a datum's caps became pixels of
   * its own series (B4) - every outward call from the table takes a pixel
   * index, and a row without its own would address the point two along. Plain
   * `0..n-1` for a series carrying no error. */
  pixelIndices: number[];
  /** The error columns this series records, in role order, under the user's own
   * word for the error ('SD upper'). ⚑ ONE PER ROLE THAT WAS MEASURED: all four
   * always exist in the record, but a vertical-error figure has nothing to say
   * about left and right, and four columns of blanks assert an emptiness nobody
   * looked for. Empty for a series with no error. */
  errorColumns: { role: ErrorRole; label: string }[];
  /** Per row, one value per `errorColumns` entry - the cap's ABSOLUTE position
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
 * elsewhere - asking twice would risk the two views disagreeing mid-render.
 */
export function buildSpreadsheetSeries(
  allDatasetsData: readonly DatasetPointsView[],
  datasetInfos: readonly DatasetInfo[],
  session: CalibrationSession<CalibratedAxes>
): SpreadsheetSeries[] {
  return allDatasetsData.map((d) => {
    const pixelIndices = session.getDatumPixelIndices(d.index);
    // ⚑ The session's own answer, NOT a second computation here. The export
    // asks the same two questions, and a column that exists on screen but not
    // in the file is this project's own case study - see getErrorColumns.
    // Row-aligned with `pixelIndices` by construction: both walk the tuples in
    // order and skip a tuple with no datum.
    const errorColumns = session.getErrorColumns(d.index);
    const errorRows = session.getErrorRows(d.index);
    const roles = session.getDataPointRolesFor(d.index);
    const supplied = session.getSuppliedDimsFor(d.index);
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
    supplied: pixelIndices.map((p) => supplied[p] ?? []),
    labels: pixelIndices.map((p) => labels[p] ?? ''),
    deltas: session.getErrorCapDeltas(d.index),
    pixelIndices,
    errorColumns,
    errorValues: pixelIndices.map((_p, row) => errorRows[row] ?? errorColumns.map(() => null)),
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
 * they have SLOTS and render the tuple table above - which has carried its own
 * name field since v0.5. Keying on bar-kind alone would give them a second,
 * competing name column.
 */
export function showsCategoryColumn(axesKind: string, hasSlots: boolean): boolean {
  return axesKind === 'bar' && !hasSlots;
}

/** A spline-derived sample has no independent existence - the next anchor move
 * rebuilds it from the anchors. */
export function isDerivedAt(roles: readonly (PointRole | null)[], row: number): boolean {
  return roles[row] === 'interpolated';
}

/**
 * Does this type edit a DATUM'S VALUE in a table at all?
 *
 * ⚑⚑ `axesKind === 'xy'` IS NOT THE WHOLE QUESTION, and the canvas menu is
 * where that showed (v2.3 re-audit, F29). Histogram and heatmap are xy-kind and
 * neither renders the spreadsheet: histogram shows BINS, derived from pairs of
 * corners, and heatmap shows CELLS. So the point context menu, gated on
 * `axesKind === 'xy'` alone, offered *"Edit value…"* on a histogram, set the
 * edit state, and no editor appeared anywhere on screen - a menu item that does
 * nothing, which is worse than an absent one because the user concludes the app
 * ignored them.
 *
 * ⚑ The panel is the answer because the panel is what renders the editor: a
 * type with an `outputPanel` of its own has replaced the value table, so there
 * is no cell to type into. Asked HERE rather than at each call site so the menu
 * and the table cannot answer differently - the drift `getErrorColumns` already
 * documents one floor down.
 */
export function editsValuesInTable(axesKind: string, outputPanel: string | undefined): boolean {
  return axesKind === 'xy' && outputPanel === undefined;
}

/**
 * May the user type into this cell?
 *
 * Four conditions, all necessary: the type must edit values in a table at all
 * (see `editsValuesInTable`); only the ACTIVE series is edited ("you edit the
 * series you're working on"); and a derived sample refuses, because an edit
 * there is silently wiped by the next rebuild. It reads muted and italic
 * instead, pointing at the anchors - which ARE editable, and which the curve
 * follows.
 */
export function isCellEditable(
  axesKind: string,
  outputPanel: string | undefined,
  seriesActive: boolean,
  derived: boolean
): boolean {
  return editsValuesInTable(axesKind, outputPanel) && seriesActive && !derived;
}
