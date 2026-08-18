import { describe, expect, it } from 'vitest';
import { renderTable, type TableSection } from '../tableFormats.js';

/**
 * The NAMES the script formats emit - variables, R column arguments - and the
 * two MATLAB shapes.
 *
 * ⚑ WHY THIS FILE EXISTS. `tableFormats.ts` left 105 mutants unnoticed, and
 * they sit almost entirely in the identifier machinery rather than in the
 * table bodies the existing suite already checks: the R reserved-word list
 * (19 mutants - one per word, and no test names a single one), `varName`,
 * `isValidRName`'s regex, `rColumnName`'s positional fallback, and the
 * indent/separator strings of MATLAB's two branches.
 *
 * These are not cosmetic. A `.m`, `.py` or `.R` file we emit is RUN, not
 * read: a variable named from a section title that starts with a digit, or a
 * column called `NA`, is a syntax error or - worse for R - a silently
 * different meaning. The existing tests assert on one syntactic and one
 * non-syntactic header; what follows pins the rules that decide which is
 * which.
 */

const section = (header: (string | number)[], rows: (string | number)[][], title?: string): TableSection =>
  (title === undefined ? { header, rows } : { title, header, rows }) as TableSection;

describe('R back-ticks every reserved word, so no column silently becomes a keyword', () => {
  // Each word in the set is its own mutant, and a bare `NA` or `TRUE` column
  // is not a compile error in R -- it is a column referring to the constant.
  const reserved = [
    'if', 'else', 'repeat', 'while', 'function', 'for', 'in', 'next', 'break',
    'TRUE', 'FALSE', 'NULL', 'Inf', 'NaN', 'NA',
    'NA_integer_', 'NA_real_', 'NA_complex_', 'NA_character_',
  ];

  for (const word of reserved) {
    it(`back-ticks the reserved name "${word}"`, () => {
      const out = renderTable([section([word], [[1]])], 'r');
      expect(out).toContain(`\`${word}\` = c(1)`);
      // And the back-tick forces the opt-out that keeps it verbatim.
      expect(out).toContain('check.names = FALSE');
    });
  }

  it('leaves an ordinary name bare, and then does NOT ask for check.names', () => {
    // The other half: `check.names = FALSE` is only correct when something was
    // back-ticked. Emitting it always would be harmless-looking and wrong.
    const out = renderTable([section(['count'], [[1]])], 'r');
    expect(out).toContain('count = c(1)');
    expect(out).not.toContain('check.names');
  });

  it('is case-sensitive, as R is: "If" and "Na" are ordinary names', () => {
    const out = renderTable([section(['If', 'Na'], [[1, 2]])], 'r');
    expect(out).toContain('If = c(1)');
    expect(out).toContain('Na = c(2)');
    expect(out).not.toContain('check.names');
  });
});

describe('what R accepts as a bare column name', () => {
  const bare = (header: string) => renderTable([section([header], [[1]])], 'r').includes(`${header} = c(1)`);

  it('accepts a letter start, with digits, dots and underscores after it', () => {
    expect(bare('x')).toBe(true);
    expect(bare('bin_start.2')).toBe(true);
    expect(bare('Series1')).toBe(true);
  });

  it('accepts a leading dot when a letter follows', () => {
    expect(bare('.hidden')).toBe(true);
  });

  it('⚑ refuses a dot followed by a DIGIT, which R itself refuses', () => {
    // `.2x` is not a name in R -- it lexes as a number. The negative lookahead
    // is the only thing separating it from `.hidden`, and dropping it emits a
    // script that does not parse.
    const out = renderTable([section(['.2x'], [[1]])], 'r');
    expect(out).toContain('`.2x` = c(1)');
  });

  it('refuses a digit start and an underscore start', () => {
    expect(renderTable([section(['2020'], [[1]])], 'r')).toContain('`2020` = c(1)');
    expect(renderTable([section(['_x'], [[1]])], 'r')).toContain('`_x` = c(1)');
  });

  it('refuses a name containing a space or a hyphen', () => {
    expect(renderTable([section(['bin start'], [[1]])], 'r')).toContain('`bin start` = c(1)');
    expect(renderTable([section(['bin-start'], [[1]])], 'r')).toContain('`bin-start` = c(1)');
  });

  it('⚑ falls back to a POSITIONAL name for a blank header, never an empty argument', () => {
    // `data.frame( = c(1))` does not parse. V1/V2 mirrors what R's own
    // read.table does for unnamed columns, and the index is 1-based to match.
    const out = renderTable([section(['', ''], [[1, 2]])], 'r');
    expect(out).toContain('V1 = c(1)');
    expect(out).toContain('V2 = c(2)');
  });

  it('escapes a back-tick inside a header rather than closing the quoting early', () => {
    const out = renderTable([section(['a`b'], [[1]])], 'r');
    expect(out).toContain('`a\\`b` = c(1)');
  });
});

describe('the variable a section is assigned to', () => {
  it('is "data" for the first section and numbered for the ones after it', () => {
    // The fallback is positional and 1-based-after-the-first; two sections
    // sharing a name would have the second overwrite the first when run.
    const out = renderTable([section(['x'], [[1]]), section(['y'], [[2]])], 'python');
    expect(out).toContain('data = [');
    expect(out).toContain('data2 = [');
  });

  it('takes a titled section its own name, lower-cased with runs of punctuation as underscores', () => {
    const out = renderTable([section(['x'], [[1]], 'Curve Fit (v2)')], 'python');
    expect(out).toContain('curve_fit_v2 = [');
  });

  it('⚑ trims the underscores a trailing bracket or space would leave', () => {
    // "Measurements " -> "measurements_" is a legal identifier, so nothing
    // would complain -- it would just be an ugly name in every file forever.
    const out = renderTable([section(['x'], [[1]], '(Measurements)')], 'python');
    expect(out).toContain('measurements = [');
    expect(out).not.toContain('_measurements');
  });

  it('⚑ falls back when the title does not start with a letter, rather than emitting a bad name', () => {
    // "2024 results" -> "2024_results", which is not a legal variable in
    // MATLAB, Python or R. The positional fallback is the safe answer.
    expect(renderTable([section(['x'], [[1]], '2024 results')], 'python')).toContain('data = [');
    expect(renderTable([section(['x'], [[1]], '###')], 'python')).toContain('data = [');
  });

  it('applies the same naming in MATLAB and in R', () => {
    expect(renderTable([section(['x'], [[1]], 'Bin Counts')], 'matlab')).toContain('bin_counts = [');
    expect(renderTable([section(['x'], [[1]], 'Bin Counts')], 'r')).toContain('bin_counts <- data.frame(');
    expect(renderTable([section(['x'], [[1]]), section(['y'], [[2]])], 'r')).toContain('data2 <- data.frame(');
  });
});

describe('MATLAB picks its shape from the data, and both shapes must run', () => {
  it('a numeric section is a matrix: space-separated, indented, blanks as NaN', () => {
    const out = renderTable([section(['x', 'y'], [[1, 2], [3, '']])], 'matlab');
    expect(out).toBe(['% columns: x, y', 'data = [', '    1 2', '    3 NaN', '];'].join('\n'));
  });

  it('⚑ a section with ANY string cell drops to a cell array, keeping the header', () => {
    // A matrix cannot hold a Bar's category label, so the whole section
    // changes shape -- and the header comes back as the first row, since a
    // cell array can carry it. Rows are separated by `;` and cells by `,`;
    // swapping those two produces a file MATLAB refuses to load.
    const out = renderTable([section(['name', 'value'], [['Flax', 2]])], 'matlab');
    expect(out).toBe(
      ['% columns: name, value', 'data = {', "    'name', 'value';", "    'Flax', 2", '};'].join('\n')
    );
  });

  it('writes a blank cell in the cell-array shape as [], not as an empty string', () => {
    const out = renderTable([section(['name', 'value'], [['Flax', '']])], 'matlab');
    expect(out).toContain("    'Flax', []");
  });

  it('doubles an apostrophe inside a label, which is how MATLAB escapes it', () => {
    const out = renderTable([section(['name'], [["O'Brien"]])], 'matlab');
    expect(out).toContain("'O''Brien'");
  });

  it('⚑ decides the shape from the ROWS alone, so a text header stays a matrix', () => {
    // Every header is text; if the check included it, no section would ever
    // be a numeric matrix and the format's whole numeric shape would be dead.
    const out = renderTable([section(['bin start', 'value'], [[1, 2]])], 'matlab');
    expect(out).toContain('data = [');
    expect(out).not.toContain('data = {');
  });

  it('keeps a fully blank row numeric, since a blank is a hole and not text', () => {
    const out = renderTable([section(['x'], [[''], [2]])], 'matlab');
    expect(out).toContain('    NaN');
    expect(out).toContain('data = [');
  });
});

describe('Python keeps every section runnable', () => {
  it('emits the header as the first row and a trailing comma on each', () => {
    const out = renderTable([section(['x', 'y'], [[1, 2]])], 'python');
    expect(out).toBe(['# columns: x, y', 'data = [', "    ['x', 'y'],", '    [1, 2],', ']'].join('\n'));
  });

  it('writes None for a blank rather than an empty string', () => {
    // A '' in a numeric column would be a string in an otherwise numeric list,
    // which breaks the first thing a reader does with it.
    expect(renderTable([section(['x'], [['']])], 'python')).toContain('    [None],');
  });

  it('escapes a backslash before the quote, so a Windows path survives', () => {
    const out = renderTable([section(['p'], [['C:\\data']])], 'python');
    expect(out).toContain("'C:\\\\data'");
  });

  it('escapes an apostrophe rather than closing the literal', () => {
    expect(renderTable([section(['n'], [["O'Brien"]])], 'python')).toContain("'O\\'Brien'");
  });

  it('leads a titled section with its title as a comment', () => {
    const out = renderTable([section(['x'], [[1]], 'Measurements')], 'python');
    expect(out.split('\n')[0]).toBe('# Measurements');
  });

  it('an untitled section has no title comment, only the columns one', () => {
    const out = renderTable([section(['x'], [[1]])], 'python');
    expect(out.split('\n')[0]).toBe('# columns: x');
  });
});

describe('R writes literals R can read back', () => {
  it('uses NA for a blank and for a missing cell in a ragged row', () => {
    // A ragged row is the normal side-by-side export. `undefined` and `''`
    // must both become NA, or the column lengths disagree and data.frame
    // errors out.
    const out = renderTable([section(['x', 'y'], [[1, 2], [3]])], 'r');
    expect(out).toContain('x = c(1, 3)');
    expect(out).toContain('y = c(2, NA)');
  });

  it('writes the non-finite doubles as R spells them, not as JS does', () => {
    const out = renderTable([section(['x'], [[Infinity], [-Infinity], [NaN]])], 'r');
    expect(out).toContain('x = c(Inf, -Inf, NaN)');
    expect(out).not.toContain('Infinity');
  });

  it('quotes a character column with double quotes and escapes what is inside', () => {
    const out = renderTable([section(['n'], [['say "hi"'], ['C:\\data']])], 'r');
    expect(out).toContain('"say \\"hi\\""');
    expect(out).toContain('"C:\\\\data"');
  });

  it('always sets stringsAsFactors = FALSE, so text stays text', () => {
    expect(renderTable([section(['n'], [['Flax']])], 'r')).toContain('stringsAsFactors = FALSE');
  });

  it('emits a data.frame with no vectors for a section that has no rows', () => {
    const out = renderTable([section(['x'], [])], 'r');
    expect(out).toContain('x = c()');
  });
});

describe('several sections in one document', () => {
  it('are separated by a blank line in every format', () => {
    const two = [section(['x'], [[1]]), section(['y'], [[2]])];
    for (const format of ['csv', 'tsv', 'latex', 'matlab', 'python', 'r'] as const) {
      expect(renderTable(two, format)).toContain('\n\n');
    }
  });

  it('render to an empty string when there is nothing to export', () => {
    for (const format of ['csv', 'tsv', 'latex', 'matlab', 'python', 'r'] as const) {
      expect(renderTable([], format)).toBe('');
    }
  });
});

/**
 * ⚑⚑ WHAT A LABEL CAN DO TO THE FILE IT LANDS IN - round-2 audit.
 *
 * Series and category names are attacker-controlled: every importer takes them
 * verbatim from someone else's file, and `seriesNames.ts` only trims and
 * de-duplicates. Three separate holes came out of that:
 *
 *  - the delimited renderer wrote the section TITLE raw, the one
 *    user-controlled string it never escaped, so a name with an embedded
 *    newline injected a fabricated data row;
 *  - no format neutralised a leading `=`/`+`/`-`/`@`, so a name became an
 *    executable formula the moment the CSV was opened in a spreadsheet;
 *  - `Infinity`/`NaN` reached MATLAB, Python and LaTeX as bare identifiers,
 *    making the whole exported script unparseable - a case R's own writer had
 *    recognised and the others had not.
 */
describe('a hostile label cannot restructure the file', () => {
  it('⚑ collapses a newline in a section TITLE instead of injecting a row', () => {
    const evil = 'evil,name\nrow2,9,9';
    const out = renderTable([section(['x', 'y'], [[1, 2]], evil)], 'csv');
    const lines = out.split('\n');
    // Title, header, one data row - four lines would mean the injection worked.
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('x,y');
    expect(lines[2]).toBe('1,2');
  });

  it('carries a comma in a title through as-is - it labels a block, not a row', () => {
    // Deliberately NOT quoted: the title line is a block label, and the defect
    // was row INJECTION via a newline, not field-splitting on a comma. Pinned
    // so the difference stays a decision rather than an accident.
    expect(renderTable([section(['x'], [[1]], 'a,b')], 'csv').split('\n')[0]).toBe('a,b');
  });
});

describe('a label is never handed to a spreadsheet as a formula', () => {
  for (const lead of ['=', '+', '-', '@']) {
    it(`neutralises a leading "${lead}" in a data cell`, () => {
      const out = renderTable([section(['name'], [[`${lead}SUM(A1)`]])], 'csv');
      expect(out).toContain(`'${lead}SUM(A1)`);
    });
  }

  it('neutralises it in a HEADER cell too, where series names land', () => {
    const out = renderTable([section(['=cmd|calc'], [[1]])], 'csv');
    expect(out).toContain("'=cmd|calc");
  });

  it('⚑ leaves NUMBERS alone, including negative ones', () => {
    // The prefix must not touch a number: -5 is data, not a formula, and
    // quoting it would corrupt every negative value in the file.
    const out = renderTable([section(['x'], [[-5], [3.5]])], 'csv');
    expect(out).toContain('-5');
    expect(out).not.toContain("'-5");
  });

  it('leaves an ordinary label untouched', () => {
    expect(renderTable([section(['name'], [['Flax']])], 'csv')).toContain('Flax');
    expect(renderTable([section(['name'], [['Flax']])], 'csv')).not.toContain("'Flax");
  });
});

describe('a non-finite number does not break the exported script', () => {
  it('⚑ MATLAB gets Inf/-Inf/NaN, not bare identifiers', () => {
    const out = renderTable([section(['x'], [[Infinity], [-Infinity], [NaN]])], 'matlab');
    expect(out).toContain('Inf');
    expect(out).toContain('-Inf');
    expect(out).toContain('NaN');
    expect(out).not.toContain('Infinity');
  });

  it('⚑ Python gets float("inf"), which actually evaluates', () => {
    const out = renderTable([section(['x'], [[Infinity], [NaN]])], 'python');
    expect(out).toContain("float('inf')");
    expect(out).toContain("float('nan')");
    expect(out).not.toMatch(/(?<!float\(')Infinity/);
  });

  it('LaTeX renders infinity as maths rather than the JS spelling', () => {
    const out = renderTable([section(['x'], [[Infinity]])], 'latex');
    expect(out).toContain('\\infty');
    expect(out).not.toContain('Infinity');
  });

  it('R keeps the spellings it already had', () => {
    const out = renderTable([section(['x'], [[Infinity], [-Infinity], [NaN]])], 'r');
    expect(out).toContain('c(Inf, -Inf, NaN)');
  });

  it('ordinary numbers are unchanged in every format', () => {
    for (const f of ['csv', 'latex', 'matlab', 'python', 'r'] as const) {
      expect(renderTable([section(['x'], [[42.5]])], f)).toContain('42.5');
    }
  });
});
