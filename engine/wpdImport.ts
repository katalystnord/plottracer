/**
 * Import a WebPlotDigitizer project (checkpoint 74).
 *
 * **Why this is the one-way door.** Compatibility splits in two (David,
 * 2026-07-15): *import* is one-way and must be faithful — we are reading
 * someone else's bytes — while *export* is ours and need only make sense.
 * Nobody round-trips projects between the two tools. So this is built while we
 * are still compatible, and afterwards we diverge freely.
 *
 * Until now the new app **could not open a WPD project at all**: the v4 *and*
 * pre-v4 deserializers were ported into `core/plotData.ts` and 100% unreachable
 * behind `engine/projectFile.ts`'s `plotTracerProject !== 1` gate. Verified by
 * probe: `core/` reads every upstream fixture perfectly (`wpd4.json` → 6 axes,
 * 6 datasets, 144 XY points). So this module is mostly *enumeration and honest
 * reporting*, not parsing.
 *
 * **Two facts about real WPD files that shape everything here:**
 *  1. **A bare `.json` carries no image** — every upstream fixture is
 *     `{version, axesColl, datasetColl, measurementColl}` with no image key.
 *     WPD's image-bearing format is `.tar` (`info.json` + `wpd.json` + images,
 *     `services/saveResume.js:68-86`).
 *  2. **Real projects are multi-figure.** `wpd4.json` — upstream's own fixture
 *     — has six axes and six datasets. We render one figure at a time, so the
 *     user picks. Silently importing `axesColl[0]` and dropping five figures is
 *     exactly the class of failure this project killed twice on 2026-07-15.
 *     When multi-figure lands (parity gap #5) the picker becomes the fallback
 *     for "just this one", not wasted work.
 */

import { PlotData, type AnyAxes } from '../core/plotData.js';
import type { Dataset } from '../core/dataset.js';
import { readTar, entryText, type TarEntry } from './tarRead.js';

export type WpdResult<T> = T | { error: string };

/** One calibrated figure inside a WPD project — a row in the picker. */
export interface WpdFigure {
  /** Index into the project's axesColl. */
  index: number;
  /** The axes' own name, e.g. "xy axes" — what the user called it in WPD. */
  name: string;
  /** WPD's class-name string, e.g. "XYAxes". */
  axesType: string;
  /** Our graph-type id, or null when we cannot open this figure yet. */
  configId: string | null;
  /** Why it can't be opened — shown next to a disabled row. Null when fine. */
  unsupportedReason: string | null;
  datasetNames: string[];
}

/** A parsed WPD `.tar`: the project JSON plus the images it bundles. */
export interface WpdArchive {
  /** Parsed contents of `<project>/wpd.json`. */
  wpdJson: unknown;
  /** Bundled images, in `info.json` order where available. */
  images: { name: string; bytes: Uint8Array; mime: string }[];
}

/** WPD class name -> our graph-type id. Mirrors projectFile.ts's own map; kept
 * separate because that one describes *our* files and this one describes
 * theirs — they are free to diverge now, and will. */
const WPD_AXES_TO_CONFIG: Record<string, string> = {
  XYAxes: 'xy',
  BarAxes: 'bar',
  PolarAxes: 'polar',
  TernaryAxes: 'ternary',
  MapAxes: 'map',
  CircularChartRecorderAxes: 'ccr',
};

/** Mime for a bundled file. WPD passes PDFs through verbatim and converts
 * everything else to PNG on save (`graphicsWidget.js:861-873`), so this mirrors
 * its own read-side rule (`saveResume.js:138-141`). */
function mimeFor(name: string): string {
  return name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/png';
}

/**
 * Parse a WPD `.tar` into its project JSON and images.
 *
 * Locates the project by finding the archive's `info.json`, exactly as WPD does
 * (`saveResume.js:129-131`) — the folder name inside the archive is the project
 * name and is not fixed.
 */
export function readWpdArchive(bytes: Uint8Array): WpdResult<WpdArchive> {
  let entries: TarEntry[];
  try {
    entries = readTar(bytes);
  } catch (e) {
    return { error: `Could not read this .tar — ${e instanceof Error ? e.message : String(e)}` };
  }

  const info = entries.find((e) => e.type === 'file' && e.name.endsWith('/info.json'));
  if (!info) {
    return { error: "This .tar doesn't look like a WebPlotDigitizer project — no info.json inside it." };
  }
  const projectName = info.name.replace(/\/info\.json$/, '');

  const jsonEntry = entries.find((e) => e.name === `${projectName}/wpd.json`);
  if (!jsonEntry) {
    return { error: `This WebPlotDigitizer project is missing its ${projectName}/wpd.json.` };
  }

  let wpdJson: unknown;
  try {
    wpdJson = JSON.parse(entryText(jsonEntry));
  } catch {
    return { error: "This project's wpd.json is not valid JSON." };
  }

  const images = entries
    .filter((e) => e.type === 'file' && !e.name.endsWith('.json'))
    .map((e) => ({
      name: e.name.replace(new RegExp(`^${projectName}/`), ''),
      bytes: e.data,
      mime: mimeFor(e.name),
    }));

  return { wpdJson, images };
}

/**
 * Read a WPD project's JSON and list the figures inside it.
 *
 * Handles both envelopes: v4 (`{version, axesColl, …}`) and pre-v4
 * (`{wpd: …}`) — `core/plotData.ts` ports both deserializers, and both are
 * verified against upstream's own fixtures.
 *
 * Returns the live `PlotData` alongside, so the caller can import a chosen
 * figure without parsing twice.
 */
export function listWpdFigures(wpdJson: unknown): WpdResult<{ plotData: PlotData; figures: WpdFigure[] }> {
  if (typeof wpdJson !== 'object' || wpdJson === null) {
    return { error: 'Not a valid WebPlotDigitizer project file.' };
  }
  const plotData = new PlotData();
  let ok: boolean | undefined;
  try {
    ok = plotData.deserialize(wpdJson as never) as boolean | undefined;
  } catch (e) {
    return { error: `Could not read this WebPlotDigitizer project — ${e instanceof Error ? e.message : String(e)}` };
  }
  if (ok === false) {
    return { error: 'Could not read this WebPlotDigitizer project — its data could not be parsed.' };
  }

  const axesColl = plotData.getAxesColl();
  if (axesColl.length === 0) {
    return { error: 'This WebPlotDigitizer project has no calibrated axes.' };
  }

  const figures: WpdFigure[] = axesColl.map((axes, index) => {
    const axesType = axes.constructor.name;
    // Read the type from the serialized string where we can rather than trusting
    // constructor.name, which minification can rename (the same reasoning
    // projectFile.ts documents for its own map).
    const serializedType =
      (wpdJson as { axesColl?: { type?: string }[] }).axesColl?.[index]?.type ??
      (wpdJson as { wpd?: { axesColl?: { type?: string }[] } }).wpd?.axesColl?.[index]?.type ??
      axesType;
    const configId = WPD_AXES_TO_CONFIG[serializedType] ?? null;
    return {
      index,
      name: axes.name,
      axesType: serializedType,
      configId,
      unsupportedReason:
        configId === null
          ? serializedType === 'ImageAxes'
            ? "Image (raw pixel) axes aren't supported yet"
            : `${serializedType} isn't supported yet`
          : null,
      datasetNames: datasetsForAxes(plotData, axes).map((d) => d.name),
    };
  });

  return { plotData, figures };
}

/** The datasets bound to one axes. WPD maps each dataset to its own axes, so a
 * multi-figure project's datasets must be filtered, not taken wholesale. */
export function datasetsForAxes(plotData: PlotData, axes: AnyAxes): Dataset[] {
  return plotData.getDatasets().filter((ds) => plotData.getAxesForDataset(ds) === axes);
}

/** One figure, ready to open. */
export interface ImportedWpdFigure {
  configId: string;
  axes: AnyAxes;
  datasets: Dataset[];
}

/**
 * Pull one figure out of a parsed project.
 *
 * Refuses rather than guessing: an unsupported axes type or an out-of-range
 * index returns an error the UI can show, instead of quietly importing
 * something else.
 */
export function importWpdFigure(
  plotData: PlotData,
  figures: readonly WpdFigure[],
  index: number
): WpdResult<ImportedWpdFigure> {
  const figure = figures.find((f) => f.index === index);
  if (!figure) return { error: `This project has no figure ${index}.` };
  if (figure.configId === null) {
    return { error: `Can't open "${figure.name}" — ${figure.unsupportedReason}.` };
  }
  const axes = plotData.getAxesColl()[index];
  if (!axes) return { error: `This project has no figure ${index}.` };
  return { configId: figure.configId, axes, datasets: datasetsForAxes(plotData, axes) };
}
