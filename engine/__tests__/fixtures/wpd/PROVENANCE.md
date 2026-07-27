# Provenance — third-party test fixtures (UNMODIFIED)

These four files are **not ours**. They are WebPlotDigitizer's own test project
files, copied here verbatim.

| File | Upstream path |
|---|---|
| `wpd3_bar.json` | `tests/files/wpd3_bar.json` |
| `wpd3_xy.json` | `tests/files/wpd3_xy.json` |
| `wpd4.json` | `tests/files/wpd4.json` |
| `wpd4_2_with_masks.json` | `tests/files/wpd4_2_with_masks.json` |

- **Source:** WebPlotDigitizer by Ankit Rohatgi —
  <https://github.com/automeris-io/WebPlotDigitizer>
- **Copyright:** 2010–2025 Ankit Rohatgi
- **Licence:** GNU Affero General Public License v3.0 — the same licence this
  project is distributed under, which is why they can live here at all.
- **Modifications:** none. Verified byte-identical against the upstream working
  copy with `cmp` on 2026-07-27.
- **Not shipped:** test fixtures are outside the packaged app's `files:` list
  (`build/electron-builder-ui.yml`), so they are conveyed by this repository only.

## Why they are here rather than fixtures of our own

Our import filter has to read **someone else's** format faithfully (tenet 6:
interoperability happens at the file level). A fixture we authored to our own
liking would only prove that we agree with ourselves — it would encode our reading
of the format as if it were the format. These files are what the other tool
actually writes.

## ⚑ Do not edit them

An edited "upstream" fixture silently stops testing upstream: the tests keep
passing and stop meaning anything. If a case needs different data, add a NEW
fixture beside these and name it as ours.

## What you are looking at, if you ran the import e2e and saw a wavy graph

`wpd4.json` holds six figures. Its `xy data` dataset is 144 points tracing
WebPlotDigitizer's **own** sample figure — an oscillation of growing amplitude
across x = 0…2π, y ≈ −1.45…1.26. The tar-import e2e pairs that project with **our**
`samples/xy-stress-strain.png` as the archive's image, so the app draws their
points over our figure. Confusing on screen, correct as a test: what is under test
is whether we read their file, not whether the picture matches.
