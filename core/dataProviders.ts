/**
 * Faithful TypeScript port of wpd-core's core/dataProviders.js.
 * Original: WebPlotDigitizer, Copyright (C) 2025 Ankit Rohatgi, AGPL-3.0.
 * See ../core/mathFunctions.ts for porting-provenance notes.
 *
 * **Why this exists (checkpoint 74).** This module is WPD's *data-output
 * contract*: it alone decides which columns each graph type emits, in what
 * order, with what headers. The 2026-07-15 parity audit found it was **never
 * ported** — `engine/csvExport.ts` was built from scratch beside it. That is the
 * same root cause the audit names everywhere else ("we ported it, then built a
 * narrower parallel path"), aimed at the app's actual product: the data.
 *
 * Four live defects were all symptoms of this one omission:
 *   1. **Bar charts lost their Label column entirely** — the categorical axis
 *      itself. WPD auto-names every bar and puts it FIRST (`['Label','Value']`).
 *   2. **`getAxesLabels()` had zero callers** while our hardcoded headers
 *      *diverged* (WPD writes `Time`/`Magnitude` for CCR; we wrote `t`/`value`).
 *   3. **CCR emitted raw julian floats** — `pixelToLiveString` had no callers.
 *   4. **Measurements exported display strings** (`"45.0°"`) instead of numbers.
 *
 * Deliberate divergences from the original, each for a reason:
 *  - **No `wpd.gettext`/`wpd.utils`.** Group-name fallbacks and sentence-casing
 *    are inlined; there is no i18n layer in `ui/` (see CLAUDE.md's rule-outs).
 *  - **`isFieldSortable` / `fieldDateFormat` / `allowConnectivity` /
 *    `connectivityFieldIndices` are carried through faithfully** even though
 *    nothing consumes them yet — they are the contract's own shape, and the
 *    Nearest-Neighbour sort (`allowConnectivity`) and date formatting are both
 *    logged parity gaps that will need exactly these fields. Porting them now
 *    costs nothing and is the point of a faithful port.
 *  - **The axes are passed in** rather than looked up from a module-global
 *    `appData` singleton — the original's `setDataSource`/`getData` pair is a
 *    stateful module; this is a pure function of (dataset, axes).
 */

import type { Dataset } from './dataset.js';
import type { AnyAxes } from './plotData.js';
import { BarAxes } from './axes/bar.js';

/** One row of exported values. `null` = not measured; never coerce to 0. */
export type DataRow = (string | number | null)[];

/** The column contract for one dataset, exactly as WPD defines it. */
export interface ProvidedData {
  /** Column headers, in order. */
  fields: string[];
  /** Per-column date format, sparse — set only for date-carrying columns. */
  fieldDateFormat: (string | undefined)[];
  rawData: DataRow[];
  /** True when the rows can be re-ordered by curve traversal (NN sort). */
  allowConnectivity: boolean;
  connectivityFieldIndices: number[];
  isFieldSortable: boolean[];
}

/** Inlined from wpd.utils.toSentenceCase — "overrides" -> "Overrides". */
function toSentenceCase(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Inlined from the original's gettext'd fallbacks for an unnamed group. */
function groupNameFor(pointGroupNames: string[], groupIndex: number): string {
  const name = pointGroupNames[groupIndex];
  if (name) return name;
  if (groupIndex === -1) return ''; // not in a group
  if (groupIndex === 0) return 'Primary group';
  return `Group ${groupIndex}`;
}

/**
 * Bar axes: `['Label', 'Value']`.
 *
 * The Label is the point of a bar chart — it IS the independent variable — and
 * it comes first. WPD falls back to `"Bar" + rowi`, and for a grouped dataset
 * borrows the label from the tuple's *primary* point so every row of a tuple
 * carries the category name.
 */
function getBarAxesData(dataSeries: Dataset, axes: AnyAxes): ProvidedData {
  const fieldDateFormat: (string | undefined)[] = [];
  const rawData: DataRow[] = [];
  const isFieldSortable: boolean[] = [false, true];

  let fields = ['Label', 'Value'];
  let metaKeys = dataSeries.getMetadataKeys().filter((k) => k !== 'label');
  const hasOverrides = metaKeys.indexOf('overrides') > -1;
  if (hasOverrides) metaKeys = metaKeys.filter((k) => k !== 'overrides');

  const hasPointGroups = dataSeries.hasPointGroups();
  const pointGroupNames = dataSeries.getPointGroups();

  for (let rowi = 0; rowi < dataSeries.getCount(); rowi++) {
    const dataPt = dataSeries.getPixel(rowi);
    const transformed = axes.pixelToData(dataPt.x, dataPt.y);
    const row: DataRow = [];

    let tupleIdx = -1;
    let groupIdx = -1;
    if (hasPointGroups) {
      tupleIdx = dataSeries.getTupleIndex(rowi);
      groupIdx = dataSeries.getPointGroupIndexInTuple(tupleIdx, rowi);
    }

    let lab: string = `Bar${rowi}`;
    if (dataPt.metadata != null) {
      lab = dataPt.metadata['label'] as string;
    } else if (hasPointGroups && tupleIdx > -1 && groupIdx > -1) {
      // Label each tuple by its primary-group point, so a Box Plot's five rows
      // all carry the category name rather than only the first.
      const primaryIdx = dataSeries.getTuple(tupleIdx)?.[0];
      const primaryPt = primaryIdx != null ? dataSeries.getPixel(primaryIdx) : null;
      lab = primaryPt?.metadata != null ? (primaryPt.metadata['label'] as string) : `Bar${tupleIdx}`;
    }
    row.push(lab);
    row.push(transformed[0]!);

    if (hasPointGroups) {
      row.push(tupleIdx);
      row.push(groupNameFor(pointGroupNames, groupIdx));
    }

    for (const key of metaKeys) {
      row.push((dataPt.metadata?.[key] as string | number | undefined) ?? null);
    }

    if (hasOverrides) {
      const overrides = dataPt.metadata?.['overrides'] as Record<string, number> | undefined;
      row.push(overrides?.['y'] ?? null);
    }
    rawData[rowi] = row;
  }

  if (hasPointGroups) {
    fields = fields.concat('Tuple', 'Group');
    isFieldSortable.push(true, true);
  }
  if (metaKeys.length) {
    fields = fields.concat(
      metaKeys.map((k) => {
        isFieldSortable.push(true);
        return toSentenceCase(k);
      })
    );
  }
  if (hasOverrides) {
    fields = fields.concat(['Value-Override']);
    isFieldSortable.push(true);
  }

  return {
    fields,
    fieldDateFormat,
    rawData,
    allowConnectivity: false,
    connectivityFieldIndices: [],
    isFieldSortable,
  };
}

/** 2D XY, Polar, Ternary, Image, Map — headers come from `axes.getAxesLabels()`. */
function getGeneralAxesData(dataSeries: Dataset, axes: AnyAxes): ProvidedData {
  const rawData: DataRow[] = [];
  const isFieldSortable: boolean[] = [];
  const hasMetadata = dataSeries.hasMetadata();

  const axesLabels = axes.getAxesLabels();
  let fields = [...axesLabels];
  const fieldDateFormat: (string | undefined)[] = [];
  const connectivityFieldIndices: number[] = [];
  let metaKeys = dataSeries.getMetadataKeys();
  let metaKeyCount = hasMetadata ? metaKeys.length : 0;

  const hasOverrides = metaKeys.indexOf('overrides') > -1;
  if (hasOverrides) {
    metaKeys = metaKeys.filter((k) => k !== 'overrides');
    metaKeyCount -= 1;
  }

  const hasPointGroups = dataSeries.hasPointGroups();
  const pointGroupNames = dataSeries.getPointGroups();

  for (let rowi = 0; rowi < dataSeries.getCount(); rowi++) {
    const pt = dataSeries.getPixel(rowi);
    const ptData = axes.pixelToData(pt.x, pt.y);
    const row: DataRow = [];

    for (const v of ptData) row.push(v);

    if (hasPointGroups) {
      const tuplei = dataSeries.getTupleIndex(rowi);
      const groupi = dataSeries.getPointGroupIndexInTuple(tuplei, rowi);
      row.push(tuplei);
      row.push(groupNameFor(pointGroupNames, groupi));
    }

    for (let i = 0; i < metaKeyCount; i++) {
      const key = metaKeys[i]!;
      row.push((pt.metadata?.[key] as string | number | undefined) ?? null);
    }

    if (hasOverrides) {
      // One override column per axes label — the user pins the reported VALUE
      // while the pixel stays put (see the parity audit's gap #7).
      for (const label of axesLabels) {
        const overrides = pt.metadata?.['overrides'] as Record<string, number> | undefined;
        row.push(overrides?.[label.toLowerCase()] ?? null);
      }
    }
    rawData[rowi] = row;
  }

  if (hasPointGroups) {
    fields = fields.concat('Tuple', 'Group');
    isFieldSortable.push(true, true);
  }
  if (hasMetadata) {
    fields = fields.concat(metaKeys.map((k) => toSentenceCase(k)));
    if (hasOverrides) {
      fields = fields.concat(axesLabels.map((f) => `${toSentenceCase(f)}-Override`));
    }
  }

  const dims = axes.getDimensions();
  for (let coli = 0; coli < fields.length; coli++) {
    if (coli < dims) {
      connectivityFieldIndices[coli] = coli;
      const dateAxes = axes as unknown as {
        isDate?: (i: number) => boolean;
        getInitialDateFormat?: (i: number) => string;
      };
      if (dateAxes.isDate != null && dateAxes.isDate(coli)) {
        fieldDateFormat[coli] = dateAxes.getInitialDateFormat?.(coli);
      }
    }
    isFieldSortable[coli] = true;
  }

  return {
    fields,
    fieldDateFormat,
    rawData,
    allowConnectivity: true,
    connectivityFieldIndices,
    isFieldSortable,
  };
}

/** The contract for one dataset — Bar has its own shape; everything else shares. */
export function getPlotData(dataSeries: Dataset, axes: AnyAxes): ProvidedData {
  return axes instanceof BarAxes ? getBarAxesData(dataSeries, axes) : getGeneralAxesData(dataSeries, axes);
}
