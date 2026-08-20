import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { theme } from '../theme.js';

/**
 * ⚑⚑ A THEME TOKEN INTERPOLATED INTO A STYLE STRING MUST BE A LEAF.
 *
 * `theme.color.border` is `{ regular, hover }`. Written into a template literal
 * it becomes `1px solid [object Object]`, which the engine discards whole - so
 * the border is simply absent, with nothing in the source, the types or the DOM
 * to say so. `ExportMenu.tsx` shipped that way from the v1.5 audit until the
 * v2.3 one, above a comment insisting *"The rule gets a visible edge."*
 *
 * ⚑ THE SWEEP, TURNED INTO A STANDING CHECK. Finding the one site is a ticket
 * closed; this is the search query kept running, in the same spirit as the
 * em-dash hook and the e2e-naming assertion. It costs milliseconds and it reads
 * the real theme object, so it cannot drift from it.
 *
 * ⚠️ Deliberately NOT a lint rule: the defect is not a syntax shape, it is a
 * VALUE at the end of a path, and only the theme itself knows which paths are
 * leaves.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_SRC = path.resolve(HERE, '..');

function tsxFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...tsxFilesUnder(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every `${theme.a.b.c}` written inside a template literal, with its file. */
function interpolatedThemePaths(): { file: string; expr: string }[] {
  const found: { file: string; expr: string }[] = [];
  for (const file of tsxFilesUnder(UI_SRC)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\$\{(theme(?:\.[A-Za-z0-9_]+)+)\}/g)) {
      found.push({ file: path.relative(UI_SRC, file), expr: m[1]! });
    }
  }
  return found;
}

function resolve(expr: string): unknown {
  let node: unknown = theme;
  for (const key of expr.split('.').slice(1)) {
    node = (node as Record<string, unknown>)[key];
    if (node === undefined) return undefined;
  }
  return node;
}

describe('theme tokens written into style strings', () => {
  const sites = interpolatedThemePaths();

  it('is not vacuous - the scan actually finds interpolated tokens', () => {
    // The guard that matters most here: a regex that quietly matches nothing
    // reports a perfectly clean board forever.
    expect(sites.length).toBeGreaterThan(0);
  });

  it('⚑⚑ every one of them resolves to a string or a number, never an object', () => {
    const objects = sites.filter((s) => {
      const value = resolve(s.expr);
      return typeof value === 'object' && value !== null;
    });
    expect(
      objects.map((s) => `${s.file}: \${${s.expr}} is an object, so it renders as [object Object]`)
    ).toEqual([]);
  });

  it('⚑ and every one of them exists at all - a typo renders as "undefined"', () => {
    const missing = sites.filter((s) => resolve(s.expr) === undefined);
    expect(missing.map((s) => `${s.file}: \${${s.expr}} is not a theme token`)).toEqual([]);
  });
});
