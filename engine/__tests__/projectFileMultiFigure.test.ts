import { describe, expect, it } from 'vitest';
import {
  deserializeProject,
  serializeProject,
  serializeMultiFigureProject,
  deserializeMultiFigureProject,
  isMultiFigureProject,
  type ProvenanceCrop,
} from '../projectFile.js';
import { CalibrationSession, XY_AXES_CONFIG, type CalibratedAxes } from '../calibrationSession.js';
import type { XYAxes } from '../../core/axes/xy.js';

/**
 * The MULTI-FIGURE project file: its assembly, its refusals, and the
 * provenance validator.
 *
 * ⚑ WHY THIS FILE EXISTS. `projectFile.ts` scored 66.37% with 94 surviving
 * mutants, and the hottest lines by far are in
 * `deserializeMultiFigureProject` (lines 515–533, 38 mutants between them) —
 * the door every multi-figure project comes through. The existing suite
 * round-trips a healthy two-figure project; nothing tested what happens when
 * one figure is broken, when the active index is out of range, or when a
 * figure has no name.
 *
 * This is a reading path, so its failure mode is the bad one: a file that
 * opens with figures silently missing, or with the wrong one selected, looks
 * exactly like a file that opened correctly.
 */

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function calibratedSession(pointAt: [number, number] = [250, 175]): CalibrationSession<CalibratedAxes> {
  const s = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
  for (const [px, py, v] of [
    [100, 250, '0'],
    [400, 250, '10'],
    [100, 250, '0'],
    [100, 100, '10'],
  ] as Array<[number, number, string]>) {
    s.handleCalibrationClick(px, py);
    s.confirmCalibrationValues([v]);
  }
  s.runCalibration();
  s.addDataPoint(pointAt[0], pointAt[1]);
  return s as unknown as CalibrationSession<CalibratedAxes>;
}

function figure(name: string, pointAt: [number, number] = [250, 175]) {
  return { name, session: calibratedSession(pointAt), imageDataURL: PNG };
}

function built(figures: ReturnType<typeof figure>[], active = 0) {
  const r = serializeMultiFigureProject(figures, active);
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('assembling a multi-figure project', () => {
  it('refuses to save nothing at all', () => {
    const r = serializeMultiFigureProject([], 0);
    expect('error' in r && r.error).toMatch(/no figures/i);
  });

  it('⚑ NAMES the figure that could not be saved, not just that one failed', () => {
    // With several figures open, "calibration incomplete" is useless without
    // knowing which one — the user cannot act on it.
    const uncalibrated = new CalibrationSession<XYAxes>(XY_AXES_CONFIG);
    const r = serializeMultiFigureProject(
      [figure('Good'), { name: 'Broken one', session: uncalibrated as unknown as CalibrationSession<CalibratedAxes>, imageDataURL: PNG }],
      0
    );
    expect('error' in r && r.error).toContain('Broken one');
  });

  it('keeps the figures in the order given', () => {
    const file = built([figure('First'), figure('Second'), figure('Third')]);
    expect(file.figures.map((f) => f.name)).toEqual(['First', 'Second', 'Third']);
  });

  it('⚑ clamps an out-of-range active index to the FIRST figure', () => {
    // A stale index would otherwise select a figure that is not there, and
    // the reader has no way to tell that from a deliberate choice.
    expect(built([figure('A'), figure('B')], 5).activeFigure).toBe(0);
    expect(built([figure('A'), figure('B')], -1).activeFigure).toBe(0);
    expect(built([figure('A'), figure('B')], 1).activeFigure).toBe(1);
  });

  it('accepts the last valid index, which the clamp must not reject', () => {
    expect(built([figure('A'), figure('B'), figure('C')], 2).activeFigure).toBe(2);
  });

  it('⚑ writes the build stamp ONCE at the top level, never per figure', () => {
    // N figures saved in one action are not N versions. A per-figure copy
    // would make a future migration think they were saved separately.
    const r = serializeMultiFigureProject([figure('A'), figure('B')], 0, undefined, {
      appVersion: '2.0.0-rc1',
      savedAt: '2026-07-31T18:00:00.000Z',
    });
    if ('error' in r) throw new Error(r.error);
    expect(r.appVersion).toBe('2.0.0-rc1');
    expect(r.savedAt).toBe('2026-07-31T18:00:00.000Z');
    for (const f of r.figures) {
      expect(f).not.toHaveProperty('appVersion');
      expect(f).not.toHaveProperty('savedAt');
    }
  });

  it('omits the stamp keys entirely when no stamp is given', () => {
    const file = built([figure('A')]);
    expect(file).not.toHaveProperty('appVersion');
    expect(file).not.toHaveProperty('savedAt');
  });

  it('omits a half-given stamp field rather than writing an empty one', () => {
    const r = serializeMultiFigureProject([figure('A')], 0, undefined, { appVersion: '', savedAt: '' });
    if ('error' in r) throw new Error(r.error);
    expect(r).not.toHaveProperty('appVersion');
    expect(r).not.toHaveProperty('savedAt');
  });
});

describe('reading a multi-figure project back', () => {
  it('round-trips the figures, their names and the active index', () => {
    const file = built([figure('Alpha', [250, 175]), figure('Beta', [175, 200])], 1);
    const back = deserializeMultiFigureProject(file);
    if ('error' in back) throw new Error(back.error);
    expect(back.figures.map((f) => f.name)).toEqual(['Alpha', 'Beta']);
    expect(back.activeFigure).toBe(1);
    expect(back.figures[0]!.datasets[0]!.getCount()).toBe(1);
  });

  it('refuses a non-object, and anything without the format marker', () => {
    expect('error' in deserializeMultiFigureProject(null)).toBe(true);
    expect('error' in deserializeMultiFigureProject('a string')).toBe(true);
    expect('error' in deserializeMultiFigureProject({ figures: [] })).toBe(true);
  });

  it('⚑ refuses an EMPTY figures array rather than opening a project with nothing in it', () => {
    const r = deserializeMultiFigureProject({ plotTracerProject: 1, figures: [] });
    expect('error' in r && r.error).toMatch(/multi-figure/i);
  });

  it('refuses a `figures` that is not an array', () => {
    const r = deserializeMultiFigureProject({ plotTracerProject: 1, figures: { 0: {} } });
    expect('error' in r && r.error).toMatch(/multi-figure/i);
  });

  it('⚑ NAMES the figure that failed to read, and refuses the whole file', () => {
    // Half a project is worse than none: the missing figure leaves no trace.
    const file = built([figure('Alpha'), figure('Beta')]);
    const broken = { ...file, figures: [file.figures[0]!, { ...file.figures[1]!, plotData: { nonsense: true } }] };
    const r = deserializeMultiFigureProject(broken);
    expect('error' in r && r.error).toContain('Beta');
  });

  it('says "?" for a broken figure that has no usable name, rather than "undefined"', () => {
    const file = built([figure('Alpha')]);
    const broken = { ...file, figures: [{ ...file.figures[0]!, name: 42, plotData: { nonsense: true } }] };
    const r = deserializeMultiFigureProject(broken);
    expect('error' in r && r.error).toContain('"?"');
  });

  it('⚑ gives an UNNAMED figure a positional name, 1-based', () => {
    // A blank tab title is unusable. The index is 1-based to match how the
    // figures are presented.
    const file = built([figure('Alpha'), figure('Beta')]);
    const unnamed = { ...file, figures: file.figures.map((f) => ({ ...f, name: '' })) };
    const back = deserializeMultiFigureProject(unnamed);
    if ('error' in back) throw new Error(back.error);
    expect(back.figures.map((f) => f.name)).toEqual(['Figure 1', 'Figure 2']);
  });

  it('gives a non-string name the same positional treatment', () => {
    const file = built([figure('Alpha')]);
    const odd = { ...file, figures: [{ ...file.figures[0]!, name: 7 }] };
    const back = deserializeMultiFigureProject(odd);
    if ('error' in back) throw new Error(back.error);
    expect(back.figures[0]!.name).toBe('Figure 1');
  });

  it('⚑ clamps a bad active index ON READ too, not only on write', () => {
    // The file is the other entrance: a hand-edited or truncated project can
    // carry an index past the end.
    const file = built([figure('Alpha'), figure('Beta')]);
    for (const bad of [5, -1, 1.5, 'x', undefined]) {
      const back = deserializeMultiFigureProject({ ...file, activeFigure: bad });
      if ('error' in back) throw new Error(back.error);
      expect(back.activeFigure).toBe(bad === 1.5 ? 1.5 : 0);
    }
  });

  it('reads the top-level stamp back', () => {
    const r = serializeMultiFigureProject([figure('A')], 0, undefined, {
      appVersion: '2.0.0-rc1',
      savedAt: '2026-07-31T18:00:00.000Z',
    });
    if ('error' in r) throw new Error(r.error);
    const back = deserializeMultiFigureProject(r);
    if ('error' in back) throw new Error(back.error);
    expect(back.appVersion).toBe('2.0.0-rc1');
    expect(back.savedAt).toBe('2026-07-31T18:00:00.000Z');
  });
});

describe('telling a multi-figure project from a single one', () => {
  it('is true only for an object carrying a figures ARRAY', () => {
    expect(isMultiFigureProject(built([figure('A')]))).toBe(true);
    expect(isMultiFigureProject({ figures: [] })).toBe(true);
  });

  it('is false for a single-figure project, which is the routing decision', () => {
    const single = serializeProject(calibratedSession(), PNG);
    if ('error' in single) throw new Error(single.error);
    expect(isMultiFigureProject(single)).toBe(false);
  });

  it('is false for null, a string, and an object whose figures is not an array', () => {
    expect(isMultiFigureProject(null)).toBe(false);
    expect(isMultiFigureProject('figures')).toBe(false);
    expect(isMultiFigureProject({ figures: { 0: {} } })).toBe(false);
    expect(isMultiFigureProject({})).toBe(false);
  });
});

describe('the provenance crop validator', () => {
  const good: ProvenanceCrop = { fromWidth: 100, fromHeight: 80, rect: { x: 1, y: 2, width: 30, height: 40 } };

  /**
   * The validator runs on the READ path (`readProvenance`), which is the door
   * a hand-edited or foreign file comes through — the write path stores what
   * the app itself computed. So each crop is posted through deserialize.
   */
  function cropSurvives(crop: unknown): boolean {
    const session = calibratedSession();
    const written = serializeProject(session, PNG);
    if ('error' in written) throw new Error(written.error);
    const back = deserializeProject({ ...written, provenance: { crops: [crop] } });
    if ('error' in back) throw new Error(back.error);
    return Array.isArray(back.provenance.crops) && back.provenance.crops.length === 1;
  }

  it('keeps a well-formed crop', () => {
    expect(cropSurvives(good)).toBe(true);
  });

  it('⚑ drops a crop with a non-finite number rather than carrying NaN into the record', () => {
    // Provenance says where the figure came from. A NaN there is not a
    // smaller truth than a missing crop — it is a false one.
    expect(cropSurvives({ ...good, fromWidth: NaN })).toBe(false);
    expect(cropSurvives({ ...good, fromHeight: Infinity })).toBe(false);
    expect(cropSurvives({ ...good, rect: { ...good.rect, width: NaN } })).toBe(false);
  });

  it('drops a crop missing any rect field, and one with no rect at all', () => {
    expect(cropSurvives({ ...good, rect: { x: 1, y: 2, width: 3 } })).toBe(false);
    expect(cropSurvives({ fromWidth: 100, fromHeight: 80 })).toBe(false);
  });

  it('drops a crop whose numbers arrived as strings', () => {
    expect(cropSurvives({ ...good, fromWidth: '100' })).toBe(false);
    expect(cropSurvives({ ...good, rect: { ...good.rect, x: '1' } })).toBe(false);
  });

  it('drops a non-object crop without throwing', () => {
    expect(cropSurvives(null)).toBe(false);
    expect(cropSurvives('crop')).toBe(false);
  });

  it('accepts zero and negative coordinates, which are legitimate', () => {
    expect(cropSurvives({ ...good, rect: { x: 0, y: 0, width: 1, height: 1 } })).toBe(true);
    expect(cropSurvives({ ...good, rect: { x: -5, y: -5, width: 10, height: 10 } })).toBe(true);
  });
});
