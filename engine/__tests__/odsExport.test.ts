import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { sectionsToOds } from '../odsExport.js';
import type { Cell, TableSection } from '../tableFormats.js';

const partOf = (sections: readonly TableSection[], name: string): string =>
  strFromU8(unzipSync(sectionsToOds(sections))[name]!);
const contentOf = (sections: readonly TableSection[]): string => partOf(sections, 'content.xml');

/**
 * ⚑ Substring assertions cannot see a document fall apart: strike the XML
 * prolog, or a namespace the document's own element names depend on, and every
 * `toContain` in this file still passes. Parsing is what asks the question the
 * user cares about - will a reader open this.
 */
const parse = (xml: string): Record<string, never> => {
  const verdict = XMLValidator.validate(xml);
  if (verdict !== true) throw new Error(`not well-formed XML: ${verdict.err.msg}`);
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' }).parse(xml);
};

/** Everything the document says outside its markup, in order. */
const textNodesOf = (xml: string): string =>
  xml.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

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
    // A cell nobody measured must not arrive as a measurement of zero - the rule
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
 * The document as a DOCUMENT. Everything above asks what `content.xml` CONTAINS;
 * these ask whether it is a file a reader will accept - the prolog, the root
 * element, and the namespace declarations that every prefixed name in it depends
 * on. `table:table` without `xmlns:table` is not a table, it is an error.
 */
describe('sectionsToOds writes a document a reader can open', () => {
  it('opens with the XML declaration and parses as well-formed XML', () => {
    const content = contentOf(SECTIONS);
    expect(content.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(() => parse(content)).not.toThrow();
  });

  it('declares every namespace its element names use, and the ODF version', () => {
    const root = parse(contentOf(SECTIONS))['office:document-content'] as unknown as Record<string, string>;
    expect(root).toBeDefined();
    expect(root['@xmlns:office']).toBe('urn:oasis:names:tc:opendocument:xmlns:office:1.0');
    expect(root['@xmlns:table']).toBe('urn:oasis:names:tc:opendocument:xmlns:table:1.0');
    expect(root['@xmlns:text']).toBe('urn:oasis:names:tc:opendocument:xmlns:text:1.0');
    expect(root['@office:version']).toBe('1.3');
  });

  it('carries no text of its own - only what the figure put in the cells', () => {
    // Tables, rows and cells are joined with NOTHING. Any separator would land
    // in the spreadsheet as content, between cells, where a reader would show it.
    expect(textNodesOf(contentOf(SECTIONS))).toBe('xy12.53n/a4whatvalueslope0.42');
  });

  it('writes a manifest that is itself a well-formed document', () => {
    const manifest = partOf(SECTIONS, 'META-INF/manifest.xml');
    expect(manifest.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const root = parse(manifest)['manifest:manifest'] as unknown as Record<string, unknown>;
    expect(root).toBeDefined();
    expect(root['@manifest:version']).toBe('1.3');
    expect(root['manifest:file-entry']).toHaveLength(2);
  });
});

describe('sectionsToOds cell values', () => {
  const cellsOf = (rows: Cell[][]): string[] =>
    [...contentOf([{ header: ['v'], rows }]).matchAll(/<table:table-cell[^]*?(?:\/>|<\/table:table-cell>)/g)].map(
      (m) => m[0]!
    );

  it('keeps a quote in the text instead of dropping it', () => {
    // The escape is what lets the character survive at all: unescaped it would
    // have to be removed, and a value the user measured would come back altered.
    const content = contentOf([{ header: ['q'], rows: [['"q"']] }]);
    expect(content).toContain('&quot;q&quot;');
    expect(textNodesOf(content)).toBe('q"q"');
  });

  it('writes a non-finite number as TEXT, never as a numeric value', () => {
    // office:value="NaN" is not a number to a spreadsheet - it is a broken cell,
    // and the reader is free to show 0. Anything that cannot be a float has to
    // travel as the text it is, so the reader sees that no number was measured.
    const cells = cellsOf([[Number.NaN, Number.POSITIVE_INFINITY]]);
    expect(cells[1]).toContain('office:value-type="string"');
    expect(cells[2]).toContain('office:value-type="string"');
    expect(cells.join('')).not.toContain('office:value="NaN"');
    expect(cells.join('')).not.toContain('office:value="Infinity"');
  });

  it('leaves a null or undefined cell blank, whichever entrance it came from', () => {
    // `Cell` is `string | number`, so TypeScript forbids these at this door -
    // but the rows are assembled from exported values and read back out of
    // project and foreign files, and the guard is here because that door is not
    // the only one. A 0 in place of "not measured" is the failure it prevents.
    const rows = [[null, undefined]] as unknown as Cell[][];
    const cells = cellsOf(rows);
    expect(cells[1]).toBe('<table:table-cell/>');
    expect(cells[2]).toBe('<table:table-cell/>');
  });
});

describe('sectionsToOds table names', () => {
  const namesOf = (sections: TableSection[]): string[] =>
    [...contentOf(sections).matchAll(/table:name="([^"]*)"/g)].map((m) => m[1]!);

  it('replaces an illegal character with a space rather than closing the gap', () => {
    // "Run 1/2" is two words either way; deleting the slash would fuse them into
    // a name the user never wrote.
    expect(namesOf([{ title: 'Run 1/2', header: ['a'], rows: [] }])).toEqual(['Run 1 2']);
  });

  it('trims the space an illegal character leaves at the end', () => {
    expect(namesOf([{ title: 'Run 2:', header: ['a'], rows: [] }])).toEqual(['Run 2']);
  });

  it('falls back to "Sheet" when sanitising leaves nothing but spaces', () => {
    expect(namesOf([{ title: '[*?]', header: ['a'], rows: [] }])).toEqual(['Sheet']);
  });

  it('caps a long name at 100 characters', () => {
    const names = namesOf([{ title: 'T'.repeat(120), header: ['a'], rows: [] }]);
    expect(names[0]).toBe('T'.repeat(100));
  });

  it('numbers a third collision (3), not back down to (1)', () => {
    const fit = (): TableSection => ({ title: 'Fit', header: ['a'], rows: [] });
    expect(namesOf([fit(), fit(), fit()])).toEqual(['Fit', 'Fit (2)', 'Fit (3)']);
  });

  it('names successive untitled sections Data, Sheet 2, Sheet 3', () => {
    const anon = (): TableSection => ({ header: ['a'], rows: [] });
    expect(namesOf([anon(), anon(), anon()])).toEqual(['Data', 'Sheet 2', 'Sheet 3']);
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
