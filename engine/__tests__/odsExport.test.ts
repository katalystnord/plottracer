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
});
