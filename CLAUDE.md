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

**Using them**
- **Tenet 1 is the yardstick.** Grade any change by "does this help graph in →
  reliable data out?"
- **Tenets 9 + 10 are the design check for any capture feature:** am I recording
  what the figure *shows*, or what I *think it means*? If a field can't be measured
  off the pixels — if it must be typed, defaulted, or inferred — it is
  interpretation, and it belongs downstream of the record or nowhere.
- **Tenets 5 + 6 + 8 govern "parity" questions.** Reading another tool's files
  faithfully and attributing it: yes. Owing its code or mechanisms anything: no.

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

- **Tests:** unit tests across core/algorithms/engine; Electron + Playwright e2e in
  `ui/__tests__/workspace.e2e.test.ts`. **Add coverage as part of the same change,
  not as an afterthought.** A green test proves nothing until it has been shown to
  fail *without* the fix.
- **Packaging:** `build/electron-builder-ui.yml`; CI builds Linux + macOS (.dmg) +
  Windows (.exe) on tag push (`.github/workflows/build.yml`).
- **Commits:** small, self-contained, and verified (typecheck + lint + relevant
  tests) before committing. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

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
