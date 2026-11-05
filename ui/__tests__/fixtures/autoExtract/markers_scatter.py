"""A scatter whose three series share one ink and are told apart by their markers: filled circles, filled squares and
open triangles, some drawn over each other (e2e, "Auto-extract all series on the marker-coded scatter"; docs/
v2.7-workflow-walk.md, "Series told apart by their markers"). Run: python3 markers_scatter.py"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'samples', 'generators'))
import gen_samples as g
import matplotlib.pyplot as plt

out = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)
kinds = [("Wild type", "o", "#111111"), ("Mutant", "s", "#111111"), ("Rescue", "^", "none")]
fig, ax = plt.subplots(figsize=(9, 7), dpi=100)
fig.patch.set_facecolor("white")
series = []
for k, (label, m, face) in enumerate(kinds):
    x = np.sort(rng.uniform(0.5, 11.5, 30))
    y = np.clip(20 + 5 * x + 12 * k + rng.normal(0, 6, x.size), 3, 97)
    ax.scatter(x, y, marker=m, s=60, facecolors=face, edgecolors="#111111", linewidths=1.3, label=label)
    series.append({"name": label, "points": [{"x": round(float(a), 3), "y": round(float(b), 3)} for a, b in zip(x, y)]})
ax.set_xlim(0, 12); ax.set_ylim(0, 100)
ax.set_xlabel("Time (h)", fontsize=13); ax.set_ylabel("Response (%)", fontsize=13)
leg = ax.legend(fontsize=11, loc="lower right")
ax.tick_params(labelsize=11)
fig.tight_layout()
calib = g._xy_calibration(fig, ax, 0, 12, 0, 100)
fig.canvas.draw()
H = fig.canvas.get_width_height()[1]
r = fig.canvas.get_renderer()
lb = leg.get_window_extent(r)
box = lambda b: [round(b.x0, 1), round(H - b.y1, 1), round(b.x1, 1), round(H - b.y0, 1)]
# each entry's words, as a reader returns them
entries = [{"name": t.get_text(), "text": box(t.get_window_extent(r))} for t in leg.get_texts()]
fig.savefig(os.path.join(out, "markers-scatter.png"), dpi=100)
json.dump({"calibration": calib, "legend": [round(lb.x0, 1), round(H - lb.y1, 1), round(lb.x1, 1), round(H - lb.y0, 1)], "entries": entries, "series": series},
          open(os.path.join(out, "markers-scatter.truth.json"), "w"))
