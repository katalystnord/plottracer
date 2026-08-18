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
        { title: 'Fitted curve - A/B', header: ['x'], rows: [[1]] },
        { title: 'Fitted curve - A/B', header: ['x'], rows: [[2]] },
      ])
    );
    const names = wb.worksheets.map((w) => w.name);
    expect(names[0]).toBe('Fitted curve - A B'); // '/' replaced
    expect(names[1]).toMatch(/\(2\)$/); // duplicate disambiguated
    expect(names[0]).not.toBe(names[1]);
  });

  // A section's title is the SERIES NAME, typed by the user (exportAssembly.ts's
  // `title: info.name`), so every Excel naming rule below is reachable by anyone
  // who names a series descriptively. Excel refuses to open a workbook whose
  // sheet name breaks them, which loses the whole export, not one cell.
  it('truncates a sheet name to Excel’s 31-character limit', async () => {
    const long = 'Absorbance at 450 nm, replicate 3, corrected';
    const wb = await load(await sectionsToXlsx([{ title: long, header: ['x'], rows: [[1]] }]));
    expect(wb.worksheets[0]!.name).toBe('Absorbance at 450 nm, replicate');
    expect(wb.worksheets[0]!.name).toHaveLength(31);
  });

  it('de-duplicates on the TRUNCATED name, since that is the one Excel keeps', async () => {
    // Two series named "... replicate 1" and "... replicate 2" are identical in
    // their first 31 characters, so Excel sees one name twice. Truncating before
    // the uniqueness check is what makes them two sheets; without it exceljs
    // rejects the second outright ("Worksheet name already exists") and the whole
    // export throws - every other tab lost with it.
    const wb = await load(
      await sectionsToXlsx([
        { title: 'Absorbance at 450 nm, replicate 1', header: ['x'], rows: [[1]] },
        { title: 'Absorbance at 450 nm, replicate 2', header: ['x'], rows: [[2]] },
      ])
    );
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names[1]).toBe('Absorbance at 450 nm, repli (2)');
  });

  it('keeps a de-duplicated long name within the limit too', async () => {
    const long = 'Absorbance at 450 nm, replicate 3, corrected';
    const wb = await load(
      await sectionsToXlsx([
        { title: long, header: ['x'], rows: [[1]] },
        { title: long, header: ['x'], rows: [[2]] },
      ])
    );
    const names = wb.worksheets.map((w) => w.name);
    // The suffix has to come out of the name, not be added on top of a full one.
    expect(names[1]).toBe('Absorbance at 450 nm, repli (2)');
    for (const n of names) expect(n.length).toBeLessThanOrEqual(31);
    expect(new Set(names).size).toBe(2);
  });

  it('numbers a third collision (3), not back down to (1)', async () => {
    const wb = await load(
      await sectionsToXlsx([
        { title: 'Series', header: ['x'], rows: [[1]] },
        { title: 'Series', header: ['x'], rows: [[2]] },
        { title: 'Series', header: ['x'], rows: [[3]] },
      ])
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Series', 'Series (2)', 'Series (3)']);
  });

  it('falls back to "Sheet" when nothing legal survives sanitising', async () => {
    // Every character is illegal, so the replace leaves only spaces: without the
    // trim that blank string is truthy and Excel gets a whitespace-only name.
    const wb = await load(await sectionsToXlsx([{ title: '[*/?]', header: ['x'], rows: [[1]] }]));
    expect(wb.worksheets[0]!.name).toBe('Sheet');
  });

  it('trims the spaces an illegal character leaves behind', async () => {
    const wb = await load(await sectionsToXlsx([{ title: 'Run 2/', header: ['x'], rows: [[1]] }]));
    expect(wb.worksheets[0]!.name).toBe('Run 2');
  });

  it('names successive untitled sections Data, Sheet 2, Sheet 3', async () => {
    const wb = await load(
      await sectionsToXlsx([
        { header: ['x'], rows: [[1]] },
        { header: ['x'], rows: [[2]] },
        { header: ['x'], rows: [[3]] },
      ])
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Data', 'Sheet 2', 'Sheet 3']);
  });

  it('bolds the header row so the first row reads as headings', async () => {
    const wb = await load(await sectionsToXlsx([{ header: ['x', 'y'], rows: [[1, 2]] }]));
    const ws = wb.getWorksheet('Data')!;
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.getRow(2).font?.bold).toBeFalsy();
  });

  it('stamps PlotTracer as the file’s creator', async () => {
    const wb = await load(await sectionsToXlsx([{ header: ['x'], rows: [[1]] }]));
    expect(wb.creator).toBe('PlotTracer');
  });
});
