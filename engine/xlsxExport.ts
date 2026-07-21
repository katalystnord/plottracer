/**
 * XLSX (Excel) export (v0.8) — PlotDigitizer export parity (David). Kept in its
 * own module, separate from engine/tableFormats.ts, because it pulls in `exceljs`
 * (MIT): tableFormats.ts must stay dependency-free so the pure text renderers and
 * their tests never load a spreadsheet library.
 *
 * Each SECTION becomes its own WORKSHEET, which is the natural Excel form of the
 * "keep derived data separated from the record" rule (David): the traced points
 * are one tab, the measurements another, and each curve fit its own — a reader
 * clicks the tab they want. Numbers are written as real numbers (not text) so
 * Excel treats them numerically; a blank cell stays blank rather than becoming 0.
 */

import ExcelJS from 'exceljs';
import type { Cell, TableSection } from './tableFormats.js';

/** Excel worksheet-name rules: <=31 chars, none of : \ / ? * [ ], and unique
 * within the workbook. Sanitise, truncate, then de-duplicate with a suffix. */
function uniqueSheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

/** A blank ('') exports as an empty cell (null), never a 0; numbers stay numeric. */
function toCellValue(c: Cell): string | number | null {
  return c === '' ? null : c;
}

/** Build an .xlsx workbook from the export sections. Returns the file bytes. */
export async function sectionsToXlsx(sections: readonly TableSection[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PlotTracer';
  const used = new Set<string>();
  sections.forEach((section, i) => {
    const ws = wb.addWorksheet(uniqueSheetName(section.title ?? (i === 0 ? 'Data' : `Sheet ${i + 1}`), used));
    ws.addRow(section.header.map(toCellValue));
    for (const row of section.rows) ws.addRow(row.map(toCellValue));
    ws.getRow(1).font = { bold: true };
  });
  // exceljs returns a Node Buffer / ArrayBuffer; normalise to Uint8Array so the
  // caller can base64-encode it the same way the .zip project save does.
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
