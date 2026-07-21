# PlotTracer — User Manual

A short, task-oriented guide to getting numbers out of a figure. For features,
install instructions, and keyboard shortcuts see the [README](README.md).

PlotTracer's core loop is **calibrate → capture → trace → correct → export**. The
canvas is the figure; everything else floats above it. The left rail holds the
tools (each numbered with its hotkey); the top bar is document actions (open,
save, export); the right panel is your extracted data.

---

## 1. Open a figure

**Open Image** (top bar), or drag an image onto the canvas, or paste from the
clipboard (`Ctrl+V`). Supported: PNG, JPG, GIF, BMP, WebP, SVG, TIFF, and **PDF**
(multi-page — you pick the page). Zoom with the scroll wheel (⌘/Ctrl+scroll on a
trackpad); pan with the middle mouse button, `Space`+drag, or `Ctrl`+arrow keys;
fit the view with `Ctrl+0`.

## 2. Choose the graph type and calibrate

Pick the graph type from the dropdown in the top bar — **XY** (linear/log/date),
**Bar**, **Polar**, **Ternary**, **Map**, **Circular chart recorder**,
**Histogram**, **Box plot**, **Line (categorical X)**, or **Error bars**.

Open the **Calibration** card (top-center) and place the reference points it asks
for — for XY that's two X points and two Y points. Click the point on the image,
then type the axis value it represents. Log and date axes are options on the card.
When every reference is placed, press **Calibrate**. The card shows **Calibrated ✓**.

> Tip: **Check calibration** overlays the computed axis box so you can confirm the
> mapping is right before you trace.

## 3. Capture the figure

Press **Capture figure** on the calibration card. This freezes the framed figure
as the working image of record — what you see is what you captured — so the data
always traces back to a stable source. (With a PDF, the captured figure and its
page are remembered in the project.)

## 4. Trace the curve

Several ways, depending on the figure — all on the left rail:

- **Add points** (`3`) — click along the curve. A zoom loupe follows the cursor
  for precision. This is the reliable default and works on anything.
- **Auto-extract** (`5`) — the wand tool, three mechanisms:
  - **Flood-fill** — click one point on a solid curve; it traces the connected line.
  - **By colour** — pick the series' colour; it extracts every matching pixel in
    one pass (good for dashed or marker curves). A live preview highlights exactly
    which pixels it will take; **Restrict to a box** limits it to a region so a
    same-coloured legend is ignored.
  - **Guide points** — for monochrome, dashed, or overlapping curves that colour
    can't separate: click a few guide points along one line and a spline fills the
    rest. The guide points are your record; the fill is marked as derived.
- For **scatter**, use the **Blob detector** (under Auto-extract) — one point per marker.

Every automatic method shows you what it captured *before* you commit, so you can
trust the result.

## 5. Correct

- **Select** (`2`) — click a point to select it, or drag a box to select a range.
  `Del` removes the selection; the arrow keys nudge selected points (Shift = coarse);
  `Esc` clears. It never selects calibration handles.
- Drag any point to reposition it; drag a calibration handle to re-calibrate live.
- Edit an XY value directly in the right-panel table.
- **Undo/redo** (`Ctrl+Z` / `Ctrl+Shift+Z`) covers everything, including image edits.

## 6. Multiple series and figures

- **+ Add** (right panel) starts another series on the same calibration — each
  named and colour-coded, captured side by side.
- **Extract another graph** re-enters a multi-page source (e.g. a paper's PDF) as
  a fresh figure. Flip between figures with the ◀ ▶ arrows by the calibration card;
  each keeps its own image, calibration, series, and graph type.

## 7. Measure (optional)

The **ruler** tool (`6`) opens a Measure card: **distance, angle, area, slope** —
in the chart's own units, or a scale you set from any known length on the image.
Measurements are a separate collection from your series data.

## 8. Export

**Export** (top bar) → **CSV, TSV, JSON, Excel (XLSX), LaTeX, MATLAB, Python**, or
a **PNG** of the annotated figure. Choose **Active** (the current series) or **All
series**. Values are rounded to the figure's real resolution — never padded with
false precision, never collapsed to zero — with a full-precision option when you
want every digit. Fitted curves and measurements export as their own blocks, kept
separate from the recorded points.

**Save Project** writes a `.zip` containing everything — image(s), calibration,
series, measurements, and the original source PDF — so the whole extraction reopens
exactly, and any number traces back to its figure. PlotTracer also opens
WebPlotDigitizer `.tar` projects.

---

*PlotTracer is free and open source (AGPL-3.0), fully offline — your figures never
leave your machine.*
