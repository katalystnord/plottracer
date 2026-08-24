import { describe, it, expect } from 'vitest';
import {
  guidanceTip,
  guidanceTipBase,
  noPointsHint,
  type GuidanceTipInput,
  type GuidanceConfig,
} from '../guidanceTip.js';
import { autoExtractModesFor, AUTO_EXTRACT_MODES, type ToolMode } from '../toolMode.js';
import {
  XY_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  HEATMAP_AXES_CONFIG,
  BAR_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  POLAR_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
  MAP_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
  SPIDER_AXES_CONFIG,
  PIE_AXES_CONFIG,
} from '../axesTypeConfigs.js';

/** Every graph type the picker offers - the real configs, not stand-ins. */
const ALL_CONFIGS: readonly GuidanceConfig[] = [
  XY_AXES_CONFIG,
  HISTOGRAM_AXES_CONFIG,
  HEATMAP_AXES_CONFIG,
  BAR_AXES_CONFIG,
  CATEGORICAL_LINE_CONFIG,
  BOX_PLOT_AXES_CONFIG,
  POLAR_AXES_CONFIG,
  TERNARY_AXES_CONFIG,
  MAP_AXES_CONFIG,
  CIRCULAR_CHART_RECORDER_AXES_CONFIG,
  SPIDER_AXES_CONFIG,
  PIE_AXES_CONFIG,
];

const ALL_MODES: readonly ToolMode[] = [
  'pan',
  'calibrate',
  'place-point',
  'select',
  'eraser',
  'segment-fill',
  'color-trace',
  'measure',
  'image-edit',
  'error-bars',
  'interpolate',
];

/** A calibrated XY chart, nothing selected, nothing pending - the quiet base state. */
function base(over: Partial<GuidanceTipInput> = {}): GuidanceTipInput {
  return {
    canvasHasImage: true,
    mode: 'pan',
    figureCaptured: true,
    eyedropper: null,
    cropMode: false,
    hasCropRect: false,
    hasActiveMeasure: false,
    settingScale: false,
    pendingMeasureCount: 0,
    hasScaleDraft: false,
    measureError: null,
    measureTool: null,
    measureScaleUnit: null,
    isCalibrated: true,
    config: XY_AXES_CONFIG,
    isCalibrating: false,
    hasPendingPixel: false,
    currentStep: null,
    pendingValueFieldCount: 1,
    stepIndex: 0,
    stepCount: 4,
    selectedPointCount: 0,
    dataPointCount: 3,
    activePointIndex: null,
    activePointIsAnchor: false,
    hasActiveHandle: false,
    hasSlots: false,
    currentGroupLabel: '',
    currentTupleIndex: null,
    tupleNoun: 'box',
    captureProgressText: null,
    ...over,
  };
}

describe('guidanceTip - the pre-capture gates come first', () => {
  it('asks for an image before anything else, whatever the tool', () => {
    for (const mode of ALL_MODES) {
      expect(guidanceTip(base({ canvasHasImage: false, mode }))).toContain('Open an image to begin');
    }
  });

  it('sends an uncaptured figure to Capture, and names the EDIT tool by its real slot', () => {
    const tip = guidanceTip(base({ figureCaptured: false, mode: 'pan' }));
    expect(tip).toContain('press Capture');
    // ⚑ Read "(tool 9)" until the v1.3 gate -- 9 is Geometry, Edit image is 2.
    // The first line every first-run user reads pointed at the wrong rail slot
    // for three releases. Assert the NUMBER, since that is what rotted.
    expect(tip).toContain('(tool 2)');
    expect(tip).not.toContain('(tool 9)');
  });

  it('image-edit before capture talks about prepping the source, not about cropping later', () => {
    expect(guidanceTip(base({ figureCaptured: false, mode: 'image-edit' }))).toContain('Prep the source');
  });
});

describe('guidanceTip - measure', () => {
  it('gates Slope on the axes CLASS, so a calibrated histogram is not refused', () => {
    // ⚑ The round-2 audit defect: this branch asked `config.id`, so on a
    // HISTOGRAM the slope tool worked, the Measure card agreed it worked, and
    // this line alone said "calibrate an XY chart first".
    const hist = guidanceTip(base({ mode: 'measure', measureTool: 'slope', config: HISTOGRAM_AXES_CONFIG }));
    expect(hist).toContain('click the first point on the line');
    expect(hist).not.toContain('calibrate an XY chart first');

    const polar = guidanceTip(base({ mode: 'measure', measureTool: 'slope', config: POLAR_AXES_CONFIG }));
    expect(polar).toContain('calibrate an XY chart first');
  });

  it('refuses Slope on an XY chart that is not calibrated yet', () => {
    expect(
      guidanceTip(base({ mode: 'measure', measureTool: 'slope', isCalibrated: false }))
    ).toContain('calibrate an XY chart first');
  });

  it('names the real unit once a scale is set, and offers Set scale until then', () => {
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'distance' }))).toContain(
      'use Set scale for real units'
    );
    expect(
      guidanceTip(base({ mode: 'measure', measureTool: 'distance', measureScaleUnit: 'mm' }))
    ).toContain('measuring in mm');
  });

  it('counts the points already down, for every multi-click tool', () => {
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'distance', pendingMeasureCount: 0 }))).toContain(
      'Distance - click the first point'
    );
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'distance', pendingMeasureCount: 1 }))).toContain(
      'click the second point'
    );
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'angle', pendingMeasureCount: 0 }))).toContain(
      'click the vertex'
    );
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'angle', pendingMeasureCount: 1 }))).toContain(
      'the first arm'
    );
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'angle', pendingMeasureCount: 2 }))).toContain(
      'the second arm'
    );
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'area', pendingMeasureCount: 2 }))).toContain(
      '2 placed; need 3+'
    );
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'area', pendingMeasureCount: 3 }))).toContain(
      'Finish (or Enter) to close'
    );
  });

  it('a selected vertex surfaces the arrow keys - the only place they are advertised', () => {
    // The keystone rule: a keyboard-only path the user never sees does not exist.
    expect(guidanceTip(base({ mode: 'measure', hasActiveMeasure: true }))).toContain('↑ ↓ ← → nudge');
  });

  it('set-scale outranks a selected vertex, and the draft outranks the clicks', () => {
    const placing = guidanceTip(base({ mode: 'measure', hasActiveMeasure: true, settingScale: true }));
    expect(placing).toContain('click the first point of a known distance');
    const drafted = guidanceTip(base({ mode: 'measure', settingScale: true, hasScaleDraft: true }));
    expect(drafted).toContain('type the real distance');
  });

  it('an error replaces the instruction rather than sitting beside it', () => {
    expect(guidanceTip(base({ mode: 'measure', measureError: 'Pick two points' }))).toBe('⚠ Pick two points');
  });
});

describe('guidanceTip - calibration', () => {
  it('counts the step from 1, not 0', () => {
    const tip = guidanceTip(
      base({
        isCalibrating: true,
        currentStep: { label: 'X1', prompt: 'click the first x tick' },
        stepIndex: 0,
        stepCount: 4,
      })
    );
    expect(tip).toContain('Calibration step 1/4 - X1: click the first x tick');
  });

  it('agrees with itself about plurality when a step asks for two values', () => {
    const one = guidanceTip(
      base({ isCalibrating: true, hasPendingPixel: true, currentStep: { label: 'X1', prompt: 'p' }, pendingValueFieldCount: 1 })
    );
    const two = guidanceTip(
      base({ isCalibrating: true, hasPendingPixel: true, currentStep: { label: 'P1', prompt: 'p' }, pendingValueFieldCount: 2 })
    );
    // ⚑ The step's LABEL is no longer repeated in the instruction - D1 made the
    // line additive, so it already reads "… - X1: <prompt> - enter the value…".
    // Saying "the X1 value" again after that is the same word twice in one
    // sentence. The plurality, which is what this test is about, is unchanged.
    expect(one).toContain('X1:');
    expect(one).toContain('. Enter the value, then press Confirm.');
    expect(two).toContain('P1:');
    expect(two).toContain('. Enter the values, then press Confirm.');
  });

  it('⚑⚑ D1 - the step\u2019s own prompt SURVIVES the pending pixel', () => {
    // 🔴 The prompt is what says WHAT to type. Once a pixel was pending the tips
    // bar dropped it entirely and showed a generic *"Enter the Y1 values, then
    // press Confirm"* - at exactly the moment the user is typing them.
    //
    // ⚠️⚠️ AND ON A PRE-PLACED STEP IT WAS SHOWN TO NOBODY, EVER. The heatmap's
    // shared corner arrives with y1 already placed, so `hasPendingPixel` is true
    // the instant the step opens: *"The same corner again - enter the Y value
    // where the outer EDGE of the FIRST column meets the outer EDGE of the FIRST
    // row"* was authored, unit-tested at the config level, and dead on screen.
    // That is the step David flagged on day one - *"the text for shared origin
    // is misleading or incorrect"* - and it was not misleading, it was absent.
    //
    // ⚑ THE LESSON, not just the bug: a unit test proving `stepsForOptions`
    // returns the right sentence proves nothing REACHED THE SCREEN. Same shape
    // as gate 3 - satisfied in the config, unenforced where the user is.
    const tip = guidanceTip(
      base({
        isCalibrating: true,
        hasPendingPixel: true,
        currentStep: { label: 'Y1', prompt: 'The same corner again - enter the Y value there' },
        pendingValueFieldCount: 1,
      })
    );
    expect(tip).toContain('The same corner again - enter the Y value there');
    expect(tip, 'and what to do with it').toContain('. Enter the value, then press Confirm.');
  });

  it('⚑⚑ D2 - a REUSED corner stops telling the user to click it', () => {
    // ⚠️ SEEN ON THE BUILT APP once D1 made the prompt visible. Step 3 of an XY
    // walk reads:
    //
    //   "Calibration step 3/4 - Y1: Click the pixel position of a known Y value
    //    (e.g. Y=0). Enter the value, then press Confirm."
    //
    // The pixel is ALREADY PLACED - `commonOrigin` reuses the X1 corner, which
    // is why the confirm half appears at all - so the screen asks for a click
    // that already happened, and asks for a value in the same breath.
    //
    // ⚑ IT IS ALSO WHY `calibrateXYStandard` CLICKS FOUR TIMES. That walk is
    // faithful to what the screen says; the SCREEN is what is wrong. Gate 4 read
    // from the other end: a prompt that describes a click the user does not make
    // will produce a test that makes it.
    //
    // ⚑ Heatmap's shared corner authored its own sentence for this state ("The
    // same corner again..."), which is exactly right and stays. The generic one
    // below is for the types that never wrote one.
    const tip = guidanceTip(
      base({
        isCalibrating: true,
        hasPendingPixel: true,
        pixelReusedFrom: 'X1',
        stepIndex: 2,
        stepCount: 4,
        currentStep: { label: 'Y1', prompt: 'Click the pixel position of a known Y value (e.g. Y=0)' },
        pendingValueFieldCount: 1,
      })
    );
    expect(tip, 'no instruction to click').not.toMatch(/[Cc]lick/);
    expect(tip, 'says where the pixel came from').toContain('X1');
    expect(tip).toContain('Enter the value, then press Confirm.');
    expect(tip, 'and still says where you are').toContain('step 3/4');
  });

  it('⚑ a step the user really did click keeps its own prompt', () => {
    // The companion assertion. Only a REUSED pixel suppresses the instruction;
    // a pixel the user placed themselves is still described by the type's own
    // sentence, which is D1's whole point.
    const tip = guidanceTip(
      base({
        isCalibrating: true,
        hasPendingPixel: true,
        currentStep: { label: 'Y1', prompt: 'Click the pixel position of a known Y value (e.g. Y=0)' },
        pendingValueFieldCount: 1,
      })
    );
    expect(tip).toContain('Click the pixel position of a known Y value');
  });

  it('⚑ it still names the step and its place in the walk', () => {
    // The other half of what the generic line threw away: which step this is,
    // and how many are left. A user mid-walk should not have to reopen the card
    // to find out where they are.
    const tip = guidanceTip(
      base({
        isCalibrating: true,
        hasPendingPixel: true,
        stepIndex: 2,
        stepCount: 8,
        currentStep: { label: 'Y1', prompt: 'click the origin' },
        pendingValueFieldCount: 1,
      })
    );
    expect(tip).toContain('Calibration step 3/8 - Y1');
  });

  it('lets Measure interrupt a calibration in progress', () => {
    const tip = guidanceTip(
      base({ mode: 'measure', measureTool: 'angle', isCalibrating: true, currentStep: { label: 'X1', prompt: 'p' } })
    );
    expect(tip).toContain('Angle');
    expect(tip).not.toContain('Calibration step');
  });
});

describe('guidanceTip - capture, per graph type', () => {
  it('Spider says the RAY is the reading, and names the axis being filled', () => {
    const tip = guidanceTip(
      base({
        mode: 'place-point',
        config: SPIDER_AXES_CONFIG,
        hasSlots: true,
        currentGroupLabel: 'Strength',
        tupleNoun: 'profile',
      })
    );
    expect(tip).toContain('where the shape crosses the Strength axis');
    expect(tip).toContain('IS the number recorded');
    expect(tip).toContain('starting a new profile');
  });

  it('Bar says BOTH ENDS are measured - the wording that guards the midpoint defect', () => {
    const tip = guidanceTip(
      base({
        mode: 'place-point',
        config: BAR_AXES_CONFIG,
        hasSlots: true,
        currentGroupLabel: 'Min',
        tupleNoun: 'bar',
        currentTupleIndex: 2,
      })
    );
    expect(tip).toContain('one corner of the bar to the opposite corner');
    expect(tip).toContain('both ends are measured');
    expect(tip).toContain('bar 3, filling Min');
  });

  it('Bar beats the generic slot line - Bar always has slots, so order decides', () => {
    const tip = guidanceTip(
      base({ mode: 'place-point', config: BAR_AXES_CONFIG, hasSlots: true, currentGroupLabel: 'Min', tupleNoun: 'bar' })
    );
    expect(tip).not.toContain('Click to add a point - filling');
  });

  it('categorical Line stays one click per category - there is no second end to drag', () => {
    const tip = guidanceTip(base({ mode: 'place-point', config: CATEGORICAL_LINE_CONFIG, hasSlots: false }));
    expect(tip).toContain('Click each category’s marker in turn');
    expect(tip).not.toContain('opposite corner');
  });

  it('a selected point advertises nudge / step / delete', () => {
    // ⚑ The fixture says FIVE points, because it names the fifth. It used to
    // leave `dataPointCount` at the default 3 while selecting index 4 - a state
    // the app cannot be in - and that self-inconsistency is exactly what let the
    // stale-selection case below go unnoticed.
    const tip = guidanceTip(base({ mode: 'place-point', dataPointCount: 5, activePointIndex: 4 }));
    expect(tip).toContain('Point 5 selected');
    expect(tip).toContain('Q/W step points');
  });

  it('⚑⚑ but never announces a point that is not there', () => {
    // David read `Point 3 selected` on a series holding ZERO points, directly
    // beside `Bar start - new bar (0 of 2 filled)`: two lines about the same bar,
    // one of them describing a selection that could not exist. The index is UI
    // state and it outlives the points it named - a series switch, a reset, a
    // load. A claim nobody can substantiate should not be printed, however it
    // came to be set.
    const tip = guidanceTip(base({ mode: 'place-point', dataPointCount: 0, activePointIndex: 2 }));
    expect(tip).not.toContain('Point 3 selected');
    expect(tip).not.toContain('selected');
  });
});

describe('guidanceTip - the branches that exist because they were MISSING', () => {
  it('error-bars on a calibrated chart does not fall through to "calibrate the axes to begin"', () => {
    // ⚑ Caught on the screenshot bench: the one tool whose whole job is a
    // two-ended drag was the one with no guidance, so a calibrated chart was
    // told to calibrate while the card beside it read "Calibrated ✓".
    const tip = guidanceTip(base({ mode: 'error-bars', dataPointCount: 5 }));
    expect(tip).toContain('drag from a data point out to its error cap');
    expect(tip).not.toContain('calibrate the axes to begin');
  });

  it('error-bars with no points sends the user to place points first', () => {
    expect(guidanceTip(base({ mode: 'error-bars', dataPointCount: 0 }))).toContain(
      'place the data points first'
    );
  });

  it('NO tool on a calibrated chart falls through to the uncalibrated fallback', () => {
    // The fallback is for "no graph type calibrated yet". Reaching it with axes
    // built is the shape of the error-bars defect above, at any other site.
    for (const mode of ALL_MODES) {
      if (mode === 'image-edit' || mode === 'measure') continue; // own top-level branches
      const tip = guidanceTip(base({ mode, dataPointCount: 5 }));
      expect(tip, `mode ${mode}`).not.toContain('Pick a graph type, then calibrate the axes to begin.');
    }
  });

  it('still shows the fallback when nothing is calibrated', () => {
    expect(guidanceTip(base({ isCalibrated: false, mode: 'pan' }))).toBe(
      'Pick a graph type, then calibrate the axes to begin.'
    );
  });
});

describe('guidanceTip - the slot-aim suffix', () => {
  const withSlots = (over: Partial<GuidanceTipInput> = {}) =>
    base({
      hasSlots: true,
      currentGroupLabel: 'Median',
      captureProgressText: 'Next: Median - box 2 (3 of 5 filled)',
      config: BOX_PLOT_AXES_CONFIG,
      tupleNoun: 'box',
      ...over,
    });

  it('appends the count where the sentence does NOT already name the slot', () => {
    const tip = guidanceTip(withSlots({ mode: 'eraser' }));
    expect(tip).toContain('Eraser - click a data point to remove it.');
    expect(tip).toContain('- Median - box 2 (3 of 5 filled)');
    expect(tip).not.toContain('Next: '); // the prefix is stripped, not repeated
  });

  it('stays silent where the branch already named the slot - no literal duplicate', () => {
    const tip = guidanceTip(
      withSlots({ mode: 'place-point', config: SPIDER_AXES_CONFIG, currentGroupLabel: 'Median' })
    );
    expect(tip).toContain('crosses the Median axis');
    expect(tip.match(/Median/g)?.length).toBe(1);
  });

  it('never rides along on a calibration step - Bar has slots from the moment it is picked', () => {
    // ⚑ Without the isCalibrated guard, "Calibration step 1/2 - P1: ..." grew a
    // bogus "- Bar start - new bar (0 of 2 filled)" tacked onto it.
    const tip = guidanceTip(
      withSlots({
        isCalibrated: false,
        isCalibrating: true,
        currentStep: { label: 'P1', prompt: 'click the baseline' },
        stepCount: 2,
        captureProgressText: 'Next: Min - new bar (0 of 2 filled)',
        currentGroupLabel: 'Min',
      })
    );
    expect(tip).toBe('Calibration step 1/2 - P1: click the baseline');
  });

  it('adds nothing when the type has no slots to report on', () => {
    const tip = guidanceTip(base({ mode: 'eraser', hasSlots: false, captureProgressText: null }));
    expect(tip).toBe(guidanceTipBase(base({ mode: 'eraser', hasSlots: false, captureProgressText: null })));
  });
});

describe('noPointsHint', () => {
  it('never invites a canvas click in a mode where a plain click is inert', () => {
    // ⚑ The original defect: the table said "click on the image to add data
    // points" while the tips bar said "a plain click does nothing" - both on
    // screen at once, telling the reader opposite things.
    for (const mode of ['color-trace', 'segment-fill', 'interpolate'] as const) {
      const hint = noPointsHint({ mode, config: XY_AXES_CONFIG });
      expect(hint, mode).not.toContain('click on the image to add data points');
    }
  });

  // ⚑ Asserted whole, not by `toContain`. This hint's entire job is to say the
  // RIGHT thing, and a test that only checks what it does not say passes just
  // as happily on an empty string - which is what a mutation run proved.
  it('names each auto-extract mechanism by the gesture that actually drives it', () => {
    expect(noPointsHint({ mode: 'color-trace', config: XY_AXES_CONFIG })).toBe(
      'No points yet - pick the series’ colour, then press Trace. A plain click on the image does nothing here.'
    );
    expect(noPointsHint({ mode: 'segment-fill', config: XY_AXES_CONFIG })).toBe(
      'No points yet - click the curve on the image to flood-fill it.'
    );
    expect(noPointsHint({ mode: 'interpolate', config: XY_AXES_CONFIG })).toBe(
      'No points yet - click a few guide points along one curve.'
    );
  });

  it('tells a Bar user to drag corner to corner, not to click one end', () => {
    expect(noPointsHint({ mode: 'place-point', config: BAR_AXES_CONFIG })).toBe(
      'No points yet - drag from one corner of a bar to the opposite corner (or click twice) to record it.'
    );
    // Box Plot is axesKind 'bar' but not id 'bar' - a different capture gesture.
    expect(noPointsHint({ mode: 'place-point', config: BOX_PLOT_AXES_CONFIG })).toBe(
      'No points yet - click the end of each bar to record its value.'
    );
    expect(noPointsHint({ mode: 'place-point', config: XY_AXES_CONFIG })).toBe(
      'No points yet - click on the image to add data points.'
    );
  });

  it('⚑⚑ a categorical Line has no BARS to click the end of', () => {
    // ⚠️ SEEN ON THE BUILT APP while driving the v2.3 Line fix: a line chart of
    // five markers was told to *"click the end of each bar to record its
    // value."* There are no bars on the figure. That is this function's OWN
    // defect class - its header is entirely about hints that name a tool or a
    // gesture the type does not have - arriving for a fourth time, at a site
    // reached because Line is `axesKind: 'bar'` while looking nothing like one.
    //
    // ⚑ It mirrors the tips bar, which already had the right words for this
    // type: *"Click each category's marker in turn."* Two sentences describing
    // one gesture must not describe it differently.
    for (const mode of ['place-point', 'select'] as const) {
      const hint = noPointsHint({ mode, config: CATEGORICAL_LINE_CONFIG });
      expect(hint, mode).toContain('each category\u2019s marker');
      expect(hint, mode).not.toContain('bar');
    }
  });

  it('points a non-capturing tool back at the rail, per graph type', () => {
    // Pan / Select / Eraser / Measure / Image-edit / Error-bars all land here.
    expect(noPointsHint({ mode: 'select', config: BAR_AXES_CONFIG })).toBe(
      'No points yet - drag each bar corner to corner (Add points, 3), or pick Auto-extract (4) to find bars by colour.'
    );
    expect(noPointsHint({ mode: 'select', config: BOX_PLOT_AXES_CONFIG })).toBe(
      'No points yet - pick Add points (3) from the tool rail and click the end of each bar.'
    );
    expect(noPointsHint({ mode: 'select', config: PIE_AXES_CONFIG })).toBe(
      'No points yet - pick Add points (3) from the tool rail.'
    );
    expect(noPointsHint({ mode: 'select', config: XY_AXES_CONFIG })).toBe(
      'No points yet - pick Add points (3) or Auto-extract (4) from the tool rail.'
    );
  });

  it('sends a HEATMAP user to its card, and never to a tool that cannot capture it', () => {
    // ⚑ FOUND BY LOOKING AT A SCREENSHOT of the finished feature, not by a test.
    // The panel invited "click on the image to add data points" beside a heatmap
    // table holding 20 values - and a heatmap's cells are never placed by hand,
    // so following it drops stray points and teaches the user the app is broken.
    // Fourth instance of the contradiction class this function was written for.
    for (const mode of ALL_MODES) {
      const hint = noPointsHint({ mode, config: HEATMAP_AXES_CONFIG });
      expect(hint, mode).toMatch(/Heatmap card/);
      expect(hint, mode).not.toMatch(/click on the image|Add points|Auto-extract/i);
    }
  });
});

describe('the two surfaces must not contradict each other about Auto-extract', () => {
  // ⚑ THE RECURRING DEFECT CLASS, in the form that can actually detect it.
  // Four separate times, one panel recommended a tool the other refuses: the
  // rail button is greyed for `autoExtractKind: 'none'` (Box Plot, categorical
  // Line, Pie), and the hint kept offering it anyway. Neither a unit test nor
  // the e2e could see it - the e2e asserts values and counts, never prose.
  it('the empty-table hint never offers Auto-extract on a type that refuses it', () => {
    for (const config of ALL_CONFIGS) {
      if (config.autoExtractKind !== 'none') continue;
      for (const mode of ALL_MODES) {
        const hint = noPointsHint({ mode, config });
        expect(hint, `${config.id} / ${mode}`).not.toContain('Auto-extract');
      }
    }
  });

  it('a type that refuses auto-extract offers NO mechanism, and one that allows it offers at least one', () => {
    for (const config of ALL_CONFIGS) {
      const modes = autoExtractModesFor(config.autoExtractKind);
      if (config.autoExtractKind === 'none') expect(modes, config.id).toHaveLength(0);
      else expect(modes.length, config.id).toBeGreaterThan(0);
    }
  });

  it('the hint names Auto-extract exactly when the rail has a mechanism to offer', () => {
    // The two answers come from different files; this is the join.
    for (const config of ALL_CONFIGS) {
      const offered = autoExtractModesFor(config.autoExtractKind).length > 0;
      const hint = noPointsHint({ mode: 'select', config });
      expect(hint.includes('Auto-extract'), `${config.id}`).toBe(offered);
    }
  });

  it('every mechanism the rail offers has a tips-bar sentence of its own', () => {
    // A mode reachable from the rail with nothing to say about it is the
    // "fell through to calibrate the axes" defect waiting to happen.
    for (const config of ALL_CONFIGS) {
      for (const mode of autoExtractModesFor(config.autoExtractKind)) {
        const tip = guidanceTip(base({ mode, config, dataPointCount: 0 }));
        expect(tip, `${config.id} / ${mode}`).not.toBe('Pick a graph type, then calibrate the axes to begin.');
      }
    }
  });
});

describe('guidanceTip - the eyedropper takes the bar over whatever tool is armed', () => {
  it('says which ink it is about to sample', () => {
    expect(guidanceTip(base({ eyedropper: 'grid', mode: 'place-point' }))).toBe(
      'Eyedropper: click a gridline on the image to sample its colour.'
    );
    expect(guidanceTip(base({ eyedropper: 'series', mode: 'place-point' }))).toBe(
      'Eyedropper: click the series’ curve on the image to take its colour.'
    );
  });

  it('lets the trace eyedropper fall through - it has no line of its own', () => {
    const tip = guidanceTip(base({ eyedropper: 'trace', mode: 'color-trace' }));
    expect(tip).toContain('By colour');
  });
});

describe('guidanceTip - image edit AFTER capture', () => {
  it('separates cropping from the plain rotate/flip case', () => {
    expect(guidanceTip(base({ mode: 'image-edit', cropMode: false }))).toBe(
      'Image - rotate or flip; calibration and points move with the image.'
    );
    expect(guidanceTip(base({ mode: 'image-edit', cropMode: true, hasCropRect: false }))).toBe(
      'Crop - drag a rectangle over the area to keep.'
    );
  });

  it('switches to Apply only once a rectangle exists, and promises the points move with it', () => {
    const drawn = guidanceTip(base({ mode: 'image-edit', cropMode: true, hasCropRect: true }));
    expect(drawn).toContain('Apply to keep the selected area');
    expect(drawn).toContain('calibration and points move with it');
  });
});

describe('guidanceTip - select', () => {
  it('agrees with itself about plurality', () => {
    expect(guidanceTip(base({ mode: 'select', selectedPointCount: 1 }))).toContain('1 point selected');
    expect(guidanceTip(base({ mode: 'select', selectedPointCount: 2 }))).toContain('2 points selected');
  });

  it('sends the user to Add when there is nothing to select', () => {
    expect(guidanceTip(base({ mode: 'select', dataPointCount: 0 }))).toContain(
      'switch to Add points (3) to place some'
    );
  });

  it('promises calibration handles are safe once there are points', () => {
    expect(guidanceTip(base({ mode: 'select', dataPointCount: 4 }))).toContain(
      'calibration handles are safe'
    );
  });
});

describe('guidanceTip - place-point, the remaining branches', () => {
  it('a slotted type that is neither Spider nor Bar gets the generic slot line', () => {
    const tip = guidanceTip(
      base({
        mode: 'place-point',
        config: BOX_PLOT_AXES_CONFIG,
        hasSlots: true,
        currentGroupLabel: 'Median',
        tupleNoun: 'box',
      })
    );
    expect(tip).toContain('Click to add a point - filling Median (new box).');
  });

  it('numbers the tuple in hand rather than calling it new', () => {
    const tip = guidanceTip(
      base({
        mode: 'place-point',
        config: BOX_PLOT_AXES_CONFIG,
        hasSlots: true,
        currentGroupLabel: 'Median',
        tupleNoun: 'box',
        currentTupleIndex: 0,
      })
    );
    expect(tip).toContain('filling Median (box 1).');
    expect(tip).not.toContain('new box');
  });

  it('Spider numbers its profile the same way', () => {
    const tip = guidanceTip(
      base({
        mode: 'place-point',
        config: SPIDER_AXES_CONFIG,
        hasSlots: true,
        currentGroupLabel: 'Speed',
        tupleNoun: 'profile',
        currentTupleIndex: 3,
      })
    );
    expect(tip).toContain('(profile 4).');
  });

  it('Bar says "starting a new bar" before the first corner goes down', () => {
    const tip = guidanceTip(
      base({ mode: 'place-point', config: BAR_AXES_CONFIG, hasSlots: true, currentGroupLabel: 'Min', tupleNoun: 'bar' })
    );
    expect(tip).toContain('starting a new bar');
  });

  it('a plain XY chart just invites a click, and mentions pan and zoom', () => {
    const tip = guidanceTip(base({ mode: 'place-point', config: XY_AXES_CONFIG, hasSlots: false }));
    expect(tip).toContain('Click anywhere on the image to add a data point');
    expect(tip).toContain('Hold Space');
  });
});

describe('guidanceTip - calibrate, colour trace and interpolate', () => {
  it('offers nudge only when a handle is actually selected', () => {
    expect(guidanceTip(base({ mode: 'calibrate', hasActiveHandle: true }))).toContain('Handle selected');
    expect(guidanceTip(base({ mode: 'calibrate', hasActiveHandle: false }))).toContain(
      'Drag a calibration handle to adjust it'
    );
  });

  it('flood-fill names the one shape it can follow', () => {
    expect(guidanceTip(base({ mode: 'segment-fill' }))).toContain('a solid, unbroken curve');
  });

  it('By colour describes a DIFFERENT job per auto-extract kind', () => {
    const spider = guidanceTip(base({ mode: 'color-trace', config: SPIDER_AXES_CONFIG }));
    expect(spider).toContain('one value per axis');
    // A refusal to read an axis must read as a refusal, not as a bug.
    expect(spider).toContain('An axis it can’t read is left for you to place');

    const bar = guidanceTip(base({ mode: 'color-trace', config: BAR_AXES_CONFIG, tupleNoun: 'bar' }));
    expect(bar).toContain('records its own bounding box');
    expect(bar).toContain('every bar of that colour');

    const xy = guidanceTip(base({ mode: 'color-trace', config: XY_AXES_CONFIG }));
    expect(xy).toContain('a plain click does nothing');
    expect(xy).not.toContain('bounding box');
    expect(xy).not.toContain('one value per axis');
  });

  it('interpolate distinguishes empty, anchor-selected, and mid-flow', () => {
    expect(guidanceTip(base({ mode: 'interpolate', dataPointCount: 0 }))).toContain(
      'click a few guide points'
    );
    expect(
      guidanceTip(base({ mode: 'interpolate', dataPointCount: 3, activePointIndex: 1, activePointIsAnchor: true }))
    ).toContain('Anchor selected');
    // A selected point that is NOT an anchor is not an anchor selection.
    expect(
      guidanceTip(base({ mode: 'interpolate', dataPointCount: 3, activePointIndex: 1, activePointIsAnchor: false }))
    ).toContain('click to add a guide point');
  });

  it('pan says plainly that nothing will be edited', () => {
    expect(guidanceTip(base({ mode: 'pan' }))).toBe('Pan and zoom only - pick a tool from the left rail to edit.');
  });
});

describe('guidanceTip - measure click counts at their boundaries', () => {
  it('set scale counts the first and second point', () => {
    expect(guidanceTip(base({ mode: 'measure', settingScale: true, pendingMeasureCount: 0 }))).toContain(
      'click the first point of a known distance'
    );
    expect(guidanceTip(base({ mode: 'measure', settingScale: true, pendingMeasureCount: 1 }))).toContain(
      'click the second point of a known distance'
    );
  });

  it('slope counts the first and second point', () => {
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'slope', pendingMeasureCount: 0 }))).toContain(
      'click the first point on the line'
    );
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'slope', pendingMeasureCount: 1 }))).toContain(
      'click the second point on the line'
    );
  });

  it('a selected vertex yields as soon as a new measurement is being placed', () => {
    // All three conjuncts matter: selected, not setting scale, nothing pending.
    const placing = guidanceTip(
      base({ mode: 'measure', measureTool: 'angle', hasActiveMeasure: true, pendingMeasureCount: 1 })
    );
    expect(placing).toContain('the first arm');
    expect(placing).not.toContain('Measurement point selected');
  });

  it('area counts every corner, on both sides of the 3-corner threshold', () => {
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'area', pendingMeasureCount: 0 }))).toContain(
      '0 placed; need 3+'
    );
    expect(guidanceTip(base({ mode: 'measure', measureTool: 'area', pendingMeasureCount: 4 }))).toContain(
      '4 placed'
    );
  });
});

describe('autoExtractModesFor', () => {
  it('offers all three mechanisms to an undeclared (curve) type', () => {
    expect(autoExtractModesFor(undefined)).toEqual(AUTO_EXTRACT_MODES);
    expect(autoExtractModesFor('curve')).toEqual(AUTO_EXTRACT_MODES);
  });

  it('narrows the two shape-reading kinds to By colour alone', () => {
    // Flood-fill / Guide points would run and silently record nothing.
    expect(autoExtractModesFor('along-axes')).toEqual(['color-trace']);
    expect(autoExtractModesFor('bounding-box')).toEqual(['color-trace']);
  });

  it('refuses outright where the reading would not be the datum', () => {
    expect(autoExtractModesFor('none')).toEqual([]);
  });
});


/** A bar chart mid-capture: the state whose message the marking mode overrides. */
const barPlacing = (over: Partial<GuidanceTipInput> = {}): GuidanceTipInput =>
  base({ mode: 'place-point', config: BAR_AXES_CONFIG, hasSlots: true, currentGroupLabel: 'Min', ...over });

describe('⚑ a heatmap’s tips bar tracks what is actually on screen', () => {
  const heatmap = (over: Partial<GuidanceTipInput> = {}): GuidanceTipInput =>
    base({ mode: 'place-point', config: HEATMAP_AXES_CONFIG, ...over });

  it('names the correction gesture ONLY once there are cells to correct', () => {
    // ⚑ An invisible precondition is the failure mode this guards: naming a
    // gesture the user cannot perform yet is worse than saying nothing, because
    // they go looking for it. Before Read cells the table is empty and the
    // sentence is about the grid.
    const before = guidanceTipBase(heatmap({ heatmapHasGrid: true, heatmapHasCells: false }));
    expect(before).not.toMatch(/type over/i);
    expect(before).toMatch(/boundary/i);

    const after = guidanceTipBase(heatmap({ heatmapHasGrid: true, heatmapHasCells: true }));
    expect(after).toMatch(/type over/i);
  });

  /**
   * ① - the other half of David's "UI design fault". A grid on screen, a
   * detection report and `Calibrated ✓` all read as READY, and nothing named the
   * action that turns the grid into a record.
   */
  it('names READ CELLS once a grid exists - the action that finishes the job', () => {
    const ready = guidanceTipBase(heatmap({ heatmapHasGrid: true, heatmapHasCells: false }));
    expect(ready).toMatch(/read cells/i);
    // ⚑ And FIRST: the adjusting gestures are a side quest at this moment, and
    // a tip that opens with them answers a question nobody asked.
    expect(ready.toLowerCase().indexOf('read cells')).toBeLessThan(
      ready.toLowerCase().indexOf('boundary')
    );
  });

  it('stops naming Read cells once the cells are read, so the tip moves on', () => {
    expect(
      guidanceTipBase(heatmap({ heatmapHasGrid: true, heatmapHasCells: true }))
    ).not.toMatch(/read cells/i);
  });

  it('says the WAY BACK, because right-click is the half nothing else shows', () => {
    // ⚑ Typing over a value is discoverable - the dashed underline every
    // editable number in the app carries. Handing the cell back to the key is
    // not, and a correction with no visible exit is a one-way door.
    expect(guidanceTipBase(heatmap({ heatmapHasGrid: true, heatmapHasCells: true }))).toMatch(
      /right-click/i
    );
  });

  /**
   * ③ - David's screenshot finding. The bar named typing, right-clicking and
   * dragging a boundary, and never named the CALIPER: dragging a cell along the
   * colour key, which is the newest gesture and the least guessable one.
   */
  it('names the COLOUR KEY drag once a cell is picked - the third axis’s own handle', () => {
    const picked = guidanceTipBase(
      heatmap({ heatmapHasGrid: true, heatmapHasCells: true, heatmapCellPicked: true })
    );
    expect(picked).toMatch(/colour key/i);
    expect(picked).toMatch(/drag/i);
    // The way back stays said - it is the half nothing else shows.
    expect(picked).toMatch(/right-click/i);
  });

  it('does NOT name the caliper while no cell is picked, because it is not on screen', () => {
    // ⚑ The same invisible-precondition rule as "type over a cell's value": the
    // caliper exists only for a SINGLE picked cell, so naming it before then
    // sends the user hunting for a handle that is not drawn.
    expect(
      guidanceTipBase(heatmap({ heatmapHasGrid: true, heatmapHasCells: true, heatmapCellPicked: false }))
    ).not.toMatch(/colour key/i);
  });
});

describe('⚑ the tips bar while the category axis is being marked (v2.1 audit)', () => {
  it('stops telling the user to drag a bar, because no click can capture one', () => {
    // Box capture stands down while the fold-out is asking for an edge, and a
    // plain click becomes the edge. The tips bar -- described in its own header
    // as the one constant place for contextual guidance -- went on saying "Drag
    // from one corner of the bar to the opposite corner", false in both halves.
    const marking = guidanceTipBase(barPlacing({ isMarkingCategoryAxis: true }));
    expect(marking).not.toContain('corner');
    expect(marking).toContain('category axis');
  });

  it('says how to get back, so it is not a state with no visible exit', () => {
    const marking = guidanceTipBase(barPlacing({ isMarkingCategoryAxis: true }));
    expect(marking).toContain('Mark category ticks?');
  });

  it('leaves the ordinary bar guidance alone when nothing is being marked', () => {
    expect(guidanceTipBase(barPlacing({ isMarkingCategoryAxis: false }))).toContain('corner');
    expect(guidanceTipBase(barPlacing())).toContain('corner');
  });
});
