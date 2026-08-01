import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { sectionsToOds } from '../odsExport.js';
import type { TableSection } from '../tableFormats.js';

/**
 * ODS export.
 *
 * ⚑ What is worth testing here is the STRUCTURE, because "valid ZIP holding
 * plausible XML" and "a spreadsheet application opens it" are different claims.
 * The rule readers actually enforce is the mimetype entry: first in the archive
 * and STORED, sniffed at a fixed byte offset. Get that wrong and the file is a
 * perfectly good ZIP that LibreOffice refuses.
 */

const SECTIONS: TableSection[] = [
  { header: ['x', 'y'], rows: [[1, 2.5], [3, ''], ['n/a', 4]] },
  { title: 'Measurements', header: ['what', 'value'], rows: [['slope', 0.42]] },
];

describe('sectionsToOds', () => {
  it('puts the mimetype FIRST and stores it uncompressed', () => {
    const bytes = sectionsToOds(SECTIONS);
    // The local file header of the first entry starts at 0; its name follows the
    // 30-byte header. A reader sniffs exactly here.
    const name = strFromU8(bytes.subarray(30, 38));
    expect(name).toBe('mimetype');
    // Compression method is bytes 8-9 of the header; 0 = stored.
    expect(bytes[8]! | (bytes[9]! << 8)).toBe(0);
    // ...and the type string sits immediately after the name, uncompressed.
    expect(strFromU8(bytes.subarray(38, 38 + 46))).toBe('application/vnd.oasis.opendocument.spreadsheet');
  });

  it('carries a manifest naming the content', () => {
    const files = unzipSync(sectionsToOds(SECTIONS));
    expect(Object.keys(files)).toContain('META-INF/manifest.xml');
    const manifest = strFromU8(files['META-INF/manifest.xml']!);
    expect(manifest).toContain('application/vnd.oasis.opendocument.spreadsheet');
    expect(manifest).toContain('content.xml');
  });

  it('writes one TABLE per section, named as the section is', () => {
    const content = strFromU8(unzipSync(sectionsToOds(SECTIONS))['content.xml']!);
    expect(content).toContain('table:name="Data"'); // the untitled first section
    expect(content).toContain('table:name="Measurements"');
    expect((content.match(/<table:table /g) ?? [])).toHaveLength(2);
  });

  it('writes numbers as NUMBERS and text as text', () => {
    const content = strFromU8(unzipSync(sectionsToOds(SECTIONS))['content.xml']!);
    expect(content).toContain('office:value-type="float" office:value="2.5"');
    expect(content).toContain('office:value-type="string"><text:p>n/a<');
  });

  it('leaves a blank cell BLANK, never a zero', () => {
    // A cell nobody measured must not arrive as a measurement of zero — the rule
    // the rest of the export already follows for nulls.
    const content = strFromU8(unzipSync(sectionsToOds(SECTIONS))['content.xml']!);
    expect(content).toContain('<table:table-cell/>');
    expect(content).not.toContain('office:value="0"');
  });

  it('escapes XML rather than producing a broken document', () => {
    const content = strFromU8(
      unzipSync(sectionsToOds([{ header: ['a & b', '<x>'], rows: [['"q"', 1]] }]))['content.xml']!
    );
    expect(content).toContain('a &amp; b');
    expect(content).toContain('&lt;x&gt;');
    expect(content).not.toMatch(/<text:p>[^<]*<x>/);
  });

  it('de-duplicates table names, since two sections can share a title', () => {
    const content = strFromU8(
      unzipSync(sectionsToOds([
        { title: 'Fit', header: ['a'], rows: [] },
        { title: 'Fit', header: ['a'], rows: [] },
      ]))['content.xml']!
    );
    expect(content).toContain('table:name="Fit"');
    expect(content).toContain('table:name="Fit (2)"');
  });

  it('re-truncates to the 100-char cap after appending a dedup suffix (v2.0 audit)', () => {
    // A title exactly at the 100-char cap that also collides: the FIRST
    // occurrence is already 100 chars, so the suffix on the second one must
    // shorten the base rather than exceed the cap -- the same re-truncation
    // xlsxExport.ts's own uniqueSheetName already does for its 31-char cap.
    const longTitle = 'F'.repeat(100);
    const content = strFromU8(
      unzipSync(sectionsToOds([
        { title: longTitle, header: ['a'], rows: [] },
        { title: longTitle, header: ['a'], rows: [] },
      ]))['content.xml']!
    );
    const names = [...content.matchAll(/table:name="([^"]*)"/g)].map((m) => m[1]!);
    expect(names).toHaveLength(2);
    expect(names[0]).toBe(longTitle);
    expect(names[1]).not.toBe(names[0]);
    for (const name of names) expect(name.length).toBeLessThanOrEqual(100);
    expect(names[1]).toMatch(/\(2\)$/);
  });
});

/**
 * ⚑ XML 1.0 FORBIDS most control characters OUTRIGHT -- they cannot be escaped,
 * only removed. §2.2 admits only #x9, #xA, #xD and #x20..#xD7FF (plus the higher
 * planes). A \u0001 in a series name is therefore not a cosmetic problem: it makes
 * `content.xml` un-parseable, so a conformant reader rejects the WHOLE workbook
 * rather than one cell. And names are attacker-controlled -- every importer takes
 * them verbatim from someone else's project file (see tableFormats' own
 * identifier tests) -- so this is reachable without the user typing anything.
 */
describe('sectionsToOds and characters XML cannot carry', () => {
  // Everything XML 1.0 forbids below U+0020, plus DEL and the C1 block.
  // Matching control characters IS the job here. The no-control-regex rule
  // exists to catch them written into a pattern by accident; this is the exact
  // set XML 1.0 §2.2 excludes from its Char set.
  // eslint-disable-next-line no-control-regex
  const ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

  it('emits no XML-illegal control character, wherever the name came from', () => {
    const nasty = 'Trial\u0000A\u0001 \u001fB\u0007';
    const files = unzipSync(
      sectionsToOds([{ title: nasty, header: ['x', nasty], rows: [[nasty, 1]] }])
    );
    const xml = strFromU8(files['content.xml']!);
    expect(xml).not.toMatch(ILLEGAL);
  });

  it('KEEPS tab, newline and carriage return, which XML does allow', () => {
    const files = unzipSync(sectionsToOds([{ header: ['x'], rows: [['a\tb\nc\rd']] }]));
    const xml = strFromU8(files['content.xml']!);
    // Stripping these as well would silently destroy legitimate text. The rule
    // has to remove exactly what the spec forbids and nothing more.
    expect(xml).toContain('a\tb\nc\rd');
  });

  it('still renders the readable part of a name that carried one', () => {
    const files = unzipSync(
      sectionsToOds([{ title: 'Se\u0001ries', header: ['x'], rows: [[1]] }])
    );
    const xml = strFromU8(files['content.xml']!);
    // Dropped, not replaced by a substitute glyph: a name is a label the user
    // typed, and inventing a character in it would be a different kind of lie.
    expect(xml).toContain('Series');
  });
});
