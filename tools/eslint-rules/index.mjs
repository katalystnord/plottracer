/**
 * PlotTracer's own defect shapes, as lint rules.
 *
 * ⚑⚑ WHY THESE EXIST. Every rule below is a bug this repository has actually
 * shipped — several of them more than once. The ranked audit plan called for
 * Semgrep precisely to encode them, on the reasoning that "this is the
 * project's own philosophy applied to tooling: turn a hard-won lesson into an
 * instrument so it cannot recur." Semgrep needs a Python toolchain that is not
 * available here; ESLint is already installed, already gates `npm run lint`,
 * and can express all of these against a TypeScript-only codebase. So the
 * instrument is the same, the engine is the one already in the build.
 *
 * ⚑ THE BAR FOR ADDING A RULE: it must name a defect that REACHED master at
 * least once. A rule that encodes a preference rather than a scar belongs in
 * the style config, not here — the value of this file is that every entry is
 * evidence, and diluting it with taste is how it stops being read.
 *
 * ⚑ Each rule carries the commit or session that earned it, so a future reader
 * can judge whether it still applies rather than obeying it blindly.
 */

/** ─────────────────────────────────────────────────────────────────────────
 *  1. A fabricated name written into the record.
 *
 *  Found FOUR separate times in one day (2026-07-30): `autoLabelTuple`
 *  inventing "Bar0", the same generalised to Pie's "Slice0", and — found only
 *  by grepping for the literal string, because nothing calls anything else —
 *  `core/exportValues.ts`'s independent port of the same upstream default. Two
 *  more in `spreadsheetModel.ts`/`exportAssembly.ts` inventing "Series N" when
 *  their own cross-checks disagreed.
 *
 *  A placeholder that LOOKS like a transcribed value is worse than a blank: the
 *  reader cannot tell it was never measured. Blank is the honest answer.
 *  ───────────────────────────────────────────────────────────────────────── */
const noFabricatedLabel = {
  meta: {
    type: 'problem',
    docs: { description: 'A default label must not look like a value someone typed.' },
    schema: [],
    messages: {
      fabricated:
        'Fabricated label "{{value}}". A name nobody typed must be BLANK, not a placeholder that reads as transcribed ' +
        '(this defect shipped four times: Bar0, Slice0, exportValues, Series N).',
    },
  },
  create(context) {
    // "Bar0", "Slice1", "Series 3" — a capitalised word touching a digit.
    const SHAPE = /^(Bar|Slice|Series|Category|Point|Axis|Group)\s*\d*$/;
    function check(node, raw) {
      if (typeof raw === 'string' && SHAPE.test(raw) && /\d/.test(raw)) {
        context.report({ node, messageId: 'fabricated', data: { value: raw } });
      }
    }
    return {
      // `x ?? 'Bar0'` and `x || 'Series 1'` — the fallback position specifically.
      'LogicalExpression[operator="??"] > Literal:last-child'(node) {
        check(node, node.value);
      },
      'LogicalExpression[operator="||"] > Literal:last-child'(node) {
        check(node, node.value);
      },
      // `'Bar' + i` / `` `Bar${i}` `` — building one rather than defaulting to it.
      'BinaryExpression[operator="+"] > Literal:first-child'(node) {
        if (typeof node.value === 'string' && /^(Bar|Slice|Series|Category|Point|Axis|Group)\s*$/.test(node.value)) {
          context.report({ node, messageId: 'fabricated', data: { value: node.value + '<n>' } });
        }
      },
      TemplateLiteral(node) {
        const head = node.quasis[0]?.value?.raw ?? '';
        if (node.expressions.length > 0 && /^(Bar|Slice|Series|Category|Point|Axis|Group)\s*$/.test(head)) {
          context.report({ node, messageId: 'fabricated', data: { value: head + '${...}' } });
        }
      },
    };
  },
};

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
        'RegExp built from a runtime string. A name out of a file WILL contain a metacharacter one day — ' +
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
 *  Scoped to core/axes/ — the calibration classes, where a wrong number is a
 *  wrong READING rather than a wrong pixel.
 *  ───────────────────────────────────────────────────────────────────────── */
const noRawNumberParse = {
  meta: {
    type: 'problem',
    docs: { description: 'Calibration values go through InputParser, not parseFloat/Number.' },
    schema: [],
    messages: {
      raw:
        '{{fn}}() on a calibration value. "1,000" becomes 1 and every reading is silently wrong — this shipped in ' +
        'MapAxes. Use InputParser, which is the one place that decides what a typed value means.',
    },
  },
  create(context) {
    const file = context.filename ?? context.getFilename();
    if (!/core\/axes\//.test(file)) return {};
    return {
      CallExpression(node) {
        const name = node.callee.type === 'Identifier' ? node.callee.name : null;
        if (name === 'parseFloat' || name === 'parseInt') {
          context.report({ node, messageId: 'raw', data: { fn: name } });
        }
      },
    };
  },
};

/** ─────────────────────────────────────────────────────────────────────────
 *  4. ⚑⚑ A `calibrate()` that cannot fail — the defect this project has now
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
        'calibrate() has no `return false` — it cannot refuse anything. This exact shape has shipped FIVE times ' +
        '(xy, polar, map, ternary, pie), each reporting success while every reading came back null, 0 or NaN.',
    },
  },
  create(context) {
    function check(node, name) {
      if (name !== 'calibrate') return;
      const src = context.sourceCode ?? context.getSourceCode();
      const body = src.getText(node);
      if (!/return\s+false/.test(body)) {
        context.report({ node, messageId: 'cannotFail' });
      }
    }
    return {
      MethodDefinition(node) {
        if (node.key.type === 'Identifier') check(node.value, node.key.name);
      },
    };
  },
};

export const plottracer = {
  rules: {
    'no-fabricated-label': noFabricatedLabel,
    'no-dynamic-regexp': noDynamicRegexp,
    'no-raw-number-parse': noRawNumberParse,
    'calibrate-must-refuse': calibrateMustRefuse,
  },
};
