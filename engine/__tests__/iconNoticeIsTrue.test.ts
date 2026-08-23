import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * ⚑⚑ THE NOTICE IS A LEGAL CLAIM, SO IT GETS A TEST (v2.3, C1).
 *
 * `icons/NOTICE` ships inside the app because Apache-2.0 section 4(d) requires
 * it, and it used to say the Ketcher glyphs are *"used unmodified except where
 * noted in ui-patches/overrides.js"* - a file deleted 2026-07-19. So the one
 * sentence carrying the modification disclosure pointed at nothing, and three
 * glyphs really had been resized.
 *
 * That is CLAUDE.md's third gate on a licence file: a document asserting what
 * the tree contains is false evidence of compliance until something checks it.
 * The NOTICE now names the three modified files, and this test is what keeps
 * that list honest - resize a fourth glyph and the NOTICE stops being true, so
 * this goes red rather than the disclosure going quietly stale.
 *
 * ⚑ WHAT IT CAN AND CANNOT SEE. The detectable modification is a `width`/`height`
 * that disagrees with the `viewBox` on a glyph drawn at one of Ketcher's own box
 * sizes: the normalization changed the rendered size and nothing else. This
 * cannot tell whether a path was edited to look different - only git history can,
 * and it says no file here has been touched since import. The claim in the
 * NOTICE is worded to match exactly that reach.
 *
 * ⚠️⚑⚑ AND THE HOUSE-SIZE QUALIFIER IS LOAD-BEARING, because the first version of
 * this test without it reported a FOURTH modified file and it was wrong.
 * `zoom-reset.svg` declares `width="16"` on a `viewBox="0 0 1024 1024"`, which
 * looks exactly like our normalization and is not ours at all: fetched from
 * upstream, `epam/ketcher@master/.../icons/files/zoom-reset.svg` is byte-for-byte
 * this file, iconfont.cn export artifacts and all. EPAM shipped it that way.
 * ▶ A markup style is not a provenance measurement. The mismatch had to be read
 * against what Ketcher ACTUALLY ships, not against what its other files look
 * like - see [[feedback_measure_and_report_not_interpret]]. So the box sizes
 * below are the set Ketcher draws its own glyphs at, and anything outside it is
 * upstream's business rather than a modification of ours.
 */

const ICONS = path.join(import.meta.dirname, '..', '..', 'icons');

/** The glyphs the NOTICE says were resized. */
const RESIZED = ['erase.svg', 'select-lasso.svg', 'select-rectangle.svg'];

/**
 * The box sizes Ketcher draws its own glyphs at. A glyph outside this set is
 * upstream's own oddity (see the header on `zoom-reset.svg`), so a rendered size
 * that disagrees with such a box says nothing about what we changed.
 */
const KETCHER_BOX_SIZES = ['16x16', '18x18', '24x24', '48x48'];

/** `width`/`height`/`viewBox` off an SVG's opening tag, where it states them. */
function declaredSizes(svg: string): { rendered: string | null; box: string | null } {
  const w = /width="(\d+)"/.exec(svg);
  const h = /height="(\d+)"/.exec(svg);
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  return {
    rendered: w && h ? `${w[1]}x${h[1]}` : null,
    box: vb ? `${vb[1]}x${vb[2]}` : null,
  };
}

describe('the icon NOTICE says what the tree actually contains', () => {
  const ketcherGlyphs = readdirSync(ICONS).filter((f) => f.endsWith('.svg'));
  const notice = readFileSync(path.join(ICONS, 'NOTICE'), 'utf-8');

  it('⚑ the glyphs whose rendered size was changed are EXACTLY the ones it names', () => {
    const changed = ketcherGlyphs.filter((f) => {
      const { rendered, box } = declaredSizes(readFileSync(path.join(ICONS, f), 'utf-8'));
      if (rendered === null || box === null) return false;
      if (!KETCHER_BOX_SIZES.includes(box)) return false;
      return rendered !== box;
    });
    expect(changed.sort()).toEqual([...RESIZED].sort());
  });

  it('⚑ it names each one, so a reader can check the disclosure against the file', () => {
    for (const f of RESIZED) expect(notice).toContain(f);
  });

  it('⚑⚑ it no longer points at a path that does not exist', () => {
    // The whole defect: a modification disclosure whose only detail lived in a
    // file deleted two releases ago. `ui-patches/` is gone from the tree.
    expect(notice).not.toContain('ui-patches');
  });

  it('⚑ it still carries the section 4(d) attribution it exists for', () => {
    expect(notice).toContain('Ketcher');
    expect(notice).toContain('EPAM Systems');
    expect(notice).toContain('Apache License');
  });
});
