import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { sectionsToXlsx } from '../xlsxExport.js';

async function load(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs.load accepts a Buffer at runtime; the cast sidesteps an exceljs vs
  // @types/node Buffer-generic mismatch that is noise in a test.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(Buffer.from(bytes) as any);
  return wb;
}

describe('sectionsToXlsx', () => {
  it('writes one worksheet per section (record + measurements + fit stay separate tabs)', async () => {
    const wb = await load(
      await sectionsToXlsx([
        { header: ['x', 'y'], rows: [[0, 1], [1, 3]] },
        { title: 'Measurements', header: ['tool', 'value'], rows: [['slope', 2.5]] },
      ])
    );
    // First untitled section becomes "Data"; a titled one keeps its title.
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Data', 'Measurements']);
    const data = wb.getWorksheet('Data')!;
    // exceljs row.values is 1-indexed (index 0 is a hole).
    expect(data.getRow(1).values).toEqual([undefined, 'x', 'y']);
    expect(data.getRow(2).values).toEqual([undefined, 0, 1]);
    expect(data.getRow(3).values).toEqual([undefined, 1, 3]);
  });

  it('writes numbers as real numbers, not text', async () => {
    const wb = await load(await sectionsToXlsx([{ header: ['v'], rows: [[42.5]] }]));
    expect(wb.getWorksheet('Data')!.getCell('A2').value).toBe(42.5);
    expect(typeof wb.getWorksheet('Data')!.getCell('A2').value).toBe('number');
  });

  it('leaves a blank cell empty rather than writing a 0', async () => {
    const wb = await load(await sectionsToXlsx([{ header: ['x', 'y'], rows: [[1, '']] }]));
    expect(wb.getWorksheet('Data')!.getCell('B2').value).toBeNull();
  });

  it('sanitises + de-duplicates sheet names that collide or use illegal chars', async () => {
    const wb = await load(
      await sectionsToXlsx([
        { title: 'Fitted curve — A/B', header: ['x'], rows: [[1]] },
        { title: 'Fitted curve — A/B', header: ['x'], rows: [[2]] },
      ])
    );
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe('Fitted curve — A B'); // '/' replaced
    expect(names[1]).toMatch(/\(2\)$/); // duplicate disambiguated
    expect(names[0]).not.toBe(names[1]);
  });
});
