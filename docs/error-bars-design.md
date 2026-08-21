# Error bars - the model

**14 source files cite this document, and until v2.3 it did not exist.** That
is the whole reason it does now: a citation pointing at nothing is worse than no
citation, because it reads as though the reasoning was written down somewhere.

⚑ **This page ADDS NOTHING.** Every claim below is already stated, in the file
that enforces it, and is named here beside the claim. That is deliberate:
CLAUDE.md's third gate says a comment may not assert what the design requires
unless something enforces it, and a design DOCUMENT has the same failure mode in
a larger form. So read this as an index, and the code as the authority.

---

## 1. The premise, agreed with David 2026-07-16

> **We only need to give the user the numbers, and he can decide the
> interpretation.**

Everything else follows from tenet 9. An error bar is a pair of readings taken
off the pixels; what those readings MEAN - standard deviation, standard error, a
95% interval - is printed in the figure's caption, not drawn in its geometry.

**So there is no `errorKind` field, and there never was one.** Asking the user to
type the kind means offering a default, and a default is LabPlot's +/-30 all over
again: a value that looks like a measurement and is not. The meaning lives in the
series' NAME, which the user writes.
→ `engine/errorRelation.ts` (header, "No `errorKind`").

## 2. The gesture: the drag IS the link

You press on a datum, drag out to where the figure draws the cap, and release.
Two caps are placed, one on each side; the one you dragged to is where you
released, and its opposite is mirrored across the datum.

**The mirrored cap is a starting position, not a claim.** It is an ordinary
reading - drag it, edit it, delete it. Nothing enforces that the pair stays
symmetric and nothing downstream assumes it did. So there is no symmetric mode,
no asymmetric mode and no modifier: *an asymmetric bar is just a bar whose cap
you moved.*
→ `algorithms/errorCapture.ts` (header).

**Capture works in PIXEL space**, which is what makes it available on every graph
type rather than only the ones with an invertible `dataToPixel`.
→ `algorithms/errorCapture.ts` (header, "This file works in pixel space").

## 3. Where a cap is STORED: the last four slots of its own series (B4, v2.3)

A cap is a member of the datum's own tuple, appended after the type's own slots:

    XY   ['Value', 'Upper', 'Lower', 'Left', 'Right']       roles at 1..4
    Bar  ['Bar start', 'Bar end', 'Upper', 'Lower', ... ]   roles at 2..5

**The offset is derivable from the slot list itself**, so nothing extra is stored
and nothing can disagree with the thing it describes. The test is the NAMES, not
the count - a five-slot box plot would otherwise read Q1/Median/Q3/Max as four
error roles, silently, with plausible magnitudes.
→ `algorithms/errorExtent.ts` (`errorSlotBase`, `hasErrorSlots`).

⚠️ **This supersedes the original "an error series is a separate series"
arrangement** for capture. The relation below still exists and is still read; see
§4.

## 4. The RELATION: an error series is an ordinary series plus a stored
relationship to another series

The relation is the error model's one piece of stored state, and it binds by
**name**, mirroring how a dataset already binds to its axes (`axesName`). An
index is not stable across the delete of an earlier series; a name is mutable,
which is what `retargetErrorRelations` / `clearErrorRelationsTo` exist to pay for.

**No format invention** - both halves already round-trip: the series is a
`Dataset` in `datasetColl`, and the relationship is a key in that dataset's own
metadata, which `core/plotData.ts` serializes generically. Upstream WPD
deep-clones metadata keys it does not recognise, so a WPD user can still open our
file.
→ `engine/errorRelation.ts`, `engine/seriesNames.ts`.

## 5. Which datum a cap belongs to is RESOLVED, not stored

The stored link is series-to-series; the cap-to-datum pairing is derived at read
time.

**So drawing the whisker is required, not decorative.** A cap that silently
attached to the neighbouring point looks exactly like one that attached
correctly, so rendering the resolution per point is what turns an invisible
mistake into a visible one - the same argument as the CCR arc preview.
→ `engine/errorBarGlyph.ts` (`computeWhisker`), `engine/__tests__/errorWhiskerResolution.test.ts`.

⚠️ **This is also the model's known soft spot**, and it is written down rather
than glossed: because the link is derived, no guard at the model's entrance can
enforce it. See the memory note `project_errorbar_workflow_rework`.

## 6. What reaches the FILE

Per measured role, under the user's own word for the error ('SD upper'):

- the **absolutes**, because that is what the record holds. In the delta form,
  "no bound" and "a bound of size zero" are the same number, and matplotlib
  accepts a `yerr` of 0 and draws a cap sitting on the value;
- the **deltas** beside them, because that is what `yerr` and Excel take
  directly. A subtraction, not an inference: both ends were measured.

**Presence is the signal.** A role that was never measured has no column and no
key - a vertical-error figure has nothing to say about left and right, and four
columns of blanks assert an emptiness nobody looked for.

**One function answers for the screen and for the file**, so a column cannot
exist on screen and be missing from the record.
→ `engine/calibrationSession.ts` (`getErrorColumns`, `getErrorRows`,
`getErrorDeltaRows`), `engine/exportAssembly.ts` (`errorColumnsFor`),
`engine/__tests__/errorReachesEveryFormat.test.ts`.

## 7. A cap is not a reading of its own

`getExportRows` filters through `getDatumPixelIndices`: a datum's caps are pixels
of its own series, and handing them out as data points meant two readings
exporting as four rows with nothing in the file saying which two were caps - a
curve fitted downstream would run through the error bars.
→ `engine/__tests__/spiderErrorRows.test.ts` (v2.3 re-audit, F20).
