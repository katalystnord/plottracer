import { describe, expect, it } from 'vitest';
import {
  CalibrationSession,
  XY_AXES_CONFIG,
  BAR_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
} from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';

/**
 * Checkpoint 92 — the right-panel table's value-column headers come from the
 * same source the export does, so the screen and the file cannot disagree.
 *
 * The bug it closes: the table drove off `config.valueLabels`, which had
 * diverged from the axes' own labels (what the file uses) -- CCR showed
 * `t`/`value` on screen but wrote `Time`/`Magnitude`; Ternary `A`/`B`/`C` vs
 * `a`/`b`/`c`.
 */
function calibrateStdXY(s: CalibrationSession<XYAxes>) {
  const steps: Array<[number, number, string]> = [
    [100, 300, '0'],
    [400, 300, '10'],
    [100, 300, '0'],
    [100, 100, '10'],
  ];
  for (const [px, py, v] of steps) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  expect(s.runCalibration()).toBe(true);
}

describe('getTableValueLabels — table headers match the file', () => {
  it('for CCR, shows Time/Magnitude (what the file writes), not t/value', () => {
    // The exact 5-step CCR calibration the engine's own suite uses.
    const s = new CalibrationSession(CIRCULAR_CHART_RECORDER_AXES_CONFIG);
    expect(s.handleCalibrationClick(200, 200)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues(['2024-01-01 00:00', '1'])).toBe(true);
    expect(s.handleCalibrationClick(400, 200)).toBe('point-placed');
    expect(s.handleCalibrationClick(300, 100)).toBe('awaiting-value');
    expect(s.confirmCalibrationValues(['10'])).toBe(true);
    expect(s.handleCalibrationClick(200, 400)).toBe('point-placed');
    expect(s.handleCalibrationClick(400, 400)).toBe('point-placed');
    s.setGlobalFieldValue('startTime', '2024-01-01 00:00'); // CCR's Chart Start Time
    expect(s.runCalibration()).toBe(true);

    // The whole point of the fix: table == file, and NOT the old diverged labels.
    expect(s.getTableValueLabels()).toEqual(s.getExportFields());
    expect(s.getExportFields()).toEqual(['Time', 'Magnitude']);
    expect(s.getTableValueLabels()).not.toContain('t'); // the old config.valueLabels
    expect(s.getTableValueLabels()).not.toContain('value');
  });

  it('for Ternary, matches the file (a/b/c), not A/B/C', () => {
    // Ternary steps carry no value fields -> each click is 'point-placed'.
    const s = new CalibrationSession(TERNARY_AXES_CONFIG);
    expect(s.handleCalibrationClick(100, 300)).toBe('point-placed');
    expect(s.handleCalibrationClick(100, 100)).toBe('point-placed');
    expect(s.handleCalibrationClick(300, 300)).toBe('point-placed');
    expect(s.runCalibration()).toBe(true);

    expect(s.getTableValueLabels()).toEqual(s.getExportFields());
    // config.valueLabels was ['A','B','C']; the file (and now the table) is lower.
    expect(s.getTableValueLabels()).toEqual(['a', 'b', 'c']);
  });

  it('for Bar, is the last dataDim of the labels — drops the leading Label', () => {
    const s = new CalibrationSession(BAR_AXES_CONFIG);
    for (const [px, py, v] of [[100, 300, '0'], [100, 100, '10']] as const) {
      s.handleCalibrationClick(px, py);
      s.confirmCalibrationValues([v]);
    }
    expect(s.runCalibration()).toBe(true);
    const table = s.getTableValueLabels();
    const file = s.getExportFields();
    // The table shows only the VALUE dimension (dataDim = 1); the file also
    // carries the leading Label. The value column's name is the file's last.
    expect(table).toHaveLength(1);
    expect(table[0]).toBe(file[file.length - 1]);
    expect(table).not.toContain('Label');
  });

  it('for XY, is X/Y and identical to the file', () => {
    const s = new CalibrationSession(XY_AXES_CONFIG);
    calibrateStdXY(s);
    expect(s.getTableValueLabels()).toEqual(['X', 'Y']);
    expect(s.getTableValueLabels()).toEqual(s.getExportFields());
  });

  it('falls back to config.valueLabels before calibration', () => {
    const s = new CalibrationSession(CIRCULAR_CHART_RECORDER_AXES_CONFIG);
    expect(s.getTableValueLabels()).toEqual([...CIRCULAR_CHART_RECORDER_AXES_CONFIG.valueLabels]);
  });
});
