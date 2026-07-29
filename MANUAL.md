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
**Bar**, **Polar**, **Spider / Radar**, **Pie / Donut**, **Ternary**, **Map**,
**Circular chart recorder**, **Histogram**, **Box plot**, or **Line (categorical
X)**.

Error bars are not a graph type — they are **rail tool 6**, captured on top of
whichever series they belong to (§9).

Open the **Calibration** card (top-center) and place the reference points it asks
for — for XY that's two X points and two Y points.

**Spider / radar charts** work differently, because the number of axes belongs to
the figure rather than to the tool. You click the **centre** and give the value
every axis starts from (0 unless the chart says otherwise), then for each spoke you
click one point of known value on it and type that value and the axis's name — one
click supplies the ray's direction *and* its scale. Use **+ Add axis** for as many
as the chart draws; going clockwise keeps you in step, but nothing forces the order.
Each axis keeps its **own range**, so a chart with tensile strength on one spoke and
a cost index on the next reads correctly with no rescaling.

Capturing then steps round the axes for you: the live one is drawn in magenta on
the figure, the tips bar names it, and your click is recorded where it crosses that
ray — points sit **on** the axis, so what you see is the number recorded. The table
reads one row per axis and one column per series. Click the point on the image,
then type the axis value it represents. Log and date axes are options on the card.
When every reference is placed, press **Calibrate**. The card shows **Calibrated ✓**.

> Tip: **Check calibration** overlays the computed axis box so you can confirm the
> mapping is right before you trace.

**Pie and donut charts** are calibrated from the **outline**, not from the centre.
Click three or more points around the rim — three fit a circle exactly, five or more
fit an ellipse and let the app tell you how well the rim really is one — and the
centre is worked out from them. Nothing asks you to click the middle, because a
donut has no middle to click. The fitted rim and a crosshair at the fitted centre
are drawn back over the figure, so you can see whether the fit landed before you
record anything.

Then two numbers, both prefilled with the answer for an ordinary pie:

- **Total** (`100`) — what the whole circle is worth. Leave it and the slices read
  as percentages; type the figure's own total (the number printed in a donut's
  hole, say) and they read in its units. The unit is yours; the whole circle is
  always all of it.
- **Sweep** (`360`) — how much of a turn the chart actually draws. A half-pie or a
  gauge is a smaller sweep, and getting it wrong silently halves every value, so it
  is measured rather than assumed.

Tick **Tilted / 3D pie** for a chart drawn in perspective. The top face of a 3D pie
is a complete ellipse — the extrusion hides none of it — so it is fully recoverable,
and it matters: read flat, a tilted 7% slice can read 13%, *and the slices still sum
to 100*, so nothing looks wrong.

Capture one click per boundary. Slices share their edges, so the click that closes
one sector opens the next — a ten-slice pie is ten clicks, not twenty, and no line
gets measured twice. Clicks near the rim are tidied onto it; this never changes a
reading, because a slice's value comes from the *angle*, and moving a point straight
out along its own radius does not change its angle. That is also why a **donut**
needs no special handling: click any ring you like, at any radius, and one
calibration reads them all.

When you come back round, the first boundary offers **"click to close the ring"** —
click it and the last sector completes without opening another. Nothing closes the
ring for you, because only the figure knows whether it should: a half-pie does not.

**Exploded slices** — a wedge pulled out of the pie — use the **Exploded slice**
button in the bottom-right of the canvas. It folds out three steps: click the
slice's own **tip**, then its two edges. The reading is then taken about *that* tip
rather than the pie's centre, which is the whole of what explosion needs, since
sliding a wedge sideways does not turn it. This matters more than it looks:
measured against the shared centre instead, a 27% slice reads about 23% — and the
figure still adds up to 100, so the error is invisible. The button arms **one**
slice; the next sector goes back to the pie's centre.

## 3. Capture the figure

Press **Capture figure** on the calibration card. This freezes the framed figure
as the working image of record — what you see is what you captured — so the data
always traces back to a stable source. (With a PDF, the captured figure and its
page are remembered in the project.)

## 4. Trace the curve

Several ways, depending on the figure — all on the left rail:

- **Add points** (`3`) — click along the curve. A zoom loupe follows the cursor
  for precision. This is the reliable default and works on anything.
- **Auto-extract** (`4`) — the wand tool, three mechanisms:
  - **Flood-fill** — click one point on a solid curve; it traces the connected line.
  - **By colour** — pick the series' colour (type a hex value, or take it from the
    figure with the pipette); it extracts every matching pixel in one pass (good for
    dashed or marker curves). A live preview highlights exactly which pixels it will
    take; **Restrict to a box** limits it to a region so a same-coloured legend is
    ignored. The series then **takes that colour**, so its markers sit on the curve
    they came from rather than in whatever colour the series happened to be given.
  - **Guide points** — for monochrome, dashed, or overlapping curves that colour
    can't separate: click a few guide points along one line and a spline fills the
    rest. The guide points are your record; the fill is marked as derived.
- For **scatter**, set Auto-extract ▸ By colour's shape to **Scattered points** —
  one point per marker instead of one per pixel column.

Every automatic method shows you what it captured *before* you commit, so you can
trust the result.

**Bar-family figures are traced by hand.** Auto-extract is greyed out for Bar,
Histogram, Box plot, and Line (categorical X): its mechanisms all follow the
*middle* of a shape, which is a curve's position but only half of a bar. Place
points on the bar ends with **Add points** (`3`) instead — the loupe gives you
the pixel precision.

**Spider charts trace along their own axes.** Auto-extract ▸ **By colour** is the
only mechanism offered there, and it does a different job: it walks each calibrated
ray outward and records the value where the series' colour crosses it — one reading
per axis, filed into that axis's own row. Where a ray crosses the colour more than
once (a grid ring in a similar ink, a second series, a filled polygon's far edge) it
records **nothing** on that axis and names it in the message, because the crossing it
should read is exactly what is in doubt. The same applies where the colour runs past
the end of an axis: there is no measured crossing, only the point where the search
stopped, so nothing is recorded and the message says which axis and what to check
(usually a known point calibrated on an inner ring). Those axes stay empty and the
capture cursor lands on them, so what the trace refused is what you are asked for
next. A reading you placed by hand is never overwritten.

## 5. Correct

- **Select** (`5`) — click a point to select it, or drag a box to select a range.
  `Del` removes the selection; the arrow keys nudge selected points (Shift = coarse);
  `Esc` clears. It never selects calibration handles.
- Drag any point to reposition it; drag a calibration handle to re-calibrate live.
- Edit a value directly in the right-panel table — **XY** and **Spider / Radar**.
  Typing a number moves the point to match it: on a spider it slides along that
  axis's own ray, so the marker and the number can never disagree.
- **Erase one reading** with the eraser (rail) or right-click ▸ Delete point. On a
  spider that removes exactly that axis's reading and leaves the rest of the
  profile standing — the other five axes are separate measurements, not parts of
  one shape.
- On a **Bar** or **Line (categorical X)** figure, the table has a **Category**
  column: type each point's name from the figure's tick labels (Flax, Hemp, …) and
  the exports carry it in a **Category** column instead of a placeholder. On a
  grouped chart you only type
  the set once — a point added to the next series takes the name of the **nearest
  already-named bar**, so it lands on the right category however you click and
  whatever you skip. Each name belongs to its own point, so any cell can be
  retyped without shifting its neighbours. Where the app can't tell which category
  you meant, it leaves the cell **blank** rather than guess a name.
- On a **Spider / Radar** figure the table is one row per axis and one column per
  series, and every cell is live:
  - **click a value** to type it, or **click a point's cell** to select that point
    on the canvas — including a point in another series, which the canvas
    deliberately keeps inert so a click can never land on the wrong series;
  - **click an empty cell** (`—`) to aim the next capture at that axis. The cell is
    highlighted and the status line names it, so with two gaps you can fill either,
    in any order — useful after erasing a reading, or where the colour trace
    refused an axis;
  - **click an axis name** to type it as the figure prints it. The name is optional
    — an axis whose label is illegible is still a real axis, and an unnamed one
    reads as `—` and exports positionally as `Axis 3`.
- **Grid Removal** (top bar) pipettes a colour and wipes every pixel within a
  tolerance of it — useful when gridlines run through the curve you are tracing.
  It knows nothing about charts, only about colour, which is why it also strips a
  **spider chart's web** while leaving the spokes you aim along: the bundled radar
  example draws its rings a lighter grey than its rays. That separation belongs to
  the *figure*, not to the tool — plenty of radar charts draw both in one grey, and
  there the rays go too. Check the rays survived before you trace, and undo if not.
- **Undo/redo** (`Ctrl+Z` / `Ctrl+Shift+Z`) covers everything, including image edits.

## 6. Multiple series and figures

- **+ Add** (right panel) starts another series on the same calibration — each
  named and colour-coded, captured side by side.
- **Extract another graph** re-enters a multi-page source (e.g. a paper's PDF) as
  a fresh figure. Flip between figures with the ◀ ▶ arrows by the calibration card;
  each keeps its own image, calibration, series, and graph type.

## 7. Measure (optional)

The **ruler** tool (`7`) opens a Measure card: **distance, angle, area, slope** —
in the chart's own units, or a scale you set from any known length on the image.
Measurements are a separate collection from your series data.

## 8. Analyse (optional)

Open **Curve fit** from the tool rail to fit a model through a traced series.

| Model | Form |
| --- | --- |
| Polynomial | `y = a₀ + a₁x + a₂x² + …` (choose the degree) |
| Exponential | `y = a·e^(b·x)` |
| Power | `y = a·x^b` |
| Logarithmic | `y = a + b·ln(x)` |
| Gaussian | `y = a·e^(−(x−b)²/2c²)` |
| Logistic | `y = a / (1 + e^(−b(x−c)))` |

The card reports the equation, its coefficients, R² and RMS, and draws the fitted
curve over the figure. **Degree** applies to the polynomial alone and disappears
for the others.

Some models cannot take some data — a logarithmic fit needs every x and y above
zero — and PlotTracer says which requirement is unmet rather than returning a
number it cannot stand behind. Use **Restrict** to fit over a chosen x range.

**A fit that did not settle says so.** The nonlinear models are solved
iteratively, and a solver that runs out of iterations still returns *something*.
When that happens the card says the curve is where the solver stopped rather than
a result, and the exported `Curve fit` block carries `settled = no` in its own
column, so the caveat survives the hand-off to whoever opens the file. A
polynomial is solved directly and has nothing to converge, so it reads `n/a`.

The fit is always a **separate block** from the record — the traced points are
never overwritten by the model drawn through them.

## 9. Export

**Export** (top bar) → **CSV, TSV, JSON, OpenDocument (ODS), Excel (XLSX), LaTeX,
MATLAB, Python, R**,
or a **PNG** of the annotated figure. Any text format can also be copied straight
to the clipboard. Choose **Active** (the current series) or **All series**. Values
are rounded to the figure's real resolution — never padded with false precision,
never collapsed to zero — with a full-precision option when you want every digit.
Fitted curves, geometry and measurements export as their own blocks, kept separate
from the recorded points.

**The format menu says what each format will not carry, before you pick one.** No
data format carries the figure image, the axis calibration or the source document
— save a project to keep those — and individual formats name their own limits
(MATLAB becomes a cell array once any cell holds text; the flat text formats put
every block in one stream).

**Guide-point traces carry a `role` column.** If a series was traced with **Guide
points**, its export gains a `role` telling you where each number came from:
`anchor` for a point you placed by eye, `interpolated` for one the spline filled in
between your anchors, and **blank** for an ordinary point you clicked yourself with
Add points. Keep only the anchors if you want strictly what a human put on
the figure. The column appears only for series that were traced this way — an
ordinary trace exports exactly as before.

**Save Project** writes a `.zip` containing everything — image(s), calibration,
series, measurements, and the original source PDF — so the whole extraction reopens
exactly, and any number traces back to its figure.

**Open Project** also reads projects written by other digitizers — currently
WebPlotDigitizer `.tar` archives, Engauge Digitizer `.dig` files, and StarryDigitizer
`.zip` projects. There is no separate command for any of them: the format is
recognised from the file's own bytes, never its name, so you open a project the same
way whatever wrote it, and a file no filter recognises is refused with the list of
the ones that do work.

This is a **one-way** road. PlotTracer reads those formats but does not write them —
a third of what it records (spider spokes and their per-axis scales, point roles,
box-plot tuples, measurement blocks) has nowhere to go in any of them, so offering
an export back would promise a round trip it could not honour.

---

*PlotTracer is free and open source (AGPL-3.0), fully offline — your figures never
leave your machine.*
