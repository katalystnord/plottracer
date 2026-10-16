"""Fixtures for v2.7 V18 (engine/__tests__/barsFromDrawing.test.ts): matplotlib
bar charts drawn as vectors, with KNOWN heights (2 decimals), so what the
drawing gives can be compared with the data. Truth in PDF page points (y up):
  box       the plot area
  value     two known values on the value axis and where they sit
  category  the outer edges of the first and last category, and the count
  series    per series: its colour and its heights, in category order
  swatches  the legend's swatch rectangles (they are not bars)

  python3 make_bars.py
  uv run --with openpyxl python3 make_bars.py lo   (LibreOffice Calc, one series)

R's three ways are in make_bars.R.
"""
import json
import os
import subprocess
import sys

import matplotlib
matplotlib.use('pdf')
import matplotlib.pyplot as plt
import numpy as np

matplotlib.rcParams['pdf.fonttype'] = 42
HERE = os.path.dirname(os.path.abspath(__file__))


def rgb(h):
    return [int(h[i:i + 2], 16) for i in (1, 3, 5)]


def save(fig, ax, name, series, horizontal=False, legend=None, extra=None):
    fig.canvas.draw()
    k = 72.0 / fig.dpi
    pt = lambda xy: (ax.transData.transform(np.asarray(xy, float)) * k).tolist()
    bb = ax.get_window_extent()
    (x0, x1), (y0, y1) = ax.get_xlim(), ax.get_ylim()
    if horizontal:
        vt = [v for v in ax.get_xticks() if x0 <= v <= x1]
        value = [[0.0, pt([0.0, y0])[0]], [float(vt[-1]), pt([vt[-1], y0])[0]]]
        # the category axis runs where the bars stand: along 0
        category = {'from': pt([0.0, y0]), 'to': pt([0.0, y1]), 'count': len(series[0]['heights'])}
    else:
        vt = [v for v in ax.get_yticks() if y0 <= v <= y1]
        # P1 is the bars' common origin (its prompt: "a known bar value (e.g. 0)"), then the top tick
        value = [[0.0, pt([x0, 0.0])[1]], [float(vt[-1]), pt([x0, vt[-1]])[1]]]
        # the category axis runs where the bars stand: along 0
        category = {'from': pt([x0, 0.0]), 'to': pt([x1, 0.0]), 'count': len(series[0]['heights'])}
    swatches = []
    if legend is not None:
        for p in legend.get_patches():
            e = p.get_window_extent()
            swatches.append([round(v * k, 3) for v in (e.x0, e.y0, e.x1, e.y1)])
    truth = {'box': [round(v * k, 4) for v in (bb.x0, bb.y0, bb.x1, bb.y1)], 'horizontal': horizontal,
             'value': value, 'category': category, 'series': series, 'swatches': swatches}
    truth.update(extra or {})
    json.dump(truth, open(os.path.join(HERE, name + '.truth.json'), 'w'))
    fig.savefig(os.path.join(HERE, name + '.pdf'))
    plt.close(fig)


def make_lo():
    """A Calc bar chart exported by LibreOffice itself: it closes each bar's
    outline twice and starts its legend swatch half way along an edge."""
    from openpyxl import Workbook
    from openpyxl.chart import BarChart, Reference
    from openpyxl.chart.shapes import GraphicalProperties
    wb = Workbook(); sh = wb.active; ws = wb.create_sheet('data')
    for i, v in enumerate([3.25, 5.10, 2.40, 6.75], 1):
        ws.cell(i, 1, f'c{i}'); ws.cell(i, 2, v)
    ch = BarChart()
    ch.add_data(Reference(ws, min_col=2, min_row=1, max_row=4))
    ch.set_categories(Reference(ws, min_col=1, min_row=1, max_row=4))
    ch.series[0].graphicalProperties = GraphicalProperties(solidFill='1F77B4')
    sh.add_chart(ch, 'A1')
    x = os.path.join(HERE, 'bars-lo.xlsx'); wb.save(x)
    subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', HERE, x], check=True, capture_output=True)
    os.remove(x)


if sys.argv[1:] == ['lo']:
    make_lo()
    sys.exit()

# V18: grouped bars, two series, one with negative values, and a legend whose
# swatches are filled rectangles in the series' own colours
cats = np.arange(5)
a = [3.25, 5.10, 2.40, 6.75, 4.05]
b = [1.80, -1.35, 3.60, 2.15, -0.70]
fig, ax = plt.subplots(figsize=(4, 3))
ax.bar(cats - 0.2, a, width=0.4, color='#1f77b4', label='A')
ax.bar(cats + 0.2, b, width=0.4, color='#ff7f0e', label='B')
ax.axhline(0, color='k', lw=0.8)
ax.set_xlim(-0.5, 4.5); ax.set_ylim(-2, 8)
leg = ax.legend(loc='upper left')
save(fig, ax, 'bars-grouped', [{'colour': rgb('#1f77b4'), 'heights': a}, {'colour': rgb('#ff7f0e'), 'heights': b}], legend=leg)

# V18: horizontal bars, outlined in a darker edge of their own colour
h = [2.30, 4.85, 3.10, 1.45]
fig, ax = plt.subplots(figsize=(4, 3))
ax.barh(np.arange(4), h, height=0.6, color='#2ca02c', edgecolor='#2ca02c')
ax.set_ylim(-0.5, 3.5); ax.set_xlim(0, 6)
save(fig, ax, 'bars-horizontal', [{'colour': rgb('#2ca02c'), 'heights': h}], horizontal=True)

# V18: one bar that does not stand on the baseline (bottom = 1.5)
f = [2.50, 3.75, 1.20]
fig, ax = plt.subplots(figsize=(4, 3))
ax.bar(np.arange(3), f, width=0.6, color='#9467bd', bottom=[0, 1.5, 0])
ax.set_xlim(-0.5, 2.5); ax.set_ylim(0, 6)
save(fig, ax, 'bars-floating', [{'colour': rgb('#9467bd'), 'heights': f}], extra={'floating': [1]})
print('written')
