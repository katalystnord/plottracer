/**
 * PDF rendering (checkpoint 96, see CLAUDE.md and
 * docs/project-container-design.md §3).
 *
 * Chromium's <img> decodes every raster/vector format PlotTracer opens (PNG,
 * JPG, GIF, BMP, WEBP, SVG) — so those load straight through
 * ImageCanvas.loadImageFromSrc. PDF is the exception: <img> cannot decode it,
 * so a PDF has to be *rendered* to a canvas first (pdf.js) and the resulting
 * raster fed in like any other image. That render needs a DOM canvas and a
 * worker, so this module is renderer-only (unlike engine/, which is Node-
 * testable) — it is exercised by the e2e suite driving the real app, not unit
 * tests. This is the general shape for any browser-undecodable format (PDF now,
 * TIFF if it ever lands): render → rasterize → treat as an image.
 *
 * pdf.js needs its worker. Vite's `?worker` import bundles pdf.worker as a
 * classic (IIFE) worker, which is what loads correctly under Electron's file://
 * production build — a module-worker URL does not. GlobalWorkerOptions.workerPort
 * takes the constructed worker directly, so there is no runtime path to guess.
 *
 * RESOLUTION (raised at checkpoint 99, after the post-v0.4 audit's T3). We
 * render the whole PAGE (we don't know where the figure is), targeting ~3000px
 * on the page's longest side. Be honest about what that buys: a figure occupies
 * only a FRACTION of a page, so it gets a fraction of that budget — a half-page
 * figure ~1500px, a quarter-page ~750px. This is a *digitizer*; under-resolving
 * the raster silently caps trace precision (the vector source could be
 * re-rasterized arbitrarily fine, the same concern SVG has, except here we
 * choose the resolution). Validated on a real Nature-paper figure 2026-07-18:
 * at the old 2000px target a half-page figure got ~730px and traced but softly;
 * ~1500px is visibly crisper for point placement. The target still leaves a
 * (higher) fixed ceiling for very small insets — a user-controllable quality, or
 * re-rendering a cropped region from the vector source, is the fuller fix.
 */

import * as pdfjs from 'pdfjs-dist';
// Vite `?worker` virtual module: bundles pdf.worker as a classic (IIFE) worker.
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import type { LoadedDocument } from './pagedDocument.js';

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

/** Target ~3000px on the page's longest side (checkpoint 99, up from 2000).
 * Clamped: never below 1.5× (a huge page stays sane) nor above 6× (a small /
 * figure-only PDF shouldn't blow up memory). For a standard ~800pt page this
 * gives ~3.7×, so the target governs and MAX rarely binds; MAX only caps small
 * pages that would otherwise scale past it. A 3000px-longest page is ~6–9M
 * pixels — a few MB as a PNG, which is what the baked image / project carries. */
const TARGET_LONGEST_PX = 3000;
const MIN_SCALE = 1.5;
const MAX_SCALE = 6;

// PDF detection lives in engine/pdfDetect.ts (isPdfBytes) -- kept out of this
// module because importing this file constructs the pdf.js worker, and the
// detection check runs on every dropped/pasted file before any render.

/** A parsed PDF is a LoadedDocument (the shared paged-source shape — B7): its page
 * count, plus lazy per-page rendering. Kept open (in a ref by the caller) so
 * flipping pages doesn't re-parse the document. */
export async function loadPdf(bytes: Uint8Array): Promise<LoadedDocument> {
  // pdf.js can transfer/detach the buffer it's given; hand it a copy so the
  // caller's bytes (which may still be needed, e.g. to re-detect) stay intact.
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  return {
    pageCount: doc.numPages,
    async renderPage(n: number): Promise<string> {
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const longest = Math.max(unit.width, unit.height);
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, TARGET_LONGEST_PX / longest));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get a 2D context to render the PDF page.');
      // White backing: PDF pages are transparent where nothing is drawn, but a
      // digitized figure wants an opaque white page like the printed original.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL('image/png');
    },
    destroy() {
      void doc.destroy();
    },
  };
}
