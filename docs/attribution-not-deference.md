# Attribution is law. Deference is not.

**Written 2026-09-11, at David's instruction, to be re-read.**

This document exists because one habit held this codebase back for months and
survived every instrument the project has. David had to push against it
repeatedly, over weeks, before it was named. It is written down so that the
naming does not have to happen again.

It is not an apology and it is not a principle to admire. It is a description of
a failure mode, the mechanism that kept it alive, and the three rules that
replace it.

---

## What was actually happening

The lineage was being treated as an **authority** rather than a **source**.

Those are different things, and the difference is the whole problem.

- A **source** is something you take from and then own.
- An **authority** is something you check yourself against.

Every time a defect turned up in inherited code, it got framed as a *fact about
the world to be preserved and explained*, rather than as *a bug in our software
to be fixed*. Ternary and polar both sat wrong for roughly a year for exactly
that reason. In both cases the refusal was already **written** in a comment that
could never fire.

Both fixes, when finally made, ended up **smaller** than what they replaced.
That is the tell. The deference was never buying anything.

---

## The mechanism that kept it alive

**Comments that end enquiry instead of comments that explain.**

"Faithful port." "NO LONGER BYTE-FAITHFUL." Those are not documentation. They
are a sign on a door reading *nothing to see here*.

CLAUDE.md's gate 3 already says a comment may not assert what no test enforces.
This was worse: it asserted that a **question was closed**. Every later reader,
including the author, checked the header, saw the deference, and stopped
looking.

That is why it took months to shift. Each individual instance looked like
modesty and correct attribution. In aggregate it was a structural hold on the
codebase.

---

## The half that prose-sweeping would never have found

Stripping the comments was **not** the fix.

The same deference was sitting in the **architecture**, where no amount of
comment-sweeping would have reached it: one format got a figure picker, and
every other format was read "straight through to one figure", quietly
discarding whatever else the project held. That had been true since v1.0.

Nobody wrote a comment privileging that vendor. The code simply **did**.

David's instruction to add StarryDigitizer project import was not a feature
request. It was a diagnostic, and it worked: the moment there were two of
something, the asymmetry had nowhere left to hide.

> ⚑⚑ **The general form:** if something is true for one format, one vendor, or
> one lineage and not for its siblings, **that asymmetry is the finding.**
> Look for it in the code shape, not only in the prose.

---

## The three rules

### 1. Attribution is law; deference is not.

AGPL attribution in the README and the in-app About dialog, and per-source
licence notes (`reference_upstream_repo_paths`: WPD AGPL-3.0, Engauge GPL-2.0
clean-room only, Starry MIT). That is the complete list of what is owed, and it
is genuinely owed.

Nothing else. **No file headers narrating our relationship to anyone.** Where
another tool's *file format* is described, that description belongs inside that
format's reader, exactly as Starry's and Engauge's do.

### 2. A finding in inherited code is ours to judge, on our terms.

If the maths is wrong, it gets fixed with our own model and a named test.
Ternary now reads the clicked triangle using all three corners. Polar now reads
its own clicked frame. Neither is a patch on someone else's decision; both are
our model, and both are smaller.

**But "wrong" is not the only reason inherited code stops fitting**, and
assuming it is would be the same mistake wearing different clothes. See
*Divergence is not a verdict*, below. That section is the one to read before
touching anything inherited.

### 3. Equality is a test, not an intention.

This is the load-bearing rule, because intention is exactly what failed.

Pinned in `engine/__tests__/importRegistry.test.ts`:

- *every format but OURS answers what figures are inside it*
- *ours is the ONLY one that declines, and for a stated reason*
- *lists EVERY figure, whichever tool wrote the project*

and in `ui/__tests__/electronMain.e2e.test.ts`, a second import test driving a
StarryDigitizer archive through the **identical** Open Project gesture as the
`.tar`, choosing the figure the writing tool did *not* have active.

Two formats, asserted identically, is the minimum that can demonstrate
equality. A single format cannot show that nothing is privileged.

---

## Divergence is not a verdict

**David, 2026-09-11, correcting the paragraph above.**

Something inherited may simply no longer work here. The model changed. The
assumptions are different. Things are just plainly different now.

> *"It does not need to mean either was wrong, nor that either was right. It
> can simply be evolution."*

There are three possible readings when inherited code stops fitting, and only
the third is usually true:

1. Their assumption was wrong.
2. Our change was wrong.
3. **Neither. The models diverged, and the old code is answering a question we
   no longer ask.**

The trap is that **all three of those readings use the same frame**: they take
the other tool as the reference point and ask which side of it we are on. That
frame is the defect. It is the deference described at the top of this document,
surviving as a *judgement procedure* after its prose has been swept out.

⚠️ **So the diagnostic question is not "does this still match theirs?" and not
"which of us got it right?"** Both of those keep them as the fixed point. The
question is:

> **Does this serve tenet 1 in OUR model?** Graph in, reliable data out. If
> yes, keep it. If no, change it. The answer never depends on where the code
> came from.

### And there is no upstream left to align to

WPD has effectively stopped open-source development. **We are the arm of that
lineage that is still moving.** There is nothing upstream to stay aligned with,
and there has not been for some time.

> *"WE are the upstream that we were trying to stay aligned to. We should be
> aligning to our vision / path. Nothing else."*

⚑⚑ This also settles the direction of any future compatibility question.
Interoperability continues, at the **file level only** (tenet 6), and it is a
service to *users* carrying their work across, not an obligation to a codebase.
It never reaches the model, and it is never a reason to hold a design still.

**Practical consequence:** a divergence report is not a finding. "This no longer
matches upstream" is not a defect, a risk, or a thing to flag. It is a
non-observation. The only reportable version is *"this does not serve tenet 1,
here is what I measured"*, and that one can be raised about any line in the
codebase, whoever wrote it.

---

## The honest caveat

The instinct is not guaranteed to be gone. It does not arrive as a decision to
defer; it arrives as a series of small, locally reasonable choices, each of
which looks like good manners.

So the check from here is **structural**, not attitudinal:

> When something is true for one format, one vendor, or one lineage and not for
> the others, that is the finding. It gets a failing test before it gets a
> paragraph.

---

## Related

- `CLAUDE.md` -> The Ten Tenets, especially **5** (no allegiance at the code
  level), **6** (interoperability at the file level only) and **8** (break with
  the source stack whenever a solution requires it).
- `CLAUDE.md` -> the four gates, especially **gate 3**, whose neighbour this is.
- Memory: `project_multiformat_import` (one Open Project, sniffing by content),
  `project_overnight_audit2_2026_09_10` (the inherited-WPD sweep),
  `project_copyright_authorship_stance`.
