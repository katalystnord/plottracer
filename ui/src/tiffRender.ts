/**
 * TIFF rendering (B7) — the multipage-scan sibling of pdfRender.ts.
 *
 * Chromium's <img> cannot decode TIFF, so — exactly like PDF — a TIFF is decoded
 * to a raster here (UTIF, MIT) and fed in as an image. A multipage TIFF is one
 * `LoadedDocument` with N pages; a single-page TIFF is the same shape with one.
 * Historic scientific / engineering scans are commonly (multipage) TIFF, which is
 * why this lands in v0.9. Renderer-only (needs a DOM canvas), like pdfRender.
 *
 * UTIF.decode parses only the page directories (fast, no pixel work); the actual
 * pixel decode (decodeImage → toRGBA8) is deferred to renderPage, so only the
 * pages a user visits are decompressed — the same lazy shape pdf.js gives us.
 */
import * as UTIF from 'utif2';
import type { LoadedDocument } from './pagedDocument.js';

export function loadTiff(bytes: Uint8Array): LoadedDocument {
  // UTIF wants a standalone ArrayBuffer; slice() gives an exactly-sized copy, so a
  // Uint8Array that is a view with a byte offset can't feed it stray bytes. Kept
  // for the lazy per-page decodeImage below.
  const buffer = bytes.slice().buffer;
  const ifds = UTIF.decode(buffer);
  if (ifds.length === 0) throw new Error('No images found in this TIFF.');
  return {
    pageCount: ifds.length,
    async renderPage(n: number): Promise<string> {
      const ifd = ifds[n - 1];
      if (!ifd) throw new Error(`TIFF has no page ${n}.`);
      UTIF.decodeImage(buffer, ifd); // fills ifd.width/height/data
      const rgba = UTIF.toRGBA8(ifd); // RGBA8, ready for putImageData
      const canvas = document.createElement('canvas');
      canvas.width = ifd.width;
      canvas.height = ifd.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get a 2D context to render the TIFF page.');
      const img = ctx.createImageData(ifd.width, ifd.height);
      img.data.set(rgba);
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL('image/png');
    },
    destroy() {
      // UTIF holds no external resources (unlike pdf.js's worker); the decoded IFDs
      // are released with this closure. Present to satisfy LoadedDocument.
    },
  };
}
