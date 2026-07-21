import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readWpdArchive, listWpdFigures, importWpdFigure } from '../wpdImport.js';
/** Narrow a WpdResult, failing the test with its error rather than a cast. */
function ok<T>(r: T | { error: string }): T {
  if (r !== null && typeof r === 'object' && 'error' in r) {
    throw new Error(`expected success, got: ${(r as { error: string }).error}`);
  }
  return r as T;
}

/**
 * Checkpoint 74 — importing a real WebPlotDigitizer project.
 *
 * Everything here runs against **upstream's own fixtures**
 * (`engine/__tests__/fixtures/wpd/*.json`), not files we wrote. The whole point of an
 * importer is reading someone else's bytes; a fixture we authored would only
 * prove we agree with ourselves.
 *
 * `wpd4.json` is a six-figure project (XY, Bar, Polar, Ternary, Map, Image) —
 * which is what real WPD projects look like, and why the picker exists.
 */
const REPO = path.resolve(__dirname, '../..');
const fixture = (f: string): unknown => JSON.parse(fs.readFileSync(path.join(REPO, 'engine/__tests__/fixtures/wpd', f), 'utf8'));

describe('wpdImport — reading real WPD projects (checkpoint 74)', () => {
  describe('listWpdFigures', () => {
    it('lists every figure in upstream\'s own multi-figure fixture', () => {
      const { figures } = ok(listWpdFigures(fixture('wpd4.json')));
      expect(figures.map((f) => f.axesType)).toEqual([
        'XYAxes', 'BarAxes', 'PolarAxes', 'TernaryAxes', 'MapAxes', 'ImageAxes',
      ]);
      expect(figures.map((f) => f.name)).toEqual([
        'xy axes', 'Bar', 'Polar', 'Ternary', 'Map', 'Image',
      ]);
    });

    it('maps each figure to our graph type, and says so when it cannot', () => {
      const { figures } = ok(listWpdFigures(fixture('wpd4.json')));
      expect(figures.map((f) => f.configId)).toEqual(['xy', 'bar', 'polar', 'ternary', 'map', null]);
      // Honest about the one we can't open, rather than hiding or guessing it.
      expect(figures[5]!.unsupportedReason).toMatch(/Image \(raw pixel\) axes aren't supported yet/);
      expect(figures[0]!.unsupportedReason).toBeNull();
    });

    it('binds each dataset to its OWN figure — not all datasets to the first', () => {
      // The bug a naive import would have: taking getDatasets() wholesale.
      const { figures } = ok(listWpdFigures(fixture('wpd4.json')));
      expect(figures[0]!.datasetNames).toEqual(['xy data']);
      expect(figures[1]!.datasetNames).toEqual(['bar data']);
      expect(figures[3]!.datasetNames).toEqual(['ternary data']);
    });

    it('reads a PRE-v4 project — the legacy deserializer nobody could reach', () => {
      // ~100 lines of carefully-ported legacy handling in core/plotData.ts that
      // was 100% unreachable behind the old gate. wpd3_xy.json's envelope is
      // {wpd: ...}, not {version: ...}.
      const { figures } = ok(listWpdFigures(fixture('wpd3_xy.json')));
      expect(figures.length).toBeGreaterThan(0);
      expect(figures[0]!.configId).toBe('xy');
    });

    it('reads a pre-v4 BAR project', () => {
      const { figures } = ok(listWpdFigures(fixture('wpd3_bar.json')));
      expect(figures[0]!.configId).toBe('bar');
    });

    it('refuses a non-project rather than importing nothing quietly', () => {
      expect(listWpdFigures({ hello: 'world' })).toHaveProperty('error');
      expect(listWpdFigures(null)).toHaveProperty('error');
    });
  });

  describe('importWpdFigure', () => {
    it('opens a chosen figure with only its own datasets, calibrated', () => {
      const { plotData, figures } = ok(listWpdFigures(fixture('wpd4.json')));
      const fig = ok(importWpdFigure(plotData, figures, 0));
      expect(fig.configId).toBe('xy');
      expect(fig.datasets.map((d) => d.name)).toEqual(['xy data']);
      expect(fig.datasets[0]!.getCount()).toBe(144); // real traced points
      // The axes must arrive calibrated, or the figure is useless.
      expect(fig.axes.pixelToData(100, 100).length).toBeGreaterThan(0);
    });

    it('opens the FOURTH figure when asked — the picker\'s whole purpose', () => {
      const { plotData, figures } = ok(listWpdFigures(fixture('wpd4.json')));
      const fig = ok(importWpdFigure(plotData, figures, 3));
      expect(fig.configId).toBe('ternary');
      expect(fig.datasets.map((d) => d.name)).toEqual(['ternary data']);
    });

    it('refuses an unsupported figure by name instead of importing something else', () => {
      const { plotData, figures } = ok(listWpdFigures(fixture('wpd4.json')));
      const r = importWpdFigure(plotData, figures, 5) as { error: string };
      expect(r.error).toMatch(/Can't open "Image"/);
      expect(r.error).toMatch(/Image \(raw pixel\) axes/);
    });
  });

  describe('readWpdArchive (.tar — the format that carries the image)', () => {
    let tarBytes: Uint8Array;

    beforeAll(() => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plottracer-wpdtar-'));
      const proj = path.join(dir, 'my paper fig3');
      fs.mkdirSync(proj);
      fs.copyFileSync(path.join(REPO, 'engine/__tests__/fixtures/wpd/wpd4.json'), path.join(proj, 'wpd.json'));
      fs.writeFileSync(path.join(proj, 'info.json'), '{"version":[4,0],"json":"wpd.json","images":["figure.png"]}');
      fs.copyFileSync(path.join(REPO, 'samples/errorbar-tensile-cure.png'), path.join(proj, 'figure.png'));
      execFileSync('tar', ['-cf', 'p.tar', 'my paper fig3/'], { cwd: dir });
      tarBytes = new Uint8Array(fs.readFileSync(path.join(dir, 'p.tar')));
    });

    it('finds the project by its info.json — the folder name is not fixed', () => {
      const arc = ok(readWpdArchive(tarBytes));
      expect((arc.wpdJson as { version: number[] }).version).toEqual([4, 0]);
    });

    it('recovers the bundled image, which a bare .json never carries', () => {
      const arc = ok(readWpdArchive(tarBytes));
      expect(arc.images.map((i) => i.name)).toEqual(['figure.png']);
      expect(arc.images[0]!.mime).toBe('image/png');
      expect(arc.images[0]!.bytes.length).toBeGreaterThan(1000);
    });

    it('feeds straight into the picker — tar to figures, end to end', () => {
      const arc = ok(readWpdArchive(tarBytes));
      const { figures } = ok(listWpdFigures(arc.wpdJson));
      expect(figures).toHaveLength(6);
    });

    it('refuses a tar that is not a WPD project, by name', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plottracer-nottar-'));
      fs.writeFileSync(path.join(dir, 'hello.txt'), 'not a project');
      execFileSync('tar', ['-cf', 'x.tar', 'hello.txt'], { cwd: dir });
      const r = readWpdArchive(new Uint8Array(fs.readFileSync(path.join(dir, 'x.tar'))));
      expect(r).toHaveProperty('error');
      expect((r as { error: string }).error).toMatch(/no info\.json/);
    });
  });
});
