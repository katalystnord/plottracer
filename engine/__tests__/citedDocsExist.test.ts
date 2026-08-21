import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * ⚑⚑ A CITATION THAT POINTS AT NOTHING IS WORSE THAN NO CITATION (v2.3
 * re-audit, F36).
 *
 * Fourteen source files cited `docs/error-bars-design.md` - in headers stating
 * the error model's premises, in the reasoning for why a whisker is drawn at
 * all, in a test explaining what it is a derivation of - and the file did not
 * exist. Every reader who followed the reference learned that the reasoning was
 * recorded somewhere they could not find; every reader who did not follow it
 * took the citation as evidence that it was.
 *
 * That is CLAUDE.md's third gate in its documentary form: *a comment restating a
 * design is false evidence of compliance.* A comment CITING one is the same
 * thing at one remove, and cheaper to check - so it is checked here.
 *
 * ⚑ Asserts the SOURCE, like `helpOverlayKeys.test.ts`: nothing executes prose,
 * so prose drifts silently. This cannot tell whether a document says what the
 * citation claims - only that a reader can get to it, which is the failure that
 * actually happened.
 */

const ROOT = path.join(import.meta.dirname, '..', '..');
/**
 * ⚑ THE REPO ROOT IS IN THE LIST, and it was the miss (v2.3 audit fleet). The
 * first version of this guard swept the source directories and not the root - so
 * `CLAUDE.md`, the project's own constitution and the most-read file here, was
 * the one file it could not see, and it carried a dangling citation of its own.
 * A guard with one entrance, in a repo whose standing rule is that the model has
 * more than one.
 */
const SEARCH_DIRS = ['.', 'core', 'algorithms', 'engine', 'ui/src', 'ui/__tests__', 'build', 'tools', 'docs'];

/** Every .ts/.tsx/.md file under the searched directories. */
function sourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string, depth = 0) => {
    for (const entry of readdirSync(d)) {
      // ⚑ `dist-ui` and `reports` hold BUILT copies of the source; a citation
      // there is a duplicate of one already checked, and `node_modules` is
      // someone else's prose entirely.
      if (['node_modules', 'dist-ui', 'reports', 'release-notes'].includes(entry)) continue;
      if (entry.startsWith('.')) continue;
      const full = path.join(d, entry);
      // ⚑ The root is swept for its own FILES only; its subdirectories are
      // listed explicitly above, so recursing here would sweep the whole repo.
      if (statSync(full).isDirectory()) {
        if (dir !== '.' || depth > 0) walk(full, depth + 1);
      }
      else if (/\.(ts|tsx|md)$/.test(entry)) out.push(full);
    }
  };
  walk(abs);
  return out;
}

const FILES = SEARCH_DIRS.flatMap(sourceFiles);

describe('every docs/ page a source file cites actually exists', () => {
  it('is not vacuous - it is reading real files, and they do cite docs', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((f) => readFileSync(f, 'utf8').includes('docs/'))).toBe(true);
  });

  it('names no docs/ page that is missing', () => {
    const missing: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bdocs\/([A-Za-z0-9._-]+\.md)\b/g)) {
        const page = m[1]!;
        if (!existsSync(path.join(ROOT, 'docs', page))) {
          missing.push(`${path.relative(ROOT, file)} cites docs/${page}`);
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
