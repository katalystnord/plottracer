/**
 * ⚑⚑ THE SESSION AND THE RECORD SAY THE SAME THING ABOUT WHAT A FIGURE IS.
 *
 * ⚠️ FOUND BY AUDIT, 2026-09-10. The multi-figure door fell back to XY for a
 * config id it did not recognise and then stored the FILE's id beside it:
 *
 *     const config = ALL_AXES_TYPE_CONFIGS.find(…) ?? XY_AXES_CONFIG;
 *     …
 *     axesTypeId: f.configId,          // ← not the one that was used
 *
 * So the session was an XY chart and the record claimed to be whatever the file
 * said. A subsequent Save writes the SESSION's config id, quietly rewriting what
 * the file declared - the record and the thing it describes drifting apart with
 * nothing on screen saying so.
 *
 * ⚑ The two doors still differ deliberately, and that is not the defect: the
 * single-figure door refuses an unknown id outright, because there is one figure
 * and nothing to lose; refusing a whole archive because one figure of twelve is
 * odd would strand eleven good ones. What they must agree on is that the record
 * never claims a type the session is not.
 *
 * ⚑ Asserted on the SOURCE, like `oneFigureResetList`: what fails here is the
 * two lines drifting apart again, which no runtime assertion sees.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const workspace = readFileSync(path.join(import.meta.dirname, '..', 'Workspace.tsx'), 'utf8');

describe('both load doors agree about the type', () => {
  it('⚑⚑ the multi-figure record stores the config it actually built', () => {
    const at = workspace.indexOf('buildFigureRecordFromDeserialized');
    expect(at, 'the multi-figure door is gone or renamed').toBeGreaterThan(-1);
    const body = workspace.slice(at, at + 3000);
    expect(body, 'the record still claims the file’s id rather than the one used').toContain(
      'axesTypeId: config.id'
    );
    expect(body).not.toContain('axesTypeId: f.configId');
  });

  it('⚑ the single-figure door still refuses an id it does not know', () => {
    // The other half of the pair, pinned so a later tidy-up cannot quietly
    // make it fall back instead - which would lose the refusal entirely.
    expect(workspace).toContain('Unsupported axes type: ');
  });
});
