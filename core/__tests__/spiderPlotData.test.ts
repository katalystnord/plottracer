import { describe, expect, it } from 'vitest';
import { PlotData } from '../plotData.js';
import { SpiderAxes } from '../axes/spider.js';
import { Calibration } from '../calibration.js';

/**
 * Spider's project-file round trip (v1.4).
 *
 * The interesting part is that a spider's whole calibration is VARIABLE-LENGTH and
 * lives entirely in the calibration points - dx the known value, dy that spoke's own
 * centre value, dz the axis name. So unlike every other axes type, there is no fixed
 * point count to check and nothing spider-specific in the axes entry beyond `isLog`.
 * Two things can silently go wrong and both are asserted below: losing the NAMES
 * (a 2-dimension Calibration drops dz while the numbers still read correctly), and
 * losing the per-spoke CENTRE values (which would only show up on a figure whose
 * centre is not 0).
 */

function buildSpider(isLog = false): SpiderAxes {
  const cal = new Calibration(3);
  cal.addPoint(100, 100, '0', '0', ''); // origin
  cal.addPoint(100, 0, '100', '20', 'Strength');
  cal.addPoint(200, 100, '5', '20', 'Weight');
  cal.addPoint(100, 200, '1000', '20', 'Cost');
  const axes = new SpiderAxes();
  expect(axes.calibrate(cal, isLog)).toBe(true);
  axes.name = 'Spider';
  return axes;
}

/** Serialize through JSON, exactly as engine/projectFile.ts persists it. */
function roundTrip(axes: SpiderAxes): SpiderAxes {
  const plotData = new PlotData();
  plotData.addAxes(axes);
  const json = JSON.parse(JSON.stringify(plotData.serialize()));

  const reloaded = new PlotData();
  // deserialize returns the collected document metadata for a v4 file (and only
  // `false` on a throw) -- not a boolean success flag.
  expect(reloaded.deserialize(json)).not.toBe(false);
  const restored = reloaded.getAxesColl()[0];
  expect(restored).toBeInstanceOf(SpiderAxes);
  return restored as SpiderAxes;
}

describe('SpiderAxes survives a project-file round trip', () => {
  it('writes the SpiderAxes type string the config map reads', () => {
    const plotData = new PlotData();
    plotData.addAxes(buildSpider());
    expect(plotData.serialize().axesColl[0]!.type).toBe('SpiderAxes');
  });

  it('restores every spoke, with its own centre value and name', () => {
    const restored = roundTrip(buildSpider());
    expect(restored.getSpokeCount()).toBe(3);
    expect(restored.getSpokes().map((s) => s.name)).toEqual(['Strength', 'Weight', 'Cost']);
    expect(restored.getSpokes().map((s) => s.knownValue)).toEqual([100, 5, 1000]);
    // ⚑ The per-spoke centre. A file that stored it once would reload these as 0
    // and every value on a truncated-centre figure would be wrong by 20.
    expect(restored.getSpokes().map((s) => s.centreValue)).toEqual([20, 20, 20]);
  });

  it('reads the same VALUES after reloading, on every spoke', () => {
    const original = buildSpider();
    const restored = roundTrip(original);
    for (const [px, py] of [[100, 50], [150, 100], [100, 150], [130, 60]] as const) {
      for (let i = 0; i < 3; i++) {
        expect(restored.projectOnSpoke(i, px, py)!.value).toBeCloseTo(
          original.projectOnSpoke(i, px, py)!.value,
          10
        );
      }
    }
  });

  it('keeps the origin, so distances are measured from the same centre', () => {
    expect(roundTrip(buildSpider()).getOrigin()).toEqual({ x: 100, y: 100 });
  });

  it('carries the log flag - a linear reload would be wrong but plausible', () => {
    const cal = new Calibration(3);
    cal.addPoint(100, 100, '0', '0', '');
    cal.addPoint(100, 0, '100', '1', 'A');
    const axes = new SpiderAxes();
    expect(axes.calibrate(cal, true)).toBe(true);

    const restored = roundTrip(axes);
    expect(restored.isLog()).toBe(true);
    // The midpoint of a 1..100 log spoke is 10. Reloading it linearly gives 50.5 -
    // a number nothing on screen would flag as wrong.
    expect(restored.projectOnSpoke(0, 100, 50)!.value).toBeCloseTo(10, 10);
  });

  it('round-trips a spider of any spoke count, not a fixed one', () => {
    for (const n of [1, 4, 9]) {
      const cal = new Calibration(3);
      cal.addPoint(100, 100, '0', '0', '');
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i) / n;
        cal.addPoint(100 + 100 * Math.sin(angle), 100 - 100 * Math.cos(angle), '10', '0', `A${i}`);
      }
      const axes = new SpiderAxes();
      expect(axes.calibrate(cal, false)).toBe(true);
      expect(roundTrip(axes).getSpokeCount()).toBe(n);
    }
  });

  it('reloads an unnamed spoke as unnamed, not as an invented name', () => {
    const cal = new Calibration(3);
    cal.addPoint(100, 100, '0', '0', '');
    cal.addPoint(100, 0, '10', '0', '');
    const axes = new SpiderAxes();
    expect(axes.calibrate(cal, false)).toBe(true);
    const restored = roundTrip(axes);
    expect(restored.getSpokes()[0]!.name).toBe('');
    expect(restored.getSpokeLabel(0)).toBe('Axis 1');
  });

  it('round-trips the graph-type metadata key alongside the axes', () => {
    // How every graph type that shares an axes class is told apart on reload
    // (histogram/errorbar on XY, categorical/boxplot on Bar). Spider has its own
    // class, but the key rides along the same way and the load path reads it.
    const axes = buildSpider();
    axes.setMetadata({ graphType: 'spider' });
    expect(roundTrip(axes).getMetadata()).toEqual({ graphType: 'spider' });
  });
});
