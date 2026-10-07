# What TODAY's tools already do - v2.6 curves (2026-10-07)

David: *"first test ALL of these ideas of yours and find out what already works
today. And the ones that do not work may well turn out to be things we should
not do any way."*

Every idea raised while designing v2.6 got one synthetic figure with exact pixel
truth. Each figure was then run through today's three curve tools, untouched
since v2.5.1:

- **By colour**: `engine/colorTraceRun.ts`, at the app's default tolerance of 60.
- **Flood-fill**: `engine/segmentFillRun.ts`, at the default threshold of 40,
  plus 80 and 120 in `FLOOD.md`.
- **Guide points**: `algorithms/interpolate.ts` `interpolateCurveOrdered`, the
  function the app itself uses (`calibrationSession.ts:3775`). The clicks are
  simulated: one every 40 or 80 px along the curve, only where the curve is at
  least 12 px from any other curve, with up to 0.8 px of hand error.

## What is in here

- `ladder/` - David's "start with the simplest case" ladder. Different colours:
  one crossing at angles from steep to shallow, thick lines, five curves,
  similar colours, JPEG, and two loops. Results: `ladder/rungs.result.md`.
- `ideas/` - one figure per idea:
  - same-ink curves: steep and shallow crossings, three curves through one point,
    curves that touch and part, a dashed curve, curves with markers, an inline
    label, a curve passing under a legend;
  - two bands;
  - two contour plots.

  Results: `ideas/TODAY.md`, with the Flood-fill threshold sweep in
  `ideas/FLOOD.md`.

All the numbers live in those generated tables. None are typed here.

## How to read the columns (`ideas/TODAY.md`)

| Column | What it means |
|---|---|
| **on target %** | Recorded points within 3 px of the curve being captured. |
| **on ANOTHER curve %** | Points that belong to a different curve. **Any non-zero value is a wrong reading.** |
| **target covered %** | How much of the true curve lies within 3 px of the recorded line, joined in record order. |
| **longest hole** | The longest stretch of the true curve the record misses, in px. |
| **worst stray** | The farthest any recorded point lies from the target, in px. |

## Caveats

- These are clean matplotlib renders. Real scans are worse.
- Colour picks use the exact line colour, which is the best case for the eyedropper.
- Simulated clicks are not David's hands.
- In the Flood-fill rows, the seed is snapped to the nearest pixel of the line colour.

## How to re-run

The harnesses are named `*.harness.ts` so that `npm test` does not pick them up
(a research test writes its own result files). To run one, copy it into
`engine/__tests__/`, then run:

```
BENCH_DIR=$PWD/research/v2.6-today/ideas npx vitest run engine/__tests__/today.harness.ts
```

Use `ladder/` and `ladder.harness.ts` for the ladder. `FLOOD.md` came from the
same harness, with the By colour and Guide points sections dropped and Flood-fill
run at 40/80/120.

Regenerate the figures with `python3 gen_all.py` (in `ideas/`) or
`python3 gen_rungs.py` (in `ladder/`).

## A correction to the simulated clicks

In the `s4_same_touch` Guide points rows of `TODAY.md`, the simulated user is
forbidden from clicking within 12 px of the other curve. That means it never
clicks at the touch itself, which is exactly where a real user would click.
`ideas/TOUCH.md` is the same figure with that rule lifted, keeping only the
Guide points rows. Read it instead of those TODAY.md rows.
