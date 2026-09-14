/**
 * ⚑⚑ SAYING YES TO THE SPLIT MUST NOT COST THE USER ANYTHING THE OTHER TWO
 * DOORS GIVE THEM.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-15, against `fd37c7b`'s new branch in
 * `openProject`. It installs the figures and RETURNS, above both of the lines
 * every other open path runs, and two things were left on the floor:
 *
 * 1. **The notice.** The load door's sentences are about the DATA - series held
 *    back because the file carries a second set of axes, marks orphaned by a
 *    dropped role, a document relabelled Bar -> Span, a box plot whose slots
 *    cannot draw a box. Splitting the project makes none of them untrue, and
 *    saying No shows them while saying Yes does not.
 *    `engine/__tests__/aSplitDoesNotSwallowTheNotice.test.ts` pins that a real
 *    file produces a notice and an offer at once.
 *
 * 2. **The unsaved flag.** `restoreFigure(..., true)` marks the document CLEAN,
 *    which is true for an opened multi-figure project - the file IS that - and
 *    false here: the file on disk holds ONE figure and what is now open holds
 *    several. The user accepted a transformation, and the app will let them
 *    close it, open another project or quit without a word. `restoreFigure`'s
 *    own comment records the last time this happened: *"Marking clean there let
 *    a whole multi-figure session close with no unsaved-work prompt and both
 *    figures discarded."*
 *
 * ⚑ Asserted on the SOURCE, like `bothLoadDoorsAgreeOnTheType` and
 * `oneFigureResetList`: `openProject` cannot be reached without driving
 * Electron, and the e2e board is not the place for a rule about two lines.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const workspace = readFileSync(path.join(import.meta.dirname, '..', 'Workspace.tsx'), 'utf8');

/** The body of the split branch: from the offer's `confirm` to its `return`. */
function splitBranch(): string {
  const at = workspace.indexOf('if (offer && window.confirm(offer))');
  expect(at, 'the split branch is gone or renamed').toBeGreaterThan(-1);
  const end = workspace.indexOf('loadCalibratedFigure({', at);
  expect(end, 'the branch no longer sits above the single-figure load').toBeGreaterThan(at);
  return workspace.slice(at, end);
}

describe('the split carries what the open carries', () => {
  it('⚠️⚑⚑ it shows the load door’s notice, which it used to discard', () => {
    expect(splitBranch()).toMatch(/setProjectNotice\(result\.notice/);
  });

  it('⚠️⚑⚑ it leaves the document UNSAVED - the file holds one figure, this holds several', () => {
    expect(splitBranch()).toMatch(/dirtyRef\.current = true/);
  });

  it('⚑ and the notice is set AFTER the figure is installed', () => {
    // The trap the single-figure path documents in full: installing a figure
    // clears the notice, so a notice set BEFORE the load is wiped in the same
    // batch and never reaches the eye.
    const branch = splitBranch();
    expect(branch.indexOf('setProjectNotice')).toBeGreaterThan(branch.indexOf('restoreFigure('));
  });
});
