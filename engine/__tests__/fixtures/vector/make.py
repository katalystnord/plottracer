"""Fixtures for v2.7 V1-V4 (engine/__tests__/figureKind.test.ts): one small PDF
per kind of figure, made with matplotlib so what each one holds is known.

  python3 make.py
"""
import matplotlib
matplotlib.use('pdf')
import matplotlib.pyplot as plt
import numpy as np

matplotlib.rcParams['pdf.fonttype'] = 42
x = np.linspace(0, 10, 60)
rng = np.random.default_rng(7)
heat = rng.random((40, 60)).cumsum(axis=1)

# drawn: three series with markers, all paths
fig, ax = plt.subplots(figsize=(4, 3))
for k in range(3):
    ax.plot(x, np.sin(x / (k + 1)) + k, marker='o', markevery=6)
fig.savefig('drawn.pdf')
plt.close(fig)

# picture: the same chart as a picture, nothing drawn
from matplotlib.backends.backend_agg import FigureCanvasAgg
fig, ax = plt.subplots(figsize=(4, 3))
FigureCanvasAgg(fig)
for k in range(3):
    ax.plot(x, np.sin(x / (k + 1)) + k)
fig.canvas.draw()
img = np.asarray(fig.canvas.buffer_rgba())
plt.close(fig)
fig = plt.figure(figsize=(4, 3))
fig.figimage(img, resize=True)
fig.savefig('picture.pdf', dpi=100)
plt.close(fig)

# a heatmap with drawn axes, ticks and 8 contour lines: 28 shapes over a
# picture, which the rule counts as a picture (fewer than 40 drawn)
fig, ax = plt.subplots(figsize=(4, 3))
ax.imshow(heat, aspect='auto', extent=(0, 10, 0, 4), origin='lower')
ax.contour(np.linspace(0, 10, 60), np.linspace(0, 4, 40), heat, levels=8, colors='k', linewidths=0.6)
fig.savefig('heatmap.pdf')
plt.close(fig)

# partly, drawn over a picture: three series with markers over a heatmap
fig, ax = plt.subplots(figsize=(4, 3))
ax.imshow(heat, aspect='auto', extent=(0, 10, 0, 4), origin='lower')
for k in range(3):
    ax.plot(x, 1 + k + 0.4 * np.sin(x), marker='o', markevery=3, color='w')
fig.savefig('partly-over.pdf')
plt.close(fig)

# partly, a picture inset in a drawn chart
fig, ax = plt.subplots(figsize=(4, 3))
for k in range(3):
    ax.plot(x, np.sin(x / (k + 1)) + k, marker='o', markevery=6)
ins = fig.add_axes((0.45, 0.4, 0.45, 0.45))
ins.imshow(heat, aspect='auto')
ins.set_axis_off()
fig.savefig('partly-inset.pdf')
plt.close(fig)

# nothing to say: a page with a caption and one rule
fig = plt.figure(figsize=(4, 3))
fig.text(0.1, 0.5, 'Figure 1. A caption on its own.')
fig.add_artist(plt.Line2D([0.1, 0.9], [0.4, 0.4], color='k'))
fig.savefig('sparse.pdf')
plt.close(fig)
print('written')
