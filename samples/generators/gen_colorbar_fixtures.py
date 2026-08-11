#!/usr/bin/env python3
"""
Seeded generators for the COLOUR BAR test fixtures (v2.2 heatmaps, phase 1).

⚑ WHY THESE EXIST RATHER THAN A SYNTHETIC RAMP DRAWN IN THE TEST. A test that
draws its own figure proves the code self-consistent and nothing else — that is
how the spider over-read hid for three releases (its synthetic radar chart had
no markers, so it showed a 1px bias where the real PNG showed 4.8px). A colour
key is exactly the wrong place to repeat that mistake: the whole risk in a
heatmap is that a colour shifted by RENDERING — anti-aliasing, an alpha-blended
cell edge, JPEG chroma quantisation — inverts to a silently wrong NUMBER. None
of those exist in a ramp a test writes byte by byte.

So each fixture is a REAL matplotlib render, and each ships the truth it was
drawn from: the value of every cell, the pixel where that cell sits, and the two
ends of the key in pixel coordinates. The test inverts the render and compares
against the values that produced it.

The four figures, and the question each one asks:

  heatmap-viridis.png ....... the ordinary case, cleanly encoded. How accurate
                              is an inversion when nothing has gone wrong?
                              UNEQUAL cells, because that is the case the record
                              was designed for.
  heatmap-jet.png ........... `jet`, still common in older papers. Its ends are
                              ill-conditioned: a large value change makes a small
                              colour change, so the reported band must WIDEN
                              there rather than stay confidently narrow.
  heatmap-jet-jpeg.png ...... the same figure round-tripped through JPEG at
                              quality 35 — the silent-wrong-number case. The
                              claim under test is not that the error is small; it
                              is that the error is REPORTED.
  key-cyclic.png ............ a cyclic key on its own (`twilight`). Both ends are
                              the same colour, so a cell of it has two equally
                              good positions and the module must say so instead
                              of picking one.
  key-cyclic-jpeg.png ....... the same, degraded: ambiguity and colour error
                              compounding, the worst combination a heatmap can
                              present.

⚠️ `bbox_inches='tight'` must NOT be used: it re-crops the canvas after the
transforms have been read, which silently invalidates every pixel coordinate in
the truth file. The figures are laid out at a fixed size instead.

Dev-only tool (not a runtime dep). Requires: numpy, matplotlib, pillow.
Run:  python3 samples/generators/gen_colorbar_fixtures.py
"""

import io
import json
import os

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "engine", "__tests__", "fixtures", "colorbars"))

DPI = 100
SEED = 20260811

# Deliberately unequal cell edges: the case the heatmap record was designed for,
# and the one a "rows x columns" count cannot express.
X_EDGES = [0.0, 1.0, 3.5, 4.0, 6.0, 9.0]
Y_EDGES = [0.0, 2.0, 2.5, 5.0, 8.0]
VMIN, VMAX = -40.0, 120.0
# Two ticks matplotlib actually draws and labels on this key — the pair a user
# would click to say "this position is −20, that one is 100".
TICK_VALUES = [-20.0, 100.0]


def display_to_image(fig, x_disp, y_disp):
    """Matplotlib display coords (origin bottom-left) -> image pixels (origin
    top-left), which is what an ImageData buffer indexes by."""
    _, height = fig.canvas.get_width_height()
    return {"x": round(float(x_disp), 2), "y": round(float(height - y_disp), 2)}


def make_heatmap(name, cmap, values):
    """One heatmap figure + a horizontal key, and the truth behind both."""
    fig, ax = plt.subplots(figsize=(6.4, 4.2), dpi=DPI)
    mesh = ax.pcolormesh(
        X_EDGES,
        Y_EDGES,
        values,
        cmap=cmap,
        vmin=VMIN,
        vmax=VMAX,
        shading="flat",
        edgecolors="none",
    )
    ax.set_xlabel("position (mm)")
    ax.set_ylabel("depth (mm)")
    cbar = fig.colorbar(mesh, ax=ax, orientation="horizontal", pad=0.18)
    cbar.set_label("temperature (°C)")
    fig.subplots_adjust(left=0.11, right=0.97, top=0.96, bottom=0.02)
    fig.canvas.draw()

    # The key's own extent, inset by 2px so the strip is inside the frame the
    # colorbar draws around itself — which is where a user would click too.
    box = cbar.ax.get_window_extent()
    y_mid = (box.y0 + box.y1) / 2
    # ⚑ THE STRIP IS INSET AND THE VALUE SCALE IS NOT DERIVED FROM IT. Position 0
    # of an inset strip is NOT vmin — it is vmin plus whatever those 2px are
    # worth, which on this key is 0.6 °C. Declaring it as vmin put a real bias
    # into the truth file and it showed up as the extraction "missing" its own
    # band. The app has the same problem and the same answer: calibrate from two
    # LABELLED TICKS, which is what the user actually clicks.
    ticks = []
    for value in TICK_VALUES:
        x_disp, y_disp = cbar.ax.transData.transform((value, 0.5))
        pixel = display_to_image(fig, x_disp, y_mid)
        ticks.append({"x": pixel["x"], "y": pixel["y"], "value": value})
    key = {
        "from": display_to_image(fig, box.x0 + 2, y_mid),
        "to": display_to_image(fig, box.x1 - 2, y_mid),
        "ticks": ticks,
        "height_px": round(float(box.y1 - box.y0), 2),
    }

    # ⚑ The figure's own x/y calibration, so a test can read the WHOLE MATRIX
    # rather than probing cells it already knows the pixel of. Two points per
    # axis, exactly what the app asks a user to click.
    def axis_point(dx, dy, value):
        x_disp, y_disp = ax.transData.transform((dx, dy))
        pixel = display_to_image(fig, x_disp, y_disp)
        return {"x": pixel["x"], "y": pixel["y"], "value": value}

    frame = {
        "x1": axis_point(X_EDGES[0], Y_EDGES[0], X_EDGES[0]),
        "x2": axis_point(X_EDGES[-1], Y_EDGES[0], X_EDGES[-1]),
        "y1": axis_point(X_EDGES[0], Y_EDGES[0], Y_EDGES[0]),
        "y2": axis_point(X_EDGES[0], Y_EDGES[-1], Y_EDGES[-1]),
    }

    cells = []
    for row in range(len(Y_EDGES) - 1):
        for col in range(len(X_EDGES) - 1):
            cx = (X_EDGES[col] + X_EDGES[col + 1]) / 2
            cy = (Y_EDGES[row] + Y_EDGES[row + 1]) / 2
            x_disp, y_disp = ax.transData.transform((cx, cy))
            pixel = display_to_image(fig, x_disp, y_disp)
            cells.append(
                {
                    "x": pixel["x"],
                    "y": pixel["y"],
                    "value": round(float(values[row][col]), 6),
                    "x_min": X_EDGES[col],
                    "x_max": X_EDGES[col + 1],
                    "y_min": Y_EDGES[row],
                    "y_max": Y_EDGES[row + 1],
                }
            )

    path = os.path.join(OUT, name)
    fig.savefig(path, dpi=DPI)
    plt.close(fig)
    return {"file": name, "cmap": cmap, "key": key, "frame": frame, "grid": {"x": X_EDGES, "y": Y_EDGES}, "cells": cells}


def jpeg_degrade(src_name, dst_name, quality=35):
    """Round-trip a fixture through JPEG and back into a PNG, so the artefacts
    are baked into a format the test's PNG reader can open. This is the hostile
    case: a figure lifted out of a published PDF or a screenshot."""
    with Image.open(os.path.join(OUT, src_name)) as img:
        rgb = img.convert("RGB")
        buf = io.BytesIO()
        rgb.save(buf, format="JPEG", quality=quality)
        buf.seek(0)
        with Image.open(buf) as degraded:
            degraded.convert("RGB").save(os.path.join(OUT, dst_name), format="PNG")


def make_cyclic_key(name):
    """A key on its own, drawn from a CYCLIC colormap: the hue runs a full
    360° and comes back to the red it started on.

    ⚑ `twilight`, NOT `hsv`, AND THE DIFFERENCE WAS MEASURED. matplotlib's `hsv`
    is described as cyclic but its lookup table stops one step short of closing:
    `hsv(1.0)` is (255, 0, 24), not the (255, 0, 0) it starts on. A fixture built
    on it produced ends 23 RGB units apart, the module correctly reported ONE
    candidate, and a test demanding two would have been demanding a figure that
    does not exist. `twilight` closes exactly: (226, 217, 226) at both ends.

    ⚑ 256 COLUMNS, NOT 1024: more gradient columns than screen pixels makes
    matplotlib DOWNSAMPLE and blend neighbours, so the end column came out as a
    mixture rather than the pure red the colormap defines. 256 is also what a
    real key holds.

    ⚑ MEASURED, NOT ASSUMED — the first versions of this fixture were wrong,
    in the same way twice. Sampling `hsv` at 512 pixel CENTRES never reaches hue
    360°, and the gradient's outermost columns are ANTI-ALIASED against the axes
    boundary (they came out at 241 rather than 255), so the two ends of the
    sampled strip landed 21–27 RGB units apart. The module then correctly
    reported ONE candidate — on that render the ends really were
    distinguishable, and a test asserting otherwise would have been asserting a
    figure that did not exist.

    The fix is to let the axes extend PAST the gradient (`set_xlim`), so hue 0
    and hue 1 are both interior columns with no boundary to blend against, and
    to place the strip's ends exactly on them.
    """
    fig, ax = plt.subplots(figsize=(8.0, 0.9), dpi=DPI)
    gradient = np.linspace(0, 1, 256).reshape(1, -1)
    ax.imshow(gradient, aspect="auto", cmap="twilight", extent=(0.0, 1.0, 0.0, 1.0))
    ax.set_xlim(-0.02, 1.02)
    ax.set_yticks([])
    ax.set_xticks([0, 0.5, 1])
    fig.subplots_adjust(left=0.03, right=0.97, top=0.9, bottom=0.3)
    fig.canvas.draw()

    box = ax.get_window_extent()
    y_mid = (box.y0 + box.y1) / 2
    ends = {}
    ticks = []
    # The CENTRES of the gradient's first and last columns, not the extent's
    # edges: hue 0 and hue 1 are both pure red, but the edge itself is the
    # boundary with the white margin and samples as white.
    half_column = 0.5 / 256
    for value in (0.0, 1.0):
        x_disp, _ = ax.transData.transform((value + (half_column if value == 0 else -half_column), 0.5))
        pixel = display_to_image(fig, x_disp, y_mid)
        ends[value] = pixel
        ticks.append({"x": pixel["x"], "y": pixel["y"], "value": value})
    key = {
        "from": ends[0.0],
        "to": ends[1.0],
        "ticks": ticks,
        "height_px": round(float(box.y1 - box.y0), 2),
    }
    fig.savefig(os.path.join(OUT, name), dpi=DPI)
    plt.close(fig)
    return {"file": name, "cmap": "twilight", "key": key, "cells": []}


def main():
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.default_rng(SEED)
    # A smooth field plus noise, so neighbouring cells differ by a lot in some
    # places and very little in others — both regimes in one figure.
    base = np.array(
        [[VMIN + (VMAX - VMIN) * ((r + 1) * (c + 2)) / 30.0 for c in range(len(X_EDGES) - 1)]
         for r in range(len(Y_EDGES) - 1)]
    )
    values = np.clip(base + rng.normal(0, 6, base.shape), VMIN, VMAX)

    figures = [
        make_heatmap("heatmap-viridis.png", "viridis", values),
        make_heatmap("heatmap-jet.png", "jet", values),
    ]
    jpeg_degrade("heatmap-jet.png", "heatmap-jet-jpeg.png")
    jet_jpeg = dict(figures[1])
    jet_jpeg["file"] = "heatmap-jet-jpeg.png"
    jet_jpeg["jpeg_quality"] = 35
    figures.append(jet_jpeg)
    figures.append(make_cyclic_key("key-cyclic.png"))
    # The cyclic key AND degraded: ambiguity and colour error compound, which is
    # the worst combination a heatmap can present.
    jpeg_degrade("key-cyclic.png", "key-cyclic-jpeg.png")
    cyc_jpeg = dict(figures[-1])
    cyc_jpeg["file"] = "key-cyclic-jpeg.png"
    cyc_jpeg["jpeg_quality"] = 35
    figures.append(cyc_jpeg)

    truth = {
        "generator": "samples/generators/gen_colorbar_fixtures.py",
        "seed": SEED,
        "matplotlib": matplotlib.__version__,
        "figures": figures,
    }
    with open(os.path.join(OUT, "truth.json"), "w") as fh:
        json.dump(truth, fh, indent=2)
        fh.write("\n")
    print(f"wrote {len(figures)} figures + truth.json to {OUT}")


if __name__ == "__main__":
    main()
