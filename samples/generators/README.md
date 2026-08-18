# Example-figure generators + ground truth

Every bundled example under `samples/*.png` is a **synthetic** figure. Each one is
produced by a **committed, seeded** generator here that emits **both** the PNG and
a `<name>.truth.json` - the exact values the figure was rendered from.

Why the truth files matter:

- **Reproducibility.** The originals were once made by throwaway scripts, so they
  couldn't be regenerated and their real values were lost. These can.
- **A self-test / accuracy score.** With the truth in hand, the app can tell a
  user how close their extraction landed - a "train against the real data" game.
- **The validation harness.** That same machinery (extraction vs. known truth →
  accuracy) is what any automated extraction workflow needs to trust its results.

## Truth schema

A structured target schema, flexed per graph type:

```jsonc
{
  "source": { "imagePath": "<name>.png", "note": "..." },
  "graphType": "xy" | "bar" | "histogram" | "categorical" | ...,
  "axes": { "x": {"label","min","max"}, "y": {"label","min","max"} },
  "series": [ { "name": "...", "points": [ /* type-specific */ ] } ]
}
```

`points` are `{x,y}` for XY, `{category,value}` for bar/categorical, and
`{binStart,binEnd,value}` for histogram. Two shapes vary from the template:
**ternary** uses `axes: {a,b,c}` (the app's corner labels, each with its `vertex`)
and `points: {a,b,c}`; the **multi-page PDF** replaces `graphType`/`axes`/`series`
at the top level with a `figures: [ {page, graphType, axes, series} ]` array - one
entry per page.

## Running

Dev-only (not a runtime dependency):

```bash
pip install numpy matplotlib pillow
python3 samples/generators/gen_samples.py
```

Deterministic: same numpy seed + matplotlib version → identical PNG + truth.

## Coverage

- **`gen_samples.py`** - **all 15 examples** (14 complete 2026-07-20; **spider added
  v1.4, 2026-07-27**).
  scatter, xy-multiseries, bar, histogram, categorical, xy-stress-strain (the e2e
  `SAMPLE_IMAGE` - kept a navy curve so the colour-trace + segment-fill tests still
  pass), errorbar, boxplot, polar, ccr, dash-styles, **ternary**, **map**, and the
  3-page **multipage-figures** PDF. Truth flexes per type: `{x,y}` (XY),
  `{category,value}` (bar/categorical), `{binStart,binEnd,value}` (histogram),
  `{x,y,yUpper,yLower}` (errorbar), `{category,min,q1,median,q3,max}` (boxplot),
  `{angle,radius}` (polar), `{time,value}` (ccr), `{a,b,c}` (ternary), `{name,x,y}`
  (map sites), `{axis,name,value}` (**spider**), and a `figures[]` array (the
  multi-page PDF).
- **`spider-material-profile`** (v1.4) is hand-built like the ternary - matplotlib's
  polar axes assume ONE radial scale, and the point of the figure is that each spoke
  carries its own. Three deliberate properties: **six axes with six different
  ranges** (tensile 0-120 MPa beside a cost index 0-5) sharing a **centre of 0**,
  and **line-only** polygons in three colours. The per-axis ranges are the case the
  field's only prior art (ChartSense, CHI 2017) excludes by assuming a shared scale;
  filling the polygons would blend their colours where they overlap, which is the
  hard-won detail that same paper reports breaking its hue clustering, and would
  hide the vertices a user has to click. Its truth adds a `calibration` block keyed
  by the app's OWN step keys (`origin`, `spoke1..N`), and
  `core/__tests__/spiderSampleTruth.test.ts` reads the committed file back: it
  checks the winding and, above all, that the anchors are not Y-FLIPPED - a flip
  leaves every number correct and every anchor inside the image while calibrating a
  MIRRORED chart, and nothing else in the suite reads this file.
- **Method for the last three** (ternary/map/pdf): their source values were lost
  with the original throwaway scripts, so they were **measured off the current
  exemplar images and replotted from those measurements** (David, 2026-07-20). The
  measurement recovered clean round numbers for the ternary (so those *were* the
  originals); the map sites were read via the axes-rectangle calibration; the PDF
  pages were read off the markers. Because each is replotted *from* the measured
  values, the committed truth is exact for the regenerated figure.
- **To regenerate only the last three** (leaving the byte-stable 11 untouched):
  `python3 -c "import gen_samples as g; g.gen_ternary(); g.gen_map(); g.gen_multipage_pdf()"`
  from this directory.
