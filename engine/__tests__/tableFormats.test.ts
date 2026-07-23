import { describe, expect, it } from 'vitest';
import { renderTable, TABLE_FORMAT_EXTENSION, type TableSection } from '../tableFormats.js';

const numeric: TableSection = {
  header: ['x', 'y'],
  rows: [
    [0, 0],
    [1, 2.5],
  ],
};

const withLabel: TableSection = {
  header: ['category', 'value'],
  rows: [
    ['Control', 50],
    ['5 mM', 62],
  ],
};

describe('renderTable — CSV/TSV', () => {
  it('a lone untitled section is byte-identical to the old header+body CSV', () => {
    expect(renderTable([numeric], 'csv')).toBe('x,y\n0,0\n1,2.5');
  });
  it('TSV uses tabs', () => {
    expect(renderTable([numeric], 'tsv')).toBe('x\ty\n0\t0\n1\t2.5');
  });
  it('sections are separated by a blank line, titled sections lead with the title', () => {
    const doc = renderTable([numeric, { title: 'Measurements', header: ['tool', 'value'], rows: [['slope', 3]] }], 'csv');
    expect(doc).toBe('x,y\n0,0\n1,2.5\n\nMeasurements\ntool,value\nslope,3');
  });
});

describe('renderTable — LaTeX', () => {
  it('emits a tabular with & separators, \\\\ row ends and \\hline rules', () => {
    const tex = renderTable([numeric], 'latex');
    expect(tex).toContain('\\begin{tabular}{rr}');
    expect(tex).toContain('x & y \\\\');
    expect(tex).toContain('0 & 0 \\\\');
    expect(tex).toContain('\\hline');
    expect(tex).toContain('\\end{tabular}');
  });
  it('left-aligns a column that holds text, right-aligns numeric columns', () => {
    expect(renderTable([withLabel], 'latex')).toContain('\\begin{tabular}{lr}');
  });
  it('escapes TeX specials in a label (e.g. a percent or underscore)', () => {
    const tex = renderTable([{ header: ['Strain (%)', 'a_1'], rows: [[1, 2]] }], 'latex');
    expect(tex).toContain('Strain (\\%)');
    expect(tex).toContain('a\\_1');
  });
});

describe('renderTable — MATLAB', () => {
  it('an all-numeric section is a numeric matrix (header dropped, kept as a comment)', () => {
    const m = renderTable([numeric], 'matlab');
    expect(m).toContain('% columns: x, y');
    expect(m).toContain('data = [');
    expect(m).toContain('0 0');
    expect(m).toContain('1 2.5');
    expect(m).toContain('];');
    expect(m).not.toContain('{'); // not a cell array
  });
  it('a blank cell becomes NaN so columns stay aligned', () => {
    const m = renderTable([{ header: ['x', 'y'], rows: [[1, '']] }], 'matlab');
    expect(m).toContain('1 NaN');
  });
  it('a section with a string column drops to a cell array with quoted strings', () => {
    const m = renderTable([withLabel], 'matlab');
    expect(m).toContain('data = {');
    expect(m).toContain("'Control', 50");
    expect(m).toContain('};');
  });
});

describe('renderTable — Python', () => {
  it('emits a list of rows with the header kept as the first row', () => {
    const py = renderTable([numeric], 'python');
    expect(py).toContain('# columns: x, y');
    expect(py).toContain('data = [');
    expect(py).toContain("['x', 'y'],");
    expect(py).toContain('[0, 0],');
    expect(py).toContain('[1, 2.5],');
    expect(py).toContain(']');
  });
  it('quotes string cells and writes None for a blank', () => {
    const py = renderTable([{ header: ['c', 'v'], rows: [['Control', '']] }], 'python');
    expect(py).toContain("['Control', None],");
  });
  it('names a second, titled section from its title', () => {
    const py = renderTable([numeric, { title: 'Curve fit', header: ['series'], rows: [['A']] }], 'python');
    expect(py).toContain('curve_fit = [');
  });
});

describe('renderTable — R (data.frame)', () => {
  it('emits a data.frame with a named numeric vector per column', () => {
    const r = renderTable([numeric], 'r');
    expect(r).toContain('data <- data.frame(');
    expect(r).toContain('x = c(0, 1),');
    expect(r).toContain('y = c(0, 2.5),');
    expect(r).toContain('stringsAsFactors = FALSE');
    expect(r).toContain(')');
    // A plain header needs no check.names override.
    expect(r).not.toContain('check.names');
  });
  it('quotes a string column and writes NA for a blank cell', () => {
    const r = renderTable([{ header: ['c', 'v'], rows: [['Control', ''], ['5 mM', 62]] }], 'r');
    expect(r).toContain('c = c("Control", "5 mM"),');
    expect(r).toContain('v = c(NA, 62),');
  });
  it('back-ticks a non-syntactic header and opts into check.names = FALSE', () => {
    const r = renderTable([{ header: ['Strain (%)', 'y'], rows: [[1, 2]] }], 'r');
    expect(r).toContain('`Strain (%)` = c(1),');
    expect(r).toContain('check.names = FALSE');
  });
  it('names a second, titled section from its title', () => {
    const r = renderTable([numeric, { title: 'Curve fit', header: ['series'], rows: [['A']] }], 'r');
    expect(r).toContain('# Curve fit');
    expect(r).toContain('curve_fit <- data.frame(');
  });
  it('writes R literals for the non-finite doubles rather than JS Infinity', () => {
    const r = renderTable([{ header: ['x'], rows: [[Infinity], [-Infinity], [NaN]] }], 'r');
    expect(r).toContain('x = c(Inf, -Inf, NaN),');
    expect(r).not.toContain('Infinity');
  });
});

describe('escaping hardening (v0.8 audit #4)', () => {
  it('LaTeX escapes a backslash so the tabular still compiles', () => {
    const tex = renderTable([{ header: ['a\\b'], rows: [[1]] }], 'latex');
    expect(tex).toContain('a\\textbackslash{}b');
    // and does not re-escape the braces it just inserted
    expect(tex).not.toContain('\\textbackslash\\{\\}');
  });
  it('MATLAB collapses a newline in a string cell to a space (unquotable otherwise)', () => {
    const m = renderTable([{ header: ['x', 'y'], rows: [['line1\nline2', 5]] }], 'matlab');
    expect(m).toContain("'line1 line2'");
  });
  it('Python escapes a newline in a string cell rather than terminating the literal', () => {
    const py = renderTable([{ header: ['c', 'v'], rows: [['a\nb', 1]] }], 'python');
    expect(py).toContain("'a\\nb'");
  });
  it('R escapes a backslash and a newline in a string cell so the literal survives', () => {
    const r = renderTable([{ header: ['c', 'v'], rows: [['a\\b\nc', 1]] }], 'r');
    expect(r).toContain('"a\\\\b\\nc"');
  });
});

describe('comment-header newline hardening (v0.8 follow-up)', () => {
  // A newline pasted into a column LABEL (or a section title) reaches the
  // single-line `% columns:` / `# columns:` / `% title` comment lines. Left
  // raw, it breaks out of the comment and the tail becomes live code on paste.
  const labelBreak: TableSection = { title: 'first\nsecond', header: ['A\nB', 'y'], rows: [[1, 2]] };

  it('MATLAB collapses a newline in a column label inside the columns comment', () => {
    const m = renderTable([labelBreak], 'matlab');
    expect(m).toContain('% columns: A B, y');
    expect(m).not.toContain('% columns: A\nB'); // the label newline must not break the comment
  });
  it('MATLAB collapses a newline in the section title comment', () => {
    const m = renderTable([labelBreak], 'matlab');
    expect(m).toContain('% first second');
  });
  it('Python collapses a newline in a column label inside the columns comment', () => {
    const py = renderTable([labelBreak], 'python');
    expect(py).toContain('# columns: A B, y');
    expect(py).not.toContain('# columns: A\nB');
  });
  it('LaTeX collapses a newline in the section-title comment', () => {
    const tex = renderTable([labelBreak], 'latex');
    expect(tex).toContain('% first second');
    expect(tex).not.toContain('% first\nsecond');
  });
});

describe('TABLE_FORMAT_EXTENSION', () => {
  it('maps each format to its file extension', () => {
    expect(TABLE_FORMAT_EXTENSION).toEqual({ csv: 'csv', tsv: 'tsv', latex: 'tex', matlab: 'm', python: 'py', r: 'R' });
  });
});
