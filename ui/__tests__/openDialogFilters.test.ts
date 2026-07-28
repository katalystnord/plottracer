import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The dialog must never offer a format the loader cannot decode.
 *
 * Checkpoint 65 established this: offering `tiff`/`pdf` was a **hidden
 * failure** — the native dialog listed them, Chromium's `<img>` decoder
 * couldn't read them, and the user got a blank canvas. That checkpoint pared
 * the filter back to formats that genuinely decode.
 *
 * It then regressed on 2026-07-15: `pdf` was added to the filter in
 * anticipation of pdf.js, the pdf.js work was parked, and the filter shipped
 * and was pushed. The dialog offered PDF; the app answered "PDF isn't supported
 * yet". The comment above the filter even cited `engine/pdfLoad.ts`, a file
 * that had never been committed. **The whole 122-test e2e suite was green
 * throughout, because nothing asserted this.**
 *
 * Hence this file. The invariant is a *cross-file agreement* between the main
 * process's dialog filter and the renderer's own statement of what it can
 * decode, so it is checked by reading both — a running app cannot be asked
 * "what would you offer?" without a dialog, and the two constants live either
 * side of the IPC boundary.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');

/** The extensions the native Open dialog offers (main process). */
function dialogExtensions(): string[] {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'ui/electron-ipc.cjs'), 'utf8');
  const block = src.match(/const IMAGE_FILTERS = \[([\s\S]*?)\n\]/);
  if (!block) throw new Error('IMAGE_FILTERS not found in ui/electron-ipc.cjs');
  // First entry only: the second is the deliberate "All Files" escape hatch.
  const first = block[1]!.match(/extensions: \[([^\]]*)\]/);
  if (!first) throw new Error('no extensions array in IMAGE_FILTERS');
  return first[1]!.split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

/** The formats the renderer tells the user it can read (SUPPORTED_IMAGE_FORMATS). */
function declaredFormats(): string[] {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'ui/src/ImageCanvas.tsx'), 'utf8');
  const m = src.match(/SUPPORTED_IMAGE_FORMATS = '([^']+)'/);
  if (!m) throw new Error('SUPPORTED_IMAGE_FORMATS not found in ui/src/ImageCanvas.tsx');
  return m[1]!.split(',').map((s) => s.trim().toLowerCase());
}

describe('Open dialog filters (checkpoint 65 invariant)', () => {
  it('offers only formats the app tells the user it can read', () => {
    const offered = new Set(dialogExtensions());
    const declared = new Set(declaredFormats());
    // jpg/jpeg and tif/tiff are each one format with two extensions; the
    // user-facing list names each once (JPG, TIFF), so drop the aliases.
    offered.delete('jpeg');
    offered.delete('tif');
    expect([...offered].sort()).toEqual([...declared].sort());
  });

  it('offers pdf AND tiff now that both genuinely open', () => {
    // Checkpoint 96 lifted the ckpt-65 embargo on pdf (renders via pdf.js); B7
    // lifted it on tiff (decodes via UTIF -- ui/src/tiffRender.ts, single and
    // multipage). The rule is unchanged: offer a format only once it actually
    // decodes. Both now do, so both are offered.
    const offered = dialogExtensions();
    expect(offered).toContain('pdf');
    expect(offered).toContain('tif');
    expect(offered).toContain('tiff');
  });

  it('MIME-types every format it can open (pdf as application/pdf, tiff as image/tiff)', () => {
    // A PDF must arrive as data:application/pdf so ImageCanvas routes it to the
    // pdf.js path (checkpoint 96); a TIFF as data:image/tiff. Routing is by
    // CONTENT now (pagedDocumentFormat, B7), so the mime is for a correct data
    // URL rather than the routing decision -- but it should still be accurate.
    const src = fs.readFileSync(path.join(REPO_ROOT, 'ui/electron-ipc.cjs'), 'utf8');
    const mime = src.match(/const MIME = \{([\s\S]*?)\n\}/);
    expect(mime).not.toBeNull();
    expect(mime![1]).toMatch(/pdf: 'application\/pdf'/);
    expect(mime![1]).toMatch(/tiff: 'image\/tiff'/);
  });
});

/**
 * The same invariant, one door along: the Open PROJECT dialog must not offer a
 * format no importer claims, and must not omit one that works.
 *
 * The extension list is duplicated by necessity — engine/importRegistry.ts is
 * the real list, and ui/electron-ipc.cjs is the main process, which cannot
 * import the renderer's TypeScript. A duplicated constant with no test is
 * exactly how the pdf regression above shipped, so the agreement is asserted by
 * reading both sides.
 */
describe('Open PROJECT dialog filters', () => {
  /** The extensions the native Open Project dialog offers (main process). */
  function projectDialogExtensions(): string[] {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'ui/electron-ipc.cjs'), 'utf8');
    const block = src.match(/const PROJECT_FILTERS = \[([\s\S]*?)\n\]/);
    if (!block) throw new Error('PROJECT_FILTERS not found in ui/electron-ipc.cjs');
    // First entry only; the second is the deliberate "All Files" escape hatch,
    // which is what lets a renamed project still be opened.
    const first = block[1]!.match(/extensions: \[([^\]]*)\]/);
    if (!first) throw new Error('no extensions array in PROJECT_FILTERS');
    return first[1]!.split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  }

  it('offers exactly the extensions the import registry knows', async () => {
    const { importDialogExtensions } = await import('../../engine/importRegistry.js');
    expect(projectDialogExtensions().sort()).toEqual(importDialogExtensions().sort());
  });

  it('keeps the All Files escape hatch, because the FILE decides, not its name', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'ui/electron-ipc.cjs'), 'utf8');
    const block = src.match(/const PROJECT_FILTERS = \[([\s\S]*?)\n\]/);
    expect(block![1]).toMatch(/All Files/);
  });
});
