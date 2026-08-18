/**
 * PlotTracer's own defect shapes, as lint rules.
 *
 * ⚑⚑ WHY THESE EXIST. Every rule below is a bug this repository has actually
 * shipped - several of them more than once. The ranked audit plan called for
 * Semgrep precisely to encode them, on the reasoning that "this is the
 * project's own philosophy applied to tooling: turn a hard-won lesson into an
 * instrument so it cannot recur." Semgrep needs a Python toolchain that is not
 * available here; ESLint is already installed, already gates `npm run lint`,
 * and can express all of these against a TypeScript-only codebase. So the
 * instrument is the same, the engine is the one already in the build.
 *
 * ⚑ THE BAR FOR ADDING A RULE: it must name a defect that REACHED master at
 * least once. A rule that encodes a preference rather than a scar belongs in
 * the style config, not here - the value of this file is that every entry is
 * evidence, and diluting it with taste is how it stops being read.
 *
 * ⚑ Each rule carries the commit or session that earned it, so a future reader
 * can judge whether it still applies rather than obeying it blindly.
 */

/** ─────────────────────────────────────────────────────────────────────────
 *  ⛔ REMOVED: `no-fabricated-label`.
 *
 *  It flagged `?? 'Bar0'` / `` `Series ${n}` `` - the defect found FOUR times on
 *  2026-07-30. Written and run, it produced 15 hits and EVERY ONE was a false
 *  positive: `Group ${i}` and `Category ${i}` are on-screen labels for a slot
 *  the user has not named, `Point ${n} selected` is a tips-bar sentence, and
 *  `Series ${n}` is a real default name the user can rename.
 *
 *  ⚑ The real defect was narrower than the pattern: a name written INTO THE
 *  RECORD as though someone had transcribed it. Nothing in the syntax
 *  distinguishes that from a label drawn on screen - the difference is where the
 *  string goes, several calls away.
 *
 *  ⚑ So it is deleted rather than kept with disables. A rule that fires on
 *  correct code gets silenced, and a silenced rule is worse than no rule: it
 *  looks like coverage. The lesson stays where it works - grep the literal
 *  string when one instance is found (feedback_sweep_and_self_audit).
 *  ───────────────────────────────────────────────────────────────────────── */

/** ─────────────────────────────────────────────────────────────────────────
 *  2. A RegExp built from a runtime string.
 *
 *  `engine/wpdImport.ts` built one from a FOLDER NAME, so a figure directory
 *  called `Fig 3 (rev 2)` threw on open (round-2 audit, 2026-07-31). Any name
 *  from a foreign file is attacker-controlled and will eventually contain a
 *  metacharacter.
 *  ───────────────────────────────────────────────────────────────────────── */
const noDynamicRegexp = {
  meta: {
    type: 'problem',
    docs: { description: 'Do not build a RegExp from an interpolated runtime string.' },
    schema: [],
    messages: {
      dynamic:
        'RegExp built from a runtime string. A name out of a file WILL contain a metacharacter one day - ' +
        'this threw on a folder called "Fig 3 (rev 2)". Compare directly, or escape first.',
    },
  },
  create(context) {
    return {
      'NewExpression[callee.name="RegExp"]'(node) {
        const arg = node.arguments[0];
        if (!arg) return;
        if (arg.type === 'TemplateLiteral' && arg.expressions.length > 0) {
          context.report({ node, messageId: 'dynamic' });
        }
        if (arg.type === 'BinaryExpression' && arg.operator === '+') {
          context.report({ node, messageId: 'dynamic' });
        }
      },
    };
  },
};

/** ─────────────────────────────────────────────────────────────────────────
 *  3. A number parsed out of a file without the project's own parser.
 *
 *  `MapAxes` read its scale length with `parseFloat`, so "1,000" became 1 and
 *  every distance was 1000x wrong, silently (round-2 audit). `InputParser` is
 *  the one place that decides what a typed or file-borne value means, including
 *  dates and separators.
 *
 *  Scoped to core/axes/ - the calibration classes, where a wrong number is a
 *  wrong READING rather than a wrong pixel.
 *  ───────────────────────────────────────────────────────────────────────── */
const noRawNumberParse = {
  meta: {
    type: 'problem',
    docs: { description: 'Calibration values go through InputParser, not parseFloat/Number.' },
    schema: [],
    messages: {
      raw:
        '{{fn}}() on a calibration value. "1,000" becomes 1 and every reading is silently wrong - this shipped in ' +
        'MapAxes. Use InputParser, which is the one place that decides what a typed value means.',
    },
  },
  create(context) {
    const file = context.filename ?? context.getFilename();
    if (!/core\/axes\//.test(file)) return {};
    const src = context.sourceCode ?? context.getSourceCode();
    return {
      CallExpression(node) {
        const name = node.callee.type === 'Identifier' ? node.callee.name : null;
        if (name !== 'parseFloat' && name !== 'parseInt') return;
        const arg = node.arguments[0];
        if (!arg) return;
        // ⚑ ONLY VALUES THE USER OR A FILE DECLARED - `cp.dx`, `cp.dy`,
        // `globalValues[...]`, `meta[...]`. A first draft flagged every
        // parseFloat in the directory and hit `parseFloat(String(pxi))`, which
        // parses a PIXEL: already a number, nothing to misread, no InputParser
        // involved. Those are the coordinates, not the calibration.
        const text = src.getText(arg);
        if (/\.d[xyz]\b|globalValues|metadata|meta\[/.test(text)) {
          context.report({ node, messageId: 'raw', data: { fn: name } });
        }
      },
    };
  },
};

/** ─────────────────────────────────────────────────────────────────────────
 *  4. ⚑⚑ A `calibrate()` that cannot fail - the defect this project has now
 *  shipped FIVE times.
 *
 *  xy, polar, map, ternary (2026-07-31), then PieAxes (2026-08-01, found by a
 *  type-aware lint). Each returned `true` on input that made every reading null,
 *  0 or NaN, with nothing on screen wrong. It is the single most expensive shape
 *  in this codebase's history, so it gets a rule of its own: a calibrate method
 *  that never returns false is refusing nothing.
 *  ───────────────────────────────────────────────────────────────────────── */
const calibrateMustRefuse = {
  meta: {
    type: 'problem',
    docs: { description: 'A calibrate() must be able to refuse.' },
    schema: [],
    messages: {
      cannotFail:
        'calibrate() has no `return false` - it cannot refuse anything. This exact shape has shipped FIVE times ' +
        '(xy, polar, map, ternary, pie), each reporting success while every reading came back null, 0 or NaN.',
    },
  },
  create(context) {
    // ⚑ THE CHECK IS ON THE WHOLE CLASS, not the method. XYAxes.calibrate is
    // three lines that DELEGATE to processCalibration, where the nine refusals
    // live; reading only the method body called it dead and was wrong. What
    // matters is whether the calibration PATH can refuse at all, and the class
    // is the unit that owns that path.
    return {
      ClassBody(node) {
        const cal = node.body.find(
          (m) => m.type === 'MethodDefinition' && m.key.type === 'Identifier' && m.key.name === 'calibrate'
        );
        if (!cal) return;
        // ⚑ A calibrate() THAT TAKES NO INPUT has nothing to refuse, and that is
        // a real category rather than an exception carved out for one class:
        // ImageAxes maps a pixel to itself (pixelToData returns [px, py]), so
        // there are no declared values, no scale and no geometry that could be
        // degenerate. Keyed on the signature, not the class name, so any future
        // identity axes is covered and any axes that DOES take input is not.
        if (cal.value.params.length === 0) return;
        const src = context.sourceCode ?? context.getSourceCode();
        if (!/return\s+false/.test(src.getText(node))) {
          context.report({ node: cal, messageId: 'cannotFail' });
        }
      },
    };
  },
};

export const plottracer = {
  rules: {
    'no-dynamic-regexp': noDynamicRegexp,
    'no-raw-number-parse': noRawNumberParse,
    'calibrate-must-refuse': calibrateMustRefuse,
  },
};
