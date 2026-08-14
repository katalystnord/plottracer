# CLAUDE.md — PlotTracer

Context and working guidance for anyone (human or Claude) developing PlotTracer.
Read it before writing code. The **Ten Tenets** below are the premise; everything
else is subordinate to them.

---

## ⚑ The Ten Tenets

1. **Graph in → reliable data out.** This is the whole product. Nothing may put
   constraints on this workflow. Everything else may only *augment* it, never get
   in the way of it.
2. **We needed a desktop digitizer with both the technical capability AND the
   development vitality to keep growing.** That gap is why this project exists —
   both halves matter.
3. **We took the best available open-source digitizer as a starting point** for
   our own development. A starting point — not a parent.
4. **We fold every vetted good idea from that lineage into our own stack** —
   rebuilt as our own code.
5. **We hold no allegiance to that lineage at the code level** — licensing and
   attribution only.
6. **All interoperability with other tools happens at the file / import-export
   level**, never at the model or code level.
7. **UX has the same standing as technical capability.** A UX defect is a defect.
8. **We introduce our own designs and break with the source stack** whenever a
   solution we want requires it.
9. **We RECORD the data first; we do not interpret it.** Interpretation is
   secondary to recording and belongs downstream — or nowhere.
10. **We seek the simplest, most robust solution that carries the least
    interpretation or modelling** needed to achieve Tenet 1.
11. **We model in both directions before we build.** Before implementing a model
    we establish (a) what the **REVERSE** model needs — what a consumer would
    require to regenerate the figure from our record — and (b) whether anyone
    has **already established a model** for the thing we are about to model. We
    take the learnings from both.

**Using them**
- **Tenet 11 is the design check for any RECORD**, and it has paid twice.
  Reverse: the heatmap record was tested by regenerating the hardest figure
  (unequal cells, both axes continuous) from the record alone — max difference
  **0.0**, recovered edges exact, while a centres-only record was wrong by up to
  0.375 data units. Prior art: **matplotlib settled bounds-vs-centres by
  itself** — `shading='flat'` REQUIRES n+1 edges and refuses centres, so a
  record carrying only centres fails against a real consumer. The bar model came
  the same way, by lifting the chart libraries' models in reverse.
  ⚑ **The two halves cover for each other.** Heatmaps have essentially NO prior
  art among digitizers — but the generating libraries have a model, and that is
  where (b) was answered when (a) had no peer to compare against.
  ⚑⚑ **IT APPLIES TO THE WORKFLOW TOO, and the reverse direction is the same
  trick**: for a record, the reverse is *what a library needs to REGENERATE the
  figure*; for a workflow, it is *how a tool that CREATES this figure ASKS the
  user for the same information*. Both sweeps are already project practice — 22
  tools surveyed for pie, the plotdigitizer data-panel study
  (`docs/competitor-data-panel-study.md`), WPD, Engauge, StarryDigitizer. ⚑
  **LabPlot sits on BOTH sides** — it digitizes AND it plots — which is why it
  has repeatedly been the most informative single source.
  ⚠️ **v2.2 ran this on the record and NOT on the workflow, and that is exactly
  where it broke.** The answer was sitting in the same sweep: a plotting library
  asks for a 2-D array plus coordinate vectors plus a colormap — two banded axes
  and a colour axis — and `shading='flat'`'s demand for n+1 edges is the SAME
  fact appearing on the workflow side as *"you must say where the boundaries
  are."* The record half was applied and passed; the workflow half was not run.
  So: a green reverse test on the record is not evidence the FEATURE is right —
  it is evidence that half the tenet was satisfied.
- **Tenet 1 is the yardstick.** Grade any change by "does this help graph in →
  reliable data out?"
- **Tenets 9 + 10 are the design check for any capture feature:** am I recording
  what the figure *shows*, or what I *think it means*? If a field can't be measured
  off the pixels — if it must be typed, defaulted, or inferred — it is
  interpretation, and it belongs downstream of the record or nowhere.
- **Tenets 5 + 6 + 8 govern "parity" questions.** Reading another tool's files
  faithfully and attributing it: yes. Owing its code or mechanisms anything: no.

---

## ⚑⚑ From an agreed design to a build — four gates

**Why this exists.** v2.2's heatmap was designed over three hours and settled
before any code. Everything then passed — 3,467 tests green, typecheck, lint, the
full Electron e2e suite — and the next morning David found seven defects in one
sitting, including a whole missing half of the feature. Nothing was rotten and
nobody was careless. The design was recorded as **conclusions**, conclusions
under-determine a build, and every instrument in this project asks whether *the
code agrees with itself*.

These are gates, not principles. The principle already existed — "an agreed
design's cases become named tests" — and it did not fire.

1. **A design is not finished until every case reads "given X, the screen shows
   Y."** A conclusion can be resolved more than one way and still sound satisfied.
   *"The real question is whether each axis is category or value"* is true, and it
   permits "so category-ness decides whether the grid exists at all" — which is
   what got built, and which cost the value×value heatmap its entire grid. The
   memo named four axis cases and gave outcomes for none, so the build exercised
   two. **If a case cannot be written as an observable outcome, the design is
   still a conclusion.**

2. **The cases become named failing tests before the first line of
   implementation.** Named for the CASE, not the function — `a value axis has
   bands too`, not `initialGridFor returns dividers`. A design doc reads as
   satisfied; a red test does not.

3. **⚑⚑ A comment may say WHY a mechanism is what it is. It may NOT assert what
   the design requires unless a test of that name enforces it.** This is the one
   that hid v2.2. `core/heatmapGrid.ts` opened by quoting the agreed memo almost
   verbatim — *"ADJUSTABILITY IS LOAD-BEARING, AND IT KILLS ANY rows × columns
   COUNT"* — above code that did not do that, while `Workspace.tsx` grew its own
   count boxes. A comment restating the design is **false evidence of
   compliance**: every later reader, including the author, checks the header, sees
   the agreement and stops looking. Restating a design you have not enforced
   manufactures the very thing that would have caught you.

4. **⚑⚑ A walkthrough test may only click what a prompt on screen tells it to
   click.** If the test needs a coordinate, an order or a precondition that no
   visible text describes, that is a **UI defect found at the moment the test is
   written** — not a detail of the test. v2.2's shared-corners e2e clicked the
   plot box's TOP-RIGHT corner while the step prompt said only *"click a second
   pixel position of a known, different X value"*; every user clicks the bottom
   axis, lands both Y points on one row, and gets a parallel-axes refusal at the
   end of the walk. The test proved the mechanism and concealed the workflow,
   because it was written by the mind that already knew the answer. This gate is
   what turns "could Parallel Universe David do it?" from a judgement call into a
   test-authoring constraint.

⚠️ **Where intuition used to cover this.** Spider, pie and bar were verifiable by
eye — a slice's angle or a bar's height is either right or visibly wrong, so
under-specification got caught by looking. A heatmap has no such referent: colour
IS the value, and a wrong cell is silent by construction. The safety net was
removed by the subject matter, not by anyone getting sloppy. Expect the same
wherever the reading cannot be eyeballed.

### ⚑⚑ WHEN WE ARE FIRST, three correctives are missing at once

Every earlier type had something outside this project pushing back: bar had WPD's
model, the chart libraries lifted in reverse, and 32 published figures; pie had 22
surveyed tools. The heatmap has **no prior art at all** — no digitizer does this —
while being the largest type by prevalence (406,986 articles). Nobody built it
because it is hard, not because it does not matter. So all three correctives are
absent together:

- **the eye** — colour is the value, so a wrong cell is silent;
- **prior art** — nothing to measure against, or to differ from deliberately;
- **a round-trippable workflow** — the RECORD can be validated by construction
  (regenerate the figure from it: max difference 0.0), and was. **A GESTURE
  CANNOT BE.** There is no reverse test for "click the second corner."

⚑ That asymmetry is the whole story of v2.2: the half with an instrument survived
contact, the half with none collapsed. Read a pile of UX findings on a novel type
as the missing instrument finally arriving, not as a bad day.

⚑ **Reuse is MORE load-bearing here, not less.** With no external convention
available, *our own mechanisms are the only convention that exists* — category
ticks are the closest thing to a standard this problem has. Reinventing them
costs more here than the same mistake would cost anywhere else in the codebase.

### ⚑⚑ WHAT A FIRST BUILD MAY AND MAY NOT GET WRONG

Do not let "first time is never perfect" absorb the avoidable half. The line:

**Unreasonable to expect first time — the capture WORKFLOW.** That shared corners
needed a corner-to-corner instruction; that the walk must survive ticking an
option mid-way; that a prompt sent the second click to the wrong corner. None of
it is knowable until a person makes the gesture, and no test can be written for a
gesture nobody has made yet. Expect two or three passes with David's hands in
between, and **keep the chains short** — drive it after each phase, not after
five, so a workflow correction lands before anything is stacked on it.

**Entirely reasonable to expect first time — the RECORD and the AGREED CASES.** A
value×value heatmap having no grid was not a discovery from use: it was one of
four cases named in the settled design, never implemented and never tested. Same
for reinventing a mechanism the reuse rule already covered. Those needed a red
test, not a user.

The four gates above aim at the second list only. They cannot stop a workflow
being wrong on its first outing — they stop a NAMED CASE being silently absent
while every instrument reports green.

---

## Project

- **Name / token:** PlotTracer / `plottracer`
- **What it is:** a cross-platform (Linux / macOS / Windows) Electron desktop app
  that extracts numerical data from the figures in scientific papers.
- **Licence:** AGPL-3.0.
- **Lineage & attribution (required):** started from **WebPlotDigitizer** by Ankit
  Rohatgi (AGPL-3.0). Some algorithms are **clean-room** reimplementations of
  **Engauge Digitizer** ideas (written from the algorithm description, never ported
  from its GPL-2.0 C++). UI design language follows **Ketcher**. Keep these
  acknowledgements in the README and the in-app About dialog.

---

## Architecture

```
core/         WebPlotDigitizer's calibration & data-model math, ported once to TS
              (7 axes classes, Dataset/Calibration, plotData serialize/deserialize,
              exportValues, exportPrecision, inputParser). Pure, no DOM.
algorithms/   Pure extraction/analysis: segment fill, grid removal, colour trace,
              blob detect, interpolation, curve fit, geometry, histogram, error bar.
engine/       Framework-agnostic vanilla TS: canvas/Konva rendering, zoom/pan,
              the calibration/tool session, project file, CSV/table export, image
              edits, tar/wpd import. No React.
ui/           The React app (Workspace.tsx + panels/cards) AND the Electron shell
              (electron-main.cjs / -preload / -ipc / -menu). package.json `main`.
icons/        SVG icon set (Ketcher-derived + clean-room originals).
samples/      Bundled example figures + committed *.truth.json ground truth.
build/        electron-builder config + packaging helpers.
```

**Design stack:** TypeScript throughout; React for the UI shell; a
framework-agnostic engine module for canvas/interaction; **Konva.js** for the
overlay layer (points, handles, fit lines); plain Canvas2D for the base image.

---

## Development

```bash
npm start           # build ui/ and launch the Electron app
npm run typecheck   # tsc --noEmit (root + ui)
npm run lint        # eslint
npm test            # builds ui/, then runs the full vitest suite (unit + e2e)
```

- ⚑⚑ **REUSE BEFORE YOU BUILD — and REVIEW FOR IT.** Before adding a module,
  a component, a marker style or a gesture, find what already does that job and
  extend it. Ask in review: *what existing thing does this duplicate, and why is
  it not being used?* A parallel mechanism is not neutral — it forks every
  decision downstream of it, and each fork looks locally reasonable.
  ⚠️ **v2.2 is the case study.** The settled design said v2.1's category ticks
  were the structural FOUNDATION for the heatmap grid. That was read as a claim
  about the IDEA rather than the CODE, and `core/heatmapGrid.ts` was written with
  a comment justifying a second store. From that one paragraph came: its own
  marker graphics instead of `categoryTickMarkers`, its own count box instead of
  the declared count, its own tick convention (none) instead of
  `TickConvention` — and the same paragraph asserted "a heatmap always has a
  numeric scale", which is what hid the missing category axis for a whole
  release. David: *"We had all of this already in the design, and you still went
  and invented everything again. Why??"*
- **Tests:** unit tests across core/algorithms/engine; Electron + Playwright e2e in
  `ui/__tests__/workspace.e2e.test.ts`. **Add coverage as part of the same change,
  not as an afterthought.** A green test proves nothing until it has been shown to
  fail *without* the fix.
- **Packaging:** `build/electron-builder-ui.yml`; CI builds Linux + macOS (.dmg) +
  Windows (.exe) on tag push (`.github/workflows/build.yml`).
- ⚑⚑ **REBUILD THE LOCAL PACKAGES AFTER EVERY COMMITTED CHANGE, WITHOUT BEING
  ASKED** — `npm run ui:dist:linux`, then state the path and verify the version by
  READING the control file (`dpkg-deb -f …`), never by executing the package.
  David, 2026-08-12: *"The best thing that has held today is me actually testing
  things, so please always rebuild the local packages… I do not trust anything
  until I have seen it."* That day the suite was green at 3,448 tests and he still
  found six real defects in one afternoon — a value axis assumed where the design
  said category, an output panel where no other type keeps its output, examples
  drawn to fit the tool's own limits. **His hands on the built app are the only
  instrument here that points outward**; every other one (tests, mutation, lint,
  the screenshot bench) asks whether the code agrees with itself. A stale package
  silently disables the best check the project has, so "I'll rebuild when you're
  ready" is the wrong answer — build it and say where it is.
- **Commits:** small, self-contained, and verified (typecheck + lint + relevant
  tests) before committing. ⚑ **A pre-commit hook enforces the typecheck** —
  install it once per clone with `git config core.hooksPath tools/git-hooks`.
  It exists because a green test run does NOT mean the code compiles: vitest
  strips types rather than checking them, and so does `vite build`, so a commit
  that did not typecheck got in and CI had nothing to say about it either.
  `.github/workflows/build.yml`'s `check` job is the half that survives a fresh
  clone and `--no-verify`. End commit messages with:
  `Co-Authored-By: Claude Opus 5.0 (1M context) <noreply@anthropic.com>`

---

## Key constraints

- **AGPL-3.0 compatibility** for all code. The Engauge-derived algorithms are
  clean-room — keep implementation and any reference reading clearly separated.
- **No cloud dependency.** The app must work fully offline; a user's figures never
  leave their machine.
- **Read other tools' project files faithfully; our own file format is ours**
  (Tenet 6). Import filters translate a foreign model into ours at the boundary.
- **Acknowledge upstream clearly** (README + About) — legal requirement and the
  right thing to do.
- **Guards belong in the model, and the model has more than one entrance** — the
  load/deserialize path must enforce the same validity as the interactive path.
