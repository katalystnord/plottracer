import { describe, it, expect } from 'vitest';
import {
  universalOmissions,
  formatLimitations,
  formatLimitationNote,
  exportOmissionNote,
  type ExportContent,
  type ExportTarget,
} from '../exportCapability.js';
import { buildSeriesJSON, allSeriesSection, measurementsSection } from '../csvExport.js';
import { renderTable } from '../tableFormats.js';

const plain: ExportContent = { sectionCount: 1, hasTextCells: false, hasSourceDocument: false };

const ALL_TARGETS: ExportTarget[] = ['csv', 'tsv', 'latex', 'matlab', 'python', 'r', 'json', 'xlsx', 'ods'];

describe('universalOmissions', () => {
  it('names the figure and the calibration, which no format carries', () => {
    expect(universalOmissions(plain)).toEqual(['the figure image', 'the axis calibration']);
  });

  it('adds the source document only when one is actually bundled', () => {
    expect(universalOmissions(plain).join(' ')).not.toMatch(/source document/);
    expect(universalOmissions({ ...plain, hasSourceDocument: true }).join(' ')).toMatch(/source document/);
  });
});

describe('exportOmissionNote', () => {
  it('says what is lost AND what keeps it, so the warning has a door out', () => {
    const note = exportOmissionNote(plain);
    expect(note).toMatch(/figure image/);
    expect(note).toMatch(/axis calibration/);
    expect(note).toMatch(/Save a project/i);
  });
});

describe('formatLimitations', () => {
  it('says nothing at all when there is nothing true to say', () => {
    // Silence is correct. Padding every format with a generic caveat would
    // train the user to ignore the line.
    for (const t of ALL_TARGETS) {
      if (t === 'matlab') continue;
      expect(formatLimitations(t, plain)).toEqual([]);
    }
    expect(formatLimitationNote('csv', plain)).toBe('');
  });

  it('warns that MATLAB becomes a cell array once any cell is text', () => {
    const notes = formatLimitations('matlab', { ...plain, hasTextCells: true });
    expect(notes.join(' ')).toMatch(/cell array/);
    expect(notes.join(' ')).toMatch(/numeric matrix/);
  });

  it('does NOT warn about MATLAB when every cell is numeric', () => {
    expect(formatLimitations('matlab', plain)).toEqual([]);
  });

  it('warns that flat text formats put every block in one stream', () => {
    const many = { ...plain, sectionCount: 3 };
    for (const t of ['csv', 'tsv', 'latex', 'python', 'r'] as ExportTarget[]) {
      expect(formatLimitations(t, many).join(' ')).toMatch(/one file/);
      // No invented count: the caller can only estimate the number of blocks.
      expect(formatLimitations(t, many).join(' ')).not.toMatch(/\d+ blocks/);
    }
  });

  it('does not make that complaint about formats that keep blocks apart', () => {
    const many = { ...plain, sectionCount: 3 };
    for (const t of ['xlsx', 'ods', 'json'] as ExportTarget[]) {
      expect(formatLimitations(t, many)).toEqual([]);
    }
  });

  it('says nothing about a single block, because there is nothing to separate', () => {
    expect(formatLimitations('csv', plain)).toEqual([]);
  });
});

/**
 * ⚑ The claims above are only worth anything if they match what the writers
 * actually do. These assert against the REAL exporters rather than restating
 * the module's own beliefs — announcing a loss that does not happen is the same
 * defect as hiding one that does.
 */
describe('the claims match what the exporters really emit', () => {
  const series = [{ name: 'Series 1', rows: [{ values: [1, 2] as (number | string)[], role: 'interpolated' }] }];

  it('no exporter emits the calibration or the image — the universal claim is true', () => {
    const json = buildSeriesJSON(series as never, ['x', 'y']);
    const csv = renderTable([allSeriesSection(series as never, ['x', 'y'])], 'csv');
    for (const text of [json, csv]) {
      expect(text).not.toMatch(/calibration/i);
      expect(text).not.toMatch(/data:image/);
      expect(text).not.toMatch(/pixelToData|axes/i);
    }
  });

  it('point ROLES are carried, so the note must not claim they are lost', () => {
    // Guards the one thing easiest to get wrong here: roles DO ride into every
    // export, and saying otherwise would be a false warning.
    expect(buildSeriesJSON(series as never, ['x', 'y'])).toMatch(/interpolated/);
    const note = exportOmissionNote(plain) + formatLimitationNote('csv', { ...plain, hasTextCells: true });
    expect(note).not.toMatch(/roles? (are|is) (not|never)/i);
  });

  it('MATLAB really does switch to a cell array when a cell is text', () => {
    const numeric = renderTable([{ header: ['x', 'y'], rows: [[1, 2]] }], 'matlab');
    const textual = renderTable([{ header: ['x', 'y'], rows: [['a', 2]] }], 'matlab');
    expect(numeric).toMatch(/\[/);
    expect(numeric).not.toMatch(/\{/);
    expect(textual).toMatch(/\{/);
  });

  it('a flat text format really does put several blocks in one stream', () => {
    const text = renderTable(
      [allSeriesSection(series as never, ['x', 'y']), measurementsSection([{ tool: 'Distance', value: '3', unit: 'mm' }] as never)],
      'csv'
    );
    // One document containing both blocks — which is exactly what the note says.
    expect(text).toMatch(/Series 1/);
    expect(text).toMatch(/Distance/);
  });
});
