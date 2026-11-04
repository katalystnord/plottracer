"""Dash-coded line figures with pixel ground truth (v2.7, docs/v2.7-workflow-walk.md, "Series told apart by their
line style"). Several series share one ink and differ only by line style, as matplotlib, ggplot2 and R draw them.
Run: python3 dashes.py <out dir>. Each figure writes <name>.png and <name>.json: the plot box, the legend box, and per
series its name, ink, style and pixel polyline, plus the legend sample's box."""
import json, sys
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

out = sys.argv[1]
MPL4 = ['-', '--', '-.', ':']
GG = [(0, ()), (0, (4, 4)), (0, (1, 3)), (0, (1, 3, 4, 3))]           # ggplot2 solid, dashed, dotted, dotdash (in lw units)
R_LTY = [(0, ()), (0, (4, 4)), (0, (1, 3)), (0, (4, 2, 1, 2)), (0, (8, 4))]  # R lty 1, "44", "13", "4212"-ish, longdash

def release(n):
    t = np.linspace(0, 12, 400)
    ks = [1.0, 0.45, 0.25, 0.12, 0.07][:n]
    tops = [96, 88, 78, 62, 50][:n]
    return [(t, top * (1 - np.exp(-k * t))) for k, top in zip(ks, tops)]

def parallel(n):
    x = np.linspace(0, 10, 400)
    return [(x, 2 + 2.2 * i + 0.8 * np.sin(x * 0.7 + i)) for i in range(n)]

def crossing(n):
    x = np.linspace(0, 10, 400)
    return [(x, np.sin(x * 0.6 + i * 1.3) * (1 + 0.15 * i) + 0.3 * i) for i in range(n)]

def decay(n):
    x = np.linspace(0, 50, 400)
    return [(x, 100 * np.exp(-x / (6 + 7 * i))) for i in range(n)]

def figure(name, curves, styles, inks, lw, dpi, size=(6.4, 4.4), legend_loc='lower right'):
    fig, ax = plt.subplots(figsize=size, dpi=dpi)
    hs = []
    for i, (x, y) in enumerate(curves):
        (L,) = ax.plot(x, y, color=inks[i % len(inks)], lw=lw, linestyle=styles[i % len(styles)], label=f'Series {chr(65 + i)}')
        hs.append(L)
    ax.set_xlabel('x'); ax.set_ylabel('y')
    leg = ax.legend(loc=legend_loc)
    fig.tight_layout()
    fig.canvas.draw()
    H = fig.canvas.get_width_height()[1]
    r = fig.canvas.get_renderer()
    bb = ax.get_window_extent()
    lb = leg.get_window_extent(r)
    series = []
    for i, ((x, y), L, hl) in enumerate(zip(curves, hs, leg.get_lines())):
        p = ax.transData.transform(np.column_stack([x, y]))
        sb = hl.get_window_extent(r)
        st = styles[i % len(styles)]
        series.append({
            'name': f'Series {chr(65 + i)}',
            'ink': [int(round(v * 255)) for v in matplotlib.colors.to_rgb(inks[i % len(inks)])],
            'style': st if isinstance(st, str) else {'offset': st[0], 'dashes': list(st[1])},
            'px': p[:, 0].round(2).tolist(), 'py': (H - p[:, 1]).round(2).tolist(),
            'sample': [round(sb.x0, 1), round(H - sb.y1, 1), round(sb.x1, 1), round(H - sb.y0, 1)],
        })
    fig.savefig(f'{out}/{name}.png', dpi=dpi)
    json.dump({'lineWidth': lw, 'dpi': dpi,
               'box': [round(bb.x0, 1), round(H - bb.y1, 1), round(bb.x1, 1), round(H - bb.y0, 1)],
               'legend': [round(lb.x0, 1), round(H - lb.y1, 1), round(lb.x1, 1), round(H - lb.y0, 1)],
               'series': series}, open(f'{out}/{name}.json', 'w'))
    plt.close(fig)

K = 'black'
figure('release-mpl4-lw1.5-100', release(4), MPL4, [K], 1.5, 100)
figure('release-mpl4-lw1-150', release(4), MPL4, [K], 1.0, 150)
figure('release-mpl4-lw2-100', release(4), MPL4, [K], 2.0, 100)
figure('parallel-mpl4-lw1.5-100', parallel(4), MPL4, [K], 1.5, 100, legend_loc='upper left')
figure('parallel-gg4-lw1-100', parallel(4), GG, [K], 1.0, 100, legend_loc='upper left')
figure('crossing-mpl4-lw1.5-100', crossing(4), MPL4, [K], 1.5, 100, legend_loc='upper right')
figure('crossing-mpl3-lw1-150', crossing(3), MPL4[:3], [K], 1.0, 150, legend_loc='upper right')
figure('decay-rlty5-lw1-100', decay(5), R_LTY, [K], 1.0, 100, legend_loc='upper right')
figure('decay-mpl4-grey-lw1.5-100', decay(4), MPL4, ['0.35'], 1.5, 100, legend_loc='upper right')
figure('decay-gg4-lw0.8-100', decay(4), GG, [K], 0.8, 100, legend_loc='upper right')
# two inks, two styles each: colour tells two groups apart, style the series inside each
figure('parallel-2inks-2styles-lw1.5-100', parallel(4), ['-', '-', '--', '--'], ['tab:blue', 'tab:red', 'tab:blue', 'tab:red'], 1.5, 100, legend_loc='upper left')
