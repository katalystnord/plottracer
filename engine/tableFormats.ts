/**
 * Multi-format table rendering (v0.8) — the one place a table of extracted
 * values becomes CSV / TSV / LaTeX / MATLAB / Python / R text, so PlotDigitizer
 * export parity (David) is a rendering choice, not a second copy of every
 * per-chart-type builder. engine/csvExport.ts builds the SECTIONS (what the
 * columns are); this decides the SYNTAX.
 *
 * A document is a list of SECTIONS, each an optionally-titled table. Sections
 * exist so derived data stays SEPARATED from the record (David, tenet 9): the
 * raw traced points are one section, and a curve fit's summary + its sampled
 * curve are their own sections — a reader lifts just the data, or just the fit,
 * without untangling them. This is the same "labelled block appended after the
 * data" shape the Measurements export has always used.
 *
 * MATLAB/Python were chosen over HTML/Matrix for parity (David) because they are
 * what a technical user actually pastes into an analysis. Both must survive a
 * NON-NUMERIC cell (a Bar's Label column, a categorical X): Python quotes it;
 * MATLAB drops to a cell array `{...}` when any cell is a string, else a plain
 * numeric matrix `[...]`.
 */

export type Cell = string | number;

/** One titled table within an exported document. */
export interface TableSection {
  /** Shown above the table (a label line / comment). Omit for the sole/main table. */
  title?: string;
  header: Cell[];
  rows: Cell[][];
}

export type TableFormat = 'csv' | 'tsv' | 'latex' | 'matlab' | 'python' | 'r';

/** File extension for each format (drives the save dialog + default filename). */
export const TABLE_FORMAT_EXTENSION: Record<TableFormat, string> = {
  csv: 'csv',
  tsv: 'tsv',
  latex: 'tex',
  matlab: 'm',
  python: 'py',
  r: 'R',
};

function isNumeric(c: Cell): c is number {
  return typeof c === 'number';
}

/** Collapse newlines so a value is safe inside a single-line comment
 * (LaTeX `%`, MATLAB `%`, Python `#`). A label pasted with an embedded newline
 * would otherwise break out of the comment and turn the tail into live code — a
 * syntax error on paste. Audit #4 hardened the DATA cells against this; the
 * comment headers that echo the same titles/labels were missed (v0.8 follow-up). */
function commentSafe(value: Cell): string {
  return String(value).replace(/[\r\n]+/g, ' ');
}

// --- CSV / TSV -------------------------------------------------------------

/** RFC-4180 minimal escaping against whichever delimiter is in use. */
function escapeDelimited(value: Cell, delimiter: string): string {
  const s = String(value);
  if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function sectionToDelimited(section: TableSection, delimiter: string): string {
  const lines: string[] = [];
  if (section.title) lines.push(section.title);
  for (const row of [section.header, ...section.rows]) {
    lines.push(row.map((c) => escapeDelimited(c, delimiter)).join(delimiter));
  }
  return lines.join('\n');
}

// --- LaTeX -----------------------------------------------------------------

/** Escape the TeX specials so a label like "Stress (%)" or "A_1" typesets.
 * Single-pass map so a value like `a\b` doesn't re-escape the inserted commands
 * (v0.8 audit #4: backslash was missing, which broke the tabular outright). */
const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};
function escapeLatex(value: Cell): string {
  if (isNumeric(value)) return String(value);
  return value.replace(/[\\&%$#_{}~^]/g, (c) => LATEX_ESCAPES[c] ?? c);
}

function sectionToLatex(section: TableSection): string {
  const cols = section.header.length;
  // Right-align numeric-looking columns (all-body cells numeric), else left.
  const colSpec = Array.from({ length: cols }, (_, i) =>
    section.rows.every((r) => r[i] === undefined || r[i] === '' || isNumeric(r[i]!)) ? 'r' : 'l'
  ).join('');
  const lines: string[] = [];
  if (section.title) lines.push(`% ${commentSafe(section.title)}`);
  lines.push(`\\begin{tabular}{${colSpec}}`);
  lines.push('\\hline');
  lines.push(section.header.map(escapeLatex).join(' & ') + ' \\\\');
  lines.push('\\hline');
  for (const row of section.rows) lines.push(row.map(escapeLatex).join(' & ') + ' \\\\');
  lines.push('\\hline');
  lines.push('\\end{tabular}');
  return lines.join('\n');
}

// --- MATLAB / Python -------------------------------------------------------

/** A safe identifier for a MATLAB/Python variable, from a section title. */
function varName(title: string | undefined, fallback: string): string {
  if (!title) return fallback;
  const id = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(id) ? id : fallback;
}

function matlabScalar(c: Cell): string {
  // A newline can't live inside a MATLAB single-quoted string (it's a syntax
  // error, not an escape) -- collapse to a space (v0.8 audit #4).
  return isNumeric(c) ? String(c) : `'${String(c).replace(/[\r\n]+/g, ' ').replace(/'/g, "''")}'`;
}

function sectionToMatlab(section: TableSection, index: number): string {
  const name = varName(section.title, index === 0 ? 'data' : `data${index + 1}`);
  const body = [section.header, ...section.rows];
  const allNumeric = section.rows.every((r) => r.every((c) => c === undefined || c === '' || isNumeric(c)));
  const lines: string[] = [];
  if (section.title) lines.push(`% ${commentSafe(section.title)}`);
  lines.push(`% columns: ${section.header.map(commentSafe).join(', ')}`);
  if (allNumeric) {
    // Numeric matrix: header dropped (a matrix can't hold labels); a blank cell
    // becomes NaN so column positions stay aligned.
    const rows = section.rows.map((r) => r.map((c) => (c === undefined || c === '' ? 'NaN' : String(c))).join(' '));
    lines.push(`${name} = [`);
    lines.push(rows.map((r) => '    ' + r).join('\n'));
    lines.push('];');
  } else {
    // Cell array so string columns (a Bar Label) survive.
    const rows = body.map((r) => r.map((c) => (c === undefined || c === '' ? '[]' : matlabScalar(c))).join(', '));
    lines.push(`${name} = {`);
    lines.push(rows.map((r) => '    ' + r).join(';\n'));
    lines.push('};');
  }
  return lines.join('\n');
}

function pythonScalar(c: Cell): string {
  if (c === undefined || c === '') return 'None';
  // Escape backslash first, then newlines (as \n / \r) and the quote, so an
  // embedded newline can't terminate the string literal (v0.8 audit #4).
  return isNumeric(c)
    ? String(c)
    : `'${String(c).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/'/g, "\\'")}'`;
}

function sectionToPython(section: TableSection, index: number): string {
  const name = varName(section.title, index === 0 ? 'data' : `data${index + 1}`);
  const lines: string[] = [];
  if (section.title) lines.push(`# ${commentSafe(section.title)}`);
  lines.push(`# columns: ${section.header.map(commentSafe).join(', ')}`);
  lines.push(`${name} = [`);
  // Header kept as the first row (Python lists hold mixed types fine), so the
  // column names travel with the data.
  for (const row of [section.header, ...section.rows]) {
    lines.push('    [' + row.map(pythonScalar).join(', ') + '],');
  }
  lines.push(']');
  return lines.join('\n');
}

// --- R (data.frame) --------------------------------------------------------

/** R reserved words + special constants that can't be a bare column name. */
const R_RESERVED = new Set([
  'if', 'else', 'repeat', 'while', 'function', 'for', 'in', 'next', 'break',
  'TRUE', 'FALSE', 'NULL', 'Inf', 'NaN', 'NA',
  'NA_integer_', 'NA_real_', 'NA_complex_', 'NA_character_',
]);

/** Can this string be written as a bare R name, or must it be back-ticked?
 * R names start with a letter or a dot-not-followed-by-a-digit, then take
 * letters/digits/dot/underscore; reserved words are never bare. */
function isValidRName(name: string): boolean {
  return /^(?:[A-Za-z]|\.(?![0-9]))[A-Za-z0-9._]*$/.test(name) && !R_RESERVED.has(name);
}

/** A data.frame column argument name from a header cell: bare when it is a
 * valid R name, back-ticked (with the header verbatim) otherwise, or a
 * positional `V1`/`V2` fallback for a blank header. */
function rColumnName(cell: Cell, index: number): string {
  const s = String(cell);
  if (s === '') return `V${index + 1}`;
  // A newline in a header would break the single-line argument -- collapse it,
  // matching the comment-safe treatment the other emitters give labels.
  const flat = s.replace(/[\r\n]+/g, ' ');
  if (isValidRName(flat)) return flat;
  return '`' + flat.replace(/`/g, '\\`') + '`';
}

function rScalar(c: Cell | undefined): string {
  if (c === undefined || c === '') return 'NA';
  if (isNumeric(c)) {
    // R has literals for the non-finite doubles; JS `String()` would emit
    // `Infinity`, which is not valid R.
    if (Number.isNaN(c)) return 'NaN';
    if (c === Infinity) return 'Inf';
    if (c === -Infinity) return '-Inf';
    return String(c);
  }
  // Character literal: escape the backslash first, then the newlines (as \n / \r)
  // and the quote, so an embedded newline can't terminate the string.
  return `"${String(c)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/"/g, '\\"')}"`;
}

function sectionToR(section: TableSection, index: number): string {
  const name = varName(section.title, index === 0 ? 'data' : `data${index + 1}`);
  const cols = section.header.length;
  const names = section.header.map((h, j) => rColumnName(h, j));
  const lines: string[] = [];
  if (section.title) lines.push(`# ${commentSafe(section.title)}`);
  lines.push(`${name} <- data.frame(`);
  for (let j = 0; j < cols; j++) {
    const values = section.rows.map((r) => rScalar(r[j]));
    lines.push(`  ${names[j]} = c(${values.join(', ')}),`);
  }
  // stringsAsFactors = FALSE keeps character columns as text (the pre-4.0
  // default that portable scripts still set). check.names = FALSE is only
  // needed when a header was back-ticked, so a non-syntactic name survives
  // verbatim instead of being make.names()-mangled.
  const needsCheckNames = names.some((n) => n.startsWith('`'));
  lines.push(`  stringsAsFactors = FALSE${needsCheckNames ? ',\n  check.names = FALSE' : ''}`);
  lines.push(')');
  return lines.join('\n');
}

// --- Public entry ----------------------------------------------------------

/** Render a document (list of sections) to the chosen text format. */
export function renderTable(sections: readonly TableSection[], format: TableFormat): string {
  switch (format) {
    case 'csv':
      return sections.map((s) => sectionToDelimited(s, ',')).join('\n\n');
    case 'tsv':
      return sections.map((s) => sectionToDelimited(s, '\t')).join('\n\n');
    case 'latex':
      return sections.map(sectionToLatex).join('\n\n');
    case 'matlab':
      return sections.map((s, i) => sectionToMatlab(s, i)).join('\n\n');
    case 'python':
      return sections.map((s, i) => sectionToPython(s, i)).join('\n\n');
    case 'r':
      return sections.map((s, i) => sectionToR(s, i)).join('\n\n');
  }
}
