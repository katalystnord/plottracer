# What R and Python need, per graph type — and what that says about our models

**Tenet 11(a), run systematically.** David, 2026-08-17: *"Check, for all types of
graphs that we are currently supporting and intending to support, how and in what
format R and Python would need the data to be presented like. And that should
then map out to the specific models needed."*

**Everything below marked ✅ was MEASURED by running the generator**, not recalled
from documentation — matplotlib 3.10.7, ggplot2 4.0.2, base R 4.x, on this
machine. Claims that could not be run are marked ⚠️ INFERRED and say why.

The standing check this feeds: *does our record supply exactly what a generator
requires? If not, the model or the thinking is wrong* — however healthy the
exports look.

---

## The three findings that change how we build

### 1. ✅ The two ecosystems disagree about what an error bar IS

| | wants | shape |
|---|---|---|
| **Python** `errorbar(x, y, yerr=…)` | **DELTAS** | `(N,)` symmetric, `(2,N)` = `[lower, upper]` asymmetric |
| **R** `geom_errorbar(aes(ymin, ymax))` | **ABSOLUTES** | one column each |
| **base R** `arrows(x0, y0, x1, y1)` | **ABSOLUTES** | endpoints |

Measured: `yerr=[1,2,3]` on `y=[10,20,30]` draws its first bar from **9 to 11**,
so `yerr` is an offset. Negative deltas are **refused** outright (*"'yerr' must
not contain negative values"*), so a delta is an unsigned magnitude and the
direction comes from which row it sits in.

⇒ **Neither form can be the record on its own.** We already carry both, decided
2026-08-03 on exactly this reasoning; this is that decision re-derived from the
consumers rather than from argument.

### 2. ✅ ONE-SIDED ERROR: R can express it, Python cannot

David has made one-sided a first-class requirement. Measured:

| | `ymin` absent | result |
|---|---|---|
| ggplot2 | `NA` everywhere | ✅ **renders** |
| ggplot2 | `NA` on one row | ✅ **renders the rest** |
| matplotlib | `NaN` in `yerr` | ❌ **crashes** (`IndexError`) |
| matplotlib | `0` in `yerr` | ⚠️ **accepted, and WRONG** — draws a bound sitting exactly on the value |

⚠️⚠️ **This is the whole argument for absolutes being the record.** In the delta
form, "no lower bound" and "a lower bound of zero size" are the same number.
A record that stored deltas would make a measurement we never took
indistinguishable from one we did — tenet 9's exact failure, and it would be
invisible because `0` renders as a plausible little cap.

⇒ **The record holds absolutes, with genuinely absent members.** Deltas are a
convenience projection, and the projection must emit *nothing* (not `0`) where a
side is absent, even though that costs the matplotlib consumer a decision.
David's *"anything we present to the user should be out of convenience, not
absolutes"*, one level down: the delta column is a convenience over the record.

### 3. ✅ An error bar and a confidence band are ONE data shape

    geom_errorbar   required aes:  x|y, ymin|xmin, ymax|xmax
    geom_linerange  required aes:  x|y, ymin|xmin, ymax|xmax
    geom_ribbon     required aes:  x|y, ymin|xmin, ymax|xmax
    IDENTICAL: TRUE

The same data frame renders as discrete error bars or as a continuous band —
**discrete vs continuous is the GEOM, not the data.** matplotlib agrees from the
other side: `fill_between(x, y1, y2)` takes absolutes on the boundary's own x.

⚑ **This corrects a claim made earlier in the B4 work.** I had written that an
independently-traced uncertainty boundary would be *a different kind of record*.
To a generator it is the **same** record — same columns, same vocabulary. What
differs is only whether the coordinates coincide with the carrier's own samples.

⇒ The unified shape is **a set of `(coordinate, lower, upper)` rows bound to a
carrier**. Our per-datum tuple is the case where those coordinates ARE the
datums. A band is the case where there are more of them. Nothing new to invent —
which is what David meant by *"errors are just points."*

⚑ Note `x|y` and `ymin|xmin`: ggplot's own model is **per direction**, which is
our four roles (`upper`/`lower` on y, `left`/`right` on x) under other names.

---

## Per type: what a generator demands, and whether we supply it

| our type | Python | R | our record | verdict |
|---|---|---|---|---|
| **XY / scatter** | `plot(x,y)` / `scatter(x,y)` | `geom_point(aes(x,y))` | point pairs | ✅ matches |
| **XY + error** | `errorbar(yerr=deltas)` | `geom_errorbar(ymin,ymax)` | absolutes + deltas | ✅ both forms carried |
| **Histogram** | ✅ `stairs(values[n], edges[n+1])` — refuses `edges[n]` | `geom_col` / `geom_rect` | `['Bin start','Bin end']` | ✅ true edges, exactly what is demanded |
| **Bar** | ✅ `bar(x, height, width, bottom)` | ✅ `geom_col(aes(x,y))` | two corner pixels ⇒ extent + height | ✅ supplies x-extent AND height |
| **Box plot** | ✅ `bxp([{med,q1,q3,whislo,whishi}])` — **KeyError** if any is missing | ✅ `geom_boxplot(stat='identity', aes(lower,middle,upper,ymin,ymax))` | `['Min','Q1','Median','Q3','Max']` | ✅ five named statistics, one-to-one |
| **Heatmap** | ✅ `pcolormesh(X,Y,C,shading='flat')` — **refuses centres**, needs n+1 | ✅ `geom_rect(xmin,xmax,ymin,ymax)`; `geom_tile` takes centres+size | per-cell bounds | ✅ bounds, as established |
| **Pie** | ✅ `pie(x)` — **normalises any sum > 1** | `geom_col + coord_polar` | raw values, closure never forced | ✅ and see below |
| **Spider / radar** | ⚠️ no native geom; polar line over evenly-spaced θ | ⚠️ no native geom | axis NAME + value per spoke | ✅ θ is presentation, as ruled in v1.4 |
| **Polar** | `plot(θ, r)` on a polar axes | `coord_polar` | (θ, r) | ✅ matches |
| **Ternary** | ⚠️ no matplotlib geom; plotly `Scatterternary(a,b,c)` wants **all three** | ⚠️ `ggtern` wants all three | all three components stored | ✅ closure error preserved |
| **Map** | ⚠️ needs a geo stack | ⚠️ likewise | lon/lat | ✅ matches |
| **CCR / circular** | ⚠️ polar family | ⚠️ polar family | (θ, r) | ✅ matches |
| **Line (categorical)** | `bar`/`geom_col` — category is a coordinate | `geom_col(aes(x=factor,y))` | ⚠️ **category DERIVED from click order** | 🔴 **FAILS** — the known v2.3 defect |
| *intended:* **Contour** | ✅ `contour(X,Y,Z,levels)` | `geom_contour(aes(z))` | — | grid, or curves each carrying a level |
| *intended:* **Bubble** | ✅ `scatter(x,y,s)` — `s=[100,400,900]` ⇒ radii 10/20/30 pt, so s is an AREA | `geom_point(aes(size))` | — | size is measured ink: a third coordinate, not a category |
| *intended:* **Band** | ✅ `fill_between(x,y1,y2)` | ✅ `geom_ribbon(ymin,ymax)` | — | same shape as error bars (finding 3) |
| *intended:* **Mosaic** | ⚠️ no native geom | ⚠️ `ggmosaic` | — | per-cell bounds + a second value |

### ✅ Pie, measured — why closure must never be forced

    values summing to 100  ->  wedges 144.0 + 126.0 + 90.0  = 360°
    values summing to  97  ->  wedges 148.5 + 129.9 + 81.6  = 360°

matplotlib **silently normalises** any pie whose values sum above 1. A real
reading of 97% is inflated to a full circle and the 3% the figure failed to
account for disappears into the wedges. Because we keep the raw values, a
consumer that cares can still see the closure error; one that does not gets
matplotlib's behaviour anyway. Forcing closure in the record would destroy
information no consumer can recover.

### 🔴 The one type that fails its own generator

**Line (categorical)** stores a value and *derives* its category from
left-to-right capture order. `geom_col` needs the category as a coordinate, so a
library handed our record cannot place the points — and capturing out of order
silently assigns the wrong category. Already graded a correctness fix and
scheduled for v2.3; this sweep is independent confirmation from the consumer
side.

### ⚑ Box plot: why it resists the error model

`bxp` raises **KeyError** without any of `med`, `q1`, `q3`, `whislo`, `whishi`;
ggplot needs `lower, middle, upper, ymin, ymax`; base R's `$stats` is a five-row
matrix. All three demand **five named statistics** — and note ggplot reuses
`ymin`/`ymax` for the *whiskers* while `lower`/`upper` mean the *box*.

A box is not uncertainty *about* a value; it is a five-number summary of a
distribution, in which the median is a reading in its own right. Error says
"this value, ± this much". These are different claims, which is why forcing them
into one model is awkward rather than merely fiddly. **Share the carrier idea;
do not share the roles.** Our `BOX_PLOT_SLOTS` already maps one-to-one onto what
all three generators demand.

---

## What this maps to, for the error model

1. **The record is absolutes**, with absent members genuinely absent — because
   the delta form cannot distinguish "no bound" from "a bound of size zero"
   (finding 2), and one-sided is a requirement.
2. **Deltas are a projection**, emitted alongside, never instead. Absent stays
   absent even though matplotlib then cannot draw that point.
3. **Error bars and bands are one vocabulary** — `(coordinate, lower, upper)`
   bound to a carrier — so a tool acting on error need not ask which it is
   (finding 3). That is the "coalesce around the data" property, and the
   generators already work this way.
4. **Roles are per direction**, matching ggplot's `x|y` / `ymin|xmin` split, so
   the four roles are the right taxonomy and not our invention.
5. **The carrier's own samples are not privileged.** A band's rows need not be
   the data's rows, so the primitive must carry the coordinate rather than
   assume it.

## Reproducing this

The probe scripts are throwaway by design — the findings are the deliverable, and
each is a single call anyone can re-run:

    python3 -c "import matplotlib; ..."   # errorbar / bxp / pcolormesh / stairs / pie
    Rscript   -e 'library(ggplot2); ...'  # required_aes of each geom

⚠️ Re-run them when a major version lands. `required_aes` is a public API and the
`|` alternatives above are version-specific.
