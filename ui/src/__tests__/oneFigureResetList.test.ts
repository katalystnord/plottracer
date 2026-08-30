import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A FIGURE ARRIVES THREE WAYS. THERE MUST BE ONE LIST OF WHAT DOES NOT COME
 * WITH IT.
 *
 * ⚑⚑ WHY THIS FILE EXISTS. Opening a project, switching between the figures of
 * a multi-figure session and undoing across a load all replace the live session
 * wholesale, and each grew its OWN idea of which per-panel state belongs to the
 * figure being left behind. The lists disagreed every single time anyone looked:
 *
 *   - v2.1 audit: opening a project left the PREVIOUS figure's category count in
 *     the Categories box, beside the ticks the loaded figure actually has.
 *   - v2.2: the same door, the heatmap's turn.
 *   - v2.3 re-audit (F24): the SWITCH door had never restored the heatmap layer
 *     at all, so figure 1's grid and the readings a person had taken BY HAND
 *     stayed live over figure 2's picture - and the first cell edit or divider
 *     nudge filed them in figure 2's record. Silent by construction: a heatmap
 *     has no eye-check, colour IS the value.
 *
 * Nothing was wrong with any one of those lists. There were three of them. So
 * the fix was structural - one `resetPerFigureUI` - and this is the test that
 * keeps it structural. It asserts the SOURCE, deliberately: importing anything
 * from Workspace.tsx would prove the component agrees with itself, and what
 * fails here is a fourth copy being started, which no runtime assertion sees.
 *
 * ⚑ It cannot prove a reset is CORRECT - an e2e does that. It proves the two
 * install doors cannot drift apart again, which is the failure that has
 * actually happened, in three consecutive releases.
 */

const workspace = readFileSync(path.join(import.meta.dirname, '..', 'Workspace.tsx'), 'utf8');

/** The brace/paren-matched body of a `const <name> = useCallback(...)`. */
function callbackBody(name: string): string {
  const start = workspace.indexOf(`const ${name} = useCallback(`);
  expect(start, `${name} is not a useCallback in Workspace.tsx`).toBeGreaterThan(-1);
  const open = workspace.indexOf('(', workspace.indexOf('useCallback', start));
  let depth = 0;
  for (let i = open; i < workspace.length; i += 1) {
    if (workspace[i] === '(') depth += 1;
    else if (workspace[i] === ')') {
      depth -= 1;
      if (depth === 0) return workspace.slice(open, i);
    }
  }
  throw new Error(`unbalanced parens in ${name}`);
}

/** Every `setX(` / `applyX(` / `restoreX(` call made directly in a body. */
function callsIn(body: string): string[] {
  return [...body.matchAll(/\b(set[A-Z]\w*|restore[A-Z]\w*)\s*\(/g)].map((m) => m[1]!);
}

/** The two doors that INSTALL a figure: a project/import load, and a switch. */
const INSTALL_DOORS = ['loadCalibratedFigure', 'restoreFigure'] as const;

/**
 * State that belongs to the figure being LEFT, and so must be reset from the one
 * list rather than by each door. Named for what the user sees, because that is
 * what breaks: a stale entry here is a panel describing a figure that is no
 * longer on screen.
 */
const PER_FIGURE_RESETS = [
  'restoreHeatmapGrid', // the grid, the labels and the hand-taken cell readings
  'setEditingHeatmapValue',
  'setHeatmapValueError',
  'setHeatmapDragTint',
  'setSelectedCells',
  'setSelectedDividerId',
  'setActivePointIndex',
  'setSelectedPointIndices',
  'setColorTraceRegion',
  'setHeldBackBars', // shapes the outgoing figure's trace refused to file
  'setDataValueInputs',
  'setSegmentFillError',
  'setGeometryClosed',
  'setCurveFitDegree',
  'setCurveFitModel',
  'setCurveFitRestrict',
  'setCurveFitXMinInput',
  'setCurveFitXMaxInput',
  'setCurveFitError',
  'setErrorTargetName',
  'setErrorNotice',
  'setFigureNameDraft',
  'setFigureNameNotice',
  'setProjectNotice',
  'setProjectError',
  'setMode',
  'setCalibExpanded',
  'setAxesTypeId',
  // ⚑⚑ THE COMMON-ORIGIN ANSWER BELONGS TO THE FIGURE YOU ANSWERED IT ABOUT.
  // David, 2026-08-29, driving Box Plot: *"it is inconsistent ... Sometimes it
  // is offered checked, and sometimes unchecked."* It was one session-wide
  // boolean initialised to `true` whose only writer was the checkbox's own
  // onChange - so no figure and no graph type ever reset it, and the box opened
  // showing whatever you last left it at on a DIFFERENT chart. Whether two axes
  // meet is a fact about the figure in front of you, so the answer cannot
  // outlive it.
  'setCommonOrigin',
  // ⚑⚑ A READING IS TAKEN OFF ONE FIGURE'S PIXELS (v2.4). An armed band would
  // eat the first drag on the next figure; a proposal's thumbnail is a crop of a
  // picture no longer on screen, and Apply would write the outgoing figure's
  // names onto the incoming one's categories.
  'setOcrArmed',
  'setOcrProposals',
  'setOcrBusyIndex',
  'setOcrError',
  // ⚑⚑ FIVE CATEGORY SETTERS CAME OFF THIS LIST (v2.3), and the list is the
  // reason that is safe to say: `setCategoryCountInput`, `setCategoryFirstEdge`,
  // `setCategoryMarkError`, `setCategoryPlaceBothEdges` and
  // `setCategoryPanelOpen` were state the COMPONENT held about a marking gesture
  // performed on the canvas. Both ends of the category axis are calibration
  // steps now, so the incoming figure's own calibration carries all of it and
  // there is nothing per-figure left to reset.
] as const;

describe('one per-figure reset list, read by every door that installs a figure', () => {
  it('the shared list resets everything that belongs to the outgoing figure', () => {
    const shared = callsIn(callbackBody('resetPerFigureUI'));
    for (const call of PER_FIGURE_RESETS) {
      expect(shared, `resetPerFigureUI must reset ${call}`).toContain(call);
    }
  });

  it.each(INSTALL_DOORS)('%s installs a figure through the shared list', (door) => {
    expect(callbackBody(door)).toContain('resetPerFigureUI(');
  });

  it.each(INSTALL_DOORS)('%s keeps no reset list of its own', (door) => {
    // ⚑ THIS IS THE ASSERTION THAT MATTERS. Each door calling the shared reset
    // is not enough on its own: every drift so far began as one extra line in
    // one door, which reads as a local fix and silently becomes the fourth list.
    // ⚑ Only what the door does AFTER installing the figure counts. A door may
    // REFUSE before it installs anything - `loadCalibratedFigure` sets a
    // projectError for an unsupported axes type and returns - and a refusal is
    // not a reset.
    const body = callbackBody(door);
    const own = callsIn(body.slice(body.indexOf('resetPerFigureUI(')));
    const strays = PER_FIGURE_RESETS.filter((c) => own.includes(c));
    expect(
      strays,
      `${door} resets ${strays.join(', ')} itself. That belongs in resetPerFigureUI, ` +
        'so the other doors get it too - see this file\'s header for the three releases ' +
        'in which they did not.'
    ).toEqual([]);
  });

  it('the heatmap layer is restored on a figure SWITCH, not only on a load (F24)', () => {
    // The named case, kept as its own test because it is the one that wrote one
    // figure's hand readings into another figure's record.
    expect(callbackBody('restoreFigure')).toContain('resetPerFigureUI(rec.session)');
    expect(callbackBody('resetPerFigureUI')).toContain('restoreHeatmapGrid()');
  });
});

/**
 * THE PICTURE IS AN INPUT TO EVERY READING TAKEN OFF IT (F25).
 *
 * The colour key is SAMPLED out of the image, and the heatmap's cells are read
 * through it - but an image loads asynchronously, so it changes long after the
 * calibration version that used to be the only trigger. Figure 2's colours were
 * read against figure 1's key, and the cell table was sampled from the outgoing
 * figure's ink. `imageEpoch` is the fact that was missing; these assert that the
 * two consumers name it.
 */
describe('a new picture re-runs what was read off the old one', () => {
  const useMeasure = readFileSync(
    path.join(import.meta.dirname, '..', 'tools', 'useMeasure.ts'),
    'utf8'
  );

  it('the colour key names the image among its inputs', () => {
    const memo = useMeasure.slice(useMeasure.indexOf('const colourScale = useMemo'));
    const deps = memo.slice(memo.indexOf('}, ['), memo.indexOf(']', memo.indexOf('}, [')));
    expect(deps, 'colourScale is memoised over an image it does not depend on').toContain(
      'imageEpoch'
    );
  });

  it('the heatmap cells are read again once the picture has settled', () => {
    expect(workspace).toContain('rereadCellsRef.current();');
    const effect = workspace.slice(workspace.indexOf('rereadCellsRef.current();'));
    expect(effect.slice(0, 120)).toContain('[imageEpoch]');
  });
});

describe('the UNDO door clears what an undo can invalidate', () => {
  /**
   * ⚠️ The undo door deliberately keeps its OWN, shorter list - an undo is not a
   * new figure - so the shared list above cannot cover it and this has to be
   * asserted separately.
   *
   * ⚑⚑ HELD-BACK SHAPES ARE THE OUTPUT OF A TRACE, and an undo rolls traces
   * back. Left standing, the offer would file a legend swatch into a session
   * that no longer holds the bars it was measured against - and it would do it
   * through the ordinary capture path, so nothing downstream would look wrong.
   * Exactly the argument the two lines above it already make about a selection
   * whose indices refer to a point set that may no longer exist.
   */
  it('an undo drops the shapes a trace held back', () => {
    expect(callbackBody('syncAfterRestore')).toContain('setHeldBackBars');
  });

  it('and it drops the selections, which is the same argument', () => {
    const body = callbackBody('syncAfterRestore');
    expect(body).toContain('setActivePointIndex');
    expect(body).toContain('setSelectedPointIndices');
  });
});
