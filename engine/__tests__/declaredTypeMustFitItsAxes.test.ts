/**
 * ⚑⚑ A FILE'S DECLARED GRAPH TYPE HAS TO BE BACKED BY THE AXES IT CARRIES.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-10. The axes CLASS in the file gives a config id,
 * and then ANY string in the axes metadata replaced it, with nothing checking
 * the two agreed. The next thing every door does is `loadCalibrated`, which asks
 * the config for `extractOptions`/`extractGlobalValues` - methods the loaded
 * axes does not have - so the open handler died on an uncaught TypeError.
 * Measured through the real door: ten of fourteen combinations threw
 * (`axes.isLog is not a function`, `axes.getSpokes is not a function`,
 * `axes.getStartTime is not a function`).
 *
 * ⚑⚑ AND THE TWO THAT DID NOT THROW WERE THE WORSE HALF: an XY or Bar axes
 * declaring `pie` opened SILENTLY, `getCalibrationError()` null, as a Pie
 * session sitting on axes that are not a pie's.
 *
 * ⚑ SURFACED, NOT REFUSED. The calibration and every reading belong to the axes
 * class the file names, so opening as that class keeps all of it; refusing would
 * strand a file whose measurements are perfectly good.
 */
import { describe, expect, it } from 'vitest';
import { serializeProject, deserializeProject } from '../projectFile.js';
import {
  CalibrationSession,
  XY_AXES_CONFIG,
  BAR_AXES_CONFIG,
  type CalibratedAxes,
} from '../calibrationSession.js';
import { walkCategoryAxis } from './helpers/categoryWalk.js';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';

function xyFile(): Record<string, unknown> {
  const s = new CalibrationSession<CalibratedAxes>(XY_AXES_CONFIG as never);
  s.handleCalibrationClick(100, 400);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(400, 400);
  s.confirmCalibrationValues(['10']);
  s.handleCalibrationClick(100, 400);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['10']);
  expect(s.runCalibration(), s.getCalibrationError() ?? 'no error').toBe(true);
  s.addDataPoint(250, 250);
  const file = serializeProject(s, 'data:image/png;base64,AA==', 'f.png');
  if ('error' in file) throw new Error(file.error);
  return JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
}

function barFile(): Record<string, unknown> {
  const s = new CalibrationSession<CalibratedAxes>(BAR_AXES_CONFIG as never);
  s.handleCalibrationClick(100, 400);
  s.confirmCalibrationValues(['0']);
  s.handleCalibrationClick(100, 100);
  s.confirmCalibrationValues(['10']);
  walkCategoryAxis(s, { from: { x: 100, y: 400 }, to: { x: 400, y: 400 }, count: 2 });
  expect(s.runCalibration(), s.getCalibrationError() ?? 'no error').toBe(true);
  const file = serializeProject(s, 'data:image/png;base64,AA==', 'f.png');
  if ('error' in file) throw new Error(file.error);
  return JSON.parse(JSON.stringify(file)) as Record<string, unknown>;
}

function declaring(raw: Record<string, unknown>, graphType: string): Record<string, unknown> {
  const file = JSON.parse(JSON.stringify(raw)) as {
    plotData: { axesColl: { metadata?: Record<string, unknown> }[] };
  };
  file.plotData.axesColl[0]!.metadata = {
    ...(file.plotData.axesColl[0]!.metadata ?? {}),
    graphType,
  };
  return file as unknown as Record<string, unknown>;
}

/**
 * Open the way the app does: deserialize, then build the session from the
 * config the FILE resolved to.
 *
 * ⚑ That last part is the point of the whole fix, and my first draft of this
 * helper got it wrong - it passed a fixed config and reproduced the very crash
 * under test, from the test's side rather than the app's. The app reads
 * `back.configId`; so does this.
 */
function openIt(raw: Record<string, unknown>) {
  const back = deserializeProject(raw);
  if ('error' in back) throw new Error(back.error);
  const config = ALL_AXES_TYPE_CONFIGS.find((c) => c.id === back.configId);
  expect(config, `no config for ${back.configId}`).toBeDefined();
  const session = new CalibrationSession<CalibratedAxes>(config as never);
  session.loadCalibrated(back.axes as never, back.datasets, back.categoryAxis);
  return { back, session };
}

describe('a declared graph type must fit the axes the file carries', () => {
  it('⚑⚑ an XY file declaring a type of another class opens as XY, and says so', () => {
    // Every one of these threw an uncaught TypeError through the real door.
    for (const wrong of ['spider', 'bar', 'span', 'boxplot', 'candlestick', 'map', 'ternary', 'polar', 'ccr']) {
      const { back } = openIt(declaring(xyFile(), wrong));
      expect(back.configId, `declared ${wrong}`).toBe('xy');
      expect(back.notice, `declared ${wrong}, said nothing`).toMatch(new RegExp(wrong, 'i'));
    }
  });

  it('⚑⚑ and the silent pair - pie on XY or Bar axes - is caught too', () => {
    // These did NOT throw. They opened clean, calibration error null, as a Pie
    // session sitting on axes that are not a pie's, which is the worse half.
    for (const raw of [xyFile(), barFile()]) {
      const { back, session } = openIt(declaring(raw, 'pie'));
      expect(back.configId, 'opened as a pie on the wrong axes').not.toBe('pie');
      expect(back.notice).toMatch(/pie/i);
      expect(session.getCalibrationError()).toBeNull();
    }
  });

  it('⚑ a type that SHARES the axes class is left alone - the companion assertion', () => {
    // Bar, Span, Box Plot and Candlestick all sit on BarAxes, and a file
    // declaring one of them is telling the truth. A check that refused these
    // would break every v2.5 file there is.
    for (const same of ['bar', 'span', 'boxplot', 'candlestick', 'histogram']) {
      const onBar = ['bar', 'span', 'boxplot', 'candlestick'].includes(same);
      const { back } = openIt(declaring(onBar ? barFile() : xyFile(), same));
      expect(back.configId, `declared ${same}`).toBe(same);
      // ⚑ Not "no notice at all": a BAR file declaring `boxplot` legitimately
      // draws the slot-shape notice, because a bar's two slots are not a box
      // plot's five. What must be absent is the TYPE MISMATCH sentence - this
      // type does fit these axes.
      expect(back.notice ?? '', `declared ${same} and was told it does not fit`).not.toMatch(
        /is not built on/i
      );
    }
  });

  it('⚑ and a file with no declared type still opens as its class', () => {
    const raw = xyFile() as { plotData: { axesColl: { metadata?: Record<string, unknown> }[] } };
    delete raw.plotData.axesColl[0]!.metadata;
    const { back } = openIt(raw as unknown as Record<string, unknown>);
    expect(back.configId).toBe('xy');
    expect(back.notice).toBeUndefined();
  });
});
