import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The F1 card promises keyboard shortcuts. This asserts it is not lying.
 *
 * ⚑⚑ WHY THIS FILE EXISTS. A card listing shortcuts is a promise about
 * behaviour, and this project has broken that exact promise before: MANUAL.md
 * once shipped three wrong hotkeys (Select was documented as `2`, which is the
 * image editor) and advertised a Ctrl+arrow pan that has never existed. Prose
 * drifts from code silently, because nothing executes prose.
 *
 * So the test reads BOTH files and checks the card's table against the
 * handlers' own source. It cannot prove a key WORKS — an e2e does that — but it
 * catches the failure that actually happens: someone renumbers a tool, or
 * deletes a binding, and the help card keeps promising the old one.
 *
 * ⚑ Deliberately asserts the SOURCE rather than importing the tables. Importing
 * them would prove the card agrees with itself.
 */

const UI_SRC = path.join(import.meta.dirname, '..');
const overlay = readFileSync(path.join(UI_SRC, 'HelpOverlay.tsx'), 'utf8');
const workspace = readFileSync(path.join(UI_SRC, 'Workspace.tsx'), 'utf8');

/** Pull the rows out of one of the card's tables, as [key, description]. The
 *  TOOLS table carries a third member (its icon) which this ignores. */
function tableRows(name: string): Array<[string, string]> {
  const start = overlay.indexOf(`const ${name}: Array<`);
  expect(start, `${name} table not found in HelpOverlay.tsx`).toBeGreaterThan(-1);
  const end = overlay.indexOf('];', start);
  return [...overlay.slice(start, end).matchAll(/\['([^']*)',\s*'([^']*)'/g)].map((m) => [m[1]!, m[2]!]);
}

describe('the tool digits the card promises are the digits Workspace handles', () => {
  const rows = tableRows('TOOLS');

  it('lists ten tools, 0 through 9', () => {
    expect(rows.map(([k]) => k)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  for (const [digit] of tableRows('TOOLS')) {
    it(`Workspace.tsx really handles the '${digit}' key`, () => {
      // The tool switcher is a chain of `e.key === 'N'` tests. If a digit is
      // renumbered or dropped, the card's row survives and this does not.
      expect(workspace).toContain(`e.key === '${digit}'`);
    });
  }
});

describe('the editing and document keys exist in the handlers', () => {
  it('Q and W step between points', () => {
    expect(workspace).toMatch(/e\.key === 'q'/);
    expect(workspace).toMatch(/e\.key === 'w'/);
  });

  it('Shift really is the COARSE nudge, not the fine one', () => {
    // The card says "Shift + arrows — nudge coarsely". Reversed, the card would
    // still read plausibly while telling the user the opposite of the truth.
    expect(workspace).toMatch(/e\.shiftKey \? 5 : 0\.5/);
  });

  it('Ctrl+Shift+Z is redo, which is what the card claims', () => {
    // ⚑ Ctrl+Y is ALSO redo in the handler. The card lists only Ctrl+Shift+Z,
    // deliberately: it is the pairing people expect beside Ctrl+Z, and the card
    // is a reminder rather than an exhaustive list. Pinned so that stays a
    // choice rather than becoming an omission nobody noticed.
    expect(workspace).toMatch(/if \(e\.shiftKey\) redo\(\);/);
  });

  it('Delete removes the active point', () => {
    expect(workspace).toMatch(/e\.key === 'Delete'/);
  });

  it('Enter accepts and Escape backs out', () => {
    expect(workspace).toMatch(/e\.key === 'Enter'/);
    expect(workspace).toMatch(/e\.key === 'Escape'/);
  });

  it('the four zoom accelerators exist', () => {
    for (const call of ['zoomIn()', 'zoomOut()', 'zoomFit()', 'zoom100()']) {
      expect(workspace).toContain(call);
    }
  });
});

describe('the card is reachable both ways, which is the keystone requirement', () => {
  it('F1 opens it', () => {
    expect(workspace).toMatch(/e\.key === 'F1'/);
    expect(workspace).toMatch(/setHelpOverlayOpen\(true\)/);
  });

  it('a VISIBLE button opens it too — a key-only route is undiscoverable', () => {
    // If this ever fails because someone removed the button "since F1 does it",
    // that is the regression: a first-time user cannot press a key they have
    // never been told about.
    expect(workspace).toContain('data-testid="open-help-overlay"');
    expect(workspace).toContain('How to use PlotTracer');
  });
});

describe('the tool rows show the rail’s OWN glyphs', () => {
  // ⚑ David's call, and it is the keystone rule rather than decoration: the
  // rail is icons with no labels, so "3 — Place point" names something the
  // user still cannot find. The card has to show the picture to be a lookup.
  const RAIL_ICONS = [
    'HandIcon',
    'CalibrateIcon',
    'ImageEditIcon',
    'PlusIcon',
    'AutoTraceIcon',
    'SelectBoxIcon',
    'ErrorBarsIcon',
    'MeasureIcon',
    'CurveFitIcon',
    'GeometryIcon',
  ];

  it('imports every icon from icons.tsx rather than redrawing them', () => {
    // Redrawn glyphs would drift from the rail silently. Sharing the module is
    // what makes that impossible.
    for (const icon of RAIL_ICONS) {
      expect(overlay).toContain(icon);
    }
    expect(overlay).toMatch(/from '\.\/icons\.js'/);
  });

  for (const icon of RAIL_ICONS) {
    it(`${icon} is the glyph the rail itself uses`, () => {
      // If a tool's rail icon is swapped and the card is not, this fails --
      // which is the whole reason to assert against Workspace.tsx.
      expect(workspace).toContain(icon);
    });
  }

  it('every tool row carries an icon, not just some', () => {
    const start = overlay.indexOf('const TOOLS: Array<');
    const body = overlay.slice(start, overlay.indexOf('];', start));
    const rows = [...body.matchAll(/\['(\d)',\s*'[^']*',\s*(\w+)\]/g)];
    expect(rows).toHaveLength(10);
  });
});

describe('the card stays a card', () => {
  it('holds no version-specific detail, which is MANUAL.md’s job', () => {
    // The content rule: workflow in the app, everything that changes with a
    // release in the manual. A version number reaching the SCREEN means the
    // rule has started to erode.
    //
    // ⚑ Comments are stripped first, and that is not a loophole — the first
    // version of this assertion ran over the whole file and failed on this
    // component's own header ("the in-the-moment card (v2.0)"), which no user
    // will ever read. An assertion that fires on prose the rule does not
    // govern is one that gets weakened or deleted the first time it is
    // inconvenient.
    const visible = overlay.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(visible).not.toMatch(/v\d+\.\d+/);
  });

  it('does NOT offer the manual — that is a look-it-up action, not an in-the-moment one', () => {
    // David cut a "Read the full manual" link from this card's footer: the card
    // you flash open mid-calibration is the wrong place to be sent away to read
    // something. The manual lives in the Help card instead, as a real link.
    const visible = overlay.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(visible).not.toMatch(/manual/i);
    expect(workspace).toContain('data-testid="manual-link"');
  });

  it('the Help card OPENS the manual rather than printing its address', () => {
    // The v1.6 behaviour -- the bare URL rendered as plain selectable text --
    // is the defect being fixed ("the users could not simply click it"). If it
    // ever comes back as inert text, this catches it.
    const at = workspace.indexOf('data-testid="manual-link"');
    expect(at).toBeGreaterThan(-1);
    const button = workspace.slice(at, at + 400);
    expect(button).toContain("window.open(MANUAL_URL");
  });

  it('the Manual button sits beside the Challenge, not on its own row', () => {
    // David's placement call. They are the two places you LEAVE the card for,
    // so they share a row; the Challenge keeps the width and Manual takes only
    // what it needs.
    const challengeAt = workspace.indexOf('data-testid="challenge-start"');
    const manualAt = workspace.indexOf('data-testid="manual-link"');
    expect(challengeAt).toBeGreaterThan(-1);
    expect(manualAt).toBeGreaterThan(challengeAt);
    // Same flex row: no divider or paragraph between them.
    const between = workspace.slice(challengeAt, manualAt);
    expect(between).not.toContain('height: 1, background');
  });

  it('keeps the workflow to six steps — it is a reminder, not a tour', () => {
    expect(tableRows('WORKFLOW')).toHaveLength(6);
  });
});
