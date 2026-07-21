/**
 * Paged-document content detection (checkpoint 98; TIFF added B7) — pure,
 * dependency-free magic-byte checks, deliberately kept OUT of the renderers.
 *
 * The renderers (ui/src/pdfRender.ts, tiffRender.ts) construct a pdf.js worker /
 * pull in UTIF, so each is lazy-imported only when that format is actually opened.
 * These checks run on EVERY dropped/pasted file to decide the format, long before
 * any rendering — so they must not drag those in. Living here, they're free to
 * import anywhere (and unit-testable in Node, unlike the renderer-only modules).
 *
 * Detect by content, not extension/mime: a PDF saved as `figure.png`, or dragged
 * from a file manager that reports a wrong type, still opens — the same
 * discipline as the zip container's isZipContainer (checkpoint 94).
 */

/** True if these bytes begin with the PDF signature "%PDF". */
export function isPdfBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 // F
  );
}

/** True if these bytes begin with a TIFF signature: little-endian "II*\0" or
 * big-endian "MM\0*" (B7). Covers single-page and multipage TIFF alike — the page
 * count only shows up once UTIF parses the directories. (A DNG/BigTIFF variant uses
 * version 43, not 42; standard scan TIFFs are version 42, which is what UTIF reads.) */
export function isTiffBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00;
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a;
  return littleEndian || bigEndian;
}

/** The paged-document format of these bytes, or null if <img> can decode them
 * directly (a plain raster) — the single dispatch point the canvas + Workspace
 * use to route to the right renderer. */
export function pagedDocumentFormat(bytes: Uint8Array): 'pdf' | 'tiff' | null {
  if (isPdfBytes(bytes)) return 'pdf';
  if (isTiffBytes(bytes)) return 'tiff';
  return null;
}
