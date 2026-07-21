import { describe, it, expect } from 'vitest';
import { getPlotData } from '../dataProviders.js';
import { Dataset } from '../dataset.js';
import { XYAxes } from '../axes/xy.js';
import { BarAxes } from '../axes/bar.js';
import { CircularChartRecorderAxes } from '../axes/circularChartRecorder.js';
import { Calibration } from '../calibration.js';

/**
 * Checkpoint 74 — the column contract WPD defines and we never ported.
 *
 * These lock the *contract*, i.e. the exact headers and column order WPD emits,
 * because those are the bytes that reach a downstream consumer. Four live
 * defects were symptoms of the omission; each has a test here.
 */

function xyAxes(): XYAxes {
  const cal = new Calibration(2);
  cal.addPoint(100, 300, '0', '');
  cal.addPoint(400, 300, '10', '');
  cal.addPoint(100, 300, '', '0');
  cal.addPoint(100, 0, '', '10');
  const axes = new XYAxes();
  axes.calibrate(cal, false, false, true);
  return axes;
}

function barAxes(): BarAxes {
  const cal = new Calibration(2);
  cal.addPoint(100, 300, '', '0');
  cal.addPoint(100, 100, '', '100');
  const axes = new BarAxes();
  axes.calibrate(cal, false, false);
  return axes;
}

describe('dataProviders — the column contract (checkpoint 74)', () => {
  describe('Bar axes', () => {
    it('puts Label FIRST — the categorical axis a bar chart IS', () => {
      // The defect this fixes: a plain Bar chart had no labels at all, so its
      // export was bare numbers with nothing saying which bar produced each.
      const ds = new Dataset(1);
      ds.addPixel(150, 200);
      ds.addPixel(250, 150);
      const out = getPlotData(ds, barAxes());
      expect(out.fields).toEqual(['Label', 'Value']);
      expect(out.rawData[0]![0]).toBe('Bar0');
      expect(out.rawData[1]![0]).toBe('Bar1');
    });

    it('uses a stored label over the Bar-N fallback', () => {
      const ds = new Dataset(1);
      ds.setMetadataKeys(['label']);
      ds.addPixel(150, 200, { label: 'Control' });
      const out = getPlotData(ds, barAxes());
      expect(out.rawData[0]![0]).toBe('Control');
    });

    it('is not connectivity-sortable — bars have no curve order', () => {
      const out = getPlotData(new Dataset(1), barAxes());
      expect(out.allowConnectivity).toBe(false);
    });

    it('appends Tuple + Group for a grouped (Box Plot) dataset', () => {
      const ds = new Dataset(1);
      ds.setPointGroups(['Min', 'Q1', 'Median', 'Q3', 'Max']);
      ds.addPixel(150, 250);
      const out = getPlotData(ds, barAxes());
      expect(out.fields).toEqual(['Label', 'Value', 'Tuple', 'Group']);
    });
  });

  describe('General axes', () => {
    it('takes headers from getAxesLabels(), which had ZERO callers', () => {
      // The defect: we hardcoded our own headers and they DIVERGED from WPD's.
      const ds = new Dataset(2);
      ds.addPixel(250, 150);
      const out = getPlotData(ds, xyAxes());
      expect(out.fields).toEqual(['X', 'Y']);
      expect(out.rawData[0]![0]).toBeCloseTo(5, 6);
      expect(out.rawData[0]![1]).toBeCloseTo(5, 6);
    });

    it('emits CCR headers as Time/Magnitude — we wrote t/value', () => {
      // The exact divergence a downstream consumer would have seen.
      const axes = new CircularChartRecorderAxes();
      expect(axes.getAxesLabels()).toEqual(['Time', 'Magnitude']);
    });

    it('allows connectivity and indexes the value dims — the NN-sort precondition', () => {
      const ds = new Dataset(2);
      ds.addPixel(250, 150);
      const out = getPlotData(ds, xyAxes());
      expect(out.allowConnectivity).toBe(true);
      expect(out.connectivityFieldIndices).toEqual([0, 1]);
    });

    it('carries a per-point value override as its own column', () => {
      // WPD keeps the pixel and overrides the reported VALUE. Ours is the
      // semantic opposite (click-to-edit moves the point) — parity gap #7.
      const ds = new Dataset(2);
      ds.setMetadataKeys(['overrides']);
      ds.addPixel(250, 150, { overrides: { y: 99.5 } });
      const out = getPlotData(ds, xyAxes());
      expect(out.fields).toEqual(['X', 'Y', 'X-Override', 'Y-Override']);
      expect(out.rawData[0]![3]).toBe(99.5);
      expect(out.rawData[0]![2]).toBeNull(); // not measured -> null, never 0
    });

    it('omits metadata columns entirely when NO point carries metadata', () => {
      // Faithful to WPD: `metaKeyCount = hasMetadata === true ? … : 0`
      // (dataProviders.js:177), and Dataset.hasMetadata() counts *pixels* with
      // metadata, not declared keys. So declaring a key is not enough — the
      // column only exists once something fills it.
      const ds = new Dataset(2);
      ds.setMetadataKeys(['note']);
      ds.addPixel(250, 150);
      const out = getPlotData(ds, xyAxes());
      expect(out.fields).toEqual(['X', 'Y']);
      expect(out.rawData[0]).toHaveLength(2);
    });

    it('reports an unmeasured value as null once the column DOES exist', () => {
      // With one point carrying metadata, the column exists for every row --
      // and a row without it must read null, never 0.
      const ds = new Dataset(2);
      ds.setMetadataKeys(['note']);
      ds.addPixel(250, 150, { note: 'peak' });
      ds.addPixel(300, 100);
      const out = getPlotData(ds, xyAxes());
      expect(out.fields).toEqual(['X', 'Y', 'Note']);
      expect(out.rawData[0]![2]).toBe('peak');
      expect(out.rawData[1]![2]).toBeNull();
    });
  });
});
