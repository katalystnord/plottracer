import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * ⚑⚑ THE RELEASE JOB READS A FILE OFF DISK, AND NOTHING CHECKED IT WAS THERE.
 *
 * `.github/workflows/build.yml` passes `body_path: release-notes/<tag>.md` to
 * the GitHub release action. If the file is absent for the tag being built, the
 * release page ships with nothing but an auto-generated commit list.
 *
 * ⚠️ THIS HAS ALREADY HAPPENED. v2.2.0's notes were committed **seventeen
 * minutes after** the tag, so the tag did not contain them and the published
 * page was bare - for the release whose headline was a whole new chart type.
 * v2.0.2 went the same way, and its own CI comment records why it mattered
 * most there: its entire reason to exist was to warn people their asymmetric
 * error bars might be filed against the wrong point, *"a warning published
 * nowhere"*.
 *
 * ▶ A tag pins a TREE. Notes written after it are notes the release does not
 * have. So the check belongs in the suite that runs before the tag, keyed on the
 * version the app is actually going to ship as.
 */

const ROOT = path.join(import.meta.dirname, '..', '..');
const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version as string;
const notes = path.join(ROOT, 'release-notes', `v${version}.md`);

describe('this version has release notes, before it is tagged', () => {
  it(`release-notes/v${version}.md exists`, () => {
    expect(
      existsSync(notes),
      `package.json says ${version}, so the release job will read release-notes/v${version}.md. ` +
        'Write it and commit it BEFORE tagging - a tag pins a tree, and notes added afterwards ' +
        'are not in the release. This has shipped bare twice.'
    ).toBe(true);
  });

  it('and says something - an empty file is the same bare page', () => {
    const text = readFileSync(notes, 'utf8').trim();
    expect(text.length, 'the notes are empty').toBeGreaterThan(200);
  });

  it('⚑ the workflow still reads the path this test guards', () => {
    // A guard keyed on a path the job no longer uses is a guard that has stopped
    // guarding while still reading as deliberate - the shape this repo keeps
    // finding. Asserted against the workflow's own text.
    const workflow = readFileSync(path.join(ROOT, '.github', 'workflows', 'build.yml'), 'utf8');
    expect(workflow).toContain('body_path: release-notes/');
  });
});
