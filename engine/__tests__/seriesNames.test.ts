import { describe, it, expect } from 'vitest';
import { datasetNameError, uniqueDatasetName, dedupeDatasetNames } from '../seriesNames.js';
import { CalibrationSession, XY_AXES_CONFIG } from '../calibrationSession.js';

describe('seriesNames — the rules', () => {
  it('accepts a name nothing else holds', () => {
    expect(datasetNameError('Sample A', ['Series 1', 'Series 2'])).toBeNull();
  });

  it('refuses a duplicate, naming it', () => {
    expect(datasetNameError('Series 1', ['Series 1'])).toBe('A series called "Series 1" already exists.');
  });

  it('refuses a blank or whitespace-only name', () => {
    expect(datasetNameError('', [])).toBe('A series needs a name.');
    expect(datasetNameError('   ', [])).toBe('A series needs a name.');
  });

  it('compares after trimming, so " Sample A " collides with "Sample A"', () => {
    // Both are the same CSV column header; treating them as distinct series
    // would defeat the check the moment anything relates two series by name.
    expect(datasetNameError('  Sample A  ', ['Sample A'])).not.toBeNull();
  });

  it('is case-sensitive, matching WPD rather than diverging', () => {
    expect(datasetNameError('sd', ['SD'])).toBeNull();
  });

  it('renaming a series to what it is already called is not a conflict', () => {
    // otherNames excludes the series being renamed -- so this is the caller's
    // contract, pinned here because getting it wrong makes a no-op rename fail.
    expect(datasetNameError('Series 1', [])).toBeNull();
  });
});

describe('uniqueDatasetName — for names the user did not type', () => {
  it('returns the name untouched when it is free', () => {
    expect(uniqueDatasetName('Sample A', ['Series 1'])).toBe('Sample A');
  });

  it('suffixes until free', () => {
    expect(uniqueDatasetName('Sample A', ['Sample A'])).toBe('Sample A (2)');
    expect(uniqueDatasetName('Sample A', ['Sample A', 'Sample A (2)'])).toBe('Sample A (3)');
  });

  it('falls back to "Series" for a blank name rather than producing " (2)"', () => {
    expect(uniqueDatasetName('   ', [])).toBe('Series');
  });
});

describe('dedupeDatasetNames — the load path', () => {
  it('leaves an already-unique project untouched', () => {
    expect(dedupeDatasetNames(['A', 'B', 'C'])).toEqual(['A', 'B', 'C']);
  });

  it('keeps the first occurrence and renames later collisions', () => {
    expect(dedupeDatasetNames(['A', 'A', 'A'])).toEqual(['A', 'A (2)', 'A (3)']);
  });

  it('fixes the exact shape our own 0.2.0 files can contain', () => {
    // The auto-namer bug: rename "Series 1" -> "Series 2", press Add, and the
    // saved project has two "Series 2". Such a file must still open.
    expect(dedupeDatasetNames(['Series 2', 'Series 2'])).toEqual(['Series 2', 'Series 2 (2)']);
  });

  it('names blanks rather than leaving an unusable column header', () => {
    expect(dedupeDatasetNames(['', '  '])).toEqual(['Series', 'Series (2)']);
  });
});

describe('CalibrationSession — the guards (checkpoint 75)', () => {
  const names = (s: CalibrationSession<never>) => s.getDatasets().map((d) => d.name);
  const session = () => new CalibrationSession(XY_AXES_CONFIG as never) as unknown as CalibrationSession<never>;

  it('the auto-namer no longer collides with a renamed series', () => {
    // The live bug, verified by execution before the fix: renaming onto a number
    // the counter had not reached yet produced two "Series 2".
    const s = session();
    s.renameDataset(0, 'Series 2');
    s.addDataset();
    expect(names(s)).toEqual(['Series 2', 'Series 3']);
  });

  it('walks past every taken number, not just the next one', () => {
    const s = session();
    s.renameDataset(0, 'Series 2');
    s.addDataset(); // Series 3
    s.renameDataset(1, 'Series 4');
    s.addDataset();
    expect(names(s)).toEqual(['Series 2', 'Series 4', 'Series 5']);
  });

  it('refuses a duplicate rename and leaves the name alone', () => {
    const s = session();
    s.addDataset(); // Series 2
    const error = s.renameDataset(1, 'Series 1');
    expect(error).toBe('A series called "Series 1" already exists.');
    expect(names(s)).toEqual(['Series 1', 'Series 2']);
  });

  it('refuses a blank rename and leaves the name alone', () => {
    const s = session();
    expect(s.renameDataset(0, '   ')).toBe('A series needs a name.');
    expect(names(s)).toEqual(['Series 1']);
  });

  it('stores the trimmed name on a successful rename', () => {
    const s = session();
    expect(s.renameDataset(0, '  Sample A  ')).toBeNull();
    expect(names(s)).toEqual(['Sample A']);
  });

  it('renaming a series to its own current name is allowed', () => {
    const s = session();
    expect(s.renameDataset(0, 'Series 1')).toBeNull();
    expect(names(s)).toEqual(['Series 1']);
  });

  it('disambiguates an explicit addDataset name rather than refusing it', () => {
    // addDataset's callers pass names the user did not type (load, tests), so a
    // collision is disambiguated; a name the user typed goes via renameDataset,
    // which refuses. Same split as WPD's own.
    const s = session();
    s.addDataset('Series 1');
    expect(names(s)).toEqual(['Series 1', 'Series 1 (2)']);
  });

  it('datasetNameError reports without mutating', () => {
    const s = session();
    s.addDataset();
    expect(s.datasetNameError(1, 'Series 1')).not.toBeNull();
    expect(s.datasetNameError(1, 'Anything else')).toBeNull();
    expect(names(s)).toEqual(['Series 1', 'Series 2']);
  });
});
