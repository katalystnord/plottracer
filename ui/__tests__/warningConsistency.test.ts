/**
 * ⚑⚑ ONE LOOK FOR "THIS CANNOT GO ON" (David, 2026-10-19: "triangle everywhere it applies like this.
 * Consistency above all helps usability... Consistency and predictability is paramount.")
 *
 * Every message that says something could not be read, was not done or stops a walk is drawn by
 * `WarningLine` (ui/src/panels/WarningLine.tsx): the warning triangle and the sentence. Before the sweep
 * the same kind of message came in red text, in grey text, with a typed "⚠", or with nothing, depending
 * on which card it was on. This test keeps it that way by refusing the error colour anywhere it is
 * not one of the uses named below, none of which is a message: a table cell or an input field marked
 * invalid, a marker's fallback colour, and the tips bar's triangle itself.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../src');

/** Each allowed use: the file, and a piece of the line that says what it colours. */
const ALLOWED: { file: string; snippet: string; why: string }[] = [
  { file: 'panels/WarningLine.tsx', snippet: '', why: 'the triangle itself' },
  { file: 'panels/HeatmapCellsTable.tsx', snippet: 'cell?.warning ? theme.color.error', why: 'a table cell marked, not a message' },
  { file: 'panels/HeatmapCellsTable.tsx', snippet: 'cell.warning ? theme.color.error', why: 'a table cell marked, not a message' },
  { file: 'Workspace.tsx', snippet: 'fallbackColor: theme.color.error', why: 'a marker colour' },
  { file: 'Workspace.tsx', snippet: 'figureNameNotice ? theme.color.error', why: 'an invalid field\'s border' },
  { file: 'Workspace.tsx', snippet: 'data-testid="tips-bar-warning"', why: 'the tips bar\'s triangle' },
  { file: 'panels/SettingsMenu.tsx', snippet: 'valid ? theme.color.border.regular : theme.color.error', why: 'an invalid field\'s border' },
  { file: 'panels/SettingsMenu.tsx', snippet: 'valid ? theme.color.text.legend : theme.color.error', why: 'an invalid field\'s unit' },
];

function sources(dir: string, rel = ''): string[] {
  return readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) return sources(dir, r);
    return /\.tsx?$/.test(e.name) ? [r] : [];
  });
}

describe('a message that something cannot go on has one look', () => {
  it('the error colour is used only by WarningLine and the named non-message uses', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      readFileSync(path.join(SRC, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!line.includes('theme.color.error')) return;
          const ok = ALLOWED.some((a) => a.file === file && (a.snippet === '' || line.includes(a.snippet)));
          if (!ok) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders, 'draw the message with WarningLine (ui/src/panels/WarningLine.tsx)').toEqual([]);
  });

  it('no message types its own warning sign', () => {
    const typed: string[] = [];
    for (const file of sources(SRC)) {
      // comments blanked out (keeping their line breaks, so the line numbers hold): only code counts
      const code = readFileSync(path.join(SRC, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
        .replace(/^\s*\/\/.*$/gm, '');
      code.split('\n').forEach((line, i) => {
        if (/[⚠❗❌]/.test(line)) typed.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(typed, 'use WarningLine, not a typed sign').toEqual([]);
  });
});
