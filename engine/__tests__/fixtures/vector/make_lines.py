"""Fixtures for v2.7 V12-V27 (engine/__tests__/linesFromDrawing.test.ts): one
small matplotlib PDF per case, each with a truth file of what was drawn, in PDF
page points (y up): the plot box, the legend box, the text, and each line.

  python3 make_lines.py
"""
import json
import matplotlib
matplotlib.use('pdf')
import matplotlib.pyplot as plt
import numpy as np

matplotlib.rcParams['pdf.fonttype'] = 42
INK = 'k'


def page_pts(fig, ax, xy):
    # display pixels (fig.dpi) -> PDF points; PDF y is up, as is display
    d = ax.transData.transform(np.asarray(xy, float))
    return (d * 72.0 / fig.dpi).round(3).tolist()


def box_of(fig, bb):
    return [round(v * 72.0 / fig.dpi, 3) for v in (bb.x0, bb.y0, bb.x1, bb.y1)]


def save(fig, ax, name, lines, legend=None):
    fig.canvas.draw()
    truth = {
        'box': box_of(fig, ax.get_window_extent()),
        'legend_box': box_of(fig, legend.get_window_extent()) if legend else None,
        'lines': [{'points': page_pts(fig, ax, l)} for l in lines],
    }
    fig.savefig(name + '.pdf')
    json.dump(truth, open(name + '.truth.json', 'w'))
    plt.close(fig)


x = np.linspace(0, 10, 80)

# V25: three same-ink curves that cross, plus V26's frame (the spines are black too)
fig, ax = plt.subplots(figsize=(4, 3))
ys = [np.sin(x / 1.5) * 2 + 5, 0.6 * x + 2, 8 - 0.5 * x + 0.5 * np.cos(x)]
for y in ys:
    ax.plot(x, y, color=INK)
save(fig, ax, 'lines-cross', [np.c_[x, y] for y in ys])

# V23: dashed and dotted lines, same ink, crossing
fig, ax = plt.subplots(figsize=(4, 3))
ys = [np.sin(x / 2) * 3 + 5, 0.7 * x + 1.5, 9 - 0.6 * x]
for y, st in zip(ys, ['--', ':', '-.']):
    ax.plot(x, y, color=INK, linestyle=st)
save(fig, ax, 'lines-dashed', [np.c_[x, y] for y in ys])

# V15 (the line half): lines through markers come back whole
fig, ax = plt.subplots(figsize=(4, 3))
ys = [np.sqrt(x + 1) * 2, 9 - np.sqrt(x + 1) * 2]
for y in ys:
    ax.plot(x, y, color=INK, marker='o', markevery=8)
save(fig, ax, 'lines-markers', [np.c_[x, y] for y in ys])

# V24: contours cut by their inline text labels, and a line with an EMPTY gap
fig, ax = plt.subplots(figsize=(4, 3))
X, Y = np.meshgrid(np.linspace(-3, 3, 120), np.linspace(-2, 2, 90))
Z = np.exp(-(X ** 2 + Y ** 2) / 2)
cs = ax.contour(X, Y, Z, levels=[0.2, 0.5, 0.8], colors=INK)
# the truth is each WHOLE loop, taken before the labels open it
segs = [s.copy() for lev in cs.allsegs for s in lev]
ax.clabel(cs, fontsize=7)
save(fig, ax, 'lines-contour-labels', segs)

fig, ax = plt.subplots(figsize=(4, 3))
y = np.sin(x / 2) * 3 + 5
yg = y.copy(); yg[35:45] = np.nan
ax.plot(x, yg, color=INK)
save(fig, ax, 'lines-empty-gap', [np.c_[x[:35], y[:35]], np.c_[x[45:], y[45:]]])

# V27: a straight reference line (2-point path) and a fit line beside a curve
fig, ax = plt.subplots(figsize=(4, 3))
y = np.sin(x / 2) * 3 + 5
ax.plot(x, y, color=INK)
ax.axhline(3.0, color=INK, linestyle='--')
ax.plot([1, 9], [7, 8.5], color=INK)
ax.set_xlim(0, 10); ax.set_ylim(0, 10)
save(fig, ax, 'lines-straight', [np.c_[x, y], [[0, 3.0], [10, 3.0]], [[1, 7], [9, 8.5]]])

# V16: a line that runs outside the axes, clipped by the figure
fig, ax = plt.subplots(figsize=(4, 3))
y = 0.3 * x ** 2
ax.plot(x, y, color=INK)
ax.set_ylim(0, 12)
inside = x[y <= 12]
save(fig, ax, 'lines-clipped', [np.c_[inside, 0.3 * inside ** 2]])

# V17: a legend whose sample lines are the series' own style
fig, ax = plt.subplots(figsize=(4, 3))
ys = [np.sin(x / 2) * 2 + 5, 0.5 * x + 1]
for k, y in enumerate(ys):
    ax.plot(x, y, color=INK, label=f'series {k + 1}')
leg = ax.legend(loc='upper left')
save(fig, ax, 'lines-legend', [np.c_[x, y] for y in ys], legend=leg)

# V28: one series drawn twice, a dotted path and a solid one about a point
# apart (as arXiv 2610.13680 p43 does), plus a series painted twice exactly
fig, ax = plt.subplots(figsize=(4, 3))
y = 0.5 * x + 2
ax.set_ylim(0, 10)
dy = 0.6 * 10 / (ax.get_window_extent().height * 72 / fig.dpi)
ax.plot(x, y, color=INK, linestyle=':')
ax.plot(x, y + dy, color=INK)
z = 8 - 0.4 * x
ax.plot(x, z, color=INK)
ax.plot(x, z, color=INK)
save(fig, ax, 'lines-doubled', [np.c_[x, y], np.c_[x, y + dy], np.c_[x, z]])

# V15: two scatter series in their own colours, filled and outlined
# markers, with a legend holding a marker sample of each; and a hollow marker
# series (outline only)
fig, ax = plt.subplots(figsize=(4, 3))
rng = np.random.default_rng(15)
pa = np.c_[rng.uniform(0.5, 9.5, 25), rng.uniform(0.5, 9.5, 25)]
pb = np.c_[rng.uniform(0.5, 9.5, 25), rng.uniform(0.5, 9.5, 25)]
pc = np.c_[rng.uniform(0.5, 9.5, 12), rng.uniform(0.5, 9.5, 12)]
ax.scatter(pa[:, 0], pa[:, 1], color='#d62728', edgecolors='#d62728', s=30, label='red')
ax.scatter(pb[:, 0], pb[:, 1], color='#1f77b4', s=30, marker='s', label='blue')
ax.scatter(pc[:, 0], pc[:, 1], facecolors='none', edgecolors='#2ca02c', s=40, label='hollow')
ax.set_xlim(0, 10); ax.set_ylim(0, 10)
leg = ax.legend(loc='upper right')
save(fig, ax, 'markers-scatter', [pa, pb, pc], legend=leg)

# V16 for markers: a scatter whose points run past the axes. matplotlib writes
# every marker and lets the axes' clip hide the ones outside; only those
# inside are shown, so only they are data
fig, ax = plt.subplots(figsize=(4, 3))
pts = np.c_[np.linspace(1, 14, 14), np.linspace(1, 9, 14)]
ax.scatter(pts[:, 0], pts[:, 1], color='#d62728', s=30)
ax.set_xlim(0, 10); ax.set_ylim(0, 10)
save(fig, ax, 'markers-clipped', [pts[pts[:, 0] <= 10]])

# E1-E4 (error bars, not read): a line with markers and vertical error bars
# in its own colour, symmetric and asymmetric, with caps; a dashed vertical
# reference line in the SAME colour through none of its points; and a second
# series with horizontal error bars (xerr)
fig, ax = plt.subplots(figsize=(4, 3))
ex = np.array([1.0, 2.5, 4.0, 5.5, 7.0, 8.5]); ey = np.array([3.0, 4.2, 3.6, 5.1, 4.8, 6.0])
ax.errorbar(ex, ey, yerr=[[0.4, 1.2, 0.3, 0.8, 0.5, 1.5], [0.6, 1.2, 0.3, 0.2, 0.9, 1.0]], color='#1f4e79', marker='o', capsize=3)
ax.axvline(6.2, color='#1f4e79', linestyle='--')
hx = np.array([2.0, 4.5, 7.5]); hy = np.array([8.0, 8.6, 7.9])
ax.errorbar(hx, hy, xerr=[0.8, 0.5, 1.1], color='#9b3a2e', marker='s', linestyle='none', capsize=3)
ax.set_xlim(0, 10); ax.set_ylim(0, 10)
save(fig, ax, 'lines-errorbars', [np.c_[ex, ey], [[6.2, 0], [6.2, 10]], np.c_[hx, hy]])

# V14: a smoothed line through 6 data points, drawn as ~100 corners, with
# a marker at each data point in the same colour (as LibreOffice draws a
# smoothed chart series)
from scipy.interpolate import CubicSpline
fig, ax = plt.subplots(figsize=(4, 3))
dx = np.array([0.5, 2.0, 3.5, 5.5, 7.5, 9.5]); dyv = np.array([2.0, 6.5, 4.0, 8.0, 3.5, 7.0])
xs = np.linspace(dx[0], dx[-1], 101)
ax.plot(xs, CubicSpline(dx, dyv)(xs), color=INK)
ax.plot(dx, dyv, linestyle='none', marker='o', color=INK)
ax.set_xlim(0, 10); ax.set_ylim(0, 10)
save(fig, ax, 'lines-smoothed', [np.c_[xs, CubicSpline(dx, dyv)(xs)], np.c_[dx, dyv]])

# V12a: a picture inside the PDF (nothing drawn to read)
from matplotlib.backends.backend_agg import FigureCanvasAgg
fig, ax = plt.subplots(figsize=(4, 3))
FigureCanvasAgg(fig)
ax.plot(x, np.sin(x), color=INK)
fig.canvas.draw()
img = np.asarray(fig.canvas.buffer_rgba())
plt.close(fig)
fig = plt.figure(figsize=(4, 3))
fig.figimage(img, resize=True)
fig.savefig('lines-picture.pdf', dpi=100)
plt.close(fig)
print('written')
