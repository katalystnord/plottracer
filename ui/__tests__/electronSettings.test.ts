import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// electron-settings.cjs is a main-process CommonJS module; it takes its folder
// as an argument so the store is testable without launching Electron.
const require = createRequire(import.meta.url);
const { readSettingsFile, writeSettingsFile, SETTINGS_FILE } = require('../electron-settings.cjs') as {
  readSettingsFile: (dir: string) => Record<string, unknown>;
  writeSettingsFile: (dir: string, value: unknown) => boolean;
  SETTINGS_FILE: string;
};

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plottracer-settings-test-'));
}

describe('the settings file (v2.7, docs/v2.7-settings-cases.md)', () => {
  it('S2: what is written is read back after a restart', () => {
    const dir = tmp();
    expect(writeSettingsFile(dir, { colourTolerance: 30 })).toBe(true);
    expect(readSettingsFile(dir)).toEqual({ colourTolerance: 30 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('S3: a missing file reads as empty', () => {
    const dir = tmp();
    expect(readSettingsFile(dir)).toEqual({});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('S3: an unreadable file reads as empty instead of stopping the app', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, SETTINGS_FILE), '{ not json');
    expect(readSettingsFile(dir)).toEqual({});
    fs.writeFileSync(path.join(dir, SETTINGS_FILE), '[1,2,3]');
    expect(readSettingsFile(dir)).toEqual({});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('only a plain object is ever written', () => {
    const dir = tmp();
    expect(writeSettingsFile(dir, 'text')).toBe(false);
    expect(writeSettingsFile(dir, [1])).toBe(false);
    expect(fs.existsSync(path.join(dir, SETTINGS_FILE))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a write leaves no half-written file behind', () => {
    const dir = tmp();
    writeSettingsFile(dir, { a: 1 });
    writeSettingsFile(dir, { a: 2 });
    expect(fs.readdirSync(dir)).toEqual([SETTINGS_FILE]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
