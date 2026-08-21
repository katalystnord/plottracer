import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * ⚑⚑ A `//` COMMENT THAT DRIFTED INSIDE A JSX ELEMENT IS RENDERED AT THE USER.
 *
 * JSX has no comment syntax of its own: between `return (` and the first tag,
 * `// like this` is an ordinary JS comment, and one line further in - inside a
 * fragment or an element - the SAME characters are TEXT CHILDREN and get painted
 * on screen.
 *
 * ⚠️ THIS SHIPPED. `HistogramBinsTable` carried four such lines directly above
 * its `<table>`; wrapping the return in a `<>` fragment to add an empty state
 * (F31) moved them inside it, and every histogram's data panel then printed
 * *"// Bins, not the corner clicks that produced them -- the same call //
 * buildHistogramCSV makes for export..."* above its rows.
 *
 * ▶ EVERY INSTRUMENT STAYED GREEN. Typecheck accepts JSX text. Lint accepts JSX
 * text. No unit test renders React. The e2e asserts `data-testid`s and cell
 * values, never a panel's own prose. It was found by reading the file, and it is
 * the purest "can only use what he sees on screen" failure this project has had:
 * the defect IS what he sees.
 *
 * ⚑ Asked of the PARSER, not of a regex over the source. The distinction that
 * matters - is this text a comment or a child? - is exactly the one a parser
 * makes and a regex cannot.
 */

const UI_SRC = path.join(import.meta.dirname, '..');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const FILES = tsxFiles(UI_SRC);

/** Every JsxText node in a file whose text looks like a source comment. */
function leakedComments(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.getText();
      // A rendered `//` followed by a word, or a `/* */` opener. A bare `//`
      // inside a URL is not a comment, so require the slashes to start a word.
      if (/(^|\s)\/\/\s*\S/.test(text) || /\/\*/.test(text)) {
        found.push(text.trim().split('\n')[0]!.slice(0, 80));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('no source comment is rendered at the user', () => {
  it('is not vacuous - it parses every component in ui/src', () => {
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES.some((f) => f.endsWith('Workspace.tsx'))).toBe(true);
    expect(FILES.some((f) => f.includes(`panels${path.sep}`))).toBe(true);
  });

  it('finds no leaked comment in any .tsx', () => {
    const leaks = FILES.flatMap((f) =>
      leakedComments(f).map((text) => `${path.relative(UI_SRC, f)}: ${text}`)
    );
    expect(
      leaks,
      'these lines are JSX TEXT, not comments - they render on screen. Move them above the `return`.'
    ).toEqual([]);
  });
});
