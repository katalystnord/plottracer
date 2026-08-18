/**
 * The import registry - one Open Project, and the FILE says which format it is.
 *
 * ⚑⚑ WHY A REGISTRY RATHER THAN A DOOR PER TOOL. Naming one tool in the UI
 * makes it a first-class citizen and advertises a symmetry that cannot exist: a
 * functional link IN implies a functional link OUT, and a third of what we now
 * record - spider spokes and their per-axis scales, point roles, box-plot
 * tuples, measurement blocks - has nowhere to go in any of these formats. So
 * every format enters through the same door, none is named in a menu, and
 * **adding the next digitizer is a new entry here and no UI change at all**.
 * That last sentence is the test of whether this design is right.
 *
 * ⚑ Reading many formats is the point, not a convenience (David, 2026-07-28):
 * it positions PlotTracer downstream of the whole field, so data flows in and
 * stops here. That makes the one-way rule a strategy rather than a limitation -
 * nothing in this file has, or may grow, a matching writer.
 *
 * SNIFFING LOOKS INSIDE CONTAINERS, NOT JUST AT MAGIC BYTES.
 * The rule everywhere in this codebase is "detect by CONTENT, never the
 * filename, since users rename files". Formats forced that rule further open:
 * a StarryDigitizer project is a zip holding `project.json` and `image.png` -
 * the same container shape and the same entry names as OURS. Four magic bytes
 * cannot separate them; only a key inside project.json can. So a sniffer is
 * free to unzip and read, and `extensions` below exists for dialog filters and
 * prose ONLY - never to decide what a file is.
 *
 * ORDER MATTERS: ours is tried first, so our own projects can never be claimed
 * by another format's sniffer.
 */

import { Dataset } from '../core/dataset.js';
import type { AnyAxes } from '../core/plotData.js';
import { isZipContainer, isTarArchive } from './projectContainer.js';
import { isEngaugeDocument, readEngaugeProject, importEngaugeFigure } from './digImport.js';
import { isStarryProject, importStarryProject } from './starryImport.js';

/** One calibrated figure, however it arrived. The common currency of every
 * importer that does not need a flow of its own. */
export interface ImportedFigure {
  configId: string;
  axes: AnyAxes;
  datasets: Dataset[];
  imageDataURL: string | null;
  /** What the file held that we could not carry, in plain words, for showing to
   * the user. An import that quietly drops half a project is the failure this
   * codebase has killed more than once. */
  notes: string[];
}

export type ImportResult<T> = T | { error: string };

export type ImportFormatId = 'plottracer' | 'wpd' | 'engauge' | 'starry';

export interface ImportFormat {
  id: ImportFormatId;
  /** What this format is called when we have to name it - in an error listing
   * what CAN be opened, never in a menu item of its own. */
  displayName: string;
  /** For the open dialog's filter and for prose. NEVER used to decide a type. */
  extensions: string[];
  /** Does this file belong to this format? Must not throw. */
  sniff(bytes: Uint8Array): boolean;
  /**
   * Read it into one calibrated figure.
   *
   * `null` marks a format that needs a flow of its own rather than a one-shot
   * read: OUR OWN projects (which restore measurements, provenance, multiple
   * figures and a bundled source document - far more than an ImportedFigure
   * carries), and the archive format that can hold several figures on one image
   * and therefore has to ask the user which. Those two stay with the caller by
   * necessity, not by oversight.
   */
  open: ((bytes: Uint8Array) => ImportResult<ImportedFigure>) | null;
}

/** Every format Open Project accepts. Ours first - see the header. */
export const IMPORT_FORMATS: readonly ImportFormat[] = [
  {
    id: 'plottracer',
    displayName: 'PlotTracer projects',
    extensions: ['zip', 'json'],
    // A zip is ours unless another format claims it (checked in order below);
    // a bare JSON project is the legacy single-file form.
    sniff: (bytes) => isZipContainer(bytes) || looksLikeJsonObject(bytes),
    open: null, // restored by the caller - see the note on `open`
  },
  {
    id: 'wpd',
    displayName: 'WebPlotDigitizer projects',
    extensions: ['tar'],
    sniff: isTarArchive,
    open: null, // may hold several figures on one image; the user chooses
  },
  {
    id: 'engauge',
    displayName: 'Engauge Digitizer projects',
    extensions: ['dig'],
    sniff: isEngaugeDocument,
    open: (bytes) => {
      const parsed = readEngaugeProject(bytes);
      if ('error' in parsed) return parsed;
      return importEngaugeFigure(parsed);
    },
  },
  {
    id: 'starry',
    displayName: 'StarryDigitizer projects',
    extensions: ['zip'],
    sniff: isStarryProject,
    open: importStarryProject,
  },
];

/** Does this look like a bare JSON object - the legacy single-file project? */
function looksLikeJsonObject(bytes: Uint8Array): boolean {
  for (let i = 0; i < Math.min(bytes.length, 64); i++) {
    const b = bytes[i]!;
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue; // whitespace
    return b === 0x7b; // '{'
  }
  return false;
}

/**
 * Which format is this file?
 *
 * ⚑ The zip case is why this is not a plain `.find()`. Our container and a
 * StarryDigitizer project are BOTH "zip holding project.json and image.png", so
 * a zip has to be offered to the other formats' sniffers - which read inside it
 * - before we may claim it as ours. Getting this backwards is not a near miss:
 * it produced "Project archive is missing its image reference" for a file we
 * can read perfectly well.
 */
export function identifyProject(bytes: Uint8Array): ImportFormat | null {
  if (isZipContainer(bytes)) {
    const foreign = IMPORT_FORMATS.find((f) => f.id !== 'plottracer' && f.sniff(bytes));
    if (foreign) return foreign;
    return IMPORT_FORMATS.find((f) => f.id === 'plottracer') ?? null;
  }
  return IMPORT_FORMATS.find((f) => f.sniff(bytes)) ?? null;
}

/**
 * What to say about a file we cannot open.
 *
 * The importer ships openly incomplete and grows, so an unsupported file must be
 * refused WITH the list of formats that do work - never a generic failure. That
 * is the v1.3 lesson (grade prose and errors against what the app REFUSES, not
 * only against what it does) applied up front rather than in a later audit.
 */
export function unsupportedFileMessage(): string {
  const names = IMPORT_FORMATS.map((f) => f.displayName).join(', ');
  return `PlotTracer doesn't recognise this file. It can open: ${names}.`;
}

/** Every extension any format uses, for the open dialog's filter. Deduplicated
 * and stable in registry order; the dialog is a convenience, and the FILE still
 * decides what it is. */
export function importDialogExtensions(): string[] {
  const seen = new Set<string>();
  for (const f of IMPORT_FORMATS) for (const e of f.extensions) seen.add(e);
  return [...seen];
}
