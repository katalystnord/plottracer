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
      agentsEnabled: false,
      agentFolder: '',
      agentMaySave: false,
      agentStartMode: 'rounds',
      agentRoundSize: 5,
    });
  });

  it('S13 / M6 / M10: no folder is chosen and agents may not save until the user says so', () => {
    expect(DEFAULT_SETTINGS.agentFolder).toBe('');
    expect(DEFAULT_SETTINGS.agentMaySave).toBe(false);
    expect(parseSettings({ agentFolder: '/home/me/figures', agentMaySave: true })).toMatchObject({ agentFolder: '/home/me/figures', agentMaySave: true });
    expect(parseSettings({ agentFolder: 7, agentMaySave: 'yes' })).toMatchObject({ agentFolder: '', agentMaySave: false });
  });

  it('S13: the folder and may-save rows sit under the agent switch, shown only while it is on', () => {
    const under = SETTING_SPECS.filter((s) => s.under === 'agentsEnabled').map((s) => s.key);
    expect(under).toEqual(['agentFolder', 'agentMaySave', 'agentStartMode', 'agentRoundSize']);
  });

  it('R10: an agent starts in rounds of 5 unless the user chose otherwise', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ agentStartMode: 'rounds', agentRoundSize: 5 });
    expect(parseSettings({ agentStartMode: 'automatic', agentRoundSize: 3 })).toMatchObject({ agentStartMode: 'automatic', agentRoundSize: 3 });
    expect(parseSettings({ agentStartMode: 'fast', agentRoundSize: 0 })).toMatchObject({ agentStartMode: 'rounds', agentRoundSize: 5 });
  });

  it('M1: agents are off until the user turns them on', () => {
    expect(DEFAULT_SETTINGS.agentsEnabled).toBe(false);
    expect(parseSettings({ agentsEnabled: 'yes' }).agentsEnabled).toBe(false);
    expect(parseSettings({ agentsEnabled: true }).agentsEnabled).toBe(true);
  });

  it('every default passes its own limits', () => {
    expect(parseSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});
