import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ozoneArgs } from './e2eContainment.js';

/**
 * ⚑⚑ THE CASE THIS FILE EXISTS FOR, stated as an outcome: *given a run that
 * declares neither containment nor the real screen, the harness REFUSES before
 * a window is drawn.*
 *
 * It used to launch. Three e2e files each carried their own copy of the gate,
 * every copy read "variable set → contain, variable absent → launch anyway", and
 * so the developer's screen was the DEFAULT. On 2026-08-17 a suite run that
 * excluded `workspace.e2e.test.ts` by name still put `electronMain.e2e.test.ts`
 * on his desktop - the runner remembered one GUI file out of three, and nothing
 * in the code had an opinion about the other two.
 */

describe('⚑⚑ an e2e says where its windows go - and refuses if nobody said', () => {
  it('a run that declares NOTHING refuses, rather than taking the real screen', () => {
    expect(() => ozoneArgs({})).toThrow(/would take over the developer's screen/);
  });

  it('the refusal names the recipe, so the reader can act on it without asking', () => {
    // ⚑ A refusal that does not say what to do instead is a wall, not a guard --
    // the same rule the calibration refusals follow (name the REQUIREMENT).
    let message = '';
    try {
      ozoneArgs({});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('Xvfb :99');
    expect(message).toContain('PLOTTRACER_OZONE_PLATFORM=x11');
    expect(message).toContain('PLOTTRACER_REAL_SCREEN=1');
  });

  it('a contained run passes the platform as a launch ARGUMENT', () => {
    // ⚑ An ARGUMENT specifically: an env hint and appendSwitch are both applied
    // after Ozone has already chosen its platform, which is why they do nothing.
    expect(ozoneArgs({ PLOTTRACER_OZONE_PLATFORM: 'x11' })).toEqual(['--ozone-platform=x11']);
  });

  it('the real screen is still available - but only by saying so on purpose', () => {
    expect(ozoneArgs({ PLOTTRACER_REAL_SCREEN: '1' })).toEqual([]);
  });

  it('a half-hearted opt-in does NOT count as one', () => {
    // Anything other than an explicit "1" leaves the guard armed, so a stray or
    // emptied variable cannot silently disarm it.
    expect(() => ozoneArgs({ PLOTTRACER_REAL_SCREEN: '' })).toThrow();
    expect(() => ozoneArgs({ PLOTTRACER_REAL_SCREEN: '0' })).toThrow();
  });
});

describe('⚑⚑ MEMBERSHIP - every e2e that launches Electron uses the one gate', () => {
  /**
   * ⚑ THE POINT. Fixing the three instances is not the fix; a FOURTH e2e file
   * written next month with its own `OZONE_ARGS` line puts us straight back
   * where we were. This test is what makes that impossible to do quietly - it
   * finds the launchers by SHAPE (who imports Playwright's Electron driver),
   * not by a list somebody has to remember to extend.
   *
   * Same move as `everyGraphType.test.ts` makes for the axes-type registry: a
   * hand-maintained list does not grow when you add a member.
   *
   * ⚠️ A SOURCE-SCANNING TEST THAT LIVES IN THE DIRECTORY IT SCANS MATCHES
   * ITSELF, and it bit twice while this was being written: first on the call
   * text (named in the prose above), then on the import shape (named in the
   * filter below). Every needle this file looks for is, by construction, in
   * this file. So the scanner excludes itself - a one-line exclusion that
   * cannot grow, unlike the hand-maintained list this test exists to abolish.
   */
  const SELF = 'e2eContainment.test.ts';
  const DIR = __dirname;
  const launchers = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.ts') && f !== SELF)
    .filter((f) => fs.readFileSync(path.join(DIR, f), 'utf8').includes('_electron as electron'));

  it('is not vacuous - there ARE Electron-launching e2e files to check', () => {
    // Without this, a rename of the test directory would leave every assertion
    // below iterating an empty list and passing in silence.
    expect(launchers.length).toBeGreaterThanOrEqual(3);
  });

  it.each(launchers)('%s is named *.e2e.test.ts, so the unit board can exclude it by PATTERN', (file) => {
    // ⚑⚑ CI runs `vitest.unit.config.ts`, which drops `**/*.e2e.test.ts` - a
    // pattern, not a list. This is what makes the pattern COMPLETE rather than
    // merely conventional: a fifth Electron file called `smokeTest.ts` would
    // otherwise be silently included, launch a real app on a hosted runner with
    // no display, and fail the release build for a reason nobody would guess.
    // ⚑ The rule is here rather than in the config because this is the file that
    // already knows who the launchers are, by their import rather than by name.
    // ⚑ It is also the exact mistake made by hand on 2026-08-17 - a suite run
    // excluded ONE e2e file by name and the other two launched onto the
    // developer's screen. A hand-listed exclusion does not grow.
    expect(file.endsWith('.e2e.test.ts')).toBe(true);
  });

  it.each(launchers)('%s asks the shared gate where its windows go', (file) => {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    expect(src).toContain("from './e2eContainment.js'");
    expect(src).toContain('ozoneArgs(');
  });

  it.each(launchers)('%s does not carry a SECOND copy of the gate', (file) => {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8');
    // Reading the variable anywhere other than the shared module is how the
    // duplicate came back last time -- so the check is on the READ, not the name
    // `OZONE_ARGS`, which a copy is free to rename.
    expect(src).not.toContain("process.env['PLOTTRACER_OZONE_PLATFORM']");
    expect(src).not.toContain('process.env.PLOTTRACER_OZONE_PLATFORM');
  });
});
