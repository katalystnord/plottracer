/**
 * The shared "paged raster source" abstraction (B7).
 *
 * Some sources <img> cannot decode directly and must be rasterized first, one
 * page at a time: PDF (pdf.js — ui/src/pdfRender.ts) and TIFF, including multipage
 * TIFF (UTIF — ui/src/tiffRender.ts). Historic scientific/engineering scans are
 * exactly these multipage formats. Both decoders return this same shape, so the
 * page pager, "Extract another figure from source", source-bundling in the project
 * container, and page provenance are all format-agnostic: one abstraction, N
 * decoders (no per-format special-casing).
 *
 * Type-only — importing this file pulls in no runtime, so a session that never
 * opens a paged document never loads pdf.js / UTIF (each renderer is dynamically
 * imported only when that format is actually opened).
 */
export interface LoadedDocument {
  /** Number of pages (1 for a single-page TIFF; N for a PDF / multipage TIFF). */
  pageCount: number;
  /** Render page `n` (1-based) to a `data:image/png` URL. Lazy — only the pages
   * a user actually visits are rasterized. */
  renderPage(n: number): Promise<string>;
  /** Release the decoder's resources. */
  destroy(): void;
}
