"""OCR label fixtures that no shipped sample carries (v2.7, case 8 in docs/v2.7-paddle-ocr.md).

Rendered the way samples/generators/gen_samples.py renders its axis text: matplotlib defaults
(DejaVu Sans), fontsize 13, dpi 100, black on white. Deterministic for a given matplotlib version.
Run: python3 engine/__tests__/fixtures/ocr/gen_labels.py
"""
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
LABELS = {"label-hallfasthet.png": "Hållfasthet", "label-micrometre.png": "µm", "label-degrees-c.png": "°C"}

for name, text in LABELS.items():
    fig = plt.figure(figsize=(3, 0.6), dpi=100)
    fig.patch.set_facecolor("white")
    fig.text(0.5, 0.5, text, fontsize=13, ha="center", va="center", color="black")
    fig.savefig(os.path.join(HERE, name), dpi=100, facecolor="white", bbox_inches="tight", pad_inches=0.08)
    plt.close(fig)

# Case 9: one row of closely spaced tick labels, which the detector returns as ONE line. Cut from a
# real matplotlib axis (default tick font) below the axis line, the way a user drags a label band.
fig, ax = plt.subplots(figsize=(2.6, 1.2), dpi=100)
fig.patch.set_facecolor("white")
ax.set_xlim(17, 31)
ax.set_xticks(range(18, 31, 2))
ax.set_yticks([])
fig.canvas.draw()
r = fig.canvas.get_renderer()
boxes = [t.get_window_extent(r) for t in ax.get_xticklabels()]
x0, x1 = min(b.x0 for b in boxes) - 4, max(b.x1 for b in boxes) + 4
y0, y1 = min(b.y0 for b in boxes) - 3, max(b.y1 for b in boxes) + 3
from matplotlib.transforms import Bbox
fig.savefig(os.path.join(HERE, "band-ticks-18-30.png"), dpi=100, facecolor="white",
            bbox_inches=Bbox.from_extents(x0 / 100, y0 / 100, x1 / 100, y1 / 100))
plt.close(fig)
