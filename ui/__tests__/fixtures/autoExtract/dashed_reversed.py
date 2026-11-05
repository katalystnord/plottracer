"""The bundled dash-coded figure (samples/xy-dashed-release) with its line styles in the other order: the legend's
first entry is the dotted line, the last the solid one (e2e, "Auto-extract all series ... the dotted line first";
the code review of 8816f1e..666ea46, 2026-11-05). Run: python3 dashed_reversed.py"""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'samples', 'generators'))
import gen_samples as g
import matplotlib.pyplot as plt

out = os.path.dirname(os.path.abspath(__file__))
curves = [("Formulation A", ":", 96.0, 0.85), ("Formulation B", "-.", 88.0, 0.48), ("Formulation C", "--", 78.0, 0.30), ("Formulation D", "-", 66.0, 0.18)]
x = np.linspace(0, 12, 300)
fig, ax = plt.subplots(figsize=(9, 7), dpi=100)
fig.patch.set_facecolor("white")
series = []
for label, ls, rmax, k in curves:
    ax.plot(x, rmax * (1 - np.exp(-k * x)), linestyle=ls, color="#111111", linewidth=1.9, label=label)
    xs = np.linspace(0, 12, 49)
    series.append({"name": label, "points": [{"x": round(float(a), 3), "y": round(float(rmax * (1 - np.exp(-k * a))), 3)} for a in xs]})
ax.set_xlim(0, 12); ax.set_ylim(0, 100)
ax.set_xlabel("Time (h)", fontsize=13); ax.set_ylabel("Cumulative release (%)", fontsize=13)
ax.grid(True, color="#dddddd", linewidth=0.8)
leg = ax.legend(fontsize=10, loc="lower right")
ax.tick_params(labelsize=11)
fig.tight_layout()
calib = g._xy_calibration(fig, ax, 0, 12, 0, 100)
fig.canvas.draw()
H = fig.canvas.get_width_height()[1]
lb = leg.get_window_extent(fig.canvas.get_renderer())
fig.savefig(os.path.join(out, "dashed-reversed.png"), dpi=100)
json.dump({"calibration": calib, "legend": [round(lb.x0, 1), round(H - lb.y1, 1), round(lb.x1, 1), round(H - lb.y0, 1)], "series": series},
          open(os.path.join(out, "dashed-reversed.truth.json"), "w"))
