/**
 * Minimal USTAR reader — enough to open a WebPlotDigitizer `.tar` project
 * (checkpoint 74).
 *
 * **Why we read tar at all.** A bare WPD `.json` carries **no image** —
 * confirmed across every upstream fixture (`wpd-core/tests/files/*.json` are
 * all `{version, axesColl, datasetColl, measurementColl}` with no image key).
 * WPD's own "Download Project File (.tar)" is the image-bearing format:
 * `<name>/info.json` + `<name>/wpd.json` + the image files
 * (`services/saveResume.js:68-86`). So importing a real user's project means
 * reading tar.
 *
 * **Why not a library.** WPD uses `tarballjs`, declared as a **git URL**
 * (`wpd-core/package.json`: `"https://github.com/ankitrohatgi/tarballjs.git#v1.0"`).
 * We only need *read*, tar is a simple fixed-width format, and a pure
 * dependency-free reader is headless and reusable by a future batch pipeline —
 * so this is ~80 lines instead of a git dependency.
 *
 * Scope: read-only, and only what a WPD project uses — regular files and
 * directories in USTAR. GNU long names (`@LongLink`), sparse files, PAX
 * extended headers and compression are **not** supported; a `.tar.gz` will not
 * open. WPD writes plain uncompressed tar, so that is sufficient — and
 * unsupported entries are reported rather than silently skipped.
 */

/** One entry from the archive. */
export interface TarEntry {
  /** Full path as stored, e.g. "myproject/wpd.json". */
  name: string;
  type: 'file' | 'directory';
  /** File contents. Empty for a directory. */
  data: Uint8Array;
}

const BLOCK = 512;

/**
 * Reads a NUL-terminated ASCII field — used for names.
 *
 * **Only NUL terminates.** A space is a legitimate filename character
 * ("my paper fig3/wpd.json" is an ordinary WPD project name), and treating
 * 0x20 as a terminator silently truncates such a name to "my" — which reads as
 * a corrupt archive rather than an error. Numeric fields are space-padded and
 * are handled by readOctal, which trims instead.
 */
function readString(buf: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = offset + length;
  while (end < limit && buf[end] !== 0) end++;
  return new TextDecoder('utf-8').decode(buf.subarray(offset, end));
}

/**
 * Reads tar's octal number fields (size, mode, ...).
 *
 * Returns 0 for an empty field, which is correct: directories and end-of-
 * archive blocks legitimately carry no size.
 */
function readOctal(buf: Uint8Array, offset: number, length: number): number {
  // Numeric fields are NUL- *and* space-padded, so trim both.
  const s = readString(buf, offset, length).replace(/\0/g, '').trim();
  if (s === '') return 0;
  const n = parseInt(s, 8);
  return Number.isFinite(n) ? n : 0;
}

/** True when the 512-byte block at `offset` is all zeros — tar's end marker. */
function isZeroBlock(buf: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + BLOCK && i < buf.length; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

/**
 * Parse a tar archive into its entries.
 *
 * Throws on a malformed archive rather than returning a partial result: a
 * half-read project would surface later as mysteriously missing data, and this
 * is the import path for someone else's file — the one place to be strict.
 */
export function readTar(bytes: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + BLOCK <= bytes.length) {
    // Two consecutive zero blocks mark the end; one is enough to stop on, since
    // no real header begins with a NUL name.
    if (isZeroBlock(bytes, offset)) break;

    const name = readString(bytes, offset, 100);
    const size = readOctal(bytes, offset + 124, 12);
    const typeflag = String.fromCharCode(bytes[offset + 156] ?? 0);
    // USTAR splits long paths across prefix(345,155) + name(0,100).
    const prefix = readString(bytes, offset + 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;

    if (name === '') throw new Error('Malformed tar: header with an empty name.');
    // '0' and '\0' are both "regular file" in the wild; '5' is a directory.
    const isDir = typeflag === '5' || fullName.endsWith('/');
    const isFile = typeflag === '0' || typeflag === '\0' || typeflag === '';
    if (!isDir && !isFile) {
      throw new Error(
        `Unsupported tar entry "${fullName}" (type '${typeflag}') — this reader handles plain files and directories only.`
      );
    }

    const dataStart = offset + BLOCK;
    if (dataStart + size > bytes.length) {
      throw new Error(`Malformed tar: "${fullName}" claims ${size} bytes but the archive ends first.`);
    }

    entries.push({
      name: fullName,
      type: isDir ? 'directory' : 'file',
      data: isDir ? new Uint8Array(0) : bytes.subarray(dataStart, dataStart + size),
    });

    // Data is padded up to the next 512-byte boundary.
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  return entries;
}

/** Decode an entry's bytes as UTF-8 text (for info.json / wpd.json). */
export function entryText(entry: TarEntry): string {
  return new TextDecoder('utf-8').decode(entry.data);
}
