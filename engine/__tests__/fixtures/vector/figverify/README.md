# figverify's renderer fixtures

These files come from figverify (https://github.com/Bowen-Sun-0728/figverify, commit 0911ee2, `tests/data/renderers/`), MIT licence, (c) 2026 the figverify authors. The licence is in `LICENSE` beside them.

- **What they are:** one known 50-point scatter (`known_xy.npy`, converted here to `known_xy.json`), drawn by six renderers: matplotlib, PGFPlots, Plotly (Chromium Skia), R `pdf()`, and ggplot2 through `cairo_pdf()` and `pdf()`.
- **Used by:** `engine/__tests__/vectorReverse.test.ts`. The markers are read from the drawing, the axes from the figure's own labels, and the result is compared with the known points.
