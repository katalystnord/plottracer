"""One fixture per idea raised 2026-10-07, each with exact pixel truth (inside the plot box)."""
import numpy as np, matplotlib, json
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import colors as mc
M = []
def save(name, fig, ax, truth, kind, note):
    fig.canvas.draw(); H = fig.canvas.get_width_height()[1]
    bb = ax.get_window_extent(); box = [bb.x0, H - bb.y1, bb.x1, H - bb.y0]
    out = {}
    for n, (xs, ys, rgb) in truth.items():
        p = ax.transData.transform(np.c_[xs, ys]); pts = [[float(a), float(H - b)] for a, b in p]
        out[n] = {"rgb": rgb, "px": pts}
    fig.savefig(name + ".png", dpi=100); plt.close(fig)
    json.dump({"kind": kind, "note": note, "box": box, "curves": out}, open(name + ".truth.json", "w")); M.append(name)
def new(ylim=(0, 10)):
    fig, ax = plt.subplots(figsize=(6.4, 4.8), dpi=100); ax.set_xlim(0, 10); ax.set_ylim(*ylim); return fig, ax
K = [33, 33, 33]
x = np.linspace(0, 10, 800)
P = 370 / 496
def k(deg): return np.tan(np.radians(deg / 2)) / P
# --- same-ink curves (E1-E8)
for name, deg in [("s1_same_steep", 90), ("s2_same_shallow_8deg", 8)]:
    fig, ax = new(); a = 5 + k(deg) * (x - 5); b = 5 - k(deg) * (x - 5)
    ax.plot(x, a, color="#333333", lw=1.5); ax.plot(x, b, color="#333333", lw=1.5)
    save(name, fig, ax, {"a": (x, a, K), "b": (x, b, K)}, "curves", f"two same-ink lines crossing at about {deg} deg")
fig, ax = new(); c = {"a": 5 + 0.9 * (x - 5), "b": 5 - 0.6 * (x - 5), "c": 5 + 0.1 * (x - 5) + 0.05 * (x - 5) ** 2}
for v in c.values(): ax.plot(x, v, color="#333333", lw=1.5)
save("s3_same_three", fig, ax, {n: (x, v, K) for n, v in c.items()}, "curves", "three same-ink curves through one point")
fig, ax = new(); a = 5 + 0.08 * (x - 5) ** 2; b = 5 - 0.08 * (x - 5) ** 2 + 0.0
ax.plot(x, a, color="#333333", lw=1.5); ax.plot(x, b, color="#333333", lw=1.5)
save("s4_same_touch", fig, ax, {"a": (x, a, K), "b": (x, b, K)}, "curves", "two same-ink curves that touch at x=5 and part")
fig, ax = new(); a = 2 + 0.6 * x; b = 8 - 0.55 * x
ax.plot(x, a, color="#333333", lw=1.5); ax.plot(x, b, color="#333333", lw=1.5, ls="--")
save("s5_same_dashed", fig, ax, {"solid": (x, a, K), "dashed": (x, b, K)}, "curves", "dashed crossing solid, same ink")
fig, ax = new(); a = 2 + 0.6 * x; b = 8 - 0.55 * x; xm = np.linspace(0, 10, 11)
ax.plot(x, a, color="#333333", lw=1.2); ax.plot(xm, 2 + 0.6 * xm, "o", color="#333333", ms=6)
ax.plot(x, b, color="#333333", lw=1.2); ax.plot(xm, 8 - 0.55 * xm, "s", color="#333333", ms=6)
save("s6_same_markers", fig, ax, {"circles": (x, a, K), "squares": (x, b, K)}, "curves", "line+marker curves crossing, same ink")
fig, ax = new(); a = 5 + 2.5 * np.sin(x / 1.6); ax.plot(x, a, color="#333333", lw=1.5)
ax.text(5.0, 5 + 2.5 * np.sin(5 / 1.6), "T = 300 K", ha="center", va="center", fontsize=10, bbox=dict(fc="white", ec="none", pad=1))
save("s7_inline_label", fig, ax, {"curve": (x, a, K)}, "curves", "a curve cut by an inline text label (white box)")
fig, ax = new(); a = 2 + 0.7 * x; ax.plot(x, a, color="tab:blue", lw=1.5, label="measured")
ax.plot(x, 9 - 0.3 * x, color="tab:orange", lw=1.5, label="model")
ax.legend(loc="center", framealpha=1)
save("s8_under_legend", fig, ax, {"measured": (x, a, [31, 119, 180]), "model": (x, 9 - 0.3 * x, [255, 127, 14])}, "curves", "a curve passing under an opaque legend box")
# --- bands
fig, ax = new(); m = 5 + 2 * np.sin(x / 1.6); s = 0.6 + 0.12 * x
ax.fill_between(x, m - s, m + s, color="tab:blue", alpha=0.25, lw=0); ax.plot(x, m, color="tab:blue", lw=1.5)
save("b1_band_fill_centre", fig, ax, {"upper": (x, m + s, [31, 119, 180]), "lower": (x, m - s, [31, 119, 180]), "centre": (x, m, [31, 119, 180])}, "band", "filled band with a drawn centre line")
fig, ax = new(); ax.plot(x, m, color="#333333", lw=1.5); ax.plot(x, m + s, color="#333333", lw=1.0, ls="--"); ax.plot(x, m - s, color="#333333", lw=1.0, ls="--")
save("b2_band_dashed_edges", fig, ax, {"upper": (x, m + s, K), "lower": (x, m - s, K), "centre": (x, m, K)}, "band", "band drawn as two dashed edge lines around a solid centre, no fill")
# --- contours
X, Y = np.meshgrid(np.linspace(0, 10, 300), np.linspace(0, 10, 300))
Z = np.exp(-((X - 4) ** 2 + (Y - 5) ** 2) / 8) + 0.6 * np.exp(-((X - 7.5) ** 2 + (Y - 3) ** 2) / 3)
for name, colored in [("c1_contour_black_labelled", False), ("c2_contour_coloured", True)]:
    fig, ax = new(); lv = [0.2, 0.4, 0.6, 0.8]
    full = ax.contour(X, Y, Z, levels=lv, colors="none")  # truth before labels
    segs = full.allsegs
    if colored:
        cs = ax.contour(X, Y, Z, levels=lv, cmap="viridis", linewidths=1.5); cols = [mc.to_rgb(c) for c in cs.get_edgecolor()] if hasattr(cs, "get_edgecolor") else None
    else:
        cs = ax.contour(X, Y, Z, levels=lv, colors="#333333", linewidths=1.2); ax.clabel(cs, fmt="%.1f", fontsize=9)
    truth = {}
    for li, (L, ss) in enumerate(zip(lv, segs)):
        for si, sg in enumerate(ss):
            rgb = K
            if colored:
                c = cs.get_edgecolor()[li] if hasattr(cs, "get_edgecolor") else None
                rgb = [round(255 * v) for v in c[:3]]
            truth[f"L{L}_{si}"] = (sg[:, 0], sg[:, 1], rgb)
    save(name, fig, ax, truth, "contour", ("black labelled" if not colored else "viridis coloured") + " contour, truth = full lines (before label gaps)")
json.dump(M, open("manifest.json", "w")); print(M)
