/**
 * Import a StarryDigitizer project (`.zip`).
 *
 * StarryDigitizer is MIT-licensed, which permits literal reuse with
 * attribution - but nothing is reused here. This reads its FORMAT, which is all
 * an importer ever needs, and the licence note matters only because it is the
 * one source in this codebase where reading the source to learn the format was
 * itself unproblematic (see reference notes on per-source licence care).
 *
 *   StarryDigitizer - Copyright (c) 2021 MATO Tomoya, MIT licence.
 *   https://github.com/t29mato/starry-digitizer
 *
 * ⚑⚑ THE COLLISION THAT SHAPES THIS MODULE. A StarryDigitizer project is a zip
 * containing `project.json` and `image.png` - the SAME container shape and the
 * SAME entry names as our own project archive. So the leading zip magic cannot
 * tell them apart, and neither can the entry names: only a key INSIDE
 * project.json can. Ours carries `plotTracerProject: 1`; theirs carries
 * `axisSets`. Before this was noticed, opening one of their projects reached our
 * own deserializer, parsed its project.json happily, and died with "Project
 * archive is missing its image reference" - a confusing wrong answer for a file
 * we can in fact read. That is why sniffing has to be allowed to look inside a
 * container rather than at the first four bytes.
 *
 * WHAT THE FORMAT HOLDS (v1.11 shape)
 * -----------------------------------
 *   project.json {
 *     version, timestamp,
 *     axisSets: [{ id, name,
 *                  x1|x2|y1|y2: { name, value, coord: { xPx, yPx } },
 *                  xIsLogScale, yIsLogScale, considerGraphTilt, ... }],
 *     activeAxisSetId,
 *     datasets: [{ id, name, axisSetId, points: [{ id, xPx, yPx }], ... }],
 *     activeDatasetId, canvasHandler
 *   }
 *   image.png | image.jpg | image.jpeg
 *
 * It maps almost one-to-one onto our XY axes: four calibration points carrying
 * their own values, plus per-axis log flags - so nothing has to be reconstructed
 * the way an Engauge three-point system does.
 */

import { strFromU8 } from 'fflate';
import { unzipBounded, unzipEntry } from './zipRead.js';
import { Calibration } from '../core/calibration.js';
import { Dataset } from '../core/dataset.js';
import { XYAxes } from '../core/axes/xy.js';
import type { AnyAxes } from '../core/plotData.js';
import { bytesToBase64 } from './base64.js';

export type StarryResult<T> = T | { error: string };

/** The entry every StarryDigitizer project keeps its data in - the same name we
 * use for ours, which is exactly why the marker inside it is what decides. */
const PROJECT_ENTRY = 'project.json';

interface StarryCoord { xPx: number; yPx: number }
interface StarryAxis { name?: string; value?: number; coord?: StarryCoord }
interface StarryAxisSet {
  id?: number;
  name?: string;
  x1?: StarryAxis; x2?: StarryAxis; y1?: StarryAxis; y2?: StarryAxis;
  xIsLogScale?: boolean;
  yIsLogScale?: boolean;
  considerGraphTilt?: boolean;
}
interface StarryDataset {
  id?: number;
  name?: string;
  axisSetId?: number;
  points?: { id?: number; xPx?: number; yPx?: number }[];
}
interface StarryProjectJson {
  version?: string;
  axisSets?: StarryAxisSet[];
  activeAxisSetId?: number;
  datasets?: StarryDataset[];
}

/**
 * Does this zip hold a StarryDigitizer project?
 *
 * Reads `project.json` out of the archive and looks for the keys only their
 * format has. Deliberately checks for `axisSets` AND the absence of our own
 * marker, so a future file carrying both could never be claimed by mistake.
 *
 * Returns false rather than throwing on anything unreadable - a sniffer's job is
 * to answer "is this mine", and the reader that follows reports the real error.
 */
export function isStarryProject(bytes: Uint8Array): boolean {
  try {
    // ⚑ ONE ENTRY. A sniffer runs on every candidate file, including ones that
    // turn out to belong to nobody -- so it must not inflate a stranger's whole
    // archive to answer "is this mine". See engine/zipRead.ts.
    const entry = unzipEntry(bytes, PROJECT_ENTRY);
    if (!entry) return false;
    const json = JSON.parse(strFromU8(entry)) as Record<string, unknown>;
    if (json['plotTracerProject'] === 1) return false; // ours, not theirs
    return Array.isArray(json['axisSets']);
  } catch {
    return false;
  }
}

/** The image entry, found by name then confirmed by extension for its mime.
 * Their writer emits `image.png`, and their reader accepts jpg/jpeg too, so we
 * accept exactly the set they do. */
function findImage(files: Record<string, Uint8Array>): { bytes: Uint8Array; mime: string } | null {
  const candidates: [string, string][] = [
    ['image.png', 'image/png'],
    ['image.jpg', 'image/jpeg'],
    ['image.jpeg', 'image/jpeg'],
  ];
  for (const [name, mime] of candidates) {
    const b = files[name];
    if (b && b.length > 0) return { bytes: b, mime };
  }
  return null;
}

/**
 * ⚑⚑ ONE FIGURE OF SEVERAL, LISTED BEFORE ANYTHING IS OPENED.
 *
 * A StarryDigitizer project holds an `axisSets` array, and each entry is its own
 * calibrated figure with its own datasets - exactly the multiplicity every other
 * project format has. This used to open the ACTIVE one and name the rest in a
 * note, which is a decision taken on the user's behalf about which of their
 * figures matters.
 *
 * ⚑ The shape mirrors the other importers deliberately, so no format is the one
 * the app is really built around and the picker can be written once.
 */
export interface StarryFigure {
  index: number;
  name: string;
  /** Our graph type, or null when we cannot open it. */
  configId: string | null;
  unsupportedReason: string | null;
  datasetNames: string[];
}

/** A read project, held so a figure can be opened without parsing twice. */
export interface StarryProject {
  json: StarryProjectJson;
  files: Record<string, Uint8Array>;
  figures: StarryFigure[];
}

/** A StarryDigitizer project turned into our own model. */
export interface ImportedStarryFigure {
  configId: string;
  axes: AnyAxes;
  datasets: Dataset[];
  imageDataURL: string | null;
  /** What the file held that we did not carry, in plain words. */
  notes: string[];
}

function axisPoint(a: StarryAxis | undefined): { px: number; py: number; value: number } | null {
  const px = a?.coord?.xPx;
  const py = a?.coord?.yPx;
  const value = a?.value;
  if (typeof px !== 'number' || typeof py !== 'number' || typeof value !== 'number') return null;
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(value)) return null;
  return { px, py, value };
}

/**
 * Read a StarryDigitizer `.zip` into our axes and datasets.
 *
 * Refuses with a reason rather than importing a partial project: an axis set
 * missing a calibration point, or one whose points cannot fix a scale, is an
 * error the UI shows - not a figure whose numbers are quietly wrong.
 */
export function listStarryFigures(bytes: Uint8Array): StarryResult<StarryProject> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipBounded(bytes);
  } catch (err) {
    return { error: err instanceof Error && err.name === 'ZipTooLargeError'
      ? err.message
      : 'Could not open this project - the archive is unreadable.' };
  }
  const entry = files[PROJECT_ENTRY];
  if (!entry) return { error: 'This is not a StarryDigitizer project (no project.json inside it).' };

  let json: StarryProjectJson;
  try {
    json = JSON.parse(strFromU8(entry)) as StarryProjectJson;
  } catch {
    return { error: "Could not open this project - its project.json is not valid JSON." };
  }

  const axisSets = Array.isArray(json.axisSets) ? json.axisSets : [];
  if (axisSets.length === 0) return { error: 'This StarryDigitizer project has no calibrated axes.' };

  const all = Array.isArray(json.datasets) ? json.datasets : [];
  const figures: StarryFigure[] = axisSets.map((a, index) => {
    const complete = !!axisPoint(a.x1) && !!axisPoint(a.x2) && !!axisPoint(a.y1) && !!axisPoint(a.y2);
    const mine = all.filter((d) => d.axisSetId === a.id);
    return {
      index,
      name: typeof a.name === 'string' && a.name.length > 0 ? a.name : `Axis set ${index + 1}`,
      // Every StarryDigitizer figure is an XY chart; the format has no other kind.
      configId: complete ? 'xy' : null,
      unsupportedReason: complete
        ? null
        : 'its axes are incomplete - all four calibration points are needed',
      datasetNames: (mine.length > 0 ? mine : all.filter((d) => d.axisSetId == null)).map((d) =>
        typeof d.name === 'string' && d.name.length > 0 ? d.name : 'Data'
      ),
    };
  });
  return { json, files, figures };
}

/**
 * Read a project and open a single figure - the convenience path for a file that
 * holds one, and for callers that do not present a choice.
 *
 * ⚑ It opens the figure the file marks ACTIVE, which is a reasonable default for
 * one figure and is NOT a judgement about which of several matters. Anything
 * showing the user a choice lists first (`listStarryFigures`) and opens the index
 * they picked.
 */
export function importStarryProject(bytes: Uint8Array): StarryResult<ImportedStarryFigure> {
  const listed = listStarryFigures(bytes);
  if ('error' in listed) return listed;
  const axisSets = Array.isArray(listed.json.axisSets) ? listed.json.axisSets : [];
  const activeIndex = Math.max(
    0,
    axisSets.findIndex((a) => a.id === listed.json.activeAxisSetId)
  );
  const opened = importStarryFigureAt(listed, activeIndex);
  // ⚑ THE FUNCTION THAT DECIDES IS THE ONE THAT EXPLAINS. `importStarryFigureAt`
  // says nothing about the others because it was told which to open; this path
  // chose, so it says so.
  if (!('error' in opened) && listed.figures.length > 1) {
    opened.notes.push(
      `This project holds ${listed.figures.length} figures; "${listed.figures[activeIndex]!.name}" was opened.`
    );
  }
  return opened;
}

/**
 * Open ONE figure of a listed StarryDigitizer project.
 *
 * ⚑ Takes the index the user chose rather than deciding for them. The file's own
 * `activeAxisSetId` is a note about where that tool's cursor was, not a statement
 * about which figure is worth reading.
 */
export function importStarryFigureAt(
  project: StarryProject,
  index: number
): StarryResult<ImportedStarryFigure> {
  const { json, files } = project;
  const axisSets = Array.isArray(json.axisSets) ? json.axisSets : [];
  const active = axisSets[index];
  const listed = project.figures[index];
  if (!active || !listed) return { error: `This project has no figure ${index}.` };
  if (listed.configId === null) {
    return { error: `Can't open "${listed.name}" - ${listed.unsupportedReason}.` };
  }
  const notes: string[] = [];

  const x1 = axisPoint(active.x1);
  const x2 = axisPoint(active.x2);
  const y1 = axisPoint(active.y1);
  const y2 = axisPoint(active.y2);
  if (!x1 || !x2 || !y1 || !y2) {
    return { error: "This StarryDigitizer project's axes are incomplete - all four calibration points are needed." };
  }

  // ⚑ Values go in as TEXT. Calibration parses them through InputParser, which
  // tries a DATE first, so a bare number in 0..23 would become an hour-of-day
  // timestamp - the trap engine/digImport.ts documents at length.
  const calib = new Calibration(2);
  calib.addPoint(x1.px, x1.py, String(x1.value), '0');
  calib.addPoint(x2.px, x2.py, String(x2.value), '0');
  calib.addPoint(y1.px, y1.py, '0', String(y1.value));
  calib.addPoint(y2.px, y2.py, '0', String(y2.value));

  const axes = new XYAxes();
  // considerGraphTilt is their name for correcting a rotated figure; ours is the
  // inverse flag, so it is negated rather than passed through.
  //
  // ⚑ ABSENT means no correction, because StarryDigitizer's own model defaults it
  // to false (axisSet.ts declares `considerGraphTilt = false`). This read `=== false`,
  // so a missing key produced `false` here and silently turned correction ON --
  // the opposite of what their file means. Only an explicit `true` asks for it.
  const noRotationCorrection = active.considerGraphTilt !== true;
  if (!axes.calibrate(calib, active.xIsLogScale === true, active.yIsLogScale === true, noRotationCorrection)) {
    return {
      error:
        active.xIsLogScale || active.yIsLogScale
          ? "This StarryDigitizer project's log axes could not be calibrated - a log scale needs axis values greater than zero."
          : "This StarryDigitizer project's axes could not be calibrated.",
    };
  }

  // Only the datasets bound to the axis set we opened; carrying the others would
  // place points against a calibration that is not theirs.
  const everyDataset = Array.isArray(json.datasets) ? json.datasets : [];
  const mine = everyDataset.filter((d) => d.axisSetId === active.id);
  const source = mine.length > 0 ? mine : everyDataset.filter((d) => d.axisSetId == null);
  const datasets: Dataset[] = [];
  for (const d of source) {
    const ds = new Dataset();
    ds.name = typeof d.name === 'string' && d.name.length > 0 ? d.name : 'Data';
    for (const p of d.points ?? []) {
      if (typeof p.xPx !== 'number' || typeof p.yPx !== 'number') continue;
      if (!Number.isFinite(p.xPx) || !Number.isFinite(p.yPx)) continue;
      ds.addPixel(p.xPx, p.yPx);
    }
    datasets.push(ds);
  }
  if (datasets.length === 0) {
    const ds = new Dataset();
    ds.name = 'Data';
    datasets.push(ds);
  }

  const img = findImage(files);
  if (!img) notes.push("This project's image could not be read, so the figure opens without it.");

  return {
    configId: 'xy',
    axes: axes as AnyAxes,
    datasets,
    imageDataURL: img ? `data:${img.mime};base64,${bytesToBase64(img.bytes)}` : null,
    notes,
  };
}
