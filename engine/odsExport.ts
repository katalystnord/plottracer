/**
 * ODS (OpenDocument Spreadsheet) export - the open-standard sibling of
 * engine/xlsxExport.ts, and written by hand rather than pulled from a library.
 *
 * ⚑ WHY BY HAND. An .ods is a ZIP of three parts, and we already write ZIPs with
 * `fflate` for the project container. Adding a spreadsheet library to emit ~40
 * lines of XML would cost a dependency for something the repo can already do -
 * and this format is the one PlotTracer's own README argues for: ISO/IEC 26300,
 * readable without anybody's product. It is also far lighter than the XLSX path,
 * which lazily loads ~900 kB of exceljs.
 *
 * Each SECTION becomes its own TABLE (a sheet), the same rule XLSX follows and
 * for the same reason: traced points on one tab, measurements on another, each
 * curve fit on its own, so derived data is never mixed into the record.
 *
 * ⚑ THE ONE RULE THAT IS EASY TO GET WRONG: `mimetype` must be the FIRST entry in
 * the archive and STORED UNCOMPRESSED. Readers sniff it at a fixed offset, so an
 * .ods whose mimetype is deflated, or merely not first, is a valid ZIP that
 * spreadsheet applications refuse. `zipSync` preserves insertion order, and the
 * per-entry `{ level: 0 }` is what keeps it stored.
 *
 * Pure: sections in, bytes out. No DOM, no filesystem.
 */

import { zipSync, strToU8 } from 'fflate';
import type { Cell, TableSection } from './tableFormats.js';

const MIMETYPE = 'application/vnd.oasis.opendocument.spreadsheet';

/**
 * Characters XML 1.0 cannot carry AT ALL.
 *
 * ⚑ THESE CANNOT BE ESCAPED, ONLY REMOVED. §2.2 defines the legal Char set as
 * #x9 | #xA | #xD | #x20-#xD7FF | #xE000-#xFFFD | #x10000-#x10FFFF -- so a
 * control character is not merely awkward to encode, it is outside the grammar.
 * `&#x1;` is just as illegal as the raw byte. A conformant reader therefore
 * rejects the ENTIRE workbook, not the one cell that carried it.
 *
 * This is reachable without the user typing anything: every importer takes
 * series and category names verbatim out of somebody else's project file, and
 * seriesNames.ts only trims and de-duplicates them (the same reasoning that put
 * the escaping and formula-injection rules into tableFormats.ts).
 *
 * Tab, newline and carriage return are deliberately NOT in this set -- they are
 * legal XML text, and stripping them would silently damage names that legitimately
 * contain them.
 */
// Matching control characters IS the job here. The no-control-regex rule
// exists to catch them written into a pattern by accident; this is the exact
// set XML 1.0 §2.2 excludes from its Char set.
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff]/g;

/**
 * Drop what XML cannot represent. Dropped, not substituted: a name is a label a
 * person chose, and quietly inventing a visible character inside it would be a
 * different kind of wrong answer -- the same reason a blank cell stays blank
 * rather than becoming 0.
 */
function xmlSafe(text: string): string {
  return text.replace(XML_ILLEGAL, '');
}

/** XML text escaping. Ampersand first, or the other replacements get mangled. */
function xml(text: string): string {
  return xmlSafe(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Table names must be unique and carry none of ' " / \ : * ? [ ] - sanitise,
 * then de-duplicate with a suffix, mirroring the XLSX writer's rule so the same
 * export has the same tab names in both formats. */
function uniqueTableName(raw: string, used: Set<string>): string {
  // ⚑ Strip the un-representable characters BEFORE de-duplicating, not just on
  // the way out through xml(). Two titles differing only by a control character
  // are one name once written, so de-duplicating on the raw string would let
  // both through as "distinct" and emit the same table:name twice.
  const base = xmlSafe(raw).replace(/['"\\/:*?[\]]/g, ' ').trim().slice(0, 100) || 'Sheet';
  let name = base;
  let n = 2;
  // v2.0 pre-launch audit: re-truncate to the 100-char cap AFTER appending the
  // suffix, the same way xlsxExport.ts's uniqueSheetName already does for its
  // own (31-char) cap -- without this, a title near the cap that also
  // collides could exceed it once " (2)" is appended.
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = base.slice(0, 100 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

/**
 * One cell. A number is written with `office:value-type="float"` and its numeric
 * `office:value`, so the spreadsheet treats it as a number rather than as text -
 * the same distinction the XLSX writer draws.
 *
 * ⚑ A BLANK STAYS BLANK. `''` becomes an empty cell, never a 0: a cell nobody
 * measured must not arrive as a measurement of zero (the export already refuses
 * that everywhere else - see exportValues' null handling).
 */
function cell(value: Cell): string {
  if (value === '' || value === null || value === undefined) return '<table:table-cell/>';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<table:table-cell office:value-type="float" office:value="${value}"><text:p>${xml(String(value))}</text:p></table:table-cell>`;
  }
  return `<table:table-cell office:value-type="string"><text:p>${xml(String(value))}</text:p></table:table-cell>`;
}

function row(cells: readonly Cell[]): string {
  return `<table:table-row>${cells.map(cell).join('')}</table:table-row>`;
}

function contentXml(sections: readonly TableSection[]): string {
  const used = new Set<string>();
  const tables = sections
    .map((section, i) => {
      const name = uniqueTableName(section.title ?? (i === 0 ? 'Data' : `Sheet ${i + 1}`), used);
      const body = [row(section.header), ...section.rows.map(row)].join('');
      return `<table:table table:name="${xml(name)}">${body}</table:table>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<office:document-content' +
    ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
    ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"' +
    ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"' +
    ' office:version="1.3">' +
    `<office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body>` +
    '</office:document-content>'
  );
}

const MANIFEST_XML =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
  `<manifest:file-entry manifest:full-path="/" manifest:media-type="${MIMETYPE}"/>` +
  '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
  '</manifest:manifest>';

/** Build an .ods workbook from the export sections. Returns the file bytes. */
export function sectionsToOds(sections: readonly TableSection[]): Uint8Array {
  return zipSync({
    // FIRST, and stored - see the header note.
    mimetype: [strToU8(MIMETYPE), { level: 0 }],
    'META-INF/manifest.xml': strToU8(MANIFEST_XML),
    'content.xml': strToU8(contentXml(sections)),
  });
}
