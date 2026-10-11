import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTING_SPECS, parseSettings, type Settings } from '../settings.js';

/**
 * docs/v2.7-settings-cases.md. The parser is the store's only gate: the file is
 * hand-editable and written by more than one version of the app, so it is
 * another entrance to the same model and gets the same limits the card enforces.
 */

describe('Settings (v2.7)', () => {
  it('S1: the card lists every setting, each with an explanation', () => {
    const keys = SETTING_SPECS.map((s) => s.key).sort();
    expect(keys).toEqual((Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]).sort());
    for (const s of SETTING_SPECS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.explains.length).toBeGreaterThan(20);
    }
  });

  it('S3: a missing or unreadable file starts with every default', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not an object')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('S3: a value out of range or of the wrong kind falls back alone; the others keep their stored value', () => {
    const s = parseSettings({
      colourTolerance: 30,
      floodFillThreshold: 9999,
      gridRemovalTolerance: 'forty',
      pointsPerTrace: 200,
      readContourLabels: 'yes',
      labelConfidence: 0.95,
      exportFullPrecision: true,
      decimalComma: 1,
    });
    expect(s.colourTolerance).toBe(30);
    expect(s.floodFillThreshold).toBe(DEFAULT_SETTINGS.floodFillThreshold);
    expect(s.gridRemovalTolerance).toBe(DEFAULT_SETTINGS.gridRemovalTolerance);
    expect(s.pointsPerTrace).toBe(200);
    expect(s.readContourLabels).toBe(DEFAULT_SETTINGS.readContourLabels);
    expect(s.labelConfidence).toBe(0.95);
    expect(s.exportFullPrecision).toBe(true);
    expect(s.decimalComma).toBe(DEFAULT_SETTINGS.decimalComma);
  });

  it('S3: a whole number setting stored as a fraction is refused, not rounded into something nobody chose', () => {
    expect(parseSettings({ pointsPerTrace: 200.5 }).pointsPerTrace).toBe(DEFAULT_SETTINGS.pointsPerTrace);
    expect(parseSettings({ colourTolerance: Number.NaN }).colourTolerance).toBe(DEFAULT_SETTINGS.colourTolerance);
  });

  it('the defaults are the values the app shipped with before Settings existed', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      colourTolerance: 60,
      floodFillThreshold: 40,
      gridRemovalTolerance: 40,
      pointsPerTrace: 500,
      readContourLabels: true,
      labelConfidence: 0.8,
      exportFullPrecision: false,
      decimalComma: false,
    });
  });

  it('every default passes its own limits', () => {
    expect(parseSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});
