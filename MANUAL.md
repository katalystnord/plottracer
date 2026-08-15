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
trackpad); pan with the middle mouse button or `Space`+drag;
fit the view with `Ctrl+0`.

## 2. Choose the graph type and calibrate

Pick the graph type from the **card picker** in the top bar — each type shows its
own icon, so a bar chart and a histogram are told apart by their shape rather than
by reading two similar names. The types are **XY** (linear/log/date),
**Bar**, **Polar**, **Spider / Radar**, **Pie / Donut**, **Heatmap**, **Ternary**,
**Map**, **Circular chart recorder**, **Histogram**, **Box plot**, or **Line**
(categorical X)**.

Error bars are not a graph type — they are **rail tool 6**, captured on top of
whichever series they belong to.

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

**Bars are captured as a drag-box.** With **Add points** (`3`) on a Bar chart you
press at one corner of a bar and release at the opposite one: a bar's value is its
*extent*, not a point on it, so those two corners **are** the measurement. Plain,
grouped, stacked and floating bars all work this way, and a bar below the baseline
reads negative. A plain click places one corner and leaves the bar half-captured —
its row shows a dash until you place the other.

**Auto-extract ▸ By colour also works on Bar and Histogram**, for the same reason:
a bar blob's own *bounding box* is its two ends, so nothing is averaged or
centroided away. It is still greyed out for **Box plot**, **Line** and **Pie / Donut** (categorical
X)** — a box's five letter-values and a categorical point are not a bounding box —
so those two are placed by hand with the loupe.

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
- On a **Bar** figure the table is **one row per category and one column per
  series** — the same shape as the spider table below — so a grouped chart shows
  every series' bars side by side instead of hiding all but the active one. Type
  each category's name from the figure's tick labels (Flax, Hemp, …) once, in its
  row, and every series bound to it shows the new name immediately; the exports
  carry it in a **Category** column. A category with no bar in some series shows a
  dash in that cell.
- Names are **never invented.** An unnamed bar reads as a dash, not as "Bar 1" —
  a placeholder in the Category column of an export is indistinguishable from a
  name someone transcribed. On a grouped chart you only type the set once: a bar
  added to the next series takes the name of the **nearest already-named bar**
  along the category axis, so it lands on the right category however you click and
  whatever you skip. Where the app can't tell which category you meant, it leaves
  the cell **blank** rather than guess.
- **Mark category ticks (optional, v2.1).** Once a Bar or Box Plot figure is
  calibrated, the calibration card offers **Mark category ticks?**. Open it, click
  where the categories end (**P1** — the amber calibration handle — is already the
  start), and say how many there are. Tick marks appear along the category axis;
  drag any of them if the figure isn't evenly spaced. Choose whether the figure
  prints its ticks **under each category** or **between them** — flip the setting
  and watch the marks move to see which matches.
  If P1 isn't where the categories start — you calibrated on a gridline part-way
  up the value axis, say — press **Re-place axis** and click *both* ends yourself.
  **Done** closes the panel and keeps everything; **Remove ticks** drops the marks
  and the empty categories they created, keeping any you named or captured a bar
  for.
  It is entirely optional. A single-series chart is one bar per category and needs
  none of it. Where it earns its place is a chart with **more than one series**, or
  one where **a series is missing a bar** — with the categories declared, every bar
  is filed by the band it sits in rather than by guessing from position, the table
  shows a row for every category before you capture anything, and a run of touching
  same-coloured bars can be split at the boundaries you marked.
  If two bars of one series land in the same category — a miscounted figure, or a
  bar sitting outside the axis you marked — the table says so underneath rather
  than quietly showing one of them.
- **⚠ Where the guess can go wrong, if you don't mark the ticks.** The
  nearest-already-named-bar rule above copes with a *later* series skipping a
  category. It cannot cope when the **first series you capture** is the one missing
  a bar: that category never comes into existence, so a later series' bar there
  takes its nearest neighbour's name instead. The wrong name looks exactly like one
  you typed.
  It depends on the direction you capture in — left-to-right is the one that can
  mislead — and it only affects **names**, never measured values. To avoid it,
  either mark the category ticks, or capture your most complete series first. To
  spot it, check the Category column against the figure: a bar under one label
  carrying a different one is the symptom, usually with a blank cell nearby.
- On a **Line** (categorical X) figure the same Category column exists, but the
  names belong to individual *points* rather than to shared rows, since each point
  is its own reading.
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

## 7. Error bars (optional)

Error bars are **not a graph type** — they are rail tool `6`, captured on top of
whichever series they belong to.

**Set up.** Open the tool and fill two fields:

- **Error for** — the series the bars belong to. It needs at least one point
  already; an error bar hangs off a data point.
- **Name** — what this uncertainty is called on the figure: `SD`, `95% CI`,
  `SEM`. The card shows what it becomes — two new series, **SD upper** and
  **SD lower**. That name is the only meaning PlotTracer records; it never
  decides what your bars represent.

**Capture.** Drag from a data point out to its cap.

- The **start** of the drag snaps onto a point you already placed, so the bar is
  anchored to a real reading rather than to wherever you pressed.
- The **cap** end is never snapped. That end *is* the measurement.
- Drag up or down and the pair records as `upper` / `lower`; drag left or right
  and it records as `left` / `right`, for horizontal uncertainty.

**⚑ The second cap starts as a mirror, and a mirror is not a measurement.** One
drag places a cap on both sides: the one you dragged, and its reflection through
the datum as a *starting position*. On a symmetric figure that is already right.
On an asymmetric one it is reporting a symmetry the figure never drew, and you
have to move it.

**To move a cap where the figure actually draws it:** pick its series under
**Recorded** in the card, then drag that cap. A cap slides only **along its own
bar** — the sideways part of the drag is discarded — so adjusting one can never
tilt the whisker off its datum, however you drag.

Two bundled examples make the difference visible. *Error bars — tensile strength
± SD* is symmetric, so every mirrored cap happens to land correctly. *Error bars
— asymmetric 95% CI* is lopsided at every point, which is the case a mirror
cannot do for you.

**More than one kind on the same point.** Capture a second bar under a different
name and both are kept. An `SD` bar and a `95% CI` bar on the same datum are
separate pairs; deleting one leaves the other standing.

**Deleting.** Deleting a cap removes the whole bar it belongs to — that cap and
its opposite number — and leaves the data point. Deleting the data point takes
its error bars with it.

**Export.** The caps leave as their own series, under the names you gave them,
carrying **both** the **absolute positions** and the **± delta** from each cap to
its data point. The positions are what was measured off the figure, so they are
the record; the delta is what a plotting library asks for — matplotlib's `yerr`
and Excel want deltas, ggplot's `ymin`/`ymax` want the absolutes — so neither
reader has to do arithmetic on the record. A row with no cap leaves the delta
blank rather than reporting an error of zero.

## 8. Measure (optional)

The **ruler** tool (`7`) opens a Measure card: **distance, angle, area, slope** —
in the chart's own units, or a scale you set from any known length on the image.
Measurements are a separate collection from your series data.

## 9. Analyse (optional)

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

Some models cannot take some data — a logarithmic fit needs every x above
zero, a power law the same, an exponential every y above zero — and PlotTracer says which requirement is unmet rather than returning a
number it cannot stand behind. Use **Restrict** to fit over a chosen x range.

A high-degree polynomial over very large x values is refused for the same
reason. Fitting raises x to twice the degree, so a degree-9 fit over values
around 10¹⁷ overflows before any arithmetic is done, and no coefficients exist
to report. PlotTracer names the degree and the magnitude and suggests the two
things you can change — a lower degree, or x values shifted closer to zero —
rather than drawing a flat line through zero and calling it a fit. Ordinary
figure ranges and date axes are nowhere near this.

**A fit that did not settle says so.** The nonlinear models are solved
iteratively, and a solver that runs out of iterations still returns *something*.
When that happens the card says the curve is where the solver stopped rather than
a result, and the exported `Curve fit` block carries `settled = no` in its own
column, so the caveat survives the hand-off to whoever opens the file. A
polynomial is solved directly and has nothing to converge, so it reads `n/a`.

The fit is always a **separate block** from the record — the traced points are
never overwritten by the model drawn through them.

## 10. Heatmaps

A heatmap is a **matrix**, not a set of points, so nothing on it is clicked as a
data point. You calibrate the two axes and the colour key, put a **grid** over
the cells, and PlotTracer reads every cell through the key.

### Is each axis a category or a value?

Ask it per axis — a heatmap can be category × category (a correlation or
confusion matrix, genes × samples), category × value (named treatments against
time), or value × value (a continuous field). Tick **X is categories** and/or
**Y is categories** on the Calibration card *before* you start clicking, because
it changes what you are asked for.

- **A value axis** asks for two points of known value, as any XY chart does.
- **A category axis** asks for the two outer **edges** — where the first
  category starts and the last one ends — and then for **how many categories
  there are**. You never type a coordinate, because the figure never printed
  one. The count is something you read off the figure by counting; the
  positions it implies (0, 1, 2 …) are ordinals, and the export says so.

### The colour key

Four more clicks. Two say **where the coloured strip is** — click where it
begins and where it ends, *along its length*. Two more say **what it is worth**:
click a **printed tick** on the key and type the number printed there, then a
second one. You do not have to hit the coloured band for those two — clicking
the tick mark or its label below the bar works, because only the position along
the key is read.

Those are two separate measurements on purpose. "The key's ends are the minimum
and maximum" is a guess, and on a real figure it is wrong by a measurable amount:
the ramp starts where the ink starts, while the printed numbers sit wherever the
figure's tick machinery put them.

Tick **Log colour scale** if the key is logarithmic — reading a log key as
linear is wrong by a factor, not by a rounding.

### The grid

The grid is a set of **boundaries per axis**, and every one of them is
adjustable — published heatmaps have rows of unequal height and columns of
unequal width.

- **Detect grid** finds the boundaries in the figure's own ink (drawn rules, or
  the colour discontinuities of a continuous field) and *proposes* them. Enter
  **Columns** / **Rows** first if you know the counts and detection will check
  itself against them — and if it finds fewer boundaries than it needs it
  **says so and places nothing**, rather than filling in a plausible grid whose
  cells are silently twice as wide as the figure's.
- On a **category axis** the count you declared has already placed the
  boundaries, so there is usually nothing to detect.
- **Drag any handle** beside the figure to move a boundary; a boundary will not
  cross its neighbour. **+ Column boundary** / **+ Row boundary** adds one in
  the middle of the widest cell — which is where a missed one usually belongs —
  and clicking a handle offers to **Remove** that boundary.

### Names

If the figure prints names rather than numbers, type them into **Column names**
and **Row names**, comma separated, in reading order — the first name is the
figure's top-left cell. Put a name containing a comma in "quotes". The card
tells you how many of each axis are named; naming only some is fine, and the
unnamed cells keep their measured coordinates.

### Reading the cells

**Read cells** is the end of the Grid card's job: it reads every cell through the
colour key, fills the Cells panel and **closes the card behind it**. The folded
line still reads *Grid — 7 × 5 cells*, so one click reopens it if you want to
move a boundary or type names in bulk. (You never have to reopen it just to name
a column — click the column's header in the matrix.)

In a heatmap the colour *is* the value, so a
wrong cell has no other symptom — no gap in a trace, no misplaced point — and
every cell therefore reports its own evidence beside its number:

| | |
|---|---|
| **range** | the values this colour cannot be told apart from |
| colour offset | how far the cell's colour sat off the key's ramp |
| *n*% of the cell | how much of the cell was actually the colour that was read |
| at the key's limit | the colour is the key's extreme, so the figure may have **clipped** the value |

The Cells panel says how many need a look, above the matrix. **A clipped cell is
exact, uniform and wrong** — the figure stopped containing the number — and
nothing but that warning can tell you.

Click a cell to pick it. The line above the matrix then names all three of its
coordinates — its column, its row, and its value — and the figure highlights the
square it was read from.

### Correcting a cell

**You are not the only instrument looking at the figure, and neither are we.** A
hatched cell, an asterisk printed over the fill, a label bleeding into the
colour, a texture the sampler averages away — your eye reads all of those better
than a colour sampler does, and sometimes it is the only thing that can.

So **pick the cell and type the number you can see** — into the value on the line
above the matrix, or into the value column of the Table view. (In the matrix
itself a cell *is* its value, so clicking one picks it rather than opening an
editor.) The cell
moves *along the colour key*: what is recorded is a position on that third axis,
exactly as a data point's position is recorded on the X and Y axes. Recalibrate
the key afterwards and your cell moves with it, together with every other cell in
the matrix — it can never drift into quietly disagreeing with its neighbours.

Every value therefore says which instrument read it, in the table and in the
file:

| | |
|---|---|
| **tinted with the figure's own colour** | read from the colour key |
| **`[59]`**, in square brackets, no tint | read by you |

The tint makes the matrix a miniature of the figure — a shadowed column shows as
a darker band beside numbers that look perfectly reasonable — and a corrected
cell reads as a hole in that pattern. The brackets are the convention from
scholarly editing, where `[x]` means *editorially supplied*; they are also the
half that survives a copy-paste into a spreadsheet, where the colour does not.

**Right-click a cell** to switch it back to **Use number from key**, or to edit
your own value again. A value you typed is a measurement, not an override: the
export names its source in a `value source` column rather than hiding the
difference, because a number read from a colour ramp and one read by eye go wrong
in opposite ways.

*A cell you read yourself carries no `range`, no colour offset and no clipping
flag — those describe inverting a colour, and none of them is true of a reading
taken by eye. How much of the cell was one flat colour is still reported: that is
a fact about the ink, and usually the reason you looked twice.*

### What PlotTracer will not do here

- **A key drawn as a handful of discrete bands** (significance levels, cluster
  IDs, land cover) is **refused, and says why**. A colour on such a key
  identifies a band — a range — and not a value; the number that could be
  reported is the middle of that range, which is not in the figure.
- **Monochrome keys work**, and cost precision rather than accuracy: greys sit
  closer together than a colour ramp's steps, so the reported range is wider.
  Note that on a grey key a black or white **cell border** is itself a colour on
  the ramp, so a border caught in a cell will not show up as a colour offset —
  the *% of the cell* figure is what catches it.
- **A regular hatch or stipple over the cells is a known limitation.** A pattern
  covering up to about a third of a cell is read correctly and flagged, but a
  dense regular pattern can line up with the sampling grid and be read as if it
  were the cell's own colour. If your figure is hatched, check the flagged cells
  against the key by eye and type in what you read — see *Correcting a cell*
  above.

### Export

Cells export in two shapes, both written: **one row per cell** — `x min`,
`x max`, `y min`, `y max`, `x centre`, `y centre`, `value`, `value source` plus
the evidence columns — and the **matrix** view for readers that want a 2-D array with
coordinate vectors. Both are written because real consumers need each: some
plotting libraries require *n+1* edges and refuse centres, others take centres.
Where an axis is categorical the header says `(category index)` and the names
travel in their own column.

---

## 11. Export

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
