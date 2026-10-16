"""Fixtures for v2.7 V5-V11, calibration read from the labels
(engine/__tests__/labelCalibration.test.ts): matplotlib PDFs whose tick labels
are real text. Each truth file holds, in PDF page points (y up), per axis:
the axis limits, whether it is log, and every labelled tick (value, position).

  python3 make_labels.py
"""
import json
import os

import matplotlib
matplotlib.use('pdf')
import matplotlib.pyplot as plt
import numpy as np

matplotlib.rcParams['pdf.fonttype'] = 42
HERE = os.path.dirname(os.path.abspath(__file__))


def save(fig, ax, name, extra=None):
    fig.canvas.draw()
    k = 72.0 / fig.dpi
    pt = lambda xy: (ax.transData.transform(np.asarray(xy, float)) * k).tolist()
    (x0, x1), (y0, y1) = ax.get_xlim(), ax.get_ylim()
    bb = ax.get_window_extent()
    labelled = lambda ticks, labels: [float(v) for v, l in zip(ticks, labels) if l.get_text() and l.get_visible()]
    xs = [v for v in labelled(ax.get_xticks(), ax.get_xticklabels()) if x0 <= v <= x1]
    ys = [v for v in labelled(ax.get_yticks(), ax.get_yticklabels()) if y0 <= v <= y1]
    truth = {
        'box': [round(v * k, 4) for v in (bb.x0, bb.y0, bb.x1, bb.y1)],
        'x': {'limits': [x0, x1], 'log': ax.get_xscale() == 'log', 'ticks': [[v, pt([v, y0])[0]] for v in xs]},
        'y': {'limits': [y0, y1], 'log': ax.get_yscale() == 'log', 'ticks': [[v, pt([x0, v])[1]] for v in ys]},
    }
    truth.update(extra or {})
    json.dump(truth, open(os.path.join(HERE, name + '.truth.json'), 'w'))
    fig.savefig(os.path.join(HERE, name + '.pdf'))
    plt.close(fig)


# V5, V6: the example in the case - X 0, 20 ... 100 and Y 0, 500 ... 3500
fig, ax = plt.subplots(figsize=(4, 3))
x = np.linspace(0, 100, 30)
ax.plot(x, 3500 * (x / 100) ** 2, color='#1f77b4')
ax.set_xlim(0, 100); ax.set_ylim(0, 3500)
save(fig, ax, 'labels-linear')

# negative values written with the true minus sign (matplotlib's default), and decimals
fig, ax = plt.subplots(figsize=(4, 3))
x = np.linspace(-1.5, 1.5, 30)
ax.plot(x, np.sin(x * 2) * 0.8, color='#d62728')
ax.set_xlim(-1.5, 1.5); ax.set_ylim(-1, 1)
save(fig, ax, 'labels-negative')

# V9: a log axis labelled 10^1 ... 10^4, the exponent written smaller and raised
fig, ax = plt.subplots(figsize=(4, 3))
x = np.linspace(0, 10, 30)
ax.semilogy(x, 10 ** (1 + 0.3 * x), color='#2ca02c')
ax.set_ylim(10, 1e4)
save(fig, ax, 'labels-log')

# V7: a tick mark with no label (minor ticks on), and a number printed with no
# tick mark at it (an annotation just under the axis)
fig, ax = plt.subplots(figsize=(4, 3))
x = np.linspace(0, 10, 30)
ax.plot(x, x, color='#9467bd')
ax.set_xlim(0, 10); ax.set_ylim(0, 10)
ax.minorticks_on()
ax.annotate('7.3', xy=(7.3, 0), xytext=(7.3, -0.7), textcoords='data', ha='center', va='center', annotation_clip=False)  # in the label row
save(fig, ax, 'labels-unpaired')

# V8: Y has a single label (one usable pair); X labels do not fit one scale
fig, ax = plt.subplots(figsize=(4, 3))
ax.plot(np.arange(11), np.arange(11), color='#8c564b', marker='o')  # markers: enough drawn shapes to class as drawn (V1)
ax.set_xlim(0, 10); ax.set_ylim(0, 10)
ax.set_yticks([5]); ax.set_yticklabels(['5'])
ax.set_xticks([0, 2, 4, 6, 8, 10]); ax.set_xticklabels(['0', '2', '4', '9', '8', '10'])
save(fig, ax, 'labels-refused')

# V8 (a scale factor): matplotlib prints "1e6" above the axis and labels 0 ... 3
fig, ax = plt.subplots(figsize=(4, 3))
ax.plot([0, 10], [0, 3e6], color='#17becf')
ax.set_xlim(0, 10); ax.set_ylim(0, 3e6)
save(fig, ax, 'labels-offset')
# a second Y axis along the right (twinx), in another unit: the reader takes
# the first, left one, and says the second is there (David, 2026-10-16)
fig, ax = plt.subplots(figsize=(4, 3))
x = np.linspace(0, 10, 30)
ax.plot(x, x * 3, color='#1f77b4', marker='o', markevery=3)
ax.set_xlim(0, 10); ax.set_ylim(0, 30)
ax2 = ax.twinx()
ax2.plot(x, 100 - x * 5, color='#2ca02c')
ax2.set_ylim(0, 100)
save(fig, ax, 'labels-twin')
print('written')
