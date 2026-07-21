/**
 * Project container (`.zip`) — checkpoint 94, see CLAUDE.md and
 * docs/project-container-design.md.
 *
 * Checkpoint 25's project file was a single JSON blob with the image inlined as
 * a base64 data URL (see engine/projectFile.ts). That is honest but not
 * inspectable — the design doc's §4 makes the case: the image is a megabyte of
 * base64 buried in JSON, so "it's plain text" is technically true and
 * practically worthless. This module packages the same ProjectFile as a `.zip`
 * holding a readable `project.json` plus the image as a *real* file entry
 * (`image.png`/`.jpg`/...), which is both more inspectable (double-click to
 * browse on every desktop OS) and 33% smaller (no base64 tax).
 *
 * Deliberately additive, not a rewrite: the (de)serialization of the
 * calibration/dataset half stays entirely in engine/projectFile.ts +
 * core/plotData.ts. This module only splits the image out of / folds it back
 * into a ProjectFile, then hands off to the exact same deserializeProject the
 * JSON path uses — one deserialization path, not two (the "parallel path"
 * smell the tenet audit warns about).
 *
 * WHY zip and not tar (the design doc's §4, and checkpoint 74's import/export
 * split): a WPD `.tar` is someone else's bytes we must read faithfully, and
 * hand-rolling its fixed-width headers was correct. Our own export need only
 * make sense, and a zip is browsable-by-double-click everywhere (tar only
 * reached Windows Explorer in Windows 11). fflate (tiny, MIT) does the real
 * read+write a hand-rolled zip would get wrong.
 *
 * DETECT BY CONTENT, NEVER THE FILENAME (§5a): users rename files, so open
 * decides zip-vs-legacy-JSON from the leading bytes (`isZipContainer`), the
 * same discipline as checkpoint 74's tar reader finding `info.json` rather than
 * trusting the folder name. This is also how old `.json` projects keep opening
 * (design blocker #3): a JSON project starts with `{`, not the zip magic.
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  deserializeProject,
  deserializeMultiFigureProject,
  isMultiFigureProject,
  type ProjectFile,
  type DeserializedProject,
  type ProjectResult,
  type FigureFile,
  type MultiFigureProjectFile,
  type DeserializedMultiFigureProject,
} from './projectFile.js';

/** The one project.json entry name inside every container. Fixed, so the reader
 * finds it by name rather than guessing (§5a's "detect by content" applies to
 * whole-file type, not to entries within a container we wrote ourselves). */
const PROJECT_ENTRY = 'project.json';

/**
 * The image record inside a container's `project.json`. The bytes live in a
 * separate zip entry (a real, browsable image file), so instead of `dataURL`
 * we store where to find them (`path`) and how to re-form the data URL on read
 * (`mime`). `mime` is stored rather than re-guessed from the extension so
 * reconstruction is exact regardless of how the extension was chosen.
 */
interface ContainerImageRef {
  path: string;
  mime: string;
  fileName?: string;
}

/** A bundled source document's reference inside project.json (checkpoint 104):
 * the bytes live in a sibling zip entry, this says where and what. */
interface ContainerSourceRef {
  path: string;
  mime: string;
  name?: string;
}

/** What `project.json` actually holds: a ProjectFile with its inlined image
 * replaced by a reference to a sibling zip entry, plus (checkpoint 104) an
 * optional reference to a bundled source document. `sourceDocument` on the
 * in-memory ProjectFile is the raw bytes; here it's a reference. */
type ContainerJson = Omit<ProjectFile, 'image' | 'sourceDocument'> & {
  image: ContainerImageRef;
  sourceDocument?: ContainerSourceRef;
};

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'application/pdf': return 'pdf';
    case 'image/tiff': return 'tiff';
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/bmp': return 'bmp';
    case 'image/webp': return 'webp';
    case 'image/svg+xml': return 'svg';
    // Unknown types still round-trip: the mime is stored in project.json, so a
    // `.bin` entry re-forms the exact same data URL on read.
    default: return 'bin';
  }
}

/**
 * base64 <-> bytes, needed to move the image between its inlined-data-URL form
 * (in a ProjectFile) and its raw-bytes form (a zip entry). `atob`/`btoa` are
 * global in both the Electron renderer and Node 24 (where the unit tests run),
 * so this stays framework-free. btoa's argument is chunked because spreading a
 * multi-megabyte byte array into String.fromCharCode overflows the call stack.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Splits `data:<mime>;base64,<payload>`. Returns null for anything that is not
 * a base64 data URL — which is all the canvas/image loader ever produce. */
function parseDataURL(dataURL: string): { mime: string; b64: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataURL);
  if (!m) return null;
  return { mime: m[1]!, b64: m[2]! };
}

/**
 * ZIP local-file-header magic — "PK\x03\x04". A project file starting with this
 * is a container; a legacy JSON project starts with `{`. This is the whole
 * backward-compatibility story: open reads bytes, checks this, and routes.
 */
export function isZipContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Builds a `.zip` project from a ProjectFile: a readable `project.json` plus the
 * image as a real file entry. Returns {error} only if the image is not a base64
 * data URL we can split out (it always is, in practice — the canvas and loader
 * produce nothing else).
 */
export function serializeProjectZip(file: ProjectFile): ProjectResult<Uint8Array> {
  const parsed = parseDataURL(file.image.dataURL);
  if (!parsed) return { error: 'Could not package the image for the project archive.' };
  const imagePath = `image.${mimeToExt(parsed.mime)}`;
  const { sourceDocument, ...rest } = file;
  const json: ContainerJson = {
    ...rest,
    image: { path: imagePath, mime: parsed.mime, ...(file.image.fileName ? { fileName: file.image.fileName } : {}) },
  };
  const entries: Record<string, Uint8Array> = {
    [imagePath]: base64ToBytes(parsed.b64),
  };
  // Bundle the source document (e.g. the PDF, checkpoint 104) as a real file
  // entry so the evidence travels with the record and is checkable by anyone
  // who opens the archive (§5). References it from project.json.
  if (sourceDocument) {
    const srcPath = `source.${mimeToExt(sourceDocument.mime)}`;
    entries[srcPath] = sourceDocument.bytes;
    json.sourceDocument = { path: srcPath, mime: sourceDocument.mime, ...(sourceDocument.name ? { name: sourceDocument.name } : {}) };
  }
  entries[PROJECT_ENTRY] = strToU8(JSON.stringify(json));
  return zipSync(entries);
}

/**
 * Reads a `.zip` project back into the same DeserializedProject shape the JSON
 * path produces: reconstitutes the inlined data URL from the image entry and
 * hands off to deserializeProject, so the two open paths converge immediately.
 */
export function deserializeProjectZip(bytes: Uint8Array): ProjectResult<DeserializedProject> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return { error: 'Could not open project — the archive is unreadable.' };
  }
  const jsonBytes = files[PROJECT_ENTRY];
  if (!jsonBytes) return { error: 'Not a PlotTracer project archive (no project.json).' };
  let json: ContainerJson;
  try {
    json = JSON.parse(strFromU8(jsonBytes)) as ContainerJson;
  } catch {
    return { error: 'Could not open project — project.json is not valid JSON.' };
  }
  const ref = json.image as ContainerImageRef | undefined;
  if (!ref?.path || typeof ref.mime !== 'string') {
    return { error: 'Project archive is missing its image reference.' };
  }
  const imgBytes = files[ref.path];
  if (!imgBytes) return { error: `Project archive is missing its image (${ref.path}).` };
  const dataURL = `data:${ref.mime};base64,${bytesToBase64(imgBytes)}`;
  // `sourceDocument` in project.json is a REFERENCE (path/mime); the ProjectFile
  // wants raw bytes, so drop the ref here and restore the bytes below.
  const { sourceDocument: srcRef, ...jsonRest } = json;
  const full: ProjectFile = {
    ...jsonRest,
    image: ref.fileName ? { dataURL, fileName: ref.fileName } : { dataURL },
  };
  const result = deserializeProject(full);
  if ('error' in result) return result;
  // Restore the bundled source document (checkpoint 104), if present and its
  // entry is really there. A malformed reference is dropped, not fatal.
  const src = srcRef;
  if (src?.path && typeof src.mime === 'string' && files[src.path]) {
    result.sourceDocument = { mime: src.mime, bytes: files[src.path]!, ...(src.name ? { name: src.name } : {}) };
  }
  return result;
}

// === Multi-figure containers (checkpoint 115) ==============================
//
// Same machinery as the single-figure container, one level up: each figure's
// image becomes a real entry under figures/<n>/, the ONE shared source document
// its own entry, and project.json holds the array with image refs. Built on the
// per-figure serializeMultiFigureProject/deserializeMultiFigureProject, so there
// is still exactly one calibration/dataset (de)serialization path.

/** project.json for a multi-figure container: each figure's inlined image is
 * replaced by a reference to its own entry; the shared source likewise. */
type MultiFigureContainerJson = Omit<MultiFigureProjectFile, 'figures' | 'sourceDocument'> & {
  figures: Array<Omit<FigureFile, 'image'> & { image: ContainerImageRef }>;
  sourceDocument?: ContainerSourceRef;
};

export function serializeMultiFigureZip(file: MultiFigureProjectFile): ProjectResult<Uint8Array> {
  const entries: Record<string, Uint8Array> = {};
  const jsonFigures: MultiFigureContainerJson['figures'] = [];
  file.figures.forEach((fig, i) => {
    const parsed = parseDataURL(fig.image.dataURL);
    if (!parsed) throw new Error(`Could not package figure ${i + 1}'s image.`);
    const imagePath = `figures/${i}/image.${mimeToExt(parsed.mime)}`;
    entries[imagePath] = base64ToBytes(parsed.b64);
    const { image, ...rest } = fig;
    jsonFigures.push({
      ...rest,
      image: { path: imagePath, mime: parsed.mime, ...(image.fileName ? { fileName: image.fileName } : {}) },
    });
  });
  const { figures: _f, sourceDocument, ...top } = file;
  const json: MultiFigureContainerJson = { ...top, figures: jsonFigures };
  if (sourceDocument) {
    const srcPath = `source.${mimeToExt(sourceDocument.mime)}`;
    entries[srcPath] = sourceDocument.bytes;
    json.sourceDocument = { path: srcPath, mime: sourceDocument.mime, ...(sourceDocument.name ? { name: sourceDocument.name } : {}) };
  }
  entries[PROJECT_ENTRY] = strToU8(JSON.stringify(json));
  try {
    return zipSync(entries);
  } catch {
    return { error: 'Could not package the project archive.' };
  }
}

export function deserializeMultiFigureZip(bytes: Uint8Array): ProjectResult<DeserializedMultiFigureProject> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return { error: 'Could not open project — the archive is unreadable.' };
  }
  const jsonBytes = files[PROJECT_ENTRY];
  if (!jsonBytes) return { error: 'Not a PlotTracer project archive (no project.json).' };
  let json: MultiFigureContainerJson;
  try {
    json = JSON.parse(strFromU8(jsonBytes)) as MultiFigureContainerJson;
  } catch {
    return { error: 'Could not open project — project.json is not valid JSON.' };
  }
  if (!Array.isArray(json.figures)) return { error: 'Project archive is not a multi-figure project.' };
  // Fold each figure's image entry back into an inlined data URL.
  const figures: FigureFile[] = [];
  for (const fig of json.figures) {
    const ref = fig.image as ContainerImageRef | undefined;
    if (!ref?.path || typeof ref.mime !== 'string') return { error: 'A figure is missing its image reference.' };
    const imgBytes = files[ref.path];
    if (!imgBytes) return { error: `Project archive is missing a figure image (${ref.path}).` };
    const dataURL = `data:${ref.mime};base64,${bytesToBase64(imgBytes)}`;
    const { image: _image, ...rest } = fig;
    figures.push({ ...rest, image: ref.fileName ? { dataURL, fileName: ref.fileName } : { dataURL } });
  }
  const { sourceDocument: srcRef, figures: _f, ...top } = json;
  const full: MultiFigureProjectFile = { ...top, figures };
  const result = deserializeMultiFigureProject(full);
  if ('error' in result) return result;
  // Restore the shared source document bytes, if the archive carried one.
  if (srcRef?.path && typeof srcRef.mime === 'string' && files[srcRef.path]) {
    result.sourceDocument = { mime: srcRef.mime, bytes: files[srcRef.path]!, ...(srcRef.name ? { name: srcRef.name } : {}) };
  }
  return result;
}

/** Peek inside a `.zip` container to decide single-vs-multi, so the one open
 * path can route. Returns false (treat as single) if the archive can't be read
 * -- deserialize will then surface the real error. */
export function isMultiFigureContainer(bytes: Uint8Array): boolean {
  try {
    const files = unzipSync(bytes);
    const jsonBytes = files[PROJECT_ENTRY];
    if (!jsonBytes) return false;
    return isMultiFigureProject(JSON.parse(strFromU8(jsonBytes)));
  } catch {
    return false;
  }
}
