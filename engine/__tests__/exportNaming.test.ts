import { describe, it, expect } from 'vitest';
import { exportBaseName, EXPORT_FILTER_NAMES, type NamedExportFormat } from '../exportNaming.js';

describe('exportBaseName', () => {
  it('takes the source image’s own stem, so batching a folder does not collide', () => {
    // The whole reason this is derived rather than hardcoded: with a fixed
    // `data.csv`, the second figure of thirty silently overwrites the first.
    expect(exportBaseName('figure.png')).toBe('figure');
    expect(exportBaseName('scan-03.tiff')).toBe('scan-03');
  });

  it('strips the directory on either platform’s separator', () => {
    // A project saved on one OS can be opened on another, so both appear.
    expect(exportBaseName('/home/david/papers/fig2.png')).toBe('fig2');
    expect(exportBaseName('C:\\Users\\david\\fig2.png')).toBe('fig2');
    expect(exportBaseName('/tmp/a.b/c/fig2.png')).toBe('fig2');
  });

  it('strips only the LAST extension', () => {
    expect(exportBaseName('data.tar.gz')).toBe('data.tar');
    expect(exportBaseName('fig.final.v2.png')).toBe('fig.final.v2');
  });

  it('keeps a name that has no extension at all', () => {
    expect(exportBaseName('figure')).toBe('figure');
  });

  it('falls back to the provenance source when there is no image name', () => {
    expect(exportBaseName(null, 'paper.pdf')).toBe('paper');
    expect(exportBaseName('', 'paper.pdf')).toBe('paper');
    expect(exportBaseName(undefined, 'paper.pdf')).toBe('paper');
  });

  it('prefers the image name over the provenance source', () => {
    expect(exportBaseName('figure.png', 'paper.pdf')).toBe('figure');
  });

  it('falls back to "data" when there is no name anywhere', () => {
    expect(exportBaseName(null)).toBe('data');
    expect(exportBaseName(null, null)).toBe('data');
    expect(exportBaseName('', '')).toBe('data');
  });

  it('⚑ never returns an EMPTY stem, however the name is shaped', () => {
    // Each of these strips to nothing, which a plain replace-chain would turn
    // into a filename of ".csv" - hidden on Unix and rejected on Windows.
    for (const name of ['.png', '   ', '  .png', '/home/david/', 'C:\\dir\\', '.gitignore']) {
      expect(exportBaseName(name), name).not.toBe('');
      expect(exportBaseName(name), name).toBe('data');
    }
  });

  it('trims incidental whitespace around the stem', () => {
    expect(exportBaseName('  figure .png')).toBe('figure');
  });
});

describe('EXPORT_FILTER_NAMES', () => {
  it('names every text format the export menu can reach', () => {
    const formats: NamedExportFormat[] = ['json', 'csv', 'tsv', 'latex', 'matlab', 'python', 'r'];
    for (const f of formats) {
      expect(EXPORT_FILTER_NAMES[f], f).toBeTruthy();
    }
  });

  it('uses each format’s own conventional capitalisation', () => {
    // These land in a native save dialog, where "Latex" or "Json" reads as sloppy.
    expect(EXPORT_FILTER_NAMES.latex).toBe('LaTeX');
    expect(EXPORT_FILTER_NAMES.matlab).toBe('MATLAB');
    expect(EXPORT_FILTER_NAMES.json).toBe('JSON');
    expect(EXPORT_FILTER_NAMES.r).toBe('R');
  });
});
