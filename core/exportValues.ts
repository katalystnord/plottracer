/**
 * The exported VALUE contract — what actually goes in each column.
 *
 * Faithful port of `wpd-core/javascript/services/dataExport.js`'s
 * `getValueAtPixel` (:27-47) and the header rule inside `generateCSV` (:74,:101).
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See core/mathFunctions.ts for porting-provenance notes.
 *
 * **Why this is a separate module from core/dataProviders.ts — a correction to
 * the 2026-07-15 audit, verified at source 2026-07-16.** CLAUDE.md says
 * `dataProviders.js` is *"WPD's data-output contract… it alone decides which
 * columns each graph type emits"*, and that `engine/csvExport.ts` is the
 * parallel path beside it. That is **wrong for CSV**. Upstream,
 * `wpd.plotDataProvider` has exactly two callers:
 *   - `widgets/dataTable.js:28` — the on-screen table, and
 *   - `services/dataExport.js:131` — inside `exportToPlotly`, a feature we have
 *     ruled out (network dependency, against the no-cloud constraint).
 *
 * **WPD's CSV export never touches it.** `generateCSV` (`dataExport.js:50-120`)
 * builds its own way: `axes.getAxesLabels()` for headers, `getValueAtPixel` for
 * values. So `csvExport.ts`'s real counterpart is `generateCSV`, and
 * `dataProviders.ts`'s real counterpart is our right-panel spreadsheet (wiring
 * that is its own checkpoint, agreed with David 2026-07-16).
 *
 * Three of the four "dataProviders" defects live here, not there:
 *   1. **Bar lost its Label column** — the categorical axis itself.
 *   2. **Headers diverged** from `getAxesLabels()`, which had zero callers.
 *   3. **CCR emitted raw julian floats** — `2460123.45` where WPD reads a time.
 * (The fourth, measurements exporting `"45.0°"` as a string, is
 * `wpd.measurementDataProvider` — the half of dataProviders.js checkpoint 74
 * did not port. See core/measurementValues.ts.)
 *
 * Pure: no DOM, no engine imports. Values only — delimiters, quoting and layout
 * stay in engine/csvExport.ts.
 */

import type { PixelPoint } from './dataset.js';
import { XYAxes } from './axes/xy.js';
import { BarAxes } from './axes/bar.js';
import { CircularChartRecorderAxes } from './axes/circularChartRecorder.js';
import { formatDateNumber } from './dateConversion.js';
import { halfPixelResolution, roundToResolution, type PrecisionMode } from './exportPrecision.js';

/** One exported cell. `null` = not measured; never coerce to 0. */
export type ExportValue = string | number | null;

/**
 * What this module needs of an axes — structural rather than `AnyAxes`, so the
 * session's own generic (`A extends CalibratedAxes`) satisfies it without a
 * cast. Every one of the 7 classes implements both (core/axes/types.ts:25);
 * the `instanceof` narrowing below still works on any object.
 */
export interface ExportableAxes {
  pixelToData(px: number, py: number): number[];
  getAxesLabels(): string[];
}

/**
 * The column headers for an axes, from the axes' own contract.
 *
 * A one-line wrapper, kept so callers name the intent rather than reaching for
 * `getAxesLabels()` and inviting a hardcoded list beside it again — which is
 * precisely how `AxesTypeConfig.valueLabels` came to diverge (Bar `['value']`
 * vs `['Label','Y']`; CCR `['t','value']` vs `['Time','Magnitude']`; Ternary
 * `['A','B','C']` vs `['a','b','c']`). These strings are the column headers of
 * every file we emit.
 */
export function exportLabelsFor(axes: ExportableAxes): string[] {
  return axes.getAxesLabels();
}

/**
 * The exported values for one point, in `exportLabelsFor(axes)` order.
 *
 * Three axes types read their own projection differently, and each one is a
 * live defect if skipped:
 *
 * - **Bar** returns `[label, value]`. `pixelToData` yields ONE number, but the
 *   label — the independent variable, the whole point of a bar chart — lives in
 *   the point's metadata, which is why `getDimensions()` is 2 while `dataDim` is
 *   1. Falls back to `Bar<i>` exactly as upstream does, so an unnamed bar still
 *   gets a stable identifier rather than an empty cell.
 * - **CCR** formats its time column unconditionally (upstream does this with no
 *   opt-in, `dataExport.js:36-37`), so 100% of CCR extractions currently read
 *   `2460123.45` where WPD reads a real time.
 * - **XY** formats a column only when that axis was actually calibrated with
 *   dates — opt-in, unlike CCR.
 *
 * **Divergence from upstream, deliberate:** WPD reads the Bar label as
 * `pixel.metadata[0]` (positional, legacy). Our `Dataset` stores metadata as an
 * object keyed by `metadataKeys` (`plotData.ts` maps the legacy array form on
 * load), so we read `metadata['label']` — the same key `dataProviders.ts`
 * already uses.
 */
export function valueAtPixel(
  ptIndex: number,
  axes: ExportableAxes,
  pixel: PixelPoint,
  mode: PrecisionMode = 'auto'
): ExportValue[] {
  const raw = axes.pixelToData(pixel.x, pixel.y);

  // Round each NUMERIC pixelToData value to this pixel's own resolution BEFORE the
  // per-type formatting below (so the resolution index lines up with the value's
  // dimension — Bar's output prepends a Label, which would shift a post-format
  // index). String labels and (already-formatted) dates never reach this.
  const res = mode === 'full' ? null : halfPixelResolution(axes, pixel.x, pixel.y);
  const val: ExportValue[] = res
    ? raw.map((v, i) => (Number.isFinite(v) ? roundToResolution(v, res[i] ?? NaN) : v))
    : raw;

  let out: ExportValue[];
  if (axes instanceof BarAxes) {
    const label = pixel.metadata?.['label'];
    out = [typeof label === 'string' && label.length > 0 ? label : `Bar${ptIndex}`, val[0] ?? null];
  } else if (axes instanceof CircularChartRecorderAxes) {
    out = [formatIfNumber(val[0], axes.getTimeFormat()), ...val.slice(1)];
  } else if (axes instanceof XYAxes) {
    out = val.map((v, i) => (axes.isDate(i) ? formatIfNumber(v, axes.getInitialDateFormat(i)) : v));
  } else {
    out = val;
  }
  // A non-finite value (NaN/Infinity from a degenerate calibration, or an
  // undefined geometric point) is "not measured", not a number. Emit null so
  // every exporter agrees — CSV blanks it (`?? ''`), JSON/xlsx serialize null —
  // instead of CSV printing the literal "NaN" while JSON writes null.
  return out.map((v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
}

/** Formats a serial day-number, or passes the value through untouched when
 * there is no format or nothing to format. Guards `null` rather than printing
 * an epoch date for a value that was never measured. */
function formatIfNumber(value: ExportValue | undefined, format: string | null): ExportValue {
  if (typeof value !== 'number' || format == null) return value ?? null;
  // A non-finite serial (NaN/Infinity from a degenerate calibration or an
  // undefined point) is "not measured", not a date. Without this guard,
  // formatDateNumber(NaN, ...) builds a garbage string ("NaN/NaN/NaN") that
  // slips PAST valueAtPixel's final sanitizer -- that pass nullifies non-finite
  // NUMBERS, but the value has already become a string by then. Return null so
  // a date column honours the same "not measured -> null" contract every other
  // column does, and CSV/JSON/xlsx still agree.
  if (!Number.isFinite(value)) return null;
  return formatDateNumber(value, format);
}
